require('dotenv').config();

const { VK, Keyboard } = require('vk-io');

const axios = require('axios');
const photo = require('./photo');
const meme = require('./meme');
const aura = require('./aura');
const memduel = require('./memduel');
const games2 = require('./games2');
const other = require('./other');

const {
  initializeDatabase,
  saveUser,
  getUserByVkId,
  getTotalAura
} = require('./database');

const fs = require('fs');
const gtts = require('google-tts-api');
const path = require('path');

const token = process.env.VK_TOKEN;

if (!token) {
  console.error('Ошибка: в файле .env не указан VK_TOKEN');
  process.exit(1);
}

const vk = new VK({
  token,
  apiVersion: '5.199'
});

vk.updates.on('raw_event', (event) => {
  console.log(JSON.stringify(event, null, 2));
});





let groupId = null;

function normalizeText(text) {
  return String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[!.,?]+$/g, '');
}

function formatDate(dateString) {
  if (!dateString) {
    return 'Неизвестно';
  }

  const date = new Date(
    dateString.replace(' ', 'T') + 'Z'
  );

  return date.toLocaleDateString('ru-RU', {
    timeZone: 'Europe/Moscow'
  });
}

async function sendPhoto(context, vk, fileName, message = '') {
  const attachment = await vk.upload.messagePhoto({
    peer_id: context.peerId,
    source: {
      value: fs.createReadStream(
        path.join(__dirname, '..', 'photos', fileName)
      )
    }
  });

  await context.send({
    message,
    attachment
  });
}


function extractVkUser(value) {
  return String(value ?? '')
    .trim()
    .replace(/^https?:\/\/(www\.)?vk\.com\//i, '')
    .replace(/^vk\.com\//i, '')
    .replace(/^@/, '')
    .split(/[?#/]/)[0]
    .trim();
}

function formatUnixDate(timestamp) {
  if (!timestamp) {
    return 'Неизвестно';
  }

  return new Date(timestamp * 1000).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}



function getPlatformName(platform) {
  const platforms = {
    1: 'Мобильная версия',
    2: 'iPhone',
    3: 'iPad',
    4: 'Android',
    5: 'Windows Phone',
    6: 'Windows',
    7: 'Официальный сайт'
  };

  return platforms[platform] || 'Неизвестное устройство';
}

function getSexName(sex) {
  if (sex === 1) {
    return 'Женский';
  }

  if (sex === 2) {
    return 'Мужской';
  }

  return 'Не указан';
}

function getRelationName(relation) {
  const relations = {
    1: 'Не женат / не замужем',
    2: 'Есть друг / подруга',
    3: 'Помолвлен(а)',
    4: 'Женат / замужем',
    5: 'Всё сложно',
    6: 'В активном поиске',
    7: 'Влюблён(а)',
    8: 'В гражданском браке'
  };

  return relations[relation] || 'Не указано';
}

async function getSenderName(context) {
  try {
    const [user] = await vk.api.users.get({
      user_ids: context.senderId
    });

    return {
      firstName: user?.first_name ?? null,
      lastName: user?.last_name ?? null
    };
  } catch (error) {
    console.error(
      'Не удалось получить имя пользователя:',
      error.message
    );

    return {
      firstName: null,
      lastName: null
    };
  }
}

async function searchWikipedia(query) {
  try {
    const config = {
      headers: {
        'User-Agent': 'ZaffronBot/1.0 (VK bot)'
      }
    };

    const search = await axios.get(
      'https://ru.wikipedia.org/w/api.php',
      {
        ...config,
        params: {
          action: 'query',
          list: 'search',
          srsearch: query,
          format: 'json',
          utf8: 1
        }
      }
    );


    const result = search.data.query.search[0];


    if (!result) {
      return null;
    }


    const page = await axios.get(
      'https://ru.wikipedia.org/w/api.php',
      {
        ...config,
        params: {
          action: 'query',
          prop: 'extracts|info',
          exintro: 1,
          explaintext: 1,
          inprop: 'url',
          pageids: result.pageid,
          format: 'json',
          utf8: 1
        }
      }
    );

    const sizes = photo.photo.sizes;

    const url = sizes
    .sort((a, b) => b.width - a.width)[0]
    .url;


    const pageData =
      Object.values(page.data.query.pages)[0];


    return {
      title: pageData.title,
      text: pageData.extract,
      url: pageData.fullurl
    };


  } catch (error) {

    console.error(
      'Ошибка Wikipedia:',
      error.response?.status || error.message
    );

    return null;
  }
}



function wait(milliseconds) {
  return new Promise(resolve =>
    setTimeout(resolve, milliseconds)
  );
}

async function uploadVoice(
  vk,
  peerId,
  audioBuffer
) {
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await vk.upload.audioMessage({
        peer_id: peerId,

        source: {
          value: audioBuffer,
          filename:
            `zaffron-${Date.now()}-${attempt}.mp3`,
          contentType: 'audio/mpeg',
          contentLength: audioBuffer.length
        }
      });
    } catch (error) {
      lastError = error;

      console.error(
        `Ошибка загрузки голоса, попытка ${attempt}:`,
        error.message
      );

      if (attempt < 3) {
        await wait(attempt * 1500);
      }
    }
  }

  throw lastError || new Error(
    'Не удалось загрузить голосовое сообщение'
  );
}


async function createVoice(text) {
  const url = gtts.getAudioUrl(text, {
    lang: 'ru',
    slow: false
  });

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60000
  });

  const audioBuffer = Buffer.from(response.data);

  if (audioBuffer.length === 0) {
    throw new Error(
      'Google TTS вернул пустой аудиофайл'
    );
  }

  return audioBuffer;
}

