const axios = require('axios');
const crypto = require('node:crypto');
const {
  Keyboard
} = require('vk-io');

const {
  formatMoney,
  applyGameReward,
  incrementQuestStat
} = require('./database');

/*
 * Настройки игры
 */
const TOTAL_ROUNDS = 10;
const WINNER_DOLLAR_REWARD = 15;

const INVITE_TIMEOUT =
  5 * 60 * 1000;

const ROUND_TIMEOUT =
  10 * 60 * 1000;

/*
 * Все активные дуэли.
 *
 * duelId -> duel
 */
const duels = new Map();

/*
 * Индекс активных игр пользователя.
 *
 * Ключ:
 * peerId:userId
 *
 * Значение:
 * duelId
 */
const playerDuels = new Map();

/*
 * Входящие приглашения.
 *
 * Ключ:
 * peerId:userId
 *
 * Значение:
 * duelId
 */
const invitations = new Map();

function wait(milliseconds) {
  return new Promise(resolve =>
    setTimeout(resolve, milliseconds)
  );
}

function makeDuelId() {
  return crypto
    .randomBytes(12)
    .toString('hex');
}

function getPlayerKey(
  peerId,
  userId
) {
  return `${peerId}:${userId}`;
}

function getPrivatePlayerKey(userId) {
  return `private:${userId}`;
}

function getDuelPlayerKey(
  duel,
  userId
) {
  if (duel.mode === 'private') {
    return getPrivatePlayerKey(userId);
  }

  return getPlayerKey(
    duel.peerId,
    userId
  );
}

function getInvitationKey(
  peerId,
  userId,
  mode
) {
  if (mode === 'private') {
    return getPrivatePlayerKey(userId);
  }

  return getPlayerKey(
    peerId,
    userId
  );
}

function isUserBusy(
  peerId,
  userId,
  mode
) {
  const key = mode === 'private'
    ? getPrivatePlayerKey(userId)
    : getPlayerKey(peerId, userId);

  return playerDuels.has(key);
}

function setPlayerBusy(
  duel,
  userId
) {
  playerDuels.set(
    getDuelPlayerKey(duel, userId),
    duel.id
  );
}

function clearPlayerBusy(
  duel,
  userId
) {
  playerDuels.delete(
    getDuelPlayerKey(duel, userId)
  );
}

