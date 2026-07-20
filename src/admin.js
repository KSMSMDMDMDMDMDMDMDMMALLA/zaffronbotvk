const { Keyboard } = require('vk-io');

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
  getBalanceTop,
  addBalance,
  removeBalance,
  setBalance,
  resetBalance,
  createPromo,
  getAdminStatistics,
  getPromoOverview,
  getGameDebt,
  getJobProfile,
  getMagazineAssets,
  getPhoneSim,
  getPhoneCall,
  getAuraTop
} = require('./database');

const {
  getItem
} = require('./magazine/catalog');

/*
 * admin.js
 *
 * Команды:
 * \add @username 100
 * \minus @username 100
 * \set @username 100
 * \reset @username
 * \info @username
 * \add₽ @username 100
 * \minus₽ @username 100
 * \set₽ @username 500
 * \reset₽ @username
 * \addpromo SUMMER aura 50
 * \addpromo MONEY ₽ 1000
 * \users
 * \sms Текст рассылки
 * !админ
 * \stats
 * \topmoney
 * \topaura
 * \phone @username
 * \assets @username
 * \promos
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
const CONVERSATIONS_PAGE_SIZE = 200;

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

  if (type === '$' || type === '₽') {
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

function createAdminHomeKeyboard() {
  return Keyboard.builder()
    .textButton({
      label: '👥 Игроки',
      payload: {
        command: 'admin_section',
        section: 'players'
      },
      color: Keyboard.PRIMARY_COLOR
    })
    .textButton({
      label: '💰 Экономика',
      payload: {
        command: 'admin_section',
        section: 'economy'
      },
      color: Keyboard.POSITIVE_COLOR
    })
    .row()
    .textButton({
      label: '📢 Управление',
      payload: {
        command: 'admin_section',
        section: 'management'
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .textButton({
      label: '⚙ Система',
      payload: {
        command: 'admin_section',
        section: 'system'
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

function createAdminSectionKeyboard(section) {
  const keyboard = Keyboard.builder();

  if (section === 'economy') {
    keyboard
      .textButton({
        label: '💵 Топ баланса',
        payload: {
          command: 'admin_top_money'
        },
        color: Keyboard.POSITIVE_COLOR
      })
      .textButton({
        label: '✨ Топ ауры',
        payload: {
          command: 'admin_top_aura'
        },
        color: Keyboard.PRIMARY_COLOR
      })
      .row();
  }

  if (section === 'management') {
    keyboard
      .textButton({
        label: '🎟 Промокоды',
        payload: {
          command: 'admin_promos'
        },
        color: Keyboard.PRIMARY_COLOR
      })
      .row();
  }

  if (section === 'system') {
    keyboard
      .textButton({
        label: '📊 Статистика',
        payload: {
          command: 'admin_stats'
        },
        color: Keyboard.POSITIVE_COLOR
      })
      .textButton({
        label: '💬 Диалоги',
        payload: {
          command: 'admin_dialogues'
        },
        color: Keyboard.PRIMARY_COLOR
      })
      .row();
  }

  return keyboard
    .textButton({
      label: '⬅ Админ-панель',
      payload: {
        command: 'admin_home'
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

const ADMIN_SECTION_TEXTS = Object.freeze({
  players:
    '👥 Админ-панель · Игроки\n\n' +
    '\\info @username — полная карточка игрока\n' +
    '\\phone @username — телефон, SIM и звонок\n' +
    '\\assets @username — имущество игрока',
  economy:
    '💰 Админ-панель · Экономика\n\n' +
    'Деньги:\n' +
    '\\add₽ @username [сумма]\n' +
    '\\minus₽ @username [сумма]\n' +
    '\\set₽ @username [сумма]\n' +
    '\\reset₽ @username\n\n' +
    'Аура:\n' +
    '\\add @username [количество]\n' +
    '\\minus @username [количество]\n' +
    '\\set @username [количество]\n' +
    '\\reset @username\n\n' +
    '\\topmoney — топ баланса\n' +
    '\\topaura — топ ауры',
  management:
    '📢 Админ-панель · Управление\n\n' +
    '\\addpromo [код] aura [награда]\n' +
    '\\addpromo [код] ₽ [награда]\n' +
    '\\promos — список промокодов\n' +
    '\\sms [текст] — рассылка по диалогам\n\n' +
    '⚠ Рассылка запускается сразу после команды.',
  system:
    '⚙ Админ-панель · Система\n\n' +
    '\\stats — расширенная статистика\n' +
    '\\users — пользователи и беседы\n\n' +
    'Кнопки выше открывают быстрые отчёты.'
});

async function sendAdminHome(context) {
  if (!await requireAdmin(context)) {
    return true;
  }

  await context.send({
    message:
      '🛡 Админ-панель Zaffron\n\n' +
      'Выбери нужный раздел кнопкой ниже.\n' +
      'Все прежние админ-команды продолжают работать.',
    keyboard: createAdminHomeKeyboard()
  });

  return true;
}

async function sendAdminSection(
  context,
  section
) {
  if (!await requireAdmin(context)) {
    return true;
  }

  const safeSection =
    Object.hasOwn(ADMIN_SECTION_TEXTS, section)
      ? section
      : null;

  if (!safeSection) {
    return sendAdminHome(context);
  }

  await context.send({
    message: ADMIN_SECTION_TEXTS[safeSection],
    keyboard:
      createAdminSectionKeyboard(safeSection)
  });

  return true;
}

function getKnownUserName(vkId) {
  const user = getUserByVkId(vkId);
  const name = [
    user?.first_name,
    user?.last_name
  ]
    .filter(Boolean)
    .join(' ');

  return name || `id${vkId}`;
}

function formatAdminUptime(secondsValue) {
  let seconds = Math.max(
    0,
    Math.floor(Number(secondsValue) || 0)
  );
  const days = Math.floor(seconds / 86_400);
  seconds %= 86_400;
  const hours = Math.floor(seconds / 3_600);
  seconds %= 3_600;
  const minutes = Math.floor(seconds / 60);

  return [
    days > 0 ? `${days} д.` : null,
    hours > 0 ? `${hours} ч.` : null,
    minutes > 0 ? `${minutes} мин.` : null,
    days === 0 && hours === 0 && minutes === 0
      ? '< 1 мин.'
      : null
  ]
    .filter(Boolean)
    .slice(0, 2)
    .join(' ');
}

async function handleAdminStats(context) {
  if (!await requireAdmin(context)) {
    return true;
  }

  const stats = getAdminStatistics();
  const averageBalance = stats.users > 0
    ? Math.floor(stats.totalBalance / stats.users)
    : 0;
  const memoryMb = Math.round(
    process.memoryUsage().rss /
    1024 /
    1024
  );

  await context.send({
    message:
      '📊 Расширенная статистика Zaffron\n\n' +
      `👥 Игроков в базе: ${stats.users}\n` +
      `💵 Денег на руках: ${formatMoney(stats.totalBalance)} ₽\n` +
      `🏦 Денег в банке: ${formatMoney(stats.totalBankBalance)} ₽\n` +
      `📈 Средний баланс: ${formatMoney(averageBalance)} ₽\n` +
      `✨ Всего ауры: ${formatMoney(stats.totalAura)}\n\n` +
      `📦 Объектов имущества: ${stats.assets}\n` +
      `🏢 Куплено бизнесов: ${stats.businesses}\n` +
      `📱 Активных SIM-карт: ${stats.phoneSims}\n` +
      `🚜 Владельцев ферм: ${stats.farmOwners}\n` +
      `🌱 Засеяно участков: ${stats.plantedFarmPlots}\n` +
      `💼 Активных смен: ${stats.activeJobs}\n\n` +
      `☎ Входящих вызовов: ${stats.ringingCalls}\n` +
      `🟢 Активных звонков: ${stats.activeCalls}\n` +
      `🎁 Открыто платных кейсов: ${stats.lootCasesOpened}\n` +
      `📦 Лута на складах: ${stats.lootCaseItems}\n` +
      `💰 Стоимость лута: ${formatMoney(stats.lootCaseWarehouseValue)} ₽\n` +
      `🎟 Промокодов: ${stats.promos}\n` +
      `✅ Активаций промокодов: ${stats.promoRedemptions}\n\n` +
      `⏱ Бот работает: ${formatAdminUptime(process.uptime())}\n` +
      `🧠 Память процесса: ${memoryMb} МБ\n` +
      `🟩 Node.js: ${process.version}`,
    keyboard: createAdminSectionKeyboard('system')
  });

  return true;
}

async function handleAdminTopMoney(context) {
  if (!await requireAdmin(context)) {
    return true;
  }

  const rows = getBalanceTop(10);
  const lines = rows.map((row, index) =>
    `${index + 1}. @id${row.vkId} (${getKnownUserName(row.vkId)}) — ` +
    `${formatMoney(row.balance)} ₽`
  );

  await context.send({
    message:
      '💵 Админский топ баланса\n\n' +
      (lines.join('\n') || 'Игроков с положительным балансом пока нет.'),
    keyboard: createAdminSectionKeyboard('economy')
  });

  return true;
}

async function handleAdminTopAura(context) {
  if (!await requireAdmin(context)) {
    return true;
  }

  const rows = getAuraTop(10);
  const lines = rows.map((row, index) =>
    `${index + 1}. @id${row.vk_id} (${getKnownUserName(row.vk_id)}) — ` +
    `${formatMoney(row.aura)} ауры`
  );

  await context.send({
    message:
      '✨ Админский топ ауры\n\n' +
      (lines.join('\n') || 'Игроков с аурой пока нет.'),
    keyboard: createAdminSectionKeyboard('economy')
  });

  return true;
}

async function handleAdminPhone(
  context,
  vk,
  rawTarget
) {
  if (!await requireAdmin(context)) {
    return true;
  }

  const user = await resolveUser(vk, rawTarget);

  if (!user) {
    await context.reply(
      '❌ Пользователь не найден.'
    );

    return true;
  }

  const userId = Number(user.id);
  const phones = getMagazineAssets(userId)
    .filter(asset =>
      asset.itemType === 'phones'
    )
    .map(asset => getItem(asset.itemKey))
    .filter(Boolean)
    .sort((left, right) =>
      right.price - left.price
    );
  const sim = getPhoneSim(userId);
  const call = getPhoneCall(userId);
  const formattedNumber = sim
    ? `${sim.phoneNumber.slice(0, 3)}-${sim.phoneNumber.slice(3)}`
    : 'Отсутствует';
  const callText = !call
    ? 'Нет звонка'
    : call.status === 'active'
      ? `Разговор с id${call.otherVkId}`
      : call.isCaller
        ? `Исходящий вызов id${call.otherVkId}`
        : `Входящий вызов от id${call.otherVkId}`;

  await context.send({
    message:
      '📱 Телефон игрока\n\n' +
      `👤 @id${userId} (${getUserName(user)})\n` +
      `📲 Основной телефон: ${phones[0]?.title ?? 'Отсутствует'}\n` +
      `🛍 Телефонов: ${phones.length}\n` +
      `📞 Номер: ${formattedNumber}\n` +
      `✨ Тип номера: ${sim?.rarity ?? '—'}\n` +
      `☎ Состояние: ${callText}`,
    keyboard: createAdminSectionKeyboard('players')
  });

  return true;
}

async function handleAdminAssets(
  context,
  vk,
  rawTarget
) {
  if (!await requireAdmin(context)) {
    return true;
  }

  const user = await resolveUser(vk, rawTarget);

  if (!user) {
    await context.reply(
      '❌ Пользователь не найден.'
    );

    return true;
  }

  const userId = Number(user.id);
  const assets = getMagazineAssets(userId)
    .map(asset => getItem(asset.itemKey))
    .filter(Boolean);
  const visibleAssets = assets.slice(0, 40);
  const lines = visibleAssets.map((item, index) =>
    `${index + 1}. ${item.categoryTitle}: ${item.title}`
  );

  if (assets.length > visibleAssets.length) {
    lines.push(
      `…и ещё ${assets.length - visibleAssets.length}`
    );
  }

  await context.send({
    message:
      '📦 Имущество игрока\n\n' +
      `👤 @id${userId} (${getUserName(user)})\n` +
      `📊 Всего объектов: ${assets.length}\n\n` +
      (lines.join('\n') || 'Имущество отсутствует.'),
    keyboard: createAdminSectionKeyboard('players')
  });

  return true;
}

async function handleAdminPromos(context) {
  if (!await requireAdmin(context)) {
    return true;
  }

  const promos = getPromoOverview(20);
  const lines = promos.map((promo, index) => {
    const reward = promo.rewardType === 'aura'
      ? `${formatMoney(promo.amount)} ауры`
      : `${formatMoney(promo.amount)} ₽`;

    return (
      `${index + 1}. ${promo.code} — ${reward}\n` +
      `   ✅ Активаций: ${promo.redemptions}`
    );
  });

  await context.send({
    message:
      '🎟 Промокоды Zaffron\n\n' +
      (lines.join('\n\n') || 'Промокоды ещё не создавались.') +
      (promos.length >= 20
        ? '\n\nПоказаны последние 20 промокодов.'
        : ''),
    keyboard: createAdminSectionKeyboard('management')
  });

  return true;
}

function delay(milliseconds) {
  return new Promise(resolve => {
    setTimeout(resolve, milliseconds);
  });
}

function isAllowedToWrite(conversation) {
  const allowed =
    conversation?.can_write?.allowed;

  return allowed !== false && allowed !== 0;
}

function getConversationTarget(item) {
  const conversation = item?.conversation;
  const peer = conversation?.peer;
  const peerId = Number(peer?.id);
  const peerType = String(peer?.type ?? '');

  if (!Number.isInteger(peerId)) {
    return null;
  }

  if (peerType === 'user' && peerId > 0) {
    return {
      peerId,
      type: 'user',
      canWrite: isAllowedToWrite(conversation)
    };
  }

  if (
    peerType === 'chat' &&
    peerId >= 2000000000
  ) {
    const state =
      conversation?.chat_settings?.state;

    if (
      state &&
      state !== 'in'
    ) {
      return null;
    }

    if (!state && !isAllowedToWrite(conversation)) {
      return null;
    }

    return {
      peerId,
      type: 'chat',
      canWrite: isAllowedToWrite(conversation)
    };
  }

  return null;
}

async function getConversationAudience(vk) {
  const targetsByPeerId = new Map();
  let offset = 0;
  let totalCount = null;

  while (
    totalCount === null ||
    offset < totalCount
  ) {
    const response =
      await vk.api.messages.getConversations({
        offset,
        count: CONVERSATIONS_PAGE_SIZE,
        filter: 'all',
        extended: 0
      });

    const items = Array.isArray(response?.items)
      ? response.items
      : [];

    totalCount = Math.max(
      0,
      Number(response?.count) || 0
    );

    for (const item of items) {
      const target =
        getConversationTarget(item);

      if (target) {
        targetsByPeerId.set(
          target.peerId,
          target
        );
      }
    }

    if (items.length === 0) {
      break;
    }

    offset += items.length;
  }

  const targets = [
    ...targetsByPeerId.values()
  ];

  return {
    users: targets.filter(
      target => target.type === 'user'
    ),
    chats: targets.filter(
      target => target.type === 'chat'
    )
  };
}

async function handleUsers(context, vk) {
  if (!await requireAdmin(context)) {
    return true;
  }

  const audience =
    await getConversationAudience(vk);
  const total =
    audience.users.length +
    audience.chats.length;

  await context.reply(
    '📊 Статистика бота\n\n' +
    `👤 Пользователей в ЛС: ${audience.users.length}\n` +
    `💬 Бесед с ботом: ${audience.chats.length}\n` +
    `📨 Всего диалогов: ${total}`
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

  const audience =
    await getConversationAudience(vk);
  const targets = [
    ...audience.users,
    ...audience.chats
  ];

  if (targets.length === 0) {
    await context.reply(
      '❌ У бота пока нет диалогов для рассылки.'
    );

    return true;
  }

  await context.reply(
    '📨 Рассылка запущена.\n\n' +
    `👤 Пользователей в ЛС: ${audience.users.length}\n` +
    `💬 Бесед: ${audience.chats.length}`
  );

  const result = {
    users: {
      delivered: 0,
      failed: 0
    },
    chats: {
      delivered: 0,
      failed: 0
    }
  };

  for (const target of targets) {
    const resultKey =
      target.type === 'chat'
        ? 'chats'
        : 'users';

    try {
      if (!target.canWrite) {
        throw new Error(
          'VK запретил отправку в этот диалог'
        );
      }

      await vk.api.messages.send({
        peer_id: target.peerId,
        random_id: 0,
        message:
          '📢 Сообщение от администрации\n\n' +
          message
      });

      result[resultKey].delivered += 1;
    } catch (error) {
      result[resultKey].failed += 1;

      console.error(
        'Не удалось отправить рассылку в диалог ' +
        `${target.peerId}:`,
        error?.message ?? error
      );
    }

    if (BROADCAST_DELAY_MS > 0) {
      await delay(BROADCAST_DELAY_MS);
    }
  }

  await context.reply(
    '✅ Рассылка завершена.\n\n' +
    '👤 Личные сообщения: ' +
    `${result.users.delivered}/${audience.users.length}\n` +
    '💬 Беседы: ' +
    `${result.chats.delivered}/${audience.chats.length}\n` +
    '❌ Не доставлено: ' +
    `${result.users.failed + result.chats.failed}`
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
      '\\add₽ @username 1000'
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
    `💵 Начислено: +${formatMoney(amount)} ₽\n` +
    `🏦 Баланс: ${formatMoney(balance)} ₽`
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
      '\\minus₽ @username 1000'
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
    `➖ Запрошено: ${formatMoney(amount)} ₽\n` +
    `💵 Списано: ${formatMoney(result.removed)} ₽\n` +
    `🏦 Баланс: ${formatMoney(result.balance)} ₽`
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
      '\\set₽ @username 5000'
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
    `🏦 Баланс: ${formatMoney(balance)} ₽`
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
    '🏦 Баланс: 0 ₽'
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
      '\\addpromo MONEY ₽ 1000\n\n' +
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
      : `${formatMoney(amount)} ₽`;

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
    `💵 Баланс: ${formatMoney(balance)} ₽\n` +
    `🥔 Долг в играх: ${formatMoney(gameDebt)} ₽\n` +
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
  const payload =
    context.messagePayload;

  try {
    if (payload?.command === 'admin_home') {
      return sendAdminHome(context);
    }

    if (payload?.command === 'admin_section') {
      return sendAdminSection(
        context,
        payload.section
      );
    }

    if (payload?.command === 'admin_stats') {
      return handleAdminStats(context);
    }

    if (payload?.command === 'admin_dialogues') {
      return handleUsers(context, vk);
    }

    if (payload?.command === 'admin_top_money') {
      return handleAdminTopMoney(context);
    }

    if (payload?.command === 'admin_top_aura') {
      return handleAdminTopAura(context);
    }

    if (payload?.command === 'admin_promos') {
      return handleAdminPromos(context);
    }

    if (
      /^(?:!админ|\\admin)$/i
        .test(originalText)
    ) {
      return sendAdminHome(context);
    }

    if (/^\\stats$/i.test(originalText)) {
      return handleAdminStats(context);
    }

    if (/^\\topmoney$/i.test(originalText)) {
      return handleAdminTopMoney(context);
    }

    if (/^\\topaura$/i.test(originalText)) {
      return handleAdminTopAura(context);
    }

    if (/^\\promos$/i.test(originalText)) {
      return handleAdminPromos(context);
    }

    let match = originalText.match(
      /^\\phone\s+(\S+)$/i
    );

    if (match) {
      return handleAdminPhone(
        context,
        vk,
        match[1]
      );
    }

    match = originalText.match(
      /^\\assets\s+(\S+)$/i
    );

    if (match) {
      return handleAdminAssets(
        context,
        vk,
        match[1]
      );
    }

    if (/^\\users$/i.test(originalText)) {
      return handleUsers(context, vk);
    }

    match =
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
        /^\\addpromo\s+("[^"]+"|'[^']+'|\S+)\s+(aura|аура|[$₽])\s+(\d+)$/i
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
        /^\\add[$₽]\s+(\S+)\s+(\d+)$/i
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
        /^\\minus[$₽]\s+(\S+)\s+(\d+)$/i
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
        /^\\set[$₽]\s+(\S+)\s+(\d+)$/i
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
        /^\\reset[$₽]\s+(\S+)$/i
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
      /^\\(?:admin|stats|topmoney|topaura|phone|assets|promos|users|sms|addpromo|add[$₽]|minus[$₽]|set[$₽]|reset[$₽]|add|minus|set|reset|info)(?:\s|$)/i
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
        '\\phone @username\n' +
        '\\assets @username\n\n' +
        '\\add₽ @username 1000\n' +
        '\\minus₽ @username 1000\n' +
        '\\set₽ @username 5000\n' +
        '\\reset₽ @username\n\n' +
        '\\addpromo SUMMER aura 50\n' +
        '\\addpromo MONEY ₽ 1000\n\n' +
        '\\promos\n' +
        '\\stats\n' +
        '\\topmoney\n' +
        '\\topaura\n' +
        '\\users\n' +
        '\\sms Текст рассылки\n\n' +
        '!админ — открыть панель'
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
