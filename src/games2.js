const {
  formatMoney,
  getBalance,
  removeBalance,
  applyGamePenalty,
  applyGameReward,
  incrementQuestStat,
  recordTreasuryGameLoss
} = require('./database');

const crypto = require('node:crypto');
const { Keyboard } = require('vk-io');
const {
  tryInsuranceRefund
} = require('./perks');

/*
 * games2.js
 *
 * Игры:
 * 1. !картошка / !пас @user
 * 2. !бомба / !режу красный
 * 3. !реакция / ловлю
 * 4. !кейс
 * 5. !казино <ставка>
 * 6. !угадай / !число <1-20>
 * 7. !ракета <ставка>
 */

/*
 * ------------------------------
 * Настройки
 * ------------------------------
 */

const POTATO_COOLDOWN =
  5 * 60 * 1000;

const BOMB_COOLDOWN =
  1 * 60 * 1000;

const REACTION_COOLDOWN =
  10 * 60 * 1000;

const CASINO_COOLDOWN =
  3 * 1000;

const CASINO_INSURANCE_AFTER_LOSSES = 3;

/*
 * Казино должно выводить деньги из экономики,
 * а не бесконечно создавать их.
 *
 * Вероятности:
 *  - x0                 — 25%
 *  - x0.5               — 26%
 *  - x1                 — 15%
 *  - x1.5               — 21%
 *  - x2                 — 4%
 *  - x3                 — 8%
 *  - x5                 — 0.9%
 *  - x10                — 0.1%
 *
 * Средняя выплата составляет x0.97.
 */
const CASINO_OUTCOMES =
  Object.freeze([
    {
      multiplierTenths: 0,
      weight: 2500,
      title: '💥 Полный проигрыш'
    },
    {
      multiplierTenths: 5,
      weight: 2600,
      title: '📉 Вернулась половина ставки'
    },
    {
      multiplierTenths: 10,
      weight: 1500,
      title: '➖ Ставка вернулась'
    },
    {
      multiplierTenths: 15,
      weight: 2100,
      title: '✨ Небольшой выигрыш'
    },
    {
      multiplierTenths: 20,
      weight: 400,
      title: '💰 Хороший выигрыш'
    },
    {
      multiplierTenths: 30,
      weight: 800,
      title: '🔥 Крупный выигрыш'
    },
    {
      multiplierTenths: 50,
      weight: 90,
      title: '💎 Редкий выигрыш'
    },
    {
      multiplierTenths: 100,
      weight: 10,
      title: '👑 ДЖЕКПОТ'
    }
  ]);

const CASINO_TOTAL_WEIGHT =
  CASINO_OUTCOMES.reduce(
    (total, outcome) =>
      total + outcome.weight,
    0
  );

const ROCKET_MIN_BET = 1_000;
const ROCKET_MAX_BET = 1_000_000_000;
const ROCKET_DECISION_TIMEOUT =
  10 * 60 * 1000;

/*
 * Вероятность дойти до любой ступени подобрана
 * так, чтобы выплата на ней имела RTP 96%.
 */
const ROCKET_STAGES = Object.freeze([
  {
    multiplierHundredths: 120,
    surviveWeight: 4,
    totalWeight: 5
  },
  {
    multiplierHundredths: 150,
    surviveWeight: 4,
    totalWeight: 5
  },
  {
    multiplierHundredths: 200,
    surviveWeight: 3,
    totalWeight: 4
  },
  {
    multiplierHundredths: 300,
    surviveWeight: 2,
    totalWeight: 3
  },
  {
    multiplierHundredths: 500,
    surviveWeight: 3,
    totalWeight: 5
  },
  {
    multiplierHundredths: 1_000,
    surviveWeight: 1,
    totalWeight: 2
  },
  {
    multiplierHundredths: 2_500,
    surviveWeight: 2,
    totalWeight: 5
  },
  {
    multiplierHundredths: 10_000,
    surviveWeight: 1,
    totalWeight: 4
  }
]);

const GUESS_COOLDOWN =
  5 * 60 * 1000;

/*
 * Время и задержки самих игр.
 */
const CASE_COOLDOWN =
  30 * 60 * 1000;

const HOT_POTATO_MIN_TIME =
  15 * 1000;

const HOT_POTATO_MAX_TIME =
  30 * 1000;

const BOMB_TIME =
  15 * 1000;

const REACTION_MIN_DELAY =
  3 * 1000;

const REACTION_MAX_DELAY =
  8 * 1000;

const GUESS_TIME =
  60 * 1000;

const gameCooldowns = {
  potato: new Map(),
  bomb: new Map(),
  reaction: new Map(),
  casino: new Map(),
  guess: new Map()
};

const casinoLossStreaks = new Map();
const rocketGames = new Map();

/*
 * Активные игры по peerId.
 */
const hotPotatoGames = new Map();
const bombGames = new Map();
const reactionGames = new Map();
const guessGames = new Map();

/*
 * Кулдаун кейсов.
 *
 * Ключ: peerId:userId
 */
const caseCooldowns = new Map();

function randomInteger(min, max) {
  return Math.floor(
    Math.random() * (max - min + 1)
  ) + min;
}

function getCasinoOutcome(
  randomIntegerFunction = crypto.randomInt
) {
  const roll = randomIntegerFunction(
    0,
    CASINO_TOTAL_WEIGHT
  );

  let accumulatedWeight = 0;

  for (
    const outcome of
      CASINO_OUTCOMES
  ) {
    accumulatedWeight += outcome.weight;

    if (roll >= accumulatedWeight) {
      continue;
    }

    return outcome;
  }

  return CASINO_OUTCOMES.at(-1);
}

function getCasinoRound(
  lossStreak,
  randomIntegerFunction = crypto.randomInt
) {
  const safeLossStreak = Math.max(
    0,
    Number.isInteger(Number(lossStreak))
      ? Number(lossStreak)
      : 0
  );
  const insuranceActivated =
    safeLossStreak >=
      CASINO_INSURANCE_AFTER_LOSSES;
  const outcome = insuranceActivated
    ? CASINO_OUTCOMES.find(item =>
      item.multiplierTenths === 10
    )
    : getCasinoOutcome(
      randomIntegerFunction
    );

  return {
    outcome,
    insuranceActivated
  };
}

