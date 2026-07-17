const { Keyboard } = require('vk-io');

const {
  formatMoney,
  getBalance,
  getMagazineAssets,
  getTravelProfile,
  researchCountry,
  moveCountry
} = require('../database');

const {
  getItem
} = require('../magazine/catalog');

const {
  countries,
  getCountry
} = require('./countries');

const RESEARCH_COST = 300_000_000;
const MOVE_COST = 1_000_000_000;
const COUNTRIES_PER_PAGE = 4;

function normalizePage(value) {
  const totalPages = Math.ceil(
    countries.length / COUNTRIES_PER_PAGE
  );
  const requestedPage = Math.trunc(
    Number(value) || 0
  );

  return Math.min(
    Math.max(0, requestedPage),
    Math.max(0, totalPages - 1)
  );
}

function getBestPlane(vkId) {
  return getMagazineAssets(vkId)
    .filter(asset => asset.itemType === 'planes')
    .map(asset => getItem(asset.itemKey))
    .filter(Boolean)
    .sort((first, second) =>
      second.price - first.price
    )[0] ?? null;
}

function createTravelKeyboard(vkId, requestedPage) {
  const page = normalizePage(requestedPage);
  const totalPages = Math.ceil(
    countries.length / COUNTRIES_PER_PAGE
  );
  const profile = getTravelProfile(vkId);
  const researched = new Set(
    profile.researchedCountryKeys
  );
  const pageCountries = countries.slice(
    page * COUNTRIES_PER_PAGE,
    (page + 1) * COUNTRIES_PER_PAGE
  );
  const keyboard = Keyboard.builder();

  for (const country of pageCountries) {
    if (country.key === profile.currentCountryKey) {
      continue;
    }

    const isResearched = researched.has(
      country.key
    );

    keyboard
      .textButton({
        label:
          `${isResearched ? '🚚' : '🔍'} ` +
          `${country.flag} ${country.title}`,
        payload: {
          command: isResearched
            ? 'travel_move_prompt'
            : 'travel_research_prompt',
          countryKey: country.key,
          page
        },
        color: isResearched
          ? Keyboard.PRIMARY_COLOR
          : Keyboard.POSITIVE_COLOR
      })
      .row();
  }

  if (page > 0) {
    keyboard.textButton({
      label: '⬅ Назад',
      payload: {
        command: 'travel_home',
        page: page - 1
      },
      color: Keyboard.SECONDARY_COLOR
    });
  }

  if (page < totalPages - 1) {
    keyboard.textButton({
      label: 'Вперёд ➡',
      payload: {
        command: 'travel_home',
        page: page + 1
      },
      color: Keyboard.SECONDARY_COLOR
    });
  }

  keyboard
    .row()
    .textButton({
      label: '🔄 Обновить страны',
      payload: {
        command: 'travel_home',
        page
      },
      color: Keyboard.SECONDARY_COLOR
    });

  return keyboard.inline();
}

