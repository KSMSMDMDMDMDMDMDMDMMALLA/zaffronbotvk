const crypto = require('node:crypto');
const { Keyboard } = require('vk-io');

const {
  formatMoney,
  BEGINNER_BOX_MAX_LEVEL,
  BEGINNER_BOX_COOLDOWN_MS,
  getBeginnerBoxStatus,
  claimBeginnerBox
} = require('../database');

const REWARD_ROLL_MAX = 10000;

const REWARD_TIERS = Object.freeze([
  {
    key: 'cash-bundle',
    title: 'Пачка купюр',
    emoji: '💵',
    upperBound: 6500,
    minReward: 1000,
    maxReward: 3000
  },
  {
    key: 'hidden-stash',
    title: 'Спрятанная заначка',
    emoji: '🪙',
    upperBound: 9000,
    minReward: 3000,
    maxReward: 7000
  },
  {
    key: 'gold-envelope',
    title: 'Золотой конверт',
    emoji: '✉',
    upperBound: 9900,
    minReward: 7000,
    maxReward: 15000
  },
  {
    key: 'newbie-jackpot',
    title: 'Джекпот новичка',
    emoji: '💎',
    upperBound: 10000,
    minReward: 50000,
    maxReward: 50000
  }
]);

function rollBeginnerBox(
  randomInteger = crypto.randomInt
) {
  const roll = randomInteger(
    0,
    REWARD_ROLL_MAX
  );
  const tier = REWARD_TIERS.find(
    item => roll < item.upperBound
  ) ?? REWARD_TIERS[0];
  const reward = tier.minReward === tier.maxReward
    ? tier.minReward
    : randomInteger(
      tier.minReward,
      tier.maxReward + 1
    );

  return {
    ...tier,
    reward
  };
}

function formatRemainingTime(milliseconds) {
  const totalSeconds = Math.max(
    0,
    Math.ceil(Number(milliseconds) / 1000)
  );
  const minutes = Math.floor(
    totalSeconds / 60
  );
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds} сек.`;
  }

  if (seconds <= 0) {
    return `${minutes} мин.`;
  }

  return `${minutes} мин. ${seconds} сек.`;
}

function createBoxesKeyboard() {
  return Keyboard.builder()
    .textButton({
      label: '🟥 Коробка 1',
      payload: {
        command: 'beginner_box_open',
        boxNumber: 1
      },
      color: Keyboard.NEGATIVE_COLOR
    })
    .textButton({
      label: '🟦 Коробка 2',
      payload: {
        command: 'beginner_box_open',
        boxNumber: 2
      },
      color: Keyboard.PRIMARY_COLOR
    })
    .textButton({
      label: '🟩 Коробка 3',
      payload: {
        command: 'beginner_box_open',
        boxNumber: 3
      },
      color: Keyboard.POSITIVE_COLOR
    })
    .inline();
}

async function sendLevelLimit(
  context,
  level
) {
  await context.send(
    '🎓 Коробка новичка доступна только игрокам ' +
    `1–${BEGINNER_BOX_MAX_LEVEL} уровня включительно.\n\n` +
    `Твой уровень: ${level}.\n` +
    'Теперь основной заработок доступен на работах, ' +
    'рыбалке и в бизнесах.'
  );

  return true;
}

async function sendCooldown(
  context,
  status
) {
  await context.send(
    '⏳ Новая коробка пока закрыта.\n\n' +
    'Можно открыть через: ' +
    formatRemainingTime(status.remainingMs)
  );

  return true;
}

async function sendBeginnerBox(context) {
  const status = getBeginnerBoxStatus(
    Number(context.senderId)
  );

  if (status.status === 'level_limit') {
    return sendLevelLimit(
      context,
      status.level
    );
  }

  if (status.status === 'cooldown') {
    return sendCooldown(context, status);
  }

  await context.send({
    message:
      '🎁 Коробка новичка\n\n' +
      `Доступна игрокам 1–${BEGINNER_BOX_MAX_LEVEL} уровня.\n` +
      'Выбери одну из трёх коробок — награда ' +
      'определится только после нажатия.\n\n' +
      '💵 Обычная награда: 1.000–15.000 ₽\n' +
      '💎 Шанс джекпота 50.000 ₽: 1%\n' +
      `⏳ Новая попытка: раз в ${BEGINNER_BOX_COOLDOWN_MS / 60000} минут`,
    keyboard: createBoxesKeyboard()
  });

  return true;
}

async function openBeginnerBox(
  context,
  rawBoxNumber
) {
  const boxNumber = Number(rawBoxNumber);

  if (
    !Number.isInteger(boxNumber) ||
    boxNumber < 1 ||
    boxNumber > 3
  ) {
    await context.send(
      '❌ Такой коробки нет. Напиши !коробка и выбери кнопку.'
    );

    return true;
  }

  const vkId = Number(context.senderId);
  const status = getBeginnerBoxStatus(vkId);

  if (status.status === 'level_limit') {
    return sendLevelLimit(
      context,
      status.level
    );
  }

  if (status.status === 'cooldown') {
    return sendCooldown(context, status);
  }

  const prize = rollBeginnerBox();
  const result = claimBeginnerBox({
    vkId,
    reward: prize.reward
  });

  if (result.status === 'level_limit') {
    return sendLevelLimit(
      context,
      result.level
    );
  }

  if (result.status === 'cooldown') {
    return sendCooldown(context, result);
  }

  if (
    result.status === 'balance_limit' ||
    result.status === 'stat_limit'
  ) {
    await context.send(
      '❌ Достигнут технический лимит. Коробка не была потрачена.'
    );

    return true;
  }

  const debtLines = result.debtPaid > 0
    ? [
      `💳 Погашено долга: ${formatMoney(result.debtPaid)} ₽`,
      `💵 Зачислено на баланс: ${formatMoney(result.credited)} ₽`
    ]
    : [];

  await context.send(
    `📦 Ты открыл коробку №${boxNumber}!\n\n` +
    `${prize.emoji} ${prize.title}\n` +
    `💰 Награда: ${formatMoney(result.reward)} ₽\n` +
    (
      debtLines.length > 0
        ? `${debtLines.join('\n')}\n`
        : ''
    ) +
    `🏦 Баланс: ${formatMoney(result.balance)} ₽\n\n` +
    '⏳ Следующая коробка будет доступна через 10 минут.'
  );

  return true;
}

async function handle(context) {
  const originalText =
    String(context.text ?? '').trim();
  const payload = context.messagePayload;

  if (payload?.command === 'beginner_box_open') {
    return openBeginnerBox(
      context,
      payload.boxNumber
    );
  }

  if (
    /^!коробка(?:\s+новичка)?$/i.test(
      originalText
    )
  ) {
    return sendBeginnerBox(context);
  }

  return false;
}

module.exports = {
  REWARD_TIERS,
  rollBeginnerBox,
  formatRemainingTime,
  handle
};
