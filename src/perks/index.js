const crypto = require('node:crypto');
const { Keyboard } = require('vk-io');

const {
  formatMoney,
  getBalance,
  getPerkStatus,
  isPerkActive,
  getActivePerkUserIds,
  purchasePerk,
  consumePerkCharges,
  getMagazineAssets,
  collectAllBusinessIncome,
  collectAllPropertyRent,
  getFarmState,
  harvestFarmCrop
} = require('../database');

const {
  getItem
} = require('../magazine/catalog');

const {
  getCrop,
  getWarehouseCapacity
} = require('../farm/catalog');

const {
  PERKS,
  getPerk
} = require('./catalog');
const {
  getCategoryTaxStatus
} = require('../taxes');

const ASSISTANT_INTERVAL_MS =
  60 * 1000;

let perksVk = null;
let assistantTimer = null;
let assistantRunActive = false;

function formatDuration(milliseconds) {
  let seconds = Math.max(
    0,
    Math.ceil(Number(milliseconds) / 1000)
  );
  const days = Math.floor(seconds / 86_400);
  seconds %= 86_400;
  const hours = Math.floor(seconds / 3_600);
  seconds %= 3_600;
  const minutes = Math.floor(seconds / 60);

  return [
    days > 0 ? `${days} д.` : null,
    hours > 0 ? `${hours} ч.` : null,
    days === 0 && minutes > 0
      ? `${minutes} мин.`
      : null,
    days === 0 && hours === 0 && minutes === 0
      ? 'меньше минуты'
      : null
  ]
    .filter(Boolean)
    .slice(0, 2)
    .join(' ');
}

function getChargeText(perk, status) {
  if (!perk.chargeAmount) {
    return '';
  }

  const value = perk.key === 'insurance'
    ? `${formatMoney(status.charges)} ₽`
    : String(status.charges);

  return `\n🎟 ${perk.chargeTitle}: ${value}`;
}

function getStatusText(perk, vkId) {
  const status = getPerkStatus(
    vkId,
    perk.key
  );

  if (!status.active) {
    return '⚪ Не активен';
  }

  return (
    `🟢 Активен ещё ${formatDuration(status.remainingMs)}` +
    getChargeText(perk, status)
  );
}

