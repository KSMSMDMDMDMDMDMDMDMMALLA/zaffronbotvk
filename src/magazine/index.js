const { Keyboard } = require('vk-io');

const {
  formatMoney,
  getBalance,
  getMagazineAssets,
  getJobBoostCount,
  purchaseMagazineItem,
  sellMagazineAsset
} = require('../database');

const {
  categories,
  getCategory,
  getItem
} = require('./catalog');

const CATEGORY_PAGE_SIZE = 7;
const ASSET_PAGE_SIZE = 7;
const ASSET_RESALE_PERCENT = 70;

function createCategoriesKeyboard() {
  const keyboard = Keyboard.builder();

  categories.forEach((category, index) => {
    keyboard.textButton({
      label: `${category.emoji} ${category.title}`,
      payload: {
        command: 'magazine_category',
        categoryKey: category.key
      },
      color: Keyboard.PRIMARY_COLOR
    });

    if (
      index % 2 === 1 &&
      index < categories.length - 1
    ) {
      keyboard.row();
    }
  });

  keyboard
    .row()
    .textButton({
      label: '📦 Моё имущество',
      payload: {
        command: 'magazine_assets'
      },
      color: Keyboard.SECONDARY_COLOR
    });

  return keyboard.inline();
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

function createCategoryKeyboard(
  category,
  page
) {
  const keyboard = Keyboard.builder();
  const totalPages = Math.max(
    1,
    Math.ceil(
      category.items.length /
      CATEGORY_PAGE_SIZE
    )
  );
  const safePage = normalizePage(
    page,
    totalPages
  );
  const pageItems = category.items.slice(
    safePage * CATEGORY_PAGE_SIZE,
    (safePage + 1) * CATEGORY_PAGE_SIZE
  );

  pageItems.forEach((item, index) => {
    keyboard.textButton({
      label: `🛒 ${item.title}`,
      payload: {
        command: 'magazine_buy',
        itemKey: item.key
      },
      color: Keyboard.POSITIVE_COLOR
    });

    if (
      index % 2 === 1 &&
      index < pageItems.length - 1
    ) {
      keyboard.row();
    }
  });

  keyboard.row();

  if (safePage > 0) {
    keyboard.textButton({
      label: '⬅ Назад',
      payload: {
        command: 'magazine_category',
        categoryKey: category.key,
        page: safePage - 1
      },
      color: Keyboard.SECONDARY_COLOR
    });
  }

  if (safePage < totalPages - 1) {
    keyboard.textButton({
      label: 'Вперёд ➡',
      payload: {
        command: 'magazine_category',
        categoryKey: category.key,
        page: safePage + 1
      },
      color: Keyboard.PRIMARY_COLOR
    });
  }

  keyboard.textButton({
      label: '⬅ К разделам',
      payload: {
        command: 'magazine_home'
      },
      color: Keyboard.SECONDARY_COLOR
    });

  return keyboard.inline();
}

function createPurchaseKeyboard(
  categoryKey,
  ownedItemKey = null
) {
  const keyboard = Keyboard.builder()
    .textButton({
      label: '🛒 Вернуться к товарам',
      payload: {
        command: 'magazine_category',
        categoryKey
      },
      color: Keyboard.PRIMARY_COLOR
    });

  if (
    categoryKey === 'businesses' &&
    ownedItemKey
  ) {
    keyboard.textButton({
        label: '🏢 Управлять бизнесом',
        payload: {
          command: 'business_open',
          itemKey: ownedItemKey
        },
        color: Keyboard.POSITIVE_COLOR
      });
  } else if (ownedItemKey) {
    const item = getItem(ownedItemKey);

    if (item && !item.consumable) {
      keyboard.textButton({
        label: '💸 Продать имущество',
        payload: {
          command: 'magazine_sell_request',
          itemKey: item.key
        },
        color: Keyboard.NEGATIVE_COLOR
      });
    }
  }

  return keyboard.inline();
}

function getOwnedItemKeys(vkId) {
  return new Set(
    getMagazineAssets(vkId)
      .map(asset => asset.itemKey)
  );
}

function getSellableAssets(vkId) {
  return getMagazineAssets(vkId)
    .map(asset => getItem(asset.itemKey))
    .filter(item =>
      item &&
      item.categoryKey !== 'businesses' &&
      !item.consumable
    );
}

function getAssetResaleValue(item) {
  return Math.floor(
    item.price *
    ASSET_RESALE_PERCENT /
    100
  );
}

function createAssetsKeyboard(items, page) {
  const keyboard = Keyboard.builder();
  const totalPages = Math.max(
    1,
    Math.ceil(
      items.length /
      ASSET_PAGE_SIZE
    )
  );
  const safePage = normalizePage(
    page,
    totalPages
  );
  const pageItems = items.slice(
    safePage * ASSET_PAGE_SIZE,
    (safePage + 1) * ASSET_PAGE_SIZE
  );

  pageItems.forEach((item, index) => {
    keyboard.textButton({
      label: `💸 ${item.title}`,
      payload: {
        command: 'magazine_sell_request',
        itemKey: item.key
      },
      color: Keyboard.NEGATIVE_COLOR
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
        command: 'magazine_assets',
        page: safePage - 1
      },
      color: Keyboard.SECONDARY_COLOR
    });
  }

  if (safePage < totalPages - 1) {
    keyboard.textButton({
      label: 'Вперёд ➡',
      payload: {
        command: 'magazine_assets',
        page: safePage + 1
      },
      color: Keyboard.PRIMARY_COLOR
    });
  }

  return keyboard.inline();
}

function createSaleConfirmationKeyboard(item) {
  return Keyboard.builder()
    .textButton({
      label: '✅ Да, продать',
      payload: {
        command: 'magazine_sell_confirm',
        itemKey: item.key
      },
      color: Keyboard.NEGATIVE_COLOR
    })
    .textButton({
      label: '❌ Отмена',
      payload: {
        command: 'magazine_assets'
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

function createAssetsReturnKeyboard() {
  return Keyboard.builder()
    .textButton({
      label: '⬅ Моё имущество',
      payload: {
        command: 'magazine_assets'
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

function getProfileText(vkId) {
  const assets = getMagazineAssets(vkId);
  const itemsByCategory = new Map();

  for (const asset of assets) {
    const item = getItem(asset.itemKey);

    if (!item) {
      continue;
    }

    const items =
      itemsByCategory.get(item.categoryKey) ?? [];

    items.push(item.title);
    itemsByCategory.set(
      item.categoryKey,
      items
    );
  }

  const propertyLines = categories
    .filter(category =>
      category.key !== 'boosts'
    )
    .map(category => {
      const itemTitles =
        itemsByCategory.get(category.key) ?? [];

      return (
        `${category.emoji} ${category.profileLabel} — ` +
        (itemTitles.length > 0
          ? itemTitles.join(', ')
          : 'отсутствует')
      );
    });

  const boostCount =
    getJobBoostCount(vkId);

  return (
    '🏠 Имущество\n' +
    `${propertyLines.join('\n')}\n` +
    `⚡ Бусты смены x2 — ${boostCount}`
  );
}

async function sendHome(context) {
  const balance = getBalance(
    Number(context.senderId)
  );

  const categoryLines = categories.map(
    category =>
      `${category.emoji} !магазин ${category.command} — ${category.title.toLowerCase()}`
  );

  await context.send({
    message:
      '🛒 Магазин Zaffron\n\n' +
      `💵 Твой баланс: ${formatMoney(balance)} $\n\n` +
      `${categoryLines.join('\n')}\n\n` +
      '📦 !имущество — продать купленное имущество\n\n' +
      'Выбери раздел кнопкой или командой.\n' +
      'Покупка текстом: !купить [название товара]',
    keyboard: createCategoriesKeyboard()
  });

  return true;
}

async function sendAssets(
  context,
  requestedPage = 0
) {
  const vkId = Number(context.senderId);
  const items = getSellableAssets(vkId);

  if (items.length === 0) {
    await context.send(
      '📦 У тебя пока нет имущества, которое можно продать.\n\n' +
      'Бизнесы управляются отдельно командой !бизнес.'
    );

    return true;
  }

  const totalPages = Math.max(
    1,
    Math.ceil(
      items.length /
      ASSET_PAGE_SIZE
    )
  );
  const page = normalizePage(
    requestedPage,
    totalPages
  );
  const pageItems = items.slice(
    page * ASSET_PAGE_SIZE,
    (page + 1) * ASSET_PAGE_SIZE
  );

  const lines = pageItems.map(
    (item, index) => {
      const category =
        getCategory(item.categoryKey);

      return (
        `${page * ASSET_PAGE_SIZE + index + 1}. ` +
        `${category?.emoji ?? '📦'} ${item.title}\n` +
        `   💵 Цена покупки: ${formatMoney(item.price)} $\n` +
        `   💸 Продажа: ${formatMoney(
          getAssetResaleValue(item)
        )} $`
      );
    }
  );

  await context.send({
    message:
      '📦 Моё имущество\n\n' +
      (totalPages > 1
        ? `📄 Страница ${page + 1}/${totalPages}\n\n`
        : '') +
      `${lines.join('\n\n')}\n\n` +
      `При продаже возвращается ${ASSET_RESALE_PERCENT}% стоимости.\n` +
      'Выбери имущество кнопкой.',
    keyboard: createAssetsKeyboard(
      items,
      page
    )
  });

  return true;
}

async function requestAssetSale(
  context,
  itemValue
) {
  const item = getItem(itemValue);

  if (!item) {
    await context.send(
      '❌ Такое имущество не найдено.'
    );

    return true;
  }

  if (item.categoryKey === 'businesses') {
    await context.send(
      '🏢 Бизнес продаётся через команду !бизнес — там учитывается накопленный доход.'
    );

    return true;
  }

  if (item.consumable) {
    await context.send(
      '❌ Расходуемые бусты продавать нельзя.'
    );

    return true;
  }

  const owned = getMagazineAssets(
    Number(context.senderId)
  ).some(asset =>
    asset.itemKey === item.key
  );

  if (!owned) {
    await context.send(
      `❌ «${item.title}» тебе не принадлежит.`
    );

    return true;
  }

  const resaleValue =
    getAssetResaleValue(item);

  await context.send({
    message:
      '⚠ Продать имущество?\n\n' +
      `📦 ${item.title}\n` +
      `💵 Цена покупки: ${formatMoney(item.price)} $\n` +
      `💸 Получишь: ${formatMoney(resaleValue)} $\n\n` +
      'После продажи имущество исчезнет из профиля.',
    keyboard:
      createSaleConfirmationKeyboard(item)
  });

  return true;
}

async function confirmAssetSale(
  context,
  itemValue
) {
  const item = getItem(itemValue);

  if (
    !item ||
    item.categoryKey === 'businesses' ||
    item.consumable
  ) {
    await context.send(
      '❌ Это имущество нельзя продать таким способом.'
    );

    return true;
  }

  const result = sellMagazineAsset({
    vkId: Number(context.senderId),
    itemKey: item.key,
    itemType: item.categoryKey,
    resaleValue: getAssetResaleValue(item)
  });

  if (result.status === 'not_owned') {
    await context.send(
      `❌ «${item.title}» уже не находится в твоём имуществе.`
    );

    return true;
  }

  if (result.status === 'balance_limit') {
    await context.send(
      '❌ Баланс достиг технического лимита. Продажа отменена.'
    );

    return true;
  }

  await context.send({
    message:
      '✅ Имущество продано!\n\n' +
      `📦 ${item.title}\n` +
      `💸 Получено: ${formatMoney(result.resaleValue)} $\n` +
      `🏦 Баланс: ${formatMoney(result.balance)} $`,
    keyboard: createAssetsReturnKeyboard()
  });

  return true;
}

async function sendCategory(
  context,
  categoryValue,
  requestedPage = 0
) {
  const category =
    getCategory(categoryValue);

  if (!category) {
    await context.send(
      '❌ Такого раздела нет.\n\n' +
      'Открыть все разделы: !магазин'
    );

    return true;
  }

  const vkId = Number(context.senderId);
  const ownedItemKeys =
    getOwnedItemKeys(vkId);
  const boostCount =
    getJobBoostCount(vkId);

  const totalPages = Math.max(
    1,
    Math.ceil(
      category.items.length /
      CATEGORY_PAGE_SIZE
    )
  );
  const page = normalizePage(
    requestedPage,
    totalPages
  );
  const pageItems = category.items.slice(
    page * CATEGORY_PAGE_SIZE,
    (page + 1) * CATEGORY_PAGE_SIZE
  );

  const lines = pageItems.map(
    (item, index) => {
      let status = '';

      if (item.consumable) {
        status = `\n   🎫 Куплено бустов: ${boostCount}`;
      } else if (ownedItemKeys.has(item.key)) {
        status = '\n   ✅ Уже куплено';
      }

      const description = item.description
        ? `\n   ℹ ${item.description}`
        : '';

      return (
        `${page * CATEGORY_PAGE_SIZE + index + 1}. ${item.title}\n` +
        `   💵 ${formatMoney(item.price)} $` +
        description +
        status
      );
    }
  );

  await context.send({
    message:
      `${category.emoji} Магазин: ${category.title}\n\n` +
      (totalPages > 1
        ? `📄 Страница ${page + 1}/${totalPages}\n\n`
        : '') +
      `${lines.join('\n\n')}\n\n` +
      'Нажми кнопку товара или напиши:\n' +
      '!купить [название товара]',
    keyboard: createCategoryKeyboard(
      category,
      page
    )
  });

  return true;
}

async function buyItem(context, itemValue) {
  const item = getItem(itemValue);

  if (!item) {
    await context.send(
      '❌ Такой товар не найден.\n\n' +
      'Открыть магазин: !магазин'
    );

    return true;
  }

  const result = purchaseMagazineItem({
    vkId: Number(context.senderId),
    itemKey: item.key,
    itemType: item.categoryKey,
    price: item.price,
    consumable: item.consumable,
    consumableQuantity:
      item.quantity ?? 1
  });

  if (result.status === 'already_owned') {
    await context.send({
      message:
        `✅ «${item.title}» уже находится в твоём имуществе.`,
      keyboard: createPurchaseKeyboard(
        item.categoryKey,
        item.key
      )
    });

    return true;
  }

  if (result.status === 'insufficient_funds') {
    await context.send({
      message:
        '❌ Недостаточно денег.\n\n' +
        `🛒 Товар: ${item.title}\n` +
        `💵 Цена: ${formatMoney(result.price)} $\n` +
        `🏦 Баланс: ${formatMoney(result.balance)} $\n` +
        `📉 Не хватает: ${formatMoney(result.missing)} $`,
      keyboard: createPurchaseKeyboard(
        item.categoryKey
      )
    });

    return true;
  }

  const boostText = item.consumable
    ? `\n⚡ Куплено бустов: ${item.quantity ?? 1}\n` +
      `🎫 Бустов в запасе: ${result.boostCount}\n` +
      'Буст автоматически сработает после следующей смены.'
    : item.categoryKey === 'businesses'
      ? '\n🏢 Бизнес начал приносить доход.'
      : '\n📦 Товар добавлен в имущество профиля.';

  await context.send({
    message:
      '✅ Покупка совершена!\n\n' +
      `🛒 ${item.title}\n` +
      `💵 Списано: ${formatMoney(result.price)} $\n` +
      `🏦 Баланс: ${formatMoney(result.balance)} $` +
      boostText,
    keyboard: createPurchaseKeyboard(
      item.categoryKey,
      item.key
    )
  });

  return true;
}

async function handle(context) {
  const originalText =
    String(context.text ?? '').trim();
  const payload =
    context.messagePayload;

  if (payload?.command === 'magazine_home') {
    return sendHome(context);
  }

  if (payload?.command === 'magazine_assets') {
    return sendAssets(
      context,
      payload.page
    );
  }

  if (
    payload?.command ===
    'magazine_sell_request'
  ) {
    return requestAssetSale(
      context,
      payload.itemKey
    );
  }

  if (
    payload?.command ===
    'magazine_sell_confirm'
  ) {
    return confirmAssetSale(
      context,
      payload.itemKey
    );
  }

  if (
    payload?.command ===
    'magazine_category'
  ) {
    return sendCategory(
      context,
      payload.categoryKey,
      payload.page
    );
  }

  if (payload?.command === 'magazine_buy') {
    return buyItem(
      context,
      payload.itemKey
    );
  }

  if (/^!имущество$/i.test(originalText)) {
    return sendAssets(context);
  }

  if (/^!продать\s*$/i.test(originalText)) {
    await context.send(
      '❌ Укажи название имущества.\n\n' +
      'Пример: !продать ВАЗ-2107\n' +
      'Список имущества: !имущество'
    );

    return true;
  }

  const saleMatch = originalText.match(
    /^!продать\s+(.+)$/i
  );

  if (saleMatch) {
    return requestAssetSale(
      context,
      saleMatch[1]
    );
  }

  if (/^!магазин$/i.test(originalText)) {
    return sendHome(context);
  }

  const categoryMatch = originalText.match(
    /^!магазин\s+(.+)$/i
  );

  if (categoryMatch) {
    return sendCategory(
      context,
      categoryMatch[1]
    );
  }

  if (/^!купить\s*$/i.test(originalText)) {
    await context.send(
      '❌ Укажи название товара.\n\n' +
      'Пример: !купить ВАЗ-2107'
    );

    return true;
  }

  const purchaseMatch = originalText.match(
    /^!купить\s+(.+)$/i
  );

  if (purchaseMatch) {
    return buyItem(
      context,
      purchaseMatch[1]
    );
  }

  return false;
}

module.exports = {
  handle,
  getProfileText
};
