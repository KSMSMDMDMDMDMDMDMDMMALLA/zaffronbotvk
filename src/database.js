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


module.exports = {
  initializeDatabase,
  saveUser,
  getUserByVkId,

  getAura,
  getTotalAura,
  getAuraCooldown,
  giveAura,
  getAuraTop,
  addAuraAmount,
  changeAuraAmount
};