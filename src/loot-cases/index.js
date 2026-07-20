const { Keyboard } = require('vk-io');

const {
  formatMoney,
  getBalance,
  getLootCaseItem,
  getLootCaseInventory,
  purchaseLootCase,
  sellLootCaseItem,
  sellLootCaseGroup,
  sellAllLootCaseItems,
  claimLootCaseAsset
} = require('../database');

const {
  CASES,
  RARITIES,
  getCase,
  getLoot,
  rollCase
} = require('./catalog');

const INVENTORY_PAGE_SIZE = 5;

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

function formatChance(value) {
  return Number(value)
    .toFixed(2)
    .replace('.', ',')
    .replace(/,00$/, '');
}

function getLootAppearance(lootKey, rarity) {
  const loot = getLoot(lootKey);
  const rarityInfo = RARITIES[rarity] ?? {
    title: rarity,
    emoji: '📦'
  };

  return {
    emoji: loot?.emoji ?? rarityInfo.emoji,
    rarityTitle: rarityInfo.title,
    rarityEmoji: rarityInfo.emoji
  };
}

function createCasesHomeKeyboard() {
  const keyboard = Keyboard.builder();

  CASES.forEach((caseItem, index) => {
    keyboard.textButton({
      label: `${caseItem.emoji} ${caseItem.shortTitle}`,
      payload: {
        command: 'loot_case_view',
        caseKey: caseItem.key
      },
      color: index === 0
        ? Keyboard.SECONDARY_COLOR
        : index === 1
          ? Keyboard.PRIMARY_COLOR
          : Keyboard.POSITIVE_COLOR
    });
  });

  return keyboard
    .row()
    .textButton({
      label: '📦 Склад лута',
      payload: {
        command: 'loot_case_inventory'
      },
      color: Keyboard.PRIMARY_COLOR
    })
    .inline();
}

