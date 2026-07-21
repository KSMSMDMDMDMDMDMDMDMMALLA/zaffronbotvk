const { Keyboard } = require('vk-io');

const {
  formatMoney,
  BUSINESS_MAX_UPGRADE_LEVEL,
  getBusinessMultiplier,
  getMagazineAssets,
  getBusinessState,
  collectBusinessIncome,
  collectAllBusinessIncome,
  upgradeBusiness,
  sellBusiness
} = require('../database');

const {
  getItem
} = require('../magazine/catalog');
const {
  blockIfOverdue
} = require('../taxes');

const BUSINESS_PAGE_SIZE = 7;

function formatMultiplier(value) {
  return `x${Number(value).toLocaleString(
    'en-US',
    {
      maximumFractionDigits: 1
    }
  )}`;
}

function getOwnedBusinesses(vkId) {
  return getMagazineAssets(vkId)
    .filter(asset =>
      asset.itemType === 'businesses'
    )
    .map(asset => getItem(asset.itemKey))
    .filter(item =>
      item &&
      Number.isInteger(item.incomePerHour)
    );
}

function getUpgradeCost(item, level) {
  return item.upgradeCosts?.[level] ?? null;
}

function getInvestedAmount(item, level) {
  const upgrades = (
    item.upgradeCosts ?? []
  )
    .slice(0, level)
    .reduce(
      (sum, price) => sum + price,
      0
    );

  return item.price + upgrades;
}

function getResaleValue(item, level) {
  return Math.floor(
    getInvestedAmount(item, level) * 0.7
  );
}

function createEmptyKeyboard() {
  return Keyboard.builder()
    .textButton({
      label: '🛒 Купить бизнес',
      payload: {
        command: 'magazine_category',
        categoryKey: 'businesses'
      },
      color: Keyboard.POSITIVE_COLOR
    })
    .inline();
}