function createConfirmationKeyboard(
  action,
  country,
  page = 0
) {
  return Keyboard.builder()
    .textButton({
      label: action === 'research'
        ? '✅ Исследовать'
        : '✅ Переехать',
      payload: {
        command: action === 'research'
          ? 'travel_research_confirm'
          : 'travel_move_confirm',
        countryKey: country.key,
        page: normalizePage(page)
      },
      color: Keyboard.POSITIVE_COLOR
    })
    .textButton({
      label: '❌ Отмена',
      payload: {
        command: 'travel_home',
        page: normalizePage(page)
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

function createReturnKeyboard(page = 0) {
  return Keyboard.builder()
    .textButton({
      label: '🌍 К списку стран',
      payload: {
        command: 'travel_home',
        page: normalizePage(page)
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

async function sendTravelHome(
  context,
  requestedPage = 0
) {
  const vkId = Number(context.senderId);
  const page = normalizePage(requestedPage);
  const profile = getTravelProfile(vkId);
  const currentCountry = getCountry(
    profile.currentCountryKey
  ) ?? getCountry('russia');
  const researched = new Set(
    profile.researchedCountryKeys
  );
  const plane = getBestPlane(vkId);
  const pageCountries = countries.slice(
    page * COUNTRIES_PER_PAGE,
    (page + 1) * COUNTRIES_PER_PAGE
  );
  const lines = pageCountries.map(country => {
    let status = '🔍 Не исследована';

    if (country.key === profile.currentCountryKey) {
      status = '🏠 Ты находишься здесь';
    } else if (researched.has(country.key)) {
      status = '✅ Исследована';
    }

    return (
      `${country.flag} ${country.title}\n` +
      `└ ${status}`
    );
  });
  const totalPages = Math.ceil(
    countries.length / COUNTRIES_PER_PAGE
  );

  await context.send({
    message:
      '🌍 Перелёты Zaffron\n\n' +
      `🏠 Текущая страна: ${currentCountry.flag} ${currentCountry.title}\n` +
      `✈ Самолёт: ${plane?.title ?? 'отсутствует'}\n` +
      `🗺 Исследовано: ${researched.size}/${countries.length}\n` +
      `💵 Баланс: ${formatMoney(getBalance(vkId))} $\n\n` +
      `🔍 Исследование страны: ${formatMoney(RESEARCH_COST)} $\n` +
      `🚚 Переезд: ${formatMoney(MOVE_COST)} $\n\n` +
      `${lines.join('\n\n')}\n\n` +
      `Страница ${page + 1}/${totalPages}\n\n` +
      'Команды:\n' +
      '!перелёт [страна]\n' +
      '!переезд [страна]',
    keyboard: createTravelKeyboard(vkId, page)
  });

  return true;
}

async function sendNoPlane(context, page = 0) {
  await context.send({
    message:
      '❌ Для перелётов нужен собственный самолёт.\n\n' +
      'Купить его можно командой: !магазин самолётов',
    keyboard: createReturnKeyboard(page)
  });

  return true;
}

async function sendResearchPrompt(
  context,
  country,
  page = 0
) {
  const vkId = Number(context.senderId);
  const profile = getTravelProfile(vkId);

  if (profile.currentCountryKey === country.key) {
    await context.send({
      message:
        `🏠 Ты уже находишься в стране ${country.flag} ${country.title}.`,
      keyboard: createReturnKeyboard(page)
    });

    return true;
  }

  if (profile.researchedCountryKeys.includes(country.key)) {
    return sendMovePrompt(
      context,
      country,
      page
    );
  }

  if (!getBestPlane(vkId)) {
    return sendNoPlane(context, page);
  }

  await context.send({
    message:
      '🔍 Исследование страны\n\n' +
      `${country.flag} Страна: ${country.title}\n` +
      `✈ Самолёт: ${getBestPlane(vkId).title}\n` +
      `💵 Стоимость: ${formatMoney(RESEARCH_COST)} $\n` +
      `🏦 Баланс: ${formatMoney(getBalance(vkId))} $\n\n` +
      'После исследования страна навсегда останется доступной для переезда.',
    keyboard: createConfirmationKeyboard(
      'research',
      country,
      page
    )
  });

  return true;
}

async function sendMovePrompt(
  context,
  country,
  page = 0
) {
  const vkId = Number(context.senderId);
  const profile = getTravelProfile(vkId);

  if (profile.currentCountryKey === country.key) {
    await context.send({
      message:
        `🏠 Ты уже живёшь в стране ${country.flag} ${country.title}.`,
      keyboard: createReturnKeyboard(page)
    });

    return true;
  }

  if (!profile.researchedCountryKeys.includes(country.key)) {
    await context.send({
      message:
        `❌ Сначала исследуй страну ${country.flag} ${country.title}.\n\n` +
        `Команда: !перелёт ${country.title}`,
      keyboard: createReturnKeyboard(page)
    });

    return true;
  }

  if (!getBestPlane(vkId)) {
    return sendNoPlane(context, page);
  }

  const currentCountry = getCountry(
    profile.currentCountryKey
  ) ?? getCountry('russia');

  await context.send({
    message:
      '🚚 Подтверждение переезда\n\n' +
      `📍 Откуда: ${currentCountry.flag} ${currentCountry.title}\n` +
      `🏁 Куда: ${country.flag} ${country.title}\n` +
      `✈ Самолёт: ${getBestPlane(vkId).title}\n` +
      `💵 Стоимость: ${formatMoney(MOVE_COST)} $\n` +
      `🏦 Баланс: ${formatMoney(getBalance(vkId))} $`,
    keyboard: createConfirmationKeyboard(
      'move',
      country,
      page
    )
  });

  return true;
}

async function confirmResearch(
  context,
  country,
  page = 0
) {
  const result = researchCountry({
    vkId: Number(context.senderId),
    countryKey: country.key,
    cost: RESEARCH_COST
  });

  if (result.status === 'no_plane') {
    return sendNoPlane(context, page);
  }

  if (result.status === 'already_researched') {
    return sendMovePrompt(context, country, page);
  }

  if (result.status === 'insufficient_funds') {
    await context.send({
      message:
        '❌ Недостаточно денег для исследования.\n\n' +
        `💵 Нужно: ${formatMoney(result.cost)} $\n` +
        `🏦 Баланс: ${formatMoney(result.balance)} $\n` +
        `📉 Не хватает: ${formatMoney(result.missing)} $`,
      keyboard: createReturnKeyboard(page)
    });

    return true;
  }

  await context.send({
    message:
      '🎉 Страна исследована!\n\n' +
      `${country.flag} ${country.title}\n` +
      `💸 Потрачено: ${formatMoney(result.cost)} $\n` +
      `🏦 Баланс: ${formatMoney(result.balance)} $\n\n` +
      `Теперь сюда можно переехать командой:\n!переезд ${country.title}`,
    keyboard: createReturnKeyboard(page)
  });

  return true;
}

async function confirmMove(
  context,
  country,
  page = 0
) {
  const result = moveCountry({
    vkId: Number(context.senderId),
    countryKey: country.key,
    cost: MOVE_COST
  });

  if (result.status === 'no_plane') {
    return sendNoPlane(context, page);
  }

  if (result.status === 'already_there') {
    await context.send({
      message:
        `🏠 Ты уже живёшь в стране ${country.flag} ${country.title}.`,
      keyboard: createReturnKeyboard(page)
    });

    return true;
  }

  if (result.status === 'not_researched') {
    await context.send({
      message:
        `❌ Сначала исследуй страну ${country.flag} ${country.title}.`,
      keyboard: createReturnKeyboard(page)
    });

    return true;
  }

  if (result.status === 'insufficient_funds') {
    await context.send({
      message:
        '❌ Недостаточно денег для переезда.\n\n' +
        `💵 Нужно: ${formatMoney(result.cost)} $\n` +
        `🏦 Баланс: ${formatMoney(result.balance)} $\n` +
        `📉 Не хватает: ${formatMoney(result.missing)} $`,
      keyboard: createReturnKeyboard(page)
    });

    return true;
  }

  await context.send({
    message:
      '🎉 Переезд завершён!\n\n' +
      `🏠 Новая страна проживания: ${country.flag} ${country.title}\n` +
      `💸 Потрачено: ${formatMoney(result.cost)} $\n` +
      `🏦 Баланс: ${formatMoney(result.balance)} $`,
    keyboard: createReturnKeyboard(page)
  });

  return true;
}

function getProfileText(vkId) {
  const profile = getTravelProfile(vkId);
  const country = getCountry(
    profile.currentCountryKey
  ) ?? getCountry('russia');

  return (
    `🌍 Страна: ${country.flag} ${country.title}\n` +
    `🗺 Исследовано стран: ${profile.researchedCountryKeys.length}/${countries.length}`
  );
}

async function handle(context) {
  const originalText =
    String(context.text ?? '').trim();
  const payload = context.messagePayload;

  if (payload?.command === 'travel_home') {
    return sendTravelHome(context, payload.page);
  }

  const payloadCountry = payload?.countryKey
    ? getCountry(payload.countryKey)
    : null;

  if (
    payload?.command === 'travel_research_prompt' &&
    payloadCountry
  ) {
    return sendResearchPrompt(
      context,
      payloadCountry,
      payload.page
    );
  }

  if (
    payload?.command === 'travel_move_prompt' &&
    payloadCountry
  ) {
    return sendMovePrompt(
      context,
      payloadCountry,
      payload.page
    );
  }

  if (
    payload?.command === 'travel_research_confirm' &&
    payloadCountry
  ) {
    return confirmResearch(
      context,
      payloadCountry,
      payload.page
    );
  }

  if (
    payload?.command === 'travel_move_confirm' &&
    payloadCountry
  ) {
    return confirmMove(
      context,
      payloadCountry,
      payload.page
    );
  }

  if (/^!перел[её]т\s*$/i.test(originalText)) {
    return sendTravelHome(context);
  }

  const flightMatch = originalText.match(
    /^!перел[её]т\s+(.+)$/i
  );

  if (flightMatch) {
    const country = getCountry(flightMatch[1]);

    if (!country) {
      await context.send(
        '❌ Такой страны нет в каталоге.\n\n' +
        'Открой список командой: !перелёт'
      );

      return true;
    }

    return sendResearchPrompt(context, country);
  }

  if (/^!переезд\s*$/i.test(originalText)) {
    await context.send(
      '❌ Укажи страну для переезда.\n\n' +
      'Пример: !переезд Германия\n' +
      'Список стран: !перелёт'
    );

    return true;
  }

  const moveMatch = originalText.match(
    /^!переезд\s+(.+)$/i
  );

  if (!moveMatch) {
    return false;
  }

  const country = getCountry(moveMatch[1]);

  if (!country) {
    await context.send(
      '❌ Такой страны нет в каталоге.\n\n' +
      'Открой список командой: !перелёт'
    );

    return true;
  }

  return sendMovePrompt(context, country);
}

module.exports = {
  RESEARCH_COST,
  MOVE_COST,
  getProfileText,
  handle
};
