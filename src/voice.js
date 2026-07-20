const axios = require('axios');
const googleTts = require('google-tts-api');

const MAX_VOICE_TEXT_LENGTH = 200;

async function createVoiceAttachment({
  vk,
  peerId,
  text
}) {
  const safeText = String(text ?? '').trim();
  const safePeerId = Number(peerId);

  if (!safeText) {
    throw new Error(
      'Текст голосового сообщения пуст'
    );
  }

  if (
    safeText.length >
    MAX_VOICE_TEXT_LENGTH
  ) {
    throw new Error(
      `Максимум ${MAX_VOICE_TEXT_LENGTH} символов`
    );
  }

  if (!Number.isInteger(safePeerId)) {
    throw new Error(
      'Некорректный получатель голосового сообщения'
    );
  }

  const audioUrl = googleTts.getAudioUrl(
    safeText,
    {
      lang: 'ru',
      slow: false,
      host: 'https://translate.google.com'
    }
  );
  const response = await axios.get(audioUrl, {
    responseType: 'arraybuffer',
    timeout: 20000
  });
  const audio = Buffer.from(response.data);

  if (audio.length === 0) {
    throw new Error(
      'Google TTS вернул пустой файл'
    );
  }

  return vk.upload.audioMessage({
    peer_id: safePeerId,
    source: {
      value: audio,
      filename: 'zaffron-voice.mp3',
      contentType: 'audio/mpeg'
    }
  });
}

module.exports = {
  MAX_VOICE_TEXT_LENGTH,
  createVoiceAttachment
};