function createPerksKeyboard(vkId) {
  const keyboard = Keyboard.builder();

  PERKS.forEach((perk, index) => {
    const active = isPerkActive(
      vkId,
      perk.key
    );

    keyboard.textButton({
      label:
        `${perk.emoji} ${perk.title}` +
        (active ? ' ✅' : ''),
      payload: {
        command: 'perk_view',
        perkKey: perk.key
      },
      color: active
        ? Keyboard.POSITIVE_COLOR
        : Keyboard.PRIMARY_COLOR
    });

    if (
      index % 2 === 1 &&
      index < PERKS.length - 1
    ) {
      keyboard.row();
    }
  });

  return keyboard
    .row()
    .textButton({
      label: '⬅ К командам',
      payload: {
        command: 'commands'
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

function createPerkKeyboard(perk, active) {
  const keyboard = Keyboard.builder();

  if (!active) {
    keyboard
      .textButton({
        label: `🛒 Купить за ${formatMoney(perk.price)} ₽`,
        payload: {
          command: 'perk_buy',
          perkKey: perk.key
        },
        color: Keyboard.POSITIVE_COLOR
      })
      .row();
  }

  return keyboard
    .textButton({
      label: '⬅ Все перки',
      payload: {
        command: 'perks_home'
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

async function sendPerksHome(context) {
  const vkId = Number(context.senderId);
  const balance = getBalance(vkId);
  const lines = PERKS.map(perk =>
    `${perk.emoji} ${perk.title} — ` +
    `${formatMoney(perk.price)} ₽ / ${perk.durationTitle}\n` +
    `   ${getStatusText(perk, vkId)}`
  );

  await context.send({
    message:
      '🧩 Перки Zaffron\n\n' +
      `${lines.join('\n\n')}\n\n` +
      `💵 Баланс: ${formatMoney(balance)} ₽\n\n` +
      'Нажми на перк, чтобы посмотреть его эффект и купить.',
    keyboard: createPerksKeyboard(vkId)
  });

  return true;
}

async function sendPerkDetails(context, perkValue) {
  const perk = getPerk(perkValue);

  if (!perk) {
    await context.send(
      '❌ Такой перк не найден. Открыть список: !перки'
    );

    return true;
  }

  const vkId = Number(context.senderId);
  const status = getPerkStatus(
    vkId,
    perk.key
  );

  await context.send({
    message:
      `${perk.emoji} ${perk.title}\n\n` +
      `${perk.description}\n\n` +
      `💵 Цена: ${formatMoney(perk.price)} ₽\n` +
      `⏳ Срок: ${perk.durationTitle}\n` +
      `${getStatusText(perk, vkId)}\n\n` +
      (status.active
        ? 'Повторная покупка станет доступна только после окончания текущего срока.'
        : 'После покупки эффект включится сразу.'),
    keyboard: createPerkKeyboard(
      perk,
      status.active
    )
  });

  return true;
}

async function buyPerk(context, perkValue) {
  const perk = getPerk(perkValue);

  if (!perk) {
    return sendPerksHome(context);
  }

  const result = purchasePerk({
    vkId: Number(context.senderId),
    perkKey: perk.key,
    price: perk.price,
    durationMs: perk.durationMs,
    chargeAmount: perk.chargeAmount ?? 0
  });

  if (result.status === 'already_active') {
    await context.send({
      message:
        '⏳ Этот перк уже активен.\n\n' +
        `${perk.emoji} ${perk.title}\n` +
        `⏳ Осталось: ${formatDuration(result.remainingMs)}\n\n` +
        'Продлевать перк нельзя. Его можно будет купить снова после окончания срока.',
      keyboard: createPerkKeyboard(perk, true)
    });

    return true;
  }

  if (result.status === 'insufficient_funds') {
    await context.send({
      message:
        '❌ Не хватает денег на перк.\n\n' +
        `${perk.emoji} ${perk.title}\n` +
        `💵 Цена: ${formatMoney(result.price)} ₽\n` +
        `🏦 Баланс: ${formatMoney(result.balance)} ₽\n` +
        `📉 Не хватает: ${formatMoney(result.missing)} ₽`,
      keyboard: createPerkKeyboard(perk, false)
    });

    return true;
  }

  await context.send({
    message:
      '✅ Перк активирован!\n\n' +
      `${perk.emoji} ${perk.title}\n` +
      `⏳ Активен ещё: ${formatDuration(result.remainingMs)}\n` +
      getChargeText(perk, result).trimStart() +
      `\n💵 Баланс: ${formatMoney(result.balance)} ₽`,
    keyboard: createPerkKeyboard(perk, true)
  });

  return true;
}

function getRentalIncomePerHour(
  vkId,
  baseIncome,
  currentTime = Date.now()
) {
  const income = Number(baseIncome);

  if (!Number.isSafeInteger(income) || income < 0) {
    return 0;
  }

  return isPerkActive(
    vkId,
    'housing-upgrade',
    currentTime
  )
    ? Math.floor(income * 110 / 100)
    : income;
}

function getAutoWateringStatus(
  vkId,
  currentTime = Date.now()
) {
  const status = getPerkStatus(
    vkId,
    'auto-watering',
    currentTime
  );

  return {
    ...status,
    available:
      status.active && status.charges > 0
  };
}

function consumeAutoWatering(
  vkId,
  currentTime = Date.now()
) {
  return consumePerkCharges({
    vkId,
    perkKey: 'auto-watering',
    amount: 1,
    currentTime
  });
}

function tryInsuranceRefund(
  vkId,
  lossAmount,
  randomInteger = crypto.randomInt,
  currentTime = Date.now()
) {
  const loss = Number(lossAmount);

  if (!Number.isSafeInteger(loss) || loss <= 0) {
    return {
      status: 'invalid',
      refund: 0
    };
  }

  const insurance = getPerkStatus(
    vkId,
    'insurance',
    currentTime
  );

  if (!insurance.active || insurance.charges <= 0) {
    return {
      status: 'inactive',
      refund: 0
    };
  }

  if (randomInteger(0, 2) !== 0) {
    return {
      status: 'not_triggered',
      refund: 0,
      charges: insurance.charges
    };
  }

  const refund = Math.min(
    loss,
    insurance.charges
  );
  const consumed = consumePerkCharges({
    vkId,
    perkKey: 'insurance',
    amount: refund,
    currentTime
  });

  if (consumed.status !== 'consumed') {
    return {
      status: 'inactive',
      refund: 0
    };
  }

  return {
    status: 'refunded',
    refund,
    charges: consumed.charges
  };
}

function getOwnedIncomeAssets(vkId) {
  const items = getMagazineAssets(vkId)
    .map(asset => getItem(asset.itemKey))
    .filter(Boolean);

  return {
    businesses: items.filter(item =>
      item.categoryKey === 'businesses' &&
      Number.isSafeInteger(item.incomePerHour)
    ),
    properties: items.filter(item =>
      item.categoryKey === 'houses' &&
      Number.isSafeInteger(item.rentPerHour)
    )
  };
}

async function runAssistantForUser(
  vkId,
  currentTime = Date.now()
) {
  if (!isPerkActive(
    vkId,
    'assistant',
    currentTime
  )) {
    return null;
  }

  const assets = getOwnedIncomeAssets(vkId);
  const businessTax = getCategoryTaxStatus(
    vkId,
    'business',
    currentTime
  );
  const propertyTax = getCategoryTaxStatus(
    vkId,
    'property',
    currentTime
  );
  let businessPayout = 0;
  let rentPayout = 0;

  if (
    assets.businesses.length > 0 &&
    !businessTax.overdue
  ) {
    const result = collectAllBusinessIncome({
      vkId,
      businesses: assets.businesses.map(item => ({
        itemKey: item.key,
        baseIncome: item.incomePerHour
      })),
      currentTime
    });

    if (result.status === 'collected') {
      businessPayout = result.payout;
    }
  }

  if (
    assets.properties.length > 0 &&
    !propertyTax.overdue
  ) {
    const result = collectAllPropertyRent({
      vkId,
      properties: assets.properties.map(item => ({
        itemKey: item.key,
        rentPerHour: getRentalIncomePerHour(
          vkId,
          item.rentPerHour,
          currentTime
        )
      })),
      currentTime
    });

    if (result.status === 'collected') {
      rentPayout = result.payout;
    }
  }

  const farmState = getFarmState(vkId);
  const warehouseCapacity =
    getWarehouseCapacity(
      farmState.warehouseLevel
    );
  const harvested = [];

  for (const plot of farmState.plots) {
    if (plot.readyAt > currentTime) {
      continue;
    }

    const result = harvestFarmCrop({
      vkId,
      plotNumber: plot.plotNumber,
      warehouseCapacity,
      currentTime,
      cooldownMs: 0
    });

    if (
      result.status === 'harvested' ||
      result.status === 'failed'
    ) {
      harvested.push({
        ...result,
        plotNumber: plot.plotNumber
      });
    }
  }

  if (harvested.length > 0 && perksVk) {
    const harvestLines = harvested.map(result => {
      const crop = getCrop(result.cropKey);

      return result.status === 'harvested'
        ? `${crop?.emoji ?? '🌾'} Участок №${result.plotNumber}: +${result.quantity} ед.`
        : `😔 Участок №${result.plotNumber}: урожай не вырос`;
    });

    await perksVk.api.messages.send({
      peer_id: vkId,
      random_id: 0,
      message:
        '🤖 Помощник закончил автоматический сбор!\n\n' +
        `${harvestLines.join('\n')}\n` +
        (businessPayout > 0
          ? `\n🏢 С бизнесов: ${formatMoney(businessPayout)} ₽`
          : '') +
        (rentPayout > 0
          ? `\n🏘 С аренды: ${formatMoney(rentPayout)} ₽`
          : '')
    }).catch(error => {
      console.error(
        `Не удалось отправить отчёт помощника игроку ${vkId}:`,
        error?.message ?? error
      );
    });
  }

  return {
    businessPayout,
    rentPayout,
    harvested
  };
}

async function runAssistants() {
  if (assistantRunActive) {
    return;
  }

  assistantRunActive = true;

  try {
    const currentTime = Date.now();
    const userIds = getActivePerkUserIds(
      'assistant',
      currentTime
    );

    for (const vkId of userIds) {
      try {
        await runAssistantForUser(
          vkId,
          currentTime
        );
      } catch (error) {
        console.error(
          `Ошибка помощника игрока ${vkId}:`,
          error?.message ?? error
        );
      }
    }
  } finally {
    assistantRunActive = false;
  }
}

function initialize(vk) {
  perksVk = vk;

  if (assistantTimer) {
    clearInterval(assistantTimer);
  }

  assistantTimer = setInterval(
    () => runAssistants().catch(console.error),
    ASSISTANT_INTERVAL_MS
  );

  assistantTimer.unref?.();
  runAssistants().catch(console.error);
}

async function handle(context) {
  const originalText = String(
    context.text ?? ''
  ).trim();
  const payload = context.messagePayload;

  if (payload?.command === 'perks_home') {
    return sendPerksHome(context);
  }

  if (payload?.command === 'perk_view') {
    return sendPerkDetails(
      context,
      payload.perkKey
    );
  }

  if (payload?.command === 'perk_buy') {
    return buyPerk(
      context,
      payload.perkKey
    );
  }

  if (/^!перки$/i.test(originalText)) {
    return sendPerksHome(context);
  }

  const perkMatch = originalText.match(
    /^!перк\s+(.+)$/i
  );

  if (perkMatch) {
    return sendPerkDetails(
      context,
      perkMatch[1]
    );
  }

  return false;
}

module.exports = {
  handle,
  initialize,
  getRentalIncomePerHour,
  getAutoWateringStatus,
  consumeAutoWatering,
  tryInsuranceRefund,
  runAssistantForUser
};
