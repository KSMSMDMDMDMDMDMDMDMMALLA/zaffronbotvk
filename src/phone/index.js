const crypto = require('node:crypto');
const { Keyboard } = require('vk-io');

const {
  formatMoney,
  getMagazineAssets,
  getPhoneSim,
  getPhoneSimByNumber,
  purchasePhoneSim,
  getPhoneCall,
  startPhoneCall,
  acceptPhoneCall,
  declinePhoneCall,
  endPhoneCall,
  touchPhoneCall
} = require('../database');

const {
  getItem
} = require('../magazine/catalog');

const {
  MAX_VOICE_TEXT_LENGTH,
  createVoiceAttachment
} = require('../voice');

const SIM_PRICE = 50_000;
const NUMBER_INPUT_TTL_MS = 2 * 60 * 1000;
const RING_TIMEOUT_MS = 2 * 60 * 1000;
const ACTIVE_CALL_TIMEOUT_MS = 30 * 60 * 1000;

const pendingNumberInputs = new Map();

const ELITE_NUMBERS = Object.freeze([
  '111111',
  '222222',
  '333333',
  '444444',
  '555555',
  '666666',
  '777777',
  '888888',
  '999999',
  '123456',
  '654321',
  '100000',
  '500000',
  '777000',
  '777001',
  '777007',
  '777999',
  '111777',
  '555777',
  '999777'
]);

const RARITY_LABELS = Object.freeze({
  standard: 'Обычный',
  pretty: 'Красивый ✨',
  elite: 'Блатной 👑'
});

function randomItem(items) {
  return items[crypto.randomInt(items.length)];
}

function randomDigit() {
  return String(crypto.randomInt(10));
}

function randomFirstDigit() {
  return String(crypto.randomInt(1, 10));
}

function generateSimCandidate() {
  const rarityRoll = crypto.randomInt(10_000);

  if (rarityRoll < 50) {
    return {
      phoneNumber: randomItem(ELITE_NUMBERS),
      rarity: 'elite'
    };
  }

  if (rarityRoll < 500) {
    const first = randomFirstDigit();
    let second = randomDigit();

    while (second === first) {
      second = randomDigit();
    }

    const patterns = [
      `${first}${second}${first}${second}${first}${second}`,
      `${first.repeat(3)}${second.repeat(3)}`,
      `${first.repeat(2)}${second.repeat(2)}${first}${second}`,
      `${first}${second}${second}${first}${first}${second}`
    ];

    return {
      phoneNumber: randomItem(patterns),
      rarity: 'pretty'
    };
  }

  return {
    phoneNumber: String(
      crypto.randomInt(100_000, 1_000_000)
    ),
    rarity: 'standard'
  };
}

function normalizePhoneNumber(value) {
  const digits = String(value ?? '')
    .replace(/\D/g, '');

  return /^\d{6}$/.test(digits)
    ? digits
    : null;
}

