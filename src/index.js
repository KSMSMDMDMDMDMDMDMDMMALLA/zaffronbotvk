'use strict';

require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const axios = require('axios');
const googleTts = require('google-tts-api');
const {
  Keyboard,
  VK
} = require('vk-io');

const admin = require('./admin');
const aura = require('./aura');
const bank = require('./bank');
const business = require('./business');
const earnings = require('./earnings');
const fishing = require('./fishing');
const games = require('./games2');
const jobs = require('./jobs');
const magazine = require('./magazine');
const meme = require('./meme');
const memduel = require('./memduel');
const other = require('./other');
const photo = require('./photo');
const promo = require('./promo');
const quests = require('./quests');
const race = require('./race');
const roleplay = require('./rp');
const transfer = require('./transfer');
const travel = require('./travel');
const communityWidget = require('./community-widget');
const {
  getCommandSuggestion
} = require('./command-suggestions');
const {
  JOB_MAX_LEVEL,
  formatMoney,
  getBalance,
  getBalanceTop,
  getBusinessState,
  getGameDebt,
  getJobExperienceRequired,
  getJobProfile,
  getMagazineAssets,
  getTotalAura,
  getUserByVkId,
  incrementQuestStat,
  initializeDatabase,
  saveUser
} = require('./database');
const {
  getItem
} = require('./magazine/catalog');

const USER_TRACK_INTERVAL_MS =
  5 * 60 * 1000;
const USER_REFRESH_INTERVAL_MS =
  24 * 60 * 60 * 1000;
const MAX_SPEECH_LENGTH = 200;
const MAX_WIKI_EXTRACT_LENGTH = 1100;

const bannerPaths = Object.freeze({
  start: path.join(
    __dirname,
    'photos',
    'start.jpg'
  ),
  profile: path.join(
    __dirname,
    'photos',
    'profile.jpg'
  ),
  commands: path.join(
    __dirname,
    'photos',
    'commands.jpg'
  )
});

const bannerCache = new Map();
const userTrackTimes = new Map();

const commandHandlers = [
  admin,
  memduel,
  meme,
  photo,
  aura,
  promo,
  transfer,
  roleplay,
  race,
  jobs,
  earnings,
  games,
  bank,
  magazine,
  business,
  fishing,
  quests,
  travel,
  other
];

function isChat(context) {
  return Boolean(
    context.isChat ||
    Number(context.peerId) >= 2000000000
  );
}

function createStartKeyboard() {
  return Keyboard.builder()
    .textButton({
      label: '👤 Профиль',
      payload: {
        command: 'profile'
      },
      color: Keyboard.PRIMARY_COLOR
    })
    .textButton({
      label: '📋 !команды',
      payload: {
        command: 'commands'
      },
      color: Keyboard.POSITIVE_COLOR
    });
}

