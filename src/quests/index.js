const { Keyboard } = require('vk-io');

const quests = require('./list');

const {
  formatMoney,
  getQuestSnapshot,
  claimQuestReward
} = require('../database');

const QUESTS_PER_PAGE = 4;

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

function getQuestProgress(quest, snapshot) {
  if (quest.condition.type === 'level') {
    return snapshot.level;
  }

  return Number(
    snapshot.stats[quest.condition.key]
  ) || 0;
}

function buildQuestStates(vkId) {
  const snapshot = getQuestSnapshot(vkId);

  return quests.map((quest, index) => {
    const rawProgress =
      getQuestProgress(quest, snapshot);
    const progress = Math.min(
      quest.condition.target,
      rawProgress
    );
    const claimed =
      snapshot.claimedQuestKeys.has(
        quest.key
      );

    return {
      ...quest,
      number: index + 1,
      rawProgress,
      progress,
      claimed,
      ready:
        !claimed &&
        rawProgress >= quest.condition.target
    };
  });
}

function formatProgress(quest) {
  const unit = quest.condition.unit
    ? ` ${quest.condition.unit}`
    : '';

  return (
    `${formatMoney(quest.progress)}/` +
    `${formatMoney(quest.condition.target)}` +
    unit
  );
}

function getStatusIcon(quest) {
  if (quest.claimed) {
    return '✅';
  }

  if (quest.ready) {
    return '🎁';
  }

  return '⏳';
}

function createQuestsKeyboard(
  questStates,
  page
) {
  const keyboard = Keyboard.builder();
  const totalPages = Math.max(
    1,
    Math.ceil(
      questStates.length /
      QUESTS_PER_PAGE
    )
  );
  const safePage = normalizePage(
    page,
    totalPages
  );
  const pageQuests = questStates.slice(
    safePage * QUESTS_PER_PAGE,
    (safePage + 1) * QUESTS_PER_PAGE
  );

  for (const quest of pageQuests) {
    if (!quest.ready) {
      continue;
    }

    keyboard
      .textButton({
        label: `🎁 Забрать №${quest.number}`,
        payload: {
          command: 'quests_claim',
          questKey: quest.key,
          page: safePage
        },
        color: Keyboard.POSITIVE_COLOR
      })
      .row();
  }

  if (safePage > 0) {
    keyboard.textButton({
      label: '⬅ Назад',
      payload: {
        command: 'quests_page',
        page: safePage - 1
      },
      color: Keyboard.SECONDARY_COLOR
    });
  }

  if (safePage < totalPages - 1) {
    keyboard.textButton({
      label: 'Вперёд ➡',
      payload: {
        command: 'quests_page',
        page: safePage + 1
      },
      color: Keyboard.PRIMARY_COLOR
    });
  }

  keyboard
    .row()
    .textButton({
      label: '🔄 Обновить квесты',
      payload: {
        command: 'quests_page',
        page: safePage
      },
      color: Keyboard.SECONDARY_COLOR
    });

  return keyboard.inline();
}