function createBusinessHomeKeyboard() {
  return Keyboard.builder()
    .textButton({
      label: '⬅ Мои бизнесы',
      payload: {
        command: 'business_home'
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
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

function createBusinessListKeyboard(
  businesses,
  page
) {
  const keyboard = Keyboard.builder();
  const totalPages = Math.max(
    1,
    Math.ceil(
      businesses.length /
      BUSINESS_PAGE_SIZE
    )
  );
  const safePage = normalizePage(
    page,
    totalPages
  );
  const pageItems = businesses.slice(
    safePage * BUSINESS_PAGE_SIZE,
    (safePage + 1) * BUSINESS_PAGE_SIZE
  );

  pageItems.forEach((item, index) => {
    keyboard.textButton({
        label: `🏢 ${item.title}`,
        payload: {
          command: 'business_open',
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

  if (totalPages > 1) {
    keyboard.row();
  }

  if (safePage > 0) {
    keyboard.textButton({
      label: '⬅ Назад',
      payload: {
        command: 'business_home',
        page: safePage - 1
      },
      color: Keyboard.SECONDARY_COLOR
    });
  }

  if (safePage < totalPages - 1) {
    keyboard.textButton({
      label: 'Вперёд ➡',
      payload: {
        command: 'business_home',
        page: safePage + 1
      },
      color: Keyboard.PRIMARY_COLOR
    });
  }

  if (businesses.length > 1) {
    keyboard
      .row()
      .textButton({
        label: '💰 Собрать всю выручку',
        payload: {
          command: 'business_collect_all'
        },
        color: Keyboard.POSITIVE_COLOR
      });
  }

  return keyboard.inline();
}

function createBusinessKeyboard(
  item,
  state
) {
  const keyboard = Keyboard.builder()
    .textButton({
      label: '💰 Снять деньги',
      payload: {
        command: 'business_collect',
        itemKey: item.key
      },
      color: Keyboard.POSITIVE_COLOR
    });

  if (
    state.upgradeLevel <
    BUSINESS_MAX_UPGRADE_LEVEL
  ) {
    const nextMultiplier =
      getBusinessMultiplier(
        state.upgradeLevel + 1
      );

    keyboard
      .row()
      .textButton({
        label:
          `⬆ Улучшить до ${formatMultiplier(nextMultiplier)}`,
        payload: {
          command: 'business_upgrade',
          itemKey: item.key
        },
        color: Keyboard.PRIMARY_COLOR
      });
  }

  keyboard
    .row()
    .textButton({
      label: '💸 Продать бизнес',
      payload: {
        command: 'business_sell_request',
        itemKey: item.key
      },
      color: Keyboard.NEGATIVE_COLOR
    })
    .row()
    .textButton({
      label: '⬅ Мои бизнесы',
      payload: {
        command: 'business_home'
      },
      color: Keyboard.SECONDARY_COLOR
    });

  return keyboard.inline();
}

function createSellConfirmationKeyboard(item) {
  return Keyboard.builder()
    .textButton({
      label: '✅ Да, продать',
      payload: {
        command: 'business_sell_confirm',
        itemKey: item.key
      },
      color: Keyboard.NEGATIVE_COLOR
    })
    .textButton({
      label: '❌ Отмена',
      payload: {
        command: 'business_open',
        itemKey: item.key
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

function resolveOwnedBusiness(vkId, itemKey) {
  const item = getItem(itemKey);

  if (
    !item ||
    item.categoryKey !== 'businesses' ||
    !getOwnedBusinesses(vkId)
      .some(business =>
        business.key === item.key
      )
  ) {
    return null;
  }

  return item;
}

async function sendBusinessHome(
  context,
  requestedPage = 0
) {
  const vkId = Number(context.senderId);
  const businesses =
    getOwnedBusinesses(vkId);

  if (businesses.length === 0) {
    await context.send({
      message:
        '🏢 У тебя пока нет бизнеса.\n\n' +
        'Купи первый бизнес в магазине, и он сразу начнёт приносить доход.',
      keyboard: createEmptyKeyboard()
    });

    return true;
  }

  const currentTime = Date.now();
  const totalPages = Math.max(
    1,
    Math.ceil(
      businesses.length /
      BUSINESS_PAGE_SIZE
    )
  );
  const page = normalizePage(
    requestedPage,
    totalPages
  );
  const pageItems = businesses.slice(
    page * BUSINESS_PAGE_SIZE,
    (page + 1) * BUSINESS_PAGE_SIZE
  );
  const lines = pageItems.map(
    (item, index) => {
      const state = getBusinessState({
        vkId,
        itemKey: item.key,
        baseIncome: item.incomePerHour,
        currentTime
      });

      return (
        `${page * BUSINESS_PAGE_SIZE + index + 1}. ${item.title}\n` +
        `   📈 Доход: ${formatMoney(state.incomePerHour)} ₽/час\n` +
        `   💰 Накоплено: ${formatMoney(state.availableIncome)} ₽\n` +
        `   ⚙ Множитель: ${formatMultiplier(state.multiplier)}`
      );
    }
  );

  await context.send({
    message:
      '🏢 Мои бизнесы\n\n' +
      (totalPages > 1
        ? `📄 Страница ${page + 1}/${totalPages}\n\n`
        : '') +
      `${lines.join('\n\n')}\n\n` +
      'Выбери бизнес кнопкой.',
    keyboard:
      createBusinessListKeyboard(
        businesses,
        page
      )
  });

  return true;
}

async function openBusiness(context, itemKey) {
  const vkId = Number(context.senderId);
  const item = resolveOwnedBusiness(
    vkId,
    itemKey
  );

  if (!item) {
    await context.send({
      message:
        '❌ Этот бизнес тебе не принадлежит.',
      keyboard: createBusinessHomeKeyboard()
    });

    return true;
  }

  const state = getBusinessState({
    vkId,
    itemKey: item.key,
    baseIncome: item.incomePerHour
  });

  const nextCost =
    getUpgradeCost(
      item,
      state.upgradeLevel
    );

  const upgradeText = nextCost === null
    ? '🏆 Улучшение: максимальный уровень'
    : (
      `⬆ Следующее улучшение: ` +
      `${formatMultiplier(
        getBusinessMultiplier(
          state.upgradeLevel + 1
        )
      )} за ${formatMoney(nextCost)} ₽`
    );

  await context.send({
    message:
      `🏢 ${item.title}\n\n` +
      `⚙ Улучшение: ${state.upgradeLevel}/${BUSINESS_MAX_UPGRADE_LEVEL}\n` +
      `📊 Множитель: ${formatMultiplier(state.multiplier)}\n` +
      `📈 Заработок в час: ${formatMoney(state.incomePerHour)} ₽\n` +
      `💰 Накоплено: ${formatMoney(state.availableIncome)} ₽\n` +
      `💵 Всего снято: ${formatMoney(state.totalEarned)} ₽\n\n` +
      upgradeText,
    keyboard: createBusinessKeyboard(
      item,
      state
    )
  });

  return true;
}

async function collectIncome(context, itemKey) {
  const vkId = Number(context.senderId);

  if (await blockIfOverdue(
    context,
    vkId,
    'business'
  )) {
    return true;
  }

  const item = resolveOwnedBusiness(
    vkId,
    itemKey
  );

  if (!item) {
    return openBusiness(
      context,
      itemKey
    );
  }

  const result = collectBusinessIncome({
    vkId,
    itemKey: item.key,
    baseIncome: item.incomePerHour
  });

  if (result.status === 'empty') {
    await context.send({
      message:
        `⏳ «${item.title}» пока ничего не заработал.\n` +
        'Загляни немного позже.',
      keyboard: createBusinessKeyboard(
        item,
        result
      )
    });

    return true;
  }

  const state = getBusinessState({
    vkId,
    itemKey: item.key,
    baseIncome: item.incomePerHour
  });

  await context.send({
    message:
      '💰 Доход снят!\n\n' +
      `🏢 Бизнес: ${item.title}\n` +
      `💵 Получено: ${formatMoney(result.payout)} ₽\n` +
      `🏦 Баланс: ${formatMoney(result.balance)} ₽`,
    keyboard: createBusinessKeyboard(
      item,
      state
    )
  });

  return true;
}

async function collectAllIncome(context) {
  const vkId = Number(context.senderId);

  if (await blockIfOverdue(
    context,
    vkId,
    'business'
  )) {
    return true;
  }

  const businesses =
    getOwnedBusinesses(vkId);

  if (businesses.length === 0) {
    return sendBusinessHome(context);
  }

  const result = collectAllBusinessIncome({
    vkId,
    businesses: businesses.map(item => ({
      itemKey: item.key,
      baseIncome: item.incomePerHour
    }))
  });

  if (result.status === 'empty') {
    await context.send({
      message:
        '⏳ Бизнесы пока ничего не заработали.\n' +
        'Загляни немного позже.',
      keyboard: createBusinessHomeKeyboard()
    });

    return true;
  }

  if (result.status === 'balance_limit') {
    await context.send({
      message:
        '❌ Баланс достиг технического лимита. Выручку пока снять нельзя.',
      keyboard: createBusinessHomeKeyboard()
    });

    return true;
  }

  await context.send({
    message:
      '💰 Вся выручка собрана!\n\n' +
      `🏢 Бизнесов с доходом: ${result.businessCount}\n` +
      `💵 Получено: ${formatMoney(result.payout)} ₽\n` +
      `🏦 Баланс: ${formatMoney(result.balance)} ₽`,
    keyboard: createBusinessHomeKeyboard()
  });

  return true;
}

async function improveBusiness(context, itemKey) {
  const vkId = Number(context.senderId);
  const item = resolveOwnedBusiness(
    vkId,
    itemKey
  );

  if (!item) {
    return openBusiness(
      context,
      itemKey
    );
  }

  const currentState = getBusinessState({
    vkId,
    itemKey: item.key,
    baseIncome: item.incomePerHour
  });

  const upgradeCost = getUpgradeCost(
    item,
    currentState.upgradeLevel
  );

  if (upgradeCost === null) {
    await context.send({
      message:
        `🏆 «${item.title}» уже улучшен до максимума ${formatMultiplier(3)}.`,
      keyboard: createBusinessKeyboard(
        item,
        currentState
      )
    });

    return true;
  }

  const result = upgradeBusiness({
    vkId,
    itemKey: item.key,
    baseIncome: item.incomePerHour,
    upgradeCost
  });

  if (result.status === 'insufficient_funds') {
    await context.send({
      message:
        '❌ Не хватает денег на улучшение.\n\n' +
        `💵 Цена: ${formatMoney(result.price)} ₽\n` +
        `🏦 Баланс: ${formatMoney(result.balance)} ₽\n` +
        `📉 Не хватает: ${formatMoney(result.missing)} ₽`,
      keyboard: createBusinessKeyboard(
        item,
        currentState
      )
    });

    return true;
  }

  const newState = getBusinessState({
    vkId,
    itemKey: item.key,
    baseIncome: item.incomePerHour
  });

  await context.send({
    message:
      '⬆ Бизнес улучшен!\n\n' +
      `🏢 ${item.title}\n` +
      `📊 Новый множитель: ${formatMultiplier(result.multiplier)}\n` +
      `📈 Новый доход: ${formatMoney(result.incomePerHour)} ₽/час\n` +
      `💵 Потрачено: ${formatMoney(result.price)} ₽\n` +
      `🏦 Баланс: ${formatMoney(result.balance)} ₽`,
    keyboard: createBusinessKeyboard(
      item,
      newState
    )
  });

  return true;
}

async function requestBusinessSale(
  context,
  itemKey
) {
  const vkId = Number(context.senderId);
  const item = resolveOwnedBusiness(
    vkId,
    itemKey
  );

  if (!item) {
    return openBusiness(
      context,
      itemKey
    );
  }

  const state = getBusinessState({
    vkId,
    itemKey: item.key,
    baseIncome: item.incomePerHour
  });

  const invested = getInvestedAmount(
    item,
    state.upgradeLevel
  );
  const resaleValue = getResaleValue(
    item,
    state.upgradeLevel
  );

  await context.send({
    message:
      '⚠ Продать бизнес?\n\n' +
      `🏢 ${item.title}\n` +
      `💳 Всего вложено: ${formatMoney(invested)} ₽\n` +
      `💸 Возврат 70%: ${formatMoney(resaleValue)} ₽\n` +
      `💰 Накопленный доход: ${formatMoney(state.availableIncome)} ₽\n` +
      `🏦 Получишь сейчас: ${formatMoney(
        resaleValue + state.availableIncome
      )} ₽\n\n` +
      'После продажи улучшения будут потеряны.',
    keyboard:
      createSellConfirmationKeyboard(item)
  });

  return true;
}

async function confirmBusinessSale(
  context,
  itemKey
) {
  const vkId = Number(context.senderId);
  const item = resolveOwnedBusiness(
    vkId,
    itemKey
  );

  if (!item) {
    return openBusiness(
      context,
      itemKey
    );
  }

  const state = getBusinessState({
    vkId,
    itemKey: item.key,
    baseIncome: item.incomePerHour
  });
  const resaleValue = getResaleValue(
    item,
    state.upgradeLevel
  );

  const result = sellBusiness({
    vkId,
    itemKey: item.key,
    baseIncome: item.incomePerHour,
    resaleValue
  });

  await context.send({
    message:
      '✅ Бизнес продан.\n\n' +
      `🏢 ${item.title}\n` +
      `💸 За имущество: ${formatMoney(result.resaleValue)} ₽\n` +
      `💰 Накопленный доход: ${formatMoney(result.income)} ₽\n` +
      `🏦 Получено всего: ${formatMoney(result.payout)} ₽\n` +
      `💵 Баланс: ${formatMoney(result.balance)} ₽`,
    keyboard: createBusinessHomeKeyboard()
  });

  return true;
}

async function handle(context) {
  const originalText =
    String(context.text ?? '').trim();
  const payload = context.messagePayload;

  if (payload?.command === 'business_home') {
    return sendBusinessHome(
      context,
      payload.page
    );
  }

  if (payload?.command === 'business_open') {
    return openBusiness(
      context,
      payload.itemKey
    );
  }

  if (payload?.command === 'business_collect') {
    return collectIncome(
      context,
      payload.itemKey
    );
  }

  if (
    payload?.command ===
    'business_collect_all'
  ) {
    return collectAllIncome(context);
  }

  if (payload?.command === 'business_upgrade') {
    return improveBusiness(
      context,
      payload.itemKey
    );
  }

  if (
    payload?.command ===
    'business_sell_request'
  ) {
    return requestBusinessSale(
      context,
      payload.itemKey
    );
  }

  if (
    payload?.command ===
    'business_sell_confirm'
  ) {
    return confirmBusinessSale(
      context,
      payload.itemKey
    );
  }

  if (/^!бизнес$/i.test(originalText)) {
    return sendBusinessHome(context);
  }

  const businessMatch = originalText.match(
    /^!бизнес\s+(.+)$/i
  );

  if (businessMatch) {
    const item = getItem(businessMatch[1]);

    return openBusiness(
      context,
      item?.key ?? businessMatch[1]
    );
  }

  return false;
}

module.exports = {
  handle
};
