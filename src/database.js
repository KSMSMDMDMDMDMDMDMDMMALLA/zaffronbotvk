const fs = require('node:fs');
const path = require('node:path');
const initSqlJs = require('sql.js');

const dataDirectory = path.join(
  __dirname,
  '..',
  'data'
);

const databasePath = path.join(
  dataDirectory,
  'bot.sqlite'
);

let db = null;

const GAME_DEBT_LIMIT = 25;
const JOB_MAX_LEVEL = 50;
const BUSINESS_MAX_UPGRADE_LEVEL = 5;
const BANK_MAX_INTEREST_HOURS = 72;
const BEGINNER_BOX_MAX_LEVEL = 3;
const BEGINNER_BOX_COOLDOWN_MS =
  10 * 60 * 1000;
const TRANSFER_DAILY_LIMIT = 5_000_000;
const TRANSFER_COMMISSION_BPS = 500;
const JOB_BOOST_DAILY_PURCHASE_LIMIT = 5;
const FARM_MAX_PLOTS = 8;
const FARM_MAX_UPGRADE_LEVEL = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const MOSCOW_UTC_OFFSET_MS =
  3 * 60 * 60 * 1000;
const TRANSFER_DAY_STAT_KEY =
  'transfer_daily_day';
const TRANSFER_AMOUNT_STAT_KEY =
  'transfer_daily_amount';
const JOB_BOOST_ITEM_KEY = 'boost-job-x2';
const JOB_BOOST_PURCHASE_DAY_STAT_KEY =
  'job_boost_purchase_day';
const JOB_BOOST_PURCHASE_COUNT_STAT_KEY =
  'job_boost_purchase_count';

const BANK_INTEREST_BRACKETS =
  Object.freeze([
    { upperBound: 1_000_000, ppm: 300_000 },
    { upperBound: 10_000_000, ppm: 20_000 },
    { upperBound: 100_000_000, ppm: 1_000 },
    { upperBound: 1_000_000_000, ppm: 100 },
    { upperBound: null, ppm: 10 }
  ]);

const BANK_FREE_WITHDRAWAL_LIMIT = 100_000;
const BANK_COMMISSION_INCOME_SHARE_BPS = 1_000;

const BANK_INTEREST_DENOMINATOR =
  1_000_000n;

const BUSINESS_MULTIPLIER_SCALES =
  Object.freeze([
    10,
    13,
    15,
    20,
    25,
    30
  ]);

const JOB_EXP_REQUIREMENTS = Object.freeze({
  1: 3,
  2: 4,
  3: 5,
  4: 6,
  5: 8,
  6: 10,
  7: 12,
  8: 15,
  9: 18
});

function getJobExperienceRequired(level) {
  const safeLevel = Number(level);

  if (
    !Number.isInteger(safeLevel) ||
    safeLevel < 1 ||
    safeLevel >= JOB_MAX_LEVEL
  ) {
    return null;
  }

  if (JOB_EXP_REQUIREMENTS[safeLevel]) {
    return JOB_EXP_REQUIREMENTS[safeLevel];
  }

  if (safeLevel >= 10 && safeLevel < 15) {
    return 20;
  }

  if (safeLevel < 20) {
    return 24;
  }

  if (safeLevel < 25) {
    return 28;
  }

  if (safeLevel < 30) {
    return 32;
  }

  if (safeLevel < 35) {
    return 36;
  }

  if (safeLevel < 40) {
    return 40;
  }

  if (safeLevel < 45) {
    return 45;
  }

  if (safeLevel < 50) {
    return 50;
  }

  return null;
}

function formatMoney(value) {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return '0';
  }

  return Math.trunc(amount)
    .toString()
    .replace(
      /\B(?=(\d{3})+(?!\d))/g,
      '.'
    );
}

function ensureDatabase() {
  if (!db) {
    throw new Error(
      'База данных ещё не инициализирована'
    );
  }
}

function getTotalAura(vkId) {
  ensureDatabase();

  const statement = db.prepare(`
    SELECT COALESCE(SUM(aura), 0) AS total_aura
    FROM aura
    WHERE vk_id = ?
  `);

  statement.bind([vkId]);

  let totalAura = 0;

  if (statement.step()) {
    const row = statement.getAsObject();

    totalAura =
      Number(row.total_aura) || 0;
  }

  statement.free();

  return totalAura;
}

function persistDatabase() {
  ensureDatabase();

  const databaseBytes = db.export();

  fs.writeFileSync(
    databasePath,
    Buffer.from(databaseBytes)
  );
}

