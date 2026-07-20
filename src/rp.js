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
  },
  'пожать руку': {
    emoji: '🤝',
    action: 'пожимает руку'
  },
  'похвалить': {
    emoji: '🌟',
    action: 'хвалит'
  },
  'поддержать': {
    emoji: '💙',
    action: 'поддерживает'
  },
  'рассмешить': {
    emoji: '😂',
    action: 'смешит'
  },
  'угостить': {
    emoji: '🍕',
    action: 'угощает пиццей'
  },
  'подарить цветы': {
    emoji: '💐',
    action: 'дарит цветы'
  },
  'потанцевать': {
    emoji: '💃',
    action: 'танцует вместе с'
  },
  'напугать': {
    emoji: '👻',
    action: 'пугает'
  },
  'сфотографироваться': {
    emoji: '📸',
    action: 'фотографируется вместе с'
  },
  'пожелать удачи': {
    emoji: '🍀',
    action: 'желает удачи'
  }
});

function normalizeCommand(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
}

function escapeRegularExpression(value) {
  return String(value)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
}

const commandPattern = Object.keys(RP_ACTIONS)
  .sort((left, right) =>
    right.length - left.length
  )
  .map(escapeRegularExpression)
  .join('|');

const rpCommandExpression = new RegExp(
  `^!(${commandPattern})(?:\\s+(.+))?$`,
  'iu'
);

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

function extractVkTarget(value) {
  const rawValue = String(value ?? '').trim();
  const mentionMatch = rawValue.match(
    /^\[id(\d+)\|[^\]]+\]$/i
  );

  if (mentionMatch) {
    return `id${mentionMatch[1]}`;
  }

  return rawValue
    .replace(
      /^https?:\/\/(?:www\.)?vk\.(?:ru|com)\//i,
      ''
    )
    .replace(/^vk\.(?:ru|com)\//i, '')
    .replace(/^@/, '')
    .split(/[/?#\s]/)[0]
    .trim();
}

async function resolveTargetId(
  context,
  vk,
  rawTarget
) {
  const target = extractVkTarget(rawTarget);

  if (!target) {
    return getReplySenderId(context);
  }

  try {
    const users = await vk.api.users.get({
      user_ids: target
    });
    const targetId = Number(users?.[0]?.id);

    return (
      Number.isInteger(targetId) &&
      targetId > 0
    )
      ? targetId
      : null;
  } catch (error) {
    console.error(
      'Не удалось найти цель RP-команды:',
      error?.message ?? error
    );

    return null;
  }
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
      error?.message ?? error
    );

    return new Map();
  }
}

async function handle(context, vk) {
  const originalText = String(
    context.text ?? ''
  ).trim();
  const match = originalText.match(
    rpCommandExpression
  );

  if (!match) {
    return false;
  }

  const command = normalizeCommand(match[1]);
  const action = RP_ACTIONS[command];
  const senderId = Number(context.senderId);
  const targetId = await resolveTargetId(
    context,
    vk,
    match[2]
  );

  if (!targetId) {
    await context.send(
      `❌ Ответь командой !${command} на сообщение игрока ` +
      'или укажи его username.\n\n' +
      `Пример: !${command} @username`
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
