const {
  formatMoney,
  JOB_MAX_LEVEL,
  getJobExperienceRequired,
  addAuraAmount,
  getTotalAura,
  getAura,
  getUserByVkId,
  removeAuraAmount,
  setTotalAura,
  resetTotalAura,
  getAuraRank,
  getBalance,
  addBalance,
  removeBalance,
  setBalance,
  resetBalance,
  createPromo,
  getGameDebt,
  getJobProfile,
  getUserCount,
  getAllUserIds
} = require('./database');

/*
 * admin.js
 *
 * Команды:
 * \add @username 100
 * \minus @username 100
 * \set @username 100
 * \reset @username
 * \info @username
 * \add$ @username 100
 * \minus$ @username 100
 * \set$ @username 500
 * \reset$ @username
 * \addpromo SUMMER aura 50
 * \addpromo MONEY $ 1000
 * \users
 * \sms Текст рассылки
 */

const ADMIN_IDS = new Set([
  549243926
]);

const MAX_AURA_AMOUNT = 1000000;
const MAX_BALANCE_AMOUNT = 1000000000;
const MAX_PROMO_AMOUNT = 1000000000;
const ADMIN_AURA_PEER_ID = 0;
const MAX_BROADCAST_LENGTH = 3500;
const BROADCAST_DELAY_MS = 100;