function getUserIdFromReply(context) {
  const reply =
    context.replyMessage;

  if (!reply) {
    return null;
  }

  const value =
    reply.senderId ??
    reply.sender_id ??
    reply.fromId ??
    reply.from_id;

  const id = Number(value);

  return Number.isInteger(id)
    ? id
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

async function resolveUserId(
  context,
  vk,
  rawTarget
) {
  const replyTarget =
    getUserIdFromReply(context);

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

async function getUsersMap(
  vk,
  ids
) {
  const uniqueIds = [
    ...new Set(
      ids.map(Number)
    )
  ];

  if (uniqueIds.length === 0) {
    return new Map();
  }

  try {
    const users =
      await vk.api.users.get({
        user_ids: uniqueIds.join(',')
      });

    return new Map(
      users.map(user => [
        Number(user.id),
        user
      ])
    );
  } catch (error) {
    console.error(
      'Не удалось получить пользователей дуэли:',
      error
    );

    return new Map();
  }
}

function getDisplayName(
  usersMap,
  userId
) {
  const user =
    usersMap.get(Number(userId));

  if (!user) {
    return `id${userId}`;
  }

  return [
    user.first_name,
    user.last_name
  ]
    .filter(Boolean)
    .join(' ');
}

function createInviteKeyboard(duelId) {
  return Keyboard.builder()
    .textButton({
      label: '✅ Принять дуэль',
      payload: {
        command: 'memduel_accept',
        duelId
      },
      color: Keyboard.POSITIVE_COLOR
    })
    .textButton({
      label: '❌ Отказаться',
      payload: {
        command: 'memduel_decline',
        duelId
      },
      color: Keyboard.NEGATIVE_COLOR
    })
    .inline();
}

function getPhotoUrl(photo) {
  if (photo.largeSizeUrl) {
    return photo.largeSizeUrl;
  }

  if (
    Array.isArray(photo.sizes) &&
    photo.sizes.length > 0
  ) {
    const sizes =
      [...photo.sizes].sort(
        (a, b) => {
          const areaA =
            Number(a.width || 0) *
            Number(a.height || 0);

          const areaB =
            Number(b.width || 0) *
            Number(b.height || 0);

          return areaB - areaA;
        }
      );

    return sizes[0]?.url ?? null;
  }

  return (
    photo.mediumSizeUrl ||
    photo.smallSizeUrl ||
    null
  );
}

async function downloadPhoto(url) {
  let lastError = null;

  for (
    let attempt = 1;
    attempt <= 3;
    attempt++
  ) {
    try {
      const response =
        await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 60000,
          maxContentLength:
            25 * 1024 * 1024,
          maxBodyLength:
            25 * 1024 * 1024,

          headers: {
            'User-Agent':
              'Mozilla/5.0',
            Accept:
              'image/*,*/*;q=0.8'
          }
        });

      const buffer =
        Buffer.from(
          response.data
        );

      if (buffer.length === 0) {
        throw new Error(
          'Получено пустое фото'
        );
      }

      return buffer;
    } catch (error) {
      lastError = error;

      if (attempt < 3) {
        await wait(
          attempt * 1000
        );
      }
    }
  }

  throw (
    lastError ||
    new Error(
      'Не удалось скачать фото'
    )
  );
}

function getPhotoHash(buffer) {
  return crypto
    .createHash('sha256')
    .update(buffer)
    .digest('hex');
}

function getDuelByUser(
  context
) {
  /*
   * Сначала ищем игру в текущей беседе.
   */
  const chatKey =
    getPlayerKey(
      context.peerId,
      context.senderId
    );

  let duelId =
    playerDuels.get(chatKey);

  /*
   * Потом ищем личную игру.
   */
  if (!duelId) {
    duelId =
      playerDuels.get(
        getPrivatePlayerKey(
          context.senderId
        )
      );
  }

  if (!duelId) {
    return null;
  }

  return duels.get(duelId) ?? null;
}

function getOpponentId(
  duel,
  userId
) {
  return duel.challengerId === userId
    ? duel.opponentId
    : duel.challengerId;
}

async function sendToPlayer(
  vk,
  duel,
  userId,
  params
) {
  if (duel.mode === 'private') {
    return vk.api.messages.send({
      peer_id: userId,
      random_id: 0,
      ...params
    });
  }

  return vk.api.messages.send({
    peer_id: duel.peerId,
    random_id: 0,
    ...params
  });
}

async function sendToDuel(
  vk,
  duel,
  params
) {
  if (duel.mode === 'chat') {
    await vk.api.messages.send({
      peer_id: duel.peerId,
      random_id: 0,
      ...params
    });

    return;
  }

  await Promise.allSettled([
    vk.api.messages.send({
      peer_id: duel.challengerId,
      random_id: 0,
      ...params
    }),

    vk.api.messages.send({
      peer_id: duel.opponentId,
      random_id: 0,
      ...params
    })
  ]);
}

function deleteInvitation(duel) {
  invitations.delete(
    getInvitationKey(
      duel.peerId,
      duel.opponentId,
      duel.mode
    )
  );
}

function deleteDuel(duel) {
  deleteInvitation(duel);

  clearPlayerBusy(
    duel,
    duel.challengerId
  );

  clearPlayerBusy(
    duel,
    duel.opponentId
  );

  if (duel.inviteTimer) {
    clearTimeout(
      duel.inviteTimer
    );
  }

  if (duel.roundTimer) {
    clearTimeout(
      duel.roundTimer
    );
  }

  duels.delete(duel.id);
}

