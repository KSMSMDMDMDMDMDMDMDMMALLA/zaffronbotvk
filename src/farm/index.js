const crypto = require('node:crypto');
const { Keyboard } = require('vk-io');

const {
  formatMoney,
  getBalance,
  getFarmState,
  getPendingFarmNotifications,
  claimFarmHarvestNotification,
  purchaseFarmPlot,
  purchaseFarmSeeds,
  plantFarmCrop,
  harvestFarmCrop,
  upgradeFarm,
  sellFarmProduce,
  sellAllFarmProduce
} = require('../database');

const {
  CROPS,
  UPGRADES,
  FARM_MAX_PLOTS,
  FARM_MAX_UPGRADE_LEVEL,
  FARM_PLANT_COOLDOWN_MS,
  FARM_HARVEST_COOLDOWN_MS,
  getCrop,
  getUpgrade,
  getPlotPrice,
  getWarehouseCapacity,
  getCropChances,
  getCropGrowTime,
  getCropYieldRange
} = require('./catalog');

const CROP_PAGE_SIZE = 6;
const CUSTOM_SEED_MAX_QUANTITY = 1000;
const CUSTOM_SEED_INPUT_TTL_MS =
  2 * 60 * 1000;

const pendingSeedPurchases = new Map();
const pendingPlantings = new Map();
const scheduledHarvestNotifications =
  new Map();

let farmVk = null;

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

function formatDuration(milliseconds) {
  let seconds = Math.max(
    0,
    Math.ceil(Number(milliseconds) / 1000)
  );
  const days = Math.floor(seconds / 86400);
  seconds %= 86400;
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;

  return [
    days > 0 ? `${days} д.` : null,
    hours > 0 ? `${hours} ч.` : null,
    minutes > 0 ? `${minutes} мин.` : null,
    seconds > 0 || (days === 0 && hours === 0 && minutes === 0)
      ? `${seconds} сек.`
      : null
  ]
    .filter(Boolean)
    .slice(0, 2)
    .join(' ');
}

function getNotificationKey(
  vkId,
  plotNumber
) {
  return `${vkId}:${plotNumber}`;
}

function createHarvestNotificationKeyboard(
  plotNumber
) {
  return Keyboard.builder()
    .textButton({
      label: '🧺 Собрать урожай',
      payload: {
        command: 'farm_harvest',
        plotNumber
      },
      color: Keyboard.POSITIVE_COLOR
    })
    .textButton({
      label: '🚜 Открыть ферму',
      payload: {
        command: 'farm_home'
      },
      color: Keyboard.PRIMARY_COLOR
    })
    .inline();
}

async function sendHarvestNotification(
  notification
) {
  const result = claimFarmHarvestNotification({
    vkId: notification.vkId,
    plotNumber: notification.plotNumber
  });

  if (result.status === 'too_early') {
    scheduleHarvestNotification({
      ...notification,
      readyAt: result.readyAt
    });

    return;
  }

  if (
    result.status !== 'claimed' ||
    !farmVk
  ) {
    return;
  }

  const crop = getCrop(result.cropKey);

  try {
    await farmVk.api.messages.send({
      peer_id: result.vkId,
      random_id: 0,
      message:
        '🌾 Урожай созрел!\n\n' +
        `🗺 Участок №${result.plotNumber}\n` +
        `${crop?.emoji ?? '🌱'} ${crop?.title ?? result.cropKey}\n\n` +
        `🌱 Посажено семян: ${result.seedQuantity}\n\n` +
        'Урожай можно собрать прямо сейчас.',
      keyboard:
        createHarvestNotificationKeyboard(
          result.plotNumber
        )
    });
  } catch (error) {
    console.error(
      `Не удалось отправить уведомление фермы игроку ${result.vkId}:`,
      error?.message ?? error
    );
  }
}

function scheduleHarvestNotification(
  notification
) {
  if (!farmVk || !notification) {
    return;
  }

  const key = getNotificationKey(
    notification.vkId,
    notification.plotNumber
  );

  if (scheduledHarvestNotifications.has(key)) {
    return;
  }

  const delay = Math.max(
    0,
    Number(notification.readyAt) -
    Date.now()
  );
  const timer = setTimeout(
    async () => {
      scheduledHarvestNotifications.delete(key);

      await sendHarvestNotification(
        notification
      );
    },
    delay
  );

  scheduledHarvestNotifications.set(
    key,
    timer
  );
}

function initialize(vk) {
  farmVk = vk;

  for (
    const notification of
    getPendingFarmNotifications()
  ) {
    scheduleHarvestNotification(notification);
  }
}

function getSeedCount(state, cropKey) {
  return state.seeds.find(item =>
    item.cropKey === cropKey
  )?.quantity ?? 0;
}

function getStorageCount(state, cropKey) {
  return state.storage.find(item =>
    item.cropKey === cropKey
  )?.quantity ?? 0;
}

function getPlot(state, plotNumber) {
  return state.plots.find(plot =>
    plot.plotNumber === Number(plotNumber)
  ) ?? null;
}

function getPlotStatus(plot, currentTime) {
  if (!plot) {
    return 'empty';
  }

  return plot.readyAt <= currentTime
    ? 'ready'
    : 'growing';
}

function createFarmHomeKeyboard(state) {
  const keyboard = Keyboard.builder();

  if (state.plotCount === 0) {
    return keyboard
      .textButton({
        label: '🗺 Купить первый участок',
        payload: {
          command: 'farm_buy_plot'
        },
        color: Keyboard.POSITIVE_COLOR
      })
      .inline();
  }

  keyboard
    .textButton({
      label: '🌾 Участки',
      payload: {
        command: 'farm_plots'
      },
      color: Keyboard.POSITIVE_COLOR
    })
    .textButton({
      label: '📦 Склад',
      payload: {
        command: 'farm_storage'
      },
      color: Keyboard.PRIMARY_COLOR
    })
    .row()
    .textButton({
      label: '🛒 Семена',
      payload: {
        command: 'farm_seed_shop'
      },
      color: Keyboard.PRIMARY_COLOR
    })
    .textButton({
      label: '⬆ Улучшения',
      payload: {
        command: 'farm_upgrades'
      },
      color: Keyboard.SECONDARY_COLOR
    });

  if (state.plotCount < FARM_MAX_PLOTS) {
    keyboard
      .row()
      .textButton({
        label: `🗺 Купить участок №${state.plotCount + 1}`,
        payload: {
          command: 'farm_buy_plot'
        },
        color: Keyboard.POSITIVE_COLOR
      });
  }

  return keyboard.inline();
}

