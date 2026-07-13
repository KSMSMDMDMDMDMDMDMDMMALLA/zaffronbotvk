const sharp = require('sharp');
const axios = require('axios');
const FormData = require('form-data');

/*
 * Ожидание фотографии хранится отдельно для каждого:
 * peerId — конкретная беседа или ЛС
 * senderId — конкретный пользователь
 */

let uploadQueue = Promise.resolve();

const processingUsers = new Set();

function getProcessingKey(context) {
  return `${context.peerId}:${context.senderId}`;
}

function enqueueUpload(task) {
  const result = uploadQueue.then(task, task);

  uploadQueue = result.catch(() => {});

  return result;
}

function wait(milliseconds) {
  return new Promise(resolve =>
    setTimeout(resolve, milliseconds)
  );
}


const memeSessions = new Map();

const SESSION_LIFETIME = 5 * 60 * 1000;

const captions = [
    '67 ХУЕВ В ЖОПУ:',
    'КОГДА ПОНЯЛ ЧТО У ТЕБЯ 67 ХРОМОСОМ:',
    'ПЕРНУЛ И ЗАНЮХНУЛ:',
    'Я ХУЕГЛОТ:',
    '67 ИЗ 10 ВРАЧЕЙ УШЛИ',
    'КОГДА ПОНЯЛ ЧТО У ТЕБЯ 67 ХРОМОСОМ:',
    'ПЕРНУЛ И ЗАНЮХНУЛ:',
    'Я ХУЕГЛОТ:',
    'МОЗГ ВЫШЕЛ ПОКУРИТЬ:',
    'БРАТ ПРОДАЛ ДУШУ ЗА ШАУРМУ:',
    'СЪЕЛ ОБОИ И ДОВОЛЕН:',
    'КОГДА ГОЛОВОЙ ОБ БАТАРЕЮ:',
    'ЗУБАМИ ПО БОРДЮРУ:',
    'ВЫПИЛ ВОДУ И ЗАБЕРЕМЕНЕЛ:',
    'РОДИЛСЯ ПО ОШИБКЕ:',
    'КОГДА МАТЬ СКАЗАЛА «МОЛОДЕЦ»:',
    'ПРОИГРАЛ ТАБУРЕТКЕ:',
    'СЪЕЛ СУП ВИЛКОЙ:',
    'МЕНЯ ВОСПИТЫВАЛИ ГОЛУБИ:',
    'ПАПА ВЕРНУЛСЯ... НЕ КО МНЕ:',
    'БРАТ НАШЁЛ WIFI В ЛЕСУ:',
    'КОГДА IQ НИЖЕ ПИНГА:',
    'ДВАЖДЫ РОДИЛСЯ:',
    'СЛОМАЛ ЛОЖКУ ОБ КИСЕЛЬ:',
    'ПРОИГРАЛ СОБАКЕ В ШАХМАТЫ:',
    'ПЕРЕПУТАЛ МЫЛО С ДОШИКОМ:',
    'Я ПОСЛЕ УКУСА АСФАЛЬТА:',
    'КОГДА ПЕЛЬМЕНИ НАЧАЛИ РАЗГОВАРИВАТЬ:',
    '67 ПРИЧИН НЕ ПРОСЫПАТЬСЯ:',
    'ОТКУСИЛ УКУС:',
    'СЪЕЛ ПУЛЬТ ОТ ТЕЛЕВИЗОРА:',
    'ПОДЫШАЛ КЛЕЕМ ДЛЯ РАЗВИТИЯ:',
    'ВРАЧ ЗАПЛАКАЛ:',
    'ДАЖЕ ЧАЙНИК В АХУЕ:',
    'РОДИТЕЛИ СПРЯТАЛИ ЧЕК:',
    'МЕНЯ НЕ БЕРУТ ДАЖЕ В ЦИРК:',
    'КОГДА ДУМАЕШЬ ЗАДНИЦЕЙ:',
    'СЪЕЛ 67 КИРПИЧЕЙ:',
    'ПРОДАЛ ПОЧКУ ЗА ЭНЕРГЕТИК:',
    'ВЫИГРАЛ ПРЕМИЮ «ГЛАВНЫЙ ДОЛБОЁБ»:',
    'Я ПОСЛЕ 40 РИЛСОВ БЕЗ СНА:',
    'СЪЕЛ SIM-КАРТУ:',
    'КОГДА ГОЛУБЬ НАЗВАЛ ТЕБЯ ЛОХОМ:',
    'ПРОСТО ЕБАНУЛСЯ:',
    'КОГДА КИРПИЧ НАЧАЛ ЛАЯТЬ:',
    'МОЙ ХОЛОДИЛЬНИК ПОСТУПИЛ В УНИВЕР:',
    '67 ПЕЛЬМЕНЕЙ ПРОТИВ МЕНЯ:',
    'СЪЕЛ БУДИЛЬНИК И ПРОСПАЛ:',
    'ПОДРУЖИЛСЯ С МИКРОВОЛНОВКОЙ:',
    'КОМАР ВЫПИСАЛ МНЕ ШТРАФ:',
    'МОЙ НОСОК УШЁЛ В ПОЛИТИКУ:',
    'ТРИ ДНЯ СПОРИЛ С ЛИФТОМ:',
    'ПРОИГРАЛ КУСКУ ОБОЕВ:',
    'КОГДА КОВЁР ПОЛУЧИЛ ВОДИТЕЛЬСКИЕ ПРАВА:',
    'ТАПОК ПРЕДАЛ СЕМЬЮ:',
    'СТУЛ ОФОРМИЛ ИПОТЕКУ:',
    'ДЫШАЛ СЛИШКОМ ПРОФЕССИОНАЛЬНО:',
    'МОЯ ТЕНЬ УШЛА К СОСЕДУ:',
    'СЪЕЛ WIFI ДЛЯ СКОРОСТИ:',
    'ПРОСТО ПОСМОТРЕЛ НА ЛУК:',
    '67 ГОЛУБЕЙ ВЫБРАЛИ МЕНЯ:',
    'МОЙ ЧАЙ ПОДАЛ НА РАЗВОД:',
    'ПЕЛЬМЕНИ ПЕРЕШЛИ НА МОЮ СТОРОНУ:',
    'ВИЛКА СТАЛА МОИМ НАСТАВНИКОМ:',
    'АСФАЛЬТ ПОПРОСИЛ АВТОГРАФ:',
    'ПОДУШКА НАЧАЛА ТОРГОВАТЬ АКЦИЯМИ:',
    'МОЙ ЧАЙНИК ЗНАЕТ СЛИШКОМ МНОГО:',
    'СЪЕЛ ЗАРЯДКУ, ЧТОБЫ ЗАРЯДИТЬСЯ:',
    'ПАКЕТ СКАЗАЛ «НЕ СЕГОДНЯ»:',
    'ЛАМПОЧКА УВОЛИЛА СОЛНЦЕ:',
    'МОЯ ДВЕРЬ СМЕНИЛА ПАРОЛЬ:',
    'КОМПОТ ВЫИГРАЛ ЕВРО:',
    'ШКАФ ПЕРЕЕХАЛ БЕЗ МЕНЯ:',
    'Я ПРОТИВ ГРАВИТАЦИИ 0:15:',
    'МОЙ БАЛКОН ЗАПИСАЛСЯ В СПОРТЗАЛ:',
    'ТЕЛЕВИЗОР НАЧАЛ МОРГАТЬ АЗБУКОЙ:',
    'МЫЛО ПРОШЛО СОБЕСЕДОВАНИЕ:',
    'НОЖНИЦЫ СТАЛИ ВЕГАНАМИ:',
    'БАТАРЕЙКА ЗАБЫЛА ЧТО ОНА БАТАРЕЙКА:',
    '67 КАРТОШЕК НА ОДНОГО ЧЕЛОВЕКА:',
    'КОГДА СОСИСКА ПОТРЕБОВАЛА ПАСПОРТ:',
    'МОЙ РЮКЗАК НАЧАЛ ДЫШАТЬ:',
    'ХЛЕБ ПОСТАВИЛ МНЕ ДИЗЛАЙК:',
    'ПЫЛЕСОС ОТКАЗАЛСЯ ПЫЛЕСОСИТЬ:',
    'ТУФЛЯ ЗАБЛОКИРОВАЛА НОГУ:',
    'ЧЕТЫРЕ ЛОЖКИ ОДНА МЕЧТА:',
    'ХОМЯК ОТКРЫЛ НАЛОГОВУЮ:',
    'БАНАН ПРОШЁЛ FACE ID:',
    'ТАПОК СТАЛ МИЛЛИАРДЕРОМ:',
    'ВЕНТИЛЯТОР УСТАЛ КРУТИТЬСЯ:',
    'МОЯ КРУЖКА ВЫУЧИЛА КИТАЙСКИЙ:',
    'ПЕЛЬМЕНЬ ОТКРЫЛ БРАУЗЕР:',
    'КОГДА КОМАР НАЧАЛ ИНВЕСТИРОВАТЬ:',
    '67 СЕКУНД БЕЗ КОНТЕКСТА:',
    'МОЙ БОРЩ УШЁЛ В АРМИЮ:',
    'ПРОИГРАЛ ОБЛАКУ:',
    'КОЛБАСА ПЕРЕПИСАЛА КОНСТИТУЦИЮ:',
    'Я УСНУЛ ДО ТОГО КАК ПРОСНУЛСЯ:',
    'МОЙ КАЛЬКУЛЯТОР СТАЛ ПОЭТОМ:',
    'ТРИ ЧАЙНИКА ОДИН ВОПРОС:',
    'КОГДА ХЛЕБ ПОДМИГНУЛ:',
    'Я СЛУЧАЙНО ОБОГНАЛ ВЧЕРА:',
    'МЕНЯ ОПЕРЕДИЛА КАПУСТА:',
    'СТУЛ ПОПРОСИЛ НЕ САДИТЬСЯ:',
    '67 РАЗ ПОДУМАЛ И НЕ ПОЛУЧИЛОСЬ:',
    'ДА ЭТО ПОЛНЫЙ ПИЗДЕЦ:',
    'Я ВООБЩЕ ОХУЕЛ:',
    'КТО ЭТУ ХУЙНЮ ПРИДУМАЛ:',
    'БРАТ, ТЫ ЧЕГО НАХУЙ:',
    'Я ЕБАЛ ТАКОЙ СЮЖЕТ:',
    'ВСЁ ПОШЛО ПО ПИЗДЕ:',
    'ЭТО КАКАЯ-ТО ХУЙНЯ:',
    'ОПЯТЬ ЭТА ЕБАНИНА:',
    'Я В АХУЕ С ПРОИСХОДЯЩЕГО:',
    'БЛЯТЬ, НУ НЕ ТАК ЖЕ:',
    'КТО ВЫПУСТИЛ ЭТО В ПРОД:',
    'Я СЕЙЧАС СЛОМАЮСЬ НАХУЙ:',
    'МОЙ МОЗГ СКАЗАЛ «ИДИ НАХУЙ»:',
    'ЭТО ПИЗДЕЦ В КВАДРАТЕ:',
    'У МЕНЯ НЕТ СЛОВ, ОДНИ МАТЫ:',
    'ДАЖЕ ХОЛОДИЛЬНИК ОХУЕЛ:',
    'БЛЯ, ДА КАК ТАК-ТО:',
    'НУ ЭТО УЖЕ ЕБАНЫЙ ЦИРК:',
    'Я НЕ ВЫВОЖУ ЭТУ ХУЙНЮ:',
    'МОЙ ПОСЛЕДНИЙ НЕЙРОН СДОХ:',
    'БЛЯТЬ, ДА НУ НАХУЙ:',
    'КАКОГО ХУЯ ПРОИСХОДИТ:',
    'Я ЕБАЛ ЭТУ ФИЗИКУ:',
    'НУ ЭТО ПИЗДЕЦ:',
    'Я БОЛЬШЕ НЕ МОГУ НАХУЙ:',
    'МОЙ МОЗГ САМОВЫПИЛИЛСЯ:',
    'Я ЩАС ЕБАНУСЬ:',
    'БРАТ, ЭТО ЧТО ЗА ХУЙНЯ:',
    'ЕБАТЬ ОНО ЖИВОЕ:',
    'ЭТО УЖЕ НЕ ЛЕЧИТСЯ:',
    'ДА ВЫ ГОНИТЕ НАХУЙ:',
    'Я СЕЙЧАС ВЫЙДУ ИЗ ЧАТА НАВСЕГДА:',
    'МОЙ ПОСЛЕДНИЙ НЕЙРОН ПОКИНУЛ СЕРВЕР:',
    'Я ПРОСТО ОХУЕЛ:',
    'КАК ЭТО ВООБЩЕ РАБОТАЕТ НАХУЙ:',
    'НУ И НАХУЯ:',
    'ЕБАНЫЙ КОСМОС:',
    'ПРОИЗОШЛА ЕБАНИНА:',
    'МОЙ ПЛАН РАЗЪЕБАЛСЯ ОБ ПОЛ:',
    'Я СЛОМАЛСЯ РАНЬШЕ ЧЕМ КОД:',
    'КТО-ТО ОПЯТЬ НАЖАЛ НЕ ТУ КНОПКУ:',
    'ДАЖЕ ТАРАКАН ОХУЕЛ:',
    'Я В АХУЕ СО ВЧЕРА:',
    'ПРОСНУЛСЯ И УЖЕ ПИЗДЕЦ:',
    'СЮЖЕТ ПОШЁЛ ПО ХУЯМ:',
    'Я СЛУЧАЙНО ВЫЖИЛ:',
    'БЛЯТЬ, НУ НЕ ТАК ЖЕ:',
    'МОЙ WIFI СКАЗАЛ «ПОШЁЛ НАХУЙ»:',
    'КОФЕ ТОЖЕ НЕ СПРАВИЛСЯ:',
    'МОЙ ДЕНЬ НАЧАЛСЯ С ПИЗДЕЦА:',
    'ЭТО БЫЛА ФАТАЛЬНАЯ ЕБАНИНА:',
    'Я ПРОТИВ РЕАЛЬНОСТИ 1 НА 1:',
    'МОЗГ ЗАКРЫЛСЯ ПО ТЕХНИЧЕСКИМ ПРИЧИНАМ:',
    'ДА КАКОЙ ЖЕ ЭТО ПИЗДЕЦ:',
    'ЖИЗНЬ РЕШИЛА ПОРОФЛИТЬ:',
    'КТО ВООБЩЕ ЭТО СОБРАЛ НАХУЙ:',
    'МНЕ УЖЕ ПОХУЙ:',
    'ПОХОЖЕ ВСЁ:',
    'Я СЛИШКОМ ДОЛГО СМОТРЕЛ В ПУСТОТУ:',
    'МОЙ ДЕНЬ ПОШЁЛ В РЕЖИМ «ЕБАНИНА»:',
    'ЭТОТ ДЕНЬ МОЖНО УДАЛЯТЬ:',
    'НУ ВСЁ, ФИНАЛОЧКА:',
    'ДАЖЕ ПИНГ ОХУЕЛ:',
    'СИСТЕМА СКАЗАЛА «НУ ИДИ НАХУЙ»:',
    'БЛЯ, КАК ЖЕ Я ЛЮБЛЮ ЭТОТ ЦИРК:',
    'РЕАЛЬНОСТЬ ОПЯТЬ ЗАБАГОВАЛАСЬ:',
    'КОДЕР УМЕР, КОД ОСТАЛСЯ:',
    'ПЕРЕЗАПУСК МОЗГА НЕ ПОМОГ:',
    'МНЕ КАЖЕТСЯ ИЛИ ЭТО ПОЛНАЯ ХУЙНЯ:',
    'ЗАНАВЕС.'
];

