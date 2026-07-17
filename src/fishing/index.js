const crypto = require('node:crypto');
const { Keyboard } = require('vk-io');

const {
  formatMoney,
  getMagazineAssets,
  addFishingCatch,
  getFishingInventory,
  sellAllFishingCatches,
  incrementQuestStat
} = require('../database');

const {
  getItem
} = require('../magazine/catalog');

const {
  rollFishingLoot
} = require('./loot');

const CAST_COUNT = 3;
const MIN_CAST_DELAY_MS = 5000;
const MAX_CAST_DELAY_MS = 5000;

const activeFishingSessions = new Map();

function wait(milliseconds) {
  return new Promise(resolve =>
    setTimeout(resolve, milliseconds)
  );
}

function getOwnedBoats(vkId) {
  return getMagazineAssets(vkId)
    .filter(asset => asset.itemType === 'boats')
    .map(asset => getItem(asset.itemKey))
    .filter(Boolean)
    .sort((first, second) =>
      first.price - second.price
    );
}

function formatWeight(weightGrams) {
  const safeWeight = Math.max(
    0,
    Number(weightGrams) || 0
  );

  if (safeWeight < 1000) {
    return `${safeWeight} г`;
  }

  return (
    `${(safeWeight / 1000)
      .toFixed(2)
      .replace(/\.00$/, '')
      .replace(/(\.\d)0$/, '$1')} кг`
  );
}

function createBoatsKeyboard(boats) {
  const keyboard = Keyboard.builder();

  boats.forEach((boat, index) => {
    keyboard.textButton({
      label: `🎣 ${boat.title}`,
      payload: {
        command: 'fishing_start',
        boatKey: boat.key
      },
      color: Keyboard.POSITIVE_COLOR
    });

    if (
      index % 2 === 1 &&
      index < boats.length - 1
    ) {
      keyboard.row();
    }
  });

  keyboard
    .row()
    .textButton({
      label: '🎒 Мой улов',
      payload: {
        command: 'fishing_inventory'
      },
      color: Keyboard.PRIMARY_COLOR
    })
    .textButton({
      label: '💰 Продать всё',
      payload: {
        command: 'fishing_sell_all'
      },
      color: Keyboard.SECONDARY_COLOR
    });

  return keyboard.inline();
}

function createNoBoatKeyboard() {
  return Keyboard.builder()
    .textButton({
      label: '🚤 Магазин лодок',
      payload: {
        command: 'magazine_category',
        categoryKey: 'boats'
      },
      color: Keyboard.PRIMARY_COLOR
    })
    .inline();
}

function createFishingResultKeyboard() {
  return Keyboard.builder()
    .textButton({
      label: '💰 Продать весь улов',
      payload: {
        command: 'fishing_sell_all'
      },
      color: Keyboard.POSITIVE_COLOR
    })
    .textButton({
      label: '🎣 Рыбачить ещё',
      payload: {
        command: 'fishing_home'
      },
      color: Keyboard.PRIMARY_COLOR
    })
    .inline();
}