function createCaseKeyboard(caseItem) {
  return Keyboard.builder()
    .textButton({
      label:
        `${caseItem.emoji} Открыть за ` +
        `${formatMoney(caseItem.price)} ₽`,
      payload: {
        command: 'loot_case_open',
        caseKey: caseItem.key
      },
      color: Keyboard.POSITIVE_COLOR
    })
    .row()
    .textButton({
      label: '📦 Склад лута',
      payload: {
        command: 'loot_case_inventory'
      },
      color: Keyboard.PRIMARY_COLOR
    })
    .textButton({
      label: '⬅ Все кейсы',
      payload: {
        command: 'loot_cases_home'
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

function createDropKeyboard(item) {
  const keyboard = Keyboard.builder()
    .textButton({
      label:
        `💸 Продать за ` +
        `${formatMoney(item.sellValue)} ₽`,
      payload: {
        command: 'loot_case_sell_item',
        itemId: item.id
      },
      color: Keyboard.POSITIVE_COLOR
    })
    .textButton({
      label: '📦 Оставить на складе',
      payload: {
        command: 'loot_case_keep',
        itemId: item.id
      },
      color: Keyboard.PRIMARY_COLOR
    });

  if (item.assetKey) {
    keyboard
      .row()
      .textButton({
        label: item.assetType === 'cars'
          ? '🚗 Забрать машину'
          : '🏠 Забрать в имущество',
        payload: {
          command: 'loot_case_claim_asset',
          itemId: item.id
        },
        color: Keyboard.POSITIVE_COLOR
      });
  }

  return keyboard
    .row()
    .textButton({
      label: '🎁 Открыть ещё кейс',
      payload: {
        command: 'loot_case_view',
        caseKey: item.caseKey
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

function createInventoryKeyboard(
  items,
  page,
  totalPages
) {
  const keyboard = Keyboard.builder();

  items.forEach((item, index) => {
    const appearance = getLootAppearance(
      item.lootKey,
      item.rarity
    );

    keyboard.textButton({
      label:
        `${appearance.emoji} ${item.title}` +
        (item.quantity > 1
          ? ` ×${item.quantity}`
          : ''),
      payload: {
        command: 'loot_case_inventory_item',
        itemId: item.firstItemId,
        page
      },
      color: item.rarity === 'jackpot'
        ? Keyboard.POSITIVE_COLOR
        : Keyboard.PRIMARY_COLOR
    });

    if (
      index % 2 === 1 &&
      index < items.length - 1
    ) {
      keyboard.row();
    }
  });

  keyboard.row();

  if (page > 0) {
    keyboard.textButton({
      label: '⬅ Назад',
      payload: {
        command: 'loot_case_inventory',
        page: page - 1
      },
      color: Keyboard.SECONDARY_COLOR
    });
  }

  if (page < totalPages - 1) {
    keyboard.textButton({
      label: 'Вперёд ➡',
      payload: {
        command: 'loot_case_inventory',
        page: page + 1
      },
      color: Keyboard.PRIMARY_COLOR
    });
  }

  return keyboard
    .row()
    .textButton({
      label: '💸 Продать весь лут',
      payload: {
        command: 'loot_case_sell_all_request'
      },
      color: Keyboard.NEGATIVE_COLOR
    })
    .textButton({
      label: '⬅ К кейсам',
      payload: {
        command: 'loot_cases_home'
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

function createInventoryItemKeyboard(
  item,
  group,
  page
) {
  const keyboard = Keyboard.builder()
    .textButton({
      label:
        `💸 Продать 1 за ` +
        `${formatMoney(item.sellValue)} ₽`,
      payload: {
        command: 'loot_case_sell_item',
        itemId: item.id
      },
      color: Keyboard.POSITIVE_COLOR
    });

  if (group.quantity > 1) {
    keyboard.textButton({
      label: `💰 Продать все ×${group.quantity}`,
      payload: {
        command: 'loot_case_sell_group',
        lootKey: item.lootKey
      },
      color: Keyboard.NEGATIVE_COLOR
    });
  }

  if (item.assetKey) {
    keyboard
      .row()
      .textButton({
        label: item.assetType === 'cars'
          ? '🚗 Забрать машину'
          : '🏠 Забрать в имущество',
        payload: {
          command: 'loot_case_claim_asset',
          itemId: item.id
        },
        color: Keyboard.POSITIVE_COLOR
      });
  }

  return keyboard
    .row()
    .textButton({
      label: '⬅ На склад',
      payload: {
        command: 'loot_case_inventory',
        page
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

function createSellAllConfirmationKeyboard() {
  return Keyboard.builder()
    .textButton({
      label: '✅ Продать весь лут',
      payload: {
        command: 'loot_case_sell_all_confirm'
      },
      color: Keyboard.NEGATIVE_COLOR
    })
    .textButton({
      label: '❌ Отмена',
      payload: {
        command: 'loot_case_inventory'
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

async function sendCasesHome(context) {
  const vkId = Number(context.senderId);
  const balance = getBalance(vkId);
  const inventory = getLootCaseInventory(vkId);
  const caseLines = CASES.map(caseItem =>
    `${caseItem.emoji} ${caseItem.title} — ` +
    `${formatMoney(caseItem.price)} ₽`
  );

  await context.send({
    message:
      '🎁 Кейсы Zaffron\n\n' +
      `${caseLines.join('\n')}\n\n` +
      `💵 Баланс: ${formatMoney(balance)} ₽\n` +
      `📦 На складе: ${inventory.itemCount} предметов\n` +
      `💰 Стоимость склада: ${formatMoney(inventory.totalValue)} ₽\n\n` +
      `📊 Открыто кейсов: ${inventory.stats.openedCount}\n` +
      `👑 Джекпотов: ${inventory.stats.jackpots}\n\n` +
      'Из каждого кейса выпадает один предмет. Его можно сразу продать или оставить на складе.',
    keyboard: createCasesHomeKeyboard()
  });

  return true;
}

async function sendCaseDetails(context, caseValue) {
  const caseItem = getCase(caseValue);

  if (!caseItem) {
    await context.send(
      '❌ Такого кейса нет. Открыть список: !кейсы'
    );

    return true;
  }

  const lines = caseItem.loot.map(lootItem => {
    const rarity = RARITIES[lootItem.rarity];
    const assetText = lootItem.assetKey
      ? ' • имущество'
      : '';

    return (
      `${rarity.emoji} ${lootItem.emoji} ${lootItem.title}\n` +
      `   💸 ${formatMoney(lootItem.sellValue)} ₽` +
      ` • 🎲 ${formatChance(lootItem.chance)}%` +
      assetText
    );
  });

  await context.send({
    message:
      `${caseItem.emoji} ${caseItem.title}\n\n` +
      `💵 Цена открытия: ${formatMoney(caseItem.price)} ₽\n` +
      `📊 Средняя стоимость лута: ${formatMoney(caseItem.expectedValue)} ₽\n\n` +
      `${lines.join('\n\n')}\n\n` +
      'Шансы нормализованы до 100%. Выпадает ровно один предмет.',
    keyboard: createCaseKeyboard(caseItem)
  });

  return true;
}

async function openCase(context, caseValue) {
  const caseItem = getCase(caseValue);

  if (!caseItem) {
    await context.send(
      '❌ Такого кейса нет. Открыть список: !кейсы'
    );

    return true;
  }

  const loot = rollCase(caseItem);
  const result = purchaseLootCase({
    vkId: Number(context.senderId),
    caseKey: caseItem.key,
    price: caseItem.price,
    lootKey: loot.key,
    lootTitle: loot.title,
    rarity: loot.rarity,
    sellValue: loot.sellValue,
    assetKey: loot.assetKey,
    assetType: loot.assetType
  });

  if (result.status === 'insufficient_funds') {
    await context.send({
      message:
        '❌ Недостаточно денег для открытия кейса.\n\n' +
        `💵 Цена: ${formatMoney(result.price)} ₽\n` +
        `🏦 Баланс: ${formatMoney(result.balance)} ₽\n` +
        `📉 Не хватает: ${formatMoney(result.missing)} ₽`,
      keyboard: createCaseKeyboard(caseItem)
    });

    return true;
  }

  const rarity = RARITIES[loot.rarity];
  const jackpotText = loot.rarity === 'jackpot'
    ? '👑 ДЖЕКПОТ!\n\n'
    : '';

  await context.send({
    message:
      `${caseItem.emoji} Кейс открыт!\n\n` +
      jackpotText +
      `${rarity.emoji} ${rarity.title}\n` +
      `${loot.emoji} ${loot.title}\n` +
      `💸 Цена продажи: ${formatMoney(loot.sellValue)} ₽\n` +
      `🎲 Шанс выпадения: ${formatChance(loot.chance)}%\n` +
      (loot.assetKey
        ? '🎁 Можно забрать в обычное имущество.\n'
        : '') +
      `\n🏦 Баланс: ${formatMoney(result.balance)} ₽\n\n` +
      'Предмет уже помещён на склад. Выбери действие:',
    keyboard: createDropKeyboard(result.item)
  });

  return true;
}

async function keepLoot(context, itemId) {
  const item = getLootCaseItem(
    Number(context.senderId),
    itemId
  );

  if (!item) {
    await context.send(
      '❌ Этот предмет уже продан или забран.'
    );

    return true;
  }

  await context.send({
    message:
      '📦 Предмет оставлен на складе лута.\n\n' +
      `${item.title}\n` +
      `💸 Стоимость: ${formatMoney(item.sellValue)} ₽`,
    keyboard: Keyboard.builder()
      .textButton({
        label: '📦 Открыть склад',
        payload: {
          command: 'loot_case_inventory'
        },
        color: Keyboard.PRIMARY_COLOR
      })
      .textButton({
        label: '🎁 К кейсам',
        payload: {
          command: 'loot_cases_home'
        },
        color: Keyboard.SECONDARY_COLOR
      })
      .inline()
  });

  return true;
}

async function sendInventory(
  context,
  requestedPage = 0
) {
  const inventory = getLootCaseInventory(
    Number(context.senderId)
  );

  if (inventory.itemCount === 0) {
    await context.send({
      message:
        '📦 Склад лута пуст.\n\n' +
        'Открой кейс, чтобы получить первый предмет.',
      keyboard: createCasesHomeKeyboard()
    });

    return true;
  }

  const totalPages = Math.max(
    1,
    Math.ceil(
      inventory.items.length /
      INVENTORY_PAGE_SIZE
    )
  );
  const page = normalizePage(
    requestedPage,
    totalPages
  );
  const pageItems = inventory.items.slice(
    page * INVENTORY_PAGE_SIZE,
    (page + 1) * INVENTORY_PAGE_SIZE
  );
  const lines = pageItems.map((item, index) => {
    const appearance = getLootAppearance(
      item.lootKey,
      item.rarity
    );

    return (
      `${page * INVENTORY_PAGE_SIZE + index + 1}. ` +
      `${appearance.rarityEmoji} ${appearance.emoji} ${item.title}` +
      (item.quantity > 1
        ? ` ×${item.quantity}`
        : '') +
      `\n   💸 ${formatMoney(item.totalValue)} ₽`
    );
  });

  await context.send({
    message:
      '📦 Склад лута\n\n' +
      (totalPages > 1
        ? `📄 Страница ${page + 1}/${totalPages}\n\n`
        : '') +
      `${lines.join('\n\n')}\n\n` +
      `🎁 Всего предметов: ${inventory.itemCount}\n` +
      `💰 Общая стоимость: ${formatMoney(inventory.totalValue)} ₽\n` +
      `💸 Продано за всё время: ${formatMoney(inventory.stats.totalSold)} ₽`,
    keyboard: createInventoryKeyboard(
      pageItems,
      page,
      totalPages
    )
  });

  return true;
}

async function sendInventoryItem(
  context,
  itemId,
  page = 0
) {
  const vkId = Number(context.senderId);
  const item = getLootCaseItem(vkId, itemId);

  if (!item) {
    await context.send(
      '❌ Предмет уже продан или забран.'
    );

    return true;
  }

  const inventory = getLootCaseInventory(vkId);
  const group = inventory.items.find(groupItem =>
    groupItem.lootKey === item.lootKey
  );
  const appearance = getLootAppearance(
    item.lootKey,
    item.rarity
  );

  await context.send({
    message:
      `${appearance.rarityEmoji} ${appearance.rarityTitle}\n\n` +
      `${appearance.emoji} ${item.title}\n` +
      `📦 На складе: ${group?.quantity ?? 1}\n` +
      `💸 За один: ${formatMoney(item.sellValue)} ₽\n` +
      `💰 За все: ${formatMoney(group?.totalValue ?? item.sellValue)} ₽` +
      (item.assetKey
        ? '\n🎁 Можно перенести в обычное имущество.'
        : ''),
    keyboard: createInventoryItemKeyboard(
      item,
      group ?? {
        quantity: 1,
        totalValue: item.sellValue
      },
      normalizePage(page, 1000)
    )
  });

  return true;
}

async function sellItem(context, itemId) {
  const result = sellLootCaseItem({
    vkId: Number(context.senderId),
    itemId
  });

  if (result.status === 'not_found') {
    await context.send(
      '❌ Предмет уже продан или забран.'
    );

    return true;
  }

  if (result.status === 'balance_limit') {
    await context.send(
      '❌ Баланс достиг технического лимита. Предмет остался на складе.'
    );

    return true;
  }

  await context.send({
    message:
      '✅ Лут продан!\n\n' +
      `💸 Получено: ${formatMoney(result.earned)} ₽\n` +
      `🏦 Баланс: ${formatMoney(result.balance)} ₽`,
    keyboard: Keyboard.builder()
      .textButton({
        label: '📦 Склад лута',
        payload: {
          command: 'loot_case_inventory'
        },
        color: Keyboard.PRIMARY_COLOR
      })
      .textButton({
        label: '🎁 К кейсам',
        payload: {
          command: 'loot_cases_home'
        },
        color: Keyboard.SECONDARY_COLOR
      })
      .inline()
  });

  return true;
}

async function sellGroup(context, lootKey) {
  const result = sellLootCaseGroup({
    vkId: Number(context.senderId),
    lootKey
  });

  if (result.status === 'not_found') {
    await context.send(
      '❌ Этих предметов уже нет на складе.'
    );

    return true;
  }

  if (result.status === 'balance_limit') {
    await context.send(
      '❌ Баланс достиг технического лимита. Лут остался на складе.'
    );

    return true;
  }

  await context.send({
    message:
      '✅ Группа лута продана!\n\n' +
      `📦 Предметов: ${result.itemCount}\n` +
      `💸 Получено: ${formatMoney(result.earned)} ₽\n` +
      `🏦 Баланс: ${formatMoney(result.balance)} ₽`,
    keyboard: createCasesHomeKeyboard()
  });

  return true;
}

async function requestSellAll(context) {
  const inventory = getLootCaseInventory(
    Number(context.senderId)
  );

  if (inventory.itemCount === 0) {
    return sendInventory(context);
  }

  await context.send({
    message:
      '⚠ Продать весь лут со склада?\n\n' +
      `📦 Предметов: ${inventory.itemCount}\n` +
      `💸 Получишь: ${formatMoney(inventory.totalValue)} ₽\n\n` +
      'Машины и недвижимость на складе тоже будут проданы.',
    keyboard: createSellAllConfirmationKeyboard()
  });

  return true;
}

async function sellAll(context) {
  const result = sellAllLootCaseItems(
    Number(context.senderId)
  );

  if (result.status === 'not_found') {
    return sendInventory(context);
  }

  if (result.status === 'balance_limit') {
    await context.send(
      '❌ Баланс достиг технического лимита. Лут остался на складе.'
    );

    return true;
  }

  await context.send({
    message:
      '✅ Весь лут продан!\n\n' +
      `📦 Предметов: ${result.itemCount}\n` +
      `💸 Получено: ${formatMoney(result.earned)} ₽\n` +
      `🏦 Баланс: ${formatMoney(result.balance)} ₽`,
    keyboard: createCasesHomeKeyboard()
  });

  return true;
}

async function claimAsset(context, itemId) {
  const result = claimLootCaseAsset({
    vkId: Number(context.senderId),
    itemId
  });

  if (result.status === 'not_found') {
    await context.send(
      '❌ Предмет уже продан или забран.'
    );

    return true;
  }

  if (result.status === 'not_asset') {
    await context.send(
      '❌ Этот лут нельзя перенести в имущество — его можно оставить или продать.'
    );

    return true;
  }

  if (result.status === 'already_owned') {
    await context.send({
      message:
        '❌ Такое имущество у тебя уже есть.\n\n' +
        'Предмет остался на складе — его можно продать.',
      keyboard: createDropKeyboard(result.item)
    });

    return true;
  }

  await context.send({
    message:
      '✅ Лут перенесён в имущество!\n\n' +
      `🎁 ${result.item.title}\n` +
      (result.item.assetType === 'cars'
        ? '🚗 Машина доступна в профиле, тюнинге и гонках.'
        : '🏠 Недвижимость доступна в профиле и разделе аренды.'),
    keyboard: createCasesHomeKeyboard()
  });

  return true;
}

async function handle(context) {
  const originalText = String(
    context.text ?? ''
  ).trim();
  const payload = context.messagePayload;

  if (payload?.command === 'loot_cases_home') {
    return sendCasesHome(context);
  }

  if (payload?.command === 'loot_case_view') {
    return sendCaseDetails(
      context,
      payload.caseKey
    );
  }

  if (payload?.command === 'loot_case_open') {
    return openCase(
      context,
      payload.caseKey
    );
  }

  if (payload?.command === 'loot_case_keep') {
    return keepLoot(
      context,
      payload.itemId
    );
  }

  if (payload?.command === 'loot_case_inventory') {
    return sendInventory(
      context,
      payload.page
    );
  }

  if (payload?.command === 'loot_case_inventory_item') {
    return sendInventoryItem(
      context,
      payload.itemId,
      payload.page
    );
  }

  if (payload?.command === 'loot_case_sell_item') {
    return sellItem(
      context,
      payload.itemId
    );
  }

  if (payload?.command === 'loot_case_sell_group') {
    return sellGroup(
      context,
      payload.lootKey
    );
  }

  if (payload?.command === 'loot_case_sell_all_request') {
    return requestSellAll(context);
  }

  if (payload?.command === 'loot_case_sell_all_confirm') {
    return sellAll(context);
  }

  if (payload?.command === 'loot_case_claim_asset') {
    return claimAsset(
      context,
      payload.itemId
    );
  }

  if (/^!кейсы?$/i.test(originalText)) {
    return sendCasesHome(context);
  }

  if (
    /^!(?:склад\s+лута|лут)$/i
      .test(originalText)
  ) {
    return sendInventory(context);
  }

  const caseMatch = originalText.match(
    /^!кейс\s+(.+)$/i
  );

  if (caseMatch) {
    return sendCaseDetails(
      context,
      caseMatch[1]
    );
  }

  const openMatch = originalText.match(
    /^!открыть\s+(?:кейс\s+)?(.+?)(?:\s+кейс)?$/i
  );

  if (openMatch && getCase(openMatch[1])) {
    return openCase(
      context,
      openMatch[1]
    );
  }

  return false;
}

module.exports = {
  handle
};
