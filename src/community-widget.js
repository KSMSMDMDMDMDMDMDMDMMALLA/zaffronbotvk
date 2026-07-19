const { VK } = require('vk-io');

const {
  formatMoney,
  getBalanceTop
} = require('./database');

const DEFAULT_UPDATE_INTERVAL_MS =
  5 * 60 * 1000;

let widgetVk = null;
let updateTimer = null;
let updateInProgress = false;

function getPositiveInteger(value) {
  const number = Number(value);

  return (
    Number.isInteger(number) &&
    number > 0
  )
    ? number
    : null;
}

function getUpdateInterval() {
  const value = getPositiveInteger(
    process.env.VK_WIDGET_UPDATE_INTERVAL_MS
  );

  return value ?? DEFAULT_UPDATE_INTERVAL_MS;
}

function getAppUrl() {
  const appId = getPositiveInteger(
    process.env.VK_APP_ID
  );
  const groupId = getPositiveInteger(
    process.env.VK_GROUP_ID
  );

  if (!appId) {
    return 'https://vk.ru/zaffron';
  }

  return groupId
    ? `https://vk.ru/app${appId}_-${groupId}`
    : `https://vk.ru/app${appId}`;
}

function getWidgetVk() {
  const token = String(
    process.env.VK_WIDGET_TOKEN ?? ''
  ).trim();

  if (!token) {
    return null;
  }

  if (!widgetVk) {
    widgetVk = new VK({
      token,
      apiVersion: '5.199'
    });
  }

  return widgetVk;
}

async function getUsersById(vk, userIds) {
  if (userIds.length === 0) {
    return new Map();
  }

  try {
    const users = await vk.api.users.get({
      user_ids: userIds.join(',')
    });

    return new Map(
      users.map(user => [
        Number(user.id),
        user
      ])
    );
  } catch (error) {
    console.error(
      'Не удалось получить имена для виджета:',
      error?.message ?? error
    );

    return new Map();
  }
}

function getUserName(user, vkId) {
  if (!user) {
    return `Игрок id${vkId}`;
  }

  return [
    user.first_name,
    user.last_name
  ]
    .filter(Boolean)
    .join(' ') || `Игрок id${vkId}`;
}

function buildWidgetCode(top, usersById) {
  const appUrl = getAppUrl();
  const body = top.map((item, index) => {
    const user = usersById.get(item.vkId);

    return [
      {
        text: String(index + 1)
      },
      {
        text: getUserName(user, item.vkId),
        url: `https://vk.ru/id${item.vkId}`
      },
      {
        text: `${formatMoney(item.balance)} ₽`
      }
    ];
  });

  if (body.length === 0) {
    body.push([
      { text: '—' },
      { text: 'Игроков пока нет' },
      { text: '0 ₽' }
    ]);
  }

  const widget = {
    title: '💵 Лучшие игроки по балансу 💵',
    title_url: appUrl,
    head: [
      { text: 'Место' },
      { text: 'Игрок' },
      { text: 'Баланс' }
    ],
    body,
    more: 'Открыть Zaffron',
    more_url: appUrl
  };

  return `return ${JSON.stringify(widget)};`;
}

async function update(vk) {
  const api = getWidgetVk();

  if (!api) {
    return {
      status: 'disabled',
      reason: 'VK_WIDGET_TOKEN не указан'
    };
  }

  if (updateInProgress) {
    return {
      status: 'busy'
    };
  }

  updateInProgress = true;

  try {
    const top = getBalanceTop(10);
    const usersById = await getUsersById(
      vk,
      top.map(item => item.vkId)
    );
    const code = buildWidgetCode(
      top,
      usersById
    );

    await api.api.appWidgets.update({
      type: 'table',
      code
    });

    console.log(
      `Виджет топа обновлён: ${top.length} игроков.`
    );

    return {
      status: 'updated',
      players: top.length
    };
  } catch (error) {
    console.error(
      'Не удалось обновить виджет топа:',
      error
    );

    return {
      status: 'error',
      error
    };
  } finally {
    updateInProgress = false;
  }
}

function initialize(vk) {
  if (!getWidgetVk()) {
    console.log(
      'Виджет топа отключён: VK_WIDGET_TOKEN не указан.'
    );

    return false;
  }

  void update(vk);

  updateTimer = setInterval(
    () => void update(vk),
    getUpdateInterval()
  );

  updateTimer.unref?.();

  return true;
}

module.exports = {
  initialize,
  update,
  buildWidgetCode
};
