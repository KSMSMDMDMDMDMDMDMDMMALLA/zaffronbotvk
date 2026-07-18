const RP_ACTIONS = Object.freeze({
  'обнять': {
    emoji: '🤗',
    action: 'обнимает'
  },
  'поцеловать': {
    emoji: '💋',
    action: 'целует'
  },
  'погладить': {
    emoji: '🫶',
    action: 'гладит'
  },
  'дать пять': {
    emoji: '🙌',
    action: 'даёт пять'
  },
  'подмигнуть': {
    emoji: '😉',
    action: 'подмигивает'
  }
});

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
  const numericId = Number(senderId);

  return (
    Number.isInteger(numericId) &&
    numericId > 0
  )
    ? numericId
    : null;
}

function getMention(userId, usersById) {
  const user = usersById.get(userId);
  const name = user
    ? [user.first_name, user.last_name]
      .filter(Boolean)
      .join(' ')
    : `id${userId}`;

  return `@id${userId} (${name})`;
}

async function getUsersById(vk, userIds) {
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
      'Не удалось получить имена для RP-команды:',
      error
    );

    return new Map();
  }
}

async function handle(context, vk) {
  const originalText =
    String(context.text ?? '').trim();
  const match = originalText.match(
    /^!(обнять|поцеловать|погладить|дать\s+пять|подмигнуть)$/i
  );

  if (!match) {
    return false;
  }

  const command = match[1]
    .toLowerCase()
    .replace(/\s+/g, ' ');
  const action = RP_ACTIONS[command];
  const senderId = Number(context.senderId);
  const targetId = getReplySenderId(context);

  if (!targetId) {
    await context.send(
      `❌ Ответь командой !${command} ` +
      'на сообщение другого пользователя.'
    );

    return true;
  }

  if (targetId === senderId) {
    await context.send(
      '🙂 Эту RP-команду нельзя использовать на себе.'
    );

    return true;
  }

  const usersById = await getUsersById(
    vk,
    [senderId, targetId]
  );

  await context.send({
    message:
      `${action.emoji} ` +
      `${getMention(senderId, usersById)} ` +
      `${action.action} ` +
      `${getMention(targetId, usersById)}!`,
    disable_mentions: false
  });

  return true;
}

module.exports = {
  handle
};