function createReturnKeyboard(page) {
  return Keyboard.builder()
    .textButton({
      label: '📜 Вернуться к квестам',
      payload: {
        command: 'quests_page',
        page
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

async function sendQuests(context, requestedPage = 0) {
  const vkId = Number(context.senderId);
  const questStates = buildQuestStates(vkId);
  const totalPages = Math.max(
    1,
    Math.ceil(
      questStates.length /
      QUESTS_PER_PAGE
    )
  );
  const page = normalizePage(
    requestedPage,
    totalPages
  );
  const pageQuests = questStates.slice(
    page * QUESTS_PER_PAGE,
    (page + 1) * QUESTS_PER_PAGE
  );
  const completedCount = questStates.filter(
    quest => quest.claimed
  ).length;
  const readyCount = questStates.filter(
    quest => quest.ready
  ).length;

  const lines = pageQuests.map(quest => (
    `${getStatusIcon(quest)} №${quest.number}. ${quest.title}\n` +
    `├ ${quest.description}\n` +
    `├ Прогресс: ${formatProgress(quest)}\n` +
    `└ Награда: ${quest.rewardText}`
  ));

  await context.send({
    message:
      '📜 Квесты Zaffron\n\n' +
      `✅ Получено наград: ${completedCount}/${quests.length}\n` +
      `🎁 Доступно наград: ${readyCount}\n` +
      `📄 Страница: ${page + 1}/${totalPages}\n\n` +
      lines.join('\n\n') + '\n\n' +
      '🎁 Выполненный квест можно забрать кнопкой.',
    keyboard: createQuestsKeyboard(
      questStates,
      page
    )
  });

  return true;
}

function buildRewardLines(result) {
  const lines = [];

  if (result.dollars > 0) {
    lines.push(
      `💵 Деньги: +${formatMoney(result.dollars)} ₽`
    );
  }

  if (result.experienceEarned > 0) {
    lines.push(
      `⭐ EXP: +${result.experienceEarned}`
    );

    if (result.levelsGained > 0) {
      lines.push(
        `🎉 Новый уровень: ${result.level}`
      );
    }
  }

  if (result.aura > 0) {
    lines.push(
      `✨ Аура: +${result.aura}`
    );
  }

  if (result.boosts > 0) {
    lines.push(
      `⚡ Буст x2: ${result.boosts} смены`
    );
  }

  if (result.asset) {
    if (result.asset.granted) {
      lines.push(
        `📦 Имущество: ${result.asset.title}`
      );
    } else {
      lines.push(
        `📦 ${result.asset.title} уже есть`,
        `💰 Компенсация 70%: +${formatMoney(result.asset.compensation)} ₽`
      );
    }
  }

  lines.push(
    `🏦 Баланс: ${formatMoney(result.balance)} ₽`,
    `⭐ Уровень: ${result.level}`,
    `✨ Аура: ${result.totalAura}`
  );

  return lines;
}

async function claimQuest(
  context,
  questKey,
  requestedPage = 0
) {
  const vkId = Number(context.senderId);
  const questStates = buildQuestStates(vkId);
  const quest = questStates.find(
    item => item.key === String(questKey)
  );
  const page = Math.max(
    0,
    Number(requestedPage) || 0
  );

  if (!quest) {
    await context.send({
      message: '❌ Такой квест не найден.',
      keyboard: createReturnKeyboard(page)
    });

    return true;
  }

  if (quest.claimed) {
    await context.send({
      message:
        `✅ Награда за квест «${quest.title}» уже получена.`,
      keyboard: createReturnKeyboard(page)
    });

    return true;
  }

  if (!quest.ready) {
    await context.send({
      message:
        `⏳ Квест «${quest.title}» ещё не выполнен.\n\n` +
        `Прогресс: ${formatProgress(quest)}`,
      keyboard: createReturnKeyboard(page)
    });

    return true;
  }

  const result = claimQuestReward({
    vkId,
    questKey: quest.key,
    rewards: quest.rewards
  });

  if (result.status === 'already_claimed') {
    await context.send({
      message:
        `✅ Награда за квест «${quest.title}» уже получена.`,
      keyboard: createReturnKeyboard(page)
    });

    return true;
  }

  if (result.status === 'balance_limit') {
    await context.send({
      message:
        '❌ Баланс достиг технического лимита. Награду пока получить нельзя.',
      keyboard: createReturnKeyboard(page)
    });

    return true;
  }

  await context.send({
    message:
      '🎉 Награда за квест получена!\n\n' +
      `📜 ${quest.title}\n\n` +
      buildRewardLines(result).join('\n'),
    keyboard: createReturnKeyboard(page)
  });

  return true;
}

async function handle(context) {
  const originalText =
    String(context.text ?? '').trim();
  const payload = context.messagePayload;

  if (payload?.command === 'quests_page') {
    return sendQuests(
      context,
      payload.page
    );
  }

  if (payload?.command === 'quests_claim') {
    return claimQuest(
      context,
      payload.questKey,
      payload.page
    );
  }

  if (/^!квесты?$/i.test(originalText)) {
    return sendQuests(context);
  }

  return false;
}

module.exports = {
  handle
};