function createHomeButton() {
  return Keyboard.builder()
    .textButton({
      label: '⬅ На ферму',
      payload: {
        command: 'farm_home'
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

function createPlotsKeyboard(state, currentTime) {
  const keyboard = Keyboard.builder();

  for (
    let plotNumber = 1;
    plotNumber <= state.plotCount;
    plotNumber += 1
  ) {
    const plot = getPlot(state, plotNumber);
    const crop = plot
      ? getCrop(plot.cropKey)
      : null;
    const status = getPlotStatus(
      plot,
      currentTime
    );
    const label = status === 'empty'
      ? `🌱 №${plotNumber} Свободен`
      : status === 'ready'
        ? `✅ №${plotNumber} ${crop?.title ?? 'Урожай'}`
        : `⏳ №${plotNumber} ${crop?.title ?? 'Растёт'}`;

    keyboard.textButton({
      label,
      payload: {
        command: 'farm_plot',
        plotNumber
      },
      color: status === 'ready'
        ? Keyboard.POSITIVE_COLOR
        : status === 'growing'
          ? Keyboard.PRIMARY_COLOR
          : Keyboard.SECONDARY_COLOR
    });

    if (
      plotNumber % 2 === 0 &&
      plotNumber < state.plotCount
    ) {
      keyboard.row();
    }
  }

  keyboard
    .row()
    .textButton({
      label: '🔄 Обновить',
      payload: {
        command: 'farm_plots'
      },
      color: Keyboard.PRIMARY_COLOR
    })
    .textButton({
      label: '⬅ На ферму',
      payload: {
        command: 'farm_home'
      },
      color: Keyboard.SECONDARY_COLOR
    });

  return keyboard.inline();
}

function createCropPickerKeyboard(
  crops,
  plotNumber,
  page
) {
  const keyboard = Keyboard.builder();
  const totalPages = Math.max(
    1,
    Math.ceil(crops.length / CROP_PAGE_SIZE)
  );
  const safePage = normalizePage(
    page,
    totalPages
  );
  const pageItems = crops.slice(
    safePage * CROP_PAGE_SIZE,
    (safePage + 1) * CROP_PAGE_SIZE
  );

  pageItems.forEach((crop, index) => {
    keyboard.textButton({
      label: `${crop.emoji} ${crop.title}`,
      payload: {
        command: 'farm_crop_open',
        cropKey: crop.key,
        plotNumber
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

  if (totalPages > 1) {
    keyboard.row();
  }

  if (safePage > 0) {
    keyboard.textButton({
      label: '⬅ Назад',
      payload: {
        command: 'farm_crop_picker',
        plotNumber,
        page: safePage - 1
      },
      color: Keyboard.SECONDARY_COLOR
    });
  }

  if (safePage < totalPages - 1) {
    keyboard.textButton({
      label: 'Вперёд ➡',
      payload: {
        command: 'farm_crop_picker',
        plotNumber,
        page: safePage + 1
      },
      color: Keyboard.PRIMARY_COLOR
    });
  }

  keyboard
    .row()
    .textButton({
      label: '⬅ К участкам',
      payload: {
        command: 'farm_plots'
      },
      color: Keyboard.SECONDARY_COLOR
    });

  return keyboard.inline();
}

function createCropCardKeyboard(
  crop,
  plotNumber,
  seedCount
) {
  const keyboard = Keyboard.builder();
  const maxQuantity = Math.min(
    seedCount,
    crop.maxSeedsPerPlot
  );

  if (maxQuantity > 0) {
    keyboard.textButton({
      label: '🌱 Посадить 1',
      payload: {
        command: 'farm_plant',
        cropKey: crop.key,
        plotNumber,
        quantity: 1
      },
      color: Keyboard.POSITIVE_COLOR
    });

    if (maxQuantity >= 10) {
      keyboard.textButton({
        label: '🌾 Посадить 10',
        payload: {
          command: 'farm_plant',
          cropKey: crop.key,
          plotNumber,
          quantity: 10
        },
        color: Keyboard.PRIMARY_COLOR
      });
    }

    if (maxQuantity > 1) {
      keyboard
        .row()
        .textButton({
          label: '✏ Своё количество',
          payload: {
            command: 'farm_plant_custom',
            cropKey: crop.key,
            plotNumber
          },
          color: Keyboard.SECONDARY_COLOR
        });
    }
  }

  keyboard
    .row()
    .textButton({
      label: '🛒 Купить семена',
      payload: {
        command: 'farm_seed_open',
        cropKey: crop.key
      },
      color: Keyboard.PRIMARY_COLOR
    })
    .row()
    .textButton({
      label: '⬅ Выбрать культуру',
      payload: {
        command: 'farm_crop_picker',
        plotNumber
      },
      color: Keyboard.SECONDARY_COLOR
    });

  return keyboard.inline();
}

function createCustomPlantKeyboard(
  crop,
  plotNumber
) {
  return Keyboard.builder()
    .textButton({
      label: '❌ Отменить ввод',
      payload: {
        command: 'farm_plant_custom_cancel',
        cropKey: crop.key,
        plotNumber
      },
      color: Keyboard.NEGATIVE_COLOR
    })
    .textButton({
      label: '⬅ К посадке',
      payload: {
        command: 'farm_crop_open',
        cropKey: crop.key,
        plotNumber
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

function createGrowingPlotKeyboard(
  plotNumber,
  isReady
) {
  const keyboard = Keyboard.builder();

  if (isReady) {
    keyboard.textButton({
      label: '🧺 Собрать урожай',
      payload: {
        command: 'farm_harvest',
        plotNumber
      },
      color: Keyboard.POSITIVE_COLOR
    });
  } else {
    keyboard.textButton({
      label: '🔄 Проверить рост',
      payload: {
        command: 'farm_plot',
        plotNumber
      },
      color: Keyboard.PRIMARY_COLOR
    });
  }

  return keyboard
    .row()
    .textButton({
      label: '⬅ К участкам',
      payload: {
        command: 'farm_plots'
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

function createHarvestResultKeyboard(plotNumber) {
  return Keyboard.builder()
    .textButton({
      label: '🌱 Засеять участок снова',
      payload: {
        command: 'farm_plot',
        plotNumber
      },
      color: Keyboard.POSITIVE_COLOR
    })
    .row()
    .textButton({
      label: '📦 Открыть склад',
      payload: {
        command: 'farm_storage'
      },
      color: Keyboard.PRIMARY_COLOR
    })
    .textButton({
      label: '⬅ К участкам',
      payload: {
        command: 'farm_plots'
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

function createSeedShopKeyboard(crops, page) {
  const keyboard = Keyboard.builder();
  const totalPages = Math.max(
    1,
    Math.ceil(crops.length / CROP_PAGE_SIZE)
  );
  const safePage = normalizePage(
    page,
    totalPages
  );
  const pageItems = crops.slice(
    safePage * CROP_PAGE_SIZE,
    (safePage + 1) * CROP_PAGE_SIZE
  );

  pageItems.forEach((crop, index) => {
    keyboard.textButton({
      label: `${crop.emoji} ${crop.title}`,
      payload: {
        command: 'farm_seed_open',
        cropKey: crop.key
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

  keyboard.row();

  if (safePage > 0) {
    keyboard.textButton({
      label: '⬅ Назад',
      payload: {
        command: 'farm_seed_shop',
        page: safePage - 1
      },
      color: Keyboard.SECONDARY_COLOR
    });
  }

  if (safePage < totalPages - 1) {
    keyboard.textButton({
      label: 'Вперёд ➡',
      payload: {
        command: 'farm_seed_shop',
        page: safePage + 1
      },
      color: Keyboard.PRIMARY_COLOR
    });
  }

  keyboard
    .row()
    .textButton({
      label: '⬅ На ферму',
      payload: {
        command: 'farm_home'
      },
      color: Keyboard.SECONDARY_COLOR
    });

  return keyboard.inline();
}

function createSeedCardKeyboard(crop, unlocked) {
  const keyboard = Keyboard.builder();

  if (unlocked) {
    keyboard
      .textButton({
        label: '🛒 Купить 1 семя',
        payload: {
          command: 'farm_seed_buy',
          cropKey: crop.key,
          quantity: 1
        },
        color: Keyboard.POSITIVE_COLOR
      })
      .textButton({
        label: '🛒 Купить 10 семян',
        payload: {
          command: 'farm_seed_buy',
          cropKey: crop.key,
          quantity: 10
        },
        color: Keyboard.PRIMARY_COLOR
      })
      .row()
      .textButton({
        label: '✏ Своё количество',
        payload: {
          command: 'farm_seed_custom',
          cropKey: crop.key
        },
        color: Keyboard.SECONDARY_COLOR
      });
  }

  return keyboard
    .row()
    .textButton({
      label: '⬅ В магазин семян',
      payload: {
        command: 'farm_seed_shop'
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

function createCustomSeedKeyboard(crop) {
  return Keyboard.builder()
    .textButton({
      label: '❌ Отменить ввод',
      payload: {
        command: 'farm_seed_custom_cancel',
        cropKey: crop.key
      },
      color: Keyboard.NEGATIVE_COLOR
    })
    .textButton({
      label: '⬅ К семенам',
      payload: {
        command: 'farm_seed_open',
        cropKey: crop.key
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

function createStorageKeyboard(items) {
  const keyboard = Keyboard.builder();

  items.forEach((item, index) => {
    keyboard.textButton({
      label: `💰 ${item.crop.title}`,
      payload: {
        command: 'farm_sell_crop',
        cropKey: item.crop.key
      },
      color: Keyboard.POSITIVE_COLOR
    });

    if (
      index % 2 === 1 &&
      index < items.length - 1
    ) {
      keyboard.row();
    }
  });

  if (items.length > 0) {
    keyboard
      .row()
      .textButton({
        label: '💵 Продать весь урожай',
        payload: {
          command: 'farm_sell_all'
        },
        color: Keyboard.POSITIVE_COLOR
      });
  }

  return keyboard
    .row()
    .textButton({
      label: '⬆ Улучшить склад',
      payload: {
        command: 'farm_upgrades'
      },
      color: Keyboard.PRIMARY_COLOR
    })
    .textButton({
      label: '⬅ На ферму',
      payload: {
        command: 'farm_home'
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

function createUpgradesKeyboard(state) {
  const keyboard = Keyboard.builder();
  const entries = Object.values(UPGRADES);

  entries.forEach((upgrade, index) => {
    const stateField = `${upgrade.key}Level`;

    if (
      state[stateField] <
      FARM_MAX_UPGRADE_LEVEL
    ) {
      keyboard.textButton({
        label: `${upgrade.emoji} Улучшить ${upgrade.title}`,
        payload: {
          command: 'farm_upgrade',
          upgradeKey: upgrade.key
        },
        color: Keyboard.POSITIVE_COLOR
      });

      if (index < entries.length - 1) {
        keyboard.row();
      }
    }
  });

  return keyboard
    .row()
    .textButton({
      label: '⬅ На ферму',
      payload: {
        command: 'farm_home'
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

function createWarehouseFullKeyboard(plotNumber) {
  return Keyboard.builder()
    .textButton({
      label: '💵 Продать урожай',
      payload: {
        command: 'farm_storage'
      },
      color: Keyboard.POSITIVE_COLOR
    })
    .textButton({
      label: '⬆ Улучшить склад',
      payload: {
        command: 'farm_upgrades'
      },
      color: Keyboard.PRIMARY_COLOR
    })
    .row()
    .textButton({
      label: '⬅ К участку',
      payload: {
        command: 'farm_plot',
        plotNumber
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

async function sendFarmHome(context) {
  const vkId = Number(context.senderId);
  const state = getFarmState(vkId);
  const nextPlotPrice = getPlotPrice(
    state.plotCount
  );

  if (state.plotCount === 0) {
    await context.send({
      message:
        '🚜 Ферма Zaffron\n\n' +
        'Здесь своя экономика: покупай участки и семена, выбирай риск и время роста, собирай урожай на склад и продавай его за рубли.\n\n' +
        '🌱 У каждой культуры свой шанс всходов.\n' +
        '🌿 Даже взошедшее растение должно успешно созреть.\n' +
        '💧 Полив повышает шансы и ускоряет рост.\n' +
        '🪱 Почва увеличивает урожайность.\n\n' +
        `🗺 Первый участок: ${formatMoney(nextPlotPrice)} ₽\n` +
        `🏦 Баланс: ${formatMoney(getBalance(vkId))} ₽`,
      keyboard: createFarmHomeKeyboard(state)
    });

    return true;
  }

  const currentTime = Date.now();
  const readyCount = state.plots.filter(
    plot => plot.readyAt <= currentTime
  ).length;
  const growingCount =
    state.plots.length - readyCount;
  const freeCount =
    state.plotCount - state.plots.length;
  const capacity = getWarehouseCapacity(
    state.warehouseLevel
  );

  await context.send({
    message:
      '🚜 Твоя ферма\n\n' +
      `🗺 Участки: ${state.plotCount}/${FARM_MAX_PLOTS}\n` +
      `🌱 Свободно: ${freeCount}\n` +
      `⏳ Растёт: ${growingCount}\n` +
      `✅ Готово к сбору: ${readyCount}\n\n` +
      `📦 Склад: ${state.storageUsed}/${capacity}\n` +
      `💧 Полив: ${state.irrigationLevel}/${FARM_MAX_UPGRADE_LEVEL}\n` +
      `🪱 Почва: ${state.soilLevel}/${FARM_MAX_UPGRADE_LEVEL}\n` +
      `💵 Заработано фермой: ${formatMoney(state.totalEarned)} ₽\n` +
      `🏦 Баланс: ${formatMoney(getBalance(vkId))} ₽` +
      (nextPlotPrice === null
        ? '\n\n🏆 Куплены все участки.'
        : `\n\n🗺 Следующий участок: ${formatMoney(nextPlotPrice)} ₽`),
    keyboard: createFarmHomeKeyboard(state)
  });

  return true;
}

async function buyPlot(context) {
  const vkId = Number(context.senderId);
  const state = getFarmState(vkId);
  const price = getPlotPrice(state.plotCount);

  if (price === null) {
    await context.send({
      message:
        '🏆 У тебя уже максимальное количество участков.',
      keyboard: createFarmHomeKeyboard(state)
    });

    return true;
  }

  const result = purchaseFarmPlot({
    vkId,
    price
  });

  if (result.status === 'insufficient_funds') {
    await context.send({
      message:
        '❌ Не хватает денег на участок.\n\n' +
        `🗺 Цена: ${formatMoney(result.price)} ₽\n` +
        `🏦 Баланс: ${formatMoney(result.balance)} ₽\n` +
        `📉 Не хватает: ${formatMoney(result.missing)} ₽`,
      keyboard: createFarmHomeKeyboard(state)
    });

    return true;
  }

  const newState = getFarmState(vkId);

  await context.send({
    message:
      '✅ Новый участок куплен!\n\n' +
      `🗺 Участок №${result.plotCount}\n` +
      `💵 Потрачено: ${formatMoney(result.price)} ₽\n` +
      `🏦 Баланс: ${formatMoney(result.balance)} ₽\n\n` +
      'Теперь купи семена и выбери свободный участок.',
    keyboard: createFarmHomeKeyboard(newState)
  });

  return true;
}

async function sendPlots(context) {
  const vkId = Number(context.senderId);
  const state = getFarmState(vkId);

  if (state.plotCount === 0) {
    return sendFarmHome(context);
  }

  const currentTime = Date.now();
  const lines = [];

  for (
    let plotNumber = 1;
    plotNumber <= state.plotCount;
    plotNumber += 1
  ) {
    const plot = getPlot(state, plotNumber);

    if (!plot) {
      lines.push(
        `🌱 Участок №${plotNumber} — свободен`
      );
      continue;
    }

    const crop = getCrop(plot.cropKey);

    if (plot.readyAt <= currentTime) {
      lines.push(
        `✅ Участок №${plotNumber} — ${crop?.emoji ?? '🌾'} ${crop?.title ?? 'урожай'} готов`
      );
    } else {
      lines.push(
        `⏳ Участок №${plotNumber} — ${crop?.emoji ?? '🌾'} ${crop?.title ?? 'урожай'}\n` +
        `   Осталось: ${formatDuration(plot.readyAt - currentTime)}`
      );
    }
  }

  await context.send({
    message:
      '🌾 Участки фермы\n\n' +
      `${lines.join('\n\n')}\n\n` +
      'Нажми на свободный участок для посадки или на готовый — для сбора.',
    keyboard: createPlotsKeyboard(
      state,
      currentTime
    )
  });

  return true;
}

async function openPlot(context, plotNumber) {
  const vkId = Number(context.senderId);
  const safePlotNumber = Number(plotNumber);
  const state = getFarmState(vkId);

  if (
    !Number.isInteger(safePlotNumber) ||
    safePlotNumber < 1 ||
    safePlotNumber > state.plotCount
  ) {
    await context.send({
      message: '❌ Такой участок ещё не куплен.',
      keyboard: createHomeButton()
    });

    return true;
  }

  const plot = getPlot(
    state,
    safePlotNumber
  );

  if (!plot) {
    return sendCropPicker(
      context,
      safePlotNumber
    );
  }

  const crop = getCrop(plot.cropKey);
  const currentTime = Date.now();
  const ready = plot.readyAt <= currentTime;

  await context.send({
    message:
      `🗺 Участок №${safePlotNumber}\n\n` +
      `${crop?.emoji ?? '🌾'} Культура: ${crop?.title ?? plot.cropKey}\n` +
      `🌱 Посажено семян: ${plot.seedQuantity}\n` +
      (ready
        ? '✅ Урожай созрел и готов к сбору.\n' +
          `📦 На складе свободно: ${getWarehouseCapacity(state.warehouseLevel) - state.storageUsed}`
        : '⏳ Урожай растёт.\n' +
          `🕒 До сбора: ${formatDuration(plot.readyAt - currentTime)}\n` +
          '🎲 Результат выращивания откроется только при сборе.'),
    keyboard: createGrowingPlotKeyboard(
      safePlotNumber,
      ready
    )
  });

  return true;
}

async function sendCropPicker(
  context,
  plotNumber,
  requestedPage = 0
) {
  const vkId = Number(context.senderId);
  const safePlotNumber = Number(plotNumber);
  const state = getFarmState(vkId);

  if (
    !Number.isInteger(safePlotNumber) ||
    safePlotNumber < 1 ||
    safePlotNumber > state.plotCount
  ) {
    return sendPlots(context);
  }

  if (getPlot(state, safePlotNumber)) {
    return openPlot(context, safePlotNumber);
  }

  const unlockedCrops = CROPS.filter(crop =>
    crop.requiredPlots <= state.plotCount
  );
  const totalPages = Math.max(
    1,
    Math.ceil(
      unlockedCrops.length /
      CROP_PAGE_SIZE
    )
  );
  const page = normalizePage(
    requestedPage,
    totalPages
  );
  const pageItems = unlockedCrops.slice(
    page * CROP_PAGE_SIZE,
    (page + 1) * CROP_PAGE_SIZE
  );
  const lines = pageItems.map(crop => {
    const chances = getCropChances(
      crop,
      state.irrigationLevel
    );

    return (
      `${crop.emoji} ${crop.title}\n` +
      `   🎒 Семян: ${getSeedCount(state, crop.key)}\n` +
      `   🎯 Итоговый шанс: ${chances.total}%\n` +
      `   ⏳ Рост: ${formatDuration(getCropGrowTime(crop, state.irrigationLevel))}`
    );
  });

  await context.send({
    message:
      `🌱 Посадка на участке №${safePlotNumber}\n\n` +
      (totalPages > 1
        ? `📄 Страница ${page + 1}/${totalPages}\n\n`
        : '') +
      `${lines.join('\n\n')}\n\n` +
      'Выбери культуру кнопкой.',
    keyboard: createCropPickerKeyboard(
      unlockedCrops,
      safePlotNumber,
      page
    )
  });

  return true;
}

async function openCrop(
  context,
  cropKey,
  plotNumber
) {
  const vkId = Number(context.senderId);
  const crop = getCrop(cropKey);
  const state = getFarmState(vkId);
  const safePlotNumber = Number(plotNumber);

  if (!crop) {
    return sendPlots(context);
  }

  if (
    !Number.isInteger(safePlotNumber) ||
    safePlotNumber < 1 ||
    safePlotNumber > state.plotCount ||
    getPlot(state, safePlotNumber)
  ) {
    return openPlot(context, safePlotNumber);
  }

  if (state.plotCount < crop.requiredPlots) {
    await context.send({
      message:
        `🔒 ${crop.title} откроется после покупки ${crop.requiredPlots}-го участка.`,
      keyboard: createHomeButton()
    });

    return true;
  }

  const chances = getCropChances(
    crop,
    state.irrigationLevel
  );
  const yieldRange = getCropYieldRange(
    crop,
    state.soilLevel
  );
  const seedCount = getSeedCount(
    state,
    crop.key
  );

  await context.send({
    message:
      `${crop.emoji} ${crop.title} — участок №${safePlotNumber}\n\n` +
      `🌱 Шанс всходов: ${chances.germination}%\n` +
      `🌿 Шанс созревания: ${chances.growth}%\n` +
      `🎯 Итоговый шанс урожая: ${chances.total}%\n` +
      `🧺 С одного семени: ${yieldRange.min}–${yieldRange.max} ед.\n` +
      `💵 Выручка с одного: ${formatMoney(yieldRange.min * crop.sellPrice)}–${formatMoney(yieldRange.max * crop.sellPrice)} ₽\n` +
      `🌾 Лимит участка: ${crop.maxSeedsPerPlot} семян\n` +
      `🏆 Потолок участка: ${formatMoney(yieldRange.max * crop.maxSeedsPerPlot * crop.sellPrice)} ₽\n` +
      `⏳ Время роста: ${formatDuration(getCropGrowTime(crop, state.irrigationLevel))}\n\n` +
      `🛒 Цена семени: ${formatMoney(crop.seedPrice)} ₽\n` +
      `💰 Продажа урожая: ${formatMoney(crop.sellPrice)} ₽/ед.\n` +
      `🎒 Семян у тебя: ${seedCount}\n\n` +
      (seedCount > 0
        ? 'Выбери количество посадки. Каждое семя получит отдельный шанс на урожай.'
        : 'Сначала купи семена этой культуры.'),
    keyboard: createCropCardKeyboard(
      crop,
      safePlotNumber,
      seedCount
    )
  });

  return true;
}

async function requestCustomPlantQuantity(
  context,
  cropKey,
  plotNumber
) {
  const vkId = Number(context.senderId);
  const crop = getCrop(cropKey);
  const state = getFarmState(vkId);
  const safePlotNumber = Number(plotNumber);

  if (
    !crop ||
    !Number.isInteger(safePlotNumber) ||
    safePlotNumber < 1 ||
    safePlotNumber > state.plotCount ||
    getPlot(state, safePlotNumber)
  ) {
    return openPlot(context, safePlotNumber);
  }

  if (state.plotCount < crop.requiredPlots) {
    return openCrop(
      context,
      crop.key,
      safePlotNumber
    );
  }

  const seedCount = getSeedCount(
    state,
    crop.key
  );
  const maxQuantity = Math.min(
    seedCount,
    crop.maxSeedsPerPlot
  );

  if (maxQuantity <= 0) {
    return openCrop(
      context,
      crop.key,
      safePlotNumber
    );
  }

  pendingSeedPurchases.delete(vkId);
  pendingPlantings.set(vkId, {
    cropKey: crop.key,
    plotNumber: safePlotNumber,
    maxQuantity,
    expiresAt:
      Date.now() +
      CUSTOM_SEED_INPUT_TTL_MS
  });

  await context.send({
    message:
      `✏ Посадка: ${crop.emoji} ${crop.title}\n\n` +
      `🗺 Участок №${safePlotNumber}\n` +
      `🎒 Семян в запасе: ${seedCount}\n` +
      `🌾 Лимит этой культуры: ${crop.maxSeedsPerPlot} на участок\n\n` +
      `Введи количество от 1 до ${maxQuantity} одним сообщением.\n` +
      'На ввод даётся 2 минуты.',
    keyboard: createCustomPlantKeyboard(
      crop,
      safePlotNumber
    )
  });

  return true;
}

async function handleCustomPlantInput(
  context,
  pending,
  originalText
) {
  const vkId = Number(context.senderId);
  const crop = getCrop(pending.cropKey);

  if (!crop) {
    pendingPlantings.delete(vkId);
    return sendPlots(context);
  }

  if (!/^\d+$/.test(originalText)) {
    await context.send({
      message:
        '❌ Отправь только целое число.\n\n' +
        `Допустимое количество: от 1 до ${pending.maxQuantity}.`,
      keyboard: createCustomPlantKeyboard(
        crop,
        pending.plotNumber
      )
    });

    return true;
  }

  const quantity = Number(originalText);

  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > pending.maxQuantity
  ) {
    await context.send({
      message:
        '❌ Столько семян нельзя разместить на этом участке.\n\n' +
        `Введи число от 1 до ${pending.maxQuantity}.`,
      keyboard: createCustomPlantKeyboard(
        crop,
        pending.plotNumber
      )
    });

    return true;
  }

  pendingPlantings.delete(vkId);

  return plantCrop(
    context,
    crop.key,
    pending.plotNumber,
    quantity
  );
}

async function plantCrop(
  context,
  cropKey,
  plotNumber,
  quantityValue = 1
) {
  const vkId = Number(context.senderId);
  const crop = getCrop(cropKey);
  const state = getFarmState(vkId);
  const safePlotNumber = Number(plotNumber);
  const seedQuantity = Number(quantityValue);

  if (!crop) {
    return sendPlots(context);
  }

  if (state.plotCount < crop.requiredPlots) {
    return openCrop(
      context,
      crop.key,
      safePlotNumber
    );
  }

  const seedCount = getSeedCount(
    state,
    crop.key
  );

  if (
    !Number.isInteger(seedQuantity) ||
    seedQuantity < 1 ||
    seedQuantity > crop.maxSeedsPerPlot
  ) {
    return requestCustomPlantQuantity(
      context,
      crop.key,
      safePlotNumber
    );
  }

  if (seedCount < seedQuantity) {
    await context.send({
      message:
        '❌ Не хватает семян для такой посадки.\n\n' +
        `🌱 Нужно: ${seedQuantity}\n` +
        `🎒 В запасе: ${seedCount}`,
      keyboard: createCropCardKeyboard(
        crop,
        safePlotNumber,
        seedCount
      )
    });

    return true;
  }

  const chances = getCropChances(
    crop,
    state.irrigationLevel
  );
  const yieldRange = getCropYieldRange(
    crop,
    state.soilLevel
  );
  let germinatedCount = 0;
  let maturedCount = 0;
  let yieldAmount = 0;

  for (
    let seed = 0;
    seed < seedQuantity;
    seed += 1
  ) {
    const germinated =
      crypto.randomInt(1, 101) <=
      chances.germination;

    if (!germinated) {
      continue;
    }

    germinatedCount += 1;

    const matured =
      crypto.randomInt(1, 101) <=
      chances.growth;

    if (!matured) {
      continue;
    }

    maturedCount += 1;
    yieldAmount += crypto.randomInt(
      yieldRange.min,
      yieldRange.max + 1
    );
  }

  const resultCode = maturedCount > 0
    ? 'success'
    : germinatedCount > 0
      ? 'withered'
      : 'not_sprouted';
  const currentTime = Date.now();
  const growTime = getCropGrowTime(
    crop,
    state.irrigationLevel
  );
  const result = plantFarmCrop({
    vkId,
    plotNumber: safePlotNumber,
    cropKey: crop.key,
    seedQuantity,
    requiredPlots: crop.requiredPlots,
    currentTime,
    readyAt: currentTime + growTime,
    resultCode,
    yieldAmount,
    cooldownMs: FARM_PLANT_COOLDOWN_MS
  });

  if (result.status === 'cooldown') {
    await context.send({
      message:
        '⏳ После предыдущей посадки нужно немного подождать.\n\n' +
        `🌱 Новая посадка через: ${formatDuration(result.remainingMs)}`,
      keyboard: createCropCardKeyboard(
        crop,
        safePlotNumber,
        seedCount
      )
    });

    return true;
  }

  if (result.status === 'insufficient_seeds') {
    return openCrop(
      context,
      crop.key,
      safePlotNumber
    );
  }

  if (
    result.status === 'plot_occupied' ||
    result.status === 'plot_locked'
  ) {
    return openPlot(context, safePlotNumber);
  }

  scheduleHarvestNotification({
    vkId,
    plotNumber: result.plotNumber,
    cropKey: result.cropKey,
    readyAt: result.readyAt
  });

  await context.send({
    message:
      '🌱 Посадка завершена!\n\n' +
      `🗺 Участок: №${safePlotNumber}\n` +
      `${crop.emoji} Культура: ${crop.title}\n` +
      `🌾 Посажено семян: ${result.seedQuantity}\n` +
      `⏳ КД до сбора: ${formatDuration(growTime)}\n` +
      `🎯 Шанс каждого семени: ${chances.total}%\n` +
      `🎒 Осталось семян: ${result.seedCount}\n\n` +
      'Каждое семя рассчитывается отдельно. Результат станет известен во время сбора.',
    keyboard: createGrowingPlotKeyboard(
      safePlotNumber,
      false
    )
  });

  return true;
}

async function harvestCrop(
  context,
  plotNumber
) {
  const vkId = Number(context.senderId);
  const safePlotNumber = Number(plotNumber);
  const state = getFarmState(vkId);
  const capacity = getWarehouseCapacity(
    state.warehouseLevel
  );
  const result = harvestFarmCrop({
    vkId,
    plotNumber: safePlotNumber,
    warehouseCapacity: capacity,
    cooldownMs: FARM_HARVEST_COOLDOWN_MS
  });

  if (result.status === 'plot_empty') {
    return openPlot(context, safePlotNumber);
  }

  if (
    result.status === 'growing' ||
    result.status === 'cooldown'
  ) {
    await context.send({
      message:
        (result.status === 'growing'
          ? '⏳ Урожай ещё не созрел.'
          : '⏳ После прошлого сбора нужно немного подождать.') +
        `\n\n🕒 Осталось: ${formatDuration(result.remainingMs)}`,
      keyboard: createGrowingPlotKeyboard(
        safePlotNumber,
        result.status === 'cooldown'
      )
    });

    return true;
  }

  if (result.status === 'warehouse_full') {
    await context.send({
      message:
        '📦 На складе не хватает места для этого урожая.\n\n' +
        `🧺 Нужно места: ${result.requiredSpace}\n` +
        `📭 Свободно: ${result.freeSpace}\n\n` +
        'Продай часть запасов или улучши склад. Урожай на участке не пропадёт.',
      keyboard: createWarehouseFullKeyboard(
        safePlotNumber
      )
    });

    return true;
  }

  const crop = getCrop(result.cropKey);

  if (result.status === 'failed') {
    const reason = result.resultCode ===
      'not_sprouted'
      ? 'Ни одно семя не взошло.'
      : 'Часть семян взошла, но урожай не смог созреть.';

    await context.send({
      message:
        '😔 Урожая нет.\n\n' +
        `${crop?.emoji ?? '🌱'} ${crop?.title ?? result.cropKey}\n` +
        `🌱 Было посажено семян: ${result.seedQuantity}\n` +
        `❌ ${reason}\n\n` +
        'Улучшай систему полива, чтобы повысить оба шанса.',
      keyboard: createHarvestResultKeyboard(
        safePlotNumber
      )
    });

    return true;
  }

  await context.send({
    message:
      '🧺 Урожай собран!\n\n' +
      `${crop?.emoji ?? '🌾'} ${crop?.title ?? result.cropKey}: +${result.quantity} ед.\n` +
      `🌱 Было посажено семян: ${result.seedQuantity}\n` +
      `📦 Склад: ${result.storageUsed}/${capacity}\n` +
      `💰 Оценка урожая: ${formatMoney(result.quantity * (crop?.sellPrice ?? 0))} ₽\n\n` +
      'Урожай помещён на склад. Продать его можно там.',
    keyboard: createHarvestResultKeyboard(
      safePlotNumber
    )
  });

  return true;
}

async function sendSeedShop(
  context,
  requestedPage = 0
) {
  const vkId = Number(context.senderId);
  const state = getFarmState(vkId);

  if (state.plotCount === 0) {
    return sendFarmHome(context);
  }

  const totalPages = Math.ceil(
    CROPS.length / CROP_PAGE_SIZE
  );
  const page = normalizePage(
    requestedPage,
    totalPages
  );
  const pageItems = CROPS.slice(
    page * CROP_PAGE_SIZE,
    (page + 1) * CROP_PAGE_SIZE
  );
  const lines = pageItems.map(crop => {
    const locked =
      state.plotCount < crop.requiredPlots;

    return (
      `${locked ? '🔒' : crop.emoji} ${crop.title}\n` +
      `   🌱 Семя: ${formatMoney(crop.seedPrice)} ₽\n` +
      `   💰 Урожай: ${formatMoney(crop.sellPrice)} ₽/ед.\n` +
      `   🎒 Куплено семян: ${getSeedCount(state, crop.key)}` +
      (locked
        ? `\n   🗺 Нужно участков: ${crop.requiredPlots}`
        : '')
    );
  });

  await context.send({
    message:
      '🛒 Магазин семян\n\n' +
      `📄 Страница ${page + 1}/${totalPages}\n\n` +
      `${lines.join('\n\n')}\n\n` +
      'На один участок можно посадить целую партию. Лимит зависит от культуры.',
    keyboard: createSeedShopKeyboard(
      CROPS,
      page
    )
  });

  return true;
}

async function openSeed(context, cropKey) {
  const vkId = Number(context.senderId);
  const state = getFarmState(vkId);
  const crop = getCrop(cropKey);

  if (!crop || state.plotCount === 0) {
    return sendSeedShop(context);
  }

  const unlocked =
    state.plotCount >= crop.requiredPlots;
  const chances = getCropChances(
    crop,
    state.irrigationLevel
  );
  const yieldRange = getCropYieldRange(
    crop,
    state.soilLevel
  );

  await context.send({
    message:
      `${crop.emoji} Семена: ${crop.title}\n\n` +
      `🌱 Цена 1 семени: ${formatMoney(crop.seedPrice)} ₽\n` +
      `🎁 Набор из 10: ${formatMoney(crop.seedPrice * 10)} ₽\n` +
      `💰 Продажа урожая: ${formatMoney(crop.sellPrice)} ₽/ед.\n` +
      `🧺 С одного семени: ${yieldRange.min}–${yieldRange.max} ед.\n` +
      `💵 Выручка с одного: ${formatMoney(yieldRange.min * crop.sellPrice)}–${formatMoney(yieldRange.max * crop.sellPrice)} ₽\n` +
      `🌾 Лимит участка: ${crop.maxSeedsPerPlot} семян\n` +
      `🎯 Итоговый шанс: ${chances.total}%\n` +
      `⏳ Рост: ${formatDuration(getCropGrowTime(crop, state.irrigationLevel))}\n` +
      `🎒 Уже куплено: ${getSeedCount(state, crop.key)}\n\n` +
      (unlocked
        ? 'Выбери готовое количество или нажми «Своё количество».'
        : `🔒 Культура откроется после покупки ${crop.requiredPlots}-го участка.`),
    keyboard: createSeedCardKeyboard(
      crop,
      unlocked
    )
  });

  return true;
}

async function requestCustomSeedQuantity(
  context,
  cropKey
) {
  const vkId = Number(context.senderId);
  const crop = getCrop(cropKey);
  const state = getFarmState(vkId);

  if (!crop || state.plotCount === 0) {
    return sendSeedShop(context);
  }

  if (state.plotCount < crop.requiredPlots) {
    return openSeed(context, crop.key);
  }

  pendingPlantings.delete(vkId);
  pendingSeedPurchases.set(vkId, {
    cropKey: crop.key,
    expiresAt:
      Date.now() +
      CUSTOM_SEED_INPUT_TTL_MS
  });

  await context.send({
    message:
      `✏ Покупка семян: ${crop.emoji} ${crop.title}\n\n` +
      `🌱 Цена одного семени: ${formatMoney(crop.seedPrice)} ₽\n` +
      `🔢 Введи количество от 1 до ${CUSTOM_SEED_MAX_QUANTITY} одним сообщением.\n\n` +
      'Пример: 37\n' +
      'На ввод даётся 2 минуты.',
    keyboard: createCustomSeedKeyboard(crop)
  });

  return true;
}

async function handleCustomSeedInput(
  context,
  pending,
  originalText
) {
  const vkId = Number(context.senderId);
  const crop = getCrop(pending.cropKey);

  if (!crop) {
    pendingSeedPurchases.delete(vkId);
    return sendSeedShop(context);
  }

  if (!/^\d+$/.test(originalText)) {
    await context.send({
      message:
        '❌ Отправь только целое число.\n\n' +
        `Допустимое количество: от 1 до ${CUSTOM_SEED_MAX_QUANTITY}.`,
      keyboard: createCustomSeedKeyboard(crop)
    });

    return true;
  }

  const quantity = Number(originalText);

  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > CUSTOM_SEED_MAX_QUANTITY
  ) {
    await context.send({
      message:
        '❌ Такое количество купить нельзя.\n\n' +
        `Введи число от 1 до ${CUSTOM_SEED_MAX_QUANTITY}.`,
      keyboard: createCustomSeedKeyboard(crop)
    });

    return true;
  }

  pendingSeedPurchases.delete(vkId);

  return buySeeds(
    context,
    crop.key,
    quantity
  );
}

async function buySeeds(
  context,
  cropKey,
  quantityValue
) {
  const vkId = Number(context.senderId);
  const crop = getCrop(cropKey);
  const quantity = Number(quantityValue);

  if (!crop) {
    return sendSeedShop(context);
  }

  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > CUSTOM_SEED_MAX_QUANTITY
  ) {
    return requestCustomSeedQuantity(
      context,
      crop.key
    );
  }

  const result = purchaseFarmSeeds({
    vkId,
    cropKey: crop.key,
    quantity,
    unitPrice: crop.seedPrice,
    requiredPlots: crop.requiredPlots
  });

  if (result.status === 'no_farm') {
    return sendFarmHome(context);
  }

  if (result.status === 'crop_locked') {
    return openSeed(context, crop.key);
  }

  if (result.status === 'insufficient_funds') {
    await context.send({
      message:
        '❌ Не хватает денег на семена.\n\n' +
        `🌱 Цена: ${formatMoney(result.price)} ₽\n` +
        `🏦 Баланс: ${formatMoney(result.balance)} ₽\n` +
        `📉 Не хватает: ${formatMoney(result.missing)} ₽`,
      keyboard: createSeedCardKeyboard(
        crop,
        true
      )
    });

    return true;
  }

  await context.send({
    message:
      '✅ Семена куплены!\n\n' +
      `${crop.emoji} ${crop.title}: +${result.quantity}\n` +
      `🎒 Теперь семян: ${result.seedCount}\n` +
      `💵 Потрачено: ${formatMoney(result.price)} ₽\n` +
      `🏦 Баланс: ${formatMoney(result.balance)} ₽`,
    keyboard: createSeedCardKeyboard(
      crop,
      true
    )
  });

  return true;
}

function getStorageItems(state) {
  return state.storage
    .map(item => ({
      ...item,
      crop: getCrop(item.cropKey)
    }))
    .filter(item => item.crop)
    .sort((first, second) =>
      first.crop.requiredPlots -
      second.crop.requiredPlots
    );
}

async function sendStorage(context) {
  const vkId = Number(context.senderId);
  const state = getFarmState(vkId);

  if (state.plotCount === 0) {
    return sendFarmHome(context);
  }

  const capacity = getWarehouseCapacity(
    state.warehouseLevel
  );
  const items = getStorageItems(state);
  const totalValue = items.reduce(
    (sum, item) =>
      sum +
      item.quantity * item.crop.sellPrice,
    0
  );
  const lines = items.map(item => (
    `${item.crop.emoji} ${item.crop.title} ×${item.quantity}\n` +
    `   💰 ${formatMoney(item.quantity * item.crop.sellPrice)} ₽`
  ));

  await context.send({
    message:
      '📦 Склад фермы\n\n' +
      (items.length > 0
        ? `${lines.join('\n\n')}\n\n`
        : 'Склад пока пуст. Собранный урожай появится здесь.\n\n') +
      `📊 Заполнено: ${state.storageUsed}/${capacity}\n` +
      `💵 Стоимость запасов: ${formatMoney(totalValue)} ₽\n\n` +
      (items.length > 0
        ? 'Нажми на культуру, чтобы продать весь её запас.'
        : 'Посади культуру на свободном участке.'),
    keyboard: createStorageKeyboard(items)
  });

  return true;
}

async function sellCrop(context, cropKey) {
  const vkId = Number(context.senderId);
  const crop = getCrop(cropKey);

  if (!crop) {
    return sendStorage(context);
  }

  const result = sellFarmProduce({
    vkId,
    cropKey: crop.key,
    unitPrice: crop.sellPrice
  });

  if (result.status === 'empty') {
    return sendStorage(context);
  }

  if (result.status === 'balance_limit') {
    await context.send({
      message:
        '❌ Баланс достиг технического лимита. Урожай остался на складе.',
      keyboard: createHomeButton()
    });

    return true;
  }

  await context.send({
    message:
      '💰 Урожай продан!\n\n' +
      `${crop.emoji} ${crop.title}: ${result.quantity} ед.\n` +
      `💵 Получено: ${formatMoney(result.earned)} ₽\n` +
      `🏦 Баланс: ${formatMoney(result.balance)} ₽`,
    keyboard: createHomeButton()
  });

  return true;
}

async function sellAllCrops(context) {
  const prices = Object.fromEntries(
    CROPS.map(crop => [
      crop.key,
      crop.sellPrice
    ])
  );
  const result = sellAllFarmProduce({
    vkId: Number(context.senderId),
    prices
  });

  if (result.status === 'empty') {
    return sendStorage(context);
  }

  if (result.status === 'balance_limit') {
    await context.send({
      message:
        '❌ Баланс достиг технического лимита. Урожай остался на складе.',
      keyboard: createHomeButton()
    });

    return true;
  }

  await context.send({
    message:
      '💵 Весь урожай продан!\n\n' +
      `🌾 Видов культур: ${result.cropCount}\n` +
      `🧺 Продано единиц: ${result.quantity}\n` +
      `💰 Получено: ${formatMoney(result.earned)} ₽\n` +
      `🏦 Баланс: ${formatMoney(result.balance)} ₽`,
    keyboard: createHomeButton()
  });

  return true;
}

async function sendUpgrades(context) {
  const vkId = Number(context.senderId);
  const state = getFarmState(vkId);

  if (state.plotCount === 0) {
    return sendFarmHome(context);
  }

  const lines = Object.values(UPGRADES).map(
    upgrade => {
      const level =
        state[`${upgrade.key}Level`];
      const nextCost =
        upgrade.costs[level] ?? null;
      const extra = upgrade.key === 'warehouse'
        ? `\n   📦 Вместимость: ${getWarehouseCapacity(level)}`
        : '';

      return (
        `${upgrade.emoji} ${upgrade.title}: ${level}/${FARM_MAX_UPGRADE_LEVEL}` +
        extra +
        `\n   ℹ ${upgrade.description}\n` +
        (nextCost === null
          ? '   🏆 Максимальный уровень'
          : `   💵 Следующий уровень: ${formatMoney(nextCost)} ₽`)
      );
    }
  );

  await context.send({
    message:
      '⬆ Улучшения фермы\n\n' +
      `${lines.join('\n\n')}\n\n` +
      `🏦 Баланс: ${formatMoney(getBalance(vkId))} ₽`,
    keyboard: createUpgradesKeyboard(state)
  });

  return true;
}

async function buyUpgrade(context, upgradeKey) {
  const vkId = Number(context.senderId);
  const state = getFarmState(vkId);
  const upgrade = getUpgrade(upgradeKey);

  if (!upgrade || state.plotCount === 0) {
    return sendUpgrades(context);
  }

  const level = state[`${upgrade.key}Level`];
  const price = upgrade.costs[level] ?? null;

  if (price === null) {
    return sendUpgrades(context);
  }

  const result = upgradeFarm({
    vkId,
    upgradeKey: upgrade.key,
    price
  });

  if (result.status === 'insufficient_funds') {
    await context.send({
      message:
        '❌ Не хватает денег на улучшение.\n\n' +
        `⬆ Цена: ${formatMoney(result.price)} ₽\n` +
        `🏦 Баланс: ${formatMoney(result.balance)} ₽\n` +
        `📉 Не хватает: ${formatMoney(result.missing)} ₽`,
      keyboard: createUpgradesKeyboard(state)
    });

    return true;
  }

  await context.send({
    message:
      '⬆ Ферма улучшена!\n\n' +
      `${upgrade.emoji} ${upgrade.title}\n` +
      `⭐ Новый уровень: ${result.level}/${FARM_MAX_UPGRADE_LEVEL}\n` +
      `💵 Потрачено: ${formatMoney(result.price)} ₽\n` +
      `🏦 Баланс: ${formatMoney(result.balance)} ₽`,
    keyboard: createUpgradesKeyboard(
      getFarmState(vkId)
    )
  });

  return true;
}

async function handle(context) {
  const originalText =
    String(context.text ?? '').trim();
  const payload = context.messagePayload;
  const vkId = Number(context.senderId);

  if (
    payload?.command ===
    'farm_plant_custom_cancel'
  ) {
    pendingPlantings.delete(vkId);

    return openCrop(
      context,
      payload.cropKey,
      payload.plotNumber
    );
  }

  if (payload?.command === 'farm_plant_custom') {
    return requestCustomPlantQuantity(
      context,
      payload.cropKey,
      payload.plotNumber
    );
  }

  if (
    payload?.command ===
    'farm_seed_custom_cancel'
  ) {
    pendingSeedPurchases.delete(vkId);

    return openSeed(
      context,
      payload.cropKey
    );
  }

  if (payload?.command === 'farm_seed_custom') {
    return requestCustomSeedQuantity(
      context,
      payload.cropKey
    );
  }

  const pendingPlant =
    pendingPlantings.get(vkId);

  if (pendingPlant) {
    if (payload) {
      pendingPlantings.delete(vkId);
    } else if (
      pendingPlant.expiresAt <= Date.now()
    ) {
      pendingPlantings.delete(vkId);
    } else if (originalText) {
      if (originalText.startsWith('!')) {
        pendingPlantings.delete(vkId);
      } else {
        return handleCustomPlantInput(
          context,
          pendingPlant,
          originalText
        );
      }
    }
  }

  const pendingSeed =
    pendingSeedPurchases.get(vkId);

  if (pendingSeed) {
    if (payload) {
      pendingSeedPurchases.delete(vkId);
    } else if (
      pendingSeed.expiresAt <= Date.now()
    ) {
      pendingSeedPurchases.delete(vkId);
    } else if (!payload && originalText) {
      if (originalText.startsWith('!')) {
        pendingSeedPurchases.delete(vkId);
      } else {
        return handleCustomSeedInput(
          context,
          pendingSeed,
          originalText
        );
      }
    }
  }

  if (payload?.command === 'farm_home') {
    return sendFarmHome(context);
  }

  if (payload?.command === 'farm_buy_plot') {
    return buyPlot(context);
  }

  if (payload?.command === 'farm_plots') {
    return sendPlots(context);
  }

  if (payload?.command === 'farm_plot') {
    return openPlot(
      context,
      payload.plotNumber
    );
  }

  if (payload?.command === 'farm_crop_picker') {
    return sendCropPicker(
      context,
      payload.plotNumber,
      payload.page
    );
  }

  if (payload?.command === 'farm_crop_open') {
    return openCrop(
      context,
      payload.cropKey,
      payload.plotNumber
    );
  }

  if (payload?.command === 'farm_plant') {
    return plantCrop(
      context,
      payload.cropKey,
      payload.plotNumber,
      payload.quantity
    );
  }

  if (payload?.command === 'farm_harvest') {
    return harvestCrop(
      context,
      payload.plotNumber
    );
  }

  if (payload?.command === 'farm_seed_shop') {
    return sendSeedShop(
      context,
      payload.page
    );
  }

  if (payload?.command === 'farm_seed_open') {
    return openSeed(
      context,
      payload.cropKey
    );
  }

  if (payload?.command === 'farm_seed_buy') {
    return buySeeds(
      context,
      payload.cropKey,
      payload.quantity
    );
  }

  if (payload?.command === 'farm_storage') {
    return sendStorage(context);
  }

  if (payload?.command === 'farm_sell_crop') {
    return sellCrop(
      context,
      payload.cropKey
    );
  }

  if (payload?.command === 'farm_sell_all') {
    return sellAllCrops(context);
  }

  if (payload?.command === 'farm_upgrades') {
    return sendUpgrades(context);
  }

  if (payload?.command === 'farm_upgrade') {
    return buyUpgrade(
      context,
      payload.upgradeKey
    );
  }

  if (/^!ферма$/i.test(originalText)) {
    return sendFarmHome(context);
  }

  if (/^!ферма\s+участки$/i.test(originalText)) {
    return sendPlots(context);
  }

  const seedPurchaseMatch = originalText.match(
    /^!(?:ферма\s+)?семена\s+купить\s+(.+)\s+(\d+)$/i
  );

  if (seedPurchaseMatch) {
    return buySeeds(
      context,
      seedPurchaseMatch[1],
      seedPurchaseMatch[2]
    );
  }

  if (/^!(?:ферма\s+)?семена$/i.test(originalText)) {
    return sendSeedShop(context);
  }

  if (/^!(?:ферма\s+)?склад$/i.test(originalText)) {
    return sendStorage(context);
  }

  if (/^!ферма\s+улучшения$/i.test(originalText)) {
    return sendUpgrades(context);
  }

  return false;
}

module.exports = {
  formatDuration,
  initialize,
  handle
};
