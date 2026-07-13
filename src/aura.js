const {
  getAuraCooldown,
  giveAura,
  getAuraTop
} = require('./database');

const AURA_COOLDOWN =
  10 * 60 * 1000;

function formatRemainingTime(milliseconds) {
  const totalSeconds = Math.ceil(
    milliseconds / 1000
  );

  const minutes = Math.floor(
    totalSeconds / 60
  );

  const seconds =
    totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds} сек.`;
  }

  return (
    `${minutes} мин. ` +
    `${seconds} сек.`
  );
}

function getReplySenderId(context) {
  const reply = context.replyMessage;

  if (!reply) {
    return null;
  }

  const senderId =
    reply.senderId ??
    reply.sender_id ??
    reply.fromId ??
    reply.from_id;

  const numericId =
    Number(senderId);

  if (!Number.isInteger(numericId)) {
    return null;
  }

  return numericId;
}

async function getUsersMap(vk, userIds) {
  if (userIds.length === 0) {
    return new Map();
  }

  try {
    const users = await vk.api.users.get({
      user_ids: userIds.join(',')
    });

    return new Map(
      users.map(user => [
        Number(user.id),
        user
      ])
    );
  } catch (error) {
    console.error(
      'Не удалось получить пользователей:',
      error
    );

    return new Map();
  }
}

async function handleGiveAura(
  context,
  vk
) {
  const targetId =
    getReplySenderId(context);

  if (!targetId) {
    await context.send(
      '❌ Ответь командой +аура ' +
      'на сообщение человека.'
    );

    return true;
  }

  const senderId =
    Number(context.senderId);

  if (targetId === senderId) {
    await context.send(
      '🤨 Самому себе ауру добавлять нельзя.'
    );

    return true;
  }

  if (targetId <= 0) {
    await context.send(
      '❌ Сообществу ауру добавить нельзя.'
    );

    return true;
  }

  const peerId =
    Number(context.peerId);

  const currentTime =
    Date.now();

  const lastGivenAt =
    getAuraCooldown(
      peerId,
      senderId
    );

  const passed =
    currentTime - lastGivenAt;

  const remaining =
    AURA_COOLDOWN - passed;

  if (
    lastGivenAt > 0 &&
    remaining > 0
  ) {
    await context.send(
      '⌛ Ты уже выдавал ауру.\n\n' +
      'Следующую можно выдать через ' +
      formatRemainingTime(remaining)
    );

    return true;
  }

  const newAura = giveAura({
    peerId,
    senderId,
    targetId,
    currentTime
  });

  let name = `id${targetId}`;

  try {
    const users =
      await vk.api.users.get({
        user_ids: targetId
      });

    const user = users?.[0];

    if (user) {
      name = [
        user.first_name,
        user.last_name
      ]
        .filter(Boolean)
        .join(' ');
    }
  } catch (error) {
    console.error(
      'Ошибка получения имени:',
      error
    );
  }

  await context.send(
    `✨ @id${targetId} (${name}) получает +1 ауру!\n\n` +
    `🌟 Теперь у него: ${newAura}`
  );

  return true;
}

async function handleAuraTop(
  context,
  vk
) {
    const top =
      getAuraTop(10);

  if (top.length === 0) {
    await context.send(
      '✨ В этой беседе ещё никто ' +
      'не получил ауру.'
    );

    return true;
  }

  const userIds = top.map(
    item => item.vk_id
  );

  const usersById =
    await getUsersMap(
      vk,
      userIds
    );

  const medals = [
    '🥇',
    '🥈',
    '🥉'
  ];

  const lines = top.map(
    (item, index) => {
      const user =
        usersById.get(item.vk_id);

      const name = user
        ? `${user.first_name} ${user.last_name}`
        : `id${item.vk_id}`;

      const position =
        medals[index] ??
        `${index + 1}.`;

      return (
        `${position} ` +
        `@id${item.vk_id} (${name}) — ` +
        `${item.aura} ✨`
      );
    }
  );

  await context.send(
    '🏆 Общий топ ауры\n\n' +
  lines.join('\n')
);

  return true;
}

async function handle(context, vk) {
  const originalText =
    String(context.text ?? '')
      .trim();

  if (/^\+аура$/i.test(originalText)) {
    return handleGiveAura(
      context,
      vk
    );
  }

  if (/^!топ\s+ауры$/i.test(originalText)) {
    return handleAuraTop(
      context,
      vk
    );
  }

  return false;
}

module.exports = {
  handle
};