const { Keyboard } = require('vk-io');

const {
  formatMoney,
  getMagazineAssets,
  getCarTuningLevels,
  upgradeCarTuning
} = require('../database');

const {
  getItem
} = require('../magazine/catalog');

const {
  getTuningComponent,
  calculateCarTuning
} = require('./catalog');

const CAR_PAGE_SIZE = 6;

function getOwnedCars(vkId) {
  return getMagazineAssets(vkId)
    .filter(asset => asset.itemType === 'cars')
    .map(asset => getItem(asset.itemKey))
    .filter(car =>
      car &&
      car.categoryKey === 'cars'
    );
}

function resolveOwnedCar(vkId, carValue) {
  const car = getItem(carValue);

  if (
    !car ||
    car.categoryKey !== 'cars' ||
    !getOwnedCars(vkId).some(
      ownedCar => ownedCar.key === car.key
    )
  ) {
    return null;
  }

  return car;
}

function getCarState(vkId, car) {
  const tuning = getCarTuningLevels(
    vkId,
    car.key
  );

  return calculateCarTuning(
    car,
    tuning.levels
  );
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

function formatPowerGain(value) {
  return value > 0
    ? `+${formatMoney(value)} л.с.`
    : 'без прибавки мощности';
}

function createEmptyKeyboard() {
  return Keyboard.builder()
    .textButton({
      label: '🚗 Купить машину',
      payload: {
        command: 'magazine_category',
        categoryKey: 'cars'
      },
      color: Keyboard.POSITIVE_COLOR
    })
    .inline();
}

function createCarListKeyboard(cars, page) {
  const keyboard = Keyboard.builder();
  const totalPages = Math.max(
    1,
    Math.ceil(cars.length / CAR_PAGE_SIZE)
  );
  const safePage = normalizePage(
    page,
    totalPages
  );
  const pageItems = cars.slice(
    safePage * CAR_PAGE_SIZE,
    (safePage + 1) * CAR_PAGE_SIZE
  );

  pageItems.forEach((car, index) => {
    keyboard.textButton({
      label: `🔧 ${car.title}`,
      payload: {
        command: 'tuning_car',
        carKey: car.key
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
        command: 'tuning_home',
        page: safePage - 1
      },
      color: Keyboard.SECONDARY_COLOR
    });
  }

  if (safePage < totalPages - 1) {
    keyboard.textButton({
      label: 'Вперёд ➡',
      payload: {
        command: 'tuning_home',
        page: safePage + 1
      },
      color: Keyboard.PRIMARY_COLOR
    });
  }

  return keyboard.inline();
}

function createGarageKeyboard(car, state) {
  const keyboard = Keyboard.builder();

  state.componentStates.forEach(
    (componentState, index) => {
      const { component, level } =
        componentState;

      keyboard.textButton({
        label:
          `${component.emoji} ${component.title}: ` +
          `${level}/${component.upgrades.length}`,
        payload: {
          command: 'tuning_component',
          carKey: car.key,
          componentKey: component.key
        },
        color: level > 0
          ? Keyboard.POSITIVE_COLOR
          : Keyboard.SECONDARY_COLOR
      });

      if (
        index % 2 === 1 &&
        index < state.componentStates.length - 1
      ) {
        keyboard.row();
      }
    }
  );

  return keyboard
    .row()
    .textButton({
      label: '⬅ Мои машины',
      payload: {
        command: 'tuning_home'
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

function createComponentKeyboard(
  car,
  componentState
) {
  const keyboard = Keyboard.builder();
  const { component, nextUpgrade } =
    componentState;

  if (nextUpgrade) {
    keyboard
      .textButton({
        label:
          `🔧 Установить за ` +
          `${formatMoney(nextUpgrade.price)} ₽`,
        payload: {
          command: 'tuning_upgrade',
          carKey: car.key,
          componentKey: component.key
        },
        color: Keyboard.POSITIVE_COLOR
      })
      .row();
  }

  return keyboard
    .textButton({
      label: `⬅ ${car.title}`,
      payload: {
        command: 'tuning_car',
        carKey: car.key
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

function createGarageReturnKeyboard(car) {
  return Keyboard.builder()
    .textButton({
      label: `⬅ Гараж ${car.title}`,
      payload: {
        command: 'tuning_car',
        carKey: car.key
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

async function sendTuningHome(
  context,
  requestedPage = 0
) {
  const vkId = Number(context.senderId);
  const cars = getOwnedCars(vkId);

  if (cars.length === 0) {
    await context.send({
      message:
        '🔧 В гараже пока нет машин.\n\n' +
        'Купи автомобиль, чтобы начать тюнинг.',
      keyboard: createEmptyKeyboard()
    });

    return true;
  }

  const totalPages = Math.max(
    1,
    Math.ceil(cars.length / CAR_PAGE_SIZE)
  );
  const page = normalizePage(
    requestedPage,
    totalPages
  );
  const pageItems = cars.slice(
    page * CAR_PAGE_SIZE,
    (page + 1) * CAR_PAGE_SIZE
  );
  const lines = pageItems.map(
    (car, index) => {
      const state = getCarState(vkId, car);
      const tuningText = state.isStock
        ? 'Сток'
        : `Вложено ${formatMoney(state.totalSpent)} ₽`;

      return (
        `${page * CAR_PAGE_SIZE + index + 1}. ${car.title}\n` +
        `   ⚡ ${formatMoney(state.power)} л.с.\n` +
        `   🏁 Рейтинг: ${formatMoney(state.raceRating)}\n` +
        `   🔧 ${tuningText}`
      );
    }
  );

  await context.send({
    message:
      '🔧 Тюнинг-ателье Zaffron\n\n' +
      (totalPages > 1
        ? `📄 Страница ${page + 1}/${totalPages}\n\n`
        : '') +
      `${lines.join('\n\n')}\n\n` +
      'В гонке автоматически выбирается машина с самым высоким рейтингом.',
    keyboard: createCarListKeyboard(
      cars,
      page
    )
  });

  return true;
}

async function openCar(context, carValue) {
  const vkId = Number(context.senderId);
  const car = resolveOwnedCar(
    vkId,
    carValue
  );

  if (!car) {
    await context.send({
      message:
        '❌ Эта машина тебе не принадлежит.',
      keyboard: createEmptyKeyboard()
    });

    return true;
  }

  const state = getCarState(vkId, car);
  const componentLines =
    state.componentStates.map(
      componentState => {
        const { component, level } =
          componentState;
        const installedTitle =
          componentState.installedUpgrade?.title ??
          component.stockTitle;

        return (
          `${component.emoji} ${component.title} ` +
          `[${level}/${component.upgrades.length}] — ` +
          installedTitle
        );
      }
    );

  await context.send({
    message:
      `🔧 Гараж: ${car.title}\n\n` +
      `💳 Цена машины: ${formatMoney(car.price)} ₽\n` +
      `⚡ Мощность: ${formatMoney(state.power)} л.с.\n` +
      `🏁 Гоночный рейтинг: ${formatMoney(state.raceRating)}\n` +
      `💰 Вложено в тюнинг: ${formatMoney(state.totalSpent)} ₽\n\n` +
      `${componentLines.join('\n')}\n\n` +
      'Выбери узел для улучшения.',
    keyboard: createGarageKeyboard(
      car,
      state
    )
  });

  return true;
}

async function openComponent(
  context,
  carValue,
  componentValue
) {
  const vkId = Number(context.senderId);
  const car = resolveOwnedCar(
    vkId,
    carValue
  );
  const component = getTuningComponent(
    componentValue
  );

  if (!car || !component) {
    return openCar(context, carValue);
  }

  const levels = getCarTuningLevels(
    vkId,
    car.key
  ).levels;
  const state = calculateCarTuning(
    car,
    levels
  );
  const componentState =
    state.componentStates.find(item =>
      item.component.key === component.key
    );
  const installedTitle =
    componentState.installedUpgrade?.title ??
    component.stockTitle;
  const nextUpgrade =
    componentState.nextUpgrade;
  let nextText;

  if (nextUpgrade) {
    const nextLevels = {
      ...levels,
      [component.key]:
        componentState.level + 1
    };
    const nextState = calculateCarTuning(
      car,
      nextLevels
    );

    nextText =
      `🔜 Следующий уровень: ${nextUpgrade.title}\n` +
      `💵 Цена: ${formatMoney(nextUpgrade.price)} ₽\n` +
      `⚡ Прибавка: ${formatPowerGain(nextUpgrade.powerGain)}\n` +
      `🏁 Рейтинг: +${formatMoney(nextUpgrade.raceGain)}\n\n` +
      `После установки: ${formatMoney(nextState.power)} л.с., ` +
      `рейтинг ${formatMoney(nextState.raceRating)}`;
  } else {
    nextText =
      '🏆 Установлен максимальный уровень этого узла.';
  }

  await context.send({
    message:
      `${component.emoji} ${component.title}: ${car.title}\n\n` +
      `🔩 Сейчас: ${installedTitle}\n` +
      `📊 Уровень: ${componentState.level}/${component.upgrades.length}\n` +
      `💳 Вложено в узел: ${formatMoney(componentState.componentSpent)} ₽\n\n` +
      nextText,
    keyboard: createComponentKeyboard(
      car,
      componentState
    )
  });

  return true;
}

async function installUpgrade(
  context,
  carValue,
  componentValue
) {
  const vkId = Number(context.senderId);
  const car = resolveOwnedCar(
    vkId,
    carValue
  );
  const component = getTuningComponent(
    componentValue
  );

  if (!car || !component) {
    return openCar(context, carValue);
  }

  const levelsResult = getCarTuningLevels(
    vkId,
    car.key
  );
  const currentLevel = Number(
    levelsResult.levels[component.key]
  ) || 0;
  const nextUpgrade =
    component.upgrades[currentLevel];

  if (!nextUpgrade) {
    return openComponent(
      context,
      car.key,
      component.key
    );
  }

  const result = upgradeCarTuning({
    vkId,
    carKey: car.key,
    componentKey: component.key,
    expectedLevel: currentLevel,
    price: nextUpgrade.price
  });

  if (result.status === 'level_changed') {
    return openComponent(
      context,
      car.key,
      component.key
    );
  }

  if (result.status === 'insufficient_funds') {
    await context.send({
      message:
        '❌ Не хватает денег на тюнинг.\n\n' +
        `🔧 Деталь: ${nextUpgrade.title}\n` +
        `💵 Цена: ${formatMoney(result.price)} ₽\n` +
        `🏦 Баланс: ${formatMoney(result.balance)} ₽\n` +
        `📉 Не хватает: ${formatMoney(result.missing)} ₽`,
      keyboard: createGarageReturnKeyboard(car)
    });

    return true;
  }

  if (result.status !== 'upgraded') {
    return openCar(context, car.key);
  }

  const newState = getCarState(vkId, car);

  await context.send({
    message:
      '✅ Тюнинг установлен!\n\n' +
      `🚗 Машина: ${car.title}\n` +
      `${component.emoji} Деталь: ${nextUpgrade.title}\n` +
      `💵 Потрачено: ${formatMoney(result.price)} ₽\n` +
      `⚡ Мощность: ${formatMoney(newState.power)} л.с.\n` +
      `🏁 Гоночный рейтинг: ${formatMoney(newState.raceRating)}\n` +
      `💰 Всего вложено: ${formatMoney(newState.totalSpent)} ₽\n` +
      `🏦 Баланс: ${formatMoney(result.balance)} ₽`,
    keyboard: createGarageReturnKeyboard(car)
  });

  return true;
}

async function handle(context) {
  const originalText =
    String(context.text ?? '').trim();
  const payload = context.messagePayload;

  if (payload?.command === 'tuning_home') {
    return sendTuningHome(
      context,
      payload.page
    );
  }

  if (payload?.command === 'tuning_car') {
    return openCar(
      context,
      payload.carKey
    );
  }

  if (
    payload?.command ===
    'tuning_component'
  ) {
    return openComponent(
      context,
      payload.carKey,
      payload.componentKey
    );
  }

  if (payload?.command === 'tuning_upgrade') {
    return installUpgrade(
      context,
      payload.carKey,
      payload.componentKey
    );
  }

  if (
    /^!(?:тюнинг|гараж)$/i.test(originalText)
  ) {
    return sendTuningHome(context);
  }

  const match = originalText.match(
    /^!тюнинг\s+(.+)$/i
  );

  if (match) {
    return openCar(context, match[1]);
  }

  return false;
}

module.exports = {
  handle,
  getOwnedCars
};