function formatCasinoMultiplier(
  multiplierTenths
) {
  const multiplier =
    multiplierTenths / 10;

  return Number.isInteger(multiplier)
    ? String(multiplier)
    : multiplier.toFixed(1);
}

function formatCasinoChance(weight) {
  return (weight / 100)
    .toFixed(2)
    .replace('.', ',')
    .replace(/,00$/, '')
    .replace(/0$/, '');
}

function createCasinoRepeatKeyboard(bet) {
  return Keyboard.builder()
    .textButton({
      label: '🎰 Повторить ставку',
      payload: {
        command: 'casino_repeat_bet',
        bet
      },
      color: Keyboard.POSITIVE_COLOR
    })
    .inline();
}

async function sendCasinoChances(context) {
  const lines = CASINO_OUTCOMES.map(
    outcome =>
      `x${formatCasinoMultiplier(outcome.multiplierTenths)} — ` +
      `${formatCasinoChance(outcome.weight)}% • ${outcome.title}`
  );

  await context.send(
    '🎰 Шансы казино Zaffron\n\n' +
    `${lines.join('\n')}\n\n` +
    '📊 Средняя отдача игроку: 97%\n' +
    '🏦 Преимущество казино: 3%\n' +
    '🔥 x3 выпадает примерно раз в 12–13 игр.\n\n' +
    '🛡 Страховка серии: после трёх результатов ниже x1 следующая ставка гарантированно получает x1.'
  );

  return true;
}

function formatRocketMultiplier(
  multiplierHundredths
) {
  const multiplier =
    multiplierHundredths / 100;

  return Number.isInteger(multiplier)
    ? String(multiplier)
    : multiplier.toFixed(2)
      .replace(/0$/, '');
}

function formatRocketPercent(value) {
  return Number(value)
    .toFixed(2)
    .replace('.', ',')
    .replace(/,00$/, '')
    .replace(/,(\d)0$/, ',$1');
}

function getRocketStageChance(stage) {
  return stage.surviveWeight /
    stage.totalWeight * 100;
}

function getRocketReachChance(stageIndex) {
  let chance = 1;

  for (
    let index = 0;
    index <= stageIndex;
    index += 1
  ) {
    const stage = ROCKET_STAGES[index];
    chance *= stage.surviveWeight /
      stage.totalWeight;
  }

  return chance * 100;
}

function rollRocketStage(
  stage,
  randomIntegerFunction = crypto.randomInt
) {
  return randomIntegerFunction(
    0,
    stage.totalWeight
  ) < stage.surviveWeight;
}

function getRocketGameKey(userId) {
  return String(Number(userId));
}

function clearRocketTimer(game) {
  if (game?.timer) {
    clearTimeout(game.timer);
    game.timer = null;
  }
}

function finishRocketGame(game) {
  clearRocketTimer(game);
  game.finished = true;
  rocketGames.delete(game.key);
}

function refundActiveRocketGames() {
  for (const game of [
    ...rocketGames.values()
  ]) {
    if (game.finished) {
      continue;
    }

    try {
      finishRocketGame(game);
      applyGameReward(
        game.userId,
        game.bet
      );
    } catch (error) {
      console.error(
        'Не удалось вернуть ставку активной ракеты при остановке:',
        error
      );
    }
  }
}

function handleRocketShutdown() {
  refundActiveRocketGames();
  process.exit(0);
}

process.once(
  'SIGINT',
  handleRocketShutdown
);

process.once(
  'SIGTERM',
  handleRocketShutdown
);

function createRocketDecisionKeyboard(game) {
  const stage = ROCKET_STAGES[game.stageIndex];
  const payout = Math.floor(
    game.bet * stage.multiplierHundredths / 100
  );

  return Keyboard.builder()
    .textButton({
      label:
        `💰 Забрать ${formatMoney(payout)} ₽`,
      payload: {
        command: 'rocket_cashout',
        gameId: game.id
      },
      color: Keyboard.POSITIVE_COLOR
    })
    .textButton({
      label: '🚀 Лететь дальше',
      payload: {
        command: 'rocket_continue',
        gameId: game.id
      },
      color: Keyboard.PRIMARY_COLOR
    })
    .inline();
}

function createRocketRepeatKeyboard(bet) {
  return Keyboard.builder()
    .textButton({
      label: '🚀 Повторить ставку',
      payload: {
        command: 'rocket_repeat',
        bet
      },
      color: Keyboard.POSITIVE_COLOR
    })
    .inline();
}

function getRocketStateMessage(game) {
  const stage = ROCKET_STAGES[game.stageIndex];
  const nextStage =
    ROCKET_STAGES[game.stageIndex + 1];
  const payout = Math.floor(
    game.bet * stage.multiplierHundredths / 100
  );

  return (
    '🚀 Ракета набирает высоту!\n\n' +
    `✅ Текущий множитель: x${formatRocketMultiplier(stage.multiplierHundredths)}\n` +
    `💵 Ставка: ${formatMoney(game.bet)} ₽\n` +
    `💰 Можно забрать: ${formatMoney(payout)} ₽\n\n` +
    `🎯 Следующая цель: x${formatRocketMultiplier(nextStage.multiplierHundredths)}\n` +
    `📊 Шанс долететь: ${formatRocketPercent(getRocketStageChance(nextStage))}%\n\n` +
    'Выбирай: забрать деньги или рискнуть всем.\n' +
    '⏳ На решение даётся 10 минут.'
  );
}

function settleRocketCashout(game) {
  const stage = ROCKET_STAGES[game.stageIndex];
  const payout = Math.floor(
    game.bet * stage.multiplierHundredths / 100
  );
  const profit = payout - game.bet;

  finishRocketGame(game);

  return {
    stage,
    payout,
    profit,
    reward: applyGameReward(
      game.userId,
      payout
    )
  };
}

function scheduleRocketTimeout(game, vk) {
  clearRocketTimer(game);

  game.timer = setTimeout(
    async () => {
      const current =
        rocketGames.get(game.key);

      if (
        !current ||
        current !== game ||
        game.finished
      ) {
        return;
      }

      const result =
        settleRocketCashout(game);

      if (!vk?.api?.messages?.send) {
        return;
      }

      await sendMessage(
        vk,
        game.peerId,
        '⌛ Время на решение истекло.\n\n' +
        'Ракета автоматически зафиксировала выигрыш.\n' +
        `🚀 Множитель: x${formatRocketMultiplier(result.stage.multiplierHundredths)}\n` +
        `💰 Выплата: ${formatMoney(result.payout)} ₽\n` +
        `📈 Чистая прибыль: +${formatMoney(result.profit)} ₽\n\n` +
        formatGameReward(result.reward)
      ).catch(console.error);
    },
    ROCKET_DECISION_TIMEOUT
  );

  game.timer.unref?.();
}

