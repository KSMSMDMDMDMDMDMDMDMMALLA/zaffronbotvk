const { Keyboard } = require('vk-io');

const {
  formatMoney,
  getBalance,
  getMagazineAssets,
  getCarTuningLevels,
  accrueTaxDebt,
  payTaxDebts
} = require('../database');

const { getItem } = require('../magazine/catalog');
const { calculateCarTuning } = require('../tuning/catalog');
const {
  TAX_PERIOD_MS,
  MAX_ACCRUAL_PERIODS,
  TAX_CATEGORIES,
  getTaxCategory,
  getBusinessTaxBps
} = require('./catalog');

function calculateItemTax(vkId, item, category) {
  let taxableValue = Number(item.price) || 0;
  let bps = 0;

  if (category.key === 'business') {
    bps = getBusinessTaxBps(taxableValue);
  } else if (category.key === 'property') {
    bps = 500;
  } else if (category.key === 'car') {
    const tuning = calculateCarTuning(
      item,
      getCarTuningLevels(vkId, item.key).levels
    );
    taxableValue += tuning.totalSpent;
    bps = 10;
  }

  return {
    item,
    taxableValue,
    bps,
    weeklyTax: Math.ceil(
      taxableValue * bps / 10_000
    )
  };
}

function getCategoryTaxStatus(
  vkId,
  categoryValue,
  currentTime = Date.now()
) {
  const category = getTaxCategory(categoryValue);

  if (!category) {
    throw new Error('Неизвестная категория налога');
  }

  const items = getMagazineAssets(vkId)
    .filter(asset =>
      asset.itemType === category.itemType
    )
    .map(asset => getItem(asset.itemKey))
    .filter(Boolean)
    .map(item =>
      calculateItemTax(vkId, item, category)
    );
  const assetValue = items.reduce(
    (total, item) => total + item.taxableValue,
    0
  );
  const weeklyTax = items.reduce(
    (total, item) => total + item.weeklyTax,
    0
  );
  const account = accrueTaxDebt({
    vkId,
    taxKey: category.key,
    periodAmount: weeklyTax,
    periodMs: TAX_PERIOD_MS,
    maxAccrualPeriods: MAX_ACCRUAL_PERIODS,
    currentTime
  });

  return {
    ...account,
    category,
    items,
    assetCount: items.length,
    assetValue,
    weeklyTax,
    overdue: account.debt > 0
  };
}

function getTaxOverview(
  vkId,
  currentTime = Date.now()
) {
  const categories = TAX_CATEGORIES.map(category =>
    getCategoryTaxStatus(
      vkId,
      category.key,
      currentTime
    )
  );

  return {
    categories,
    totalDebt: categories.reduce(
      (total, item) => total + item.debt,
      0
    ),
    totalWeeklyTax: categories.reduce(
      (total, item) => total + item.weeklyTax,
      0
    )
  };
}