function isAdmin(userId) {
  return ADMIN_IDS.has(
    Number(userId)
  );
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

async function resolveUser(
  vk,
  rawTarget
) {
  const target =
    extractVkTarget(rawTarget);

  if (!target) {
    return null;
  }

  const users =
    await vk.api.users.get({
      user_ids: target,
      fields: [
        'screen_name',
        'domain',
        'sex',
        'city',
        'country',
        'bdate',
        'online'
      ].join(',')
    });

  const user =
    users?.[0];

  if (!user?.id) {
    return null;
  }

  return user;
}

function getUserName(user) {
  return [
    user.first_name,
    user.last_name
  ]
    .filter(Boolean)
    .join(' ');
}

function formatDate(value) {
  if (!value) {
    return 'Неизвестно';
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return String(value);
  }

  return new Intl.DateTimeFormat(
    'ru-RU',
    {
      dateStyle: 'long',
      timeStyle: 'short'
    }
  ).format(date);
}

function getSexName(sex) {
  if (Number(sex) === 1) {
    return 'Женский';
  }

  if (Number(sex) === 2) {
    return 'Мужской';
  }

  return 'Не указан';
}

function getLocation(user) {
  return [
    user.city?.title,
    user.country?.title
  ]
    .filter(Boolean)
    .join(', ') || 'Не указано';
}

function getDomain(user) {
  return (
    user.screen_name ||
    user.domain ||
    `id${user.id}`
  );
}

function parsePositiveAmount(
  rawAmount,
  maxAmount = MAX_AURA_AMOUNT
) {
  const amount =
    Number(rawAmount);

  if (
    !Number.isInteger(amount) ||
    amount <= 0 ||
    amount > maxAmount
  ) {
    return null;
  }

  return amount;
}

function parseNonNegativeAmount(
  rawAmount,
  maxAmount = MAX_AURA_AMOUNT
) {
  const amount =
    Number(rawAmount);

  if (
    !Number.isInteger(amount) ||
    amount < 0 ||
    amount > maxAmount
  ) {
    return null;
  }

  return amount;
}

function normalizePromoName(value) {
  const name = String(value ?? '')
    .trim()
    .replace(/^(["'])(.*)\1$/, '$2')
    .trim();

  if (
    !/^[\p{L}\p{N}_-]{1,32}$/u.test(name)
  ) {
    return null;
  }

  return name.toUpperCase();
}

function normalizePromoRewardType(value) {
  const type = String(value ?? '')
    .trim()
    .toLowerCase();

  if (
    type === 'aura' ||
    type === 'аура'
  ) {
    return 'aura';
  }

  if (type === '$') {
    return 'dollars';
  }

  return null;
}

async function requireAdmin(context) {
  if (isAdmin(context.senderId)) {
    return true;
  }

  await context.reply(
    '❌ У тебя нет доступа к этой команде.'
  );

  return false;
}

function delay(milliseconds) {
  return new Promise(resolve => {
    setTimeout(resolve, milliseconds);
  });
}

async function handleUsers(context) {
  if (!await requireAdmin(context)) {
    return true;
  }

  const userCount = getUserCount();

  await context.reply(
    '👥 Пользователи бота\n\n' +
    `📊 Всего пользователей: ${userCount}`
  );

  return true;
}

async function handleSms(
  context,
  vk,
  rawMessage
) {
  if (!await requireAdmin(context)) {
    return true;
  }

  const message =
    String(rawMessage ?? '').trim();

  if (!message) {
    await context.reply(
      '❌ Укажи текст рассылки.\n\n' +
      'Пример:\n' +
      '\\sms Сегодня вышло обновление!'
    );

    return true;
  }

  if (message.length > MAX_BROADCAST_LENGTH) {
    await context.reply(
      '❌ Текст рассылки слишком длинный. ' +
      `Максимум: ${MAX_BROADCAST_LENGTH} символов.`
    );

    return true;
  }

  const userIds = getAllUserIds();

  if (userIds.length === 0) {
    await context.reply(
      '❌ В базе пока нет пользователей для рассылки.'
    );

    return true;
  }

  await context.reply(
    '📨 Рассылка запущена.\n' +
    `👥 Получателей: ${userIds.length}`
  );

  let delivered = 0;
  let failed = 0;

  for (const userId of userIds) {
    try {
      await vk.api.messages.send({
        peer_id: userId,
        random_id: 0,
        message:
          '📢 Сообщение от администрации\n\n' +
          message
      });

      delivered += 1;
    } catch (error) {
      failed += 1;

      console.error(
        `Не удалось отправить рассылку пользователю ${userId}:`,
        error?.message ?? error
      );
    }

    if (BROADCAST_DELAY_MS > 0) {
      await delay(BROADCAST_DELAY_MS);
    }
  }

  await context.reply(
    '✅ Рассылка завершена.\n\n' +
    `📬 Доставлено: ${delivered}\n` +
    `❌ Не доставлено: ${failed}`
  );

  return true;
}

async function handleAdd(
  context,
  vk,
  rawTarget,
  rawAmount
) {
  if (!await requireAdmin(context)) {
    return true;
  }

  const amount =
    parsePositiveAmount(
      rawAmount
    );

  if (amount === null) {
    await context.reply(
      '❌ Укажи целое количество от 1 до ' +
      `${MAX_AURA_AMOUNT}.\n\n` +
      'Пример:\n' +
      '\\add @username 100'
    );

    return true;
  }

  const user =
    await resolveUser(
      vk,
      rawTarget
    );

  if (!user) {
    await context.reply(
      '❌ Пользователь не найден.'
    );

    return true;
  }

  addAuraAmount(
    ADMIN_AURA_PEER_ID,
    Number(user.id),
    amount
  );

  const totalAura =
    getTotalAura(user.id);

  await context.send(
    '✅ Аура выдана.\n\n' +
    `👤 @id${user.id} (${getUserName(user)})\n` +
    `✨ Начислено: +${amount}\n` +
    `🌟 Общая аура: ${totalAura}`
  );

  return true;
}

async function handleMinus(
  context,
  vk,
  rawTarget,
  rawAmount
) {
  if (!await requireAdmin(context)) {
    return true;
  }

  const amount =
    parsePositiveAmount(
      rawAmount
    );

  if (amount === null) {
    await context.reply(
      '❌ Укажи целое количество от 1 до ' +
      `${MAX_AURA_AMOUNT}.\n\n` +
      'Пример:\n' +
      '\\minus @username 100'
    );

    return true;
  }

  const user =
    await resolveUser(
      vk,
      rawTarget
    );

  if (!user) {
    await context.reply(
      '❌ Пользователь не найден.'
    );

    return true;
  }

  const result =
    removeAuraAmount(
      Number(user.id),
      amount
    );

  await context.send(
    '✅ Аура списана.\n\n' +
    `👤 @id${user.id} (${getUserName(user)})\n` +
    `➖ Запрошено: ${amount}\n` +
    `✨ Списано: ${result.removed}\n` +
    `🌟 Общая аура: ${result.totalAura}`
  );

  return true;
}

async function handleSet(
  context,
  vk,
  rawTarget,
  rawAmount
) {
  if (!await requireAdmin(context)) {
    return true;
  }

  const amount =
    parseNonNegativeAmount(
      rawAmount
    );

  if (amount === null) {
    await context.reply(
      '❌ Укажи целое количество от 0 до ' +
      `${MAX_AURA_AMOUNT}.\n\n` +
      'Пример:\n' +
      '\\set @username 500'
    );

    return true;
  }

  const user =
    await resolveUser(
      vk,
      rawTarget
    );

  if (!user) {
    await context.reply(
      '❌ Пользователь не найден.'
    );

    return true;
  }

  const totalAura =
    setTotalAura(
      Number(user.id),
      amount
    );

  await context.send(
    '✅ Количество ауры установлено.\n\n' +
    `👤 @id${user.id} (${getUserName(user)})\n` +
    `🌟 Общая аура: ${totalAura}`
  );

  return true;
}

async function handleReset(
  context,
  vk,
  rawTarget
) {
  if (!await requireAdmin(context)) {
    return true;
  }

  const user =
    await resolveUser(
      vk,
      rawTarget
    );

  if (!user) {
    await context.reply(
      '❌ Пользователь не найден.'
    );

    return true;
  }

  resetTotalAura(
    Number(user.id)
  );

  await context.send(
    '✅ Аура обнулена.\n\n' +
    `👤 @id${user.id} (${getUserName(user)})\n` +
    '🌟 Общая аура: 0'
  );

  return true;
}

async function handleAddBalance(
  context,
  vk,
  rawTarget,
  rawAmount
) {
  if (!await requireAdmin(context)) {
    return true;
  }

  const amount = parsePositiveAmount(
    rawAmount,
    MAX_BALANCE_AMOUNT
  );

  if (amount === null) {
    await context.reply(
      '❌ Укажи целое количество от 1 до ' +
      `${MAX_BALANCE_AMOUNT}.\n\n` +
      'Пример:\n' +
      '\\add$ @username 1000'
    );

    return true;
  }

  const user = await resolveUser(
    vk,
    rawTarget
  );

  if (!user) {
    await context.reply(
      '❌ Пользователь не найден.'
    );

    return true;
  }

  const balance = addBalance(
    Number(user.id),
    amount
  );

  await context.send(
    '✅ Деньги выданы.\n\n' +
    `👤 @id${user.id} (${getUserName(user)})\n` +
    `💵 Начислено: +${formatMoney(amount)} $\n` +
    `🏦 Баланс: ${formatMoney(balance)} $`
  );

  return true;
}

async function handleMinusBalance(
  context,
  vk,
  rawTarget,
  rawAmount
) {
  if (!await requireAdmin(context)) {
    return true;
  }

  const amount = parsePositiveAmount(
    rawAmount,
    MAX_BALANCE_AMOUNT
  );

  if (amount === null) {
    await context.reply(
      '❌ Укажи целое количество от 1 до ' +
      `${MAX_BALANCE_AMOUNT}.\n\n` +
      'Пример:\n' +
      '\\minus$ @username 1000'
    );

    return true;
  }

  const user = await resolveUser(
    vk,
    rawTarget
  );

  if (!user) {
    await context.reply(
      '❌ Пользователь не найден.'
    );

    return true;
  }

  const result = removeBalance(
    Number(user.id),
    amount
  );

  await context.send(
    '✅ Деньги списаны.\n\n' +
    `👤 @id${user.id} (${getUserName(user)})\n` +
    `➖ Запрошено: ${formatMoney(amount)} $\n` +
    `💵 Списано: ${formatMoney(result.removed)} $\n` +
    `🏦 Баланс: ${formatMoney(result.balance)} $`
  );

  return true;
}

async function handleSetBalance(
  context,
  vk,
  rawTarget,
  rawAmount
) {
  if (!await requireAdmin(context)) {
    return true;
  }

  const amount = parseNonNegativeAmount(
    rawAmount,
    MAX_BALANCE_AMOUNT
  );

  if (amount === null) {
    await context.reply(
      '❌ Укажи целое количество от 0 до ' +
      `${MAX_BALANCE_AMOUNT}.\n\n` +
      'Пример:\n' +
      '\\set$ @username 5000'
    );

    return true;
  }

  const user = await resolveUser(
    vk,
    rawTarget
  );

  if (!user) {
    await context.reply(
      '❌ Пользователь не найден.'
    );

    return true;
  }

  const balance = setBalance(
    Number(user.id),
    amount
  );

  await context.send(
    '✅ Баланс установлен.\n\n' +
    `👤 @id${user.id} (${getUserName(user)})\n` +
    `🏦 Баланс: ${formatMoney(balance)} $`
  );

  return true;
}

async function handleResetBalance(
  context,
  vk,
  rawTarget
) {
  if (!await requireAdmin(context)) {
    return true;
  }

  const user = await resolveUser(
    vk,
    rawTarget
  );

  if (!user) {
    await context.reply(
      '❌ Пользователь не найден.'
    );

    return true;
  }

  resetBalance(Number(user.id));

  await context.send(
    '✅ Баланс обнулён.\n\n' +
    `👤 @id${user.id} (${getUserName(user)})\n` +
    '🏦 Баланс: 0 $'
  );

  return true;
}

async function handleAddPromo(
  context,
  rawName,
  rawRewardType,
  rawAmount
) {
  if (!await requireAdmin(context)) {
    return true;
  }

  const code =
    normalizePromoName(rawName);

  const rewardType =
    normalizePromoRewardType(
      rawRewardType
    );

  const amount = parsePositiveAmount(
    rawAmount,
    MAX_PROMO_AMOUNT
  );

  if (!code || !rewardType || amount === null) {
    await context.reply(
      '❌ Неверный формат промокода.\n\n' +
      'Примеры:\n' +
      '\\addpromo SUMMER aura 50\n' +
      '\\addpromo MONEY $ 1000\n\n' +
      'Название: до 32 букв или цифр; ' +
      'также можно использовать _ и -.'
    );

    return true;
  }

  const result = createPromo({
    code,
    rewardType,
    amount,
    createdBy: Number(context.senderId)
  });

  if (result.status === 'exists') {
    await context.reply(
      `❌ Промокод ${result.code} уже существует.`
    );

    return true;
  }

  const rewardText =
    rewardType === 'aura'
      ? `${amount} ауры`
      : `${formatMoney(amount)} $`;

  await context.send(
    '✅ Промокод создан.\n\n' +
    `🎟 Код: ${result.code}\n` +
    `🎁 Награда: ${rewardText}\n\n` +
    `Активация: !promo ${result.code}`
  );

  return true;
}

async function handleInfo(
  context,
  vk,
  rawTarget
) {
  if (!await requireAdmin(context)) {
    return true;
  }

  const user =
    await resolveUser(
      vk,
      rawTarget
    );

  if (!user) {
    await context.reply(
      '❌ Пользователь не найден.'
    );

    return true;
  }

  const userId =
    Number(user.id);

  const databaseUser =
    getUserByVkId(userId);

  const totalAura =
    getTotalAura(userId);

  const balance =
    getBalance(userId);

  const gameDebt =
    getGameDebt(userId);

  const jobProfile =
    getJobProfile(userId);

  const jobExperienceRequired =
    getJobExperienceRequired(jobProfile.level);

  const jobExperienceText =
    jobExperienceRequired === null
      ? `📊 EXP в статистике: ${jobProfile.experience}`
      : `📈 EXP: ${jobProfile.experience}/${jobExperienceRequired}`;

  const auraInCurrentPeer =
    getAura(
      Number(context.peerId),
      userId
    );

  const rank =
    getAuraRank(userId);

  const status =
    isAdmin(userId)
      ? 'Администратор'
      : 'Пользователь';

  await context.send(
    '📋 Информация о пользователе\n\n' +
    `👤 Имя: ${getUserName(user)}\n` +
    `🆔 VK ID: ${userId}\n` +
    `🔗 Адрес: vk.ru/${getDomain(user)}\n` +
    `🚻 Пол: ${getSexName(user.sex)}\n` +
    `🌍 Город: ${getLocation(user)}\n` +
    `🎂 Дата рождения: ${user.bdate || 'Не указана'}\n` +
    `🟢 Сейчас онлайн: ${user.online ? 'Да' : 'Нет'}\n\n` +
    `✨ Общая аура: ${totalAura}\n` +
    `💵 Баланс: ${formatMoney(balance)} $\n` +
    `🥔 Долг в играх: ${formatMoney(gameDebt)} $\n` +
    `⭐ Уровень: ${jobProfile.level}` +
    `${jobProfile.level >= JOB_MAX_LEVEL ? ' (максимальный)' : ''}\n` +
    `${jobExperienceText}\n` +
    `💬 Аура в текущем диалоге: ${auraInCurrentPeer}\n` +
    `🏆 Место в топе: ${rank ? `#${rank}` : 'Нет в топе'}\n` +
    `🛡 Статус: ${status}\n\n` +
    `📅 Первое появление в боте: ${
      formatDate(databaseUser?.created_at)
    }\n` +
    `🕓 Последнее появление: ${
      formatDate(databaseUser?.last_seen_at)
    }`
  );

  return true;
}

async function handle(
  context,
  vk
) {
  const originalText =
    String(context.text ?? '')
      .trim();

  try {
    if (/^\\users$/i.test(originalText)) {
      return handleUsers(context);
    }

    let match =
      originalText.match(
        /^\\sms(?:\s+([\s\S]+))?$/i
      );

    if (match) {
      return handleSms(
        context,
        vk,
        match[1]
      );
    }

    match =
      originalText.match(
        /^\\addpromo\s+("[^"]+"|'[^']+'|\S+)\s+(aura|аура|\$)\s+(\d+)$/i
      );

    if (match) {
      return handleAddPromo(
        context,
        match[1],
        match[2],
        match[3]
      );
    }

    match =
      originalText.match(
        /^\\add\$\s+(\S+)\s+(\d+)$/i
      );

    if (match) {
      return handleAddBalance(
        context,
        vk,
        match[1],
        match[2]
      );
    }

    match =
      originalText.match(
        /^\\minus\$\s+(\S+)\s+(\d+)$/i
      );

    if (match) {
      return handleMinusBalance(
        context,
        vk,
        match[1],
        match[2]
      );
    }

    match =
      originalText.match(
        /^\\set\$\s+(\S+)\s+(\d+)$/i
      );

    if (match) {
      return handleSetBalance(
        context,
        vk,
        match[1],
        match[2]
      );
    }

    match =
      originalText.match(
        /^\\reset\$\s+(\S+)$/i
      );

    if (match) {
      return handleResetBalance(
        context,
        vk,
        match[1]
      );
    }

    match =
      originalText.match(
        /^\\add\s+(\S+)\s+(\d+)$/i
      );

    if (match) {
      return handleAdd(
        context,
        vk,
        match[1],
        match[2]
      );
    }

    match =
      originalText.match(
        /^\\minus\s+(\S+)\s+(\d+)$/i
      );

    if (match) {
      return handleMinus(
        context,
        vk,
        match[1],
        match[2]
      );
    }

    match =
      originalText.match(
        /^\\set\s+(\S+)\s+(\d+)$/i
      );

    if (match) {
      return handleSet(
        context,
        vk,
        match[1],
        match[2]
      );
    }

    match =
      originalText.match(
        /^\\reset\s+(\S+)$/i
      );

    if (match) {
      return handleReset(
        context,
        vk,
        match[1]
      );
    }

    match =
      originalText.match(
        /^\\info\s+(\S+)$/i
      );

    if (match) {
      return handleInfo(
        context,
        vk,
        match[1]
      );
    }

    if (
      /^\\(?:users|sms|addpromo|add\$|minus\$|set\$|reset\$|add|minus|set|reset|info)(?:\s|$)/i
        .test(originalText)
    ) {
      if (!await requireAdmin(context)) {
        return true;
      }

      await context.reply(
        '❌ Неверный формат.\n\n' +
        '\\add @username 100\n' +
        '\\minus @username 100\n' +
        '\\set @username 500\n' +
        '\\reset @username\n' +
        '\\info @username\n\n' +
        '\\add$ @username 1000\n' +
        '\\minus$ @username 1000\n' +
        '\\set$ @username 5000\n' +
        '\\reset$ @username\n\n' +
        '\\addpromo SUMMER aura 50\n' +
        '\\addpromo MONEY $ 1000\n\n' +
        '\\users\n' +
        '\\sms Текст рассылки'
      );

      return true;
    }

    return false;
  } catch (error) {
    console.error(
      'Ошибка админской команды:',
      error
    );

    await context.reply(
      '❌ Не удалось выполнить админскую команду.'
    );

    return true;
  }
}

module.exports = {
  handle
};