function createHelpKeyboard() {
  return Keyboard.builder()
    .textButton({
      label: '👤 Профиль',
      payload: {
        command: 'profile'
      },
      color: Keyboard.PRIMARY_COLOR
    })
    .textButton({
      label: '❓ FAQ',
      payload: {
        command: 'faq'
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

function createCommandsKeyboard() {
  return Keyboard.builder()
    .textButton({
      label: '💙 Основное',
      payload: {
        command: 'commands_main'
      },
      color: Keyboard.PRIMARY_COLOR
    })
    .textButton({
      label: '💵 Заработок',
      payload: {
        command: 'commands_earnings'
      },
      color: Keyboard.POSITIVE_COLOR
    })
    .row()
    .textButton({
      label: '🎉 Развлечения',
      payload: {
        command: 'commands_fun'
      },
      color: Keyboard.NEGATIVE_COLOR
    })
    .textButton({
      label: '📄 Прочее',
      payload: {
        command: 'commands_other'
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

function createUnknownCommandKeyboard(
  suggestion = null
) {
  const keyboard = Keyboard.builder();

  if (suggestion) {
    keyboard.textButton({
      label: suggestion,
      payload: {
        command: 'suggested_command',
        text: suggestion
      },
      color: Keyboard.PRIMARY_COLOR
    });
  }

  keyboard
    .textButton({
      label: '📋 !команды',
      payload: {
        command: 'commands'
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();

  return keyboard;
}

function formatDate(value) {
  if (!value) {
    return 'сегодня';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat(
    'ru-RU',
    {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }
  ).format(date);
}

function getUserName(user, fallbackId) {
  return [
    user?.first_name ?? user?.firstName,
    user?.last_name ?? user?.lastName
  ]
    .filter(Boolean)
    .join(' ') || `id${fallbackId}`;
}

function getReplySenderId(context) {
  const reply = context.replyMessage;
  const value =
    reply?.senderId ??
    reply?.sender_id ??
    reply?.fromId ??
    reply?.from_id;
  const senderId = Number(value);

  return (
    Number.isInteger(senderId) &&
    senderId > 0
  )
    ? senderId
    : null;
}

function extractVkTarget(value) {
  return String(value ?? '')
    .trim()
    .replace(
      /^https?:\/\/(?:www\.)?vk\.(?:ru|com)\//i,
      ''
    )
    .replace(/^vk\.(?:ru|com)\//i, '')
    .replace(/^@/, '')
    .replace(/^\[id(\d+)\|.*\]$/i, 'id$1')
    .split(/[/?#\s]/)[0]
    .trim();
}

async function getVkUsers(vk, userIds) {
  const ids = [
    ...new Set(
      userIds
        .map(Number)
        .filter(id =>
          Number.isInteger(id) && id > 0
        )
    )
  ];

  if (ids.length === 0) {
    return [];
  }

  return vk.api.users.get({
    user_ids: ids.join(',')
  });
}

async function trackUser(context, vk) {
  const vkId = Number(context.senderId);

  if (!Number.isInteger(vkId) || vkId <= 0) {
    return;
  }

  const currentTime = Date.now();
  const lastTracked =
    userTrackTimes.get(vkId) ?? 0;

  if (
    currentTime - lastTracked <
    USER_TRACK_INTERVAL_MS
  ) {
    return;
  }

  userTrackTimes.set(vkId, currentTime);

  const existingUser = getUserByVkId(vkId);
  const lastSeenTime = new Date(
    existingUser?.last_seen_at ?? 0
  ).getTime();
  const shouldRefresh =
    !existingUser ||
    !existingUser.first_name ||
    Number.isNaN(lastSeenTime) ||
    currentTime - lastSeenTime >=
      USER_REFRESH_INTERVAL_MS;

  let firstName = existingUser?.first_name;
  let lastName = existingUser?.last_name;

  if (shouldRefresh) {
    try {
      const users = await getVkUsers(vk, [vkId]);
      const user = users[0];

      firstName = user?.first_name ?? firstName;
      lastName = user?.last_name ?? lastName;
    } catch (error) {
      console.error(
        'Не удалось обновить имя пользователя:',
        error?.message ?? error
      );
    }
  }

  saveUser({
    vkId,
    firstName,
    lastName
  });
}

async function getBanner(vk, peerId, key) {
  if (bannerCache.has(key)) {
    return bannerCache.get(key);
  }

  const filePath = bannerPaths[key];

  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  const attachment = await vk.upload.messagePhoto({
    peer_id: Number(peerId),
    source: {
      value: fs.readFileSync(filePath),
      filename: path.basename(filePath),
      contentType: 'image/jpeg'
    }
  });

  bannerCache.set(key, attachment);

  return attachment;
}

async function sendWithBanner(
  context,
  vk,
  bannerKey,
  params
) {
  let attachment = null;

  try {
    attachment = await getBanner(
      vk,
      context.peerId,
      bannerKey
    );
  } catch (error) {
    console.error(
      `Не удалось загрузить баннер ${bannerKey}:`,
      error?.message ?? error
    );
  }

  await context.send({
    ...params,
    ...(attachment
      ? { attachment }
      : {})
  });
}

function getCommandsText() {
  return (
    '╭─── 📋 Zaffron ───╮\n\n' +
    'Выбери раздел команд кнопками ниже:\n\n' +
    '💙 Основное\n' +
    '💵 Заработок\n' +
    '🎉 Развлечения\n' +
    '📄 Прочее\n\n' +
    '╰──────────────╯'
  );
}

function getCommandsSectionText(section) {
  const sections = {
    main:
      '╭─── 💙 Основное ───╮\n\n' +
      '│\n' +
      '├ 👤 !п — профиль\n' +
      '├ 💵 !баланс — игровой баланс\n' +
      '├ 🏆 !топ баланс — топ-10 по балансу\n' +
      '├ 💸 !передать [сумма] [user / реплай]\n' +
      '├ 🎟 !promo [код] — активировать промокод\n' +
      '├ 📋 !команды — меню команд\n' +
      '└ ❓ FAQ -\n\n' +
      '╰──────────────╯',
    earnings:
      '╭─── 💵 Заработок ───╮\n\n' +
      '│\n' +
      '├ 💼 !работы — список работ\n' +
      '├ 🔨 !работать [работа] — начать смену\n' +
      '├ 🎁 !коробка — открыть коробку\n' +
      '├ 🛒 !магазин — магазин имущества\n' +
      '├ 🏠 !имущество — твоё имущество\n' +
      '├ 🏢 !бизнес — управление бизнесами\n' +
      '├ 🏦 !банк — вклад и проценты\n' +
      '├ 🎯 !квесты — список квестов\n' +
      '├ 🎣 !рыбачить — начать рыбалку\n' +
      '├ 🧺 !улов — посмотреть улов\n' +
      '└ ✈ !перелёт / !переезд [страна]\n\n' +
      '╰──────────────╯',
    fun:
      '╭─── 🎉 Развлечения ───╮\n\n' +
      '│\n' +
      '├ 🔮 !zaff стоит ли [вопрос]\n' +
      '├ 🔊 !скажи [текст]\n' +
      '├ 🤔 !кто [текст]\n' +
      '├ 😂 !мем\n' +
      '├ ✨ +аура [реплай]\n' +
      '├ ✨ !топ ауры\n' +
      '├ 🌌 !мемдуэль [username / реплай]\n' +
      '├ 🥔 !картошка\n' +
      '├ 💣 !бомба\n' +
      '├ ⚡ !реакция\n' +
      '├ 🎰 !казино [число]\n' +
      '├ 🎯 !угадай [число]\n' +
      '├ 🏁 !гонка [user] [ставка]\n' +
      '└ 💞 !обнять / !поцеловать / !погладить\n\n' +
      '╰──────────────╯',
    other:
      '╭─── 📄 Прочее ───╮\n\n' +
      '│\n' +
      '├ 🔍 !анализ [ссылка | @username]\n' +
      '├ 📚 !вики [запрос]\n' +
      '├ 🌠 Обработка фотографии [в лс бота]\n' +
      '└ 💚 !qr [текст / ссылка]\n\n' +
      '╰──────────────╯'
  };

  return sections[section] ?? getCommandsText();
}

async function sendStart(context, vk) {
  await sendWithBanner(
    context,
    vk,
    'start',
    {
      message:
        '👋 Добро пожаловать в Zaffron!\n\n' +
        'Это игровой бот с экономикой, бизнесами, работами, мини-играми и аурой.\n\n' +
        'Открой профиль или список команд кнопками ниже.',
      keyboard: createStartKeyboard()
    }
  );

  return true;
}

async function sendCommands(context, vk) {
  await sendWithBanner(
    context,
    vk,
    'commands',
    {
      message: getCommandsText(),
      keyboard: createCommandsKeyboard()
    }
  );

  return true;
}

async function sendCommandsSection(
  context,
  section
) {
  await context.send({
    message: getCommandsSectionText(section),
    keyboard: createCommandsKeyboard()
  });

  return true;
}

async function sendFaq(context) {
  await context.send({
    message:
      '❓ FAQ Zaffron\n\n' +
      '💵 Как заработать?\n' +
      'Работай, открывай коробки, играй, рыбачь и развивай бизнесы.\n\n' +
      '✨ Что такое аура?\n' +
      'Это репутация. Ответь «+аура» на сообщение другого игрока.\n\n' +
      '⭐ Как повысить уровень?\n' +
      'Завершай рабочие смены и получай EXP.\n\n' +
      '💬 Бот работает в беседах?\n' +
      'Да. Добавь сообщество в беседу и используй команды с «!».',
    keyboard: createHelpKeyboard()
  });

  return true;
}

function getBusinessProfileText(vkId) {
  const businessItems = getMagazineAssets(vkId)
    .filter(asset =>
      asset.itemType === 'businesses'
    )
    .map(asset => getItem(asset.itemKey))
    .filter(Boolean);

  if (businessItems.length === 0) {
    return '📈 Доход бизнесов: 0 $/час';
  }

  const incomePerHour = businessItems.reduce(
    (total, item) => {
      const state = getBusinessState({
        vkId,
        itemKey: item.key,
        baseIncome: item.incomePerHour
      });

      return total + (
        state.status === 'owned'
          ? state.incomePerHour
          : 0
      );
    },
    0
  );

  return (
    `📈 Доход бизнесов: ` +
    `${formatMoney(incomePerHour)} $/час`
  );
}

async function sendProfile(context, vk) {
  const vkId = Number(context.senderId);

  incrementQuestStat(
    vkId,
    'profile_views'
  );

  const user = getUserByVkId(vkId);
  const jobProfile = getJobProfile(vkId);
  const experienceRequired =
    getJobExperienceRequired(jobProfile.level);
  const experienceText =
    experienceRequired === null
      ? `${jobProfile.experience} (макс. уровень)`
      : `${jobProfile.experience}/${experienceRequired}`;

  const message =
    `👤 Профиль @id${vkId} (${getUserName(user, vkId)})\n\n` +
    `📅 В боте с: ${formatDate(user?.created_at)}\n` +
    `✨ Аура: ${getTotalAura(vkId)}\n` +
    `💵 Баланс: ${formatMoney(getBalance(vkId))} $\n` +
    `🥔 Долг в играх: ${formatMoney(getGameDebt(vkId))} $\n` +
    `⭐ Уровень: ${jobProfile.level}/${JOB_MAX_LEVEL}\n` +
    `📈 EXP: ${experienceText}\n\n` +
    `${magazine.getProfileText(vkId)}\n` +
    `${getBusinessProfileText(vkId)}\n\n` +
    travel.getProfileText(vkId);

  await sendWithBanner(
    context,
    vk,
    'profile',
    {
      message,
      keyboard: createHelpKeyboard(),
      disable_mentions: false
    }
  );

  return true;
}

async function sendBalance(context) {
  const balance = getBalance(
    Number(context.senderId)
  );

  await context.send(
    `💵 Твой баланс: ${formatMoney(balance)} $`
  );

  return true;
}

async function sendBalanceTop(context, vk) {
  const top = getBalanceTop(10);

  if (top.length === 0) {
    await context.send(
      '🏆 Топ баланса пока пуст.'
    );

    return true;
  }

  let users = [];

  try {
    users = await getVkUsers(
      vk,
      top.map(item => item.vkId)
    );
  } catch (error) {
    console.error(
      'Не удалось получить имена топа:',
      error?.message ?? error
    );
  }

  const usersById = new Map(
    users.map(user => [Number(user.id), user])
  );
  const medals = ['🥇', '🥈', '🥉'];
  const lines = top.map((item, index) => {
    const user =
      usersById.get(item.vkId) ??
      getUserByVkId(item.vkId);
    const position =
      medals[index] ?? `${index + 1}.`;

    return (
      `${position} @id${item.vkId} ` +
      `(${getUserName(user, item.vkId)}) — ` +
      `${formatMoney(item.balance)} $`
    );
  });

  await context.send({
    message:
      '🏆 Топ-10 по балансу\n\n' +
      lines.join('\n'),
    disable_mentions: false
  });

  return true;
}

async function handleZaff(context, question) {
  if (!String(question ?? '').trim()) {
    await context.send(
      '❌ Задай вопрос.\n\n' +
      'Пример: !zaff стоит ли сегодня работать?'
    );

    return true;
  }

  const answers = [
    'Да, определённо 😎',
    'Скорее да',
    'Стоит, но без фанатизма',
    'Лучше не надо 💀',
    'Сегодня точно нет',
    'Спроси ещё раз через минуту',
    'Zaffron говорит: рискни'
  ];
  const answer = answers[
    crypto.randomInt(answers.length)
  ];

  await context.reply(`🔮 ${answer}`);

  return true;
}

async function handleSay(context, vk, rawText) {
  const text = String(rawText ?? '').trim();

  if (!text) {
    await context.send(
      '❌ Укажи текст.\n\n' +
      'Пример: !скажи привет всем'
    );

    return true;
  }

  if (text.length > MAX_SPEECH_LENGTH) {
    await context.send(
      `❌ Максимум ${MAX_SPEECH_LENGTH} символов.`
    );

    return true;
  }

  try {
    const audioUrl = googleTts.getAudioUrl(text, {
      lang: 'ru',
      slow: false,
      host: 'https://translate.google.com'
    });
    const response = await axios.get(audioUrl, {
      responseType: 'arraybuffer',
      timeout: 20000
    });
    const audio = Buffer.from(response.data);

    if (audio.length === 0) {
      throw new Error('Google TTS вернул пустой файл');
    }

    const attachment = await vk.upload.audioMessage({
      peer_id: Number(context.peerId),
      source: {
        value: audio,
        filename: 'zaffron-voice.mp3',
        contentType: 'audio/mpeg'
      }
    });

    await context.send({
      message: '🗣 Zaffron говорит:',
      attachment
    });
  } catch (error) {
    console.error(
      'Не удалось отправить голосовое сообщение:',
      error?.message ?? error
    );

    await context.send({
      message: `🗣 ${text}`,
      disable_mentions: true
    });
  }

  return true;
}

async function handleWho(context, vk, rawQuestion) {
  const question = String(rawQuestion ?? '').trim();

  if (!question) {
    await context.send(
      '❌ Укажи вопрос.\n\n' +
      'Пример: !кто сегодня самый удачливый?'
    );

    return true;
  }

  let users = [];

  if (isChat(context)) {
    try {
      const members =
        await vk.api.messages.getConversationMembers({
          peer_id: Number(context.peerId),
          fields: 'screen_name'
        });

      users = (members?.profiles ?? [])
        .filter(user => Number(user.id) > 0);
    } catch (error) {
      console.error(
        'Не удалось получить участников беседы:',
        error?.message ?? error
      );
    }
  }

  if (users.length === 0) {
    try {
      users = await getVkUsers(
        vk,
        [Number(context.senderId)]
      );
    } catch {
      users = [];
    }
  }

  const chosen = users.length > 0
    ? users[crypto.randomInt(users.length)]
    : null;
  const chosenId = Number(
    chosen?.id ?? context.senderId
  );

  await context.send({
    message:
      `🎯 ${question}\n\n` +
      `Это @id${chosenId} ` +
      `(${getUserName(chosen, chosenId)})!`,
    disable_mentions: false
  });

  return true;
}

async function resolveAnalysisUser(
  context,
  vk,
  rawTarget
) {
  const replyId = getReplySenderId(context);
  const target = extractVkTarget(rawTarget);
  const userId = replyId || target || context.senderId;
  const users = await vk.api.users.get({
    user_ids: userId,
    fields: 'city,country,bdate,online,screen_name'
  });

  return users?.[0] ?? null;
}

function getAnalysisScore(userId, key) {
  const hash = crypto
    .createHash('sha256')
    .update(`${userId}:${key}:zaffron`)
    .digest();

  return (hash.readUInt32BE(0) % 100) + 1;
}

async function handleAnalysis(
  context,
  vk,
  rawTarget
) {
  let user;

  try {
    user = await resolveAnalysisUser(
      context,
      vk,
      rawTarget
    );
  } catch (error) {
    console.error(
      'Ошибка команды анализа:',
      error?.message ?? error
    );
  }

  if (!user?.id) {
    await context.send(
      '❌ Пользователь не найден. Проверь ссылку или username.'
    );

    return true;
  }

  const id = Number(user.id);
  const charisma = getAnalysisScore(id, 'charisma');
  const luck = getAnalysisScore(id, 'luck');
  const danger = getAnalysisScore(id, 'danger');
  const memePower = getAnalysisScore(id, 'meme');
  const verdict = [
    'Главный герой этой беседы',
    'Скрытый миллиардер Zaffron',
    'Мемный стратег',
    'Опасно обаятельный игрок',
    'Будущая легенда топа'
  ][getAnalysisScore(id, 'verdict') % 5];

  await context.send({
    message:
      `🔎 Анализ @id${id} (${getUserName(user, id)})\n\n` +
      `😎 Харизма: ${charisma}%\n` +
      `🍀 Удача: ${luck}%\n` +
      `☠ Опасность: ${danger}%\n` +
      `😂 Сила мемов: ${memePower}%\n\n` +
      `📌 Вердикт: ${verdict}`,
    disable_mentions: false
  });

  return true;
}

async function handleWiki(context, rawQuery) {
  const query = String(rawQuery ?? '').trim();

  if (!query) {
    await context.send(
      '❌ Укажи запрос.\n\n' +
      'Пример: !вики Чёрная дыра'
    );

    return true;
  }

  try {
    const response = await axios.get(
      'https://ru.wikipedia.org/w/api.php',
      {
        params: {
          action: 'query',
          generator: 'search',
          gsrsearch: query,
          gsrlimit: 1,
          prop: 'extracts|info',
          exintro: 1,
          explaintext: 1,
          inprop: 'url',
          redirects: 1,
          format: 'json',
          origin: '*'
        },
        timeout: 15000,
        headers: {
          'User-Agent': 'ZaffronVKBot/1.0'
        }
      }
    );
    const pages = Object.values(
      response.data?.query?.pages ?? {}
    );
    const page = pages[0];

    if (!page?.title) {
      await context.send(
        '🔍 В Википедии ничего не найдено.'
      );

      return true;
    }

    const fullExtract = String(
      page.extract ?? 'Краткое описание отсутствует.'
    ).trim();
    const extract =
      fullExtract.length > MAX_WIKI_EXTRACT_LENGTH
        ? `${fullExtract.slice(
          0,
          MAX_WIKI_EXTRACT_LENGTH
        ).trim()}…`
        : fullExtract;
    const url =
      page.fullurl ??
      `https://ru.wikipedia.org/wiki/${encodeURIComponent(
        String(page.title).replace(/ /g, '_')
      )}`;

    await context.send(
      `📚 ${page.title}\n\n${extract}\n\n🔗 ${url}`
    );
  } catch (error) {
    console.error(
      'Ошибка Википедии:',
      error?.message ?? error
    );

    await context.send(
      '❌ Википедия сейчас не отвечает. Попробуй немного позже.'
    );
  }

  return true;
}

async function handleCoreCommand(
  context,
  vk
) {
  let originalText = String(
    context.text ?? ''
  ).trim();
  const payload = context.messagePayload;

  if (
    payload?.command === 'suggested_command' &&
    payload.text
  ) {
    originalText = String(payload.text).trim();
  }

  if (
    payload?.command === 'start' ||
    /^(?:начать|start)$/i.test(originalText)
  ) {
    return sendStart(context, vk);
  }

  if (
    payload?.command === 'commands' ||
    /^!команд(?:ы|а)$/i.test(originalText)
  ) {
    return sendCommands(context, vk);
  }

  const commandsSectionByPayload = {
    commands_main: 'main',
    commands_earnings: 'earnings',
    commands_fun: 'fun',
    commands_other: 'other'
  };

  const commandsSection =
    commandsSectionByPayload[payload?.command] ||
    (/^(?:💙\s*)?основное$/i.test(originalText)
      ? 'main'
      : /^(?:💵\s*)?заработок$/i.test(originalText)
        ? 'earnings'
        : /^(?:🎉\s*)?развлечения$/i.test(originalText)
          ? 'fun'
          : /^(?:📄\s*)?прочее$/i.test(originalText)
            ? 'other'
            : null);

  if (commandsSection) {
    return sendCommandsSection(
      context,
      commandsSection
    );
  }

  if (
    payload?.command === 'faq' ||
    /^!?faq$/i.test(originalText)
  ) {
    return sendFaq(context);
  }

  if (
    payload?.command === 'profile' ||
    /^(?:!п|!профиль|профиль)$/i.test(originalText)
  ) {
    return sendProfile(context, vk);
  }

  if (/^!баланс$/i.test(originalText)) {
    return sendBalance(context);
  }

  if (/^!топ\s+баланс$/i.test(originalText)) {
    return sendBalanceTop(context, vk);
  }

  const zaffMatch = originalText.match(
    /^!zaff\s+стоит\s+ли(?:\s+(.+))?$/i
  );

  if (zaffMatch) {
    return handleZaff(context, zaffMatch[1]);
  }

  const sayMatch = originalText.match(
    /^!скажи(?:\s+([\s\S]+))?$/i
  );

  if (sayMatch) {
    return handleSay(
      context,
      vk,
      sayMatch[1]
    );
  }

  const whoMatch = originalText.match(
    /^!кто(?:\s+([\s\S]+))?$/i
  );

  if (whoMatch) {
    return handleWho(
      context,
      vk,
      whoMatch[1]
    );
  }

  const analysisMatch = originalText.match(
    /^!анализ(?:\s+(.+))?$/i
  );

  if (analysisMatch) {
    return handleAnalysis(
      context,
      vk,
      analysisMatch[1]
    );
  }

  const wikiMatch = originalText.match(
    /^!вики(?:\s+([\s\S]+))?$/i
  );

  if (wikiMatch) {
    return handleWiki(context, wikiMatch[1]);
  }

  return false;
}

async function handleUnknownCommand(
  context,
  vk
) {
  if (isChat(context)) {
    return false;
  }

  const originalText = String(
    context.text ?? ''
  ).trim();
  const suggestion = getCommandSuggestion(
    originalText
  );

  if (suggestion) {
    await context.send({
      message:
        `🤔 Возможно, ты имел в виду: ${suggestion}`,
      keyboard:
        createUnknownCommandKeyboard(suggestion)
    });

    return true;
  }

  if (!originalText) {
    return false;
  }

  await context.send({
    message:
      '❌ Такой команды не существует.\n\n' +
      'Нажми кнопку ниже, чтобы открыть список команд.',
    keyboard: createUnknownCommandKeyboard()
  });

  return true;
}

async function dispatchMessage(
  context,
  vk
) {
  if (context.isOutbox) {
    return;
  }

  try {
    await trackUser(context, vk);

    for (const handler of commandHandlers) {
      if (await handler.handle(context, vk)) {
        return;
      }
    }

    if (await handleCoreCommand(context, vk)) {
      return;
    }

    await handleUnknownCommand(context, vk);
  } catch (error) {
    console.error(
      'Ошибка обработки сообщения:',
      error
    );

    try {
      await context.send(
        '❌ Произошла ошибка. Попробуй ещё раз немного позже.'
      );
    } catch (sendError) {
      console.error(
        'Не удалось отправить сообщение об ошибке:',
        sendError
      );
    }
  }
}

function createVk(token) {
  return new VK({
    token,
    apiVersion: '5.199'
  });
}

async function start() {
  const token = String(
    process.env.VK_TOKEN ?? ''
  ).trim();

  if (!token) {
    throw new Error(
      'В .env не указан VK_TOKEN'
    );
  }

  await initializeDatabase();

  const vk = createVk(token);

  jobs.initialize(vk);
  communityWidget.initialize(vk);

  vk.updates.on(
    'message_new',
    context => dispatchMessage(context, vk)
  );

  await vk.updates.start();

  console.log('Zaffron запущен и ждёт сообщения.');

  return vk;
}

if (require.main === module) {
  start().catch(error => {
    console.error(
      'Не удалось запустить Zaffron:',
      error
    );
    process.exitCode = 1;
  });
}

module.exports = {
  createVk,
  dispatchMessage,
  getCommandsText,
  getCommandsSectionText,
  handleCoreCommand,
  start
};
