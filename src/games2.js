const {
  addAuraAmount,
  changeAuraAmount,
  getTotalAura
} = require('./database');

/*
 * games2.js
 *
 * Игры:
 * 1. !картошка / !пас @user
 * 2. !бомба / !режу красный
 * 3. !реакция / ловлю
 * 4. !кейс
 * 5. !казино <ставка>
 * 6. !угадай / !число <1-20>
 */

/*
 * ------------------------------
 * Настройки
 * ------------------------------
 */

const POTATO_COOLDOWN =
  5 * 60 * 1000;

const BOMB_COOLDOWN =
  1 * 60 * 1000;

const REACTION_COOLDOWN =
  10 * 60 * 1000;

const CASINO_COOLDOWN =
  20 * 1000;

const GUESS_COOLDOWN =
  5 * 60 * 1000;

/*
 * Время и задержки самих игр.
 */
const CASE_COOLDOWN =
  30 * 60 * 1000;

const HOT_POTATO_MIN_TIME =
  15 * 1000;

const HOT_POTATO_MAX_TIME =
  30 * 1000;

const BOMB_TIME =
  15 * 1000;

const REACTION_MIN_DELAY =
  3 * 1000;

const REACTION_MAX_DELAY =
  8 * 1000;

const GUESS_TIME =
  60 * 1000;

const gameCooldowns = {
  potato: new Map(),
  bomb: new Map(),
  reaction: new Map(),
  casino: new Map(),
  guess: new Map()
};

/*
 * Активные игры по peerId.
 */
const hotPotatoGames = new Map();
const bombGames = new Map();
const reactionGames = new Map();
const guessGames = new Map();

/*
 * Кулдаун кейсов.
 *
 * Ключ: peerId:userId
 */
const caseCooldowns = new Map();

function randomInteger(min, max) {
  return Math.floor(
    Math.random() * (max - min + 1)
  ) + min;
}

function getPlayerKey(peerId, userId) {
  return `${peerId}:${userId}`;
}

function isChat(context) {
  return Number(context.peerId) >= 2000000000;
}

function mention(userId, name) {
  return `@id${userId} (${name})`;
}

function wait(milliseconds) {
  return new Promise(resolve =>
    setTimeout(resolve, milliseconds)
  );
}