//функции//

vk.updates.on('message_new', async (context, next) => {
  if (context.isOutbox) {
    return next();
  }


  /*
   * Когда сообщество добавили в беседу.
   *
   * В vk-io для событий беседы доступны:
   * context.eventType
   * context.eventMemberId
   */
  const botMemberId = groupId ? -groupId : null;

  if (
  context.isChat &&
  context.action?.type === 'chat_invite_user'
) {
    await context.send(
`👋 Спасибо, что добавили меня в беседу!

⚠ Для полноценной работы выдайте мне права администратора.

📋 После этого напишите:
!команды`
    );

    return;
  }

  
  const originalText = String(context.text ?? '').trim();
  const text = normalizeText(originalText);


if (
  await other.handle(
    context,
    vk
  )
) {
  return;
}

  
if (
  await games2.handle(
    context,
    vk
  )
) {
  return;
}


if (await memduel.handle(context, vk)) {
  return;
}

if (await meme.handle(context, vk)) {
  return;
}

if (await photo.handle(context, vk)) {
  return;
}

if (await aura.handle(context, vk)) {
  return;
}


  /*
   * Начать — только в личных сообщениях.
   */
const startCommands = new Set([
  'начать',
  '/start',
  'start'
]);

if (context.isUser && startCommands.has(text)) {
  const user = await getSenderName(context);

  saveUser({
    vkId: context.senderId,
    firstName: user.firstName,
    lastName: user.lastName
  });

  const attachment = await vk.upload.messagePhoto({
    peer_id: context.peerId,
    source: {
      value: fs.createReadStream(
        path.join(__dirname, 'photos', 'start.jpg')
)
    }
  });

  await context.send({
    message:
      '👋 Добро пожаловать в Бот Zaffron!\n\n' +
      '📋 Жми на кнопки ниже!\n',

    attachment,

    keyboard: Keyboard.builder()
      .textButton({
        label: '👤 Профиль',
        payload: {
          command: 'profile'
        },
        color: Keyboard.PRIMARY_COLOR
      })
      .textButton({
        label: '📋 Команды',
        payload: {
          command: 'commands'
        },
        color: Keyboard.SECONDARY_COLOR
      })
      .inline()
  });

  return;
}



  if (/^!скажи\s*$/i.test(originalText)) {

  await context.send(
    '❌ Напиши текст для озвучки.\n\n' +
    'Пример:\n' +
    '!скажи Привет Zaffron'
  );

  return;
}


const sayMatch = originalText.match(
  /^!скажи\s+(.+)$/i
);


if (sayMatch) {
  const textToSpeak =
    sayMatch[1].trim();

  if (textToSpeak.length > 200) {
    await context.send(
      '❌ Слишком длинный текст. Максимум 200 символов.'
    );

    return;
  }

  try {
    await context.send(
      '🎙 Озвучиваю...'
    );

    const audioBuffer =
      await createVoice(textToSpeak);

    const attachment =
      await uploadVoice(
        vk,
        context.peerId,
        audioBuffer
      );

    await context.send({
      message: 'Готово!',
      attachment
    });
  } catch (err) {
    console.error(
      'Ошибка озвучки:',
      err
    );

    await context.send({
      message:
        '❌ Не удалось создать озвучку'
    });
  }

  return;
}

// Команда !кто
if (/^!кто\s+(.+)/i.test(originalText)) {

  const whoMatch = originalText.match(
    /^!кто\s+(.+)/i
  );

  const insult = whoMatch[1].trim();

  try {

    const members = await vk.api.messages.getConversationMembers({
      peer_id: context.peerId
    });


    let users = members.items
      .filter(member => member.member_id > 0);


    // убираем самого бота
    users = users.filter(
      user => user.member_id !== -context.groupId
    );


    if (users.length === 0) {
      await context.send(
        '❌ Не нашёл участников.'
      );

      return;
    }


    const randomUser =
      users[
        Math.floor(Math.random() * users.length)
      ];


    const [user] = await vk.api.users.get({
      user_ids: randomUser.member_id
    });


    await context.send({
  message:
`🤔 Я думаю, что @id${user.id} (${user.first_name}) ${insult}`,

  reply_to: context.messageId,
  disable_mentions: false
});

    return;


  } catch(error) {

    console.error(
      'Ошибка !кто:',
      error
    );


    await context.send(
      '❌ Не получилось выбрать человека.'
    );

    return;
  }
}

// Команда !шанс
if (/^!шанс\s+(.+)/i.test(originalText)) {

  const chanceMatch = originalText.match(
    /^!шанс\s+(.+)/i
  );

  const question = chanceMatch[1].trim();


  const percent = Math.floor(
    Math.random() * 101
  );


  let answer;

  if (percent <= 10) {
    answer = '💀 Практически невозможно.';
  } 
  else if (percent <= 30) {
    answer = '😬 Очень сомнительно.';
  } 
  else if (percent <= 50) {
    answer = '🤔 Половина на половину.';
  } 
  else if (percent <= 80) {
    answer = '😎 Есть хорошие шансы.';
  } 
  else {
    answer = '🔥 Почти гарантировано!';
  }


  await context.send({
    message:
`🎲 Шанс: ${percent}%

${answer}`,

    reply_to: context.id,
    disable_mentions: true
});


  return;
}

  /*
   * Профиль.
   * Работает и в личке, и в беседе.
   */
const payload = context.messagePayload;

if (payload?.command === 'commands') {

  const attachment = await vk.upload.messagePhoto({
    peer_id: context.peerId,
    source: {
      value: fs.createReadStream(
        path.join(__dirname, 'photos', 'commands.jpg')
      )
    }
  });

  await context.send({
    attachment,

    message:
`╭─── 📋 Zaffron ───╮

💙 Основное
│
├ 👤 !п — профиль
├ 📋 !команды — список команд
└ ❓ FAQ -

🎉 Развлечения
│
├ 🔮 !zaff стоит ли [вопрос]
├ 🔊 !скажи [текст]
├ 🤔 !кто [текст]
├ 😂 !мем
├ ✨ +аура [реплай]
├ ✨ !топ ауры
├ 🌌 !мемдуэль [username / реплай]
├ 🥔 !картошка
├ 💣 !бомба 
├ ⚡ !реакция
├ 🎰 !казино [число]
└ 🎯 !угадай

📄 Прочее
│
├ 🔍 !анализ [ссылка | @username]
├ 📚 !вики [запрос]
├ 🌠 Обработка фотографии [в лс бота]
└ 💚 !qr [текст/ссылка]

╰──────────────╯`
  });

  return;
}
  const isProfileCommand =
  /^!п$/i.test(originalText) ||
  originalText === '👤 Профиль';

  const auraCount = getTotalAura(
  Number(context.senderId)
);

if (isProfileCommand) {
  let user = getUserByVkId(context.senderId);

  if (!user) {
    const sender = await getSenderName(context);

    saveUser({
      vkId: context.senderId,
      firstName: sender.firstName,
      lastName: sender.lastName
    });

    user = getUserByVkId(context.senderId);
  }

    const fullName = [
      user.first_name,
      user.last_name
    ]
      .filter(Boolean)
      .join(' ') || 'Неизвестно';

    const auraCount = getTotalAura(
  Number(context.senderId)
);;

    const attachment = await vk.upload.messagePhoto({
      peer_id: context.peerId,
      source: {
        value: fs.createReadStream(
          path.join(__dirname, 'photos', 'profile.jpg')
        )
      }
    });

    await context.send({
      attachment,

      message:
        '👤 Профиль\n\n' +
        `🆔 ID: ${user.vk_id}\n` +
        `👤 Имя: ${fullName}\n` +
        `✨ Аура: ${auraCount}\n\n` +
        `📅 Регистрация: ${formatDate(user.created_at)}`
    });

  return;
}

  /*
  /*
 * Список команд.
 */
if (/^!команды$/i.test(originalText)) {

  const attachment = await vk.upload.messagePhoto({
    peer_id: context.peerId,
    source: {
      value: fs.createReadStream(
        path.join(__dirname, 'photos', 'commands.jpg')
      )
    }
  });

  await context.send({
    attachment,

    message:
`╭─── 📋 Zaffron ───╮

💙 Основное
│
├ 👤 !п — профиль
├ 📋 !команды — список команд
└ ❓ FAQ -

🎉 Развлечения
│
├ 🔮 !zaff стоит ли [вопрос]
├ 🔊 !скажи [текст]
├ 🤔 !кто [текст]
├ 😂 !мем
├ ✨ +аура [реплай]
├ ✨ !топ ауры
├ 🌌 !мемдуэль [username / реплай]
├ 🥔 !картошка
├ 💣 !бомба 
├ ⚡ !реакция
├ 🎰 !казино [число]
└ 🎯 !угадай

📄 Прочее
│
├ 🔍 !анализ [ссылка | @username]
├ 📚 !вики [запрос]
├ 🌠 Обработка фотографии [в лс бота]
└ 💚 !qr [текст/ссылка]

╰──────────────╯`
  });

  return;
}

  if (/^!вики\s*$/i.test(originalText)) {
  await context.send(
    '❌ Напиши запрос.\n\n' +
    'Пример:\n' +
    '!вики Minecraft'
  );

  return;
}


const wikiMatch = originalText.match(
  /^!вики\s+(.+)$/i
);


if (wikiMatch) {

  const query = wikiMatch[1].trim();

  await context.send(
    '🔎 Ищу информацию в Wikipedia...'
  );


  const result = await searchWikipedia(query);


  if (!result) {
    await context.send(
      '❌ Ничего не найдено.'
    );

    return;
  }


  let description = result.text || 
    'Описание отсутствует.';


  if (description.length > 800) {
    description =
      description.substring(0, 800) + '...';
  }


  await context.send(
`📚 Wikipedia

🔹 ${result.title}

${description}

🔗 Подробнее:
${result.url}`
  );


  return;
}

  /*
   * Анализ без указанной страницы.
   */
  if (/^!анализ\s*$/i.test(originalText)) {
    await context.send(
      '❌ Укажи страницу пользователя.\n\n' +
      'Пример:\n' +
      '!анализ https://vk.com/durov'
    );

    return;
  }

  /*
   * Анализ страницы.
   */
  const analysisMatch = originalText.match(
    /^!анализ\s+(.+)$/i
  );

  if (analysisMatch) {
    const userInput = extractVkUser(
      analysisMatch[1]
    );

    if (!userInput) {
      await context.send(
        '❌ Не удалось определить страницу пользователя.'
      );

      return;
    }

    try {
      const users = await vk.api.users.get({
        user_ids: userInput,
        fields: [
          'screen_name',
          'sex',
          'bdate',
          'city',
          'country',
          'online',
          'last_seen',
          'status',
          'activity',
          'counters',
          'relation',
          'verified',
          'is_closed',
          'can_access_closed'
        ].join(',')
      });

      if (!users || users.length === 0) {
        await context.send(
          '❌ Пользователь не найден.'
        );

        return;
      }

      const user = users[0];

      if (user.deactivated) {
        const deactivatedStatus =
          user.deactivated === 'deleted'
            ? 'Страница удалена'
            : 'Страница заблокирована';

        await context.send(
          '🔎 Анализ страницы\n\n' +
          `👤 Пользователь: ${user.first_name} ${user.last_name}\n` +
          `🆔 ID: ${user.id}\n` +
          `⛔ Статус: ${deactivatedStatus}`
        );

        return;
      }

      const fullName =
        `${user.first_name} ${user.last_name}`;

      const screenName =
        user.screen_name || `id${user.id}`;

      const isOnline = user.online === 1;

      const onlineText = isOnline
        ? '🟢 Онлайн'
        : '⚫ Не в сети';

      let lastSeenText = 'Неизвестно';
      let platformText = 'Неизвестно';

      if (user.last_seen) {
        lastSeenText = formatUnixDate(
          user.last_seen.time
        );

        platformText = getPlatformName(
          user.last_seen.platform
        );
      }

      const city =
        user.city?.title || 'Не указан';

      const country =
        user.country?.title || 'Не указана';

      const birthDate =
        user.bdate || 'Не указана';

      const status =
        user.status ||
        user.activity ||
        'Не указан';

      const friendsCount =
        user.counters?.friends !== undefined
          ? user.counters.friends
          : 'Скрыто';

      const followersCount =
        user.counters?.followers !== undefined
          ? user.counters.followers
          : 'Скрыто';

      const photosCount =
        user.counters?.photos !== undefined
          ? user.counters.photos
          : 'Скрыто';

      const videosCount =
        user.counters?.videos !== undefined
          ? user.counters.videos
          : 'Скрыто';

      const groupsCount =
        user.counters?.groups !== undefined
          ? user.counters.groups
          : 'Скрыто';

      const pageAccess =
        user.is_closed &&
        !user.can_access_closed
          ? '🔒 Закрытая'
          : '🔓 Открытая';

      const verifiedText =
        user.verified === 1
          ? '✅ Да'
          : '❌ Нет';

      const message =
        '🔎 Анализ страницы\n\n' +
        `👤 Имя: ${fullName}\n` +
        `🆔 VK ID: ${user.id}\n` +
        `🔗 Страница: vk.com/${screenName}\n` +
        `📄 Тип страницы: ${pageAccess}\n` +
        `✔ Верифицирована: ${verifiedText}\n\n` +

        `📡 Статус сети: ${onlineText}\n` +
        `🕒 Последний онлайн: ${
          isOnline ? 'Сейчас' : lastSeenText
        }\n` +
        `📱 Устройство: ${platformText}\n\n` +

        `🚻 Пол: ${getSexName(user.sex)}\n` +
        `🎂 Дата рождения: ${birthDate}\n` +
        `❤️ Семейное положение: ${
          getRelationName(user.relation)
        }\n` +
        `🏙 Город: ${city}\n` +
        `🌍 Страна: ${country}\n` +
        `💬 Статус: ${status}\n\n` +

        `👥 Друзья: ${friendsCount}\n` +
        `👤 Подписчики: ${followersCount}\n` +
        `📷 Фотографии: ${photosCount}\n` +
        `🎬 Видео: ${videosCount}\n` +
        `👨‍👩‍👧‍👦 Сообщества: ${groupsCount}`;

      await context.send(message);

      return;
    } catch (error) {
      console.error(
        'Ошибка анализа страницы:',
        error
      );

      await context.send(
        '❌ Не удалось проанализировать страницу.\n\n' +
        'Проверь ссылку или короткое имя пользователя.'
      );

      return;
    }
  }

  /*
   * Пользователь не написал вопрос после команды.
   */
  if (/^!zaff\s+стоит\s+ли\s*$/i.test(originalText)) {
    await context.send(
      '❌ После команды напиши вопрос.'
    );

    return;
  }

  /*
   * Команда !zaff стоит ли...
   */
  const zaffMatch = originalText.match(
    /^!zaff\s+стоит\s+ли\s+(.+)/i
  );

  if (zaffMatch) {
    const answers = [
      '🤓 Думаю, да!',
      '😕 Сомневаюсь...',
      '😕 Нет))',
      '😏 Определённо!',
      '😯 Лучше не стоит.',
      '🤙 Рискни.',
      '👀 Не сегодня.',
      '😺 Безусловно!',
      '😨 Очень плохая идея.',
      '😏 Почему бы и нет?',
      '💀 Я бы отказался.',
      '🔥 Это будет легендарно!',
      '🙃 Потом не говори, что я не предупреждал.',
      '🫡 Делай, если не боишься последствий.',
      '🤔 50 на 50.',
      '🚫 Даже не думай.',
      '✅ Однозначно стоит.'
    ];

    const randomAnswer =
      answers[
        Math.floor(Math.random() * answers.length)
      ];

    await context.send(randomAnswer);

    return;
  }

  return next();
});

vk.updates.on('error', (error) => {
  console.error(
    'Ошибка VK Long Poll:',
    error
  );
});

async function startBot() {
  await initializeDatabase();

  await vk.updates.start();

  console.log(
    'VK-бот запущен и слушает сообщения.'
  );
}

startBot().catch((error) => {
  console.error(
    'Не удалось запустить бота:',
    error
  );

  process.exit(1);
});