function formatPhoneNumber(phoneNumber) {
  const digits = normalizePhoneNumber(phoneNumber);

  if (!digits) {
    return String(phoneNumber ?? '—');
  }

  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

function isPrivateMessage(context) {
  return (
    !context.isChat &&
    Number(context.peerId) ===
      Number(context.senderId)
  );
}

function getOwnedPhones(vkId) {
  return getMagazineAssets(vkId)
    .filter(asset =>
      asset.itemType === 'phones'
    )
    .map(asset => getItem(asset.itemKey))
    .filter(Boolean)
    .sort((left, right) =>
      right.price - left.price
    );
}

function createShopKeyboard() {
  return Keyboard.builder()
    .textButton({
      label: '📱 Магазин телефонов',
      payload: {
        command: 'magazine_category',
        categoryKey: 'phones'
      },
      color: Keyboard.PRIMARY_COLOR
    })
    .inline();
}

function createPhoneHomeKeyboard({
  hasPhone,
  sim,
  call
}) {
  const keyboard = Keyboard.builder();

  if (call?.status === 'ringing') {
    if (call.isCaller) {
      keyboard.textButton({
        label: '📵 Отменить вызов',
        payload: {
          command: 'phone_end_call',
          callId: call.id
        },
        color: Keyboard.NEGATIVE_COLOR
      });
    } else {
      keyboard
        .textButton({
          label: '✅ Принять',
          payload: {
            command: 'phone_accept_call',
            callId: call.id
          },
          color: Keyboard.POSITIVE_COLOR
        })
        .textButton({
          label: '❌ Отклонить',
          payload: {
            command: 'phone_decline_call',
            callId: call.id
          },
          color: Keyboard.NEGATIVE_COLOR
        });
    }
  } else if (call?.status === 'active') {
    keyboard.textButton({
      label: '📵 Завершить звонок',
      payload: {
        command: 'phone_end_call',
        callId: call.id
      },
      color: Keyboard.NEGATIVE_COLOR
    });
  } else if (hasPhone && !sim) {
    keyboard.textButton({
      label: '📲 Купить SIM-карту',
      payload: {
        command: 'phone_buy_sim'
      },
      color: Keyboard.POSITIVE_COLOR
    });
  } else if (hasPhone && sim) {
    keyboard.textButton({
      label: '📞 Позвонить',
      payload: {
        command: 'phone_call_prompt'
      },
      color: Keyboard.POSITIVE_COLOR
    });
  }

  if (!call) {
    if (hasPhone) {
      keyboard.row();
    }

    keyboard.textButton({
      label: '🛒 Телефоны',
      payload: {
        command: 'magazine_category',
        categoryKey: 'phones'
      },
      color: Keyboard.PRIMARY_COLOR
    });
  }

  return keyboard.inline();
}

function createIncomingCallKeyboard(callId) {
  return Keyboard.builder()
    .textButton({
      label: '✅ Принять',
      payload: {
        command: 'phone_accept_call',
        callId
      },
      color: Keyboard.POSITIVE_COLOR
    })
    .textButton({
      label: '❌ Отклонить',
      payload: {
        command: 'phone_decline_call',
        callId
      },
      color: Keyboard.NEGATIVE_COLOR
    })
    .inline();
}

function createActiveCallKeyboard(callId) {
  return Keyboard.builder()
    .textButton({
      label: '📵 Завершить звонок',
      payload: {
        command: 'phone_end_call',
        callId
      },
      color: Keyboard.NEGATIVE_COLOR
    })
    .inline();
}

async function getPlayerName(vk, vkId) {
  try {
    const users = await vk.api.users.get({
      user_ids: Number(vkId)
    });
    const user = users?.[0];

    if (user) {
      return [user.first_name, user.last_name]
        .filter(Boolean)
        .join(' ');
    }
  } catch {
    // Имя необязательно для работы звонка.
  }

  return `Игрок ${vkId}`;
}

async function sendPhoneHome(context, vk) {
  if (!isPrivateMessage(context)) {
    await context.send(
      '📱 Телефон работает только в личных сообщениях сообщества.\n\n' +
      'Открой диалог с ботом и напиши !телефон.'
    );

    return true;
  }

  const vkId = Number(context.senderId);
  const phones = getOwnedPhones(vkId);
  const activePhone = phones[0] ?? null;
  const sim = getPhoneSim(vkId);
  const call = getPhoneCall(vkId);
  const lines = [
    '📱 Телефон Zaffron',
    '',
    activePhone
      ? `📲 Основной: ${activePhone.title}`
      : '📲 Телефон не куплен',
    `🛍 Телефонов в коллекции: ${phones.length}`,
    sim
      ? `📞 Номер: ${formatPhoneNumber(sim.phoneNumber)}`
      : '📞 SIM-карта: не установлена',
    sim
      ? `✨ Тип номера: ${RARITY_LABELS[sim.rarity] ?? sim.rarity}`
      : `💵 SIM-карта: ${formatMoney(SIM_PRICE)} ₽`
  ];

  if (call?.status === 'ringing') {
    const otherName = await getPlayerName(
      vk,
      call.otherVkId
    );

    lines.push(
      '',
      call.isCaller
        ? `⏳ Вызов игроку ${otherName}…`
        : `☎ Тебе звонит ${otherName}`
    );
  } else if (call?.status === 'active') {
    const otherName = await getPlayerName(
      vk,
      call.otherVkId
    );

    lines.push(
      '',
      `🟢 Разговор с ${otherName}`,
      `🎙 Напиши фразу до ${MAX_VOICE_TEXT_LENGTH} символов — бот отправит её собеседнику голосовым.`
    );
  } else if (!activePhone) {
    lines.push(
      '',
      'Сначала купи телефон в магазине.'
    );
  } else if (!sim) {
    lines.push(
      '',
      'Купи SIM-карту — номер выпадет случайно.',
      '👑 Шанс получить блатной номер: 0,5%.'
    );
  } else {
    lines.push(
      '',
      'Для звонка нажми кнопку или напиши:',
      '!позвонить 123-456'
    );
  }

  await context.send({
    message: lines.join('\n'),
    keyboard: createPhoneHomeKeyboard({
      hasPhone: Boolean(activePhone),
      sim,
      call
    })
  });

  return true;
}

async function buySim(context) {
  const vkId = Number(context.senderId);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = generateSimCandidate();
    const result = purchasePhoneSim({
      vkId,
      phoneNumber: candidate.phoneNumber,
      rarity: candidate.rarity,
      price: SIM_PRICE
    });

    if (result.status === 'number_taken') {
      continue;
    }

    if (result.status === 'no_phone') {
      await context.send({
        message:
          '❌ Сначала купи любой телефон.',
        keyboard: createShopKeyboard()
      });

      return true;
    }

    if (result.status === 'already_owned') {
      await context.send({
        message:
          '📲 У тебя уже есть SIM-карта.\n\n' +
          `📞 Номер: ${formatPhoneNumber(result.sim.phoneNumber)}\n` +
          `✨ Тип: ${RARITY_LABELS[result.sim.rarity] ?? result.sim.rarity}`,
        keyboard: createPhoneHomeKeyboard({
          hasPhone: true,
          sim: result.sim,
          call: null
        })
      });

      return true;
    }

    if (result.status === 'insufficient_funds') {
      await context.send(
        '❌ Недостаточно денег на SIM-карту.\n\n' +
        `💵 Цена: ${formatMoney(result.price)} ₽\n` +
        `🏦 Баланс: ${formatMoney(result.balance)} ₽\n` +
        `📉 Не хватает: ${formatMoney(result.missing)} ₽`
      );

      return true;
    }

    if (result.status === 'purchased') {
      const isElite = result.sim.rarity === 'elite';
      const isPretty = result.sim.rarity === 'pretty';

      await context.send({
        message:
          (isElite
            ? '👑 ДЖЕКПОТ! Выпал блатной номер!'
            : isPretty
              ? '✨ Тебе выпал красивый номер!'
              : '✅ SIM-карта куплена!') +
          '\n\n' +
          `📞 Номер: ${formatPhoneNumber(result.sim.phoneNumber)}\n` +
          `✨ Тип: ${RARITY_LABELS[result.sim.rarity]}\n` +
          `💵 Списано: ${formatMoney(result.price)} ₽\n` +
          `🏦 Баланс: ${formatMoney(result.balance)} ₽\n\n` +
          'Номер навсегда закреплён за тобой.',
        keyboard: createPhoneHomeKeyboard({
          hasPhone: true,
          sim: result.sim,
          call: null
        })
      });

      return true;
    }
  }

  await context.send(
    '❌ Не удалось подобрать свободный номер. Попробуй ещё раз.'
  );

  return true;
}

