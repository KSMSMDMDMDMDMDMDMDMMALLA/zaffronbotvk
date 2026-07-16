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
  2: 3,
  3: 5,
  4: 5,
  5: 10,
  6: 10,
  7: 15,
  8: 30,
  9: 45
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

  if (safeLevel >= 10 && safeLevel < 45) {
    return 45;
  }

  if (safeLevel >= 45 && safeLevel < 50) {
    return 10;
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

function transferBalance({
  senderId,
  recipientId,
  amount
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

  const recipientBalance =
    getBalance(safeRecipientId);

  if (
    recipientBalance >
    Number.MAX_SAFE_INTEGER - safeAmount
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
        safeAmount
      ]
    );

    db.run('COMMIT;');

    persistDatabase();

    return {
      status: 'transferred',
      amount: safeAmount,
      senderBalance:
        senderBalance - safeAmount,
      recipientBalance:
        recipientBalance + safeAmount
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

function purchaseMagazineItem({
  vkId,
  itemKey,
  itemType,
  price,
  consumable = false,
  consumableQuantity = 1
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

function hasBusinessAsset(vkId, itemKey) {
  const statement = db.prepare(`
    SELECT 1
    FROM magazine_assets
    WHERE vk_id = ?
      AND item_key = ?
      AND item_type = 'businesses'
    LIMIT 1
  `);

  statement.bind([
    vkId,
    itemKey
  ]);

  const exists = statement.step();

  statement.free();

  return exists;
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
  const walletBalance = getBalance(safeVkId);

  if (
    walletBalance >
    Number.MAX_SAFE_INTEGER - quote.payout
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
    commission: quote.commission,
    commissionBps: quote.commissionBps,
    payout: quote.payout,
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


module.exports = {
  formatMoney,
  JOB_MAX_LEVEL,
  getJobExperienceRequired,
  initializeDatabase,
  saveUser,
  getUserByVkId,

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
  transferBalance,
  setBalance,
  resetBalance,
  getGameDebt,
  applyGamePenalty,
  applyGameReward,

  getJobProfile,
  calculateJobExperienceProgress,
  getMagazineAssets,
  getJobBoostCount,
  purchaseMagazineItem,
  sellMagazineAsset,
  BUSINESS_MAX_UPGRADE_LEVEL,
  getBusinessMultiplier,
  getBusinessState,
  collectBusinessIncome,
  collectAllBusinessIncome,
  upgradeBusiness,
  sellBusiness,
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

  createPromo,
  redeemPromo
};