function getSessionKey(context) {
  return `${context.peerId}:${context.senderId}`;
}

function createSession(context) {
  const key = getSessionKey(context);

  memeSessions.set(key, {
    createdAt: Date.now()
  });

  setTimeout(() => {
    const session = memeSessions.get(key);

    if (
      session &&
      Date.now() - session.createdAt >= SESSION_LIFETIME
    ) {
      memeSessions.delete(key);
    }
  }, SESSION_LIFETIME + 1000);
}

function hasSession(context) {
  const key = getSessionKey(context);
  const session = memeSessions.get(key);

  if (!session) {
    return false;
  }

  if (
    Date.now() - session.createdAt >
    SESSION_LIFETIME
  ) {
    memeSessions.delete(key);
    return false;
  }

  return true;
}

function deleteSession(context) {
  memeSessions.delete(
    getSessionKey(context)
  );
}

function getRandomCaption() {
  return captions[
    Math.floor(Math.random() * captions.length)
  ];
}

function getPhotoUrl(photo) {
  if (photo.largeSizeUrl) {
    return photo.largeSizeUrl;
  }

  if (
    Array.isArray(photo.sizes) &&
    photo.sizes.length > 0
  ) {
    const sizes = [...photo.sizes].sort(
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

    return sizes[0]?.url || null;
  }

  return (
    photo.mediumSizeUrl ||
    photo.smallSizeUrl ||
    null
  );
}

async function downloadPhoto(url) {
  if (!url) {
    throw new Error(
      'У фотографии отсутствует ссылка'
    );
  }

  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 60000,

        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          Accept: 'image/*,*/*;q=0.8'
        },

        maxContentLength: 25 * 1024 * 1024,
        maxBodyLength: 25 * 1024 * 1024
      });

      const buffer = Buffer.from(
        response.data
      );

      if (buffer.length === 0) {
        throw new Error(
          'Фотография получена пустой'
        );
      }

      return buffer;
    } catch (error) {
      lastError = error;

      await new Promise(resolve =>
        setTimeout(resolve, attempt * 1000)
      );
    }
  }

  throw lastError || new Error(
    'Не удалось скачать фотографию'
  );
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapText(text, maxLength = 24) {
  const words = text.split(/\s+/);
  const lines = [];

  let currentLine = '';

  for (const word of words) {
    const candidate = currentLine
      ? `${currentLine} ${word}`
      : word;

    if (
      candidate.length > maxLength &&
      currentLine
    ) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = candidate;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.slice(0, 4);
}

async function createMeme(
  inputBuffer,
  caption
) {
  const targetWidth = 900;

  const resizedImage = await sharp(inputBuffer)
    .rotate()
    .resize({
      width: targetWidth,
      withoutEnlargement: false
    })
    .jpeg({
      quality: 88
    })
    .toBuffer();

  const metadata = await sharp(
    resizedImage
  ).metadata();

  const imageHeight =
    metadata.height || 700;

  const lines = wrapText(caption);
  const fontSize =
    lines.length >= 3 ? 46 : 54;

  const lineHeight = fontSize + 12;

  const captionHeight = Math.max(
    150,
    lines.length * lineHeight + 60
  );

  const textSvg = `
    <svg
      width="${targetWidth}"
      height="${captionHeight}"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        width="100%"
        height="100%"
        fill="#000000"
      />

      <text
        x="50%"
        y="50%"
        text-anchor="middle"
        dominant-baseline="middle"
        font-family="Arial, DejaVu Sans, sans-serif"
        font-size="${fontSize}"
        font-weight="700"
        fill="#ffffff"
      >
        ${lines.map((line, index) => {
          const offset =
            (index - (lines.length - 1) / 2) *
            lineHeight;

          return `
            <tspan
              x="50%"
              dy="${index === 0 ? offset : lineHeight}"
            >
              ${escapeXml(line)}
            </tspan>
          `;
        }).join('')}
      </text>
    </svg>
  `;

  return sharp({
    create: {
      width: targetWidth,
      height:
        captionHeight +
        imageHeight,
      channels: 3,

      background: {
        r: 0,
        g: 0,
        b: 0
      }
    }
  })
    .composite([
      {
        input: Buffer.from(textSvg),
        top: 0,
        left: 0
      },
      {
        input: resizedImage,
        top: captionHeight,
        left: 0
      }
    ])
    .jpeg({
      quality: 88
    })
    .toBuffer();
}

async function uploadPhoto(vk, peerId, buffer) {
  if (
    !Buffer.isBuffer(buffer) ||
    buffer.length === 0
  ) {
    throw new Error(
      'Готовый мем пустой'
    );
  }

  return enqueueUpload(async () => {
    let lastError = null;

    for (
      let attempt = 1;
      attempt <= 4;
      attempt++
    ) {
      try {
        /*
         * Сервер загрузки получаем заново
         * перед каждой попыткой.
         */
        const uploadServer =
          await vk.api.photos.getMessagesUploadServer({
            peer_id: peerId
          });

        if (!uploadServer?.upload_url) {
          throw new Error(
            'VK не вернул сервер загрузки'
          );
        }

        /*
         * FormData обязательно создаётся заново
         * для каждой попытки.
         */
        const form = new FormData();

        form.append(
          'photo',
          buffer,
          {
            filename:
              `zaffron-meme-${Date.now()}.jpg`,

            contentType: 'image/jpeg',
            knownLength: buffer.length
          }
        );

        const headers = {
          ...form.getHeaders(),
          'Content-Length':
            await new Promise(
              (resolve, reject) => {
                form.getLength(
                  (error, length) => {
                    if (error) {
                      reject(error);
                      return;
                    }

                    resolve(length);
                  }
                );
              }
            )
        };

        const uploadResponse =
          await axios.post(
            uploadServer.upload_url,
            form,
            {
              headers,
              timeout: 120000,
              maxContentLength: Infinity,
              maxBodyLength: Infinity,

              validateStatus: status =>
                status >= 200 &&
                status < 500
            }
          );

        const uploadData =
          uploadResponse.data;

        console.log(
          `Загрузка мема, попытка ${attempt}:`,
          uploadData
        );

        if (
          !uploadData?.server ||
          !uploadData?.photo ||
          !uploadData?.hash
        ) {
          throw new Error(
            'VK вернул неполные данные загрузки: ' +
            JSON.stringify(uploadData)
          );
        }

        /*
         * Иногда VK возвращает пустую строку
         * или пустой массив в параметре photo.
         */
        if (
          uploadData.photo === '' ||
          uploadData.photo === '[]'
        ) {
          throw new Error(
            'VK вернул пустое поле photo'
          );
        }

        const savedPhotos =
          await vk.api.photos.saveMessagesPhoto({
            server: uploadData.server,
            photo: uploadData.photo,
            hash: uploadData.hash
          });

        const savedPhoto =
          savedPhotos?.[0];

        if (
          !savedPhoto?.owner_id ||
          !savedPhoto?.id
        ) {
          throw new Error(
            'VK не сохранил готовый мем'
          );
        }

        let attachment =
          `photo${savedPhoto.owner_id}_${savedPhoto.id}`;

        if (savedPhoto.access_key) {
          attachment +=
            `_${savedPhoto.access_key}`;
        }

        return attachment;
      } catch (error) {
        lastError = error;

        console.error(
          `Ошибка загрузки мема, попытка ${attempt}:`,
          error.message
        );

        if (attempt < 4) {
          await wait(
            attempt * 2000
          );
        }
      }
    }

    throw new Error(
      'VK не принял готовый мем после 4 попыток: ' +
      (lastError?.message || 'неизвестная ошибка')
    );
  });
}

async function handle(context, vk) {
  const originalText =
    String(context.text ?? '').trim();

  // !мем
  if (/^!мем$/i.test(originalText)) {
    createSession(context);

    await context.reply(
      '🖼 Отправь фотографию следующим сообщением.\n\n' +
      'Я добавлю к ней случайную мемную подпись.\n' +
      '⏳ Ожидание действует ~15 секунд.'
    );

    return true;
  }

  // Пользователь не запускал !мем
  if (!hasSession(context)) {
    return false;
  }

  // Ждём именно фотографию
  if (!context.hasAttachments('photo')) {
    return false;
  }

  const photo = context.attachments.find(
    attachment => attachment.type === 'photo'
  );

  if (!photo) {
    return false;
  }

  const processingKey =
    getProcessingKey(context);

  if (processingUsers.has(processingKey)) {
    await context.reply(
      '⏳ Твой мем уже создаётся. Подожди немного.'
    );

    return true;
  }

  processingUsers.add(processingKey);
  deleteSession(context);

  try {
    await context.reply(
      '⏳ Создаю мем...'
    );

    const photoUrl =
      getPhotoUrl(photo);

    if (!photoUrl) {
      throw new Error(
        'Не удалось получить ссылку на фото'
      );
    }

    const inputBuffer =
      await downloadPhoto(photoUrl);

    const caption =
      getRandomCaption();

    const outputBuffer =
      await createMeme(
        inputBuffer,
        caption
      );

    const attachment =
      await uploadPhoto(
        vk,
        context.peerId,
        outputBuffer
      );

    await context.reply({
      message: '😂 Мем готов',
      attachment
    });

    return true;
  } catch (error) {
    console.error(
      'Ошибка мемогенератора:',
      error
    );

    await context.reply(
      '❌ Не удалось создать мем.\n' +
      'Напиши !мем и попробуй ещё раз.'
    );

    return true;
  } finally {
    processingUsers.delete(
      processingKey
    );

    console.log(
      'Мем-обработка завершена:',
      processingKey
    );
  }
}

module.exports = {
  handle
};