async function promptForNumber(context) {
  const vkId = Number(context.senderId);
  const phones = getOwnedPhones(vkId);
  const sim = getPhoneSim(vkId);

  if (phones.length === 0) {
    await context.send({
      message: '❌ Сначала купи телефон.',
      keyboard: createShopKeyboard()
    });

    return true;
  }

  if (!sim) {
    await context.send({
      message:
        '❌ Для звонков нужна SIM-карта.',
      keyboard: createPhoneHomeKeyboard({
        hasPhone: true,
        sim: null,
        call: null
      })
    });

    return true;
  }

  const call = getPhoneCall(vkId);

  if (call) {
    await context.send(
      call.status === 'active'
        ? '❌ Ты уже разговариваешь по телефону.'
        : '❌ У тебя уже идёт вызов.'
    );

    return true;
  }

  pendingNumberInputs.set(vkId, {
    expiresAt: Date.now() + NUMBER_INPUT_TTL_MS
  });

  await context.send(
    '📞 Введи номер игрока следующим сообщением.\n\n' +
    'Можно писать в любом формате:\n' +
    '123-456\n\n' +
    '⏳ На ввод есть 2 минуты.'
  );

  return true;
}

async function startCallByNumber(
  context,
  vk,
  rawNumber
) {
  const callerVkId = Number(context.senderId);
  const callerPhones = getOwnedPhones(callerVkId);
  const callerSim = getPhoneSim(callerVkId);

  if (callerPhones.length === 0) {
    await context.send({
      message: '❌ Сначала купи телефон.',
      keyboard: createShopKeyboard()
    });

    return true;
  }

  if (!callerSim) {
    await context.send({
      message: '❌ Сначала купи SIM-карту.',
      keyboard: createPhoneHomeKeyboard({
        hasPhone: true,
        sim: null,
        call: null
      })
    });

    return true;
  }

  const phoneNumber = normalizePhoneNumber(rawNumber);

  if (!phoneNumber) {
    await context.send(
      '❌ Некорректный номер.\n\n' +
      'Пример: 123-456'
    );

    return true;
  }

  const receiverSim =
    getPhoneSimByNumber(phoneNumber);

  if (!receiverSim) {
    await context.send(
      '❌ Такой номер не зарегистрирован в Zaffron.'
    );

    return true;
  }

  if (receiverSim.vkId === callerVkId) {
    await context.send(
      '❌ Нельзя позвонить самому себе.'
    );

    return true;
  }

  if (getOwnedPhones(receiverSim.vkId).length === 0) {
    await context.send(
      '📵 Телефон абонента сейчас недоступен.'
    );

    return true;
  }

  const now = Date.now();
  const result = startPhoneCall({
    callerVkId,
    receiverVkId: receiverSim.vkId,
    currentTime: now,
    expiresAt: now + RING_TIMEOUT_MS
  });

  if (result.status === 'caller_busy') {
    await context.send(
      '❌ У тебя уже есть незавершённый звонок.'
    );

    return true;
  }

  if (result.status === 'receiver_busy') {
    await context.send(
      '📞 Абонент сейчас разговаривает. Попробуй позже.'
    );

    return true;
  }

  if (result.status !== 'ringing') {
    await context.send(
      '❌ Не удалось начать звонок.'
    );

    return true;
  }

  pendingNumberInputs.delete(callerVkId);
  const callerName = await getPlayerName(
    vk,
    callerVkId
  );

  try {
    await vk.api.messages.send({
      peer_id: receiverSim.vkId,
      random_id: 0,
      message:
        '☎ Входящий звонок!\n\n' +
        `👤 ${callerName}\n` +
        `📞 ${formatPhoneNumber(callerSim.phoneNumber)}\n\n` +
        'Принять звонок?',
      keyboard:
        createIncomingCallKeyboard(
          result.call.id
        )
    });
  } catch (error) {
    endPhoneCall({
      callId: result.call.id,
      vkId: callerVkId
    });

    await context.send(
      '📵 Не удалось дозвониться.\n\n' +
      'Абонент должен сначала разрешить сообщения от сообщества.'
    );

    return true;
  }

  await context.send({
    message:
      '📞 Идёт вызов…\n\n' +
      `Номер: ${formatPhoneNumber(phoneNumber)}\n` +
      'Ожидаем ответа абонента.',
    keyboard: createPhoneHomeKeyboard({
      hasPhone: true,
      sim: callerSim,
      call: {
        ...result.call,
        isCaller: true
      }
    })
  });

  return true;
}