async function sendRocketChances(context) {
  const lines = ROCKET_STAGES.map(
    (stage, index) =>
      `x${formatRocketMultiplier(stage.multiplierHundredths)} — ` +
      `этап ${formatRocketPercent(getRocketStageChance(stage))}%` +
      ` • дойти ${formatRocketPercent(getRocketReachChance(index))}%`
  );

  await context.send(
    '🚀 Шансы игры «Ракета»\n\n' +
    `${lines.join('\n')}\n\n` +
    '📊 RTP любой выбранной ступени: 96%\n' +
    `💵 Ставка: от ${formatMoney(ROCKET_MIN_BET)} до ${formatMoney(ROCKET_MAX_BET)} ₽\n` +
    'На каждой ступени можно забрать деньги или полететь дальше.'
  );

  return true;
}

async function cashoutRocket(
  context,
  gameId
) {
  const key = getRocketGameKey(
    context.senderId
  );
  const game = rocketGames.get(key);

  if (
    !game ||
    game.finished ||
    game.id !== String(gameId ?? '') ||
    game.stageIndex < 0
  ) {
    await context.reply(
      '❌ Эта игра в «Ракету» уже завершена.'
    );

    return true;
  }

  const result = settleRocketCashout(game);

  await context.send({
    message:
      '💰 Выигрыш зафиксирован!\n\n' +
      `🚀 Множитель: x${formatRocketMultiplier(result.stage.multiplierHundredths)}\n` +
      `💵 Ставка: ${formatMoney(game.bet)} ₽\n` +
      `💰 Выплата: ${formatMoney(result.payout)} ₽\n` +
      `📈 Чистая прибыль: +${formatMoney(result.profit)} ₽\n\n` +
      formatGameReward(result.reward),
    keyboard: createRocketRepeatKeyboard(
      game.bet
    )
  });

  return true;
}

async function continueRocket(
  context,
  gameId,
  vk
) {
  const key = getRocketGameKey(
    context.senderId
  );
  const game = rocketGames.get(key);

  if (
    !game ||
    game.finished ||
    game.id !== String(gameId ?? '')
  ) {
    await context.reply(
      '❌ Эта игра в «Ракету» уже завершена.'
    );

    return true;
  }

  clearRocketTimer(game);

  const nextStageIndex =
    game.stageIndex + 1;
  const nextStage =
    ROCKET_STAGES[nextStageIndex];

  if (!nextStage) {
    return cashoutRocket(
      context,
      game.id
    );
  }

  if (!rollRocketStage(nextStage)) {
    const previousStage = game.stageIndex >= 0
      ? ROCKET_STAGES[game.stageIndex]
      : null;

    const perkInsurance =
      tryInsuranceRefund(
        game.userId,
        game.bet
      );

    let insuranceText = '';

    if (perkInsurance.status === 'refunded') {
      const rewardResult = applyGameReward(
        game.userId,
        perkInsurance.refund
      );

      insuranceText =
        '\n🛡 Страховка сработала: ' +
        `возврат ${formatMoney(perkInsurance.refund)} ₽\n` +
        `🎟 Осталось покрытия: ${formatMoney(perkInsurance.charges)} ₽\n` +
        `${formatGameReward(rewardResult)}\n`;
    } else if (
      perkInsurance.status === 'not_triggered'
    ) {
      insuranceText =
        '\n🛡 Страховка не сработала: шанс 50/50.\n';
    }

    const refunded =
      perkInsurance.status === 'refunded'
        ? perkInsurance.refund
        : 0;

    recordTreasuryGameLoss(
      Math.max(0, game.bet - refunded)
    );

    finishRocketGame(game);

    await context.send({
      message:
        '💥 Ракета взорвалась!\n\n' +
        `🎯 Цель была: x${formatRocketMultiplier(nextStage.multiplierHundredths)}\n` +
        (previousStage
          ? `🚀 Ты добрался до x${formatRocketMultiplier(previousStage.multiplierHundredths)}\n`
          : '') +
        `📉 Потеряно: ${formatMoney(game.bet)} ₽\n` +
        insuranceText +
        `🏦 Баланс: ${formatMoney(getBalance(game.userId))} ₽`,
      keyboard: createRocketRepeatKeyboard(
        game.bet
      )
    });

    return true;
  }

  game.stageIndex = nextStageIndex;

  if (
    nextStageIndex ===
      ROCKET_STAGES.length - 1
  ) {
    const result =
      settleRocketCashout(game);

    await context.send({
      message:
        '👑 РАКЕТА ДОСТИГЛА МАКСИМУМА!\n\n' +
        `🚀 Множитель: x${formatRocketMultiplier(result.stage.multiplierHundredths)}\n` +
        `💵 Ставка: ${formatMoney(game.bet)} ₽\n` +
        `💰 Выплата: ${formatMoney(result.payout)} ₽\n` +
        `📈 Чистая прибыль: +${formatMoney(result.profit)} ₽\n\n` +
        formatGameReward(result.reward),
      keyboard: createRocketRepeatKeyboard(
        game.bet
      )
    });

    return true;
  }

  scheduleRocketTimeout(game, vk);

  await context.send({
    message: getRocketStateMessage(game),
    keyboard: createRocketDecisionKeyboard(game)
  });

  return true;
}