async function startRound(
  vk,
  duel
) {
  duel.submissions.clear();

  if (duel.roundTimer) {
    clearTimeout(
      duel.roundTimer
    );
  }

  duel.roundTimer = setTimeout(
    async () => {
      if (!duels.has(duel.id)) {
        return;
      }

      await sendToDuel(
        vk,
        duel,
        {
          message:
            '⌛ Время раунда истекло.\n\n' +
            'Мем-дуэль завершена без победителя.'
        }
      ).catch(console.error);

      deleteDuel(duel);
    },
    ROUND_TIMEOUT
  );

  await sendToDuel(
    vk,
    duel,
    {
      message:
        `😂 Раунд ${duel.round}/${TOTAL_ROUNDS}\n\n` +
        'Оба игрока должны отправить по одному мему.\n' +
        'Повторно использовать одинаковые фотографии нельзя.'
    }
  );
}

async function finishDuel(
  vk,
  duel
) {
  if (duel.roundTimer) {
    clearTimeout(
      duel.roundTimer
    );
  }

  const users =
    await getUsersMap(
      vk,
      [
        duel.challengerId,
        duel.opponentId
      ]
    );

  const challengerName =
    getDisplayName(
      users,
      duel.challengerId
    );

  const opponentName =
    getDisplayName(
      users,
      duel.opponentId
    );

  incrementQuestStat(
    duel.challengerId,
    'memduels_played'
  );
  incrementQuestStat(
    duel.opponentId,
    'memduels_played'
  );

  /*
   * При счёте 5:5 награда не выдаётся.
   */
  if (
    duel.scores.challenger ===
    duel.scores.opponent
  ) {
    await sendToDuel(
      vk,
      duel,
      {
        message:
          '🤝 Мем-дуэль завершилась ничьёй!\n\n' +
          `@id${duel.challengerId} (${challengerName}) — ` +
          `${duel.scores.challenger}\n` +
          `@id${duel.opponentId} (${opponentName}) — ` +
          `${duel.scores.opponent}\n\n` +
          'Награда не начислена.'
      }
    );

    deleteDuel(duel);
    return;
  }

  const challengerWon =
    duel.scores.challenger >
    duel.scores.opponent;

  const winnerId =
    challengerWon
      ? duel.challengerId
      : duel.opponentId;

  const winnerName =
    getDisplayName(
      users,
      winnerId
    );

  const rewardResult =
    applyGameReward(
      winnerId,
      WINNER_DOLLAR_REWARD
    );

  const rewardDetails = [];

  if (rewardResult.debtPaid > 0) {
    rewardDetails.push(
      `💳 Погашено долга: ${formatMoney(rewardResult.debtPaid)} ₽`,
      `💵 Зачислено на баланс: ${formatMoney(rewardResult.credited)} ₽`
    );
  }

  if (rewardResult.debt > 0) {
    rewardDetails.push(
      `🥔 Долг в играх: ${formatMoney(rewardResult.debt)} ₽`
    );
  }

  rewardDetails.push(
    `💵 Баланс: ${formatMoney(rewardResult.balance)} ₽`
  );

  await sendToDuel(
    vk,
    duel,
    {
      message:
        '🏆 Мем-дуэль завершена!\n\n' +
        `@id${duel.challengerId} (${challengerName}) — ` +
        `${duel.scores.challenger}\n` +
        `@id${duel.opponentId} (${opponentName}) — ` +
        `${duel.scores.opponent}\n\n` +
        `👑 Победитель: @id${winnerId} (${winnerName})\n` +
        `💵 Награда: +${formatMoney(WINNER_DOLLAR_REWARD)} ₽\n` +
        rewardDetails.join('\n')
    }
  );

  deleteDuel(duel);
}