async function acceptCall(context, vk, callId) {
  const receiverVkId = Number(context.senderId);
  const now = Date.now();
  const result = acceptPhoneCall({
    callId,
    receiverVkId,
    currentTime: now,
    expiresAt: now + ACTIVE_CALL_TIMEOUT_MS
  });

  if (result.status !== 'active') {
    await context.send(
      '📵 Этот звонок уже завершён или устарел.'
    );

    return true;
  }

  const receiverName = await getPlayerName(
    vk,
    receiverVkId
  );
  const callerName = await getPlayerName(
    vk,
    result.call.callerVkId
  );
  const keyboard = createActiveCallKeyboard(
    result.call.id
  );

  try {
    await vk.api.messages.send({
      peer_id: result.call.callerVkId,
      random_id: 0,
      message:
        '🟢 Звонок принят!\n\n' +
        `👤 Собеседник: ${receiverName}\n` +
        `🎙 Пиши фразы до ${MAX_VOICE_TEXT_LENGTH} символов — бот передаст их голосовыми сообщениями.`,
      keyboard
    });
  } catch (error) {
    endPhoneCall({
      callId: result.call.id,
      vkId: receiverVkId
    });

    await context.send(
      '📵 Связь оборвалась: вызывающий абонент недоступен.'
    );

    return true;
  }

  await context.send({
    message:
      '🟢 Звонок принят!\n\n' +
      `👤 Собеседник: ${callerName}\n` +
      `🎙 Пиши фразы до ${MAX_VOICE_TEXT_LENGTH} символов — бот передаст их голосовыми сообщениями.`,
    keyboard
  });

  return true;
}