async function startRocket(
  context,
  rawBet,
  vk
) {
  const userId = Number(context.senderId);
  const key = getRocketGameKey(userId);
  const activeGame = rocketGames.get(key);

  if (activeGame && !activeGame.finished) {
    if (activeGame.stageIndex < 0) {
      await context.reply(
        '🚀 Ракета уже запускается. Подожди результат первого этапа.'
      );

      return true;
    }

    await context.send({
      message:
        '🚀 У тебя уже запущена ракета.\n\n' +
        getRocketStateMessage(activeGame),
      keyboard:
        createRocketDecisionKeyboard(activeGame)
    });

    return true;
  }

  const balance = getBalance(userId);
  const normalizedBet = String(rawBet ?? '')
    .trim()
    .toLowerCase();
  const isAllIn = [
    'всё',
    'все',
    'all'
  ].includes(normalizedBet);
  const amountText = normalizedBet
    .replace(/[$₽]$/, '')
    .trim();
  const bet = isAllIn
    ? Math.min(balance, ROCKET_MAX_BET)
    : /^\d[\d\s.,_]*$/.test(amountText)
      ? Number(
        amountText.replace(/[\s.,_]/g, '')
      )
      : NaN;

  if (
    !Number.isSafeInteger(bet) ||
    bet < ROCKET_MIN_BET
  ) {
    await context.reply(
      '❌ Укажи корректную ставку.\n\n' +
      `Минимум: ${formatMoney(ROCKET_MIN_BET)} ₽\n` +
      `Максимум: ${formatMoney(ROCKET_MAX_BET)} ₽\n\n` +
      'Примеры:\n' +
      '!ракета 100.000\n' +
      '!ракета всё'
    );

    return true;
  }

  if (bet > ROCKET_MAX_BET) {
    await context.reply(
      '❌ Ставка превышает лимит «Ракеты».\n\n' +
      `Максимум: ${formatMoney(ROCKET_MAX_BET)} ₽`
    );

    return true;
  }

  if (balance < bet) {
    await context.reply(
      '❌ Недостаточно денег.\n\n' +
      `💵 Баланс: ${formatMoney(balance)} ₽\n` +
      `🚀 Ставка: ${formatMoney(bet)} ₽`
    );

    return true;
  }

  const payment = removeBalance(
    userId,
    bet
  );

  if (payment.removed !== bet) {
    await context.reply(
      '❌ Не удалось зарезервировать ставку.'
    );

    return true;
  }

  const game = {
    id: crypto.randomBytes(8).toString('hex'),
    key,
    userId,
    peerId: Number(context.peerId),
    bet,
    stageIndex: -1,
    finished: false,
    timer: null
  };

  rocketGames.set(key, game);

  return continueRocket(
    context,
    game.id,
    vk
  );
}

function getPlayerKey(peerId, userId) {
  return `${peerId}:${userId}`;
}

function isChat(context) {
  return Number(context.peerId) >= 2000000000;
}

function mention(userId, name) {
  return `@id${userId} (${name})`;
}

function wait(milliseconds) {
  return new Promise(resolve =>
    setTimeout(resolve, milliseconds)
  );
}

