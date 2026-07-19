const { Keyboard } = require('vk-io');

const {
  formatMoney,
  getMagazineAssets,
  getPropertyRentalState,
  startPropertyRental,
  collectPropertyRent,
  collectAllPropertyRent
} = require('../database');

const {
  getItem
} = require('../magazine/catalog');

const RENTAL_PAGE_SIZE = 6;

function getOwnedProperties(vkId) {
  return getMagazineAssets(vkId)
    .filter(asset =>
      asset.itemType === 'houses'
    )
    .map(asset => getItem(asset.itemKey))
    .filter(item =>
      item &&
      item.categoryKey === 'houses' &&
      Number.isSafeInteger(item.rentPerHour) &&
      item.rentPerHour > 0
    );
}

function resolveOwnedProperty(
  vkId,
  itemValue
) {
  const item = getItem(itemValue);

  if (
    !item ||
    item.categoryKey !== 'houses' ||
    !getOwnedProperties(vkId)
      .some(property =>
        property.key === item.key
      )
  ) {
    return null;
  }

  return item;
}

function normalizePage(value, totalPages) {
  return Math.min(
    Math.max(
      0,
      Number.isInteger(Number(value))
        ? Number(value)
        : 0
    ),
    Math.max(0, totalPages - 1)
  );
}

function createEmptyKeyboard() {
  return Keyboard.builder()
    .textButton({
      label: '🏠 Купить жильё',
      payload: {
        command: 'magazine_category',
        categoryKey: 'houses'
      },
      color: Keyboard.POSITIVE_COLOR
    })
    .inline();
}

function createRentalListKeyboard(
  properties,
  page,
  hasActiveRentals
) {
  const keyboard = Keyboard.builder();
  const totalPages = Math.max(
    1,
    Math.ceil(
      properties.length /
      RENTAL_PAGE_SIZE
    )
  );
  const safePage = normalizePage(
    page,
    totalPages
  );
  const pageItems = properties.slice(
    safePage * RENTAL_PAGE_SIZE,
    (safePage + 1) * RENTAL_PAGE_SIZE
  );

  pageItems.forEach((item, index) => {
    keyboard.textButton({
      label: `🏘 ${item.title}`,
      payload: {
        command: 'rental_open',
        itemKey: item.key
      },
      color: Keyboard.PRIMARY_COLOR
    });

    if (
      index % 2 === 1 &&
      index < pageItems.length - 1
    ) {
      keyboard.row();
    }
  });

  if (
    totalPages > 1 ||
    hasActiveRentals
  ) {
    keyboard.row();
  }

  if (safePage > 0) {
    keyboard.textButton({
      label: '⬅ Назад',
      payload: {
        command: 'rental_home',
        page: safePage - 1
      },
      color: Keyboard.SECONDARY_COLOR
    });
  }

  if (safePage < totalPages - 1) {
    keyboard.textButton({
      label: 'Вперёд ➡',
      payload: {
        command: 'rental_home',
        page: safePage + 1
      },
      color: Keyboard.PRIMARY_COLOR
    });
  }

  if (hasActiveRentals) {
    keyboard
      .row()
      .textButton({
        label: '💰 Собрать всю аренду',
        payload: {
          command: 'rental_collect_all'
        },
        color: Keyboard.POSITIVE_COLOR
      });
  }

  return keyboard.inline();
}