async function declineCall(context, vk, callId) {
  const result = declinePhoneCall({
    callId,
    receiverVkId: Number(context.senderId)
  });

  if (result.status !== 'declined') {
    await context.send(
      '📵 Этот звонок уже завершён.'
    );

    return true;
  }

  await Promise.allSettled([
    vk.api.messages.send({
      peer_id: result.call.callerVkId,
      random_id: 0,
      message: '📵 Абонент отклонил звонок.'
    }),
    context.send('📵 Звонок отклонён.')
  ]);

  return true;
}

async function hangUp(context, vk, callId = null) {
  const vkId = Number(context.senderId);
  const currentCall = getPhoneCall(vkId);
  const safeCallId = Number(callId) || currentCall?.id;

  if (!safeCallId) {
    await context.send(
      '📵 У тебя нет активного звонка.'
    );

    return true;
  }

  const result = endPhoneCall({
    callId: safeCallId,
    vkId
  });

  if (result.status !== 'ended') {
    await context.send(
      '📵 Этот звонок уже завершён.'
    );

    return true;
  }

  const otherVkId =
    result.call.callerVkId === vkId
      ? result.call.receiverVkId
      : result.call.callerVkId;

  await Promise.allSettled([
    vk.api.messages.send({
      peer_id: otherVkId,
      random_id: 0,
      message: '📵 Собеседник завершил звонок.'
    }),
    context.send('📵 Звонок завершён.')
  ]);

  return true;
}

