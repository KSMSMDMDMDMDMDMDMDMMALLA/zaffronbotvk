const crypto = require('node:crypto');
const { Keyboard } = require('vk-io');

const {
  formatMoney,
  getBalance,
  getMagazineAssets,
  transferBalance
} = require('./database');

const {
  getItem
} = require('./magazine/catalog');

const INVITE_TIMEOUT = 2 * 60 * 1000;

const races = new Map();
const playerRaces = new Map();

function makeRaceId() {
  return crypto
    .randomBytes(8)
    .toString('hex');
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

  return Number.isInteger(userId) && userId > 0
    ? userId
    : null;
}

function extractVkTarget(value) {
  return String(value ?? '')
    .trim()
    .replace(
      /^https?:\/\/(www\.)?vk\.(?:ru|com)\//i,
      ''
    )
    .replace(/^vk\.(?:ru|com)\//i, '')
    .replace(/^@/, '')
    .replace(
      /^\[id(\d+)\|.*\]$/i,
      'id$1'
    )
    .split(/[/?#\s]/)[0]
    .trim();
}

function parseAmount(value) {
  const normalized = String(value ?? '')
    .trim()
    .replace(/\$$/, '')
    .trim();

  if (!/^\d[\d\s.,_]*$/.test(normalized)) {
    return null;
  }

  const amount = Number(
    normalized.replace(/[\s.,_]/g, '')
  );

  return Number.isSafeInteger(amount) && amount > 0
    ? amount
    : null;
}

function parseRaceArguments(rawArguments, hasReply) {
  const value = String(rawArguments ?? '').trim();

  if (!value) {
    return null;
  }

  if (hasReply) {
    return {
      rawTarget: null,
      amount: parseAmount(value)
    };
  }

  const match = value.match(
    /^(\[id\d+\|.+?\]|@\S+|(?:https?:\/\/)?(?:www\.)?vk\.(?:ru|com)\/\S+|id\d+|\S+)\s+(.+)$/i
  );

  if (!match) {
    return null;
  }

  return {
    rawTarget: match[1],
    amount: parseAmount(match[2])
  };
}

async function resolveOpponent(
  context,
  vk,
  rawTarget
) {
  const replyId = getReplySenderId(context);

  if (replyId) {
    const users = await vk.api.users.get({
      user_ids: replyId
    });
    const user = users?.[0];

    return user?.id
      ? {
        id: Number(user.id),
        name: getUserName(user)
      }
      : {
        id: replyId,
        name: `id${replyId}`
      };
  }

  const target = extractVkTarget(rawTarget);

  if (!target) {
    return null;
  }

  const users = await vk.api.users.get({
    user_ids: target
  });
  const user = users?.[0];

  if (!user?.id) {
    return null;
  }

  return {
    id: Number(user.id),
    name: getUserName(user)
  };
}

function getUserName(user) {
  return [
    user?.first_name,
    user?.last_name
  ]
    .filter(Boolean)
    .join(' ') || `id${user?.id}`;
}

async function getUsersMap(vk, userIds) {
  const ids = [
    ...new Set(userIds.map(Number))
  ];

  try {
    const users = await vk.api.users.get({
      user_ids: ids.join(',')
    });

    return new Map(
      users.map(user => [
        Number(user.id),
        getUserName(user)
      ])
    );
  } catch (error) {
    console.error(
      'Не удалось получить имена участников гонки:',
      error
    );

    return new Map();
  }
}

function getBestCar(vkId) {
  const cars = getMagazineAssets(vkId)
    .filter(asset => asset.itemType === 'cars')
    .map(asset => getItem(asset.itemKey))
    .filter(Boolean)
    .sort((first, second) =>
      second.price - first.price
    );

  return cars[0] ?? null;
}

function createRaceKeyboard(raceId) {
  return Keyboard.builder()
    .textButton({
      label: '✅ Принять гонку',
      payload: {
        command: 'race_accept',
        raceId
      },
      color: Keyboard.POSITIVE_COLOR
    })
    .textButton({
      label: '❌ Отказаться',
      payload: {
        command: 'race_decline',
        raceId
      },
      color: Keyboard.NEGATIVE_COLOR
    })
    .inline();
}

function deleteRace(race) {
  races.delete(race.id);

  for (const userId of [
    race.challengerId,
    race.opponentId
  ]) {
    if (playerRaces.get(userId) === race.id) {
      playerRaces.delete(userId);
    }
  }

  if (race.timer) {
    clearTimeout(race.timer);
    race.timer = null;
  }
}

async function sendToRace(vk, race, message) {
  const parameters = typeof message === 'string'
    ? { message }
    : message;

  if (race.mode === 'chat') {
    await vk.api.messages.send({
      peer_id: race.peerId,
      random_id: 0,
      ...parameters
    });

    return;
  }

  await Promise.all([
    race.challengerId,
    race.opponentId
  ].map(peerId =>
    vk.api.messages.send({
      peer_id: peerId,
      random_id: 0,
      ...parameters
    })
  ));
}

async function sendUsage(context) {
  await context.send(
    '🏁 Гонки Zaffron\n\n' +
    'Чтобы вызвать игрока:\n' +
    '!гонка @username [ставка]\n\n' +
    'Пример:\n' +
    '!гонка @username 10.000\n\n' +
    'Можно ответить на сообщение игрока:\n' +
    '!гонка 10.000\n\n' +
    '🚗 У обоих участников должна быть машина.\n' +
    '🏎 Автоматически выбирается самая дорогая машина.\n' +
    '🏆 Побеждает игрок с лучшей машиной.\n' +
    '🎲 При равных машинах победитель определяется случайно.\n' +
    '💵 Победитель получает ставку проигравшего.\n' +
    '⏳ Вызов действует 2 минуты.'
  );

  return true;
}

async function createRace(
  context,
  vk,
  rawArguments
) {
  const challengerId = Number(context.senderId);
  const replyId = getReplySenderId(context);
  const parsed = parseRaceArguments(
    rawArguments,
    Boolean(replyId)
  );

  if (!parsed?.amount) {
    return sendUsage(context);
  }

  let opponent;

  try {
    opponent = await resolveOpponent(
      context,
      vk,
      parsed.rawTarget
    );
  } catch (error) {
    console.error(
      'Ошибка поиска соперника для гонки:',
      error
    );

    await context.send(
      '❌ Не удалось найти соперника. Проверь username.'
    );

    return true;
  }

  if (!opponent) {
    await context.send(
      '❌ Соперник не найден. Проверь username или используй реплай.'
    );

    return true;
  }

  if (opponent.id === challengerId) {
    await context.send(
      '🤨 Устроить гонку с самим собой нельзя.'
    );

    return true;
  }

  if (
    playerRaces.has(challengerId) ||
    playerRaces.has(opponent.id)
  ) {
    await context.send(
      '❌ Один из игроков уже участвует в другом вызове на гонку.'
    );

    return true;
  }

  const challengerCar = getBestCar(challengerId);
  const opponentCar = getBestCar(opponent.id);

  if (!challengerCar) {
    await context.send(
      '❌ Для гонки тебе нужна машина.\n\n' +
      'Купить её можно командой: !магазин машин'
    );

    return true;
  }

  if (!opponentCar) {
    await context.send(
      `❌ У @id${opponent.id} (${opponent.name}) нет машины для гонки.`
    );

    return true;
  }

  const challengerBalance = getBalance(challengerId);
  const opponentBalance = getBalance(opponent.id);

  if (challengerBalance < parsed.amount) {
    await context.send(
      '❌ У тебя недостаточно денег для этой ставки.\n\n' +
      `💵 Ставка: ${formatMoney(parsed.amount)} $\n` +
      `🏦 Баланс: ${formatMoney(challengerBalance)} $`
    );

    return true;
  }

  if (opponentBalance < parsed.amount) {
    await context.send(
      `❌ У @id${opponent.id} (${opponent.name}) недостаточно денег для этой ставки.\n\n` +
      `💵 Требуется: ${formatMoney(parsed.amount)} $\n` +
      `🏦 Баланс игрока: ${formatMoney(opponentBalance)} $`
    );

    return true;
  }

  const mode = context.isChat
    ? 'chat'
    : 'private';
  const race = {
    id: makeRaceId(),
    mode,
    peerId: Number(context.peerId),
    challengerId,
    opponentId: opponent.id,
    amount: parsed.amount,
    status: 'pending',
    timer: null
  };

  races.set(race.id, race);
  playerRaces.set(challengerId, race.id);
  playerRaces.set(opponent.id, race.id);

  const names = await getUsersMap(
    vk,
    [challengerId, opponent.id]
  );
  const challengerName =
    names.get(challengerId) ?? `id${challengerId}`;
  const opponentName =
    names.get(opponent.id) ?? opponent.name;
  const invitation =
    `🏁 @id${challengerId} (${challengerName}) вызывает тебя на гонку!\n\n` +
    `🚗 Его машина: ${challengerCar.title}\n` +
    `🚘 Твоя машина: ${opponentCar.title}\n` +
    `💵 Ставка каждого: ${formatMoney(race.amount)} $\n\n` +
    'Принять вызов?';

  try {
    if (mode === 'chat') {
      await context.send({
        message:
          `🏁 Вызов на гонку отправлен!\n\n` +
          `@id${opponent.id} (${opponentName}), прими или отклони вызов.\n` +
          `💵 Ставка: ${formatMoney(race.amount)} $`,
        keyboard: createRaceKeyboard(race.id)
      });
    } else {
      await vk.api.messages.send({
        peer_id: opponent.id,
        random_id: 0,
        message: invitation,
        keyboard: createRaceKeyboard(race.id)
      });

      await context.send(
        `🏁 Вызов отправлен @id${opponent.id} (${opponentName}).\n` +
        `💵 Ставка: ${formatMoney(race.amount)} $`
      );
    }
  } catch (error) {
    deleteRace(race);

    console.error(
      'Ошибка отправки вызова на гонку:',
      error
    );

    await context.send(
      '❌ Не удалось отправить вызов.\n\n' +
      'Вероятно, пользователь ещё не писал боту в личные сообщения.'
    );

    return true;
  }

  race.timer = setTimeout(async () => {
    if (
      !races.has(race.id) ||
      race.status !== 'pending'
    ) {
      return;
    }

    race.status = 'expired';
    deleteRace(race);

    try {
      await sendToRace(
        vk,
        race,
        '⌛ Время принятия гонки истекло.'
      );
    } catch (error) {
      console.error(
        'Не удалось сообщить об истечении вызова на гонку:',
        error
      );
    }
  }, INVITE_TIMEOUT);

  return true;
}

async function acceptRace(context, vk, race) {
  const senderId = Number(context.senderId);

  if (senderId !== race.opponentId) {
    await context.send(
      '❌ Этот вызов на гонку предназначен не тебе.'
    );

    return true;
  }

  if (race.status !== 'pending') {
    await context.send(
      '❌ Этот вызов уже недоступен.'
    );

    return true;
  }

  race.status = 'resolving';

  const challengerCar = getBestCar(
    race.challengerId
  );
  const opponentCar = getBestCar(
    race.opponentId
  );

  if (!challengerCar || !opponentCar) {
    deleteRace(race);

    await sendToRace(
      vk,
      race,
      '❌ Гонка отменена: у одного из игроков больше нет машины.'
    );

    return true;
  }

  const challengerBalance = getBalance(
    race.challengerId
  );
  const opponentBalance = getBalance(
    race.opponentId
  );

  if (
    challengerBalance < race.amount ||
    opponentBalance < race.amount
  ) {
    const missingUserId =
      challengerBalance < race.amount
        ? race.challengerId
        : race.opponentId;

    deleteRace(race);

    await sendToRace(
      vk,
      race,
      `❌ Гонка отменена: у @id${missingUserId} недостаточно денег для ставки.`
    );

    return true;
  }

  let winnerId;

  if (challengerCar.price > opponentCar.price) {
    winnerId = race.challengerId;
  } else if (opponentCar.price > challengerCar.price) {
    winnerId = race.opponentId;
  } else {
    winnerId = crypto.randomInt(0, 2) === 0
      ? race.challengerId
      : race.opponentId;
  }

  const loserId = winnerId === race.challengerId
    ? race.opponentId
    : race.challengerId;
  const transferResult = transferBalance({
    senderId: loserId,
    recipientId: winnerId,
    amount: race.amount
  });

  if (transferResult.status !== 'transferred') {
    const reason = transferResult.status === 'recipient_limit'
      ? 'баланс победителя достиг технического лимита'
      : 'у проигравшего изменился баланс';

    deleteRace(race);

    await sendToRace(
      vk,
      race,
      `❌ Гонка отменена: ${reason}.`
    );

    return true;
  }

  const names = await getUsersMap(
    vk,
    [race.challengerId, race.opponentId]
  );
  const winnerName =
    names.get(winnerId) ?? `id${winnerId}`;
  const loserName =
    names.get(loserId) ?? `id${loserId}`;
  const winnerCar = winnerId === race.challengerId
    ? challengerCar
    : opponentCar;
  const loserCar = loserId === race.challengerId
    ? challengerCar
    : opponentCar;
  const equalCars =
    challengerCar.price === opponentCar.price;

  deleteRace(race);

  await sendToRace(
    vk,
    race,
    '🏁 Гонка завершена!\n\n' +
    `🚗 @id${winnerId} (${winnerName}): ${winnerCar.title}\n` +
    `🚙 @id${loserId} (${loserName}): ${loserCar.title}\n` +
    (equalCars
      ? '🎲 Машины равны — победителя определил случай.\n\n'
      : '⚡ Более дорогая машина оказалась быстрее.\n\n') +
    `🏆 Победитель: @id${winnerId} (${winnerName})\n` +
    `💵 Выигрыш: +${formatMoney(race.amount)} $\n` +
    `🏦 Баланс победителя: ${formatMoney(transferResult.recipientBalance)} $\n` +
    `💸 Баланс проигравшего: ${formatMoney(transferResult.senderBalance)} $`
  );

  return true;
}

async function declineRace(context, vk, race) {
  if (Number(context.senderId) !== race.opponentId) {
    await context.send(
      '❌ Этот вызов на гонку предназначен не тебе.'
    );

    return true;
  }

  if (race.status !== 'pending') {
    await context.send(
      '❌ Этот вызов уже недоступен.'
    );

    return true;
  }

  race.status = 'declined';

  deleteRace(race);

  await sendToRace(
    vk,
    race,
    `❌ @id${race.opponentId} отказался от гонки.`
  );

  return true;
}

async function handle(context, vk) {
  const originalText =
    String(context.text ?? '').trim();
  const payload = context.messagePayload;

  if (payload?.command === 'race_accept') {
    const race = races.get(
      String(payload.raceId)
    );

    if (!race) {
      await context.send(
        '❌ Этот вызов на гонку уже недоступен.'
      );

      return true;
    }

    return acceptRace(context, vk, race);
  }

  if (payload?.command === 'race_decline') {
    const race = races.get(
      String(payload.raceId)
    );

    if (!race) {
      await context.send(
        '❌ Этот вызов на гонку уже недоступен.'
      );

      return true;
    }

    return declineRace(context, vk, race);
  }

  if (/^!гонка\s*$/i.test(originalText)) {
    return sendUsage(context);
  }

  const match = originalText.match(
    /^!гонка\s+(.+)$/i
  );

  if (!match) {
    return false;
  }

  return createRace(
    context,
    vk,
    match[1]
  );
}

module.exports = {
  handle
};
