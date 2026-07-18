import bridge from '@vkontakte/vk-bridge';
import './styles.css';

const appId = Number(
  import.meta.env.VITE_VK_APP_ID
);
const searchParams = new URLSearchParams(
  window.location.search
);
const launchGroupId = Number(
  searchParams.get('vk_group_id')
);

const groupInput =
  document.querySelector('#group-id');
const groupStatus =
  document.querySelector('#group-status');
const addCommunityButton =
  document.querySelector('#add-community-button');
const tokenButton =
  document.querySelector('#token-button');
const tokenCard =
  document.querySelector('#token-card');
const tokenValue =
  document.querySelector('#token-value');
const copyButton =
  document.querySelector('#copy-button');
const previewButton =
  document.querySelector('#preview-button');
const message =
  document.querySelector('#message');

function setMessage(text, type = '') {
  message.textContent = text;
  message.className = `message ${type}`.trim();
}

function getGroupId() {
  const groupId = Number(groupInput.value);

  return Number.isInteger(groupId) && groupId > 0
    ? groupId
    : null;
}

function getPreviewCode(groupId) {
  const appUrl =
    `https://vk.ru/app${appId}_-${groupId}`;
  const widget = {
    title: '💵 Лучшие игроки по балансу 💵',
    title_url: appUrl,
    head: [
      { text: 'Место' },
      { text: 'Игрок' },
      { text: 'Баланс' }
    ],
    body: [
      [
        { text: '1' },
        { text: 'Топ подключён' },
        { text: 'Обновляем…' }
      ]
    ],
    more: 'Открыть Zaffron',
    more_url: appUrl
  };

  return `return ${JSON.stringify(widget)};`;
}

async function initialize() {
  try {
    await bridge.send('VKWebAppInit');

    if (launchGroupId > 0) {
      groupInput.value = String(launchGroupId);
      groupStatus.textContent = `ID ${launchGroupId}`;
    } else {
      groupStatus.textContent = 'Укажи ID ниже';
    }
  } catch (error) {
    groupStatus.textContent = 'Открой приложение внутри VK';
    setMessage(
      'Mini App нужно запускать через ВКонтакте.',
      'error'
    );
  }
}

addCommunityButton.addEventListener('click', async () => {
  addCommunityButton.disabled = true;
  setMessage('Открываем выбор сообщества…');

  try {
    const result = await bridge.send(
      'VKWebAppAddToCommunity',
      {}
    );
    const groupId = Number(result.group_id);

    if (!Number.isInteger(groupId) || groupId <= 0) {
      throw new Error('VK не вернул ID сообщества');
    }

    groupInput.value = String(groupId);
    groupStatus.textContent = `ID ${groupId}`;
    setMessage(
      'Приложение добавлено. Теперь получи токен виджета.',
      'success'
    );
  } catch (error) {
    setMessage(
      'Не удалось добавить приложение. Выбери сообщество, где ты администратор, и подтверди действие.',
      'error'
    );
  } finally {
    addCommunityButton.disabled = false;
  }
});

tokenButton.addEventListener('click', async () => {
  const groupId = getGroupId();

  if (!Number.isInteger(appId) || appId <= 0) {
    setMessage(
      'Сначала укажи VITE_VK_APP_ID в файле .env.',
      'error'
    );
    return;
  }

  if (!groupId) {
    setMessage('Укажи ID сообщества.', 'error');
    return;
  }

  tokenButton.disabled = true;
  setMessage('Запрашиваем доступ у VK…');

  try {
    const result = await bridge.send(
      'VKWebAppGetCommunityToken',
      {
        app_id: appId,
        group_id: groupId,
        scope: 'app_widget'
      }
    );

    tokenValue.value = result.access_token;
    tokenCard.classList.remove('hidden');
    setMessage(
      'Готово. Добавь токен на хостинг бота.',
      'success'
    );
  } catch (error) {
    setMessage(
      'Не удалось получить токен. Проверь, что приложение установлено в сообществе и ты являешься администратором.',
      'error'
    );
  } finally {
    tokenButton.disabled = false;
  }
});

copyButton.addEventListener('click', async () => {
  if (!tokenValue.value) {
    return;
  }

  try {
    await bridge.send('VKWebAppCopyText', {
      text: tokenValue.value
    });
    setMessage('Токен скопирован.', 'success');
  } catch {
    tokenValue.select();
    document.execCommand('copy');
    setMessage('Токен скопирован.', 'success');
  }
});

previewButton.addEventListener('click', async () => {
  const groupId = getGroupId();

  if (!groupId) {
    setMessage('Укажи ID сообщества.', 'error');
    return;
  }

  previewButton.disabled = true;

  try {
    await bridge.send(
      'VKWebAppShowCommunityWidgetPreviewBox',
      {
        type: 'table',
        group_id: groupId,
        code: getPreviewCode(groupId)
      }
    );

    setMessage(
      'Виджет установлен. После запуска бота в нём появится настоящий топ.',
      'success'
    );
  } catch {
    setMessage(
      'Открой Mini App с компьютера VK и повтори установку виджета.',
      'error'
    );
  } finally {
    previewButton.disabled = false;
  }
});

void initialize();