async function transmitVoice(
  context,
  vk,
  call,
  text
) {
  const senderVkId = Number(context.senderId);
  const receiverVkId = call.callerVkId === senderVkId
    ? call.receiverVkId
    : call.callerVkId;

  if (text.length > MAX_VOICE_TEXT_LENGTH) {
    await context.send(
      `❌ Слишком длинная фраза. Максимум ${MAX_VOICE_TEXT_LENGTH} символов.`
    );

    return true;
  }

  try {
    const attachment = await createVoiceAttachment({
      vk,
      peerId: receiverVkId,
      text
    });
    const senderName = await getPlayerName(
      vk,
      senderVkId
    );

    await vk.api.messages.send({
      peer_id: receiverVkId,
      random_id: 0,
      message: `☎ ${senderName}:`,
      attachment,
      keyboard: createActiveCallKeyboard(call.id)
    });

    const now = Date.now();

    touchPhoneCall({
      callId: call.id,
      vkId: senderVkId,
      currentTime: now,
      expiresAt: now + ACTIVE_CALL_TIMEOUT_MS
    });

    await context.send({
      message: '🎙 Голосовое передано собеседнику.',
      keyboard: createActiveCallKeyboard(call.id)
    });
  } catch (error) {
    console.error(
      'Не удалось передать телефонное голосовое:',
      error?.message ?? error
    );

    await context.send(
      '❌ Не удалось создать или отправить голосовое. Попробуй ещё раз.'
    );
  }

  return true;
}

async function handle(context, vk) {
  const text = String(context.text ?? '').trim();
  const payload = context.messagePayload;
  const isPhoneCommand = (
    /^!(?:телефон|номер)\s*$/i.test(text) ||
    /^!позвонить(?:\s+.*)?$/i.test(text) ||
    /^!(?:сбросить|положить\s+трубку|завершить\s+звонок)\s*$/i.test(text) ||
    String(payload?.command ?? '').startsWith('phone_')
  );

  if (
    isPhoneCommand &&
    !isPrivateMessage(context)
  ) {
    await context.send(
      '📱 Телефон работает только в личных сообщениях сообщества.\n\n' +
      'Открой диалог с ботом и напиши !телефон.'
    );

    return true;
  }

  if (payload?.command === 'phone_home') {
    return sendPhoneHome(context, vk);
  }

  if (payload?.command === 'phone_buy_sim') {
    return buySim(context);
  }

  if (payload?.command === 'phone_call_prompt') {
    return promptForNumber(context);
  }

  if (payload?.command === 'phone_accept_call') {
    return acceptCall(
      context,
      vk,
      payload.callId
    );
  }

  if (payload?.command === 'phone_decline_call') {
    return declineCall(
      context,
      vk,
      payload.callId
    );
  }

  if (payload?.command === 'phone_end_call') {
    return hangUp(
      context,
      vk,
      payload.callId
    );
  }

  if (/^!(?:телефон|номер)\s*$/i.test(text)) {
    return sendPhoneHome(context, vk);
  }

  if (
    /^!(?:сбросить|положить\s+трубку|завершить\s+звонок)\s*$/i
      .test(text)
  ) {
    return hangUp(context, vk);
  }

  const directCallMatch = text.match(
    /^!позвонить(?:\s+(.+))?$/i
  );

  if (directCallMatch) {
    return directCallMatch[1]
      ? startCallByNumber(
        context,
        vk,
        directCallMatch[1]
      )
      : promptForNumber(context);
  }

  if (!isPrivateMessage(context)) {
    return false;
  }

  const vkId = Number(context.senderId);
  const call = getPhoneCall(vkId);

  if (
    call?.status === 'active' &&
    text &&
    !text.startsWith('!')
  ) {
    pendingNumberInputs.delete(vkId);

    return transmitVoice(
      context,
      vk,
      call,
      text
    );
  }

  const pendingInput =
    pendingNumberInputs.get(vkId);

  if (pendingInput) {
    if (pendingInput.expiresAt <= Date.now()) {
      pendingNumberInputs.delete(vkId);

      if (text && !text.startsWith('!')) {
        await context.send(
          '⌛ Время ввода номера истекло. Нажми «Позвонить» ещё раз.'
        );

        return true;
      }
    } else if (text && !text.startsWith('!')) {
      return startCallByNumber(
        context,
        vk,
        text
      );
    }
  }

  return false;
}

module.exports = {
  SIM_PRICE,
  formatPhoneNumber,
  generateSimCandidate,
  normalizePhoneNumber,
  handle
};
