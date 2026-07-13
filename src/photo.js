const sharp = require('sharp');
const axios = require('axios');
const { Keyboard } = require('vk-io');

const sessions = new Map();
const processingUsers = new Set();
const FormData = require('form-data');

const PHOTO_COMMANDS = new Set([
  'photo_kek',
  'photo_fire',
  'photo_vhs',
  'photo_bw',
  'photo_destroy',
  'photo_jmy',
  'photo_frame',
  'photo_negative',
  'photo_blur'
]);

function savePhoto(userId, photo) {
  sessions.set(userId, photo);
}

function getPhoto(userId) {
  return sessions.get(userId);
}

function getPhotoUrls(photo) {
  const urls = [];

  if (photo.largeSizeUrl) {
    urls.push(photo.largeSizeUrl);
  }

  if (photo.mediumSizeUrl) {
    urls.push(photo.mediumSizeUrl);
  }

  if (Array.isArray(photo.sizes)) {
    const sortedSizes = [...photo.sizes].sort((a, b) => {
      const areaA =
        Number(a.width || 0) *
        Number(a.height || 0);

      const areaB =
        Number(b.width || 0) *
        Number(b.height || 0);

      return areaB - areaA;
    });

    for (const size of sortedSizes) {
      if (size?.url) {
        urls.push(size.url);
      }
    }
  }

  if (photo.smallSizeUrl) {
    urls.push(photo.smallSizeUrl);
  }

  return [...new Set(urls)];
}



async function downloadPhoto(urls) {
  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error('Нет ссылок на фотографию');
  }

  let lastError;

  for (const url of urls) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 60000,
          maxContentLength: 25 * 1024 * 1024,
          maxBodyLength: 25 * 1024 * 1024
        });

        const buffer = Buffer.from(response.data);

        if (buffer.length === 0) {
          throw new Error('Фотография пустая');
        }

        return buffer;
      } catch (error) {
        lastError = error;

        await new Promise(resolve =>
          setTimeout(resolve, attempt * 1000)
        );
      }
    }
  }

  throw lastError || new Error('Не удалось скачать фото');
}



async function makeKek(input) {
  const metadata = await sharp(input).metadata();

  const width = Math.max(
    1,
    Math.round((metadata.width || 600) * 1.35)
  );

  const height = Math.max(
    1,
    metadata.height || 600
  );

  return sharp(input)
    .rotate()
    .resize(width, height, {
      fit: 'fill'
    })
    .flop()
    .modulate({
      saturation: 2.2,
      brightness: 1.15
    })
    .jpeg({
      quality: 70
    })
    .toBuffer();
}

async function makeFire(input) {
  return sharp(input)
    .rotate()
    .modulate({
      saturation: 2.5,
      brightness: 1.15
    })
    .tint({
      r: 255,
      g: 100,
      b: 40
    })
    .jpeg({
      quality: 82
    })
    .toBuffer();
}

async function makeVhs(input) {
  return sharp(input)
    .rotate()
    .modulate({
      saturation: 1.6,
      brightness: 0.9
    })
    .linear(
      1.25,
      -18
    )
    .blur(0.4)
    .jpeg({
      quality: 45,
      chromaSubsampling: '4:2:0'
    })
    .toBuffer();
}

async function makeBlackAndWhite(input) {
  return sharp(input)
    .rotate()
    .grayscale()
    .normalize()
    .sharpen()
    .jpeg({
      quality: 85
    })
    .toBuffer();
}

async function makeDestroy(input) {
  const tinyImage = await sharp(input)
    .rotate()
    .resize(65, 65, {
      fit: 'fill'
    })
    .jpeg({
      quality: 3
    })
    .toBuffer();

  return sharp(tinyImage)
    .resize(700, 700, {
      fit: 'fill',
      kernel: sharp.kernel.nearest
    })
    .jpeg({
      quality: 15
    })
    .toBuffer();
}

async function makeJmy(input) {
  const tinyImage = await sharp(input)
    .rotate()
    .resize(90, 90, {
      fit: 'fill'
    })
    .jpeg({
      quality: 7
    })
    .toBuffer();

  return sharp(tinyImage)
    .resize(650, 650, {
      fit: 'fill',
      kernel: sharp.kernel.nearest
    })
    .modulate({
      saturation: 1.8
    })
    .jpeg({
      quality: 18
    })
    .toBuffer();
}

async function makeFrame(input) {
  const image = await sharp(input)
    .rotate()
    .resize(600, 600, {
      fit: 'contain',
      background: {
        r: 0,
        g: 0,
        b: 0
      }
    })
    .jpeg({
      quality: 90
    })
    .toBuffer();

  return sharp({
    create: {
      width: 680,
      height: 680,
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
        input: image,
        top: 40,
        left: 40
      }
    ])
    .jpeg({
      quality: 90
    })
    .toBuffer();
}

async function makeNegative(input) {
  return sharp(input)
    .rotate()
    .negate()
    .modulate({
      saturation: 1.3
    })
    .jpeg({
      quality: 85
    })
    .toBuffer();
}

async function makeBlur(input) {
  return sharp(input)
    .rotate()
    .blur(8)
    .jpeg({
      quality: 82
    })
    .toBuffer();
}

async function applyEffect(command, input) {
  switch (command) {
    case 'photo_kek':
      return makeKek(input);

    case 'photo_fire':
      return makeFire(input);

    case 'photo_vhs':
      return makeVhs(input);

    case 'photo_bw':
      return makeBlackAndWhite(input);

    case 'photo_destroy':
      return makeDestroy(input);

    case 'photo_jmy':
      return makeJmy(input);

    case 'photo_frame':
      return makeFrame(input);

    case 'photo_negative':
      return makeNegative(input);

    case 'photo_blur':
      return makeBlur(input);

    default:
      throw new Error(
        `Неизвестный эффект: ${command}`
      );
  }
}

