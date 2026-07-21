const {
  formatMoney,
  TRANSFER_DAILY_LIMIT,
  transferBalance
} = require('./database');

function formatResetTime(value) {
  return new Intl.DateTimeFormat(
    'ru-RU',
    {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Moscow'
    }
  ).format(new Date(value));
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
    .replace(/[$₽]$/, '')
    .trim();

  if (!/^\d[\d\s.,_]*$/.test(normalized)) {
    return null;
  }

  const digits = normalized.replace(
    /[\s.,_]/g,
    ''
  );

  const amount = Number(digits);

  if (
    !Number.isSafeInteger(amount) ||
    amount <= 0
  ) {
    return null;
  }

  return amount;
}

function parseTransferArguments(
  rawArguments,
  hasReply
) {
  const argumentsText =
    String(rawArguments ?? '').trim();

  if (!argumentsText) {
    return null;
  }

  if (hasReply) {
    return {
      amount: parseAmount(argumentsText),
      rawTarget: null
    };
  }

  const targetMatch = argumentsText.match(
    /^(.+?)\s+(\[id\d+\|.+\]|@\S+|(?:https?:\/\/)?(?:www\.)?vk\.(?:ru|com)\/\S+|id\d+|\S+)$/i
  );

  if (!targetMatch) {
    return null;
  }

  return {
    amount: parseAmount(targetMatch[1]),
    rawTarget: targetMatch[2]
  };
}

async function resolveRecipient(
  context,
  vk,
  rawTarget
) {
  const replyId =
    getReplySenderId(context);

  let userId = replyId;

  if (!userId) {
    const target =
      extractVkTarget(rawTarget);

    if (
      !target ||
      target === '$' ||
      target === '₽'
    ) {
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
      name: [
        user.first_name,
        user.last_name
      ]
        .filter(Boolean)
        .join(' ') || `id${user.id}`
    };
  }

  if (
    !Number.isInteger(userId) ||
    userId <= 0
  ) {
    return null;
  }

  let name = `id${userId}`;

  try {
    const users = await vk.api.users.get({
      user_ids: userId
    });
    const user = users?.[0];

    if (user) {
      name = [
        user.first_name,
        user.last_name
      ]
        .filter(Boolean)
        .join(' ') || name;
    }
  } catch (error) {
    console.error(
      'Не удалось получить имя получателя перевода:',
      error
    );
  }

  return {
    id: userId,
    name
  };
}

async function sendUsage(context) {
  await context.send(
    '❌ Укажи сумму и получателя.\n\n' +
    'По username:\n' +
    '!передать 10.000 ₽ @username\n\n' +
    'Или ответь на сообщение командой:\n' +
    '!передать 10.000 ₽\n\n' +
    `📤 Суточный лимит: ${formatMoney(TRANSFER_DAILY_LIMIT)} ₽`
    + '\n🧾 Комиссия: 5% (с VIP-картой — 0%)'
  );

  return true;
}

async function handle(context, vk) {
  const originalText =
    String(context.text ?? '').trim();

  if (!/^!передать(?:\s|$)/i.test(originalText)) {
    return false;
  }

  const commandMatch = originalText.match(
    /^!передать(?:\s+(.+))?$/i
  );

  if (!commandMatch?.[1]) {
    return sendUsage(context);
  }

  const replyId =
    getReplySenderId(context);
  const parsed = parseTransferArguments(
    commandMatch[1],
    Boolean(replyId)
  );

  if (!parsed?.amount) {
    return sendUsage(context);
  }

  let recipient;

  try {
    recipient = await resolveRecipient(
      context,
      vk,
      parsed.rawTarget
    );
  } catch (error) {
    console.error(
      'Ошибка поиска получателя перевода:',
      error
    );

    await context.send(
      '❌ Не удалось найти указанного пользователя.'
    );

    return true;
  }

  if (!recipient) {
    await context.send(
      '❌ Получатель не найден. Проверь username или ответь на его сообщение.'
    );

    return true;
  }

  const senderId = Number(context.senderId);

  if (recipient.id === senderId) {
    await context.send(
      '🤨 Переводить деньги самому себе нельзя.'
    );

    return true;
  }

  const result = transferBalance({
    senderId,
    recipientId: recipient.id,
    amount: parsed.amount,
    enforceDailyLimit: true
  });

  if (result.status === 'insufficient_funds') {
    await context.send(
      '❌ Недостаточно денег для перевода.\n\n' +
      `💵 Сумма: ${formatMoney(result.amount)} ₽\n` +
      `🏦 Баланс: ${formatMoney(result.balance)} ₽\n` +
      `📉 Не хватает: ${formatMoney(result.missing)} ₽`
    );

    return true;
  }

  if (result.status === 'daily_limit') {
    await context.send(
      '⏳ Суточный лимит переводов превышен.\n\n' +
      `🔒 Лимит: ${formatMoney(result.limit)} ₽\n` +
      `📤 Уже отправлено: ${formatMoney(result.used)} ₽\n` +
      `✅ Доступно сегодня: ${formatMoney(result.remaining)} ₽\n` +
      `🕛 Сброс: ${formatResetTime(result.resetAt)} МСК`
    );

    return true;
  }

  if (result.status === 'recipient_limit') {
    await context.send(
      '❌ Баланс получателя достиг технического лимита.'
    );

    return true;
  }

  await context.send(
    '💸 Перевод выполнен!\n\n' +
    `👤 Получатель: @id${recipient.id} (${recipient.name})\n` +
    `💵 Сумма перевода: ${formatMoney(result.amount)} ₽\n` +
    `🧾 Комиссия: ${formatMoney(result.commission)} ₽` +
    (result.vipActive ? ' (VIP: 0%)' : '') + '\n' +
    `📥 Получатель получит: ${formatMoney(result.payout)} ₽\n` +
    `🏦 Твой баланс: ${formatMoney(result.senderBalance)} ₽\n` +
    `📤 Остаток лимита сегодня: ${formatMoney(result.dailyRemaining)} ₽\n` +
    `🕛 Сброс: ${formatResetTime(result.dailyResetAt)} МСК`
  );

  return true;
}

module.exports = {
  handle
};