function createFishingReturnKeyboard() {
  return Keyboard.builder()
    .textButton({
      label: '🎣 К выбору лодки',
      payload: {
        command: 'fishing_home'
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

async function sendFishingHome(context) {
  const vkId = Number(context.senderId);

  if (activeFishingSessions.has(vkId)) {
    await context.send(
      '⏳ Ты уже рыбачишь. Дождись окончания трёх забросов.'
    );

    return true;
  }

  const boats = getOwnedBoats(vkId);

  if (boats.length === 0) {
    await context.send({
      message:
        '❌ Для рыбалки нужна собственная лодка.\n\n' +
        'Самая доступная лодка стоит 30.000 $.',
      keyboard: createNoBoatKeyboard()
    });

    return true;
  }

  const lines = boats.map(boat => (
    `🚤 ${boat.title}\n` +
    `└ Удача: +${boat.fishingLuck ?? 0}%`
  ));

  await context.send({
    message:
      '🎣 Рыбалка Zaffron\n\n' +
      'Выбери лодку для выхода на озеро.\n' +
      `За одну рыбалку будет ${CAST_COUNT} заброса.\n\n` +
      lines.join('\n\n'),
    keyboard: createBoatsKeyboard(boats)
  });

  return true;
}

function formatCatchMessage(catchResult) {
  if (catchResult.kind === 'fish') {
    return (
      `${catchResult.emoji} Вы поймали рыбу «${catchResult.title}»!\n` +
      `⚖ Вес: ${formatWeight(catchResult.weightGrams)}\n` +
      `💰 Оценка: ${formatMoney(catchResult.value)} $`
    );
  }

  const typeText = catchResult.kind === 'treasure'
    ? 'сокровище'
    : 'предмет';

  return (
    `${catchResult.emoji} Вы выловили ${typeText} «${catchResult.title}»!\n` +
    `⚖ Вес: ${formatWeight(catchResult.weightGrams)}\n` +
    `💰 Оценка: ${formatMoney(catchResult.value)} $`
  );
}

async function startFishing(
  context,
  boatKey
) {
  const vkId = Number(context.senderId);

  if (activeFishingSessions.has(vkId)) {
    await context.send(
      '⏳ Ты уже рыбачишь. Дождись окончания текущей рыбалки.'
    );

    return true;
  }

  const boat = getOwnedBoats(vkId)
    .find(item => item.key === String(boatKey));

  if (!boat) {
    await context.send({
      message:
        '❌ Эта лодка тебе не принадлежит или уже продана.',
      keyboard: createFishingReturnKeyboard()
    });

    return true;
  }

  activeFishingSessions.set(vkId, {
    boatKey: boat.key,
    startedAt: Date.now()
  });

  const sessionCatches = [];

  try {
    await context.send(
      '🚤 Ты отправился на озеро!\n\n' +
      `Лодка: ${boat.title}\n` +
      `🍀 Бонус удачи: +${boat.fishingLuck ?? 0}%\n` +
      `🎣 Забросов: ${CAST_COUNT}`
    );

    for (
      let cast = 1;
      cast <= CAST_COUNT;
      cast += 1
    ) {
      await context.send(
        `🎣 Заброс ${cast}/${CAST_COUNT}...\n` +
        'Ждём поклёвку.'
      );

      await wait(
        crypto.randomInt(
          MIN_CAST_DELAY_MS,
          MAX_CAST_DELAY_MS + 1
        )
      );

      const catchResult = rollFishingLoot(
        boat.fishingLuck ?? 0
      );

      addFishingCatch({
        vkId,
        lootKey: catchResult.key,
        lootTitle: catchResult.title,
        weightGrams: catchResult.weightGrams,
        value: catchResult.value
      });
      sessionCatches.push(catchResult);

      if (cast < CAST_COUNT) {
        await context.send(
          formatCatchMessage(catchResult) +
          '\n\n🎣 Продолжаем рыбачить...'
        );
      }
    }

    const lastCatch = sessionCatches.at(-1);
    const sessionValue = sessionCatches.reduce(
      (total, item) => total + item.value,
      0
    );
    const sessionWeight = sessionCatches.reduce(
      (total, item) => total + item.weightGrams,
      0
    );

    incrementQuestStat(
      vkId,
      'fishing_sessions'
    );

    const inventory = getFishingInventory(vkId);

    await context.send({
      message:
        `${formatCatchMessage(lastCatch)}\n\n` +
        '🏁 Рыбалка завершена!\n\n' +
        `🎒 Поймано за выход: ${sessionCatches.length}\n` +
        `⚖ Общий вес: ${formatWeight(sessionWeight)}\n` +
        `💰 Стоимость выхода: ${formatMoney(sessionValue)} $\n\n` +
        `📦 Всего непроданного улова: ${inventory.catchCount}\n` +
        `💵 Общая оценка: ${formatMoney(inventory.totalValue)} $`,
      keyboard: createFishingResultKeyboard()
    });
  } catch (error) {
    console.error(
      'Ошибка во время рыбалки:',
      error
    );

    try {
      await context.send({
        message:
          '❌ Рыбалка прервалась. Уже пойманный улов сохранён.',
        keyboard: createFishingReturnKeyboard()
      });
    } catch {
      // Не удалось отправить сообщение, улов всё равно сохранён.
    }
  } finally {
    activeFishingSessions.delete(vkId);
  }

  return true;
}

async function sendInventory(context) {
  const inventory = getFishingInventory(
    Number(context.senderId)
  );

  if (inventory.catchCount === 0) {
    await context.send({
      message: '🎒 У тебя пока нет непроданного улова.',
      keyboard: createFishingReturnKeyboard()
    });

    return true;
  }

  const lines = inventory.items.map(item => (
    `• ${item.title} ×${item.count}\n` +
    `  ${formatWeight(item.totalWeightGrams)} — ` +
    `${formatMoney(item.totalValue)} $`
  ));

  await context.send({
    message:
      '🎒 Непроданный улов\n\n' +
      `${lines.join('\n\n')}\n\n` +
      `📦 Всего: ${inventory.catchCount}\n` +
      `⚖ Вес: ${formatWeight(inventory.totalWeightGrams)}\n` +
      `💰 Оценка: ${formatMoney(inventory.totalValue)} $`,
    keyboard: createFishingResultKeyboard()
  });

  return true;
}

async function sellInventory(context) {
  const result = sellAllFishingCatches(
    Number(context.senderId)
  );

  if (result.status === 'empty') {
    await context.send({
      message: '🎒 Продавать пока нечего — улов пуст.',
      keyboard: createFishingReturnKeyboard()
    });

    return true;
  }

  if (result.status === 'balance_limit') {
    await context.send(
      '❌ Баланс достиг технического лимита. Улов пока не продан.'
    );

    return true;
  }

  await context.send({
    message:
      '💰 Весь улов продан!\n\n' +
      `📦 Предметов: ${result.catchCount}\n` +
      `⚖ Общий вес: ${formatWeight(result.totalWeightGrams)}\n` +
      `💵 Получено: ${formatMoney(result.earned)} $\n` +
      `🏦 Баланс: ${formatMoney(result.balance)} $`,
    keyboard: createFishingReturnKeyboard()
  });

  return true;
}

async function handle(context) {
  const originalText =
    String(context.text ?? '').trim();
  const payload = context.messagePayload;

  if (payload?.command === 'fishing_home') {
    return sendFishingHome(context);
  }

  if (payload?.command === 'fishing_start') {
    return startFishing(
      context,
      payload.boatKey
    );
  }

  if (payload?.command === 'fishing_inventory') {
    return sendInventory(context);
  }

  if (payload?.command === 'fishing_sell_all') {
    return sellInventory(context);
  }

  if (/^!(?:рыбачить|рыбалка)$/i.test(originalText)) {
    return sendFishingHome(context);
  }

  if (/^!улов$/i.test(originalText)) {
    return sendInventory(context);
  }

  if (/^!рыба\s+продать$/i.test(originalText)) {
    return sellInventory(context);
  }

  return false;
}

module.exports = {
  CAST_COUNT,
  MIN_CAST_DELAY_MS,
  MAX_CAST_DELAY_MS,
  formatWeight,
  handle
};
