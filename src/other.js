const QRCode = require('qrcode');

/*
 * other.js
 *
 * Раздел «Прочее».
 *
 * Команды:
 * !qr <текст или ссылка>
 * !qr — ответом на сообщение
 */

const QR_MAX_LENGTH = 1500;
const QR_UPLOAD_ATTEMPTS = 3;

function wait(milliseconds) {
  return new Promise(resolve =>
    setTimeout(resolve, milliseconds)
  );
}

function getReplyText(context) {
  const reply =
    context.replyMessage;

  if (!reply) {
    return '';
  }

  return String(
    reply.text ??
    reply.message ??
    ''
  ).trim();
}

function isEmptyPhotoError(error) {
  return (
    Number(error?.code) === 100 &&
    String(
      error?.message ??
      error
    )
      .toLowerCase()
      .includes('photo is undefined')
  );
}

async function uploadQrWithRetry(
  vk,
  peerId,
  imageBuffer
) {
  let lastError = null;

  for (
    let attempt = 1;
    attempt <= QR_UPLOAD_ATTEMPTS;
    attempt++
  ) {
    try {
      return await vk.upload.messagePhoto({
        peer_id: peerId,

        source: {
          value: imageBuffer,
          filename: 'qr-code.png',
          contentType: 'image/png'
        }
      });
    } catch (error) {
      lastError = error;

      if (
        !isEmptyPhotoError(error) ||
        attempt >= QR_UPLOAD_ATTEMPTS
      ) {
        throw error;
      }

      console.warn(
        `VK вернул пустой photo при загрузке QR. ` +
        `Попытка ${attempt + 1}/${QR_UPLOAD_ATTEMPTS}`
      );

      await wait(
        attempt * 1200
      );
    }
  }

  throw lastError;
}

async function createQrBuffer(text) {
  return QRCode.toBuffer(
    text,
    {
      type: 'png',
      width: 900,
      margin: 3,
      errorCorrectionLevel: 'M'
    }
  );
}

async function handleQr(
  context,
  vk,
  rawText
) {
  const argumentText =
    String(rawText ?? '')
      .trim();

  const replyText =
    getReplyText(context);

  const qrText =
    argumentText ||
    replyText;

  if (!qrText) {
    await context.reply(
      '❌ Укажи текст или ссылку для QR-кода.\n\n' +
      'Пример:\n' +
      '!qr https://vk.com\n\n' +
      'Также можно ответить командой !qr ' +
      'на нужное сообщение.'
    );

    return true;
  }

  if (
    qrText.length >
    QR_MAX_LENGTH
  ) {
    await context.reply(
      '❌ Слишком длинный текст.\n\n' +
      `Максимум: ${QR_MAX_LENGTH} символов.\n` +
      `Сейчас: ${qrText.length}`
    );

    return true;
  }

  try {
    const imageBuffer =
      await createQrBuffer(
        qrText
      );

    if (
      !Buffer.isBuffer(imageBuffer) ||
      imageBuffer.length === 0
    ) {
      throw new Error(
        'Библиотека вернула пустое изображение QR-кода'
      );
    }

    const photo =
      await uploadQrWithRetry(
        vk,
        Number(context.peerId),
        imageBuffer
      );

    await context.send({
      message:
        '✅ QR-код готов.',

      attachment:
        photo
    });

    return true;
  } catch (error) {
    console.error(
      'Ошибка создания QR-кода:',
      error
    );

    await context.reply(
      '❌ Не удалось создать или загрузить QR-код.\n\n' +
      'Попробуй ещё раз немного позже.'
    );

    return true;
  }
}

async function handle(
  context,
  vk
) {
  const originalText =
    String(context.text ?? '')
      .trim();

  const qrMatch =
    originalText.match(
      /^!qr(?:\s+([\s\S]+))?$/i
    );

  if (qrMatch) {
    return handleQr(
      context,
      vk,
      qrMatch[1]
    );
  }

  return false;
}

module.exports = {
  handle
};