function createKeyboard() {
  return Keyboard.builder()

    .textButton({
      label: '🤡 Кек',
      payload: {
        command: 'photo_kek'
      },
      color: Keyboard.SECONDARY_COLOR
    })

    .textButton({
      label: '🔥 Огонь',
      payload: {
        command: 'photo_fire'
      },
      color: Keyboard.NEGATIVE_COLOR
    })

    .row()

    .textButton({
      label: '📺 VHS',
      payload: {
        command: 'photo_vhs'
      },
      color: Keyboard.PRIMARY_COLOR
    })

    .textButton({
      label: '🗿 Ч/Б',
      payload: {
        command: 'photo_bw'
      },
      color: Keyboard.SECONDARY_COLOR
    })

    .row()

    .textButton({
      label: '💀 Уничтожить',
      payload: {
        command: 'photo_destroy'
      },
      color: Keyboard.NEGATIVE_COLOR
    })

    .textButton({
      label: '🌀 Жмы',
      payload: {
        command: 'photo_jmy'
      },
      color: Keyboard.PRIMARY_COLOR
    })

    .row()

    .textButton({
      label: '🖤 Рамка',
      payload: {
        command: 'photo_frame'
      },
      color: Keyboard.SECONDARY_COLOR
    })

    .textButton({
      label: '👻 Негатив',
      payload: {
        command: 'photo_negative'
      },
      color: Keyboard.SECONDARY_COLOR
    })

    .row()

    .textButton({
      label: '🌫 Размытие',
      payload: {
        command: 'photo_blur'
      },
      color: Keyboard.PRIMARY_COLOR
    })

    .inline();
}

async function uploadPhoto(vk, peerId, buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Изображение для загрузки пустое');
  }

  const uploadServer =
    await vk.api.photos.getMessagesUploadServer({
      peer_id: peerId
    });

  const form = new FormData();

  form.append('photo', buffer, {
    filename: 'zaffron-photo.jpg',
    contentType: 'image/jpeg',
    knownLength: buffer.length
  });

  const response = await axios.post(
    uploadServer.upload_url,
    form,
    {
      headers: form.getHeaders(),
      timeout: 120000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    }
  );

  const data = response.data;

  if (!data?.server || !data?.photo || !data?.hash) {
    throw new Error(
      `VK не принял фотографию: ${JSON.stringify(data)}`
    );
  }

  const saved = await vk.api.photos.saveMessagesPhoto({
    server: data.server,
    photo: data.photo,
    hash: data.hash
  });

  const photo = saved?.[0];

  if (!photo) {
    throw new Error('VK не сохранил фотографию');
  }

  let attachment =
    `photo${photo.owner_id}_${photo.id}`;

  if (photo.access_key) {
    attachment += `_${photo.access_key}`;
  }

  return attachment;
}

async function handle(context, vk) {
  // В беседах фотомодуль полностью молчит
  if (
    context.isChat ||
    context.peerId >= 2000000000
  ) {
    return false;
  }

  const payload = context.messagePayload;
  const command = payload?.command;

  // Пользователь отправил фото в ЛС
  if (context.hasAttachments('photo')) {
    const photo = context.attachments.find(
      attachment => attachment.type === 'photo'
    );

    if (!photo) {
      await context.send(
        '❌ Не удалось получить фотографию.'
      );

      return true;
    }

    // Сбрасываем возможную зависшую обработку
    processingUsers.delete(context.senderId);

    savePhoto(
      context.senderId,
      photo
    );

    await context.send({
      message:
        '🖼 Фото получено!\n\n' +
        'Выбери эффект:',
      keyboard: createKeyboard()
    });

    return true;
  }

  // Это не команда фотоэффекта
  if (!PHOTO_COMMANDS.has(command)) {
    return false;
  }

  // Защита от повторного нажатия
  if (processingUsers.has(context.senderId)) {
    await context.send(
      '⏳ Фото уже обрабатывается. Подожди немного.'
    );

    return true;
  }

  const photo = getPhoto(context.senderId);

  if (!photo) {
    await context.send(
      '❌ Сначала отправь фотографию.'
    );

    return true;
  }

  processingUsers.add(context.senderId);

  try {
    await context.send(
      '⏳ Обрабатываю...'
    );

    const urls = getPhotoUrls(photo);

    if (!Array.isArray(urls) || urls.length === 0) {
      throw new Error(
        'Не удалось получить ссылки на фото'
      );
    }

    const inputBuffer =
      await downloadPhoto(urls);

    const outputBuffer =
      await applyEffect(
        command,
        inputBuffer
      );

    if (
      !Buffer.isBuffer(outputBuffer) ||
      outputBuffer.length === 0
    ) {
      throw new Error(
        'Результат обработки фотографии пустой'
      );
    }

    console.log(
      `Фото обработано: ${command}; ` +
      `${outputBuffer.length} байт`
    );

    const attachment =
      await uploadPhoto(
        vk,
        context.peerId,
        outputBuffer
      );

    await context.send({
      message: '🔥 Готово',
      attachment
    });

    return true;
  } catch (error) {
    console.error(
      'Ошибка фото:',
      error
    );

    await context.send(
      '❌ Не смог обработать фотографию.'
    );

    return true;
  } finally {
    processingUsers.delete(
      context.senderId
    );
  }
}

module.exports = {
  handle
};