function formatRemainingTime(milliseconds) {
  const totalSeconds = Math.max(
    1,
    Math.ceil(milliseconds / 1000)
  );

  const minutes =
    Math.floor(totalSeconds / 60);

  const seconds =
    totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds} сек.`;
  }

  return `${minutes} мин. ${seconds} сек.`;
}

function formatGamePenalty(result) {
  const lines = [
    `💸 Штраф: -${formatMoney(result.penalty)} ₽`
  ];

  if (result.paid > 0) {
    lines.push(
      `💵 Списано с баланса: ${formatMoney(result.paid)} ₽`
    );
  }

  if (result.debtAdded > 0) {
    lines.push(
      `💳 Добавлено в долг: ${formatMoney(result.debtAdded)} ₽`
    );
  }

  if (result.uncollected > 0) {
    lines.push(
      `🛡 Долг достиг лимита ${formatMoney(result.debtLimit)} ₽`
    );
  }

  lines.push(
    `🥔 Долг в играх: ${formatMoney(result.debt)} ₽`,
    `💵 Баланс игрока: ${formatMoney(result.balance)} ₽`
  );

  return lines.join('\n');
}

function formatGameReward(result) {
  const lines = [];

  if (result.debtPaid > 0) {
    lines.push(
      `💳 Погашено долга: ${formatMoney(result.debtPaid)} ₽`
    );

    lines.push(
      `💵 Зачислено на баланс: ${formatMoney(result.credited)} ₽`
    );
  }

  if (result.debt > 0) {
    lines.push(
      `🥔 Долг в играх: ${formatMoney(result.debt)} ₽`
    );
  }

  lines.push(
    `💵 Баланс игрока: ${formatMoney(result.balance)} ₽`
  );

  return lines.join('\n');
}

function checkGameCooldown(
  map,
  peerId,
  cooldown
) {
  const lastStart =
    map.get(peerId) ?? 0;

  const remaining =
    cooldown -
    (Date.now() - lastStart);

  if (remaining > 0) {
    return remaining;
  }

  map.set(
    peerId,
    Date.now()
  );

  return 0;
}

function sendCooldown(
  context,
  title,
  remaining
) {
  return context.reply(
    `⏳ ${title} недавно запускалась.\n\n` +
    `Попробуйте снова через ${formatRemainingTime(remaining)}`
  );
}

function getReplySenderId(context) {
  const reply = context.replyMessage;

  if (!reply) {
    return null;
  }

  const value =
    reply.senderId ??
    reply.sender_id ??
    reply.fromId ??
    reply.from_id;

  const userId = Number(value);

  return Number.isInteger(userId)
    ? userId
    : null;
}

function extractVkTarget(value) {
  return String(value ?? '')
    .trim()
    .replace(
      /^https?:\/\/(www\.)?vk\.(?:ru|com)\//i,
      ''
    )
    .replace(/^vk\.(?:ru|com)\//i, '')
    .replace(/^@/, '')
    .replace(
      /^\[id(\d+)\|.*\]$/i,
      'id$1'
    )
    .split(/[/?#\s]/)[0]
    .trim();
}

async function resolveUserId(
  context,
  vk,
  rawTarget
) {
  const replyTarget =
    getReplySenderId(context);

  if (replyTarget) {
    return replyTarget;
  }

  const target =
    extractVkTarget(rawTarget);

  if (!target) {
    return null;
  }

  const users =
    await vk.api.users.get({
      user_ids: target
    });

  const user = users?.[0];

  if (!user?.id) {
    return null;
  }

  return Number(user.id);
}

async function getUserName(vk, userId) {
  try {
    const users =
      await vk.api.users.get({
        user_ids: userId
      });

    const user = users?.[0];

    if (!user) {
      return `id${userId}`;
    }

    return [
      user.first_name,
      user.last_name
    ]
      .filter(Boolean)
      .join(' ');
  } catch (error) {
    console.error(
      'Не удалось получить имя пользователя:',
      error
    );

    return `id${userId}`;
  }
}

async function sendMessage(
  vk,
  peerId,
  message
) {
  return vk.api.messages.send({
    peer_id: peerId,
    random_id: 0,
    message
  });
}

function getGameScopeId(context) {
  /*
   * Используется только для раздельных кулдаунов
   * в беседах и личных сообщениях.
   * Сам долларовый баланс общий для всего бота.
   */
  return isChat(context)
    ? Number(context.peerId)
    : 0;
}

/*
 * ------------------------------
 * 1. Горячая картошка
 * ------------------------------
 */

async function startHotPotato(
  context,
  vk
) {
  if (!isChat(context)) {
    await context.reply(
      '❌ Горячая картошка работает только в беседах.'
    );

    return true;
  }

  const peerId =
    Number(context.peerId);

  if (hotPotatoGames.has(peerId)) {
    await context.reply(
      '🥔 В этой беседе уже идёт горячая картошка.'
    );

    return true;
  }

  const userId =
    Number(context.senderId);

  const potatoKey =
    getPlayerKey(
      peerId,
      userId
    );

  const potatoCooldown =
    checkGameCooldown(
      gameCooldowns.potato,
      potatoKey,
      POTATO_COOLDOWN
    );

  if (potatoCooldown > 0) {
    return sendCooldown(
      context,
      'Горячая картошка',
      potatoCooldown
    );
  }

  if (hotPotatoGames.has(peerId)) {
    await context.reply(
      '🥔 В этой беседе уже идёт горячая картошка.'
    );

    return true;
  }

  const holderId =
    userId;

  const duration =
    randomInteger(
      HOT_POTATO_MIN_TIME,
      HOT_POTATO_MAX_TIME
    );

  const game = {
    holderId,
    finished: false,
    timer: null
  };

  hotPotatoGames.set(
    peerId,
    game
  );

  incrementQuestStat(
    userId,
    'potato_played'
  );

  await context.send(
    '🥔 Горячая картошка началась!\n\n' +
    'Картошка сейчас у создателя игры.\n' +
    'Передавайте её командой:\n' +
    '!пас @user\n\n' +
    'Можно также ответить командой !пас ' +
    'на сообщение игрока.'
  );

  game.timer = setTimeout(
    async () => {
      const currentGame =
        hotPotatoGames.get(peerId);

      if (
        !currentGame ||
        currentGame !== game ||
        currentGame.finished
      ) {
        return;
      }

      currentGame.finished = true;
      hotPotatoGames.delete(peerId);

      const loserId =
        currentGame.holderId;

      const loserName =
        await getUserName(
          vk,
          loserId
        );

      const penaltyResult =
        applyGamePenalty(
          loserId,
          5
        );

      await sendMessage(
        vk,
        peerId,
        '💥 Картошка взорвалась!\n\n' +
        `Она была у ${mention(loserId, loserName)}.\n` +
        formatGamePenalty(penaltyResult)
      ).catch(console.error);
    },
    duration
  );

  return true;
}

async function passHotPotato(
  context,
  vk,
  rawTarget
) {
  if (!isChat(context)) {
    return false;
  }

  const peerId =
    Number(context.peerId);

  const game =
    hotPotatoGames.get(peerId);

  if (!game || game.finished) {
    await context.reply(
      '❌ Сейчас в беседе нет активной горячей картошки.'
    );

    return true;
  }

  const senderId =
    Number(context.senderId);

  if (game.holderId !== senderId) {
    await context.reply(
      '🤨 Картошка сейчас не у тебя.'
    );

    return true;
  }

  let targetId;

  try {
    targetId =
      await resolveUserId(
        context,
        vk,
        rawTarget
      );
  } catch (error) {
    console.error(
      'Ошибка поиска игрока для картошки:',
      error
    );

    targetId = null;
  }

  if (!targetId) {
    await context.reply(
      '❌ Укажи игрока или ответь командой !пас ' +
      'на его сообщение.'
    );

    return true;
  }

  if (targetId === senderId) {
    await context.reply(
      '🤨 Нельзя передать картошку самому себе.'
    );

    return true;
  }

  if (targetId <= 0) {
    await context.reply(
      '❌ Нельзя передать картошку сообществу.'
    );

    return true;
  }

  game.holderId = targetId;

  const targetName =
    await getUserName(
      vk,
      targetId
    );

  await context.send(
    `🥔 Картошка передана ${mention(targetId, targetName)}!`
  );

  return true;
}

/*
 * ------------------------------
 * 2. Бомба
 * ------------------------------
 */

async function startBomb(
  context,
  vk
) {
  if (!isChat(context)) {
    await context.reply(
      '❌ Бомба работает только в беседах.'
    );

    return true;
  }

  const peerId =
    Number(context.peerId);

  if (bombGames.has(peerId)) {
    await context.reply(
      '💣 В этой беседе уже активна бомба.'
    );

    return true;
  }

  const userId =
    Number(context.senderId);

  const bombKey =
    getPlayerKey(
      peerId,
      userId
    );

  const bombCooldown =
    checkGameCooldown(
      gameCooldowns.bomb,
      bombKey,
      BOMB_COOLDOWN
    );

  if (bombCooldown > 0) {
    return sendCooldown(
      context,
      'Бомба',
      bombCooldown
    );
  }

  if (bombGames.has(peerId)) {
    await context.reply(
      '💣 В этой беседе уже активна бомба.'
    );

    return true;
  }

  const wires = [
    'красный',
    'синий',
    'зелёный'
  ];

  const correctWire =
    wires[
      randomInteger(
        0,
        wires.length - 1
      )
    ];

  const game = {
    correctWire,
    finished: false,
    timer: null
  };

  bombGames.set(
    peerId,
    game
  );

  await context.send(
    '💣 Бомба активирована!\n\n' +
    'У вас 15 секунд.\n' +
    'Перережьте один провод:\n\n' +
    '!режу красный\n' +
    '!режу синий\n' +
    '!режу зелёный'
  );

  game.timer = setTimeout(
    async () => {
      const currentGame =
        bombGames.get(peerId);

      if (
        !currentGame ||
        currentGame !== game ||
        currentGame.finished
      ) {
        return;
      }

      currentGame.finished = true;
      bombGames.delete(peerId);

      await sendMessage(
        vk,
        peerId,
        '💥 Бомба взорвалась!\n\n' +
        `Правильный провод был: ${correctWire}.`
      ).catch(console.error);
    },
    BOMB_TIME
  );

  return true;
}

async function cutBombWire(
  context,
  wire
) {
  if (!isChat(context)) {
    return false;
  }

  const peerId =
    Number(context.peerId);

  const game =
    bombGames.get(peerId);

  if (!game || game.finished) {
    await context.reply(
      '❌ Сейчас в беседе нет активной бомбы.'
    );

    return true;
  }

  const normalizedWire =
    String(wire)
      .trim()
      .toLowerCase();

  const allowedWires = [
    'красный',
    'синий',
    'зелёный'
  ];

  if (
    !allowedWires.includes(
      normalizedWire
    )
  ) {
    await context.reply(
      '❌ Такого провода нет.'
    );

    return true;
  }

  game.finished = true;

  if (game.timer) {
    clearTimeout(game.timer);
  }

  bombGames.delete(peerId);

  const userId =
    Number(context.senderId);

  if (
    normalizedWire ===
    game.correctWire
  ) {
    const rewardResult =
      applyGameReward(
        userId,
        3
      );

    await context.send(
      '🎉 Бомба обезврежена!\n\n' +
      `@id${userId} получает +3 ₽.\n` +
      formatGameReward(rewardResult)
    );

    return true;
  }

  const penaltyResult =
    applyGamePenalty(
      userId,
      3
    );

  await context.send(
    '💥 Неверный провод! Бомба взорвалась.\n\n' +
    `Правильный провод: ${game.correctWire}.\n` +
    formatGamePenalty(penaltyResult)
  );

  return true;
}

/*
 * ------------------------------
 * 3. Реакция
 * ------------------------------
 */

async function startReaction(
  context,
  vk
) {
  if (!isChat(context)) {
    await context.reply(
      '❌ Игра на реакцию работает только в беседах.'
    );

    return true;
  }

  const peerId =
    Number(context.peerId);

  if (reactionGames.has(peerId)) {
    await context.reply(
      '⚡ В этой беседе уже идёт игра на реакцию.'
    );

    return true;
  }

  const userId =
    Number(context.senderId);

  const reactionKey =
    getPlayerKey(
      peerId,
      userId
    );

  const reactionCooldown =
    checkGameCooldown(
      gameCooldowns.reaction,
      reactionKey,
      REACTION_COOLDOWN
    );

  if (reactionCooldown > 0) {
    return sendCooldown(
      context,
      'Реакция',
      reactionCooldown
    );
  }

  if (reactionGames.has(peerId)) {
    await context.reply(
      '⚡ В этой беседе уже идёт игра на реакцию.'
    );

    return true;
  }

  const delay =
    randomInteger(
      REACTION_MIN_DELAY,
      REACTION_MAX_DELAY
    );

  const game = {
    ready: false,
    finished: false,
    timer: null
  };

  reactionGames.set(
    peerId,
    game
  );

  await context.send(
    '⚡ Приготовьтесь!\n\n' +
    'Когда появится 🟢, напишите:\n' +
    'ловлю\n\n' +
    'Кто напишет раньше сигнала — проиграет.'
  );

  game.timer = setTimeout(
    async () => {
      const currentGame =
        reactionGames.get(peerId);

      if (
        !currentGame ||
        currentGame !== game ||
        currentGame.finished
      ) {
        return;
      }

      currentGame.ready = true;

      await sendMessage(
        vk,
        peerId,
        '🟢 ЛОВИ!'
      ).catch(console.error);
    },
    delay
  );

  return true;
}

async function catchReaction(
  context
) {
  if (!isChat(context)) {
    return false;
  }

  const peerId =
    Number(context.peerId);

  const game =
    reactionGames.get(peerId);

  if (!game || game.finished) {
    return false;
  }

  const userId =
    Number(context.senderId);

  if (!game.ready) {
    game.finished = true;

    if (game.timer) {
      clearTimeout(game.timer);
    }

    reactionGames.delete(peerId);

    const penaltyResult =
      applyGamePenalty(
        userId,
        2
      );

    await context.send(
      `🚫 @id${userId} написал слишком рано!\n\n` +
      'Игра завершена.\n' +
      formatGamePenalty(penaltyResult)
    );

    return true;
  }

  game.finished = true;
  reactionGames.delete(peerId);

  const rewardResult =
    applyGameReward(
      userId,
      2
    );

  await context.send(
    `⚡ @id${userId} оказался быстрее всех!\n\n` +
    '💵 Награда: +2 ₽\n' +
    formatGameReward(rewardResult)
  );

  return true;
}

/*
 * ------------------------------
 * 4. Кейс
 * ------------------------------
 */

function getCaseDrop() {
  const chance =
    Math.random() * 100;

  if (chance < 1) {
    return {
      amount: 50,
      text:
        '👑 ДЖЕКПОТ! Выпало +50 ₽!'
    };
  }

  if (chance < 11) {
    return {
      amount: 10,
      text:
        '💎 Редкий приз: +10 ₽!'
    };
  }

  if (chance < 31) {
    return {
      amount: 5,
      text:
        '💵 Выпало +5 ₽!'
    };
  }

  if (chance < 51) {
    return {
      amount: 2,
      text:
        '🙂 Выпало +2 ₽.'
    };
  }

  if (chance < 66) {
    return {
      amount: -2,
      text:
        '💀 Не повезло: -2 ₽.'
    };
  }

  return {
    amount: 0,
    text:
      '📦 В кейсе ничего не оказалось.'
  };
}

async function openCase(
  context
) {
  const peerId =
    getGameScopeId(context);

  const userId =
    Number(context.senderId);

  const key =
    getPlayerKey(
      peerId,
      userId
    );

  const currentTime =
    Date.now();

  const lastOpenedAt =
    caseCooldowns.get(key) ?? 0;

  const remaining =
    CASE_COOLDOWN -
    (currentTime - lastOpenedAt);

  if (
    lastOpenedAt > 0 &&
    remaining > 0
  ) {
    await context.reply(
      '⌛ Следующий кейс можно открыть через ' +
      formatRemainingTime(remaining)
    );

    return true;
  }

  caseCooldowns.set(
    key,
    currentTime
  );

  const drop =
    getCaseDrop();

  let dropText = drop.text;
  let resultText =
    `💵 Баланс: ${formatMoney(getBalance(userId))} ₽`;

  if (drop.amount > 0) {
    const rewardResult =
      applyGameReward(
        userId,
        drop.amount
      );

    resultText =
      formatGameReward(rewardResult);
  } else if (drop.amount < 0) {
    const penaltyResult =
      applyGamePenalty(
        userId,
        Math.abs(drop.amount)
      );

    resultText =
      formatGamePenalty(penaltyResult);

    dropText =
      '💀 Не повезло!';
  }

  await context.send(
    '📦 Ты открыл кейс...\n\n' +
    `${dropText}\n\n` +
    resultText
  );

  return true;
}

/*
 * ------------------------------
 * 5. Казино
 * ------------------------------
 */

async function playCasino(
  context,
  rawBet
) {
  const userId =
    Number(context.senderId);

  const balance =
    getBalance(userId);

  const normalizedBet =
    String(rawBet ?? '')
      .trim()
      .toLowerCase();

  const isAllIn = [
    'всё',
    'все',
    'all'
  ].includes(normalizedBet);

  const amountText = normalizedBet
    .replace(/[$₽]$/, '')
    .trim();

  const bet = isAllIn
    ? balance
    : /^\d[\d\s.,_]*$/.test(amountText)
      ? Number(
        amountText.replace(
          /[\s.,_]/g,
          ''
        )
      )
      : NaN;

  if (
    !Number.isSafeInteger(bet) ||
    bet <= 0
  ) {
    await context.reply(
      '❌ Укажи целую положительную ставку.\n\n' +
      'Примеры:\n' +
      '!казино 10.000\n' +
      '!казино всё'
    );

    return true;
  }

  if (balance < bet) {
    await context.reply(
      '❌ Недостаточно денег.\n\n' +
      `💵 Баланс: ${formatMoney(balance)} ₽\n` +
      `🎰 Ставка: ${formatMoney(bet)} ₽`
    );

    return true;
  }

  const peerId =
    getGameScopeId(context);

  const casinoKey =
    getPlayerKey(
      peerId,
      userId
    );

  const casinoCooldown =
    checkGameCooldown(
      gameCooldowns.casino,
      casinoKey,
      CASINO_COOLDOWN
    );

  if (casinoCooldown > 0) {
    return sendCooldown(
      context,
      'Казино',
      casinoCooldown
    );
  }

  incrementQuestStat(
    userId,
    'casino_played'
  );

  const round = getCasinoRound(
    casinoLossStreaks.get(casinoKey) ?? 0
  );
  const outcome = round.outcome;

  const multiplierTenths =
    outcome.multiplierTenths;

  const payout = Math.floor(
    bet * multiplierTenths / 10
  );

  const netResult =
    payout - bet;

  let resultTitle =
    '➖ Ставка вернулась без изменений.';

  let settlementText =
    `🏦 Баланс: ${formatMoney(balance)} ₽`;

  if (netResult > 0) {
    const rewardResult = applyGameReward(
      userId,
      netResult
    );

    resultTitle =
      `📈 Чистая прибыль: +${formatMoney(netResult)} ₽`;

    const settlementLines = [];

    if (rewardResult.debtPaid > 0) {
      settlementLines.push(
        `💳 Из выигрыша погашено долга: ${formatMoney(rewardResult.debtPaid)} ₽`
      );
    }

    if (rewardResult.credited > 0) {
      settlementLines.push(
        `💵 Зачислено на баланс: ${formatMoney(rewardResult.credited)} ₽`
      );
    }

    settlementLines.push(
      `🏦 Баланс: ${formatMoney(rewardResult.balance)} ₽`
    );

    settlementText =
      settlementLines.join('\n');
  } else if (netResult < 0) {
    incrementQuestStat(
      userId,
      'casino_losses'
    );

    const originalLoss = Math.abs(netResult);
    const perkInsurance =
      tryInsuranceRefund(
        userId,
        originalLoss
      );
    const refunded = perkInsurance.status === 'refunded'
      ? perkInsurance.refund
      : 0;
    const finalLoss = Math.max(
      0,
      originalLoss - refunded
    );
    const penaltyResult = finalLoss > 0
      ? applyGamePenalty(
        userId,
        finalLoss
      )
      : {
        balance: getBalance(userId)
      };

    recordTreasuryGameLoss(finalLoss);

    resultTitle = refunded > 0
      ? `🛡 Страховка вернула ${formatMoney(refunded)} ₽\n` +
        `🎟 Осталось покрытия: ${formatMoney(perkInsurance.charges)} ₽\n` +
        `📉 Итоговый проигрыш: -${formatMoney(finalLoss)} ₽`
      : `📉 Чистый проигрыш: -${formatMoney(originalLoss)} ₽` +
        (perkInsurance.status === 'not_triggered'
          ? '\n🛡 Страховка не сработала: шанс 50/50.'
          : '');

    settlementText =
      `🏦 Баланс: ${formatMoney(penaltyResult.balance)} ₽`;
  }

  if (multiplierTenths < 10) {
    casinoLossStreaks.set(
      casinoKey,
      (casinoLossStreaks.get(casinoKey) ?? 0) + 1
    );
  } else {
    casinoLossStreaks.delete(casinoKey);
  }

  const insuranceText = round.insuranceActivated
    ? '🛡 Сработала страховка после трёх проигрышей: ставка полностью возвращена.\n'
    : '';

  await context.send({
    message:
      '🎰 Казино Zaffron\n\n' +
      insuranceText +
      `${outcome.title}\n` +
      `🎲 Множитель: x${formatCasinoMultiplier(multiplierTenths)}\n` +
      `💵 Ставка: ${formatMoney(bet)} ₽\n` +
      `💰 Выплата: ${formatMoney(payout)} ₽\n` +
      `${resultTitle}\n\n` +
      settlementText,
    keyboard: createCasinoRepeatKeyboard(bet)
  });

  return true;
}

/*
 * ------------------------------
 * 6. Угадай число
 * ------------------------------
 */

async function startGuessGame(
  context,
  vk
) {
  if (!isChat(context)) {
    await context.reply(
      '❌ Угадай число работает только в беседах.'
    );

    return true;
  }

  const peerId =
    Number(context.peerId);

  if (guessGames.has(peerId)) {
    await context.reply(
      '🎯 В этой беседе уже загадано число.'
    );

    return true;
  }

  const userId =
    Number(context.senderId);

  const guessKey =
    getPlayerKey(
      peerId,
      userId
    );

  const guessCooldown =
    checkGameCooldown(
      gameCooldowns.guess,
      guessKey,
      GUESS_COOLDOWN
    );

  if (guessCooldown > 0) {
    return sendCooldown(
      context,
      'Угадай число',
      guessCooldown
    );
  }

  if (guessGames.has(peerId)) {
    await context.reply(
      '🎯 В этой беседе уже загадано число.'
    );

    return true;
  }

  const number =
    randomInteger(1, 20);

  const game = {
    number,
    finished: false,
    attempts: new Set(),
    timer: null
  };

  guessGames.set(
    peerId,
    game
  );

  await context.send(
    '🎯 Я загадал число от 1 до 20!\n\n' +
    'Пишите:\n' +
    '!число 7\n\n' +
    'У каждого игрока одна попытка.\n' +
    'Время — 60 секунд.'
  );

  game.timer = setTimeout(
    async () => {
      const currentGame =
        guessGames.get(peerId);

      if (
        !currentGame ||
        currentGame !== game ||
        currentGame.finished
      ) {
        return;
      }

      currentGame.finished = true;
      guessGames.delete(peerId);

      await sendMessage(
        vk,
        peerId,
        '⌛ Время вышло!\n\n' +
        `Я загадал число ${number}.`
      ).catch(console.error);
    },
    GUESS_TIME
  );

  return true;
}

async function guessNumber(
  context,
  rawNumber
) {
  if (!isChat(context)) {
    return false;
  }

  const peerId =
    Number(context.peerId);

  const game =
    guessGames.get(peerId);

  if (!game || game.finished) {
    await context.reply(
      '❌ Сейчас число не загадано.\n\n' +
      'Запусти игру командой !угадай'
    );

    return true;
  }

  const userId =
    Number(context.senderId);

  if (game.attempts.has(userId)) {
    await context.reply(
      '⏳ Ты уже использовал свою попытку.'
    );

    return true;
  }

  const number =
    Number(rawNumber);

  if (
    !Number.isInteger(number) ||
    number < 1 ||
    number > 20
  ) {
    await context.reply(
      '❌ Напиши целое число от 1 до 20.'
    );

    return true;
  }

  game.attempts.add(userId);

  if (number !== game.number) {
    const hint =
      number < game.number
        ? 'Загаданное число больше.'
        : 'Загаданное число меньше.';

    await context.reply(
      `❌ Не угадал. ${hint}`
    );

    return true;
  }

  game.finished = true;

  if (game.timer) {
    clearTimeout(game.timer);
  }

  guessGames.delete(peerId);

  incrementQuestStat(
    userId,
    'guess_wins'
  );

  const rewardResult =
    applyGameReward(
      userId,
      4
    );

  await context.send(
    `🏆 @id${userId} угадал число ${game.number}!\n\n` +
    '💵 Награда: +4 ₽\n' +
    formatGameReward(rewardResult)
  );

  return true;
}

/*
 * ------------------------------
 * Главный обработчик
 * ------------------------------
 */

async function handle(
  context,
  vk
) {
  const originalText =
    String(context.text ?? '')
      .trim();
  const payload = context.messagePayload;

  if (payload?.command === 'casino_repeat_bet') {
    return playCasino(
      context,
      String(payload.bet ?? '')
    );
  }

  if (payload?.command === 'rocket_continue') {
    return continueRocket(
      context,
      payload.gameId,
      vk
    );
  }

  if (payload?.command === 'rocket_cashout') {
    return cashoutRocket(
      context,
      payload.gameId
    );
  }

  if (payload?.command === 'rocket_repeat') {
    return startRocket(
      context,
      String(payload.bet ?? ''),
      vk
    );
  }

  /*
   * Горячая картошка
   */
  if (/^!картошка$/i.test(originalText)) {
    return startHotPotato(
      context,
      vk
    );
  }

  const passMatch =
    originalText.match(
      /^!пас(?:\s+(.+))?$/i
    );

  if (passMatch) {
    return passHotPotato(
      context,
      vk,
      passMatch[1]
    );
  }

  /*
   * Бомба
   */
  if (/^!бомба$/i.test(originalText)) {
    return startBomb(
      context,
      vk
    );
  }

  const wireMatch =
    originalText.match(
      /^!режу\s+(красный|синий|зелёный)$/i
    );

  if (wireMatch) {
    return cutBombWire(
      context,
      wireMatch[1]
    );
  }

  /*
   * Реакция
   */
  if (/^!реакция$/i.test(originalText)) {
    return startReaction(
      context,
      vk
    );
  }

  if (/^ловлю$/i.test(originalText)) {
    return catchReaction(
      context
    );
  }

  /*
   * Кейс
   */
  if (/^!кейс$/i.test(originalText)) {
    return openCase(
      context
    );
  }

  /*
   * Казино
   */
  if (
    /^!(?:шансы\s+казино|казино\s+шансы)$/i
      .test(originalText)
  ) {
    return sendCasinoChances(context);
  }

  const casinoMatch =
    originalText.match(
      /^!казино(?:\s+(.+))?$/i
    );

  if (casinoMatch) {
    return playCasino(
      context,
      casinoMatch[1]
    );
  }

  /*
   * Ракета
   */
  if (
    /^!(?:шансы\s+ракеты|ракета\s+шансы)$/i
      .test(originalText)
  ) {
    return sendRocketChances(context);
  }

  const rocketMatch = originalText.match(
    /^!ракета(?:\s+(.+))?$/i
  );

  if (rocketMatch) {
    return startRocket(
      context,
      rocketMatch[1],
      vk
    );
  }

  /*
   * Угадай число
   */
  if (/^!угадай$/i.test(originalText)) {
    return startGuessGame(
      context,
      vk
    );
  }

  const numberMatch =
    originalText.match(
      /^!число\s+(.+)$/i
    );

  if (numberMatch) {
    return guessNumber(
      context,
      numberMatch[1]
    );
  }

  return false;
}

module.exports = {
  handle,
  CASINO_OUTCOMES,
  CASINO_INSURANCE_AFTER_LOSSES,
  ROCKET_STAGES,
  getCasinoOutcome,
  getCasinoRound,
  rollRocketStage,
  getRocketReachChance,
  refundActiveRocketGames
};