async function resolveRound(
  vk,
  duel
) {
  const challengerSubmission =
    duel.submissions.get(
      duel.challengerId
    );

  const opponentSubmission =
    duel.submissions.get(
      duel.opponentId
    );

  if (
    !challengerSubmission ||
    !opponentSubmission
  ) {
    return;
  }

  if (duel.roundTimer) {
    clearTimeout(
      duel.roundTimer
    );
  }

  /*
   * Результат раунда полностью случайный.
   */
  const challengerWins =
    Math.random() < 0.5;

  const winnerId =
    challengerWins
      ? duel.challengerId
      : duel.opponentId;

  if (challengerWins) {
    duel.scores.challenger += 1;
  } else {
    duel.scores.opponent += 1;
  }

  const users =
    await getUsersMap(
      vk,
      [winnerId]
    );

  const winnerName =
    getDisplayName(
      users,
      winnerId
    );

  await sendToDuel(
    vk,
    duel,
    {
      message:
        `🎲 Результат раунда ${duel.round}\n\n` +
        `🏆 Балл получает @id${winnerId} (${winnerName})\n\n` +
        `📊 Счёт: ${duel.scores.challenger} : ` +
        `${duel.scores.opponent}`
    }
  );

  if (
    duel.round >= TOTAL_ROUNDS
  ) {
    await finishDuel(
      vk,
      duel
    );

    return;
  }

  duel.round += 1;

  await startRound(
    vk,
    duel
  );
}

async function createDuel(
  context,
  vk,
  opponentId
) {
  const challengerId =
    Number(context.senderId);

  if (
    opponentId === challengerId
  ) {
    await context.reply(
      '🤨 Самого себя вызвать на мем-дуэль нельзя.'
    );

    return true;
  }

  if (opponentId <= 0) {
    await context.reply(
      '❌ Сообщество нельзя вызвать на мем-дуэль.'
    );

    return true;
  }

  const mode =
    context.peerId >= 2000000000
      ? 'chat'
      : 'private';

  const duelPeerId =
    mode === 'chat'
      ? Number(context.peerId)
      : 0;

  if (
    isUserBusy(
      duelPeerId,
      challengerId,
      mode
    )
  ) {
    await context.reply(
      '⏳ Ты уже участвуешь в мем-дуэли.'
    );

    return true;
  }

  if (
    isUserBusy(
      duelPeerId,
      opponentId,
      mode
    )
  ) {
    await context.reply(
      '⏳ Этот пользователь уже участвует в мем-дуэли.'
    );

    return true;
  }

  const duel = {
    id: makeDuelId(),

    mode,

    peerId: duelPeerId,

    challengerId,
    opponentId,

    status: 'pending',

    round: 1,

    scores: {
      challenger: 0,
      opponent: 0
    },

    submissions: new Map(),

    /*
     * Все использованные хэши за матч.
     * Повтор запрещён обоим игрокам.
     */
    usedHashes: new Set(),

    inviteTimer: null,
    roundTimer: null
  };

  duels.set(
    duel.id,
    duel
  );

  const inviteKey =
    getInvitationKey(
      duel.peerId,
      opponentId,
      mode
    );

  invitations.set(
    inviteKey,
    duel.id
  );

  const users =
    await getUsersMap(
      vk,
      [
        challengerId,
        opponentId
      ]
    );

  const challengerName =
    getDisplayName(
      users,
      challengerId
    );

  const opponentName =
    getDisplayName(
      users,
      opponentId
    );

  const inviteMessage =
    `⚔ @id${challengerId} (${challengerName}) ` +
    'вызывает тебя на мем-дуэль!\n\n' +
    `🎮 Раундов: ${TOTAL_ROUNDS}\n` +
    `💵 Награда: ${formatMoney(WINNER_DOLLAR_REWARD)} ₽\n\n` +
    'Принять вызов?';

  try {
    if (mode === 'chat') {
      await context.send({
        message:
          `⚔ Вызов отправлен!\n\n` +
          `@id${opponentId} (${opponentName}), ` +
          'прими или отклони дуэль:',

        keyboard:
          createInviteKeyboard(
            duel.id
          )
      });
    } else {
      await vk.api.messages.send({
        peer_id: opponentId,
        random_id: 0,
        message: inviteMessage,
        keyboard:
          createInviteKeyboard(
            duel.id
          )
      });

      await context.reply(
        `⚔ Вызов отправлен @id${opponentId} (${opponentName}).`
      );
    }
  } catch (error) {
    deleteDuel(duel);

    console.error(
      'Ошибка отправки вызова мем-дуэли:',
      error
    );

    await context.reply(
      '❌ Не удалось отправить вызов.\n\n' +
      'Вероятно, пользователь ещё не писал боту в личные сообщения.'
    );

    return true;
  }

  duel.inviteTimer = setTimeout(
    async () => {
      if (
        !duels.has(duel.id) ||
        duel.status !== 'pending'
      ) {
        return;
      }

      await sendToDuel(
        vk,
        duel,
        {
          message:
            '⌛ Время принятия мем-дуэли истекло.'
        }
      ).catch(console.error);

      deleteDuel(duel);
    },
    INVITE_TIMEOUT
  );

  return true;
}