function migratePhoneNumbersToSixDigits() {
  ensureDatabase();

  const statement = db.prepare(`
    SELECT
      vk_id,
      phone_number
    FROM phone_sims
    ORDER BY vk_id ASC
  `);
  const sims = [];

  while (statement.step()) {
    const row = statement.getAsObject();

    sims.push({
      vkId: Number(row.vk_id),
      phoneNumber: String(row.phone_number)
    });
  }

  statement.free();

  const occupiedNumbers = new Set(
    sims
      .map(sim => sim.phoneNumber)
      .filter(phoneNumber =>
        /^\d{6}$/.test(phoneNumber)
      )
  );
  const legacySims = sims.filter(sim =>
    !/^\d{6}$/.test(sim.phoneNumber)
  );

  if (legacySims.length === 0) {
    return 0;
  }

  try {
    db.run('BEGIN TRANSACTION;');

    for (const sim of legacySims) {
      const digits = sim.phoneNumber
        .replace(/\D/g, '');
      let candidate = digits
        .slice(-6)
        .padStart(6, '0');

      if (occupiedNumbers.has(candidate)) {
        let numericCandidate =
          100_000 +
          Math.abs(
            (sim.vkId * 7_919) % 900_000
          );

        while (
          occupiedNumbers.has(
            String(numericCandidate)
          )
        ) {
          numericCandidate += 1;

          if (numericCandidate > 999_999) {
            numericCandidate = 100_000;
          }
        }

        candidate = String(numericCandidate);
      }

      db.run(
        `
          UPDATE phone_sims
          SET phone_number = ?
          WHERE vk_id = ?
        `,
        [candidate, sim.vkId]
      );

      occupiedNumbers.add(candidate);
    }

    db.run('COMMIT;');

    return legacySims.length;
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

async function initializeDatabase() {
  fs.mkdirSync(dataDirectory, {
    recursive: true
  });

  const SQL = await initSqlJs({
    locateFile: file =>
      require.resolve(`sql.js/dist/${file}`)
  });

  if (fs.existsSync(databasePath)) {
    const databaseBytes =
      fs.readFileSync(databasePath);

    try {
      db = new SQL.Database(databaseBytes);
    } catch (error) {
      throw new Error(
        `Не удалось открыть базу ${databasePath}: ` +
        error.message
      );
    }
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vk_id INTEGER NOT NULL UNIQUE,
      first_name TEXT,
      last_name TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS aura (
      peer_id INTEGER NOT NULL,
      vk_id INTEGER NOT NULL,
      aura INTEGER NOT NULL DEFAULT 0,

      PRIMARY KEY (
        peer_id,
        vk_id
      )
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS aura_cooldowns (
      peer_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      last_given_at INTEGER NOT NULL DEFAULT 0,

      PRIMARY KEY (
        peer_id,
        sender_id
      )
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS balances (
      vk_id INTEGER PRIMARY KEY,
      dollars INTEGER NOT NULL DEFAULT 0
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS game_debts (
      vk_id INTEGER PRIMARY KEY,
      dollars INTEGER NOT NULL DEFAULT 0,

      CHECK (dollars >= 0)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS job_profiles (
      vk_id INTEGER PRIMARY KEY,
      level INTEGER NOT NULL DEFAULT 1,
      experience INTEGER NOT NULL DEFAULT 0,
      completed_shifts INTEGER NOT NULL DEFAULT 0,

      CHECK (level >= 1),
      CHECK (experience >= 0),
      CHECK (completed_shifts >= 0)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS active_jobs (
      vk_id INTEGER PRIMARY KEY,
      peer_id INTEGER NOT NULL,
      job_key TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS magazine_assets (
      vk_id INTEGER NOT NULL,
      item_key TEXT NOT NULL,
      item_type TEXT NOT NULL,
      purchased_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

      PRIMARY KEY (
        vk_id,
        item_key
      )
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS job_boosts (
      vk_id INTEGER PRIMARY KEY,
      quantity INTEGER NOT NULL DEFAULT 0,

      CHECK (quantity >= 0)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_perks (
      vk_id INTEGER NOT NULL,
      perk_key TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      charges INTEGER NOT NULL DEFAULT 0,
      purchased_at INTEGER NOT NULL,

      PRIMARY KEY (
        vk_id,
        perk_key
      ),

      CHECK (expires_at >= 0),
      CHECK (charges >= 0),
      CHECK (purchased_at >= 0)
    );
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS user_perks_active_index
    ON user_perks (perk_key, expires_at);
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tax_accounts (
      vk_id INTEGER NOT NULL,
      tax_key TEXT NOT NULL,
      debt INTEGER NOT NULL DEFAULT 0,
      last_accrued_at INTEGER NOT NULL,
      total_paid INTEGER NOT NULL DEFAULT 0,

      PRIMARY KEY (vk_id, tax_key),

      CHECK (debt >= 0),
      CHECK (last_accrued_at >= 0),
      CHECK (total_paid >= 0)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS treasury (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      balance INTEGER NOT NULL DEFAULT 0,
      total_taxes INTEGER NOT NULL DEFAULT 0,
      total_transfer_commissions INTEGER NOT NULL DEFAULT 0,
      total_bank_commissions INTEGER NOT NULL DEFAULT 0,
      total_loan_repayments INTEGER NOT NULL DEFAULT 0,
      total_loans_issued INTEGER NOT NULL DEFAULT 0,
      total_admin_deposits INTEGER NOT NULL DEFAULT 0,
      total_admin_withdrawals INTEGER NOT NULL DEFAULT 0,
      total_game_losses INTEGER NOT NULL DEFAULT 0,

      CHECK (balance >= 0),
      CHECK (total_taxes >= 0),
      CHECK (total_transfer_commissions >= 0),
      CHECK (total_bank_commissions >= 0),
      CHECK (total_loan_repayments >= 0),
      CHECK (total_loans_issued >= 0),
      CHECK (total_admin_deposits >= 0),
      CHECK (total_admin_withdrawals >= 0),
      CHECK (total_game_losses >= 0)
    );
  `);

  db.run(`
    INSERT OR IGNORE INTO treasury (id)
    VALUES (1);
  `);

  const treasuryColumns = db.prepare(`
    PRAGMA table_info(treasury)
  `);
  let hasTreasuryAdminDeposits = false;
  let hasTreasuryAdminWithdrawals = false;
  let hasTreasuryGameLosses = false;

  while (treasuryColumns.step()) {
    const column = treasuryColumns.getAsObject();

    if (column.name === 'total_admin_deposits') {
      hasTreasuryAdminDeposits = true;
    }

    if (column.name === 'total_admin_withdrawals') {
      hasTreasuryAdminWithdrawals = true;
    }

    if (column.name === 'total_game_losses') {
      hasTreasuryGameLosses = true;
    }
  }

  treasuryColumns.free();

  if (!hasTreasuryAdminDeposits) {
    db.run(`
      ALTER TABLE treasury
      ADD COLUMN total_admin_deposits INTEGER NOT NULL DEFAULT 0;
    `);
  }

  if (!hasTreasuryAdminWithdrawals) {
    db.run(`
      ALTER TABLE treasury
      ADD COLUMN total_admin_withdrawals INTEGER NOT NULL DEFAULT 0;
    `);
  }

  if (!hasTreasuryGameLosses) {
    db.run(`
      ALTER TABLE treasury
      ADD COLUMN total_game_losses INTEGER NOT NULL DEFAULT 0;
    `);
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS treasury_credit_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vk_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      purpose TEXT NOT NULL,
      repayment_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      reviewed_by INTEGER,
      reviewed_at INTEGER,

      CHECK (amount > 0),
      CHECK (status IN ('pending', 'approved', 'rejected'))
    );
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS treasury_credit_pending_index
    ON treasury_credit_requests (vk_id, status);
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS treasury_loans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL UNIQUE,
      vk_id INTEGER NOT NULL,
      principal INTEGER NOT NULL,
      remaining INTEGER NOT NULL,
      repayment_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      approved_at INTEGER NOT NULL,
      repaid_at INTEGER,

      CHECK (principal > 0),
      CHECK (remaining >= 0),
      CHECK (status IN ('active', 'repaid'))
    );
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS treasury_loans_user_index
    ON treasury_loans (vk_id, status);
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS business_states (
      vk_id INTEGER NOT NULL,
      item_key TEXT NOT NULL,
      upgrade_level INTEGER NOT NULL DEFAULT 0,
      stored_income INTEGER NOT NULL DEFAULT 0,
      last_income_at INTEGER NOT NULL,
      total_earned INTEGER NOT NULL DEFAULT 0,

      PRIMARY KEY (
        vk_id,
        item_key
      ),

      CHECK (
        upgrade_level >= 0 AND
        upgrade_level <= 5
      ),
      CHECK (stored_income >= 0),
      CHECK (total_earned >= 0)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS bank_accounts (
      vk_id INTEGER PRIMARY KEY,
      balance INTEGER NOT NULL DEFAULT 0,
      last_interest_at INTEGER NOT NULL,
      interest_remainder INTEGER NOT NULL DEFAULT 0,
      total_interest INTEGER NOT NULL DEFAULT 0,

      CHECK (balance >= 0),
      CHECK (interest_remainder >= 0),
      CHECK (total_interest >= 0)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS promos (
      code TEXT PRIMARY KEY COLLATE NOCASE,
      reward_type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CHECK (
        reward_type IN ('aura', 'dollars')
      ),
      CHECK (amount > 0)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS promo_redemptions (
      code TEXT NOT NULL COLLATE NOCASE,
      vk_id INTEGER NOT NULL,
      redeemed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

      PRIMARY KEY (
        code,
        vk_id
      )
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS quest_stats (
      vk_id INTEGER NOT NULL,
      stat_key TEXT NOT NULL,
      value INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

      PRIMARY KEY (
        vk_id,
        stat_key
      ),

      CHECK (value >= 0)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS quest_claims (
      vk_id INTEGER NOT NULL,
      quest_key TEXT NOT NULL,
      claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

      PRIMARY KEY (
        vk_id,
        quest_key
      )
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS travel_profiles (
      vk_id INTEGER PRIMARY KEY,
      current_country_key TEXT NOT NULL DEFAULT 'russia',
      moved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS country_research (
      vk_id INTEGER NOT NULL,
      country_key TEXT NOT NULL,
      researched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

      PRIMARY KEY (
        vk_id,
        country_key
      )
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS fishing_catches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vk_id INTEGER NOT NULL,
      loot_key TEXT NOT NULL,
      loot_title TEXT NOT NULL,
      weight_grams INTEGER NOT NULL,
      value INTEGER NOT NULL,
      caught_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CHECK (weight_grams > 0),
      CHECK (value > 0)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS beginner_boxes (
      vk_id INTEGER PRIMARY KEY,
      last_opened_at INTEGER NOT NULL,
      opened_count INTEGER NOT NULL DEFAULT 0,
      total_earned INTEGER NOT NULL DEFAULT 0,

      CHECK (last_opened_at >= 0),
      CHECK (opened_count >= 0),
      CHECK (total_earned >= 0)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS farm_profiles (
      vk_id INTEGER PRIMARY KEY,
      plot_count INTEGER NOT NULL DEFAULT 0,
      irrigation_level INTEGER NOT NULL DEFAULT 0,
      soil_level INTEGER NOT NULL DEFAULT 0,
      warehouse_level INTEGER NOT NULL DEFAULT 0,
      next_plant_at INTEGER NOT NULL DEFAULT 0,
      next_harvest_at INTEGER NOT NULL DEFAULT 0,
      total_harvested INTEGER NOT NULL DEFAULT 0,
      total_earned INTEGER NOT NULL DEFAULT 0,

      CHECK (
        plot_count >= 0 AND
        plot_count <= 8
      ),
      CHECK (
        irrigation_level >= 0 AND
        irrigation_level <= 5
      ),
      CHECK (
        soil_level >= 0 AND
        soil_level <= 5
      ),
      CHECK (
        warehouse_level >= 0 AND
        warehouse_level <= 5
      ),
      CHECK (next_plant_at >= 0),
      CHECK (next_harvest_at >= 0),
      CHECK (total_harvested >= 0),
      CHECK (total_earned >= 0)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS farm_seeds (
      vk_id INTEGER NOT NULL,
      crop_key TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,

      PRIMARY KEY (
        vk_id,
        crop_key
      ),

      CHECK (quantity >= 0)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS farm_plots (
      vk_id INTEGER NOT NULL,
      plot_number INTEGER NOT NULL,
      crop_key TEXT NOT NULL,
      seed_quantity INTEGER NOT NULL DEFAULT 1,
      planted_at INTEGER NOT NULL,
      ready_at INTEGER NOT NULL,
      result_code TEXT NOT NULL,
      yield_amount INTEGER NOT NULL DEFAULT 0,
      notified_at INTEGER NOT NULL DEFAULT 0,

      PRIMARY KEY (
        vk_id,
        plot_number
      ),

      CHECK (plot_number >= 1),
      CHECK (seed_quantity >= 1),
      CHECK (ready_at >= planted_at),
      CHECK (
        result_code IN (
          'success',
          'not_sprouted',
          'withered'
        )
      ),
      CHECK (yield_amount >= 0)
    );
  `);

  const farmPlotColumns = db.prepare(`
    PRAGMA table_info(farm_plots)
  `);
  let hasFarmPlotNotifiedAt = false;
  let hasFarmPlotSeedQuantity = false;

  while (farmPlotColumns.step()) {
    const column =
      farmPlotColumns.getAsObject();

    if (column.name === 'notified_at') {
      hasFarmPlotNotifiedAt = true;
    }

    if (column.name === 'seed_quantity') {
      hasFarmPlotSeedQuantity = true;
    }
  }

  farmPlotColumns.free();

  if (!hasFarmPlotNotifiedAt) {
    db.run(`
      ALTER TABLE farm_plots
      ADD COLUMN notified_at INTEGER NOT NULL DEFAULT 0;
    `);
  }

  if (!hasFarmPlotSeedQuantity) {
    db.run(`
      ALTER TABLE farm_plots
      ADD COLUMN seed_quantity INTEGER NOT NULL DEFAULT 1;
    `);
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS farm_storage (
      vk_id INTEGER NOT NULL,
      crop_key TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,

      PRIMARY KEY (
        vk_id,
        crop_key
      ),

      CHECK (quantity >= 0)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS phone_sims (
      vk_id INTEGER PRIMARY KEY,
      phone_number TEXT NOT NULL UNIQUE,
      rarity TEXT NOT NULL,
      purchased_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CHECK (
        rarity IN (
          'standard',
          'pretty',
          'elite'
        )
      )
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS phone_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      caller_vk_id INTEGER NOT NULL,
      receiver_vk_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      accepted_at INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL,

      CHECK (
        status IN (
          'ringing',
          'active'
        )
      ),
      CHECK (caller_vk_id != receiver_vk_id),
      CHECK (created_at >= 0),
      CHECK (accepted_at >= 0),
      CHECK (expires_at >= created_at)
    );
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS phone_calls_caller_index
    ON phone_calls (caller_vk_id);
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS phone_calls_receiver_index
    ON phone_calls (receiver_vk_id);
  `);

  migratePhoneNumbersToSixDigits();

  db.run(`
    CREATE TABLE IF NOT EXISTS loot_case_inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vk_id INTEGER NOT NULL,
      case_key TEXT NOT NULL,
      loot_key TEXT NOT NULL,
      loot_title TEXT NOT NULL,
      rarity TEXT NOT NULL,
      sell_value INTEGER NOT NULL,
      asset_key TEXT,
      asset_type TEXT,
      obtained_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CHECK (
        rarity IN (
          'bad',
          'medium',
          'best',
          'jackpot'
        )
      ),
      CHECK (sell_value > 0)
    );
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS loot_case_inventory_owner_index
    ON loot_case_inventory (vk_id, id);
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS loot_case_stats (
      vk_id INTEGER PRIMARY KEY,
      opened_count INTEGER NOT NULL DEFAULT 0,
      total_spent INTEGER NOT NULL DEFAULT 0,
      total_sold INTEGER NOT NULL DEFAULT 0,
      jackpots INTEGER NOT NULL DEFAULT 0,

      CHECK (opened_count >= 0),
      CHECK (total_spent >= 0),
      CHECK (total_sold >= 0),
      CHECK (jackpots >= 0)
    );
  `);

  db.run(`
    CREATE TRIGGER IF NOT EXISTS quest_balance_peak_insert
    AFTER INSERT ON balances
    BEGIN
      INSERT INTO quest_stats (
        vk_id,
        stat_key,
        value
      )
      VALUES (
        NEW.vk_id,
        'balance_peak',
        MAX(0, NEW.dollars)
      )

      ON CONFLICT(vk_id, stat_key)
      DO UPDATE SET
        value = MAX(value, excluded.value),
        updated_at = CURRENT_TIMESTAMP;
    END;
  `);

  db.run(`
    CREATE TRIGGER IF NOT EXISTS quest_balance_peak_update
    AFTER UPDATE OF dollars ON balances
    BEGIN
      INSERT INTO quest_stats (
        vk_id,
        stat_key,
        value
      )
      VALUES (
        NEW.vk_id,
        'balance_peak',
        MAX(0, NEW.dollars)
      )

      ON CONFLICT(vk_id, stat_key)
      DO UPDATE SET
        value = MAX(value, excluded.value),
        updated_at = CURRENT_TIMESTAMP;
    END;
  `);

  db.run(`
    CREATE TRIGGER IF NOT EXISTS quest_aura_peak_insert
    AFTER INSERT ON aura
    BEGIN
      INSERT INTO quest_stats (
        vk_id,
        stat_key,
        value
      )
      VALUES (
        NEW.vk_id,
        'aura_peak',
        MAX(
          0,
          COALESCE((
            SELECT SUM(aura)
            FROM aura
            WHERE vk_id = NEW.vk_id
          ), 0)
        )
      )

      ON CONFLICT(vk_id, stat_key)
      DO UPDATE SET
        value = MAX(value, excluded.value),
        updated_at = CURRENT_TIMESTAMP;
    END;
  `);

  db.run(`
    CREATE TRIGGER IF NOT EXISTS quest_aura_peak_update
    AFTER UPDATE OF aura ON aura
    BEGIN
      INSERT INTO quest_stats (
        vk_id,
        stat_key,
        value
      )
      VALUES (
        NEW.vk_id,
        'aura_peak',
        MAX(
          0,
          COALESCE((
            SELECT SUM(aura)
            FROM aura
            WHERE vk_id = NEW.vk_id
          ), 0)
        )
      )

      ON CONFLICT(vk_id, stat_key)
      DO UPDATE SET
        value = MAX(value, excluded.value),
        updated_at = CURRENT_TIMESTAMP;
    END;
  `);

  db.run(`
    CREATE TRIGGER IF NOT EXISTS quest_job_started
    AFTER INSERT ON active_jobs
    BEGIN
      INSERT INTO quest_stats (
        vk_id,
        stat_key,
        value
      )
      VALUES (
        NEW.vk_id,
        'jobs_started',
        1
      )

      ON CONFLICT(vk_id, stat_key)
      DO UPDATE SET
        value = value + 1,
        updated_at = CURRENT_TIMESTAMP;
    END;
  `);

  db.run(`
    CREATE TRIGGER IF NOT EXISTS quest_business_bought
    AFTER INSERT ON magazine_assets
    WHEN NEW.item_type = 'businesses'
    BEGIN
      INSERT INTO quest_stats (
        vk_id,
        stat_key,
        value
      )
      VALUES (
        NEW.vk_id,
        'businesses_bought',
        1
      )

      ON CONFLICT(vk_id, stat_key)
      DO UPDATE SET
        value = value + 1,
        updated_at = CURRENT_TIMESTAMP;
    END;
  `);

  db.run(`
    CREATE TRIGGER IF NOT EXISTS quest_villa_bought
    AFTER INSERT ON magazine_assets
    WHEN NEW.item_key = 'house-villa'
    BEGIN
      INSERT INTO quest_stats (
        vk_id,
        stat_key,
        value
      )
      VALUES (
        NEW.vk_id,
        'villas_bought',
        1
      )

      ON CONFLICT(vk_id, stat_key)
      DO UPDATE SET
        value = value + 1,
        updated_at = CURRENT_TIMESTAMP;
    END;
  `);

  persistDatabase();
}

function saveUser(user) {
  ensureDatabase();

  db.run(
    `
      INSERT INTO users (
        vk_id,
        first_name,
        last_name
      )
      VALUES (?, ?, ?)

      ON CONFLICT(vk_id)
      DO UPDATE SET
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        last_seen_at = CURRENT_TIMESTAMP
    `,
    [
      user.vkId,
      user.firstName ?? null,
      user.lastName ?? null
    ]
  );

  persistDatabase();
}

function getUserByVkId(vkId) {
  ensureDatabase();

  const statement = db.prepare(`
    SELECT
      id,
      vk_id,
      first_name,
      last_name,
      created_at,
      last_seen_at
    FROM users
    WHERE vk_id = ?
  `);

  statement.bind([vkId]);

  let user = null;

  if (statement.step()) {
    user = statement.getAsObject();
  }

  statement.free();

  return user;
}

function getUserCount() {
  ensureDatabase();

  const statement = db.prepare(`
    SELECT COUNT(*) AS user_count
    FROM users
    WHERE vk_id > 0
  `);

  let userCount = 0;

  if (statement.step()) {
    const row = statement.getAsObject();

    userCount =
      Number(row.user_count) || 0;
  }

  statement.free();

  return userCount;
}

function getAllUserIds() {
  ensureDatabase();

  const statement = db.prepare(`
    SELECT vk_id
    FROM users
    WHERE vk_id > 0
    ORDER BY id ASC
  `);

  const userIds = [];

  while (statement.step()) {
    const row = statement.getAsObject();
    const vkId = Number(row.vk_id);

    if (Number.isInteger(vkId) && vkId > 0) {
      userIds.push(vkId);
    }
  }

  statement.free();

  return userIds;
}

function getAura(peerId, vkId) {
  ensureDatabase();

  const statement = db.prepare(`
    SELECT aura
    FROM aura
    WHERE peer_id = ?
      AND vk_id = ?
  `);

  statement.bind([
    peerId,
    vkId
  ]);

  let aura = 0;

  if (statement.step()) {
    const row = statement.getAsObject();

    aura = Number(row.aura) || 0;
  }

  statement.free();

  return aura;
}

function getAuraCooldown(peerId, senderId) {
  ensureDatabase();

  const statement = db.prepare(`
    SELECT last_given_at
    FROM aura_cooldowns
    WHERE peer_id = ?
      AND sender_id = ?
  `);

  statement.bind([
    peerId,
    senderId
  ]);

  let lastGivenAt = 0;

  if (statement.step()) {
    const row = statement.getAsObject();

    lastGivenAt =
      Number(row.last_given_at) || 0;
  }

  statement.free();

  return lastGivenAt;
}

function giveAura({
  peerId,
  senderId,
  targetId,
  currentTime
}) {
  ensureDatabase();

  try {
    db.run('BEGIN TRANSACTION;');

    db.run(
      `
        INSERT INTO aura (
          peer_id,
          vk_id,
          aura
        )
        VALUES (?, ?, 1)

        ON CONFLICT(peer_id, vk_id)
        DO UPDATE SET
          aura = aura + 1
      `,
      [
        peerId,
        targetId
      ]
    );

    db.run(
      `
        INSERT INTO aura_cooldowns (
          peer_id,
          sender_id,
          last_given_at
        )
        VALUES (?, ?, ?)

        ON CONFLICT(peer_id, sender_id)
        DO UPDATE SET
          last_given_at = excluded.last_given_at
      `,
      [
        peerId,
        senderId,
        currentTime
      ]
    );

    db.run('COMMIT;');

    persistDatabase();

    return getAura(
      peerId,
      targetId
    );
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function getAuraTop(limit = 10) {
  ensureDatabase();

  const safeLimit = Math.max(
    1,
    Math.min(Number(limit) || 10, 100)
  );

  const statement = db.prepare(`
    SELECT
      vk_id,
      SUM(aura) AS aura
    FROM aura
    GROUP BY vk_id
    ORDER BY
      aura DESC,
      vk_id ASC
    LIMIT ?
  `);

  statement.bind([
    safeLimit
  ]);

  const rows = [];

  while (statement.step()) {
    const row =
      statement.getAsObject();

    rows.push({
      vk_id: Number(row.vk_id),
      aura: Number(row.aura) || 0
    });
  }

  statement.free();

  return rows;
}

function addAuraAmount(
  peerId,
  vkId,
  amount
) {
  ensureDatabase();

  const safeAmount =
    Number(amount);

  if (
    !Number.isInteger(safeAmount) ||
    safeAmount <= 0
  ) {
    throw new Error(
      'Количество ауры должно быть положительным целым числом'
    );
  }

  db.run(
    `
      INSERT INTO aura (
        peer_id,
        vk_id,
        aura
      )
      VALUES (?, ?, ?)

      ON CONFLICT(peer_id, vk_id)
      DO UPDATE SET
        aura = aura + excluded.aura
    `,
    [
      peerId,
      vkId,
      safeAmount
    ]
  );

  persistDatabase();

  return getAura(
    peerId,
    vkId
  );
}


function changeAuraAmount(
  peerId,
  vkId,
  amount
) {
  ensureDatabase();

  const safeAmount =
    Number(amount);

  if (!Number.isInteger(safeAmount)) {
    throw new Error(
      'Изменение ауры должно быть целым числом'
    );
  }

  if (safeAmount === 0) {
    return getAura(
      peerId,
      vkId
    );
  }

  db.run(
    `
      INSERT INTO aura (
        peer_id,
        vk_id,
        aura
      )
      VALUES (?, ?, ?)

      ON CONFLICT(peer_id, vk_id)
      DO UPDATE SET
        aura = aura + excluded.aura
    `,
    [
      peerId,
      vkId,
      safeAmount
    ]
  );

  persistDatabase();

  return getAura(
    peerId,
    vkId
  );
}

function getBalance(vkId) {
  ensureDatabase();

  const safeVkId = Number(vkId);

  if (!Number.isInteger(safeVkId)) {
    throw new Error(
      'VK ID должен быть целым числом'
    );
  }

  const statement = db.prepare(`
    SELECT dollars
    FROM balances
    WHERE vk_id = ?
  `);

  statement.bind([safeVkId]);

  let balance = 0;

  if (statement.step()) {
    const row = statement.getAsObject();

    balance = Number(row.dollars) || 0;
  }

  statement.free();

  return balance;
}

function getBalanceTop(limit = 10) {
  ensureDatabase();

  const safeLimit = Math.max(
    1,
    Math.min(Number(limit) || 10, 100)
  );

  const statement = db.prepare(`
    SELECT
      vk_id,
      dollars
    FROM balances
    WHERE dollars > 0
    ORDER BY
      dollars DESC,
      vk_id ASC
    LIMIT ?
  `);

  statement.bind([safeLimit]);

  const rows = [];

  while (statement.step()) {
    const row =
      statement.getAsObject();

    rows.push({
      vkId: Number(row.vk_id),
      balance: Number(row.dollars) || 0
    });
  }

  statement.free();

  return rows;
}

function changeBalance(vkId, amount) {
  ensureDatabase();

  const safeVkId = Number(vkId);
  const safeAmount = Number(amount);

  if (!Number.isInteger(safeVkId)) {
    throw new Error(
      'VK ID должен быть целым числом'
    );
  }

  if (!Number.isInteger(safeAmount)) {
    throw new Error(
      'Изменение баланса должно быть целым числом'
    );
  }

  if (safeAmount === 0) {
    return getBalance(safeVkId);
  }

  try {
    db.run('BEGIN TRANSACTION;');

    db.run(
      `
        INSERT INTO balances (
          vk_id,
          dollars
        )
        VALUES (?, 0)

        ON CONFLICT(vk_id)
        DO NOTHING
      `,
      [safeVkId]
    );

    db.run(
      `
        UPDATE balances
        SET dollars = MAX(0, dollars + ?)
        WHERE vk_id = ?
      `,
      [
        safeAmount,
        safeVkId
      ]
    );

    db.run('COMMIT;');

    persistDatabase();

    return getBalance(safeVkId);
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function addBalance(vkId, amount) {
  const safeAmount = Number(amount);

  if (
    !Number.isInteger(safeAmount) ||
    safeAmount <= 0
  ) {
    throw new Error(
      'Количество долларов должно быть положительным целым числом'
    );
  }

  return changeBalance(
    vkId,
    safeAmount
  );
}

function removeBalance(vkId, amount) {
  const safeAmount = Number(amount);

  if (
    !Number.isInteger(safeAmount) ||
    safeAmount <= 0
  ) {
    throw new Error(
      'Количество долларов должно быть положительным целым числом'
    );
  }

  const currentBalance =
    getBalance(vkId);

  const removed = Math.min(
    currentBalance,
    safeAmount
  );

  const balance = removed > 0
    ? changeBalance(vkId, -removed)
    : currentBalance;

  return {
    removed,
    balance
  };
}

function validatePerkIdentity(vkId, perkKey) {
  const safeVkId = Number(vkId);
  const safePerkKey = String(
    perkKey ?? ''
  ).trim();

  if (
    !Number.isInteger(safeVkId) ||
    safeVkId <= 0 ||
    !/^[a-z0-9-]+$/.test(safePerkKey)
  ) {
    throw new Error(
      'Некорректные данные перка'
    );
  }

  return {
    safeVkId,
    safePerkKey
  };
}

function getPerkStatus(
  vkId,
  perkKey,
  currentTime = Date.now()
) {
  ensureDatabase();

  const {
    safeVkId,
    safePerkKey
  } = validatePerkIdentity(vkId, perkKey);
  const safeCurrentTime = Number(currentTime);

  if (
    !Number.isSafeInteger(safeCurrentTime) ||
    safeCurrentTime < 0
  ) {
    throw new Error(
      'Некорректное время проверки перка'
    );
  }

  const statement = db.prepare(`
    SELECT
      expires_at,
      charges,
      purchased_at
    FROM user_perks
    WHERE vk_id = ?
      AND perk_key = ?
  `);

  statement.bind([
    safeVkId,
    safePerkKey
  ]);
  let row = null;

  if (statement.step()) {
    row = statement.getAsObject();
  }

  statement.free();

  const expiresAt = Number(
    row?.expires_at
  ) || 0;
  const active = expiresAt > safeCurrentTime;

  return {
    vkId: safeVkId,
    perkKey: safePerkKey,
    active,
    expiresAt,
    remainingMs: active
      ? expiresAt - safeCurrentTime
      : 0,
    charges: active
      ? Math.max(0, Number(row?.charges) || 0)
      : 0,
    purchasedAt:
      Number(row?.purchased_at) || 0
  };
}

function isPerkActive(
  vkId,
  perkKey,
  currentTime = Date.now()
) {
  return getPerkStatus(
    vkId,
    perkKey,
    currentTime
  ).active;
}

function getActivePerkUserIds(
  perkKey,
  currentTime = Date.now()
) {
  ensureDatabase();

  const {
    safePerkKey
  } = validatePerkIdentity(1, perkKey);
  const safeCurrentTime = Number(currentTime);

  if (
    !Number.isSafeInteger(safeCurrentTime) ||
    safeCurrentTime < 0
  ) {
    throw new Error(
      'Некорректное время проверки перков'
    );
  }

  const statement = db.prepare(`
    SELECT vk_id
    FROM user_perks
    WHERE perk_key = ?
      AND expires_at > ?
    ORDER BY vk_id ASC
  `);

  statement.bind([
    safePerkKey,
    safeCurrentTime
  ]);
  const userIds = [];

  while (statement.step()) {
    const row = statement.getAsObject();
    const vkId = Number(row.vk_id);

    if (Number.isInteger(vkId) && vkId > 0) {
      userIds.push(vkId);
    }
  }

  statement.free();

  return userIds;
}

function purchasePerk({
  vkId,
  perkKey,
  price,
  durationMs,
  chargeAmount = 0,
  currentTime = Date.now()
}) {
  ensureDatabase();

  const {
    safeVkId,
    safePerkKey
  } = validatePerkIdentity(vkId, perkKey);
  const safePrice = Number(price);
  const safeDurationMs = Number(durationMs);
  const safeChargeAmount = Number(chargeAmount);
  const safeCurrentTime = Number(currentTime);

  if (
    !Number.isSafeInteger(safePrice) ||
    safePrice <= 0 ||
    !Number.isSafeInteger(safeDurationMs) ||
    safeDurationMs <= 0 ||
    !Number.isSafeInteger(safeChargeAmount) ||
    safeChargeAmount < 0 ||
    !Number.isSafeInteger(safeCurrentTime) ||
    safeCurrentTime < 0
  ) {
    throw new Error(
      'Некорректные параметры покупки перка'
    );
  }

  const current = getPerkStatus(
    safeVkId,
    safePerkKey,
    safeCurrentTime
  );

  if (current.active) {
    return {
      status: 'already_active',
      perkKey: safePerkKey,
      expiresAt: current.expiresAt,
      remainingMs: current.remainingMs,
      charges: current.charges,
      balance: getBalance(safeVkId)
    };
  }

  const balance = getBalance(safeVkId);

  if (balance < safePrice) {
    return {
      status: 'insufficient_funds',
      price: safePrice,
      balance,
      missing: safePrice - balance
    };
  }

  const expiresAt =
    safeCurrentTime + safeDurationMs;
  const charges = safeChargeAmount;

  try {
    db.run('BEGIN TRANSACTION;');

    db.run(
      `
        UPDATE balances
        SET dollars = dollars - ?
        WHERE vk_id = ?
          AND dollars >= ?
      `,
      [
        safePrice,
        safeVkId,
        safePrice
      ]
    );

    db.run(
      `
        INSERT INTO user_perks (
          vk_id,
          perk_key,
          expires_at,
          charges,
          purchased_at
        )
        VALUES (?, ?, ?, ?, ?)

        ON CONFLICT(vk_id, perk_key)
        DO UPDATE SET
          expires_at = excluded.expires_at,
          charges = excluded.charges,
          purchased_at = excluded.purchased_at
      `,
      [
        safeVkId,
        safePerkKey,
        expiresAt,
        charges,
        safeCurrentTime
      ]
    );

    db.run('COMMIT;');
    persistDatabase();

    return {
      status: 'purchased',
      perkKey: safePerkKey,
      price: safePrice,
      balance: balance - safePrice,
      expiresAt,
      remainingMs: expiresAt - safeCurrentTime,
      charges
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function consumePerkCharges({
  vkId,
  perkKey,
  amount = 1,
  currentTime = Date.now()
}) {
  ensureDatabase();

  const {
    safeVkId,
    safePerkKey
  } = validatePerkIdentity(vkId, perkKey);
  const safeAmount = Number(amount);
  const safeCurrentTime = Number(currentTime);

  if (
    !Number.isSafeInteger(safeAmount) ||
    safeAmount <= 0 ||
    !Number.isSafeInteger(safeCurrentTime) ||
    safeCurrentTime < 0
  ) {
    throw new Error(
      'Некорректное списание заряда перка'
    );
  }

  const status = getPerkStatus(
    safeVkId,
    safePerkKey,
    safeCurrentTime
  );

  if (!status.active) {
    return {
      status: 'inactive',
      charges: 0
    };
  }

  if (status.charges < safeAmount) {
    return {
      status: 'insufficient_charges',
      charges: status.charges
    };
  }

  const charges = status.charges - safeAmount;

  db.run(
    `
      UPDATE user_perks
      SET charges = ?
      WHERE vk_id = ?
        AND perk_key = ?
    `,
    [
      charges,
      safeVkId,
      safePerkKey
    ]
  );

  persistDatabase();

  return {
    status: 'consumed',
    amount: safeAmount,
    charges
  };
}

function validateTaxIdentity(vkId, taxKey) {
  const safeVkId = Number(vkId);
  const safeTaxKey = String(taxKey ?? '').trim();

  if (
    !Number.isInteger(safeVkId) ||
    safeVkId <= 0 ||
    !/^[a-z][a-z-]{1,31}$/.test(safeTaxKey)
  ) {
    throw new Error('Некорректные данны налога');
  }

  return { safeVkId, safeTaxKey };
}

function getTaxAccount(
  vkId,
  taxKey,
  currentTime = Date.now()
) {
  ensureDatabase();

  const { safeVkId, safeTaxKey } =
    validateTaxIdentity(vkId, taxKey);
  const safeCurrentTime = Number(currentTime);

  if (
    !Number.isSafeInteger(safeCurrentTime) ||
    safeCurrentTime < 0
  ) {
    throw new Error('Некорректное время налога');
  }

  let statement = db.prepare(`
    SELECT debt, last_accrued_at, total_paid
    FROM tax_accounts
    WHERE vk_id = ? AND tax_key = ?
  `);
  statement.bind([safeVkId, safeTaxKey]);
  let account = null;

  if (statement.step()) {
    const row = statement.getAsObject();
    account = {
      vkId: safeVkId,
      taxKey: safeTaxKey,
      debt: Number(row.debt) || 0,
      lastAccruedAt:
        Number(row.last_accrued_at) || safeCurrentTime,
      totalPaid: Number(row.total_paid) || 0
    };
  }

  statement.free();

  if (account) {
    return account;
  }

  db.run(
    `
      INSERT INTO tax_accounts (
        vk_id, tax_key, last_accrued_at
      ) VALUES (?, ?, ?)
    `,
    [safeVkId, safeTaxKey, safeCurrentTime]
  );
  persistDatabase();

  return {
    vkId: safeVkId,
    taxKey: safeTaxKey,
    debt: 0,
    lastAccruedAt: safeCurrentTime,
    totalPaid: 0
  };
}

function accrueTaxDebt({
  vkId,
  taxKey,
  periodAmount,
  periodMs = DAY_MS,
  maxAccrualPeriods = 3,
  currentTime = Date.now()
}) {
  const safePeriodAmount = Number(periodAmount);
  const safePeriodMs = Number(periodMs);
  const safeMaxPeriods = Number(maxAccrualPeriods);
  const safeCurrentTime = Number(currentTime);

  if (
    !Number.isSafeInteger(safePeriodAmount) ||
    safePeriodAmount < 0 ||
    !Number.isSafeInteger(safePeriodMs) ||
    safePeriodMs <= 0 ||
    !Number.isInteger(safeMaxPeriods) ||
    safeMaxPeriods < 1 ||
    !Number.isSafeInteger(safeCurrentTime) ||
    safeCurrentTime < 0
  ) {
    throw new Error('Некорректное начисление налога');
  }

  const account = getTaxAccount(
    vkId,
    taxKey,
    safeCurrentTime
  );
  const elapsedPeriods = Math.floor(
    Math.max(
      0,
      safeCurrentTime - account.lastAccruedAt
    ) / safePeriodMs
  );

  if (elapsedPeriods <= 0) {
    return {
      ...account,
      periodAmount: safePeriodAmount,
      accruedNow: 0,
      elapsedPeriods: 0
    };
  }

  const rawAccrual =
    safePeriodAmount * elapsedPeriods;

  if (!Number.isSafeInteger(rawAccrual)) {
    throw new Error('Налог превышает технический лимит');
  }

  const maximumDebt = Math.max(
    account.debt,
    safePeriodAmount * safeMaxPeriods
  );
  const debt = Math.min(
    maximumDebt,
    account.debt + rawAccrual
  );
  const accruedNow = debt - account.debt;
  const lastAccruedAt =
    account.lastAccruedAt +
    elapsedPeriods * safePeriodMs;

  db.run(
    `
      UPDATE tax_accounts
      SET debt = ?, last_accrued_at = ?
      WHERE vk_id = ? AND tax_key = ?
    `,
    [debt, lastAccruedAt, account.vkId, account.taxKey]
  );
  persistDatabase();

  return {
    ...account,
    debt,
    lastAccruedAt,
    periodAmount: safePeriodAmount,
    accruedNow,
    elapsedPeriods
  };
}

const TREASURY_SOURCE_COLUMNS = Object.freeze({
  taxes: 'total_taxes',
  transferCommission: 'total_transfer_commissions',
  bankCommission: 'total_bank_commissions',
  loanRepayment: 'total_loan_repayments',
  gameLoss: 'total_game_losses'
});

function creditTreasuryInternal(amount, source) {
  const safeAmount = Number(amount);
  const column = TREASURY_SOURCE_COLUMNS[source];

  if (
    !column ||
    !Number.isSafeInteger(safeAmount) ||
    safeAmount < 0
  ) {
    throw new Error('Некорректное пополнение казны');
  }

  if (safeAmount === 0) {
    return;
  }

  db.run(
    `
      UPDATE treasury
      SET balance = balance + ?, ${column} = ${column} + ?
      WHERE id = 1
    `,
    [safeAmount, safeAmount]
  );
}

function getTreasuryState() {
  ensureDatabase();

  const statement = db.prepare(`
    SELECT
      balance,
      total_taxes,
      total_transfer_commissions,
      total_bank_commissions,
      total_loan_repayments,
      total_loans_issued,
      total_admin_deposits,
      total_admin_withdrawals,
      total_game_losses
    FROM treasury
    WHERE id = 1
  `);
  let result = null;

  if (statement.step()) {
    const row = statement.getAsObject();
    result = {
      balance: Number(row.balance) || 0,
      totalTaxes: Number(row.total_taxes) || 0,
      totalTransferCommissions:
        Number(row.total_transfer_commissions) || 0,
      totalBankCommissions:
        Number(row.total_bank_commissions) || 0,
      totalLoanRepayments:
        Number(row.total_loan_repayments) || 0,
      totalLoansIssued:
        Number(row.total_loans_issued) || 0,
      totalAdminDeposits:
        Number(row.total_admin_deposits) || 0,
      totalAdminWithdrawals:
        Number(row.total_admin_withdrawals) || 0,
      totalGameLosses:
        Number(row.total_game_losses) || 0
    };
  }

  statement.free();

  return result ?? {
    balance: 0,
    totalTaxes: 0,
    totalTransferCommissions: 0,
    totalBankCommissions: 0,
    totalLoanRepayments: 0,
    totalLoansIssued: 0,
    totalAdminDeposits: 0,
    totalAdminWithdrawals: 0,
    totalGameLosses: 0
  };
}

function recordTreasuryGameLoss(amount) {
  ensureDatabase();
  const safeAmount = Number(amount);

  if (
    !Number.isSafeInteger(safeAmount) ||
    safeAmount < 0
  ) {
    throw new Error('Некорректный проигрыш для казны');
  }

  if (safeAmount === 0) {
    return getTreasuryState();
  }

  const treasury = getTreasuryState();

  if (
    treasury.balance >
    Number.MAX_SAFE_INTEGER - safeAmount
  ) {
    return {
      ...treasury,
      status: 'treasury_limit'
    };
  }

  creditTreasuryInternal(
    safeAmount,
    'gameLoss'
  );
  persistDatabase();

  return {
    ...getTreasuryState(),
    status: 'credited',
    amount: safeAmount
  };
}

function adjustTreasuryBalance({
  adminId,
  amount,
  operation
}) {
  ensureDatabase();
  const safeAdminId = Number(adminId);
  const safeAmount = Number(amount);
  const safeOperation = String(operation ?? '').trim();

  if (
    !Number.isInteger(safeAdminId) ||
    safeAdminId <= 0 ||
    !Number.isSafeInteger(safeAmount) ||
    safeAmount <= 0 ||
    !['deposit', 'withdraw'].includes(safeOperation)
  ) {
    throw new Error('Некорректное изменение казны');
  }

  const treasury = getTreasuryState();

  if (safeOperation === 'deposit') {
    if (
      treasury.balance >
      Number.MAX_SAFE_INTEGER - safeAmount
    ) {
      return { status: 'treasury_limit' };
    }

    db.run(
      `
        UPDATE treasury
        SET balance = balance + ?,
            total_admin_deposits = total_admin_deposits + ?
        WHERE id = 1
      `,
      [safeAmount, safeAmount]
    );
    persistDatabase();

    return {
      status: 'deposited',
      amount: safeAmount,
      treasuryBalance: treasury.balance + safeAmount
    };
  }

  if (treasury.balance < safeAmount) {
    return {
      status: 'insufficient_treasury',
      treasuryBalance: treasury.balance,
      missing: safeAmount - treasury.balance
    };
  }

  const adminBalance = getBalance(safeAdminId);

  if (
    adminBalance >
    Number.MAX_SAFE_INTEGER - safeAmount
  ) {
    return { status: 'admin_balance_limit' };
  }

  try {
    db.run('BEGIN TRANSACTION;');
    db.run(
      `
        UPDATE treasury
        SET balance = balance - ?,
            total_admin_withdrawals = total_admin_withdrawals + ?
        WHERE id = 1
      `,
      [safeAmount, safeAmount]
    );
    db.run(
      `
        INSERT INTO balances (vk_id, dollars)
        VALUES (?, ?)
        ON CONFLICT(vk_id)
        DO UPDATE SET dollars = dollars + excluded.dollars
      `,
      [safeAdminId, safeAmount]
    );
    db.run('COMMIT;');
    persistDatabase();

    return {
      status: 'withdrawn',
      amount: safeAmount,
      treasuryBalance: treasury.balance - safeAmount,
      adminBalance: adminBalance + safeAmount
    };
  } catch (error) {
    try { db.run('ROLLBACK;'); } catch {}
    throw error;
  }
}

function payTaxDebts({ vkId, taxKeys }) {
  ensureDatabase();

  const safeVkId = Number(vkId);
  const keys = [...new Set(
    (Array.isArray(taxKeys) ? taxKeys : [])
      .map(value => String(value ?? '').trim())
  )];

  if (
    !Number.isInteger(safeVkId) ||
    safeVkId <= 0 ||
    keys.length === 0
  ) {
    throw new Error('Некорректная оплата налогов');
  }

  const debts = keys.map(taxKey =>
    getTaxAccount(safeVkId, taxKey)
  );
  const amount = debts.reduce(
    (total, item) => total + item.debt,
    0
  );

  if (!Number.isSafeInteger(amount)) {
    throw new Error('Долг по налогам слишком велик');
  }

  if (amount <= 0) {
    return {
      status: 'nothing_due',
      amount: 0,
      balance: getBalance(safeVkId)
    };
  }

  const balance = getBalance(safeVkId);

  if (balance < amount) {
    return {
      status: 'insufficient_funds',
      amount,
      balance,
      missing: amount - balance
    };
  }

  try {
    db.run('BEGIN TRANSACTION;');
    db.run(
      'UPDATE balances SET dollars = dollars - ? WHERE vk_id = ?',
      [amount, safeVkId]
    );

    for (const item of debts) {
      db.run(
        `
          UPDATE tax_accounts
          SET debt = 0, total_paid = total_paid + ?
          WHERE vk_id = ? AND tax_key = ?
        `,
        [item.debt, safeVkId, item.taxKey]
      );
    }

    creditTreasuryInternal(amount, 'taxes');
    db.run('COMMIT;');
    persistDatabase();

    return {
      status: 'paid',
      amount,
      balance: balance - amount,
      treasuryBalance: getTreasuryState().balance,
      paid: Object.fromEntries(
        debts.map(item => [item.taxKey, item.debt])
      )
    };
  } catch (error) {
    try { db.run('ROLLBACK;'); } catch {}
    throw error;
  }
}

function getPendingCreditRequest(vkId) {
  ensureDatabase();
  const safeVkId = Number(vkId);
  const statement = db.prepare(`
    SELECT id, vk_id, amount, purpose, repayment_text, status, created_at
    FROM treasury_credit_requests
    WHERE vk_id = ? AND status = 'pending'
    ORDER BY id DESC LIMIT 1
  `);
  statement.bind([safeVkId]);
  let result = null;

  if (statement.step()) {
    const row = statement.getAsObject();
    result = {
      id: Number(row.id),
      vkId: Number(row.vk_id),
      amount: Number(row.amount),
      purpose: String(row.purpose),
      repaymentText: String(row.repayment_text),
      status: String(row.status),
      createdAt: Number(row.created_at)
    };
  }

  statement.free();
  return result;
}

function getActiveTreasuryLoan(vkId) {
  ensureDatabase();
  const safeVkId = Number(vkId);
  const statement = db.prepare(`
    SELECT id, request_id, vk_id, principal, remaining,
           repayment_text, status, approved_at
    FROM treasury_loans
    WHERE vk_id = ? AND status = 'active'
    ORDER BY id ASC LIMIT 1
  `);
  statement.bind([safeVkId]);
  let result = null;

  if (statement.step()) {
    const row = statement.getAsObject();
    result = {
      id: Number(row.id),
      requestId: Number(row.request_id),
      vkId: Number(row.vk_id),
      principal: Number(row.principal),
      remaining: Number(row.remaining),
      repaymentText: String(row.repayment_text),
      status: String(row.status),
      approvedAt: Number(row.approved_at)
    };
  }

  statement.free();
  return result;
}

function createTreasuryCreditRequest({
  vkId,
  amount,
  purpose,
  repaymentText,
  currentTime = Date.now()
}) {
  ensureDatabase();
  const safeVkId = Number(vkId);
  const safeAmount = Number(amount);
  const safePurpose = String(purpose ?? '').trim();
  const safeRepayment = String(repaymentText ?? '').trim();
  const safeCurrentTime = Number(currentTime);

  if (
    !Number.isInteger(safeVkId) || safeVkId <= 0 ||
    !Number.isSafeInteger(safeAmount) || safeAmount <= 0 ||
    safePurpose.length < 3 || safePurpose.length > 500 ||
    safeRepayment.length < 2 || safeRepayment.length > 100 ||
    !Number.isSafeInteger(safeCurrentTime)
  ) {
    throw new Error('Некорректная заявка на кредит');
  }

  const profile = getJobProfile(safeVkId);

  if (profile.level < 5) {
    return {
      status: 'level_required',
      currentLevel: profile.level,
      requiredLevel: 5
    };
  }

  const pending = getPendingCreditRequest(safeVkId);
  if (pending) {
    return { status: 'pending_exists', request: pending };
  }

  const loan = getActiveTreasuryLoan(safeVkId);
  if (loan) {
    return { status: 'active_loan', loan };
  }

  db.run(
    `
      INSERT INTO treasury_credit_requests (
        vk_id, amount, purpose, repayment_text, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `,
    [safeVkId, safeAmount, safePurpose, safeRepayment, safeCurrentTime]
  );
  const statement = db.prepare(
    'SELECT last_insert_rowid() AS id'
  );
  statement.step();
  const id = Number(statement.getAsObject().id);
  statement.free();
  persistDatabase();

  return {
    status: 'created',
    request: {
      id,
      vkId: safeVkId,
      amount: safeAmount,
      purpose: safePurpose,
      repaymentText: safeRepayment,
      createdAt: safeCurrentTime,
      status: 'pending'
    }
  };
}

function getTreasuryCreditRequest(requestId) {
  ensureDatabase();
  const safeId = Number(requestId);
  const statement = db.prepare(`
    SELECT id, vk_id, amount, purpose, repayment_text, status,
           created_at, reviewed_by, reviewed_at
    FROM treasury_credit_requests
    WHERE id = ?
  `);
  statement.bind([safeId]);
  let result = null;

  if (statement.step()) {
    const row = statement.getAsObject();
    result = {
      id: Number(row.id),
      vkId: Number(row.vk_id),
      amount: Number(row.amount),
      purpose: String(row.purpose),
      repaymentText: String(row.repayment_text),
      status: String(row.status),
      createdAt: Number(row.created_at),
      reviewedBy: row.reviewed_by == null
        ? null : Number(row.reviewed_by),
      reviewedAt: row.reviewed_at == null
        ? null : Number(row.reviewed_at)
    };
  }

  statement.free();
  return result;
}

function decideTreasuryCreditRequest({
  requestId,
  adminId,
  approved,
  currentTime = Date.now()
}) {
  ensureDatabase();
  const request = getTreasuryCreditRequest(requestId);
  const safeAdminId = Number(adminId);
  const safeCurrentTime = Number(currentTime);

  if (!request) return { status: 'not_found' };
  if (request.status !== 'pending') {
    return { status: 'already_reviewed', request };
  }

  if (!approved) {
    db.run(
      `
        UPDATE treasury_credit_requests
        SET status = 'rejected', reviewed_by = ?, reviewed_at = ?
        WHERE id = ? AND status = 'pending'
      `,
      [safeAdminId, safeCurrentTime, request.id]
    );
    persistDatabase();
    return { status: 'rejected', request: { ...request, status: 'rejected' } };
  }

  const borrowerProfile = getJobProfile(
    request.vkId
  );

  if (borrowerProfile.level < 5) {
    return {
      status: 'borrower_level_required',
      request,
      currentLevel: borrowerProfile.level,
      requiredLevel: 5
    };
  }

  const treasury = getTreasuryState();
  if (treasury.balance < request.amount) {
    return {
      status: 'treasury_insufficient',
      request,
      treasuryBalance: treasury.balance,
      missing: request.amount - treasury.balance
    };
  }

  const userBalance = getBalance(request.vkId);
  if (userBalance > Number.MAX_SAFE_INTEGER - request.amount) {
    return { status: 'user_balance_limit', request };
  }

  try {
    db.run('BEGIN TRANSACTION;');
    db.run(
      `
        UPDATE treasury_credit_requests
        SET status = 'approved', reviewed_by = ?, reviewed_at = ?
        WHERE id = ? AND status = 'pending'
      `,
      [safeAdminId, safeCurrentTime, request.id]
    );
    db.run(
      `
        UPDATE treasury
        SET balance = balance - ?,
            total_loans_issued = total_loans_issued + ?
        WHERE id = 1
      `,
      [request.amount, request.amount]
    );
    db.run(
      `
        INSERT INTO balances (vk_id, dollars)
        VALUES (?, ?)
        ON CONFLICT(vk_id)
        DO UPDATE SET dollars = dollars + excluded.dollars
      `,
      [request.vkId, request.amount]
    );
    db.run(
      `
        INSERT INTO treasury_loans (
          request_id, vk_id, principal, remaining,
          repayment_text, approved_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        request.id, request.vkId, request.amount,
        request.amount, request.repaymentText, safeCurrentTime
      ]
    );
    db.run('COMMIT;');
    persistDatabase();
    return {
      status: 'approved',
      request: { ...request, status: 'approved' },
      treasuryBalance: treasury.balance - request.amount,
      userBalance: userBalance + request.amount
    };
  } catch (error) {
    try { db.run('ROLLBACK;'); } catch {}
    throw error;
  }
}

function repayTreasuryLoan({ vkId, amount }) {
  ensureDatabase();
  const safeVkId = Number(vkId);
  const loan = getActiveTreasuryLoan(safeVkId);

  if (!loan) return { status: 'no_active_loan' };

  const requested = amount === 'all'
    ? loan.remaining
    : Number(amount);

  if (!Number.isSafeInteger(requested) || requested <= 0) {
    throw new Error('Некорректная сумма погашения');
  }

  const payment = Math.min(requested, loan.remaining);
  const balance = getBalance(safeVkId);

  if (balance < payment) {
    return {
      status: 'insufficient_funds',
      payment,
      balance,
      missing: payment - balance,
      loan
    };
  }

  const remaining = loan.remaining - payment;

  try {
    db.run('BEGIN TRANSACTION;');
    db.run(
      'UPDATE balances SET dollars = dollars - ? WHERE vk_id = ?',
      [payment, safeVkId]
    );
    db.run(
      `
        UPDATE treasury_loans
        SET remaining = ?, status = ?, repaid_at = ?
        WHERE id = ?
      `,
      [
        remaining,
        remaining === 0 ? 'repaid' : 'active',
        remaining === 0 ? Date.now() : null,
        loan.id
      ]
    );
    creditTreasuryInternal(payment, 'loanRepayment');
    db.run('COMMIT;');
    persistDatabase();
    return {
      status: remaining === 0 ? 'repaid' : 'partially_repaid',
      payment,
      remaining,
      balance: balance - payment,
      treasuryBalance: getTreasuryState().balance
    };
  } catch (error) {
    try { db.run('ROLLBACK;'); } catch {}
    throw error;
  }
}

function getMoscowDay(currentTime) {
  const safeCurrentTime = Number(currentTime);

  if (
    !Number.isFinite(safeCurrentTime) ||
    safeCurrentTime < 0
  ) {
    throw new Error(
      'Некорректное время операции'
    );
  }

  return Math.floor(
    (safeCurrentTime + MOSCOW_UTC_OFFSET_MS) /
    DAY_MS
  );
}

function getDailyTransferUsage(
  vkId,
  currentTime = Date.now()
) {
  ensureDatabase();

  const safeVkId = Number(vkId);

  if (
    !Number.isInteger(safeVkId) ||
    safeVkId <= 0
  ) {
    throw new Error(
      'VK ID должен быть положительным целым числом'
    );
  }

  const day = getMoscowDay(
    currentTime
  );
  const storedDay = getQuestStat(
    safeVkId,
    TRANSFER_DAY_STAT_KEY
  );
  const storedAmount = getQuestStat(
    safeVkId,
    TRANSFER_AMOUNT_STAT_KEY
  );
  const used = storedDay === day
    ? Math.min(
      TRANSFER_DAILY_LIMIT,
      storedAmount
    )
    : 0;

  return {
    day,
    limit: TRANSFER_DAILY_LIMIT,
    used,
    remaining:
      TRANSFER_DAILY_LIMIT - used,
    resetAt:
      (day + 1) * DAY_MS -
      MOSCOW_UTC_OFFSET_MS
  };
}

function transferBalance({
  senderId,
  recipientId,
  amount,
  enforceDailyLimit = false,
  currentTime = Date.now()
}) {
  ensureDatabase();

  const safeSenderId = Number(senderId);
  const safeRecipientId = Number(recipientId);
  const safeAmount = Number(amount);

  if (
    !Number.isInteger(safeSenderId) ||
    !Number.isInteger(safeRecipientId) ||
    safeSenderId <= 0 ||
    safeRecipientId <= 0
  ) {
    throw new Error(
      'VK ID отправителя и получателя должны быть положительными целыми числами'
    );
  }

  if (safeSenderId === safeRecipientId) {
    return {
      status: 'same_user'
    };
  }

  if (
    !Number.isSafeInteger(safeAmount) ||
    safeAmount <= 0
  ) {
    throw new Error(
      'Сумма перевода должна быть положительным целым числом'
    );
  }

  const senderBalance =
    getBalance(safeSenderId);

  if (senderBalance < safeAmount) {
    return {
      status: 'insufficient_funds',
      amount: safeAmount,
      balance: senderBalance,
      missing: safeAmount - senderBalance
    };
  }

  const dailyTransfer = enforceDailyLimit
    ? getDailyTransferUsage(
      safeSenderId,
      currentTime
    )
    : null;
  const vipActive = isPerkActive(
    safeSenderId,
    'vip-card',
    currentTime
  );
  const commissionBps = (
    !enforceDailyLimit ||
    vipActive
  )
    ? 0
    : TRANSFER_COMMISSION_BPS;
  const commission = Math.floor(
    safeAmount * commissionBps / 10_000
  );
  const payout = safeAmount - commission;

  if (
    dailyTransfer &&
    safeAmount > dailyTransfer.remaining
  ) {
    return {
      status: 'daily_limit',
      amount: safeAmount,
      ...dailyTransfer
    };
  }

  const recipientBalance =
    getBalance(safeRecipientId);

  if (
    recipientBalance >
    Number.MAX_SAFE_INTEGER - payout
  ) {
    return {
      status: 'recipient_limit'
    };
  }

  try {
    db.run('BEGIN TRANSACTION;');

    db.run(
      `
        UPDATE balances
        SET dollars = dollars - ?
        WHERE vk_id = ?
          AND dollars >= ?
      `,
      [
        safeAmount,
        safeSenderId,
        safeAmount
      ]
    );

    db.run(
      `
        INSERT INTO balances (
          vk_id,
          dollars
        )
        VALUES (?, ?)

        ON CONFLICT(vk_id)
        DO UPDATE SET
          dollars = dollars + excluded.dollars
      `,
      [
        safeRecipientId,
        payout
      ]
    );

    creditTreasuryInternal(
      commission,
      'transferCommission'
    );

    if (dailyTransfer) {
      const newDailyAmount =
        dailyTransfer.used + safeAmount;

      db.run(
        `
          INSERT INTO quest_stats (
            vk_id,
            stat_key,
            value
          )
          VALUES (?, ?, ?)

          ON CONFLICT(vk_id, stat_key)
          DO UPDATE SET
            value = excluded.value,
            updated_at = CURRENT_TIMESTAMP
        `,
        [
          safeSenderId,
          TRANSFER_DAY_STAT_KEY,
          dailyTransfer.day
        ]
      );

      db.run(
        `
          INSERT INTO quest_stats (
            vk_id,
            stat_key,
            value
          )
          VALUES (?, ?, ?)

          ON CONFLICT(vk_id, stat_key)
          DO UPDATE SET
            value = excluded.value,
            updated_at = CURRENT_TIMESTAMP
        `,
        [
          safeSenderId,
          TRANSFER_AMOUNT_STAT_KEY,
          newDailyAmount
        ]
      );
    }

    db.run('COMMIT;');

    persistDatabase();

    return {
      status: 'transferred',
      amount: safeAmount,
      commission,
      commissionBps,
      payout,
      vipActive,
      senderBalance:
        senderBalance - safeAmount,
      recipientBalance:
        recipientBalance + payout,
      ...(dailyTransfer
        ? {
          dailyLimit: dailyTransfer.limit,
          dailyTransferred:
            dailyTransfer.used + safeAmount,
          dailyRemaining:
            dailyTransfer.remaining - safeAmount,
          dailyResetAt:
            dailyTransfer.resetAt
        }
        : {})
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function setBalance(vkId, amount) {
  const safeAmount = Number(amount);

  if (
    !Number.isInteger(safeAmount) ||
    safeAmount < 0
  ) {
    throw new Error(
      'Баланс должен быть неотрицательным целым числом'
    );
  }

  const currentBalance =
    getBalance(vkId);

  return changeBalance(
    vkId,
    safeAmount - currentBalance
  );
}

function resetBalance(vkId) {
  return setBalance(vkId, 0);
}

function getGameDebt(vkId) {
  ensureDatabase();

  const safeVkId = Number(vkId);

  if (!Number.isInteger(safeVkId)) {
    throw new Error(
      'VK ID должен быть целым числом'
    );
  }

  const statement = db.prepare(`
    SELECT dollars
    FROM game_debts
    WHERE vk_id = ?
  `);

  statement.bind([safeVkId]);

  let debt = 0;

  if (statement.step()) {
    const row = statement.getAsObject();

    debt = Number(row.dollars) || 0;
  }

  statement.free();

  return debt;
}

function applyGamePenalty(vkId, amount) {
  ensureDatabase();

  const safeVkId = Number(vkId);
  const safeAmount = Number(amount);

  if (!Number.isInteger(safeVkId)) {
    throw new Error(
      'VK ID должен быть целым числом'
    );
  }

  if (
    !Number.isInteger(safeAmount) ||
    safeAmount <= 0
  ) {
    throw new Error(
      'Игровой штраф должен быть положительным целым числом'
    );
  }

  const currentBalance =
    getBalance(safeVkId);

  const currentDebt =
    getGameDebt(safeVkId);

  const paid = Math.min(
    currentBalance,
    safeAmount
  );

  const shortfall =
    safeAmount - paid;

  const debtCapacity = Math.max(
    0,
    GAME_DEBT_LIMIT - currentDebt
  );

  const debtAdded = Math.min(
    shortfall,
    debtCapacity
  );

  const uncollected =
    shortfall - debtAdded;

  try {
    db.run('BEGIN TRANSACTION;');

    if (paid > 0) {
      db.run(
        `
          UPDATE balances
          SET dollars = dollars - ?
          WHERE vk_id = ?
        `,
        [
          paid,
          safeVkId
        ]
      );
    }

    if (debtAdded > 0) {
      db.run(
        `
          INSERT INTO game_debts (
            vk_id,
            dollars
          )
          VALUES (?, ?)

          ON CONFLICT(vk_id)
          DO UPDATE SET
            dollars = dollars + excluded.dollars
        `,
        [
          safeVkId,
          debtAdded
        ]
      );
    }

    db.run('COMMIT;');

    persistDatabase();

    return {
      penalty: safeAmount,
      paid,
      debtAdded,
      uncollected,
      balance:
        currentBalance - paid,
      debt:
        currentDebt + debtAdded,
      debtLimit: GAME_DEBT_LIMIT
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function applyGameReward(vkId, amount) {
  ensureDatabase();

  const safeVkId = Number(vkId);
  const safeAmount = Number(amount);

  if (!Number.isInteger(safeVkId)) {
    throw new Error(
      'VK ID должен быть целым числом'
    );
  }

  if (
    !Number.isInteger(safeAmount) ||
    safeAmount <= 0
  ) {
    throw new Error(
      'Игровая награда должна быть положительным целым числом'
    );
  }

  const currentDebt =
    getGameDebt(safeVkId);

  const currentBalance =
    getBalance(safeVkId);

  const debtPaid = Math.min(
    currentDebt,
    safeAmount
  );

  const credited =
    safeAmount - debtPaid;

  try {
    db.run('BEGIN TRANSACTION;');

    if (debtPaid > 0) {
      const remainingDebt =
        currentDebt - debtPaid;

      if (remainingDebt > 0) {
        db.run(
          `
            UPDATE game_debts
            SET dollars = ?
            WHERE vk_id = ?
          `,
          [
            remainingDebt,
            safeVkId
          ]
        );
      } else {
        db.run(
          `
            DELETE FROM game_debts
            WHERE vk_id = ?
          `,
          [safeVkId]
        );
      }
    }

    if (credited > 0) {
      db.run(
        `
          INSERT INTO balances (
            vk_id,
            dollars
          )
          VALUES (?, ?)

          ON CONFLICT(vk_id)
          DO UPDATE SET
            dollars = dollars + excluded.dollars
        `,
        [
          safeVkId,
          credited
        ]
      );
    }

    db.run('COMMIT;');

    persistDatabase();

    return {
      reward: safeAmount,
      debtPaid,
      credited,
      balance:
        currentBalance + credited,
      debt:
        currentDebt - debtPaid
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function getJobProfile(vkId) {
  ensureDatabase();

  const safeVkId = Number(vkId);

  if (!Number.isInteger(safeVkId)) {
    throw new Error(
      'VK ID должен быть целым числом'
    );
  }

  const statement = db.prepare(`
    SELECT
      level,
      experience,
      completed_shifts
    FROM job_profiles
    WHERE vk_id = ?
  `);

  statement.bind([safeVkId]);

  let profile = {
    level: 1,
    experience: 0,
    completedShifts: 0
  };

  if (statement.step()) {
    const row =
      statement.getAsObject();

    profile = {
      level: Math.min(
        JOB_MAX_LEVEL,
        Math.max(
          1,
          Number(row.level) || 1
        )
      ),
      experience:
        Number(row.experience) || 0,
      completedShifts:
        Number(row.completed_shifts) || 0
    };
  }

  statement.free();

  return profile;
}

function calculateJobExperienceProgress(
  profile,
  amount
) {
  const safeAmount = Number(amount);

  if (
    !Number.isSafeInteger(safeAmount) ||
    safeAmount < 0
  ) {
    throw new Error(
      'Количество EXP должно быть неотрицательным целым числом'
    );
  }

  let level = Math.min(
    JOB_MAX_LEVEL,
    Math.max(
      1,
      Number(profile.level) || 1
    )
  );
  let experience = Math.max(
    0,
    Number(profile.experience) || 0
  ) + safeAmount;
  let levelsGained = 0;

  while (level < JOB_MAX_LEVEL) {
    const required =
      getJobExperienceRequired(level);

    if (
      required === null ||
      experience < required
    ) {
      break;
    }

    experience -= required;
    level += 1;
    levelsGained += 1;
  }

  return {
    level,
    experience,
    experienceRequired:
      getJobExperienceRequired(level),
    levelsGained,
    leveledUp: levelsGained > 0,
    isMaxLevel: level >= JOB_MAX_LEVEL
  };
}

function getMagazineAssets(vkId) {
  ensureDatabase();

  const safeVkId = Number(vkId);

  if (!Number.isInteger(safeVkId)) {
    throw new Error(
      'VK ID должен быть целым числом'
    );
  }

  const statement = db.prepare(`
    SELECT
      item_key,
      item_type,
      purchased_at
    FROM magazine_assets
    WHERE vk_id = ?
    ORDER BY purchased_at ASC
  `);

  statement.bind([safeVkId]);

  const assets = [];

  while (statement.step()) {
    const row = statement.getAsObject();

    assets.push({
      itemKey: String(row.item_key),
      itemType: String(row.item_type),
      purchasedAt: String(row.purchased_at)
    });
  }

  statement.free();

  return assets;
}

function validateTravelCountryKey(countryKey) {
  const safeCountryKey =
    String(countryKey ?? '').trim();

  if (!/^[a-z0-9_-]{1,64}$/i.test(safeCountryKey)) {
    throw new Error(
      'Некорректный ключ страны'
    );
  }

  return safeCountryKey;
}

function ensureTravelProfile(vkId) {
  ensureDatabase();

  const safeVkId = Number(vkId);

  if (
    !Number.isInteger(safeVkId) ||
    safeVkId <= 0
  ) {
    throw new Error(
      'VK ID должен быть положительным целым числом'
    );
  }

  let changed = false;

  db.run(
    `
      INSERT OR IGNORE INTO travel_profiles (
        vk_id,
        current_country_key
      )
      VALUES (?, 'russia')
    `,
    [safeVkId]
  );
  changed = db.getRowsModified() > 0;

  db.run(
    `
      INSERT OR IGNORE INTO country_research (
        vk_id,
        country_key
      )
      VALUES (?, 'russia')
    `,
    [safeVkId]
  );
  changed =
    db.getRowsModified() > 0 ||
    changed;

  if (changed) {
    persistDatabase();
  }

  return safeVkId;
}

function getTravelProfile(vkId) {
  const safeVkId = ensureTravelProfile(vkId);
  const profileStatement = db.prepare(`
    SELECT current_country_key
    FROM travel_profiles
    WHERE vk_id = ?
  `);

  profileStatement.bind([safeVkId]);

  let currentCountryKey = 'russia';

  if (profileStatement.step()) {
    currentCountryKey = String(
      profileStatement
        .getAsObject()
        .current_country_key
    );
  }

  profileStatement.free();

  const researchStatement = db.prepare(`
    SELECT country_key
    FROM country_research
    WHERE vk_id = ?
    ORDER BY researched_at ASC
  `);

  researchStatement.bind([safeVkId]);

  const researchedCountryKeys = [];

  while (researchStatement.step()) {
    researchedCountryKeys.push(
      String(
        researchStatement
          .getAsObject()
          .country_key
      )
    );
  }

  researchStatement.free();

  return {
    currentCountryKey,
    researchedCountryKeys
  };
}

function hasPlaneAsset(vkId) {
  const statement = db.prepare(`
    SELECT 1
    FROM magazine_assets
    WHERE vk_id = ?
      AND item_type = 'planes'
    LIMIT 1
  `);

  statement.bind([vkId]);
  const hasPlane = statement.step();
  statement.free();

  return hasPlane;
}

function researchCountry({
  vkId,
  countryKey,
  cost
}) {
  const safeVkId = ensureTravelProfile(vkId);
  const safeCountryKey =
    validateTravelCountryKey(countryKey);
  const safeCost = Number(cost);

  if (
    !Number.isSafeInteger(safeCost) ||
    safeCost <= 0
  ) {
    throw new Error(
      'Стоимость исследования должна быть положительным целым числом'
    );
  }

  const profile = getTravelProfile(safeVkId);

  if (
    profile.researchedCountryKeys.includes(
      safeCountryKey
    )
  ) {
    return {
      status: 'already_researched',
      balance: getBalance(safeVkId)
    };
  }

  if (!hasPlaneAsset(safeVkId)) {
    return {
      status: 'no_plane',
      balance: getBalance(safeVkId)
    };
  }

  const balance = getBalance(safeVkId);

  if (balance < safeCost) {
    return {
      status: 'insufficient_funds',
      cost: safeCost,
      balance,
      missing: safeCost - balance
    };
  }

  try {
    db.run('BEGIN TRANSACTION;');

    db.run(
      `
        UPDATE balances
        SET dollars = dollars - ?
        WHERE vk_id = ?
          AND dollars >= ?
      `,
      [
        safeCost,
        safeVkId,
        safeCost
      ]
    );

    db.run(
      `
        INSERT INTO country_research (
          vk_id,
          country_key
        )
        VALUES (?, ?)
      `,
      [
        safeVkId,
        safeCountryKey
      ]
    );

    db.run('COMMIT;');
    persistDatabase();

    return {
      status: 'researched',
      cost: safeCost,
      balance: balance - safeCost,
      countryKey: safeCountryKey
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function moveCountry({
  vkId,
  countryKey,
  cost
}) {
  const safeVkId = ensureTravelProfile(vkId);
  const safeCountryKey =
    validateTravelCountryKey(countryKey);
  const safeCost = Number(cost);

  if (
    !Number.isSafeInteger(safeCost) ||
    safeCost <= 0
  ) {
    throw new Error(
      'Стоимость переезда должна быть положительным целым числом'
    );
  }

  const profile = getTravelProfile(safeVkId);

  if (profile.currentCountryKey === safeCountryKey) {
    return {
      status: 'already_there',
      balance: getBalance(safeVkId)
    };
  }

  if (
    !profile.researchedCountryKeys.includes(
      safeCountryKey
    )
  ) {
    return {
      status: 'not_researched',
      balance: getBalance(safeVkId)
    };
  }

  if (!hasPlaneAsset(safeVkId)) {
    return {
      status: 'no_plane',
      balance: getBalance(safeVkId)
    };
  }

  const balance = getBalance(safeVkId);

  if (balance < safeCost) {
    return {
      status: 'insufficient_funds',
      cost: safeCost,
      balance,
      missing: safeCost - balance
    };
  }

  try {
    db.run('BEGIN TRANSACTION;');

    db.run(
      `
        UPDATE balances
        SET dollars = dollars - ?
        WHERE vk_id = ?
          AND dollars >= ?
      `,
      [
        safeCost,
        safeVkId,
        safeCost
      ]
    );

    db.run(
      `
        UPDATE travel_profiles
        SET
          current_country_key = ?,
          moved_at = CURRENT_TIMESTAMP
        WHERE vk_id = ?
      `,
      [
        safeCountryKey,
        safeVkId
      ]
    );

    db.run('COMMIT;');
    persistDatabase();

    return {
      status: 'moved',
      cost: safeCost,
      balance: balance - safeCost,
      countryKey: safeCountryKey
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function addFishingCatch({
  vkId,
  lootKey,
  lootTitle,
  weightGrams,
  value
}) {
  ensureDatabase();

  const safeVkId = Number(vkId);
  const safeLootKey =
    String(lootKey ?? '').trim();
  const safeLootTitle =
    String(lootTitle ?? '').trim();
  const safeWeightGrams = Number(weightGrams);
  const safeValue = Number(value);

  if (
    !Number.isInteger(safeVkId) ||
    safeVkId <= 0
  ) {
    throw new Error(
      'VK ID должен быть положительным целым числом'
    );
  }

  if (!/^[a-z0-9_-]{1,64}$/i.test(safeLootKey)) {
    throw new Error(
      'Некорректный ключ улова'
    );
  }

  if (
    !safeLootTitle ||
    safeLootTitle.length > 100
  ) {
    throw new Error(
      'Некорректное название улова'
    );
  }

  if (
    !Number.isSafeInteger(safeWeightGrams) ||
    safeWeightGrams <= 0 ||
    !Number.isSafeInteger(safeValue) ||
    safeValue <= 0
  ) {
    throw new Error(
      'Вес и стоимость улова должны быть положительными целыми числами'
    );
  }

  db.run(
    `
      INSERT INTO fishing_catches (
        vk_id,
        loot_key,
        loot_title,
        weight_grams,
        value
      )
      VALUES (?, ?, ?, ?, ?)
    `,
    [
      safeVkId,
      safeLootKey,
      safeLootTitle,
      safeWeightGrams,
      safeValue
    ]
  );

  persistDatabase();

  return getFishingInventory(safeVkId);
}

function getFishingInventory(vkId) {
  ensureDatabase();

  const safeVkId = Number(vkId);

  if (
    !Number.isInteger(safeVkId) ||
    safeVkId <= 0
  ) {
    throw new Error(
      'VK ID должен быть положительным целым числом'
    );
  }

  const statement = db.prepare(`
    SELECT
      loot_key,
      loot_title,
      COUNT(*) AS catch_count,
      SUM(weight_grams) AS total_weight,
      SUM(value) AS total_value
    FROM fishing_catches
    WHERE vk_id = ?
    GROUP BY
      loot_key,
      loot_title
    ORDER BY total_value DESC, loot_title ASC
  `);

  statement.bind([safeVkId]);

  const items = [];
  let catchCount = 0;
  let totalWeightGrams = 0;
  let totalValue = 0;

  while (statement.step()) {
    const row = statement.getAsObject();
    const item = {
      lootKey: String(row.loot_key),
      title: String(row.loot_title),
      count: Number(row.catch_count) || 0,
      totalWeightGrams:
        Number(row.total_weight) || 0,
      totalValue:
        Number(row.total_value) || 0
    };

    items.push(item);
    catchCount += item.count;
    totalWeightGrams += item.totalWeightGrams;
    totalValue += item.totalValue;
  }

  statement.free();

  return {
    items,
    catchCount,
    totalWeightGrams,
    totalValue
  };
}

function sellAllFishingCatches(vkId) {
  ensureDatabase();

  const safeVkId = Number(vkId);

  if (
    !Number.isInteger(safeVkId) ||
    safeVkId <= 0
  ) {
    throw new Error(
      'VK ID должен быть положительным целым числом'
    );
  }

  const inventory = getFishingInventory(safeVkId);

  if (
    inventory.catchCount <= 0 ||
    inventory.totalValue <= 0
  ) {
    return {
      status: 'empty',
      balance: getBalance(safeVkId)
    };
  }

  const balance = getBalance(safeVkId);

  if (
    balance >
      Number.MAX_SAFE_INTEGER -
      inventory.totalValue
  ) {
    return {
      status: 'balance_limit'
    };
  }

  try {
    db.run('BEGIN TRANSACTION;');

    db.run(
      `
        DELETE FROM fishing_catches
        WHERE vk_id = ?
      `,
      [safeVkId]
    );

    db.run(
      `
        INSERT INTO balances (
          vk_id,
          dollars
        )
        VALUES (?, ?)

        ON CONFLICT(vk_id)
        DO UPDATE SET
          dollars = dollars + excluded.dollars
      `,
      [
        safeVkId,
        inventory.totalValue
      ]
    );

    db.run('COMMIT;');
    persistDatabase();

    return {
      status: 'sold',
      catchCount: inventory.catchCount,
      totalWeightGrams:
        inventory.totalWeightGrams,
      earned: inventory.totalValue,
      balance: balance + inventory.totalValue
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function getBeginnerBoxRecord(vkId) {
  ensureDatabase();

  const safeVkId = Number(vkId);

  if (
    !Number.isInteger(safeVkId) ||
    safeVkId <= 0
  ) {
    throw new Error(
      'VK ID должен быть положительным целым числом'
    );
  }

  const statement = db.prepare(`
    SELECT
      last_opened_at,
      opened_count,
      total_earned
    FROM beginner_boxes
    WHERE vk_id = ?
  `);

  statement.bind([safeVkId]);

  let record = {
    lastOpenedAt: 0,
    openedCount: 0,
    totalEarned: 0
  };

  if (statement.step()) {
    const row = statement.getAsObject();

    record = {
      lastOpenedAt:
        Number(row.last_opened_at) || 0,
      openedCount:
        Number(row.opened_count) || 0,
      totalEarned:
        Number(row.total_earned) || 0
    };
  }

  statement.free();

  return record;
}

function getBeginnerBoxStatus(
  vkId,
  currentTime = Date.now()
) {
  const safeVkId = Number(vkId);
  const safeCurrentTime = Number(currentTime);

  if (
    !Number.isInteger(safeVkId) ||
    safeVkId <= 0
  ) {
    throw new Error(
      'VK ID должен быть положительным целым числом'
    );
  }

  if (
    !Number.isSafeInteger(safeCurrentTime) ||
    safeCurrentTime < 0
  ) {
    throw new Error(
      'Некорректное время открытия коробки'
    );
  }

  const profile = getJobProfile(safeVkId);
  const record = getBeginnerBoxRecord(safeVkId);

  if (profile.level > BEGINNER_BOX_MAX_LEVEL) {
    return {
      status: 'level_limit',
      available: false,
      level: profile.level,
      maxLevel: BEGINNER_BOX_MAX_LEVEL,
      remainingMs: 0,
      nextAvailableAt: 0,
      ...record
    };
  }

  const elapsed = record.openedCount > 0
    ? Math.max(
      0,
      safeCurrentTime - record.lastOpenedAt
    )
    : BEGINNER_BOX_COOLDOWN_MS;
  const remainingMs = Math.max(
    0,
    BEGINNER_BOX_COOLDOWN_MS - elapsed
  );

  return {
    status:
      remainingMs > 0
        ? 'cooldown'
        : 'available',
    available: remainingMs === 0,
    level: profile.level,
    maxLevel: BEGINNER_BOX_MAX_LEVEL,
    remainingMs,
    nextAvailableAt:
      remainingMs > 0
        ? safeCurrentTime + remainingMs
        : safeCurrentTime,
    ...record
  };
}

function claimBeginnerBox({
  vkId,
  reward,
  currentTime = Date.now()
}) {
  ensureDatabase();

  const safeVkId = Number(vkId);
  const safeReward = Number(reward);
  const safeCurrentTime = Number(currentTime);

  if (
    !Number.isInteger(safeVkId) ||
    safeVkId <= 0
  ) {
    throw new Error(
      'VK ID должен быть положительным целым числом'
    );
  }

  if (
    !Number.isSafeInteger(safeReward) ||
    safeReward <= 0
  ) {
    throw new Error(
      'Награда должна быть положительным целым числом'
    );
  }

  const boxStatus = getBeginnerBoxStatus(
    safeVkId,
    safeCurrentTime
  );

  if (!boxStatus.available) {
    return {
      ...boxStatus,
      balance: getBalance(safeVkId),
      debt: getGameDebt(safeVkId)
    };
  }

  if (
    boxStatus.openedCount >=
      Number.MAX_SAFE_INTEGER ||
    boxStatus.totalEarned >
      Number.MAX_SAFE_INTEGER - safeReward
  ) {
    return {
      status: 'stat_limit'
    };
  }

  const currentBalance = getBalance(safeVkId);
  const currentDebt = getGameDebt(safeVkId);
  const debtPaid = Math.min(
    currentDebt,
    safeReward
  );
  const credited = safeReward - debtPaid;

  if (
    currentBalance >
      Number.MAX_SAFE_INTEGER - credited
  ) {
    return {
      status: 'balance_limit'
    };
  }

  try {
    db.run('BEGIN TRANSACTION;');

    db.run(
      `
        INSERT INTO beginner_boxes (
          vk_id,
          last_opened_at,
          opened_count,
          total_earned
        )
        VALUES (?, ?, 1, ?)

        ON CONFLICT(vk_id)
        DO UPDATE SET
          last_opened_at = excluded.last_opened_at,
          opened_count = opened_count + 1,
          total_earned =
            total_earned + excluded.total_earned
      `,
      [
        safeVkId,
        safeCurrentTime,
        safeReward
      ]
    );

    if (debtPaid > 0) {
      const remainingDebt =
        currentDebt - debtPaid;

      if (remainingDebt > 0) {
        db.run(
          `
            UPDATE game_debts
            SET dollars = ?
            WHERE vk_id = ?
          `,
          [
            remainingDebt,
            safeVkId
          ]
        );
      } else {
        db.run(
          `
            DELETE FROM game_debts
            WHERE vk_id = ?
          `,
          [safeVkId]
        );
      }
    }

    if (credited > 0) {
      db.run(
        `
          INSERT INTO balances (
            vk_id,
            dollars
          )
          VALUES (?, ?)

          ON CONFLICT(vk_id)
          DO UPDATE SET
            dollars = dollars + excluded.dollars
        `,
        [
          safeVkId,
          credited
        ]
      );
    }

    db.run('COMMIT;');
    persistDatabase();

    const record = getBeginnerBoxRecord(
      safeVkId
    );

    return {
      status: 'opened',
      reward: safeReward,
      debtPaid,
      credited,
      balance: currentBalance + credited,
      debt: currentDebt - debtPaid,
      nextAvailableAt:
        safeCurrentTime +
        BEGINNER_BOX_COOLDOWN_MS,
      ...record
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function getJobBoostCount(vkId) {
  ensureDatabase();

  const safeVkId = Number(vkId);

  if (!Number.isInteger(safeVkId)) {
    throw new Error(
      'VK ID должен быть целым числом'
    );
  }

  const statement = db.prepare(`
    SELECT quantity
    FROM job_boosts
    WHERE vk_id = ?
  `);

  statement.bind([safeVkId]);

  let quantity = 0;

  if (statement.step()) {
    const row = statement.getAsObject();

    quantity = Math.max(
      0,
      Number(row.quantity) || 0
    );
  }

  statement.free();

  return quantity;
}

function getDailyJobBoostPurchaseUsage(
  vkId,
  currentTime = Date.now()
) {
  ensureDatabase();

  const safeVkId = Number(vkId);

  if (
    !Number.isInteger(safeVkId) ||
    safeVkId <= 0
  ) {
    throw new Error(
      'VK ID должен быть положительным целым числом'
    );
  }

  const day = getMoscowDay(currentTime);
  const storedDay = getQuestStat(
    safeVkId,
    JOB_BOOST_PURCHASE_DAY_STAT_KEY
  );
  const storedCount = getQuestStat(
    safeVkId,
    JOB_BOOST_PURCHASE_COUNT_STAT_KEY
  );
  const purchased = storedDay === day
    ? Math.min(
      JOB_BOOST_DAILY_PURCHASE_LIMIT,
      Math.max(0, storedCount)
    )
    : 0;

  return {
    day,
    limit: JOB_BOOST_DAILY_PURCHASE_LIMIT,
    purchased,
    remaining:
      JOB_BOOST_DAILY_PURCHASE_LIMIT -
      purchased,
    resetAt:
      (day + 1) * DAY_MS -
      MOSCOW_UTC_OFFSET_MS
  };
}

function purchaseMagazineItem({
  vkId,
  itemKey,
  itemType,
  price,
  consumable = false,
  consumableQuantity = 1,
  currentTime = Date.now()
}) {
  ensureDatabase();

  const safeVkId = Number(vkId);
  const safeItemKey =
    String(itemKey ?? '').trim();
  const safeItemType =
    String(itemType ?? '').trim();
  const safePrice = Number(price);
  const isConsumable = Boolean(consumable);
  const safeConsumableQuantity = Number(
    consumableQuantity
  );
  const isDailyLimitedJobBoost =
    isConsumable &&
    safeItemKey === JOB_BOOST_ITEM_KEY;

  if (!Number.isInteger(safeVkId)) {
    throw new Error(
      'VK ID должен быть целым числом'
    );
  }

  if (!safeItemKey || !safeItemType) {
    throw new Error(
      'Не указан товар или его категория'
    );
  }

  if (
    !Number.isInteger(safePrice) ||
    safePrice <= 0
  ) {
    throw new Error(
      'Цена товара должна быть положительным целым числом'
    );
  }

  if (
    isConsumable &&
    (
      !Number.isInteger(
        safeConsumableQuantity
      ) ||
      safeConsumableQuantity <= 0 ||
      safeConsumableQuantity > 1000
    )
  ) {
    throw new Error(
      'Количество расходуемого товара должно быть от 1 до 1000'
    );
  }

  if (!isConsumable) {
    const alreadyOwned =
      getMagazineAssets(safeVkId)
        .some(asset =>
          asset.itemKey === safeItemKey
        );

    if (alreadyOwned) {
      return {
        status: 'already_owned',
        balance: getBalance(safeVkId)
      };
    }
  }

  const dailyBoostPurchase =
    isDailyLimitedJobBoost
      ? getDailyJobBoostPurchaseUsage(
        safeVkId,
        currentTime
      )
      : null;

  if (
    dailyBoostPurchase &&
    safeConsumableQuantity >
      dailyBoostPurchase.remaining
  ) {
    return {
      status: 'daily_limit',
      ...dailyBoostPurchase,
      boostCount: getJobBoostCount(safeVkId)
    };
  }

  const currentBalance =
    getBalance(safeVkId);

  if (currentBalance < safePrice) {
    return {
      status: 'insufficient_funds',
      price: safePrice,
      balance: currentBalance,
      missing: safePrice - currentBalance
    };
  }

  try {
    db.run('BEGIN TRANSACTION;');

    db.run(
      `
        UPDATE balances
        SET dollars = dollars - ?
        WHERE vk_id = ?
      `,
      [
        safePrice,
        safeVkId
      ]
    );

    if (isConsumable) {
      db.run(
        `
          INSERT INTO job_boosts (
            vk_id,
            quantity
          )
          VALUES (?, ?)

          ON CONFLICT(vk_id)
          DO UPDATE SET
            quantity = quantity + excluded.quantity
        `,
        [
          safeVkId,
          safeConsumableQuantity
        ]
      );

      if (dailyBoostPurchase) {
        const newDailyPurchaseCount =
          dailyBoostPurchase.purchased +
          safeConsumableQuantity;

        db.run(
          `
            INSERT INTO quest_stats (
              vk_id,
              stat_key,
              value
            )
            VALUES (?, ?, ?)

            ON CONFLICT(vk_id, stat_key)
            DO UPDATE SET
              value = excluded.value,
              updated_at = CURRENT_TIMESTAMP
          `,
          [
            safeVkId,
            JOB_BOOST_PURCHASE_DAY_STAT_KEY,
            dailyBoostPurchase.day
          ]
        );

        db.run(
          `
            INSERT INTO quest_stats (
              vk_id,
              stat_key,
              value
            )
            VALUES (?, ?, ?)

            ON CONFLICT(vk_id, stat_key)
            DO UPDATE SET
              value = excluded.value,
              updated_at = CURRENT_TIMESTAMP
          `,
          [
            safeVkId,
            JOB_BOOST_PURCHASE_COUNT_STAT_KEY,
            newDailyPurchaseCount
          ]
        );
      }
    } else {
      db.run(
        `
          INSERT INTO magazine_assets (
            vk_id,
            item_key,
            item_type
          )
          VALUES (?, ?, ?)
        `,
        [
          safeVkId,
          safeItemKey,
          safeItemType
        ]
      );

      if (safeItemType === 'businesses') {
        db.run(
          `
            INSERT OR IGNORE INTO business_states (
              vk_id,
              item_key,
              last_income_at
            )
            VALUES (?, ?, ?)
          `,
          [
            safeVkId,
            safeItemKey,
            Date.now()
          ]
        );
      }
    }

    db.run('COMMIT;');

    persistDatabase();

    return {
      status: 'purchased',
      price: safePrice,
      balance: currentBalance - safePrice,
      boostCount: getJobBoostCount(safeVkId),
      ...(dailyBoostPurchase
        ? {
          dailyPurchaseLimit:
            dailyBoostPurchase.limit,
          purchasedToday:
            dailyBoostPurchase.purchased +
            safeConsumableQuantity,
          dailyPurchaseRemaining:
            dailyBoostPurchase.remaining -
            safeConsumableQuantity,
          dailyPurchaseResetAt:
            dailyBoostPurchase.resetAt
        }
        : {})
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function sellMagazineAsset({
  vkId,
  itemKey,
  itemType,
  resaleValue
}) {
  ensureDatabase();

  const safeVkId = Number(vkId);
  const safeItemKey =
    String(itemKey ?? '').trim();
  const safeItemType =
    String(itemType ?? '').trim();
  const safeResaleValue =
    Number(resaleValue);

  if (!Number.isInteger(safeVkId)) {
    throw new Error(
      'VK ID должен быть целым числом'
    );
  }

  if (!safeItemKey || !safeItemType) {
    throw new Error(
      'Не указано продаваемое имущество'
    );
  }

  if (
    !Number.isSafeInteger(safeResaleValue) ||
    safeResaleValue < 0
  ) {
    throw new Error(
      'Некорректная стоимость продажи'
    );
  }

  if (safeItemType === 'businesses') {
    return {
      status: 'business_requires_manager'
    };
  }

  const ownedAsset =
    getMagazineAssets(safeVkId)
      .find(asset =>
        asset.itemKey === safeItemKey &&
        asset.itemType === safeItemType
      );

  if (!ownedAsset) {
    return {
      status: 'not_owned'
    };
  }

  const currentBalance =
    getBalance(safeVkId);
  const phoneSim = safeItemType === 'phones'
    ? getPhoneSim(safeVkId)
    : null;

  if (
    currentBalance >
    Number.MAX_SAFE_INTEGER - safeResaleValue
  ) {
    return {
      status: 'balance_limit'
    };
  }

  try {
    db.run('BEGIN TRANSACTION;');

    db.run(
      `
        DELETE FROM magazine_assets
        WHERE vk_id = ?
          AND item_key = ?
          AND item_type = ?
      `,
      [
        safeVkId,
        safeItemKey,
        safeItemType
      ]
    );

    if (safeItemType === 'houses') {
      db.run(
        `
          DELETE FROM business_states
          WHERE vk_id = ?
            AND item_key = ?
        `,
        [
          safeVkId,
          safeItemKey
        ]
      );
    }

    if (safeItemType === 'cars') {
      db.run(
        `
          DELETE FROM business_states
          WHERE vk_id = ?
            AND item_key LIKE ?
        `,
        [
          safeVkId,
          `car-tuning:${safeItemKey}:%`
        ]
      );
    }

    if (safeItemType === 'phones') {
      db.run(
        `
          DELETE FROM phone_calls
          WHERE caller_vk_id = ?
             OR receiver_vk_id = ?
        `,
        [safeVkId, safeVkId]
      );

      db.run(
        `
          DELETE FROM phone_sims
          WHERE vk_id = ?
        `,
        [safeVkId]
      );
    }

    if (safeResaleValue > 0) {
      db.run(
        `
          INSERT INTO balances (
            vk_id,
            dollars
          )
          VALUES (?, ?)

          ON CONFLICT(vk_id)
          DO UPDATE SET
            dollars = dollars + excluded.dollars
        `,
        [
          safeVkId,
          safeResaleValue
        ]
      );
    }

    db.run('COMMIT;');

    persistDatabase();

    return {
      status: 'sold',
      resaleValue: safeResaleValue,
      releasedPhoneNumber:
        phoneSim?.phoneNumber ?? null,
      balance:
        currentBalance +
        safeResaleValue
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function getBusinessMultiplier(level) {
  const safeLevel = Math.min(
    BUSINESS_MAX_UPGRADE_LEVEL,
    Math.max(
      0,
      Math.trunc(
        Number(level) || 0
      )
    )
  );

  return (
    BUSINESS_MULTIPLIER_SCALES[safeLevel] /
    10
  );
}

function validateBusinessInput({
  vkId,
  itemKey,
  baseIncome,
  currentTime
}) {
  const safeVkId = Number(vkId);
  const safeItemKey =
    String(itemKey ?? '').trim();
  const safeBaseIncome = Number(baseIncome);
  const safeCurrentTime = Number(currentTime);

  if (!Number.isInteger(safeVkId)) {
    throw new Error(
      'VK ID должен быть целым числом'
    );
  }

  if (!safeItemKey) {
    throw new Error(
      'Не указан бизнес'
    );
  }

  if (
    !Number.isInteger(safeBaseIncome) ||
    safeBaseIncome <= 0 ||
    !Number.isFinite(safeCurrentTime)
  ) {
    throw new Error(
      'Некорректный доход бизнеса или время'
    );
  }

  return {
    safeVkId,
    safeItemKey,
    safeBaseIncome,
    safeCurrentTime
  };
}

function hasMagazineAsset(
  vkId,
  itemKey,
  itemType
) {
  const statement = db.prepare(`
    SELECT 1
    FROM magazine_assets
    WHERE vk_id = ?
      AND item_key = ?
      AND item_type = ?
    LIMIT 1
  `);

  statement.bind([
    vkId,
    itemKey,
    itemType
  ]);

  const exists = statement.step();

  statement.free();

  return exists;
}

function hasBusinessAsset(vkId, itemKey) {
  return hasMagazineAsset(
    vkId,
    itemKey,
    'businesses'
  );
}

function readBusinessState(vkId, itemKey) {
  const statement = db.prepare(`
    SELECT
      upgrade_level,
      stored_income,
      last_income_at,
      total_earned
    FROM business_states
    WHERE vk_id = ?
      AND item_key = ?
  `);

  statement.bind([
    vkId,
    itemKey
  ]);

  let state = null;

  if (statement.step()) {
    const row = statement.getAsObject();

    state = {
      upgradeLevel:
        Number(row.upgrade_level) || 0,
      storedIncome:
        Number(row.stored_income) || 0,
      lastIncomeAt:
        Number(row.last_income_at) || 0,
      totalEarned:
        Number(row.total_earned) || 0
    };
  }

  statement.free();

  return state;
}

function calculateBusinessIncome({
  baseIncome,
  upgradeLevel,
  startedAt,
  currentTime
}) {
  const elapsed = Math.max(
    0,
    currentTime - startedAt
  );

  const multiplierScale =
    BUSINESS_MULTIPLIER_SCALES[
      Math.min(
        BUSINESS_MAX_UPGRADE_LEVEL,
        Math.max(
          0,
          Math.trunc(
            Number(upgradeLevel) || 0
          )
        )
      )
    ];

  return Math.floor(
    elapsed *
    baseIncome *
    multiplierScale /
    (60 * 60 * 1000 * 10)
  );
}

function getBusinessState({
  vkId,
  itemKey,
  baseIncome,
  currentTime = Date.now()
}) {
  ensureDatabase();

  const {
    safeVkId,
    safeItemKey,
    safeBaseIncome,
    safeCurrentTime
  } = validateBusinessInput({
    vkId,
    itemKey,
    baseIncome,
    currentTime
  });

  if (!hasBusinessAsset(
    safeVkId,
    safeItemKey
  )) {
    return {
      status: 'not_owned'
    };
  }

  let state = readBusinessState(
    safeVkId,
    safeItemKey
  );

  if (!state) {
    db.run(
      `
        INSERT INTO business_states (
          vk_id,
          item_key,
          last_income_at
        )
        VALUES (?, ?, ?)
      `,
      [
        safeVkId,
        safeItemKey,
        safeCurrentTime
      ]
    );

    persistDatabase();

    state = readBusinessState(
      safeVkId,
      safeItemKey
    );
  }

  const accruedIncome =
    calculateBusinessIncome({
      baseIncome: safeBaseIncome,
      upgradeLevel: state.upgradeLevel,
      startedAt: state.lastIncomeAt,
      currentTime: safeCurrentTime
    });

  const multiplier =
    getBusinessMultiplier(
      state.upgradeLevel
    );

  return {
    status: 'owned',
    upgradeLevel: state.upgradeLevel,
    multiplier,
    incomePerHour: Math.floor(
      safeBaseIncome * multiplier
    ),
    storedIncome: state.storedIncome,
    accruedIncome,
    availableIncome:
      state.storedIncome +
      accruedIncome,
    lastIncomeAt: state.lastIncomeAt,
    totalEarned: state.totalEarned
  };
}

function collectBusinessIncome({
  vkId,
  itemKey,
  baseIncome,
  currentTime = Date.now()
}) {
  const business = getBusinessState({
    vkId,
    itemKey,
    baseIncome,
    currentTime
  });

  if (business.status !== 'owned') {
    return business;
  }

  if (business.availableIncome <= 0) {
    return {
      ...business,
      status: 'empty'
    };
  }

  const safeVkId = Number(vkId);
  const safeItemKey = String(itemKey).trim();
  const safeCurrentTime = Number(currentTime);
  const payout = business.availableIncome;

  try {
    db.run('BEGIN TRANSACTION;');

    db.run(
      `
        UPDATE business_states
        SET
          stored_income = 0,
          last_income_at = ?,
          total_earned = total_earned + ?
        WHERE vk_id = ?
          AND item_key = ?
      `,
      [
        safeCurrentTime,
        payout,
        safeVkId,
        safeItemKey
      ]
    );

    db.run(
      `
        INSERT INTO balances (
          vk_id,
          dollars
        )
        VALUES (?, ?)

        ON CONFLICT(vk_id)
        DO UPDATE SET
          dollars = dollars + excluded.dollars
      `,
      [
        safeVkId,
        payout
      ]
    );

    db.run('COMMIT;');

    persistDatabase();

    return {
      status: 'collected',
      payout,
      balance: getBalance(safeVkId),
      totalEarned:
        business.totalEarned + payout
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function collectAllBusinessIncome({
  vkId,
  businesses,
  currentTime = Date.now()
}) {
  ensureDatabase();

  const safeVkId = Number(vkId);
  const safeCurrentTime = Number(currentTime);

  if (!Number.isInteger(safeVkId)) {
    throw new Error(
      'VK ID должен быть целым числом'
    );
  }

  if (
    !Array.isArray(businesses) ||
    businesses.length === 0 ||
    !Number.isFinite(safeCurrentTime)
  ) {
    throw new Error(
      'Не передан список бизнесов'
    );
  }

  const payouts = businesses
    .map(business => {
      const itemKey =
        String(business.itemKey ?? '').trim();
      const baseIncome =
        Number(business.baseIncome);

      if (
        !itemKey ||
        !Number.isInteger(baseIncome) ||
        baseIncome <= 0
      ) {
        throw new Error(
          'Некорректные данные бизнеса'
        );
      }

      const state = getBusinessState({
        vkId: safeVkId,
        itemKey,
        baseIncome,
        currentTime: safeCurrentTime
      });

      if (state.status !== 'owned') {
        return null;
      }

      return {
        itemKey,
        payout: state.availableIncome
      };
    })
    .filter(Boolean)
    .filter(item => item.payout > 0);

  const totalPayout = payouts.reduce(
    (sum, item) => sum + item.payout,
    0
  );

  if (totalPayout <= 0) {
    return {
      status: 'empty',
      payout: 0,
      businessCount: 0,
      balance: getBalance(safeVkId)
    };
  }

  if (!Number.isSafeInteger(totalPayout)) {
    throw new Error(
      'Суммарный доход бизнеса превышает технический лимит'
    );
  }

  const currentBalance =
    getBalance(safeVkId);

  if (
    currentBalance >
    Number.MAX_SAFE_INTEGER - totalPayout
  ) {
    return {
      status: 'balance_limit'
    };
  }

  try {
    db.run('BEGIN TRANSACTION;');

    for (const item of payouts) {
      db.run(
        `
          UPDATE business_states
          SET
            stored_income = 0,
            last_income_at = ?,
            total_earned = total_earned + ?
          WHERE vk_id = ?
            AND item_key = ?
        `,
        [
          safeCurrentTime,
          item.payout,
          safeVkId,
          item.itemKey
        ]
      );
    }

    db.run(
      `
        INSERT INTO balances (
          vk_id,
          dollars
        )
        VALUES (?, ?)

        ON CONFLICT(vk_id)
        DO UPDATE SET
          dollars = dollars + excluded.dollars
      `,
      [
        safeVkId,
        totalPayout
      ]
    );

    db.run('COMMIT;');

    persistDatabase();

    return {
      status: 'collected',
      payout: totalPayout,
      businessCount: payouts.length,
      balance:
        currentBalance + totalPayout
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function validatePropertyRentalInput({
  vkId,
  itemKey,
  rentPerHour,
  currentTime
}) {
  const safeVkId = Number(vkId);
  const safeItemKey =
    String(itemKey ?? '').trim();
  const safeRentPerHour =
    Number(rentPerHour);
  const safeCurrentTime =
    Number(currentTime);

  if (
    !Number.isInteger(safeVkId) ||
    safeVkId <= 0
  ) {
    throw new Error(
      'VK ID должен быть положительным целым числом'
    );
  }

  if (!safeItemKey) {
    throw new Error(
      'Не указана недвижимость'
    );
  }

  if (
    !Number.isSafeInteger(safeRentPerHour) ||
    safeRentPerHour <= 0 ||
    !Number.isFinite(safeCurrentTime)
  ) {
    throw new Error(
      'Некорректный доход от аренды или время'
    );
  }

  return {
    safeVkId,
    safeItemKey,
    safeRentPerHour,
    safeCurrentTime
  };
}

function getPropertyRentalState({
  vkId,
  itemKey,
  rentPerHour,
  currentTime = Date.now()
}) {
  ensureDatabase();

  const {
    safeVkId,
    safeItemKey,
    safeRentPerHour,
    safeCurrentTime
  } = validatePropertyRentalInput({
    vkId,
    itemKey,
    rentPerHour,
    currentTime
  });

  if (!hasMagazineAsset(
    safeVkId,
    safeItemKey,
    'houses'
  )) {
    return {
      status: 'not_owned'
    };
  }

  const state = readBusinessState(
    safeVkId,
    safeItemKey
  );

  if (!state) {
    return {
      status: 'inactive',
      rentPerHour: safeRentPerHour,
      availableIncome: 0,
      totalEarned: 0
    };
  }

  const accruedIncome =
    calculateBusinessIncome({
      baseIncome: safeRentPerHour,
      upgradeLevel: 0,
      startedAt: state.lastIncomeAt,
      currentTime: safeCurrentTime
    });

  return {
    status: 'active',
    rentPerHour: safeRentPerHour,
    storedIncome: state.storedIncome,
    accruedIncome,
    availableIncome:
      state.storedIncome + accruedIncome,
    lastIncomeAt: state.lastIncomeAt,
    totalEarned: state.totalEarned
  };
}

function startPropertyRental({
  vkId,
  itemKey,
  rentPerHour,
  currentTime = Date.now()
}) {
  const rental = getPropertyRentalState({
    vkId,
    itemKey,
    rentPerHour,
    currentTime
  });

  if (rental.status === 'not_owned') {
    return rental;
  }

  if (rental.status === 'active') {
    return {
      ...rental,
      status: 'already_active'
    };
  }

  const safeVkId = Number(vkId);
  const safeItemKey =
    String(itemKey).trim();
  const safeCurrentTime =
    Number(currentTime);

  db.run(
    `
      INSERT OR IGNORE INTO business_states (
        vk_id,
        item_key,
        last_income_at
      )
      VALUES (?, ?, ?)
    `,
    [
      safeVkId,
      safeItemKey,
      safeCurrentTime
    ]
  );

  persistDatabase();

  return {
    ...getPropertyRentalState({
      vkId: safeVkId,
      itemKey: safeItemKey,
      rentPerHour,
      currentTime: safeCurrentTime
    }),
    status: 'started'
  };
}

function collectPropertyRent({
  vkId,
  itemKey,
  rentPerHour,
  currentTime = Date.now()
}) {
  const rental = getPropertyRentalState({
    vkId,
    itemKey,
    rentPerHour,
    currentTime
  });

  if (
    rental.status === 'not_owned' ||
    rental.status === 'inactive'
  ) {
    return rental;
  }

  if (rental.availableIncome <= 0) {
    return {
      ...rental,
      status: 'empty'
    };
  }

  const safeVkId = Number(vkId);
  const safeItemKey =
    String(itemKey).trim();
  const safeCurrentTime =
    Number(currentTime);
  const payout = rental.availableIncome;
  const currentBalance =
    getBalance(safeVkId);

  if (
    currentBalance >
    Number.MAX_SAFE_INTEGER - payout
  ) {
    return {
      status: 'balance_limit'
    };
  }

  try {
    db.run('BEGIN TRANSACTION;');

    db.run(
      `
        UPDATE business_states
        SET
          stored_income = 0,
          last_income_at = ?,
          total_earned = total_earned + ?
        WHERE vk_id = ?
          AND item_key = ?
      `,
      [
        safeCurrentTime,
        payout,
        safeVkId,
        safeItemKey
      ]
    );

    db.run(
      `
        INSERT INTO balances (
          vk_id,
          dollars
        )
        VALUES (?, ?)

        ON CONFLICT(vk_id)
        DO UPDATE SET
          dollars = dollars + excluded.dollars
      `,
      [
        safeVkId,
        payout
      ]
    );

    db.run('COMMIT;');

    persistDatabase();

    return {
      status: 'collected',
      payout,
      balance: currentBalance + payout,
      totalEarned:
        rental.totalEarned + payout
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function collectAllPropertyRent({
  vkId,
  properties,
  currentTime = Date.now()
}) {
  ensureDatabase();

  const safeVkId = Number(vkId);
  const safeCurrentTime =
    Number(currentTime);

  if (
    !Number.isInteger(safeVkId) ||
    safeVkId <= 0
  ) {
    throw new Error(
      'VK ID должен быть положительным целым числом'
    );
  }

  if (
    !Array.isArray(properties) ||
    properties.length === 0 ||
    !Number.isFinite(safeCurrentTime)
  ) {
    throw new Error(
      'Не передан список недвижимости'
    );
  }

  const payouts = properties
    .map(property => {
      const itemKey = String(
        property.itemKey ?? ''
      ).trim();
      const rentPerHour = Number(
        property.rentPerHour
      );

      const state = getPropertyRentalState({
        vkId: safeVkId,
        itemKey,
        rentPerHour,
        currentTime: safeCurrentTime
      });

      if (state.status !== 'active') {
        return null;
      }

      return {
        itemKey,
        payout: state.availableIncome
      };
    })
    .filter(Boolean)
    .filter(item => item.payout > 0);

  const totalPayout = payouts.reduce(
    (sum, item) => sum + item.payout,
    0
  );

  if (totalPayout <= 0) {
    return {
      status: 'empty',
      payout: 0,
      propertyCount: 0,
      balance: getBalance(safeVkId)
    };
  }

  if (!Number.isSafeInteger(totalPayout)) {
    throw new Error(
      'Суммарный доход от аренды превышает технический лимит'
    );
  }

  const currentBalance =
    getBalance(safeVkId);

  if (
    currentBalance >
    Number.MAX_SAFE_INTEGER - totalPayout
  ) {
    return {
      status: 'balance_limit'
    };
  }

  try {
    db.run('BEGIN TRANSACTION;');

    for (const item of payouts) {
      db.run(
        `
          UPDATE business_states
          SET
            stored_income = 0,
            last_income_at = ?,
            total_earned = total_earned + ?
          WHERE vk_id = ?
            AND item_key = ?
        `,
        [
          safeCurrentTime,
          item.payout,
          safeVkId,
          item.itemKey
        ]
      );
    }

    db.run(
      `
        INSERT INTO balances (
          vk_id,
          dollars
        )
        VALUES (?, ?)

        ON CONFLICT(vk_id)
        DO UPDATE SET
          dollars = dollars + excluded.dollars
      `,
      [
        safeVkId,
        totalPayout
      ]
    );

    db.run('COMMIT;');

    persistDatabase();

    return {
      status: 'collected',
      payout: totalPayout,
      propertyCount: payouts.length,
      balance: currentBalance + totalPayout
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function validateCarTuningIdentity({
  vkId,
  carKey,
  componentKey = null
}) {
  const safeVkId = Number(vkId);
  const safeCarKey =
    String(carKey ?? '').trim();
  const safeComponentKey =
    componentKey === null
      ? null
      : String(componentKey ?? '').trim();

  if (
    !Number.isInteger(safeVkId) ||
    safeVkId <= 0
  ) {
    throw new Error(
      'VK ID должен быть положительным целым числом'
    );
  }

  if (!/^car-[a-z0-9-]+$/.test(safeCarKey)) {
    throw new Error(
      'Некорректный автомобиль'
    );
  }

  if (
    safeComponentKey !== null &&
    !/^[a-z0-9-]+$/.test(safeComponentKey)
  ) {
    throw new Error(
      'Некорректный компонент тюнинга'
    );
  }

  return {
    safeVkId,
    safeCarKey,
    safeComponentKey
  };
}

function getCarTuningLevels(vkId, carKey) {
  ensureDatabase();

  const {
    safeVkId,
    safeCarKey
  } = validateCarTuningIdentity({
    vkId,
    carKey
  });

  if (!hasMagazineAsset(
    safeVkId,
    safeCarKey,
    'cars'
  )) {
    return {
      status: 'not_owned',
      levels: {}
    };
  }

  const prefix =
    `car-tuning:${safeCarKey}:`;
  const statement = db.prepare(`
    SELECT
      item_key,
      upgrade_level
    FROM business_states
    WHERE vk_id = ?
      AND item_key LIKE ?
  `);

  statement.bind([
    safeVkId,
    `${prefix}%`
  ]);

  const levels = {};

  while (statement.step()) {
    const row = statement.getAsObject();
    const storedKey = String(
      row.item_key ?? ''
    );
    const componentKey =
      storedKey.startsWith(prefix)
        ? storedKey.slice(prefix.length)
        : '';

    if (!/^[a-z0-9-]+$/.test(componentKey)) {
      continue;
    }

    levels[componentKey] = Math.min(
      5,
      Math.max(
        0,
        Math.trunc(
          Number(row.upgrade_level) || 0
        )
      )
    );
  }

  statement.free();

  return {
    status: 'owned',
    levels
  };
}

function upgradeCarTuning({
  vkId,
  carKey,
  componentKey,
  expectedLevel,
  price
}) {
  ensureDatabase();

  const {
    safeVkId,
    safeCarKey,
    safeComponentKey
  } = validateCarTuningIdentity({
    vkId,
    carKey,
    componentKey
  });
  const safeExpectedLevel =
    Number(expectedLevel);
  const safePrice = Number(price);

  if (
    !Number.isInteger(safeExpectedLevel) ||
    safeExpectedLevel < 0 ||
    safeExpectedLevel >= 5
  ) {
    throw new Error(
      'Некорректный уровень тюнинга'
    );
  }

  if (
    !Number.isSafeInteger(safePrice) ||
    safePrice <= 0
  ) {
    throw new Error(
      'Некорректная цена тюнинга'
    );
  }

  const tuning = getCarTuningLevels(
    safeVkId,
    safeCarKey
  );

  if (tuning.status !== 'owned') {
    return tuning;
  }

  const currentLevel = Math.max(
    0,
    Number(
      tuning.levels[safeComponentKey]
    ) || 0
  );

  if (currentLevel !== safeExpectedLevel) {
    return {
      status: 'level_changed',
      level: currentLevel,
      balance: getBalance(safeVkId)
    };
  }

  const nextLevel = currentLevel + 1;

  if (nextLevel > 5) {
    return {
      status: 'max_level',
      level: currentLevel,
      balance: getBalance(safeVkId)
    };
  }

  const currentBalance =
    getBalance(safeVkId);

  if (currentBalance < safePrice) {
    return {
      status: 'insufficient_funds',
      price: safePrice,
      balance: currentBalance,
      missing: safePrice - currentBalance
    };
  }

  const storageKey =
    `car-tuning:${safeCarKey}:` +
    safeComponentKey;

  try {
    db.run('BEGIN TRANSACTION;');

    db.run(
      `
        UPDATE balances
        SET dollars = dollars - ?
        WHERE vk_id = ?
      `,
      [
        safePrice,
        safeVkId
      ]
    );

    db.run(
      `
        INSERT INTO business_states (
          vk_id,
          item_key,
          upgrade_level,
          last_income_at
        )
        VALUES (?, ?, ?, 0)

        ON CONFLICT(vk_id, item_key)
        DO UPDATE SET
          upgrade_level = excluded.upgrade_level
      `,
      [
        safeVkId,
        storageKey,
        nextLevel
      ]
    );

    db.run('COMMIT;');

    persistDatabase();

    return {
      status: 'upgraded',
      level: nextLevel,
      price: safePrice,
      balance: currentBalance - safePrice
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function validateBankIdentity(vkId) {
  const safeVkId = Number(vkId);

  if (
    !Number.isInteger(safeVkId) ||
    safeVkId <= 0
  ) {
    throw new Error(
      'VK ID должен быть положительным целым числом'
    );
  }

  return safeVkId;
}

function validateBankTime(currentTime) {
  const safeCurrentTime = Number(currentTime);

  if (
    !Number.isSafeInteger(safeCurrentTime) ||
    safeCurrentTime < 0
  ) {
    throw new Error(
      'Некорректное время банковской операции'
    );
  }

  return safeCurrentTime;
}

function validateBankAmount(amount) {
  const safeAmount = Number(amount);

  if (
    !Number.isSafeInteger(safeAmount) ||
    safeAmount <= 0
  ) {
    throw new Error(
      'Сумма должна быть положительным целым числом'
    );
  }

  return safeAmount;
}

function calculateBankHourlyIncomeNumerator(
  balance
) {
  const safeBalance = Number(balance);

  if (
    !Number.isSafeInteger(safeBalance) ||
    safeBalance < 0
  ) {
    throw new Error(
      'Банковский баланс должен быть неотрицательным целым числом'
    );
  }

  const totalBalance = BigInt(safeBalance);
  let lowerBound = 0n;
  let numerator = 0n;

  for (const bracket of BANK_INTEREST_BRACKETS) {
    const upperBound =
      bracket.upperBound === null
        ? totalBalance
        : BigInt(bracket.upperBound);
    const bracketBalance =
      totalBalance > lowerBound
        ? (
          (
            totalBalance < upperBound
              ? totalBalance
              : upperBound
          ) - lowerBound
        )
        : 0n;

    numerator +=
      bracketBalance *
      BigInt(bracket.ppm);

    if (
      bracket.upperBound === null ||
      totalBalance <= upperBound
    ) {
      break;
    }

    lowerBound = upperBound;
  }

  return numerator;
}

function calculateBankHourlyIncome(balance) {
  return Number(
    calculateBankHourlyIncomeNumerator(
      balance
    ) /
    BANK_INTEREST_DENOMINATOR
  );
}

function calculateBankWithdrawalCommission(amount) {
  const safeAmount = validateBankAmount(amount);

  if (safeAmount < BANK_FREE_WITHDRAWAL_LIMIT) {
    return {
      commission: 0,
      commissionBps: 0,
      hourlyIncome: calculateBankHourlyIncome(
        safeAmount
      ),
      payout: safeAmount
    };
  }

  const hourlyIncomeNumerator =
    calculateBankHourlyIncomeNumerator(
      safeAmount
    );
  const commission = Number(
    hourlyIncomeNumerator *
    BigInt(BANK_COMMISSION_INCOME_SHARE_BPS) /
    (
      BANK_INTEREST_DENOMINATOR *
      10_000n
    )
  );
  const commissionBps =
    commission * 10_000 /
    safeAmount;

  return {
    commission,
    commissionBps,
    hourlyIncome: Number(
      hourlyIncomeNumerator /
      BANK_INTEREST_DENOMINATOR
    ),
    payout: safeAmount - commission
  };
}

function readBankAccount(vkId) {
  const statement = db.prepare(`
    SELECT
      balance,
      last_interest_at,
      interest_remainder,
      total_interest
    FROM bank_accounts
    WHERE vk_id = ?
  `);

  statement.bind([vkId]);

  let account = null;

  if (statement.step()) {
    const row = statement.getAsObject();

    account = {
      balance: Number(row.balance) || 0,
      lastInterestAt:
        Number(row.last_interest_at) || 0,
      interestRemainder:
        Number(row.interest_remainder) || 0,
      totalInterest:
        Number(row.total_interest) || 0
    };
  }

  statement.free();

  return account;
}

function getBankAccount(
  vkId,
  currentTime = Date.now()
) {
  ensureDatabase();

  const safeVkId = validateBankIdentity(vkId);
  const safeCurrentTime =
    validateBankTime(currentTime);

  let account = readBankAccount(safeVkId);

  if (!account) {
    db.run(
      `
        INSERT INTO bank_accounts (
          vk_id,
          last_interest_at
        )
        VALUES (?, ?)
      `,
      [
        safeVkId,
        safeCurrentTime
      ]
    );

    persistDatabase();

    account = {
      balance: 0,
      lastInterestAt: safeCurrentTime,
      interestRemainder: 0,
      totalInterest: 0
    };
  }

  const maxElapsed =
    BANK_MAX_INTEREST_HOURS *
    60 * 60 * 1000;
  const rawElapsed = Math.max(
    0,
    safeCurrentTime -
    account.lastInterestAt
  );
  const elapsed = Math.min(
    maxElapsed,
    rawElapsed
  );
  const elapsedHours = Math.floor(
    elapsed /
    (60 * 60 * 1000)
  );

  let interestCredited = 0;

  if (elapsedHours > 0) {
    const hourlyIncomeNumerator =
      calculateBankHourlyIncomeNumerator(
        account.balance
      );
    const numerator =
      hourlyIncomeNumerator *
      BigInt(elapsedHours) +
      BigInt(account.interestRemainder);
    const calculatedInterest = Number(
      numerator /
      BANK_INTEREST_DENOMINATOR
    );
    const capacity =
      Number.MAX_SAFE_INTEGER -
      account.balance;

    interestCredited = Math.min(
      calculatedInterest,
      capacity
    );

    const interestRemainder =
      calculatedInterest > capacity
        ? 0
        : Number(
          numerator %
          BANK_INTEREST_DENOMINATOR
        );
    const newLastInterestAt =
      rawElapsed > maxElapsed
        ? safeCurrentTime
        : (
          account.lastInterestAt +
          elapsedHours *
          60 * 60 * 1000
        );

    db.run(
      `
        UPDATE bank_accounts
        SET
          balance = balance + ?,
          last_interest_at = ?,
          interest_remainder = ?,
          total_interest = MIN(
            ?,
            total_interest + ?
          )
        WHERE vk_id = ?
      `,
      [
        interestCredited,
        newLastInterestAt,
        interestRemainder,
        Number.MAX_SAFE_INTEGER,
        interestCredited,
        safeVkId
      ]
    );

    persistDatabase();

    account.balance += interestCredited;
    account.lastInterestAt =
      newLastInterestAt;
    account.interestRemainder =
      interestRemainder;
    account.totalInterest +=
      interestCredited;
  }

  const hourlyIncome =
    calculateBankHourlyIncome(
      account.balance
    );
  const effectiveRatePercent =
    account.balance > 0
      ? (
        hourlyIncome * 100 /
        account.balance
      )
      : 0;

  return {
    balance: account.balance,
    totalInterest: account.totalInterest,
    interestCredited,
    hourlyIncome,
    effectiveRatePercent,
    lastInterestAt: account.lastInterestAt,
    maxAccrualHours:
      BANK_MAX_INTEREST_HOURS
  };
}

function depositBankFunds({
  vkId,
  amount,
  currentTime = Date.now()
}) {
  ensureDatabase();

  const safeVkId = validateBankIdentity(vkId);
  const safeAmount = validateBankAmount(amount);
  const safeCurrentTime =
    validateBankTime(currentTime);
  const account = getBankAccount(
    safeVkId,
    safeCurrentTime
  );
  const walletBalance = getBalance(safeVkId);

  if (walletBalance < safeAmount) {
    return {
      status: 'insufficient_funds',
      balance: walletBalance,
      missing: safeAmount - walletBalance,
      bankBalance: account.balance
    };
  }

  if (
    account.balance >
    Number.MAX_SAFE_INTEGER - safeAmount
  ) {
    return {
      status: 'balance_limit',
      balance: walletBalance,
      bankBalance: account.balance
    };
  }

  try {
    db.run('BEGIN TRANSACTION;');

    db.run(
      `
        UPDATE balances
        SET dollars = dollars - ?
        WHERE vk_id = ?
      `,
      [
        safeAmount,
        safeVkId
      ]
    );

    db.run(
      `
        UPDATE bank_accounts
        SET
          balance = balance + ?,
          last_interest_at = ?
        WHERE vk_id = ?
      `,
      [
        safeAmount,
        safeCurrentTime,
        safeVkId
      ]
    );

    db.run('COMMIT;');

    persistDatabase();

    return {
      status: 'deposited',
      amount: safeAmount,
      balance: walletBalance - safeAmount,
      bankBalance:
        account.balance + safeAmount,
      interestCredited:
        account.interestCredited
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function previewBankWithdrawal({
  vkId,
  amount,
  currentTime = Date.now()
}) {
  const safeVkId = validateBankIdentity(vkId);
  const safeAmount = validateBankAmount(amount);
  const safeCurrentTime =
    validateBankTime(currentTime);
  const account = getBankAccount(
    safeVkId,
    safeCurrentTime
  );

  if (account.balance < safeAmount) {
    return {
      status: 'insufficient_funds',
      bankBalance: account.balance,
      missing: safeAmount - account.balance
    };
  }

  const quote =
    calculateBankWithdrawalCommission(
      safeAmount
    );
  const vipActive = isPerkActive(
    safeVkId,
    'vip-card',
    safeCurrentTime
  );
  const effectiveQuote = vipActive
    ? {
      ...quote,
      commission: 0,
      commissionBps: 0,
      payout: safeAmount
    }
    : quote;
  const walletBalance = getBalance(safeVkId);

  if (
    walletBalance >
    Number.MAX_SAFE_INTEGER - effectiveQuote.payout
  ) {
    return {
      status: 'balance_limit',
      bankBalance: account.balance,
      balance: walletBalance
    };
  }

  return {
    status: 'ready',
    amount: safeAmount,
    commission: effectiveQuote.commission,
    commissionBps: effectiveQuote.commissionBps,
    payout: effectiveQuote.payout,
    vipActive,
    bankBalance: account.balance,
    balance: walletBalance,
    interestCredited:
      account.interestCredited
  };
}

function withdrawBankFunds({
  vkId,
  amount,
  currentTime = Date.now()
}) {
  ensureDatabase();

  const safeVkId = validateBankIdentity(vkId);
  const safeAmount = validateBankAmount(amount);
  const safeCurrentTime =
    validateBankTime(currentTime);
  const quote = previewBankWithdrawal({
    vkId: safeVkId,
    amount: safeAmount,
    currentTime: safeCurrentTime
  });

  if (quote.status !== 'ready') {
    return quote;
  }

  try {
    db.run('BEGIN TRANSACTION;');

    db.run(
      `
        UPDATE bank_accounts
        SET
          balance = balance - ?,
          last_interest_at = ?
        WHERE vk_id = ?
      `,
      [
        safeAmount,
        safeCurrentTime,
        safeVkId
      ]
    );

    db.run(
      `
        INSERT INTO balances (
          vk_id,
          dollars
        )
        VALUES (?, ?)

        ON CONFLICT(vk_id)
        DO UPDATE SET
          dollars = dollars + excluded.dollars
      `,
      [
        safeVkId,
        quote.payout
      ]
    );

    creditTreasuryInternal(
      quote.commission,
      'bankCommission'
    );

    db.run('COMMIT;');

    persistDatabase();

    return {
      ...quote,
      status: 'withdrawn',
      bankBalance:
        quote.bankBalance - safeAmount,
      balance:
        quote.balance + quote.payout
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function upgradeBusiness({
  vkId,
  itemKey,
  baseIncome,
  upgradeCost,
  currentTime = Date.now()
}) {
  const safeUpgradeCost =
    Number(upgradeCost);

  if (
    !Number.isInteger(safeUpgradeCost) ||
    safeUpgradeCost <= 0
  ) {
    throw new Error(
      'Стоимость улучшения должна быть положительным целым числом'
    );
  }

  const business = getBusinessState({
    vkId,
    itemKey,
    baseIncome,
    currentTime
  });

  if (business.status !== 'owned') {
    return business;
  }

  if (
    business.upgradeLevel >=
    BUSINESS_MAX_UPGRADE_LEVEL
  ) {
    return {
      ...business,
      status: 'max_level'
    };
  }

  const safeVkId = Number(vkId);
  const currentBalance =
    getBalance(safeVkId);

  if (currentBalance < safeUpgradeCost) {
    return {
      status: 'insufficient_funds',
      price: safeUpgradeCost,
      balance: currentBalance,
      missing:
        safeUpgradeCost - currentBalance
    };
  }

  const safeItemKey = String(itemKey).trim();
  const safeCurrentTime = Number(currentTime);
  const nextLevel =
    business.upgradeLevel + 1;

  try {
    db.run('BEGIN TRANSACTION;');

    db.run(
      `
        UPDATE balances
        SET dollars = dollars - ?
        WHERE vk_id = ?
      `,
      [
        safeUpgradeCost,
        safeVkId
      ]
    );

    db.run(
      `
        UPDATE business_states
        SET
          upgrade_level = ?,
          stored_income = ?,
          last_income_at = ?
        WHERE vk_id = ?
          AND item_key = ?
      `,
      [
        nextLevel,
        business.availableIncome,
        safeCurrentTime,
        safeVkId,
        safeItemKey
      ]
    );

    db.run('COMMIT;');

    persistDatabase();

    return {
      status: 'upgraded',
      upgradeLevel: nextLevel,
      multiplier:
        getBusinessMultiplier(nextLevel),
      incomePerHour: Math.floor(
        Number(baseIncome) *
        getBusinessMultiplier(nextLevel)
      ),
      availableIncome:
        business.availableIncome,
      price: safeUpgradeCost,
      balance:
        currentBalance -
        safeUpgradeCost
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function sellBusiness({
  vkId,
  itemKey,
  baseIncome,
  resaleValue,
  currentTime = Date.now()
}) {
  const safeResaleValue =
    Number(resaleValue);

  if (
    !Number.isInteger(safeResaleValue) ||
    safeResaleValue < 0
  ) {
    throw new Error(
      'Некорректная стоимость продажи'
    );
  }

  const business = getBusinessState({
    vkId,
    itemKey,
    baseIncome,
    currentTime
  });

  if (business.status !== 'owned') {
    return business;
  }

  const safeVkId = Number(vkId);
  const safeItemKey = String(itemKey).trim();
  const income = business.availableIncome;
  const payout = safeResaleValue + income;

  try {
    db.run('BEGIN TRANSACTION;');

    db.run(
      `
        DELETE FROM business_states
        WHERE vk_id = ?
          AND item_key = ?
      `,
      [
        safeVkId,
        safeItemKey
      ]
    );

    db.run(
      `
        DELETE FROM magazine_assets
        WHERE vk_id = ?
          AND item_key = ?
          AND item_type = 'businesses'
      `,
      [
        safeVkId,
        safeItemKey
      ]
    );

    if (payout > 0) {
      db.run(
        `
          INSERT INTO balances (
            vk_id,
            dollars
          )
          VALUES (?, ?)

          ON CONFLICT(vk_id)
          DO UPDATE SET
            dollars = dollars + excluded.dollars
        `,
        [
          safeVkId,
          payout
        ]
      );
    }

    db.run('COMMIT;');

    persistDatabase();

    return {
      status: 'sold',
      resaleValue: safeResaleValue,
      income,
      payout,
      balance: getBalance(safeVkId)
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function getActiveJob(vkId) {
  ensureDatabase();

  const safeVkId = Number(vkId);

  if (!Number.isInteger(safeVkId)) {
    throw new Error(
      'VK ID должен быть целым числом'
    );
  }

  const statement = db.prepare(`
    SELECT
      vk_id,
      peer_id,
      job_key,
      started_at,
      ends_at
    FROM active_jobs
    WHERE vk_id = ?
  `);

  statement.bind([safeVkId]);

  let activeJob = null;

  if (statement.step()) {
    const row =
      statement.getAsObject();

    activeJob = {
      vkId: Number(row.vk_id),
      peerId: Number(row.peer_id),
      jobKey: String(row.job_key),
      startedAt: Number(row.started_at),
      endsAt: Number(row.ends_at)
    };
  }

  statement.free();

  return activeJob;
}

function getActiveJobs() {
  ensureDatabase();

  const statement = db.prepare(`
    SELECT
      vk_id,
      peer_id,
      job_key,
      started_at,
      ends_at
    FROM active_jobs
    ORDER BY ends_at ASC
  `);

  const jobs = [];

  while (statement.step()) {
    const row =
      statement.getAsObject();

    jobs.push({
      vkId: Number(row.vk_id),
      peerId: Number(row.peer_id),
      jobKey: String(row.job_key),
      startedAt: Number(row.started_at),
      endsAt: Number(row.ends_at)
    });
  }

  statement.free();

  return jobs;
}

function beginJob({
  vkId,
  peerId,
  jobKey,
  durationMs,
  currentTime = Date.now()
}) {
  ensureDatabase();

  const safeVkId = Number(vkId);
  const safePeerId = Number(peerId);
  const safeJobKey =
    String(jobKey ?? '').trim();
  const safeDuration = Number(durationMs);
  const safeCurrentTime = Number(currentTime);

  if (
    !Number.isInteger(safeVkId) ||
    !Number.isInteger(safePeerId)
  ) {
    throw new Error(
      'VK ID и peer ID должны быть целыми числами'
    );
  }

  if (!safeJobKey) {
    throw new Error(
      'Не указана работа'
    );
  }

  if (
    !Number.isInteger(safeDuration) ||
    safeDuration <= 0 ||
    !Number.isFinite(safeCurrentTime)
  ) {
    throw new Error(
      'Некорректная длительность смены'
    );
  }

  const activeJob =
    getActiveJob(safeVkId);

  if (activeJob) {
    return {
      status: 'active',
      job: activeJob
    };
  }

  const job = {
    vkId: safeVkId,
    peerId: safePeerId,
    jobKey: safeJobKey,
    startedAt: safeCurrentTime,
    endsAt:
      safeCurrentTime + safeDuration
  };

  db.run(
    `
      INSERT INTO active_jobs (
        vk_id,
        peer_id,
        job_key,
        started_at,
        ends_at
      )
      VALUES (?, ?, ?, ?, ?)
    `,
    [
      job.vkId,
      job.peerId,
      job.jobKey,
      job.startedAt,
      job.endsAt
    ]
  );

  persistDatabase();

  return {
    status: 'started',
    job
  };
}

function completeJob({
  vkId,
  jobKey,
  salary,
  currentTime = Date.now()
}) {
  ensureDatabase();

  const safeVkId = Number(vkId);
  const safeJobKey =
    String(jobKey ?? '').trim();
  const safeSalary = Number(salary);
  const safeCurrentTime = Number(currentTime);

  if (!Number.isInteger(safeVkId)) {
    throw new Error(
      'VK ID должен быть целым числом'
    );
  }

  if (!safeJobKey) {
    throw new Error(
      'Не указана работа'
    );
  }

  if (
    !Number.isInteger(safeSalary) ||
    safeSalary <= 0 ||
    !Number.isFinite(safeCurrentTime)
  ) {
    throw new Error(
      'Некорректная зарплата или время завершения'
    );
  }

  const activeJob =
    getActiveJob(safeVkId);

  if (
    !activeJob ||
    activeJob.jobKey !== safeJobKey
  ) {
    return {
      status: 'not_active'
    };
  }

  if (activeJob.endsAt > safeCurrentTime) {
    return {
      status: 'too_early',
      remainingMs:
        activeJob.endsAt - safeCurrentTime
    };
  }

  const currentProfile =
    getJobProfile(safeVkId);

  const currentBoostCount =
    getJobBoostCount(safeVkId);

  const boostUsed =
    currentBoostCount > 0;

  const experienceEarned =
    boostUsed ? 2 : 1;

  const paidSalary =
    boostUsed
      ? safeSalary * 2
      : safeSalary;

  const experienceProgress =
    calculateJobExperienceProgress(
      currentProfile,
      experienceEarned
    );
  const {
    level,
    experience,
    experienceRequired:
      nextExperienceRequired,
    leveledUp,
    levelsGained
  } = experienceProgress;

  try {
    db.run('BEGIN TRANSACTION;');

    db.run(
      `
        DELETE FROM active_jobs
        WHERE vk_id = ?
          AND job_key = ?
      `,
      [
        safeVkId,
        safeJobKey
      ]
    );

    db.run(
      `
        INSERT INTO job_profiles (
          vk_id,
          level,
          experience,
          completed_shifts
        )
        VALUES (?, ?, ?, ?)

        ON CONFLICT(vk_id)
        DO UPDATE SET
          level = excluded.level,
          experience = excluded.experience,
          completed_shifts = excluded.completed_shifts
      `,
      [
        safeVkId,
        level,
        experience,
        currentProfile.completedShifts + 1
      ]
    );

    db.run(
      `
        INSERT INTO balances (
          vk_id,
          dollars
        )
        VALUES (?, ?)

        ON CONFLICT(vk_id)
        DO UPDATE SET
          dollars = dollars + excluded.dollars
      `,
      [
        safeVkId,
        paidSalary
      ]
    );

    if (boostUsed) {
      db.run(
        `
          UPDATE job_boosts
          SET quantity = quantity - 1
          WHERE vk_id = ?
            AND quantity > 0
        `,
        [safeVkId]
      );
    }

    db.run('COMMIT;');

    persistDatabase();

    return {
      status: 'completed',
      salary: paidSalary,
      baseSalary: safeSalary,
      balance: getBalance(safeVkId),
      level,
      experience,
      experienceEarned,
      experienceRequired:
        nextExperienceRequired,
      maxLevel: JOB_MAX_LEVEL,
      isMaxLevel:
        level >= JOB_MAX_LEVEL,
      completedShifts:
        currentProfile.completedShifts + 1,
      boostUsed,
      boostCount:
        currentBoostCount -
        (boostUsed ? 1 : 0),
      leveledUp,
      levelsGained
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function validateQuestStatKey(statKey) {
  const safeStatKey =
    String(statKey ?? '').trim();

  if (!/^[a-z0-9_-]{1,64}$/i.test(safeStatKey)) {
    throw new Error(
      'Некорректный ключ статистики квеста'
    );
  }

  return safeStatKey;
}

function getQuestStat(vkId, statKey) {
  ensureDatabase();

  const safeVkId = Number(vkId);
  const safeStatKey =
    validateQuestStatKey(statKey);

  if (!Number.isInteger(safeVkId)) {
    throw new Error(
      'VK ID должен быть целым числом'
    );
  }

  const statement = db.prepare(`
    SELECT value
    FROM quest_stats
    WHERE vk_id = ?
      AND stat_key = ?
  `);

  statement.bind([
    safeVkId,
    safeStatKey
  ]);

  let value = 0;

  if (statement.step()) {
    value = Math.max(
      0,
      Number(
        statement.getAsObject().value
      ) || 0
    );
  }

  statement.free();

  return value;
}

function incrementQuestStat(
  vkId,
  statKey,
  amount = 1
) {
  ensureDatabase();

  const safeVkId = Number(vkId);
  const safeStatKey =
    validateQuestStatKey(statKey);
  const safeAmount = Number(amount);

  if (!Number.isInteger(safeVkId)) {
    throw new Error(
      'VK ID должен быть целым числом'
    );
  }

  if (
    !Number.isSafeInteger(safeAmount) ||
    safeAmount <= 0
  ) {
    throw new Error(
      'Прогресс квеста должен быть положительным целым числом'
    );
  }

  db.run(
    `
      INSERT INTO quest_stats (
        vk_id,
        stat_key,
        value
      )
      VALUES (?, ?, ?)

      ON CONFLICT(vk_id, stat_key)
      DO UPDATE SET
        value = value + excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      safeVkId,
      safeStatKey,
      safeAmount
    ]
  );

  persistDatabase();

  return getQuestStat(
    safeVkId,
    safeStatKey
  );
}

function getQuestSnapshot(vkId) {
  ensureDatabase();

  const safeVkId = Number(vkId);

  if (!Number.isInteger(safeVkId)) {
    throw new Error(
      'VK ID должен быть целым числом'
    );
  }

  const statsStatement = db.prepare(`
    SELECT
      stat_key,
      value
    FROM quest_stats
    WHERE vk_id = ?
  `);

  statsStatement.bind([safeVkId]);

  const stats = {};

  while (statsStatement.step()) {
    const row =
      statsStatement.getAsObject();

    stats[String(row.stat_key)] = Math.max(
      0,
      Number(row.value) || 0
    );
  }

  statsStatement.free();

  const claimsStatement = db.prepare(`
    SELECT quest_key
    FROM quest_claims
    WHERE vk_id = ?
  `);

  claimsStatement.bind([safeVkId]);

  const claimedQuestKeys = new Set();

  while (claimsStatement.step()) {
    claimedQuestKeys.add(
      String(
        claimsStatement
          .getAsObject()
          .quest_key
      )
    );
  }

  claimsStatement.free();

  const promoStatement = db.prepare(`
    SELECT COUNT(*) AS count
    FROM promo_redemptions
    WHERE vk_id = ?
  `);

  promoStatement.bind([safeVkId]);

  let promosRedeemed = 0;

  if (promoStatement.step()) {
    promosRedeemed = Number(
      promoStatement
        .getAsObject()
        .count
    ) || 0;
  }

  promoStatement.free();

  const auraGivenStatement = db.prepare(`
    SELECT 1
    FROM aura_cooldowns
    WHERE sender_id = ?
      AND last_given_at > 0
    LIMIT 1
  `);

  auraGivenStatement.bind([safeVkId]);
  const hasGivenAura =
    auraGivenStatement.step();
  auraGivenStatement.free();

  const profile = getJobProfile(safeVkId);
  const assets = getMagazineAssets(safeVkId);
  const businessCount = assets.filter(
    asset => asset.itemType === 'businesses'
  ).length;
  const hasVilla = assets.some(
    asset => asset.itemKey === 'house-villa'
  );
  const hasStartedJob =
    profile.completedShifts > 0 ||
    Boolean(getActiveJob(safeVkId));

  stats.jobs_started = Math.max(
    stats.jobs_started || 0,
    hasStartedJob ? 1 : 0
  );
  stats.businesses_bought = Math.max(
    stats.businesses_bought || 0,
    businessCount > 0 ? 1 : 0
  );
  stats.villas_bought = Math.max(
    stats.villas_bought || 0,
    hasVilla ? 1 : 0
  );
  stats.aura_peak = Math.max(
    stats.aura_peak || 0,
    getTotalAura(safeVkId)
  );
  stats.balance_peak = Math.max(
    stats.balance_peak || 0,
    getBalance(safeVkId)
  );
  stats.promos_redeemed = Math.max(
    stats.promos_redeemed || 0,
    promosRedeemed
  );
  stats.aura_given = Math.max(
    stats.aura_given || 0,
    hasGivenAura ? 1 : 0
  );

  return {
    stats,
    claimedQuestKeys,
    level: profile.level,
    experience: profile.experience
  };
}

function hasClaimedQuest(vkId, questKey) {
  const snapshot = getQuestSnapshot(vkId);

  return snapshot.claimedQuestKeys.has(
    String(questKey)
  );
}

function claimQuestReward({
  vkId,
  questKey,
  rewards
}) {
  ensureDatabase();

  const safeVkId = Number(vkId);
  const safeQuestKey =
    String(questKey ?? '').trim();

  if (!Number.isInteger(safeVkId)) {
    throw new Error(
      'VK ID должен быть целым числом'
    );
  }

  if (!/^[a-z0-9_-]{1,64}$/i.test(safeQuestKey)) {
    throw new Error(
      'Некорректный ключ квеста'
    );
  }

  if (hasClaimedQuest(safeVkId, safeQuestKey)) {
    return {
      status: 'already_claimed'
    };
  }

  const dollars = Number(rewards?.dollars ?? 0);
  const aura = Number(rewards?.aura ?? 0);
  const boosts = Number(rewards?.boosts ?? 0);
  const experienceEarned = Number(
    rewards?.experience ?? 0
  );

  for (const [label, value] of [
    ['долларов', dollars],
    ['ауры', aura],
    ['бустов', boosts],
    ['EXP', experienceEarned]
  ]) {
    if (
      !Number.isSafeInteger(value) ||
      value < 0
    ) {
      throw new Error(
        `Некорректная награда: ${label}`
      );
    }
  }

  const asset = rewards?.asset ?? null;
  let assetAlreadyOwned = false;
  let assetCompensation = 0;

  if (asset) {
    const itemKey =
      String(asset.itemKey ?? '').trim();
    const itemType =
      String(asset.itemType ?? '').trim();
    const price = Number(asset.price);

    if (
      !itemKey ||
      !itemType ||
      !Number.isSafeInteger(price) ||
      price <= 0
    ) {
      throw new Error(
        'Некорректная награда имуществом'
      );
    }

    assetAlreadyOwned = getMagazineAssets(
      safeVkId
    ).some(item => item.itemKey === itemKey);

    if (assetAlreadyOwned) {
      assetCompensation = Math.floor(
        price * 0.7
      );
    }
  }

  const totalDollars =
    dollars + assetCompensation;
  const currentBalance =
    getBalance(safeVkId);

  if (
    !Number.isSafeInteger(totalDollars) ||
    currentBalance >
      Number.MAX_SAFE_INTEGER - totalDollars
  ) {
    return {
      status: 'balance_limit'
    };
  }

  const currentProfile =
    getJobProfile(safeVkId);
  const experienceProgress =
    calculateJobExperienceProgress(
      currentProfile,
      experienceEarned
    );

  try {
    db.run('BEGIN TRANSACTION;');

    db.run(
      `
        INSERT INTO quest_claims (
          vk_id,
          quest_key
        )
        VALUES (?, ?)
      `,
      [
        safeVkId,
        safeQuestKey
      ]
    );

    if (totalDollars > 0) {
      db.run(
        `
          INSERT INTO balances (
            vk_id,
            dollars
          )
          VALUES (?, ?)

          ON CONFLICT(vk_id)
          DO UPDATE SET
            dollars = dollars + excluded.dollars
        `,
        [
          safeVkId,
          totalDollars
        ]
      );
    }

    if (aura > 0) {
      db.run(
        `
          INSERT INTO aura (
            peer_id,
            vk_id,
            aura
          )
          VALUES (0, ?, ?)

          ON CONFLICT(peer_id, vk_id)
          DO UPDATE SET
            aura = aura + excluded.aura
        `,
        [
          safeVkId,
          aura
        ]
      );
    }

    if (boosts > 0) {
      db.run(
        `
          INSERT INTO job_boosts (
            vk_id,
            quantity
          )
          VALUES (?, ?)

          ON CONFLICT(vk_id)
          DO UPDATE SET
            quantity = quantity + excluded.quantity
        `,
        [
          safeVkId,
          boosts
        ]
      );
    }

    if (experienceEarned > 0) {
      db.run(
        `
          INSERT INTO job_profiles (
            vk_id,
            level,
            experience,
            completed_shifts
          )
          VALUES (?, ?, ?, ?)

          ON CONFLICT(vk_id)
          DO UPDATE SET
            level = excluded.level,
            experience = excluded.experience
        `,
        [
          safeVkId,
          experienceProgress.level,
          experienceProgress.experience,
          currentProfile.completedShifts
        ]
      );
    }

    if (asset && !assetAlreadyOwned) {
      db.run(
        `
          INSERT INTO magazine_assets (
            vk_id,
            item_key,
            item_type
          )
          VALUES (?, ?, ?)
        `,
        [
          safeVkId,
          String(asset.itemKey),
          String(asset.itemType)
        ]
      );

      if (asset.itemType === 'businesses') {
        db.run(
          `
            INSERT OR IGNORE INTO business_states (
              vk_id,
              item_key,
              last_income_at
            )
            VALUES (?, ?, ?)
          `,
          [
            safeVkId,
            String(asset.itemKey),
            Date.now()
          ]
        );
      }
    }

    db.run('COMMIT;');

    persistDatabase();

    return {
      status: 'claimed',
      dollars,
      aura,
      boosts,
      experienceEarned,
      level: experienceProgress.level,
      experience: experienceProgress.experience,
      levelsGained:
        experienceProgress.levelsGained,
      asset: asset
        ? {
          itemKey: String(asset.itemKey),
          title: String(
            asset.title ?? asset.itemKey
          ),
          granted: !assetAlreadyOwned,
          compensation: assetCompensation
        }
        : null,
      balance: getBalance(safeVkId),
      totalAura: getTotalAura(safeVkId),
      boostCount: getJobBoostCount(safeVkId)
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function removeAuraAmount(
  vkId,
  amount
) {
  ensureDatabase();

  const safeAmount =
    Number(amount);

  if (
    !Number.isInteger(safeAmount) ||
    safeAmount <= 0
  ) {
    throw new Error(
      'Количество ауры должно быть положительным целым числом'
    );
  }

  const currentTotal =
    getTotalAura(vkId);

  let remaining =
    Math.min(
      safeAmount,
      currentTotal
    );

  const removed =
    remaining;

  if (remaining <= 0) {
    return {
      removed: 0,
      totalAura: currentTotal
    };
  }

  try {
    db.run('BEGIN TRANSACTION;');

    const statement = db.prepare(`
      SELECT
        peer_id,
        aura
      FROM aura
      WHERE vk_id = ?
        AND aura > 0
      ORDER BY
        CASE
          WHEN peer_id = 0 THEN 0
          ELSE 1
        END,
        peer_id ASC
    `);

    statement.bind([
      vkId
    ]);

    const rows = [];

    while (statement.step()) {
      const row =
        statement.getAsObject();

      rows.push({
        peerId:
          Number(row.peer_id),
        aura:
          Number(row.aura) || 0
      });
    }

    statement.free();

    for (const row of rows) {
      if (remaining <= 0) {
        break;
      }

      const subtract =
        Math.min(
          row.aura,
          remaining
        );

      const newAura =
        row.aura - subtract;

      if (newAura <= 0) {
        db.run(
          `
            DELETE FROM aura
            WHERE peer_id = ?
              AND vk_id = ?
          `,
          [
            row.peerId,
            vkId
          ]
        );
      } else {
        db.run(
          `
            UPDATE aura
            SET aura = ?
            WHERE peer_id = ?
              AND vk_id = ?
          `,
          [
            newAura,
            row.peerId,
            vkId
          ]
        );
      }

      remaining -=
        subtract;
    }

    db.run('COMMIT;');

    persistDatabase();

    return {
      removed,
      totalAura:
        getTotalAura(vkId)
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не начаться.
    }

    throw error;
  }
}

function setTotalAura(
  vkId,
  amount
) {
  ensureDatabase();

  const safeAmount =
    Number(amount);

  if (
    !Number.isInteger(safeAmount) ||
    safeAmount < 0
  ) {
    throw new Error(
      'Количество ауры должно быть неотрицательным целым числом'
    );
  }

  const currentTotal =
    getTotalAura(vkId);

  if (safeAmount > currentTotal) {
    addAuraAmount(
      0,
      vkId,
      safeAmount - currentTotal
    );
  } else if (
    safeAmount < currentTotal
  ) {
    removeAuraAmount(
      vkId,
      currentTotal - safeAmount
    );
  }

  return getTotalAura(vkId);
}

function resetTotalAura(vkId) {
  ensureDatabase();

  db.run(
    `
      DELETE FROM aura
      WHERE vk_id = ?
    `,
    [
      vkId
    ]
  );

  persistDatabase();

  return 0;
}

function getAuraRank(vkId) {
  ensureDatabase();

  const statement = db.prepare(`
    WITH aura_totals AS (
      SELECT
        vk_id,
        SUM(aura) AS total_aura
      FROM aura
      GROUP BY vk_id
    ),
    ranked AS (
      SELECT
        vk_id,
        ROW_NUMBER() OVER (
          ORDER BY
            total_aura DESC,
            vk_id ASC
        ) AS position
      FROM aura_totals
      WHERE total_aura > 0
    )
    SELECT position
    FROM ranked
    WHERE vk_id = ?
  `);

  statement.bind([
    vkId
  ]);

  let rank = null;

  if (statement.step()) {
    const row =
      statement.getAsObject();

    rank =
      Number(row.position) || null;
  }

  statement.free();

  return rank;
}

function normalizePromoCode(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase();
}

function getAdminStatistics() {
  ensureDatabase();

  function getScalar(query) {
    const statement = db.prepare(query);
    let value = 0;

    if (statement.step()) {
      const row = statement.getAsObject();
      const firstValue = Object.values(row)[0];

      value = Number(firstValue) || 0;
    }

    statement.free();

    return value;
  }

  return {
    users: getScalar(`
      SELECT COUNT(*)
      FROM users
      WHERE vk_id > 0
    `),
    totalBalance: getScalar(`
      SELECT COALESCE(SUM(dollars), 0)
      FROM balances
    `),
    totalBankBalance: getScalar(`
      SELECT COALESCE(SUM(balance), 0)
      FROM bank_accounts
    `),
    totalAura: getScalar(`
      SELECT COALESCE(SUM(aura), 0)
      FROM aura
    `),
    assets: getScalar(`
      SELECT COUNT(*)
      FROM magazine_assets
    `),
    businesses: getScalar(`
      SELECT COUNT(*)
      FROM magazine_assets
      WHERE item_type = 'businesses'
    `),
    phoneSims: getScalar(`
      SELECT COUNT(*)
      FROM phone_sims
    `),
    farmOwners: getScalar(`
      SELECT COUNT(*)
      FROM farm_profiles
      WHERE plot_count > 0
    `),
    plantedFarmPlots: getScalar(`
      SELECT COUNT(*)
      FROM farm_plots
    `),
    activeJobs: getScalar(`
      SELECT COUNT(*)
      FROM active_jobs
    `),
    ringingCalls: getScalar(`
      SELECT COUNT(*)
      FROM phone_calls
      WHERE status = 'ringing'
    `),
    activeCalls: getScalar(`
      SELECT COUNT(*)
      FROM phone_calls
      WHERE status = 'active'
    `),
    lootCaseItems: getScalar(`
      SELECT COUNT(*)
      FROM loot_case_inventory
    `),
    lootCaseWarehouseValue: getScalar(`
      SELECT COALESCE(SUM(sell_value), 0)
      FROM loot_case_inventory
    `),
    lootCasesOpened: getScalar(`
      SELECT COALESCE(SUM(opened_count), 0)
      FROM loot_case_stats
    `),
    promos: getScalar(`
      SELECT COUNT(*)
      FROM promos
    `),
    promoRedemptions: getScalar(`
      SELECT COUNT(*)
      FROM promo_redemptions
    `)
  };
}

function getPromoOverview(limit = 20) {
  ensureDatabase();

  const safeLimit = Math.max(
    1,
    Math.min(Number(limit) || 20, 50)
  );
  const statement = db.prepare(`
    SELECT
      promos.code,
      promos.reward_type,
      promos.amount,
      promos.created_by,
      promos.created_at,
      COUNT(promo_redemptions.vk_id) AS redemptions
    FROM promos
    LEFT JOIN promo_redemptions
      ON promo_redemptions.code = promos.code COLLATE NOCASE
    GROUP BY
      promos.code,
      promos.reward_type,
      promos.amount,
      promos.created_by,
      promos.created_at
    ORDER BY promos.created_at DESC
    LIMIT ?
  `);

  statement.bind([safeLimit]);
  const promos = [];

  while (statement.step()) {
    const row = statement.getAsObject();

    promos.push({
      code: String(row.code),
      rewardType: String(row.reward_type),
      amount: Number(row.amount) || 0,
      createdBy: Number(row.created_by),
      createdAt: String(row.created_at),
      redemptions:
        Number(row.redemptions) || 0
    });
  }

  statement.free();

  return promos;
}

function createPromo({
  code,
  rewardType,
  amount,
  createdBy
}) {
  ensureDatabase();

  const safeCode =
    normalizePromoCode(code);

  const safeRewardType =
    String(rewardType ?? '')
      .trim()
      .toLowerCase();

  const safeAmount = Number(amount);
  const safeCreatedBy = Number(createdBy);

  if (
    !safeCode ||
    !/^[\p{L}\p{N}_-]{1,32}$/u.test(safeCode)
  ) {
    throw new Error(
      'Промокод должен содержать от 1 до 32 букв, цифр, дефисов или подчёркиваний'
    );
  }

  if (
    safeRewardType !== 'aura' &&
    safeRewardType !== 'dollars'
  ) {
    throw new Error(
      'Неизвестный тип награды'
    );
  }

  if (
    !Number.isInteger(safeAmount) ||
    safeAmount <= 0
  ) {
    throw new Error(
      'Награда должна быть положительным целым числом'
    );
  }

  if (!Number.isInteger(safeCreatedBy)) {
    throw new Error(
      'VK ID создателя должен быть целым числом'
    );
  }

  const existing = db.prepare(`
    SELECT code
    FROM promos
    WHERE code = ? COLLATE NOCASE
  `);

  existing.bind([safeCode]);

  const alreadyExists =
    existing.step();

  existing.free();

  if (alreadyExists) {
    return {
      status: 'exists',
      code: safeCode
    };
  }

  db.run(
    `
      INSERT INTO promos (
        code,
        reward_type,
        amount,
        created_by
      )
      VALUES (?, ?, ?, ?)
    `,
    [
      safeCode,
      safeRewardType,
      safeAmount,
      safeCreatedBy
    ]
  );

  persistDatabase();

  return {
    status: 'created',
    code: safeCode,
    rewardType: safeRewardType,
    amount: safeAmount
  };
}

function redeemPromo(vkId, code) {
  ensureDatabase();

  const safeVkId = Number(vkId);
  const safeCode =
    normalizePromoCode(code);

  if (!Number.isInteger(safeVkId)) {
    throw new Error(
      'VK ID должен быть целым числом'
    );
  }

  if (!safeCode) {
    return {
      status: 'not_found'
    };
  }

  const promoStatement = db.prepare(`
    SELECT
      code,
      reward_type,
      amount
    FROM promos
    WHERE code = ? COLLATE NOCASE
  `);

  promoStatement.bind([safeCode]);

  let promo = null;

  if (promoStatement.step()) {
    const row =
      promoStatement.getAsObject();

    promo = {
      code: String(row.code),
      rewardType:
        String(row.reward_type),
      amount:
        Number(row.amount) || 0
    };
  }

  promoStatement.free();

  if (!promo) {
    return {
      status: 'not_found'
    };
  }

  const usedStatement = db.prepare(`
    SELECT 1
    FROM promo_redemptions
    WHERE code = ? COLLATE NOCASE
      AND vk_id = ?
  `);

  usedStatement.bind([
    promo.code,
    safeVkId
  ]);

  const alreadyUsed =
    usedStatement.step();

  usedStatement.free();

  if (alreadyUsed) {
    return {
      status: 'already_used',
      code: promo.code
    };
  }

  try {
    db.run('BEGIN TRANSACTION;');

    db.run(
      `
        INSERT INTO promo_redemptions (
          code,
          vk_id
        )
        VALUES (?, ?)
      `,
      [
        promo.code,
        safeVkId
      ]
    );

    if (promo.rewardType === 'aura') {
      db.run(
        `
          INSERT INTO aura (
            peer_id,
            vk_id,
            aura
          )
          VALUES (0, ?, ?)

          ON CONFLICT(peer_id, vk_id)
          DO UPDATE SET
            aura = aura + excluded.aura
        `,
        [
          safeVkId,
          promo.amount
        ]
      );
    } else {
      db.run(
        `
          INSERT INTO balances (
            vk_id,
            dollars
          )
          VALUES (?, ?)

          ON CONFLICT(vk_id)
          DO UPDATE SET
            dollars = dollars + excluded.dollars
        `,
        [
          safeVkId,
          promo.amount
        ]
      );
    }

    db.run('COMMIT;');

    persistDatabase();

    const total =
      promo.rewardType === 'aura'
        ? getTotalAura(safeVkId)
        : getBalance(safeVkId);

    return {
      status: 'redeemed',
      code: promo.code,
      rewardType: promo.rewardType,
      amount: promo.amount,
      total
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}


function validateFarmVkId(vkId) {
  const safeVkId = Number(vkId);

  if (!Number.isInteger(safeVkId)) {
    throw new Error(
      'VK ID фермера должен быть целым числом'
    );
  }

  return safeVkId;
}

function readFarmProfile(vkId) {
  const statement = db.prepare(`
    SELECT
      plot_count,
      irrigation_level,
      soil_level,
      warehouse_level,
      next_plant_at,
      next_harvest_at,
      total_harvested,
      total_earned
    FROM farm_profiles
    WHERE vk_id = ?
  `);

  statement.bind([vkId]);

  let profile = null;

  if (statement.step()) {
    const row = statement.getAsObject();

    profile = {
      plotCount: Number(row.plot_count) || 0,
      irrigationLevel:
        Number(row.irrigation_level) || 0,
      soilLevel:
        Number(row.soil_level) || 0,
      warehouseLevel:
        Number(row.warehouse_level) || 0,
      nextPlantAt:
        Number(row.next_plant_at) || 0,
      nextHarvestAt:
        Number(row.next_harvest_at) || 0,
      totalHarvested:
        Number(row.total_harvested) || 0,
      totalEarned:
        Number(row.total_earned) || 0
    };
  }

  statement.free();

  return profile;
}

function getFarmState(vkId) {
  ensureDatabase();

  const safeVkId = validateFarmVkId(vkId);
  const profile = readFarmProfile(safeVkId) ?? {
    plotCount: 0,
    irrigationLevel: 0,
    soilLevel: 0,
    warehouseLevel: 0,
    nextPlantAt: 0,
    nextHarvestAt: 0,
    totalHarvested: 0,
    totalEarned: 0
  };
  const plots = [];
  const plotStatement = db.prepare(`
    SELECT
      plot_number,
      crop_key,
      seed_quantity,
      planted_at,
      ready_at,
      result_code,
      yield_amount,
      notified_at
    FROM farm_plots
    WHERE vk_id = ?
    ORDER BY plot_number ASC
  `);

  plotStatement.bind([safeVkId]);

  while (plotStatement.step()) {
    const row = plotStatement.getAsObject();

    plots.push({
      plotNumber: Number(row.plot_number),
      cropKey: String(row.crop_key),
      seedQuantity:
        Number(row.seed_quantity) || 1,
      plantedAt: Number(row.planted_at),
      readyAt: Number(row.ready_at),
      resultCode: String(row.result_code),
      yieldAmount: Number(row.yield_amount) || 0,
      notifiedAt: Number(row.notified_at) || 0
    });
  }

  plotStatement.free();

  const seeds = [];
  const seedStatement = db.prepare(`
    SELECT crop_key, quantity
    FROM farm_seeds
    WHERE vk_id = ?
      AND quantity > 0
    ORDER BY crop_key ASC
  `);

  seedStatement.bind([safeVkId]);

  while (seedStatement.step()) {
    const row = seedStatement.getAsObject();

    seeds.push({
      cropKey: String(row.crop_key),
      quantity: Number(row.quantity) || 0
    });
  }

  seedStatement.free();

  const storage = [];
  const storageStatement = db.prepare(`
    SELECT crop_key, quantity
    FROM farm_storage
    WHERE vk_id = ?
      AND quantity > 0
    ORDER BY crop_key ASC
  `);

  storageStatement.bind([safeVkId]);

  while (storageStatement.step()) {
    const row = storageStatement.getAsObject();

    storage.push({
      cropKey: String(row.crop_key),
      quantity: Number(row.quantity) || 0
    });
  }

  storageStatement.free();

  return {
    ...profile,
    plots,
    seeds,
    storage,
    storageUsed: storage.reduce(
      (sum, item) => sum + item.quantity,
      0
    )
  };
}

function getPendingFarmNotifications() {
  ensureDatabase();

  const statement = db.prepare(`
    SELECT
      vk_id,
      plot_number,
      crop_key,
      seed_quantity,
      ready_at
    FROM farm_plots
    WHERE notified_at = 0
    ORDER BY ready_at ASC
  `);
  const notifications = [];

  while (statement.step()) {
    const row = statement.getAsObject();

    notifications.push({
      vkId: Number(row.vk_id),
      plotNumber: Number(row.plot_number),
      cropKey: String(row.crop_key),
      seedQuantity:
        Number(row.seed_quantity) || 1,
      readyAt: Number(row.ready_at)
    });
  }

  statement.free();

  return notifications;
}

function claimFarmHarvestNotification({
  vkId,
  plotNumber,
  currentTime = Date.now()
}) {
  ensureDatabase();

  const safeVkId = validateFarmVkId(vkId);
  const safePlotNumber = Number(plotNumber);
  const safeCurrentTime = Number(currentTime);

  if (
    !Number.isInteger(safePlotNumber) ||
    safePlotNumber < 1 ||
    safePlotNumber > FARM_MAX_PLOTS ||
    !Number.isSafeInteger(safeCurrentTime) ||
    safeCurrentTime < 0
  ) {
    throw new Error(
      'Некорректные данные уведомления фермы'
    );
  }

  const statement = db.prepare(`
    SELECT
      crop_key,
      seed_quantity,
      ready_at,
      notified_at
    FROM farm_plots
    WHERE vk_id = ?
      AND plot_number = ?
  `);

  statement.bind([
    safeVkId,
    safePlotNumber
  ]);

  let plot = null;

  if (statement.step()) {
    const row = statement.getAsObject();

    plot = {
      cropKey: String(row.crop_key),
      seedQuantity:
        Number(row.seed_quantity) || 1,
      readyAt: Number(row.ready_at),
      notifiedAt:
        Number(row.notified_at) || 0
    };
  }

  statement.free();

  if (!plot) {
    return { status: 'missing' };
  }

  if (plot.notifiedAt > 0) {
    return {
      status: 'already_notified',
      ...plot
    };
  }

  if (plot.readyAt > safeCurrentTime) {
    return {
      status: 'too_early',
      ...plot
    };
  }

  db.run(
    `
      UPDATE farm_plots
      SET notified_at = ?
      WHERE vk_id = ?
        AND plot_number = ?
        AND notified_at = 0
    `,
    [
      Math.max(1, safeCurrentTime),
      safeVkId,
      safePlotNumber
    ]
  );

  persistDatabase();

  return {
    status: 'claimed',
    vkId: safeVkId,
    plotNumber: safePlotNumber,
    cropKey: plot.cropKey,
    seedQuantity: plot.seedQuantity,
    readyAt: plot.readyAt,
    notifiedAt:
      Math.max(1, safeCurrentTime)
  };
}

function purchaseFarmPlot({
  vkId,
  price
}) {
  ensureDatabase();

  const safeVkId = validateFarmVkId(vkId);
  const safePrice = Number(price);

  if (
    !Number.isSafeInteger(safePrice) ||
    safePrice <= 0
  ) {
    throw new Error(
      'Некорректная стоимость участка'
    );
  }

  const state = getFarmState(safeVkId);

  if (state.plotCount >= FARM_MAX_PLOTS) {
    return {
      status: 'max_plots',
      plotCount: state.plotCount
    };
  }

  const balance = getBalance(safeVkId);

  if (balance < safePrice) {
    return {
      status: 'insufficient_funds',
      price: safePrice,
      balance,
      missing: safePrice - balance
    };
  }

  try {
    db.run('BEGIN TRANSACTION;');

    db.run(
      `
        UPDATE balances
        SET dollars = dollars - ?
        WHERE vk_id = ?
      `,
      [safePrice, safeVkId]
    );

    db.run(
      `
        INSERT INTO farm_profiles (
          vk_id,
          plot_count
        )
        VALUES (?, 1)

        ON CONFLICT(vk_id)
        DO UPDATE SET
          plot_count = plot_count + 1
      `,
      [safeVkId]
    );

    db.run('COMMIT;');
    persistDatabase();

    return {
      status: 'purchased',
      price: safePrice,
      plotCount: state.plotCount + 1,
      balance: balance - safePrice
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function purchaseFarmSeeds({
  vkId,
  cropKey,
  quantity,
  unitPrice,
  requiredPlots
}) {
  ensureDatabase();

  const safeVkId = validateFarmVkId(vkId);
  const safeCropKey =
    String(cropKey ?? '').trim();
  const safeQuantity = Number(quantity);
  const safeUnitPrice = Number(unitPrice);
  const safeRequiredPlots = Number(requiredPlots);

  if (!safeCropKey) {
    throw new Error('Не указана культура');
  }

  if (
    !Number.isInteger(safeQuantity) ||
    safeQuantity <= 0 ||
    safeQuantity > 1000
  ) {
    throw new Error(
      'Количество семян должно быть от 1 до 1000'
    );
  }

  if (
    !Number.isSafeInteger(safeUnitPrice) ||
    safeUnitPrice <= 0 ||
    !Number.isInteger(safeRequiredPlots) ||
    safeRequiredPlots < 1 ||
    safeRequiredPlots > FARM_MAX_PLOTS
  ) {
    throw new Error(
      'Некорректная цена или условие семян'
    );
  }

  const state = getFarmState(safeVkId);

  if (state.plotCount === 0) {
    return { status: 'no_farm' };
  }

  if (state.plotCount < safeRequiredPlots) {
    return {
      status: 'crop_locked',
      requiredPlots: safeRequiredPlots,
      plotCount: state.plotCount
    };
  }

  const price = safeUnitPrice * safeQuantity;
  const balance = getBalance(safeVkId);

  if (
    !Number.isSafeInteger(price) ||
    price <= 0
  ) {
    throw new Error(
      'Стоимость покупки вышла за допустимый предел'
    );
  }

  if (balance < price) {
    return {
      status: 'insufficient_funds',
      price,
      balance,
      missing: price - balance
    };
  }

  const currentQuantity =
    state.seeds.find(item =>
      item.cropKey === safeCropKey
    )?.quantity ?? 0;

  try {
    db.run('BEGIN TRANSACTION;');

    db.run(
      `
        UPDATE balances
        SET dollars = dollars - ?
        WHERE vk_id = ?
      `,
      [price, safeVkId]
    );

    db.run(
      `
        INSERT INTO farm_seeds (
          vk_id,
          crop_key,
          quantity
        )
        VALUES (?, ?, ?)

        ON CONFLICT(vk_id, crop_key)
        DO UPDATE SET
          quantity = quantity + excluded.quantity
      `,
      [
        safeVkId,
        safeCropKey,
        safeQuantity
      ]
    );

    db.run('COMMIT;');
    persistDatabase();

    return {
      status: 'purchased',
      cropKey: safeCropKey,
      quantity: safeQuantity,
      seedCount:
        currentQuantity + safeQuantity,
      price,
      balance: balance - price
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function plantFarmCrop({
  vkId,
  plotNumber,
  cropKey,
  seedQuantity = 1,
  requiredPlots,
  currentTime = Date.now(),
  readyAt,
  resultCode,
  yieldAmount,
  cooldownMs
}) {
  ensureDatabase();

  const safeVkId = validateFarmVkId(vkId);
  const safePlotNumber = Number(plotNumber);
  const safeCropKey =
    String(cropKey ?? '').trim();
  const safeSeedQuantity =
    Number(seedQuantity);
  const safeRequiredPlots = Number(requiredPlots);
  const safeCurrentTime = Number(currentTime);
  const safeReadyAt = Number(readyAt);
  const safeResultCode =
    String(resultCode ?? '').trim();
  const safeYieldAmount = Number(yieldAmount);
  const safeCooldownMs = Number(cooldownMs);

  if (
    !Number.isInteger(safePlotNumber) ||
    safePlotNumber < 1 ||
    safePlotNumber > FARM_MAX_PLOTS ||
    !safeCropKey ||
    !Number.isInteger(safeSeedQuantity) ||
    safeSeedQuantity < 1 ||
    safeSeedQuantity > 1000 ||
    !Number.isInteger(safeRequiredPlots) ||
    safeRequiredPlots < 1 ||
    safeRequiredPlots > FARM_MAX_PLOTS ||
    !Number.isSafeInteger(safeCurrentTime) ||
    !Number.isSafeInteger(safeReadyAt) ||
    safeReadyAt <= safeCurrentTime ||
    !['success', 'not_sprouted', 'withered']
      .includes(safeResultCode) ||
    !Number.isSafeInteger(safeYieldAmount) ||
    safeYieldAmount < 0 ||
    !Number.isSafeInteger(safeCooldownMs) ||
    safeCooldownMs < 0
  ) {
    throw new Error(
      'Некорректные данные посадки'
    );
  }

  if (
    safeResultCode === 'success' &&
    safeYieldAmount < 1
  ) {
    throw new Error(
      'Успешная посадка должна дать урожай'
    );
  }

  const state = getFarmState(safeVkId);

  if (
    state.plotCount === 0 ||
    safePlotNumber > state.plotCount
  ) {
    return {
      status: 'plot_locked',
      plotCount: state.plotCount
    };
  }

  if (state.plotCount < safeRequiredPlots) {
    return {
      status: 'crop_locked',
      requiredPlots: safeRequiredPlots,
      plotCount: state.plotCount
    };
  }

  if (state.nextPlantAt > safeCurrentTime) {
    return {
      status: 'cooldown',
      readyAt: state.nextPlantAt,
      remainingMs:
        state.nextPlantAt - safeCurrentTime
    };
  }

  if (state.plots.some(plot =>
    plot.plotNumber === safePlotNumber
  )) {
    return { status: 'plot_occupied' };
  }

  const seedCount =
    state.seeds.find(seed =>
      seed.cropKey === safeCropKey
    )?.quantity ?? 0;

  if (seedCount < safeSeedQuantity) {
    return {
      status: 'insufficient_seeds',
      seedCount,
      requestedQuantity: safeSeedQuantity
    };
  }

  try {
    db.run('BEGIN TRANSACTION;');

    db.run(
      `
        UPDATE farm_seeds
        SET quantity = quantity - ?
        WHERE vk_id = ?
          AND crop_key = ?
      `,
      [
        safeSeedQuantity,
        safeVkId,
        safeCropKey
      ]
    );

    db.run(
      `
        DELETE FROM farm_seeds
        WHERE vk_id = ?
          AND crop_key = ?
          AND quantity <= 0
      `,
      [safeVkId, safeCropKey]
    );

    db.run(
      `
        INSERT INTO farm_plots (
          vk_id,
          plot_number,
          crop_key,
          seed_quantity,
          planted_at,
          ready_at,
          result_code,
          yield_amount
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        safeVkId,
        safePlotNumber,
        safeCropKey,
        safeSeedQuantity,
        safeCurrentTime,
        safeReadyAt,
        safeResultCode,
        safeYieldAmount
      ]
    );

    db.run(
      `
        UPDATE farm_profiles
        SET next_plant_at = ?
        WHERE vk_id = ?
      `,
      [
        safeCurrentTime + safeCooldownMs,
        safeVkId
      ]
    );

    db.run('COMMIT;');
    persistDatabase();

    return {
      status: 'planted',
      plotNumber: safePlotNumber,
      cropKey: safeCropKey,
      seedQuantity: safeSeedQuantity,
      readyAt: safeReadyAt,
      seedCount:
        seedCount - safeSeedQuantity
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function harvestFarmCrop({
  vkId,
  plotNumber,
  warehouseCapacity,
  currentTime = Date.now(),
  cooldownMs
}) {
  ensureDatabase();

  const safeVkId = validateFarmVkId(vkId);
  const safePlotNumber = Number(plotNumber);
  const safeWarehouseCapacity =
    Number(warehouseCapacity);
  const safeCurrentTime = Number(currentTime);
  const safeCooldownMs = Number(cooldownMs);

  if (
    !Number.isInteger(safePlotNumber) ||
    safePlotNumber < 1 ||
    safePlotNumber > FARM_MAX_PLOTS ||
    !Number.isSafeInteger(
      safeWarehouseCapacity
    ) ||
    safeWarehouseCapacity < 1 ||
    !Number.isSafeInteger(safeCurrentTime) ||
    !Number.isSafeInteger(safeCooldownMs) ||
    safeCooldownMs < 0
  ) {
    throw new Error(
      'Некорректные данные сбора урожая'
    );
  }

  const state = getFarmState(safeVkId);
  const plot = state.plots.find(item =>
    item.plotNumber === safePlotNumber
  );

  if (!plot) {
    return { status: 'plot_empty' };
  }

  if (plot.readyAt > safeCurrentTime) {
    return {
      status: 'growing',
      readyAt: plot.readyAt,
      remainingMs:
        plot.readyAt - safeCurrentTime
    };
  }

  if (state.nextHarvestAt > safeCurrentTime) {
    return {
      status: 'cooldown',
      readyAt: state.nextHarvestAt,
      remainingMs:
        state.nextHarvestAt - safeCurrentTime
    };
  }

  if (
    plot.resultCode === 'success' &&
    state.storageUsed + plot.yieldAmount >
      safeWarehouseCapacity
  ) {
    return {
      status: 'warehouse_full',
      requiredSpace: plot.yieldAmount,
      freeSpace:
        safeWarehouseCapacity -
        state.storageUsed
    };
  }

  try {
    db.run('BEGIN TRANSACTION;');

    db.run(
      `
        DELETE FROM farm_plots
        WHERE vk_id = ?
          AND plot_number = ?
      `,
      [safeVkId, safePlotNumber]
    );

    db.run(
      `
        UPDATE farm_profiles
        SET
          next_harvest_at = ?,
          total_harvested =
            total_harvested + ?
        WHERE vk_id = ?
      `,
      [
        safeCurrentTime + safeCooldownMs,
        plot.resultCode === 'success'
          ? plot.yieldAmount
          : 0,
        safeVkId
      ]
    );

    if (plot.resultCode === 'success') {
      db.run(
        `
          INSERT INTO farm_storage (
            vk_id,
            crop_key,
            quantity
          )
          VALUES (?, ?, ?)

          ON CONFLICT(vk_id, crop_key)
          DO UPDATE SET
            quantity = quantity + excluded.quantity
        `,
        [
          safeVkId,
          plot.cropKey,
          plot.yieldAmount
        ]
      );
    }

    db.run('COMMIT;');
    persistDatabase();

    return {
      status: plot.resultCode === 'success'
        ? 'harvested'
        : 'failed',
      resultCode: plot.resultCode,
      cropKey: plot.cropKey,
      seedQuantity: plot.seedQuantity,
      quantity: plot.yieldAmount,
      storageUsed:
        state.storageUsed +
        (plot.resultCode === 'success'
          ? plot.yieldAmount
          : 0)
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function upgradeFarm({
  vkId,
  upgradeKey,
  price
}) {
  ensureDatabase();

  const safeVkId = validateFarmVkId(vkId);
  const safeUpgradeKey =
    String(upgradeKey ?? '').trim();
  const safePrice = Number(price);
  const fields = {
    irrigation: 'irrigation_level',
    soil: 'soil_level',
    warehouse: 'warehouse_level'
  };
  const stateFields = {
    irrigation: 'irrigationLevel',
    soil: 'soilLevel',
    warehouse: 'warehouseLevel'
  };
  const databaseField = fields[safeUpgradeKey];
  const stateField = stateFields[safeUpgradeKey];

  if (
    !databaseField ||
    !Number.isSafeInteger(safePrice) ||
    safePrice <= 0
  ) {
    throw new Error(
      'Некорректное улучшение фермы'
    );
  }

  const state = getFarmState(safeVkId);

  if (state.plotCount === 0) {
    return { status: 'no_farm' };
  }

  const currentLevel = state[stateField];

  if (currentLevel >= FARM_MAX_UPGRADE_LEVEL) {
    return {
      status: 'max_level',
      level: currentLevel
    };
  }

  const balance = getBalance(safeVkId);

  if (balance < safePrice) {
    return {
      status: 'insufficient_funds',
      price: safePrice,
      balance,
      missing: safePrice - balance
    };
  }

  try {
    db.run('BEGIN TRANSACTION;');

    db.run(
      `
        UPDATE balances
        SET dollars = dollars - ?
        WHERE vk_id = ?
      `,
      [safePrice, safeVkId]
    );

    db.run(
      `
        UPDATE farm_profiles
        SET ${databaseField} =
          ${databaseField} + 1
        WHERE vk_id = ?
      `,
      [safeVkId]
    );

    db.run('COMMIT;');
    persistDatabase();

    return {
      status: 'upgraded',
      upgradeKey: safeUpgradeKey,
      level: currentLevel + 1,
      price: safePrice,
      balance: balance - safePrice
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function sellFarmProduce({
  vkId,
  cropKey,
  unitPrice
}) {
  ensureDatabase();

  const safeVkId = validateFarmVkId(vkId);
  const safeCropKey =
    String(cropKey ?? '').trim();
  const safeUnitPrice = Number(unitPrice);

  if (
    !safeCropKey ||
    !Number.isSafeInteger(safeUnitPrice) ||
    safeUnitPrice <= 0
  ) {
    throw new Error(
      'Некорректные данные продажи урожая'
    );
  }

  const state = getFarmState(safeVkId);
  const item = state.storage.find(entry =>
    entry.cropKey === safeCropKey
  );

  if (!item || item.quantity <= 0) {
    return { status: 'empty' };
  }

  const earned = item.quantity * safeUnitPrice;
  const balance = getBalance(safeVkId);

  if (
    !Number.isSafeInteger(earned) ||
    balance > Number.MAX_SAFE_INTEGER - earned
  ) {
    return { status: 'balance_limit' };
  }

  try {
    db.run('BEGIN TRANSACTION;');

    db.run(
      `
        DELETE FROM farm_storage
        WHERE vk_id = ?
          AND crop_key = ?
      `,
      [safeVkId, safeCropKey]
    );

    db.run(
      `
        INSERT INTO balances (
          vk_id,
          dollars
        )
        VALUES (?, ?)

        ON CONFLICT(vk_id)
        DO UPDATE SET
          dollars = dollars + excluded.dollars
      `,
      [safeVkId, earned]
    );

    db.run(
      `
        UPDATE farm_profiles
        SET total_earned = total_earned + ?
        WHERE vk_id = ?
      `,
      [earned, safeVkId]
    );

    db.run('COMMIT;');
    persistDatabase();

    return {
      status: 'sold',
      cropKey: safeCropKey,
      quantity: item.quantity,
      earned,
      balance: balance + earned
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function sellAllFarmProduce({
  vkId,
  prices
}) {
  ensureDatabase();

  const safeVkId = validateFarmVkId(vkId);
  const state = getFarmState(safeVkId);
  const sellableItems = state.storage
    .map(item => ({
      ...item,
      unitPrice: Number(prices?.[item.cropKey])
    }))
    .filter(item =>
      Number.isSafeInteger(item.unitPrice) &&
      item.unitPrice > 0
    );

  if (sellableItems.length === 0) {
    return { status: 'empty' };
  }

  const earned = sellableItems.reduce(
    (sum, item) =>
      sum + item.quantity * item.unitPrice,
    0
  );
  const quantity = sellableItems.reduce(
    (sum, item) => sum + item.quantity,
    0
  );
  const balance = getBalance(safeVkId);

  if (
    !Number.isSafeInteger(earned) ||
    earned <= 0 ||
    balance > Number.MAX_SAFE_INTEGER - earned
  ) {
    return { status: 'balance_limit' };
  }

  try {
    db.run('BEGIN TRANSACTION;');

    for (const item of sellableItems) {
      db.run(
        `
          DELETE FROM farm_storage
          WHERE vk_id = ?
            AND crop_key = ?
        `,
        [safeVkId, item.cropKey]
      );
    }

    db.run(
      `
        INSERT INTO balances (
          vk_id,
          dollars
        )
        VALUES (?, ?)

        ON CONFLICT(vk_id)
        DO UPDATE SET
          dollars = dollars + excluded.dollars
      `,
      [safeVkId, earned]
    );

    db.run(
      `
        UPDATE farm_profiles
        SET total_earned = total_earned + ?
        WHERE vk_id = ?
      `,
      [earned, safeVkId]
    );

    db.run('COMMIT;');
    persistDatabase();

    return {
      status: 'sold',
      cropCount: sellableItems.length,
      quantity,
      earned,
      balance: balance + earned
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function validateLootCaseVkId(vkId) {
  const safeVkId = Number(vkId);

  if (
    !Number.isInteger(safeVkId) ||
    safeVkId <= 0
  ) {
    throw new Error(
      'VK ID должен быть положительным целым числом'
    );
  }

  return safeVkId;
}

function mapLootCaseItem(row) {
  return {
    id: Number(row.id),
    vkId: Number(row.vk_id),
    caseKey: String(row.case_key),
    lootKey: String(row.loot_key),
    title: String(row.loot_title),
    rarity: String(row.rarity),
    sellValue: Number(row.sell_value) || 0,
    assetKey: row.asset_key
      ? String(row.asset_key)
      : null,
    assetType: row.asset_type
      ? String(row.asset_type)
      : null,
    obtainedAt: String(row.obtained_at)
  };
}

function getLootCaseItem(vkId, itemId) {
  ensureDatabase();

  const safeVkId = validateLootCaseVkId(vkId);
  const safeItemId = Number(itemId);

  if (
    !Number.isInteger(safeItemId) ||
    safeItemId <= 0
  ) {
    return null;
  }

  const statement = db.prepare(`
    SELECT
      id,
      vk_id,
      case_key,
      loot_key,
      loot_title,
      rarity,
      sell_value,
      asset_key,
      asset_type,
      obtained_at
    FROM loot_case_inventory
    WHERE id = ?
      AND vk_id = ?
  `);

  statement.bind([safeItemId, safeVkId]);
  let item = null;

  if (statement.step()) {
    item = mapLootCaseItem(
      statement.getAsObject()
    );
  }

  statement.free();

  return item;
}

function getLootCaseStats(vkId) {
  ensureDatabase();

  const safeVkId = validateLootCaseVkId(vkId);
  const statement = db.prepare(`
    SELECT
      opened_count,
      total_spent,
      total_sold,
      jackpots
    FROM loot_case_stats
    WHERE vk_id = ?
  `);

  statement.bind([safeVkId]);
  let stats = {
    openedCount: 0,
    totalSpent: 0,
    totalSold: 0,
    jackpots: 0
  };

  if (statement.step()) {
    const row = statement.getAsObject();

    stats = {
      openedCount:
        Number(row.opened_count) || 0,
      totalSpent:
        Number(row.total_spent) || 0,
      totalSold:
        Number(row.total_sold) || 0,
      jackpots: Number(row.jackpots) || 0
    };
  }

  statement.free();

  return stats;
}

function getLootCaseInventory(vkId) {
  ensureDatabase();

  const safeVkId = validateLootCaseVkId(vkId);
  const statement = db.prepare(`
    SELECT
      MIN(id) AS first_item_id,
      case_key,
      loot_key,
      loot_title,
      rarity,
      sell_value,
      asset_key,
      asset_type,
      COUNT(*) AS quantity,
      SUM(sell_value) AS total_value
    FROM loot_case_inventory
    WHERE vk_id = ?
    GROUP BY
      case_key,
      loot_key,
      loot_title,
      rarity,
      sell_value,
      asset_key,
      asset_type
    ORDER BY
      CASE rarity
        WHEN 'jackpot' THEN 1
        WHEN 'best' THEN 2
        WHEN 'medium' THEN 3
        ELSE 4
      END,
      total_value DESC,
      loot_title ASC
  `);

  statement.bind([safeVkId]);
  const items = [];
  let itemCount = 0;
  let totalValue = 0;

  while (statement.step()) {
    const row = statement.getAsObject();
    const item = {
      firstItemId:
        Number(row.first_item_id),
      caseKey: String(row.case_key),
      lootKey: String(row.loot_key),
      title: String(row.loot_title),
      rarity: String(row.rarity),
      sellValue:
        Number(row.sell_value) || 0,
      assetKey: row.asset_key
        ? String(row.asset_key)
        : null,
      assetType: row.asset_type
        ? String(row.asset_type)
        : null,
      quantity: Number(row.quantity) || 0,
      totalValue:
        Number(row.total_value) || 0
    };

    items.push(item);
    itemCount += item.quantity;
    totalValue += item.totalValue;
  }

  statement.free();

  return {
    items,
    itemCount,
    totalValue,
    stats: getLootCaseStats(safeVkId)
  };
}

function purchaseLootCase({
  vkId,
  caseKey,
  price,
  lootKey,
  lootTitle,
  rarity,
  sellValue,
  assetKey = null,
  assetType = null
}) {
  ensureDatabase();

  const safeVkId = validateLootCaseVkId(vkId);
  const safeCaseKey = String(caseKey ?? '').trim();
  const safeLootKey = String(lootKey ?? '').trim();
  const safeLootTitle = String(lootTitle ?? '').trim();
  const safeRarity = String(rarity ?? '').trim();
  const safePrice = Number(price);
  const safeSellValue = Number(sellValue);
  const safeAssetKey = assetKey
    ? String(assetKey).trim()
    : null;
  const safeAssetType = assetType
    ? String(assetType).trim()
    : null;

  if (
    !/^[a-z0-9_-]{1,64}$/i.test(safeCaseKey) ||
    !/^[a-z0-9_-]{1,64}$/i.test(safeLootKey) ||
    !safeLootTitle ||
    safeLootTitle.length > 100
  ) {
    throw new Error(
      'Некорректные данные кейса или награды'
    );
  }

  if (
    !['bad', 'medium', 'best', 'jackpot']
      .includes(safeRarity)
  ) {
    throw new Error(
      'Некорректная редкость награды'
    );
  }

  if (
    !Number.isSafeInteger(safePrice) ||
    safePrice <= 0 ||
    !Number.isSafeInteger(safeSellValue) ||
    safeSellValue <= 0
  ) {
    throw new Error(
      'Цена кейса и стоимость награды должны быть положительными целыми числами'
    );
  }

  if (
    Boolean(safeAssetKey) !==
      Boolean(safeAssetType) ||
    (safeAssetKey &&
      !/^[a-z0-9_-]{1,64}$/i.test(safeAssetKey)) ||
    (safeAssetType &&
      !/^[a-z0-9_-]{1,64}$/i.test(safeAssetType))
  ) {
    throw new Error(
      'Некорректное имущество в награде'
    );
  }

  const balance = getBalance(safeVkId);

  if (balance < safePrice) {
    return {
      status: 'insufficient_funds',
      price: safePrice,
      balance,
      missing: safePrice - balance
    };
  }

  try {
    db.run('BEGIN TRANSACTION;');

    db.run(
      `
        UPDATE balances
        SET dollars = dollars - ?
        WHERE vk_id = ?
          AND dollars >= ?
      `,
      [safePrice, safeVkId, safePrice]
    );

    db.run(
      `
        INSERT INTO loot_case_inventory (
          vk_id,
          case_key,
          loot_key,
          loot_title,
          rarity,
          sell_value,
          asset_key,
          asset_type
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        safeVkId,
        safeCaseKey,
        safeLootKey,
        safeLootTitle,
        safeRarity,
        safeSellValue,
        safeAssetKey,
        safeAssetType
      ]
    );

    const itemId = Number(
      db.exec(
        'SELECT last_insert_rowid() AS id;'
      )[0].values[0][0]
    );

    db.run(
      `
        INSERT INTO loot_case_stats (
          vk_id,
          opened_count,
          total_spent,
          jackpots
        )
        VALUES (?, 1, ?, ?)

        ON CONFLICT(vk_id)
        DO UPDATE SET
          opened_count = opened_count + 1,
          total_spent = total_spent + excluded.total_spent,
          jackpots = jackpots + excluded.jackpots
      `,
      [
        safeVkId,
        safePrice,
        safeRarity === 'jackpot' ? 1 : 0
      ]
    );

    db.run('COMMIT;');
    persistDatabase();

    return {
      status: 'opened',
      price: safePrice,
      balance: balance - safePrice,
      item: getLootCaseItem(
        safeVkId,
        itemId
      )
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function sellLootCaseItems({
  vkId,
  itemId = null,
  lootKey = null,
  sellAll = false
}) {
  ensureDatabase();

  const safeVkId = validateLootCaseVkId(vkId);
  const safeItemId = Number(itemId);
  const safeLootKey = lootKey
    ? String(lootKey).trim()
    : null;
  let whereClause = 'vk_id = ?';
  const parameters = [safeVkId];

  if (
    !sellAll &&
    Number.isInteger(safeItemId) &&
    safeItemId > 0
  ) {
    whereClause += ' AND id = ?';
    parameters.push(safeItemId);
  } else if (
    !sellAll &&
    safeLootKey &&
    /^[a-z0-9_-]{1,64}$/i.test(safeLootKey)
  ) {
    whereClause += ' AND loot_key = ?';
    parameters.push(safeLootKey);
  } else if (!sellAll) {
    throw new Error(
      'Не указан предмет для продажи'
    );
  }

  const statement = db.prepare(`
    SELECT
      id,
      sell_value
    FROM loot_case_inventory
    WHERE ${whereClause}
  `);

  statement.bind(parameters);
  const itemIds = [];
  let earned = 0;

  while (statement.step()) {
    const row = statement.getAsObject();

    itemIds.push(Number(row.id));
    earned += Number(row.sell_value) || 0;
  }

  statement.free();

  if (itemIds.length === 0) {
    return {
      status: 'not_found',
      balance: getBalance(safeVkId)
    };
  }

  const balance = getBalance(safeVkId);

  if (
    !Number.isSafeInteger(earned) ||
    earned <= 0 ||
    balance > Number.MAX_SAFE_INTEGER - earned
  ) {
    return {
      status: 'balance_limit'
    };
  }

  try {
    db.run('BEGIN TRANSACTION;');

    db.run(
      `
        DELETE FROM loot_case_inventory
        WHERE ${whereClause}
      `,
      parameters
    );

    db.run(
      `
        INSERT INTO balances (
          vk_id,
          dollars
        )
        VALUES (?, ?)

        ON CONFLICT(vk_id)
        DO UPDATE SET
          dollars = dollars + excluded.dollars
      `,
      [safeVkId, earned]
    );

    db.run(
      `
        INSERT INTO loot_case_stats (
          vk_id,
          total_sold
        )
        VALUES (?, ?)

        ON CONFLICT(vk_id)
        DO UPDATE SET
          total_sold = total_sold + excluded.total_sold
      `,
      [safeVkId, earned]
    );

    db.run('COMMIT;');
    persistDatabase();

    return {
      status: 'sold',
      itemCount: itemIds.length,
      earned,
      balance: balance + earned
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function sellLootCaseItem({
  vkId,
  itemId
}) {
  return sellLootCaseItems({
    vkId,
    itemId
  });
}

function sellLootCaseGroup({
  vkId,
  lootKey
}) {
  return sellLootCaseItems({
    vkId,
    lootKey
  });
}

function sellAllLootCaseItems(vkId) {
  return sellLootCaseItems({
    vkId,
    sellAll: true
  });
}

function claimLootCaseAsset({
  vkId,
  itemId
}) {
  ensureDatabase();

  const safeVkId = validateLootCaseVkId(vkId);
  const item = getLootCaseItem(
    safeVkId,
    itemId
  );

  if (!item) {
    return {
      status: 'not_found'
    };
  }

  if (!item.assetKey || !item.assetType) {
    return {
      status: 'not_asset',
      item
    };
  }

  const alreadyOwned = getMagazineAssets(safeVkId)
    .some(asset =>
      asset.itemKey === item.assetKey
    );

  if (alreadyOwned) {
    return {
      status: 'already_owned',
      item
    };
  }

  try {
    db.run('BEGIN TRANSACTION;');

    db.run(
      `
        DELETE FROM loot_case_inventory
        WHERE id = ?
          AND vk_id = ?
      `,
      [item.id, safeVkId]
    );

    db.run(
      `
        INSERT INTO magazine_assets (
          vk_id,
          item_key,
          item_type
        )
        VALUES (?, ?, ?)
      `,
      [
        safeVkId,
        item.assetKey,
        item.assetType
      ]
    );

    db.run('COMMIT;');
    persistDatabase();

    return {
      status: 'claimed',
      item
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    throw error;
  }
}

function validatePhoneVkId(vkId) {
  const safeVkId = Number(vkId);

  if (
    !Number.isInteger(safeVkId) ||
    safeVkId <= 0
  ) {
    throw new Error(
      'VK ID должен быть положительным целым числом'
    );
  }

  return safeVkId;
}

function validateStoredPhoneNumber(phoneNumber) {
  const safePhoneNumber =
    String(phoneNumber ?? '').trim();

  if (!/^\d{6}$/.test(safePhoneNumber)) {
    throw new Error(
      'Номер телефона должен состоять из 6 цифр'
    );
  }

  return safePhoneNumber;
}

function getPhoneSim(vkId) {
  ensureDatabase();

  const safeVkId = validatePhoneVkId(vkId);
  const statement = db.prepare(`
    SELECT
      vk_id,
      phone_number,
      rarity,
      purchased_at
    FROM phone_sims
    WHERE vk_id = ?
  `);

  statement.bind([safeVkId]);
  let sim = null;

  if (statement.step()) {
    const row = statement.getAsObject();

    sim = {
      vkId: Number(row.vk_id),
      phoneNumber: String(row.phone_number),
      rarity: String(row.rarity),
      purchasedAt: String(row.purchased_at)
    };
  }

  statement.free();

  return sim;
}

function getPhoneSimByNumber(phoneNumber) {
  ensureDatabase();

  const safePhoneNumber =
    validateStoredPhoneNumber(phoneNumber);
  const statement = db.prepare(`
    SELECT
      vk_id,
      phone_number,
      rarity,
      purchased_at
    FROM phone_sims
    WHERE phone_number = ?
  `);

  statement.bind([safePhoneNumber]);
  let sim = null;

  if (statement.step()) {
    const row = statement.getAsObject();

    sim = {
      vkId: Number(row.vk_id),
      phoneNumber: String(row.phone_number),
      rarity: String(row.rarity),
      purchasedAt: String(row.purchased_at)
    };
  }

  statement.free();

  return sim;
}

function mapPhoneCallRow(row, vkId = null) {
  const safeVkId = Number(vkId);
  const callerVkId = Number(row.caller_vk_id);
  const receiverVkId = Number(row.receiver_vk_id);

  return {
    id: Number(row.id),
    callerVkId,
    receiverVkId,
    status: String(row.status),
    createdAt: Number(row.created_at),
    acceptedAt: Number(row.accepted_at) || 0,
    expiresAt: Number(row.expires_at),
    ...(Number.isInteger(safeVkId)
      ? {
        isCaller: callerVkId === safeVkId,
        otherVkId:
          callerVkId === safeVkId
            ? receiverVkId
            : callerVkId
      }
      : {})
  };
}

function cleanupExpiredPhoneCalls(
  currentTime = Date.now()
) {
  ensureDatabase();

  const safeCurrentTime = Number(currentTime);

  if (
    !Number.isSafeInteger(safeCurrentTime) ||
    safeCurrentTime < 0
  ) {
    throw new Error(
      'Некорректное время проверки звонков'
    );
  }

  db.run(
    `
      DELETE FROM phone_calls
      WHERE expires_at <= ?
    `,
    [safeCurrentTime]
  );

  const removed = db.getRowsModified();

  if (removed > 0) {
    persistDatabase();
  }

  return removed;
}

function purchasePhoneSim({
  vkId,
  phoneNumber,
  rarity,
  price
}) {
  ensureDatabase();

  const safeVkId = validatePhoneVkId(vkId);
  const safePhoneNumber =
    validateStoredPhoneNumber(phoneNumber);
  const safeRarity =
    String(rarity ?? '').trim();
  const safePrice = Number(price);

  if (
    !['standard', 'pretty', 'elite']
      .includes(safeRarity)
  ) {
    throw new Error(
      'Некорректная редкость SIM-карты'
    );
  }

  if (
    !Number.isSafeInteger(safePrice) ||
    safePrice <= 0
  ) {
    throw new Error(
      'Стоимость SIM-карты должна быть положительным целым числом'
    );
  }

  const existingSim = getPhoneSim(safeVkId);

  if (existingSim) {
    return {
      status: 'already_owned',
      sim: existingSim,
      balance: getBalance(safeVkId)
    };
  }

  const assetStatement = db.prepare(`
    SELECT 1
    FROM magazine_assets
    WHERE vk_id = ?
      AND item_type = 'phones'
    LIMIT 1
  `);

  assetStatement.bind([safeVkId]);
  const hasPhone = assetStatement.step();
  assetStatement.free();

  if (!hasPhone) {
    return {
      status: 'no_phone',
      balance: getBalance(safeVkId)
    };
  }

  if (getPhoneSimByNumber(safePhoneNumber)) {
    return {
      status: 'number_taken'
    };
  }

  const currentBalance = getBalance(safeVkId);

  if (currentBalance < safePrice) {
    return {
      status: 'insufficient_funds',
      price: safePrice,
      balance: currentBalance,
      missing: safePrice - currentBalance
    };
  }

  try {
    db.run('BEGIN TRANSACTION;');

    db.run(
      `
        UPDATE balances
        SET dollars = dollars - ?
        WHERE vk_id = ?
          AND dollars >= ?
      `,
      [safePrice, safeVkId, safePrice]
    );

    db.run(
      `
        INSERT INTO phone_sims (
          vk_id,
          phone_number,
          rarity
        )
        VALUES (?, ?, ?)
      `,
      [safeVkId, safePhoneNumber, safeRarity]
    );

    db.run('COMMIT;');
    persistDatabase();

    return {
      status: 'purchased',
      sim: getPhoneSim(safeVkId),
      price: safePrice,
      balance: currentBalance - safePrice
    };
  } catch (error) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Транзакция могла не успеть начаться.
    }

    if (
      /UNIQUE constraint failed:\s*phone_sims\.phone_number/i
        .test(String(error?.message ?? ''))
    ) {
      return {
        status: 'number_taken'
      };
    }

    throw error;
  }
}

function getPhoneCall(
  vkId,
  currentTime = Date.now()
) {
  ensureDatabase();

  const safeVkId = validatePhoneVkId(vkId);

  cleanupExpiredPhoneCalls(currentTime);

  const statement = db.prepare(`
    SELECT
      id,
      caller_vk_id,
      receiver_vk_id,
      status,
      created_at,
      accepted_at,
      expires_at
    FROM phone_calls
    WHERE caller_vk_id = ?
       OR receiver_vk_id = ?
    ORDER BY id DESC
    LIMIT 1
  `);

  statement.bind([safeVkId, safeVkId]);
  let call = null;

  if (statement.step()) {
    call = mapPhoneCallRow(
      statement.getAsObject(),
      safeVkId
    );
  }

  statement.free();

  return call;
}

function getPhoneCallById(
  callId,
  currentTime = Date.now()
) {
  ensureDatabase();

  const safeCallId = Number(callId);

  if (
    !Number.isInteger(safeCallId) ||
    safeCallId <= 0
  ) {
    return null;
  }

  cleanupExpiredPhoneCalls(currentTime);

  const statement = db.prepare(`
    SELECT
      id,
      caller_vk_id,
      receiver_vk_id,
      status,
      created_at,
      accepted_at,
      expires_at
    FROM phone_calls
    WHERE id = ?
  `);

  statement.bind([safeCallId]);
  let call = null;

  if (statement.step()) {
    call = mapPhoneCallRow(
      statement.getAsObject()
    );
  }

  statement.free();

  return call;
}

function startPhoneCall({
  callerVkId,
  receiverVkId,
  currentTime = Date.now(),
  expiresAt
}) {
  ensureDatabase();

  const safeCallerVkId =
    validatePhoneVkId(callerVkId);
  const safeReceiverVkId =
    validatePhoneVkId(receiverVkId);
  const safeCurrentTime = Number(currentTime);
  const safeExpiresAt = Number(expiresAt);

  if (safeCallerVkId === safeReceiverVkId) {
    return {
      status: 'same_user'
    };
  }

  if (
    !Number.isSafeInteger(safeCurrentTime) ||
    !Number.isSafeInteger(safeExpiresAt) ||
    safeCurrentTime < 0 ||
    safeExpiresAt <= safeCurrentTime
  ) {
    throw new Error(
      'Некорректное время телефонного звонка'
    );
  }

  cleanupExpiredPhoneCalls(safeCurrentTime);

  const callerCall = getPhoneCall(
    safeCallerVkId,
    safeCurrentTime
  );

  if (callerCall) {
    return {
      status: 'caller_busy',
      call: callerCall
    };
  }

  const receiverCall = getPhoneCall(
    safeReceiverVkId,
    safeCurrentTime
  );

  if (receiverCall) {
    return {
      status: 'receiver_busy'
    };
  }

  db.run(
    `
      INSERT INTO phone_calls (
        caller_vk_id,
        receiver_vk_id,
        status,
        created_at,
        expires_at
      )
      VALUES (?, ?, 'ringing', ?, ?)
    `,
    [
      safeCallerVkId,
      safeReceiverVkId,
      safeCurrentTime,
      safeExpiresAt
    ]
  );

  const callId = Number(
    db.exec(
      'SELECT last_insert_rowid() AS id;'
    )[0].values[0][0]
  );

  persistDatabase();

  return {
    status: 'ringing',
    call: getPhoneCallById(
      callId,
      safeCurrentTime
    )
  };
}

function acceptPhoneCall({
  callId,
  receiverVkId,
  currentTime = Date.now(),
  expiresAt
}) {
  ensureDatabase();

  const safeReceiverVkId =
    validatePhoneVkId(receiverVkId);
  const safeCurrentTime = Number(currentTime);
  const safeExpiresAt = Number(expiresAt);
  const call = getPhoneCallById(
    callId,
    safeCurrentTime
  );

  if (!call) {
    return {
      status: 'not_found'
    };
  }

  if (call.receiverVkId !== safeReceiverVkId) {
    return {
      status: 'not_receiver'
    };
  }

  if (call.status !== 'ringing') {
    return {
      status: 'not_ringing',
      call
    };
  }

  if (
    !Number.isSafeInteger(safeExpiresAt) ||
    safeExpiresAt <= safeCurrentTime
  ) {
    throw new Error(
      'Некорректное время завершения звонка'
    );
  }

  db.run(
    `
      UPDATE phone_calls
      SET status = 'active',
          accepted_at = ?,
          expires_at = ?
      WHERE id = ?
        AND receiver_vk_id = ?
        AND status = 'ringing'
    `,
    [
      safeCurrentTime,
      safeExpiresAt,
      Number(call.id),
      safeReceiverVkId
    ]
  );

  persistDatabase();

  return {
    status: 'active',
    call: getPhoneCallById(
      call.id,
      safeCurrentTime
    )
  };
}

function declinePhoneCall({
  callId,
  receiverVkId,
  currentTime = Date.now()
}) {
  ensureDatabase();

  const safeReceiverVkId =
    validatePhoneVkId(receiverVkId);
  const call = getPhoneCallById(
    callId,
    currentTime
  );

  if (!call) {
    return {
      status: 'not_found'
    };
  }

  if (
    call.receiverVkId !== safeReceiverVkId ||
    call.status !== 'ringing'
  ) {
    return {
      status: 'not_allowed'
    };
  }

  db.run(
    `
      DELETE FROM phone_calls
      WHERE id = ?
    `,
    [Number(call.id)]
  );
  persistDatabase();

  return {
    status: 'declined',
    call
  };
}

function endPhoneCall({
  callId,
  vkId,
  currentTime = Date.now()
}) {
  ensureDatabase();

  const safeVkId = validatePhoneVkId(vkId);
  const call = getPhoneCallById(
    callId,
    currentTime
  );

  if (!call) {
    return {
      status: 'not_found'
    };
  }

  if (
    call.callerVkId !== safeVkId &&
    call.receiverVkId !== safeVkId
  ) {
    return {
      status: 'not_allowed'
    };
  }

  db.run(
    `
      DELETE FROM phone_calls
      WHERE id = ?
    `,
    [Number(call.id)]
  );
  persistDatabase();

  return {
    status: 'ended',
    call
  };
}

function touchPhoneCall({
  callId,
  vkId,
  currentTime = Date.now(),
  expiresAt
}) {
  ensureDatabase();

  const safeVkId = validatePhoneVkId(vkId);
  const safeCurrentTime = Number(currentTime);
  const safeExpiresAt = Number(expiresAt);
  const call = getPhoneCallById(
    callId,
    safeCurrentTime
  );

  if (
    !call ||
    call.status !== 'active'
  ) {
    return {
      status: 'not_active'
    };
  }

  if (
    call.callerVkId !== safeVkId &&
    call.receiverVkId !== safeVkId
  ) {
    return {
      status: 'not_allowed'
    };
  }

  if (
    !Number.isSafeInteger(safeExpiresAt) ||
    safeExpiresAt <= safeCurrentTime
  ) {
    throw new Error(
      'Некорректное время продления звонка'
    );
  }

  db.run(
    `
      UPDATE phone_calls
      SET expires_at = ?
      WHERE id = ?
        AND status = 'active'
    `,
    [safeExpiresAt, Number(call.id)]
  );
  persistDatabase();

  return {
    status: 'touched',
    call: {
      ...call,
      expiresAt: safeExpiresAt
    }
  };
}

module.exports = {
  formatMoney,
  JOB_MAX_LEVEL,
  BEGINNER_BOX_MAX_LEVEL,
  BEGINNER_BOX_COOLDOWN_MS,
  getJobExperienceRequired,
  initializeDatabase,
  saveUser,
  getUserByVkId,
  getUserCount,
  getAllUserIds,

  getAura,
  getTotalAura,
  getAuraCooldown,
  giveAura,
  getAuraTop,
  addAuraAmount,
  changeAuraAmount,
  removeAuraAmount,
  setTotalAura,
  resetTotalAura,
  getAuraRank,

  getBalance,
  getBalanceTop,
  addBalance,
  changeBalance,
  removeBalance,
  getPerkStatus,
  isPerkActive,
  getActivePerkUserIds,
  purchasePerk,
  consumePerkCharges,
  getTaxAccount,
  accrueTaxDebt,
  payTaxDebts,
  getTreasuryState,
  recordTreasuryGameLoss,
  adjustTreasuryBalance,
  getPendingCreditRequest,
  getActiveTreasuryLoan,
  createTreasuryCreditRequest,
  getTreasuryCreditRequest,
  decideTreasuryCreditRequest,
  repayTreasuryLoan,
  TRANSFER_DAILY_LIMIT,
  getDailyTransferUsage,
  transferBalance,
  setBalance,
  resetBalance,
  FARM_MAX_PLOTS,
  FARM_MAX_UPGRADE_LEVEL,
  getFarmState,
  getPendingFarmNotifications,
  claimFarmHarvestNotification,
  purchaseFarmPlot,
  purchaseFarmSeeds,
  plantFarmCrop,
  harvestFarmCrop,
  upgradeFarm,
  sellFarmProduce,
  sellAllFarmProduce,
  getLootCaseItem,
  getLootCaseStats,
  getLootCaseInventory,
  purchaseLootCase,
  sellLootCaseItem,
  sellLootCaseGroup,
  sellAllLootCaseItems,
  claimLootCaseAsset,
  getPhoneSim,
  getPhoneSimByNumber,
  purchasePhoneSim,
  getPhoneCall,
  getPhoneCallById,
  startPhoneCall,
  acceptPhoneCall,
  declinePhoneCall,
  endPhoneCall,
  touchPhoneCall,
  getGameDebt,
  applyGamePenalty,
  applyGameReward,

  getJobProfile,
  calculateJobExperienceProgress,
  getMagazineAssets,
  getTravelProfile,
  researchCountry,
  moveCountry,
  addFishingCatch,
  getFishingInventory,
  sellAllFishingCatches,
  getBeginnerBoxStatus,
  claimBeginnerBox,
  JOB_BOOST_DAILY_PURCHASE_LIMIT,
  getJobBoostCount,
  getDailyJobBoostPurchaseUsage,
  purchaseMagazineItem,
  sellMagazineAsset,
  BUSINESS_MAX_UPGRADE_LEVEL,
  getBusinessMultiplier,
  getBusinessState,
  collectBusinessIncome,
  collectAllBusinessIncome,
  upgradeBusiness,
  sellBusiness,
  getPropertyRentalState,
  startPropertyRental,
  collectPropertyRent,
  collectAllPropertyRent,
  getCarTuningLevels,
  upgradeCarTuning,
  BANK_MAX_INTEREST_HOURS,
  BANK_INTEREST_BRACKETS,
  BANK_FREE_WITHDRAWAL_LIMIT,
  BANK_COMMISSION_INCOME_SHARE_BPS,
  calculateBankHourlyIncome,
  calculateBankWithdrawalCommission,
  getBankAccount,
  depositBankFunds,
  previewBankWithdrawal,
  withdrawBankFunds,
  getActiveJob,
  getActiveJobs,
  beginJob,
  completeJob,
  getQuestStat,
  incrementQuestStat,
  getQuestSnapshot,
  hasClaimedQuest,
  claimQuestReward,

  getAdminStatistics,
  getPromoOverview,
  createPromo,
  redeemPromo
};