function createTaxesKeyboard(overview) {
  const keyboard = Keyboard.builder();

  overview.categories.forEach((item, index) => {
    keyboard.textButton({
      label:
        `${item.category.emoji} Оплатить ` +
        formatMoney(item.debt),
      payload: {
        command: 'tax_pay',
        taxKey: item.category.key
      },
      color: item.debt > 0
        ? Keyboard.PRIMARY_COLOR
        : Keyboard.SECONDARY_COLOR
    });

    if (index === 1) keyboard.row();
  });

  return keyboard
    .textButton({
      label: '✅ Оплатить всё',
      payload: {
        command: 'tax_pay',
        taxKey: 'all'
      },
      color: Keyboard.POSITIVE_COLOR
    })
    .row()
    .textButton({
      label: '🏛 Казна',
      payload: { command: 'treasury_home' },
      color: Keyboard.SECONDARY_COLOR
    })
    .textButton({
      label: '⬅ К командам',
      payload: { command: 'commands' },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

function createBlockedKeyboard(categoryKey) {
  return Keyboard.builder()
    .textButton({
      label: '🧾 Оплатить налог',
      payload: {
        command: 'tax_pay',
        taxKey: categoryKey
      },
      color: Keyboard.POSITIVE_COLOR
    })
    .textButton({
      label: '🧾 Все налоги',
      payload: { command: 'tax_home' },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

async function blockIfOverdue(
  context,
  vkId,
  categoryKey,
  currentTime = Date.now()
) {
  const status = getCategoryTaxStatus(
    vkId,
    categoryKey,
    currentTime
  );

  if (!status.overdue) return false;

  const consequence = {
    business: 'Выручку бизнесов нельзя забрать.',
    property: 'Аренду нельзя забрать.',
    car: 'Автомобиль нельзя использовать в гонке.'
  }[categoryKey];

  await context.send({
    message:
      '🧾 Есть задолженность по налогам.\n\n' +
      `${status.category.emoji} ${status.category.title}\n` +
      `💸 Долг: ${formatMoney(status.debt)} ₽\n` +
      `📅 Налог в неделю: ${formatMoney(status.weeklyTax)} ₽\n\n` +
      consequence,
    keyboard: createBlockedKeyboard(categoryKey)
  });

  return true;
}

async function sendTaxesHome(context) {
  const vkId = Number(context.senderId);
  const overview = getTaxOverview(vkId);
  const lines = overview.categories.map(item =>
    `${item.category.emoji} ${item.category.title}\n` +
    `   📦 Объектов: ${item.assetCount}\n` +
    `   📅 В неделю: ${formatMoney(item.weeklyTax)} ₽\n` +
    `   🧾 К оплате: ${formatMoney(item.debt)} ₽`
  );

  await context.send({
    message:
      '🧾 Налоги Zaffron\n\n' +
      `${lines.join('\n\n')}\n\n` +
      `💰 Всего в неделю: ${formatMoney(overview.totalWeeklyTax)} ₽\n` +
      `💸 Общий долг: ${formatMoney(overview.totalDebt)} ₽\n` +
      `🏦 Баланс: ${formatMoney(getBalance(vkId))} ₽\n\n` +
      'Налог начисляется один раз в 7 дней и копится максимум за 3 недели.\n' +
      '🏢 Бизнесы: 1–3% от цены.\n' +
      '🏠 Жильё: 5% от цены.\n' +
      '🚗 Авто: 0,1% от цены и тюнинга.',
    keyboard: createTaxesKeyboard(overview)
  });

  return true;
}

async function payTaxes(context, taxKey) {
  const vkId = Number(context.senderId);
  const overview = getTaxOverview(vkId);
  const keys = taxKey === 'all'
    ? TAX_CATEGORIES.map(item => item.key)
    : [getTaxCategory(taxKey)?.key].filter(Boolean);

  if (keys.length === 0) return sendTaxesHome(context);

  const result = payTaxDebts({ vkId, taxKeys: keys });

  if (result.status === 'nothing_due') {
    await context.send({
      message: '✅ По этой категории долгов нет.',
      keyboard: createTaxesKeyboard(overview)
    });
    return true;
  }

  if (result.status === 'insufficient_funds') {
    await context.send({
      message:
        '❌ Не хватает денег на налоги.\n\n' +
        `🧾 К оплате: ${formatMoney(result.amount)} ₽\n` +
        `🏦 Баланс: ${formatMoney(result.balance)} ₽\n` +
        `📉 Не хватает: ${formatMoney(result.missing)} ₽`,
      keyboard: createTaxesKeyboard(overview)
    });
    return true;
  }

  await context.send({
    message:
      '✅ Налоги оплачены!\n\n' +
      `💸 Оплачено: ${formatMoney(result.amount)} ₽\n` +
      `🏦 Баланс: ${formatMoney(result.balance)} ₽\n` +
      '🏛 Деньги поступили в казну.',
    keyboard: createTaxesKeyboard(
      getTaxOverview(vkId)
    )
  });
  return true;
}

async function handle(context) {
  const text = String(context.text ?? '').trim();
  const payload = context.messagePayload;

  if (
    payload?.command === 'tax_home' ||
    /^!налоги$/i.test(text)
  ) {
    return sendTaxesHome(context);
  }

  if (payload?.command === 'tax_pay') {
    return payTaxes(context, payload.taxKey);
  }

  return false;
}

module.exports = {
  handle,
  getCategoryTaxStatus,
  getTaxOverview,
  blockIfOverdue
};