async function acceptDuel(
  context,
  vk,
  duel
) {
  if (
    Number(context.senderId) !==
    duel.opponentId
  ) {
    await context.send(
      '❌ Этот вызов предназначен не тебе.'
    );

    return true;
  }

  if (
    duel.status !== 'pending'
  ) {
    await context.send(
      '❌ Этот вызов уже недоступен.'
    );

    return true;
  }

  duel.status = 'active';

  deleteInvitation(duel);

  if (duel.inviteTimer) {
    clearTimeout(
      duel.inviteTimer
    );
  }

  setPlayerBusy(
    duel,
    duel.challengerId
  );

  setPlayerBusy(
    duel,
    duel.opponentId
  );

  await sendToDuel(
    vk,
    duel,
    {
      message:
        '✅ Мем-дуэль принята!\n\n' +
        `Игра состоит из ${TOTAL_ROUNDS} раундов.\n` +
        'В каждом раунде оба игрока отправляют по одному мему.'
    }
  );

  await startRound(
    vk,
    duel
  );

  return true;
}

async function declineDuel(
  context,
  vk,
  duel
) {
  if (
    Number(context.senderId) !==
    duel.opponentId
  ) {
    await context.send(
      '❌ Этот вызов предназначен не тебе.'
    );

    return true;
  }

  await sendToDuel(
    vk,
    duel,
    {
      message:
        `❌ @id${duel.opponentId} отказался от мем-дуэли.`
    }
  );

  deleteDuel(duel);

  return true;
}

async function handlePhoto(
  context,
  vk,
  duel
) {
  if (
    duel.status !== 'active'
  ) {
    return false;
  }

  const senderId =
    Number(context.senderId);

  if (
    senderId !== duel.challengerId &&
    senderId !== duel.opponentId
  ) {
    return false;
  }

  /*
   * В беседе фото должно быть отправлено
   * именно в беседу игры.
   */
  if (
    duel.mode === 'chat' &&
    Number(context.peerId) !==
    duel.peerId
  ) {
    return false;
  }

  /*
   * В ЛС фото должно прийти боту напрямую.
   */
  if (
    duel.mode === 'private' &&
    Number(context.peerId) !==
    senderId
  ) {
    return false;
  }

  if (
    duel.submissions.has(senderId)
  ) {
    await context.reply(
      '⏳ Ты уже отправил мем в этом раунде. Ждём соперника.'
    );

    return true;
  }

  const photo =
    context.attachments.find(
      attachment =>
        attachment.type === 'photo'
    );

  if (!photo) {
    return false;
  }

  try {
    const url =
      getPhotoUrl(photo);

    if (!url) {
      throw new Error(
        'Не удалось получить URL фото'
      );
    }

    const buffer =
      await downloadPhoto(url);

    const hash =
      getPhotoHash(buffer);

    if (
      duel.usedHashes.has(hash)
    ) {
      await context.reply(
        '♻ Этот мем уже использовался в этой дуэли.\n\n' +
        'Отправь другую фотографию.'
      );

      return true;
    }

    duel.usedHashes.add(hash);

    duel.submissions.set(
      senderId,
      {
        hash,
        attachment:
          `photo${photo.ownerId}_${photo.id}` +
          (
            photo.accessKey
              ? `_${photo.accessKey}`
              : ''
          )
      }
    );

    await context.reply(
      '✅ Мем принят!\n\n' +
      (
        duel.submissions.size < 2
          ? 'Ждём мем соперника.'
          : 'Оба мема получены. Определяю победителя...'
      )
    );

    if (
      duel.submissions.size === 2
    ) {
      await resolveRound(
        vk,
        duel
      );
    }

    return true;
  } catch (error) {
    console.error(
      'Ошибка при обработке мема дуэли:',
      error
    );

    await context.reply(
      '❌ Не удалось принять фотографию. Попробуй ещё раз.'
    );

    return true;
  }
}