function createRentalKeyboard(item, state) {
  const keyboard = Keyboard.builder();

  if (state.status === 'inactive') {
    keyboard.textButton({
      label: '🏘 Сдать в аренду',
      payload: {
        command: 'rental_start',
        itemKey: item.key
      },
      color: Keyboard.POSITIVE_COLOR
    });
  } else {
    keyboard.textButton({
      label: '💰 Забрать аренду',
      payload: {
        command: 'rental_collect',
        itemKey: item.key
      },
      color: Keyboard.POSITIVE_COLOR
    });
  }

  return keyboard
    .row()
    .textButton({
      label: '💸 Продать жильё',
      payload: {
        command: 'magazine_sell_request',
        itemKey: item.key
      },
      color: Keyboard.NEGATIVE_COLOR
    })
    .row()
    .textButton({
      label: '⬅ Моя недвижимость',
      payload: {
        command: 'rental_home'
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

function createRentalHomeKeyboard() {
  return Keyboard.builder()
    .textButton({
      label: '⬅ Моя недвижимость',
      payload: {
        command: 'rental_home'
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

async function sendRentalHome(
  context,
  requestedPage = 0
) {
  const vkId = Number(context.senderId);
  const properties =
    getOwnedProperties(vkId);

  if (properties.length === 0) {
    await context.send({
      message:
        '🏘 У тебя пока нет недвижимости для аренды.\n\n' +
        'Купи комнату, квартиру или дом в магазине.',
      keyboard: createEmptyKeyboard()
    });

    return true;
  }

  const currentTime = Date.now();
  const states = properties.map(item => ({
    item,
    state: getPropertyRentalState({
      vkId,
      itemKey: item.key,
      rentPerHour: item.rentPerHour,
      currentTime
    })
  }));
  const totalPages = Math.max(
    1,
    Math.ceil(
      properties.length /
      RENTAL_PAGE_SIZE
    )
  );
  const page = normalizePage(
    requestedPage,
    totalPages
  );
  const pageStates = states.slice(
    page * RENTAL_PAGE_SIZE,
    (page + 1) * RENTAL_PAGE_SIZE
  );
  const lines = pageStates.map(
    ({ item, state }, index) => {
      const statusText =
        state.status === 'active'
          ? (
            '🟢 Сдаётся\n' +
            `   💰 Накоплено: ${formatMoney(state.availableIncome)} ₽`
          )
          : '⚪ Не сдано';

      return (
        `${page * RENTAL_PAGE_SIZE + index + 1}. ${item.title}\n` +
        `   📈 Аренда: ${formatMoney(item.rentPerHour)} ₽/час\n` +
        `   ${statusText}`
      );
    }
  );
  const hasActiveRentals = states.some(
    item => item.state.status === 'active'
  );

  await context.send({
    message:
      '🏘 Аренда недвижимости\n\n' +
      (totalPages > 1
        ? `📄 Страница ${page + 1}/${totalPages}\n\n`
        : '') +
      `${lines.join('\n\n')}\n\n` +
      'Выбери квартиру или дом кнопкой.',
    keyboard: createRentalListKeyboard(
      properties,
      page,
      hasActiveRentals
    )
  });

  return true;
}

async function openRental(context, itemValue) {
  const vkId = Number(context.senderId);
  const item = resolveOwnedProperty(
    vkId,
    itemValue
  );

  if (!item) {
    await context.send({
      message:
        '❌ Эта недвижимость тебе не принадлежит.',
      keyboard: createRentalHomeKeyboard()
    });

    return true;
  }

  const state = getPropertyRentalState({
    vkId,
    itemKey: item.key,
    rentPerHour: item.rentPerHour
  });
  const rentalText =
    state.status === 'active'
      ? (
        '🟢 Статус: сдаётся\n' +
        `💰 Накоплено: ${formatMoney(state.availableIncome)} ₽\n` +
        `💵 Всего получено: ${formatMoney(state.totalEarned)} ₽`
      )
      : (
        '⚪ Статус: не сдаётся\n\n' +
        'Нажми «Сдать в аренду», и доход начнёт начисляться.'
      );

  await context.send({
    message:
      `🏘 ${item.title}\n\n` +
      `💳 Стоимость: ${formatMoney(item.price)} ₽\n` +
      `📈 Доход: ${formatMoney(item.rentPerHour)} ₽/час\n` +
      rentalText,
    keyboard: createRentalKeyboard(
      item,
      state
    )
  });

  return true;
}

async function startRental(context, itemValue) {
  const vkId = Number(context.senderId);
  const item = resolveOwnedProperty(
    vkId,
    itemValue
  );

  if (!item) {
    return openRental(context, itemValue);
  }

  const result = startPropertyRental({
    vkId,
    itemKey: item.key,
    rentPerHour: item.rentPerHour
  });

  if (result.status === 'already_active') {
    await context.send({
      message:
        `✅ «${item.title}» уже сдаётся в аренду.\n\n` +
        `💰 Накоплено: ${formatMoney(result.availableIncome)} ₽`,
      keyboard: createRentalKeyboard(
        item,
        result
      )
    });

    return true;
  }

  await context.send({
    message:
      '✅ Недвижимость сдана в аренду!\n\n' +
      `🏘 ${item.title}\n` +
      `📈 Доход: ${formatMoney(item.rentPerHour)} ₽/час\n\n` +
      'Деньги уже начали накапливаться.',
    keyboard: createRentalKeyboard(
      item,
      result
    )
  });

  return true;
}

async function collectRent(context, itemValue) {
  const vkId = Number(context.senderId);
  const item = resolveOwnedProperty(
    vkId,
    itemValue
  );

  if (!item) {
    return openRental(context, itemValue);
  }

  const result = collectPropertyRent({
    vkId,
    itemKey: item.key,
    rentPerHour: item.rentPerHour
  });

  if (result.status === 'inactive') {
    await context.send({
      message:
        `⚪ «${item.title}» пока не сдаётся.\n` +
        'Сначала нажми «Сдать в аренду».',
      keyboard: createRentalKeyboard(
        item,
        result
      )
    });

    return true;
  }

  if (result.status === 'empty') {
    await context.send({
      message:
        `⏳ «${item.title}» пока ничего не принесла.\n` +
        'Загляни немного позже.',
      keyboard: createRentalKeyboard(
        item,
        result
      )
    });

    return true;
  }

  if (result.status === 'balance_limit') {
    await context.send({
      message:
        '❌ Баланс достиг технического лимита. Аренду пока забрать нельзя.',
      keyboard: createRentalHomeKeyboard()
    });

    return true;
  }

  const state = getPropertyRentalState({
    vkId,
    itemKey: item.key,
    rentPerHour: item.rentPerHour
  });

  await context.send({
    message:
      '💰 Аренда получена!\n\n' +
      `🏘 ${item.title}\n` +
      `💵 Получено: ${formatMoney(result.payout)} ₽\n` +
      `🏦 Баланс: ${formatMoney(result.balance)} ₽`,
    keyboard: createRentalKeyboard(
      item,
      state
    )
  });

  return true;
}

async function collectAllRent(context) {
  const vkId = Number(context.senderId);
  const properties =
    getOwnedProperties(vkId);

  if (properties.length === 0) {
    return sendRentalHome(context);
  }

  const result = collectAllPropertyRent({
    vkId,
    properties: properties.map(item => ({
      itemKey: item.key,
      rentPerHour: item.rentPerHour
    }))
  });

  if (result.status === 'empty') {
    await context.send({
      message:
        '⏳ С аренды пока нечего забирать.\n\n' +
        'Сдай жильё или загляни немного позже.',
      keyboard: createRentalHomeKeyboard()
    });

    return true;
  }

  if (result.status === 'balance_limit') {
    await context.send({
      message:
        '❌ Баланс достиг технического лимита. Аренду пока забрать нельзя.',
      keyboard: createRentalHomeKeyboard()
    });

    return true;
  }

  await context.send({
    message:
      '💰 Вся аренда получена!\n\n' +
      `🏘 Объектов с доходом: ${result.propertyCount}\n` +
      `💵 Получено: ${formatMoney(result.payout)} ₽\n` +
      `🏦 Баланс: ${formatMoney(result.balance)} ₽`,
    keyboard: createRentalHomeKeyboard()
  });

  return true;
}

async function handle(context) {
  const originalText =
    String(context.text ?? '').trim();
  const payload = context.messagePayload;

  if (payload?.command === 'rental_home') {
    return sendRentalHome(
      context,
      payload.page
    );
  }

  if (payload?.command === 'rental_open') {
    return openRental(
      context,
      payload.itemKey
    );
  }

  if (payload?.command === 'rental_start') {
    return startRental(
      context,
      payload.itemKey
    );
  }

  if (payload?.command === 'rental_collect') {
    return collectRent(
      context,
      payload.itemKey
    );
  }

  if (
    payload?.command ===
    'rental_collect_all'
  ) {
    return collectAllRent(context);
  }

  if (/^!аренда$/i.test(originalText)) {
    return sendRentalHome(context);
  }

  if (
    /^!аренда\s+собрать$/i.test(originalText) ||
    /^!собрать\s+аренду$/i.test(originalText)
  ) {
    return collectAllRent(context);
  }

  const rentalMatch = originalText.match(
    /^!аренда\s+(.+)$/i
  );

  if (rentalMatch) {
    return openRental(
      context,
      rentalMatch[1]
    );
  }

  if (/^!сдать\s*$/i.test(originalText)) {
    await context.send(
      '❌ Укажи недвижимость.\n\n' +
      'Пример: !сдать квартиру\n' +
      'Список жилья: !аренда'
    );

    return true;
  }

  const startMatch = originalText.match(
    /^!сдать\s+(.+)$/i
  );

  if (startMatch) {
    return startRental(
      context,
      startMatch[1]
    );
  }

  return false;
}

module.exports = {
  handle
};