function formatRemainingTime(milliseconds) {
  const totalSeconds = Math.max(
    1,
    Math.ceil(milliseconds / 1000)
  );

  const minutes =
    Math.floor(totalSeconds / 60);

  const seconds =
    totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds} сек.`;
  }

  return `${minutes} мин. ${seconds} сек.`;
}

function checkGameCooldown(
  map,
  peerId,
  cooldown
) {
  const lastStart =
    map.get(peerId) ?? 0;

  const remaining =
    cooldown -
    (Date.now() - lastStart);

  if (remaining > 0) {
    return remaining;
  }

  map.set(
    peerId,
    Date.now()
  );

  return 0;
}

function sendCooldown(
  context,
  title,
  remaining
) {
  return context.reply(
    `⏳ ${title} недавно запускалась.\n\n` +
    `Попробуйте снова через ${formatRemainingTime(remaining)}`
  );
}

function getReplySenderId(context) {
  const reply = context.replyMessage;

  if (!reply) {
    return null;
  }

  const value =
    reply.senderId ??
    reply.sender_id ??
    reply.fromId ??
    reply.from_id;

  const userId = Number(value);

  return Number.isInteger(userId)
    ? userId
    : null;
}

function extractVkTarget(value) {
  return String(value ?? '')
    .trim()
    .replace(
      /^https?:\/\/(www\.)?vk\.com\//i,
      ''
    )
    .replace(/^vk\.com\//i, '')
    .replace(/^@/, '')
    .replace(
      /^\[id(\d+)\|.*\]$/i,
      'id$1'
    )
    .split(/[/?#\s]/)[0]
    .trim();
}

async function resolveUserId(
  context,
  vk,
  rawTarget
) {
  const replyTarget =
    getReplySenderId(context);

  if (replyTarget) {
    return replyTarget;
  }

  const target =
    extractVkTarget(rawTarget);

  if (!target) {
    return null;
  }

  const users =
    await vk.api.users.get({
      user_ids: target
    });

  const user = users?.[0];

  if (!user?.id) {
    return null;
  }

  return Number(user.id);
}

async function getUserName(vk, userId) {
  try {
    const users =
      await vk.api.users.get({
        user_ids: userId
      });

    const user = users?.[0];

    if (!user) {
      return `id${userId}`;
    }

    return [
      user.first_name,
      user.last_name
    ]
      .filter(Boolean)
      .join(' ');
  } catch (error) {
    console.error(
      'Не удалось получить имя пользователя:',
      error
    );

    return `id${userId}`;
  }
}

async function sendMessage(
  vk,
  peerId,
  message
) {
  return vk.api.messages.send({
    peer_id: peerId,
    random_id: 0,
    message
  });
}

function getRewardPeerId(context) {
  /*
   * В беседе аура записывается в peerId беседы.
   * В личных сообщениях используется общий peerId = 0.
   */
  return isChat(context)
    ? Number(context.peerId)
    : 0;
}

/*
 * ------------------------------
 * 1. Горячая картошка
 * ------------------------------
 */

async function startHotPotato(
  context,
  vk
) {
  if (!isChat(context)) {
    await context.reply(
      '❌ Горячая картошка работает только в беседах.'
    );

    return true;
  }

  const peerId =
    Number(context.peerId);

  if (hotPotatoGames.has(peerId)) {
    await context.reply(
      '🥔 В этой беседе уже идёт горячая картошка.'
    );

    return true;
  }

  const userId =
    Number(context.senderId);

  const potatoKey =
    getPlayerKey(
      peerId,
      userId
    );

  const potatoCooldown =
    checkGameCooldown(
      gameCooldowns.potato,
      potatoKey,
      POTATO_COOLDOWN
    );

  if (potatoCooldown > 0) {
    return sendCooldown(
      context,
      'Горячая картошка',
      potatoCooldown
    );
  }

  if (hotPotatoGames.has(peerId)) {
    await context.reply(
      '🥔 В этой беседе уже идёт горячая картошка.'
    );

    return true;
  }

  const holderId =
    userId;

  const duration =
    randomInteger(
      HOT_POTATO_MIN_TIME,
      HOT_POTATO_MAX_TIME
    );

  const game = {
    holderId,
    finished: false,
    timer: null
  };

  hotPotatoGames.set(
    peerId,
    game
  );

  await context.send(
    '🥔 Горячая картошка началась!\n\n' +
    'Картошка сейчас у создателя игры.\n' +
    'Передавайте её командой:\n' +
    '!пас @user\n\n' +
    'Можно также ответить командой !пас ' +
    'на сообщение игрока.'
  );

  game.timer = setTimeout(
    async () => {
      const currentGame =
        hotPotatoGames.get(peerId);

      if (
        !currentGame ||
        currentGame !== game ||
        currentGame.finished
      ) {
        return;
      }

      currentGame.finished = true;
      hotPotatoGames.delete(peerId);

      const loserId =
        currentGame.holderId;

      const loserName =
        await getUserName(
          vk,
          loserId
        );

      const aura =
        changeAuraAmount(
          peerId,
          loserId,
          -5
        );

      await sendMessage(
        vk,
        peerId,
        '💥 Картошка взорвалась!\n\n' +
        `Она была у ${mention(loserId, loserName)}.\n` +
        '✨ Штраф: -5 ауры\n' +
        `🌟 Теперь у игрока: ${aura}`
      ).catch(console.error);
    },
    duration
  );

  return true;
}

async function passHotPotato(
  context,
  vk,
  rawTarget
) {
  if (!isChat(context)) {
    return false;
  }

  const peerId =
    Number(context.peerId);

  const game =
    hotPotatoGames.get(peerId);

  if (!game || game.finished) {
    await context.reply(
      '❌ Сейчас в беседе нет активной горячей картошки.'
    );

    return true;
  }

  const senderId =
    Number(context.senderId);

  if (game.holderId !== senderId) {
    await context.reply(
      '🤨 Картошка сейчас не у тебя.'
    );

    return true;
  }

  let targetId;

  try {
    targetId =
      await resolveUserId(
        context,
        vk,
        rawTarget
      );
  } catch (error) {
    console.error(
      'Ошибка поиска игрока для картошки:',
      error
    );

    targetId = null;
  }

  if (!targetId) {
    await context.reply(
      '❌ Укажи игрока или ответь командой !пас ' +
      'на его сообщение.'
    );

    return true;
  }

  if (targetId === senderId) {
    await context.reply(
      '🤨 Нельзя передать картошку самому себе.'
    );

    return true;
  }

  if (targetId <= 0) {
    await context.reply(
      '❌ Нельзя передать картошку сообществу.'
    );

    return true;
  }

  game.holderId = targetId;

  const targetName =
    await getUserName(
      vk,
      targetId
    );

  await context.send(
    `🥔 Картошка передана ${mention(targetId, targetName)}!`
  );

  return true;
}

/*
 * ------------------------------
 * 2. Бомба
 * ------------------------------
 */

async function startBomb(
  context,
  vk
) {
  if (!isChat(context)) {
    await context.reply(
      '❌ Бомба работает только в беседах.'
    );

    return true;
  }

  const peerId =
    Number(context.peerId);

  if (bombGames.has(peerId)) {
    await context.reply(
      '💣 В этой беседе уже активна бомба.'
    );

    return true;
  }

  const userId =
    Number(context.senderId);

  const bombKey =
    getPlayerKey(
      peerId,
      userId
    );

  const bombCooldown =
    checkGameCooldown(
      gameCooldowns.bomb,
      bombKey,
      BOMB_COOLDOWN
    );

  if (bombCooldown > 0) {
    return sendCooldown(
      context,
      'Бомба',
      bombCooldown
    );
  }

  if (bombGames.has(peerId)) {
    await context.reply(
      '💣 В этой беседе уже активна бомба.'
    );

    return true;
  }

  const wires = [
    'красный',
    'синий',
    'зелёный'
  ];

  const correctWire =
    wires[
      randomInteger(
        0,
        wires.length - 1
      )
    ];

  const game = {
    correctWire,
    finished: false,
    timer: null
  };

  bombGames.set(
    peerId,
    game
  );

  await context.send(
    '💣 Бомба активирована!\n\n' +
    'У вас 15 секунд.\n' +
    'Перережьте один провод:\n\n' +
    '!режу красный\n' +
    '!режу синий\n' +
    '!режу зелёный'
  );

  game.timer = setTimeout(
    async () => {
      const currentGame =
        bombGames.get(peerId);

      if (
        !currentGame ||
        currentGame !== game ||
        currentGame.finished
      ) {
        return;
      }

      currentGame.finished = true;
      bombGames.delete(peerId);

      await sendMessage(
        vk,
        peerId,
        '💥 Бомба взорвалась!\n\n' +
        `Правильный провод был: ${correctWire}.`
      ).catch(console.error);
    },
    BOMB_TIME
  );

  return true;
}

async function cutBombWire(
  context,
  wire
) {
  if (!isChat(context)) {
    return false;
  }

  const peerId =
    Number(context.peerId);

  const game =
    bombGames.get(peerId);

  if (!game || game.finished) {
    await context.reply(
      '❌ Сейчас в беседе нет активной бомбы.'
    );

    return true;
  }

  const normalizedWire =
    String(wire)
      .trim()
      .toLowerCase();

  const allowedWires = [
    'красный',
    'синий',
    'зелёный'
  ];

  if (
    !allowedWires.includes(
      normalizedWire
    )
  ) {
    await context.reply(
      '❌ Такого провода нет.'
    );

    return true;
  }

  game.finished = true;

  if (game.timer) {
    clearTimeout(game.timer);
  }

  bombGames.delete(peerId);

  const userId =
    Number(context.senderId);

  if (
    normalizedWire ===
    game.correctWire
  ) {
    const newAura =
      addAuraAmount(
        peerId,
        userId,
        3
      );

    await context.send(
      '🎉 Бомба обезврежена!\n\n' +
      `@id${userId} получает +3 ауры.\n` +
      `🌟 Теперь у него: ${newAura}`
    );

    return true;
  }

  const newAura =
    changeAuraAmount(
      peerId,
      userId,
      -3
    );

  await context.send(
    '💥 Неверный провод! Бомба взорвалась.\n\n' +
    `@id${userId} теряет 3 ауры.\n` +
    `Правильный провод: ${game.correctWire}.\n` +
    `🌟 Теперь у него: ${newAura}`
  );

  return true;
}

/*
 * ------------------------------
 * 3. Реакция
 * ------------------------------
 */

async function startReaction(
  context,
  vk
) {
  if (!isChat(context)) {
    await context.reply(
      '❌ Игра на реакцию работает только в беседах.'
    );

    return true;
  }

  const peerId =
    Number(context.peerId);

  if (reactionGames.has(peerId)) {
    await context.reply(
      '⚡ В этой беседе уже идёт игра на реакцию.'
    );

    return true;
  }

  const userId =
    Number(context.senderId);

  const reactionKey =
    getPlayerKey(
      peerId,
      userId
    );

  const reactionCooldown =
    checkGameCooldown(
      gameCooldowns.reaction,
      reactionKey,
      REACTION_COOLDOWN
    );

  if (reactionCooldown > 0) {
    return sendCooldown(
      context,
      'Реакция',
      reactionCooldown
    );
  }

  if (reactionGames.has(peerId)) {
    await context.reply(
      '⚡ В этой беседе уже идёт игра на реакцию.'
    );

    return true;
  }

  const delay =
    randomInteger(
      REACTION_MIN_DELAY,
      REACTION_MAX_DELAY
    );

  const game = {
    ready: false,
    finished: false,
    timer: null
  };

  reactionGames.set(
    peerId,
    game
  );

  await context.send(
    '⚡ Приготовьтесь!\n\n' +
    'Когда появится 🟢, напишите:\n' +
    'ловлю\n\n' +
    'Кто напишет раньше сигнала — проиграет.'
  );

  game.timer = setTimeout(
    async () => {
      const currentGame =
        reactionGames.get(peerId);

      if (
        !currentGame ||
        currentGame !== game ||
        currentGame.finished
      ) {
        return;
      }

      currentGame.ready = true;

      await sendMessage(
        vk,
        peerId,
        '🟢 ЛОВИ!'
      ).catch(console.error);
    },
    delay
  );

  return true;
}

async function catchReaction(
  context
) {
  if (!isChat(context)) {
    return false;
  }

  const peerId =
    Number(context.peerId);

  const game =
    reactionGames.get(peerId);

  if (!game || game.finished) {
    return false;
  }

  const userId =
    Number(context.senderId);

  if (!game.ready) {
    game.finished = true;

    if (game.timer) {
      clearTimeout(game.timer);
    }

    reactionGames.delete(peerId);

    const newAura =
      changeAuraAmount(
        peerId,
        userId,
        -2
      );

    await context.send(
      `🚫 @id${userId} написал слишком рано!\n\n` +
      'Игра завершена.\n' +
      '✨ Штраф: -2 ауры\n' +
      `🌟 Теперь у игрока: ${newAura}`
    );

    return true;
  }

  game.finished = true;
  reactionGames.delete(peerId);

  const newAura =
    addAuraAmount(
      peerId,
      userId,
      2
    );

  await context.send(
    `⚡ @id${userId} оказался быстрее всех!\n\n` +
    '✨ Награда: +2 ауры\n' +
    `🌟 Теперь у игрока: ${newAura}`
  );

  return true;
}

/*
 * ------------------------------
 * 4. Кейс
 * ------------------------------
 */

function getCaseDrop() {
  const chance =
    Math.random() * 100;

  if (chance < 1) {
    return {
      amount: 50,
      text:
        '👑 ДЖЕКПОТ! Выпало +50 ауры!'
    };
  }

  if (chance < 11) {
    return {
      amount: 10,
      text:
        '💎 Редкий приз: +10 ауры!'
    };
  }

  if (chance < 31) {
    return {
      amount: 5,
      text:
        '✨ Выпало +5 ауры!'
    };
  }

  if (chance < 51) {
    return {
      amount: 2,
      text:
        '🙂 Выпало +2 ауры.'
    };
  }

  if (chance < 66) {
    return {
      amount: -2,
      text:
        '💀 Не повезло: -2 ауры.'
    };
  }

  return {
    amount: 0,
    text:
      '📦 В кейсе ничего не оказалось.'
  };
}

async function openCase(
  context
) {
  const peerId =
    getRewardPeerId(context);

  const userId =
    Number(context.senderId);

  const key =
    getPlayerKey(
      peerId,
      userId
    );

  const currentTime =
    Date.now();

  const lastOpenedAt =
    caseCooldowns.get(key) ?? 0;

  const remaining =
    CASE_COOLDOWN -
    (currentTime - lastOpenedAt);

  if (
    lastOpenedAt > 0 &&
    remaining > 0
  ) {
    await context.reply(
      '⌛ Следующий кейс можно открыть через ' +
      formatRemainingTime(remaining)
    );

    return true;
  }

  caseCooldowns.set(
    key,
    currentTime
  );

  const drop =
    getCaseDrop();

  let totalAura =
    getTotalAura(userId);

  if (drop.amount > 0) {
    totalAura =
      addAuraAmount(
        peerId,
        userId,
        drop.amount
      );
  } else if (drop.amount < 0) {
    changeAuraAmount(
      peerId,
      userId,
      drop.amount
    );

    totalAura =
      getTotalAura(userId);
  }

  await context.send(
    '📦 Ты открыл кейс...\n\n' +
    `${drop.text}\n\n` +
    `🌟 Общая аура: ${totalAura}`
  );

  return true;
}

/*
 * ------------------------------
 * 5. Казино
 * ------------------------------
 */

async function playCasino(
  context,
  rawBet
) {
  const bet =
    Number(rawBet);

  if (
    !Number.isInteger(bet) ||
    bet <= 0
  ) {
    await context.reply(
      '❌ Укажи целую положительную ставку.\n\n' +
      'Пример:\n' +
      '!казино 10'
    );

    return true;
  }

  if (bet > 1000) {
    await context.reply(
      '❌ Максимальная ставка — 1000 ауры.'
    );

    return true;
  }

  const userId =
    Number(context.senderId);

  const peerId =
    getRewardPeerId(context);

  const casinoKey =
    getPlayerKey(
      peerId,
      userId
    );

  const casinoCooldown =
    checkGameCooldown(
      gameCooldowns.casino,
      casinoKey,
      CASINO_COOLDOWN
    );

  if (casinoCooldown > 0) {
    return sendCooldown(
      context,
      'Казино',
      casinoCooldown
    );
  }

  const totalAura =
    getTotalAura(userId);

  if (totalAura < bet) {
    await context.reply(
      '❌ Недостаточно ауры.\n\n' +
      `Твоя аура: ${totalAura}\n` +
      `Ставка: ${bet}`
    );

    return true;
  }

  const won =
    Math.random() < 0.5;

  if (won) {
    /*
     * Чистая прибыль равна ставке.
     */
    addAuraAmount(
      peerId,
      userId,
      bet
    );

    const newTotal =
      getTotalAura(userId);

    await context.send(
      '🎰 Победа!\n\n' +
      `Ты выиграл +${bet} ауры.\n` +
      `🌟 Общая аура: ${newTotal}`
    );

    return true;
  }

  changeAuraAmount(
    peerId,
    userId,
    -bet
  );

  const newTotal =
    getTotalAura(userId);

  await context.send(
    '🎰 Проигрыш!\n\n' +
    `Ты потерял ${bet} ауры.\n` +
    `🌟 Общая аура: ${newTotal}`
  );

  return true;
}

/*
 * ------------------------------
 * 6. Угадай число
 * ------------------------------
 */

async function startGuessGame(
  context,
  vk
) {
  if (!isChat(context)) {
    await context.reply(
      '❌ Угадай число работает только в беседах.'
    );

    return true;
  }

  const peerId =
    Number(context.peerId);

  if (guessGames.has(peerId)) {
    await context.reply(
      '🎯 В этой беседе уже загадано число.'
    );

    return true;
  }

  const userId =
    Number(context.senderId);

  const guessKey =
    getPlayerKey(
      peerId,
      userId
    );

  const guessCooldown =
    checkGameCooldown(
      gameCooldowns.guess,
      guessKey,
      GUESS_COOLDOWN
    );

  if (guessCooldown > 0) {
    return sendCooldown(
      context,
      'Угадай число',
      guessCooldown
    );
  }

  if (guessGames.has(peerId)) {
    await context.reply(
      '🎯 В этой беседе уже загадано число.'
    );

    return true;
  }

  const number =
    randomInteger(1, 20);

  const game = {
    number,
    finished: false,
    attempts: new Set(),
    timer: null
  };

  guessGames.set(
    peerId,
    game
  );

  await context.send(
    '🎯 Я загадал число от 1 до 20!\n\n' +
    'Пишите:\n' +
    '!число 7\n\n' +
    'У каждого игрока одна попытка.\n' +
    'Время — 60 секунд.'
  );

  game.timer = setTimeout(
    async () => {
      const currentGame =
        guessGames.get(peerId);

      if (
        !currentGame ||
        currentGame !== game ||
        currentGame.finished
      ) {
        return;
      }

      currentGame.finished = true;
      guessGames.delete(peerId);

      await sendMessage(
        vk,
        peerId,
        '⌛ Время вышло!\n\n' +
        `Я загадал число ${number}.`
      ).catch(console.error);
    },
    GUESS_TIME
  );

  return true;
}

async function guessNumber(
  context,
  rawNumber
) {
  if (!isChat(context)) {
    return false;
  }

  const peerId =
    Number(context.peerId);

  const game =
    guessGames.get(peerId);

  if (!game || game.finished) {
    await context.reply(
      '❌ Сейчас число не загадано.\n\n' +
      'Запусти игру командой !угадай'
    );

    return true;
  }

  const userId =
    Number(context.senderId);

  if (game.attempts.has(userId)) {
    await context.reply(
      '⏳ Ты уже использовал свою попытку.'
    );

    return true;
  }

  const number =
    Number(rawNumber);

  if (
    !Number.isInteger(number) ||
    number < 1 ||
    number > 20
  ) {
    await context.reply(
      '❌ Напиши целое число от 1 до 20.'
    );

    return true;
  }

  game.attempts.add(userId);

  if (number !== game.number) {
    const hint =
      number < game.number
        ? 'Загаданное число больше.'
        : 'Загаданное число меньше.';

    await context.reply(
      `❌ Не угадал. ${hint}`
    );

    return true;
  }

  game.finished = true;

  if (game.timer) {
    clearTimeout(game.timer);
  }

  guessGames.delete(peerId);

  const newAura =
    addAuraAmount(
      peerId,
      userId,
      4
    );

  await context.send(
    `🏆 @id${userId} угадал число ${game.number}!\n\n` +
    '✨ Награда: +4 ауры\n' +
    `🌟 Теперь у игрока: ${newAura}`
  );

  return true;
}

/*
 * ------------------------------
 * Главный обработчик
 * ------------------------------
 */

async function handle(
  context,
  vk
) {
  const originalText =
    String(context.text ?? '')
      .trim();

  /*
   * Горячая картошка
   */
  if (/^!картошка$/i.test(originalText)) {
    return startHotPotato(
      context,
      vk
    );
  }

  const passMatch =
    originalText.match(
      /^!пас(?:\s+(.+))?$/i
    );

  if (passMatch) {
    return passHotPotato(
      context,
      vk,
      passMatch[1]
    );
  }

  /*
   * Бомба
   */
  if (/^!бомба$/i.test(originalText)) {
    return startBomb(
      context,
      vk
    );
  }

  const wireMatch =
    originalText.match(
      /^!режу\s+(красный|синий|зелёный)$/i
    );

  if (wireMatch) {
    return cutBombWire(
      context,
      wireMatch[1]
    );
  }

  /*
   * Реакция
   */
  if (/^!реакция$/i.test(originalText)) {
    return startReaction(
      context,
      vk
    );
  }

  if (/^ловлю$/i.test(originalText)) {
    return catchReaction(
      context
    );
  }

  /*
   * Кейс
   */
  if (/^!кейс$/i.test(originalText)) {
    return openCase(
      context
    );
  }

  /*
   * Казино
   */
  const casinoMatch =
    originalText.match(
      /^!казино(?:\s+(.+))?$/i
    );

  if (casinoMatch) {
    return playCasino(
      context,
      casinoMatch[1]
    );
  }

  /*
   * Угадай число
   */
  if (/^!угадай$/i.test(originalText)) {
    return startGuessGame(
      context,
      vk
    );
  }

  const numberMatch =
    originalText.match(
      /^!число\s+(.+)$/i
    );

  if (numberMatch) {
    return guessNumber(
      context,
      numberMatch[1]
    );
  }

  return false;
}

module.exports = {
  handle
};