async function handle(
  context,
  vk
) {
  const originalText =
    String(context.text ?? '')
      .trim();

  const payload =
    context.messagePayload;

  /*
   * Кнопки принятия и отказа.
   */
  if (
    payload?.command ===
    'memduel_accept'
  ) {
    const duel =
      duels.get(
        payload.duelId
      );

    if (!duel) {
      await context.send(
        '❌ Этот вызов уже недоступен.'
      );

      return true;
    }

    return acceptDuel(
      context,
      vk,
      duel
    );
  }

  if (
    payload?.command ===
    'memduel_decline'
  ) {
    const duel =
      duels.get(
        payload.duelId
      );

    if (!duel) {
      await context.send(
        '❌ Этот вызов уже недоступен.'
      );

      return true;
    }

    return declineDuel(
      context,
      vk,
      duel
    );
  }

  /*
   * Команда без указанного соперника.
   */
// !мемдуэль (реплаем или без аргумента)
if (/^!мемдуэль\s*$/i.test(originalText)) {
  const opponentId =
    getUserIdFromReply(context);

  if (!opponentId) {
    await context.reply(
      '❌ Укажи соперника или ответь командой на его сообщение.\n\n' +
      'Пример:\n' +
      '!мемдуэль @username'
    );

    return true;
  }

  return createDuel(
    context,
    vk,
    opponentId
  );
}

// !мемдуэль @username
const duelMatch =
  originalText.match(
    /^!мемдуэль\s+(.+)$/i
  );

if (duelMatch) {
  try {
    const opponentId =
      await resolveUserId(
        context,
        vk,
        duelMatch[1]
      );

    if (!opponentId) {
      await context.reply(
        '❌ Не удалось найти пользователя.'
      );

      return true;
    }

    return createDuel(
      context,
      vk,
      opponentId
    );
  } catch (error) {
    console.error(
      'Ошибка создания мем-дуэли:',
      error
    );

    await context.reply(
      '❌ Не удалось создать мем-дуэль.'
    );

    return true;
  }
}

  /*
   * Поддержка команды реплаем:
   * пользователь отвечает !мемдуэль
   * на сообщение соперника.
   */
  if (
    /^!мемдуэль$/i.test(
      originalText
    )
  ) {
    const opponentId =
      getUserIdFromReply(context);

    if (!opponentId) {
      return false;
    }

    return createDuel(
      context,
      vk,
      opponentId
    );
  }

  /*
   * Перехватываем фотографии только
   * у игроков активной дуэли.
   */
  if (
    context.hasAttachments('photo')
  ) {
    const duel =
      getDuelByUser(context);

    if (!duel) {
      return false;
    }

    return handlePhoto(
      context,
      vk,
      duel
    );
  }

  return false;
}

module.exports = {
  handle
};
