const { Keyboard } = require('vk-io');

const {
  formatMoney,
  getBalance,
  isPerkActive,
  getBankAccount,
  depositBankFunds,
  previewBankWithdrawal,
  withdrawBankFunds
} = require('../database');

const WITHDRAWAL_CONFIRMATION_TTL =
  60 * 1000;
const pendingWithdrawals = new Map();

function parseAmount(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[$₽]$/, '')
    .trim();

  if (
    normalized === 'всё' ||
    normalized === 'все' ||
    normalized === 'all'
  ) {
    return 'all';
  }

  if (!/^\d[\d\s.,_]*$/.test(normalized)) {
    return null;
  }

  const amount = Number(
    normalized.replace(/[\s.,_]/g, '')
  );

  if (
    !Number.isSafeInteger(amount) ||
    amount <= 0
  ) {
    return null;
  }

  return amount;
}

function formatPercent(value) {
  return `${Number(value)
    .toFixed(3)
    .replace(/\.000$/, '')
    .replace(/(\.\d*[1-9])0+$/, '$1')}%`;
}

function formatPercentFromBps(bps) {
  return `${(Number(bps) / 100)
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1')}%`;
}

function createBankKeyboard() {
  return Keyboard.builder()
    .textButton({
      label: '➕ 100.000 ₽',
      payload: {
        command: 'bank_deposit',
        amount: '100000'
      },
      color: Keyboard.POSITIVE_COLOR
    })
    .textButton({
      label: '➕ 1.000.000 ₽',
      payload: {
        command: 'bank_deposit',
        amount: '1000000'
      },
      color: Keyboard.POSITIVE_COLOR
    })
    .textButton({
      label: '➕ Положить всё',
      payload: {
        command: 'bank_deposit',
        amount: 'all'
      },
      color: Keyboard.POSITIVE_COLOR
    })
    .row()
    .textButton({
      label: '➖ 100.000 ₽',
      payload: {
        command: 'bank_withdraw_request',
        amount: '100000'
      },
      color: Keyboard.PRIMARY_COLOR
    })
    .textButton({
      label: '➖ 1.000.000 ₽',
      payload: {
        command: 'bank_withdraw_request',
        amount: '1000000'
      },
      color: Keyboard.PRIMARY_COLOR
    })
    .textButton({
      label: '➖ Снять всё',
      payload: {
        command: 'bank_withdraw_request',
        amount: 'all'
      },
      color: Keyboard.PRIMARY_COLOR
    })
    .row()
    .textButton({
      label: '🔄 Обновить банк',
      payload: {
        command: 'bank_home'
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

function createWithdrawalConfirmationKeyboard(
  amount,
  withdrawAll = false
) {
  return Keyboard.builder()
    .textButton({
      label: '✅ Подтвердить снятие',
      payload: {
        command: 'bank_withdraw_confirm',
        amount: withdrawAll
          ? 'all'
          : String(amount)
      },
      color: Keyboard.POSITIVE_COLOR
    })
    .textButton({
      label: '❌ Отмена',
      payload: {
        command: 'bank_home'
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

function createBankReturnKeyboard() {
  return Keyboard.builder()
    .textButton({
      label: '🏦 Вернуться в банк',
      payload: {
        command: 'bank_home'
      },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

function resolveAmount(
  requestedAmount,
  allAmount
) {
  const parsed = parseAmount(requestedAmount);

  if (parsed === 'all') {
    return allAmount > 0
      ? allAmount
      : null;
  }

  return parsed;
}

async function sendBankHome(context) {
  const vkId = Number(context.senderId);
  const account = getBankAccount(vkId);
  const walletBalance = getBalance(vkId);
  const vipActive = isPerkActive(
    vkId,
    'vip-card'
  );
  const creditedText =
    account.interestCredited > 0
      ? (
        `\n✨ Начислено сейчас: ` +
        `${formatMoney(account.interestCredited)} ₽`
      )
      : '';

  await context.send({
    message:
      '🏦 Банк Zaffron\n\n' +
      `💵 На руках: ${formatMoney(walletBalance)} ₽\n` +
      `🏦 На вкладе: ${formatMoney(account.balance)} ₽\n` +
      `📈 Доход за следующий час: ${formatMoney(account.hourlyIncome)} ₽\n` +
      `📊 Эффективная ставка: ${formatPercent(account.effectiveRatePercent)} в час\n` +
      `✨ Всего получено процентов: ${formatMoney(account.totalInterest)} ₽` +
      creditedText + '\n\n' +
      'Процент начисляется частями:\n' +
      '• первые 1.000.000 ₽ — 30%\n' +
      '• часть от 1 до 10 млн — 2%\n' +
      '• часть от 10 до 100 млн — 0.1%\n' +
      '• часть от 100 млн до 1 млрд — 0.01%\n' +
      '• часть свыше 1 млрд — 0.001%\n\n' +
      'Проценты копятся максимум за 72 часа отсутствия.\n\n' +
      'Комиссия при снятии:\n' +
      '• меньше 100.000 ₽ — без комиссии\n' +
      '• от 100.000 ₽ — около 10% часового дохода снимаемой суммы\n' +
      (vipActive
        ? '💼 VIP-карта активна: комиссия 0%\n\n'
        : '\n') +
      'Команды:\n' +
      '!банк положить [сумма/всё]\n' +
      '!банк снять [сумма/всё]',
    keyboard: createBankKeyboard()
  });

  return true;
}

async function deposit(context, rawAmount) {
  const vkId = Number(context.senderId);
  const walletBalance = getBalance(vkId);
  const amount = resolveAmount(
    rawAmount,
    walletBalance
  );

  if (!amount) {
    await context.send({
      message:
        '❌ Укажи положительную сумму.\n\n' +
        'Пример: !банк положить 100.000\n' +
        'Или: !банк положить всё',
      keyboard: createBankReturnKeyboard()
    });

    return true;
  }

  const result = depositBankFunds({
    vkId,
    amount
  });

  if (result.status === 'insufficient_funds') {
    await context.send({
      message:
        '❌ На руках недостаточно денег.\n\n' +
        `💵 На руках: ${formatMoney(result.balance)} ₽\n` +
        `📉 Не хватает: ${formatMoney(result.missing)} ₽`,
      keyboard: createBankReturnKeyboard()
    });

    return true;
  }

  if (result.status === 'balance_limit') {
    await context.send({
      message:
        '❌ Сумма вклада превышает технический лимит банка.',
      keyboard: createBankReturnKeyboard()
    });

    return true;
  }

  await context.send({
    message:
      '✅ Деньги положены в банк.\n\n' +
      `➕ Вклад: ${formatMoney(result.amount)} ₽\n` +
      `🏦 В банке: ${formatMoney(result.bankBalance)} ₽\n` +
      `💵 На руках: ${formatMoney(result.balance)} ₽`,
    keyboard: createBankKeyboard()
  });

  return true;
}

async function requestWithdrawal(
  context,
  rawAmount
) {
  const vkId = Number(context.senderId);
  const account = getBankAccount(vkId);
  const parsedAmount =
    parseAmount(rawAmount);
  const withdrawAll =
    parsedAmount === 'all';
  const amount = withdrawAll
    ? (
      account.balance > 0
        ? account.balance
        : null
    )
    : parsedAmount;

  if (!amount) {
    await context.send({
      message:
        '❌ Укажи положительную сумму.\n\n' +
        'Пример: !банк снять 100.000\n' +
        'Или: !банк снять всё',
      keyboard: createBankReturnKeyboard()
    });

    return true;
  }

  const result = previewBankWithdrawal({
    vkId,
    amount
  });

  if (result.status === 'insufficient_funds') {
    await context.send({
      message:
        '❌ На вкладе недостаточно денег.\n\n' +
        `🏦 В банке: ${formatMoney(result.bankBalance)} ₽\n` +
        `📉 Не хватает: ${formatMoney(result.missing)} ₽`,
      keyboard: createBankReturnKeyboard()
    });

    return true;
  }

  if (result.status === 'balance_limit') {
    await context.send({
      message:
        '❌ Баланс на руках достиг технического лимита.',
      keyboard: createBankReturnKeyboard()
    });

    return true;
  }

  pendingWithdrawals.set(vkId, {
    amount: result.amount,
    withdrawAll,
    expiresAt:
      Date.now() +
      WITHDRAWAL_CONFIRMATION_TTL
  });

  await context.send({
    message:
      '⚠ Подтверди снятие денег.\n\n' +
      `➖ Сумма: ${formatMoney(result.amount)} ₽\n` +
      `📊 Комиссия: ${formatPercentFromBps(result.commissionBps)}\n` +
      `💸 Комиссия банка: ${formatMoney(result.commission)} ₽\n` +
      (result.vipActive
        ? '💼 VIP-карта: комиссия полностью отменена.\n'
        : '') +
      (
        result.commission > 0
          ? '🧾 Это около 10% часового дохода этой суммы.\n'
          : '🧾 Снятие без комиссии.\n'
      ) +
      `💵 Получишь: ${formatMoney(result.payout)} ₽`,
    keyboard:
      createWithdrawalConfirmationKeyboard(
        result.amount,
        withdrawAll
      )
  });

  return true;
}

async function confirmWithdrawal(
  context,
  rawAmount
) {
  const vkId = Number(context.senderId);
  const amount = parseAmount(rawAmount);
  const pending =
    pendingWithdrawals.get(vkId);
  const isMatchingRequest = Boolean(
    pending &&
    (
      (
        pending.withdrawAll &&
        amount === 'all'
      ) ||
      (
        !pending.withdrawAll &&
        Number.isSafeInteger(amount) &&
        pending.amount === amount
      )
    )
  );

  if (
    !isMatchingRequest ||
    pending.expiresAt < Date.now()
  ) {
    pendingWithdrawals.delete(vkId);

    await context.send({
      message:
        '⌛ Подтверждение устарело или уже было использовано. Создай новое снятие.',
      keyboard: createBankReturnKeyboard()
    });

    return true;
  }

  pendingWithdrawals.delete(vkId);

  const finalAmount = pending.withdrawAll
    ? getBankAccount(vkId).balance
    : amount;

  if (!finalAmount) {
    return sendBankHome(context);
  }

  const result = withdrawBankFunds({
    vkId,
    amount: finalAmount
  });

  if (result.status !== 'withdrawn') {
    await context.send({
      message:
        result.status === 'insufficient_funds'
          ? '❌ Сумма на вкладе изменилась. Проверь банк и повтори снятие.'
          : '❌ Не удалось выполнить снятие из-за лимита баланса.',
      keyboard: createBankReturnKeyboard()
    });

    return true;
  }

  await context.send({
    message:
      '✅ Деньги сняты с вклада.\n\n' +
      `➖ Списано из банка: ${formatMoney(result.amount)} ₽\n` +
      `💸 Комиссия: ${formatMoney(result.commission)} ₽\n` +
      `💵 Получено: ${formatMoney(result.payout)} ₽\n` +
      `🏦 Осталось в банке: ${formatMoney(result.bankBalance)} ₽\n` +
      `💰 На руках: ${formatMoney(result.balance)} ₽`,
    keyboard: createBankKeyboard()
  });

  return true;
}

async function handle(context) {
  const originalText =
    String(context.text ?? '').trim();
  const payload = context.messagePayload;

  if (payload?.command === 'bank_home') {
    pendingWithdrawals.delete(
      Number(context.senderId)
    );

    return sendBankHome(context);
  }

  if (payload?.command === 'bank_deposit') {
    return deposit(
      context,
      payload.amount
    );
  }

  if (
    payload?.command ===
    'bank_withdraw_request'
  ) {
    return requestWithdrawal(
      context,
      payload.amount
    );
  }

  if (
    payload?.command ===
    'bank_withdraw_confirm'
  ) {
    return confirmWithdrawal(
      context,
      payload.amount
    );
  }

  if (/^!банк$/i.test(originalText)) {
    return sendBankHome(context);
  }

  const depositMatch = originalText.match(
    /^!банк\s+(?:положить|внести)\s+(.+)$/i
  );

  if (depositMatch) {
    return deposit(
      context,
      depositMatch[1]
    );
  }

  const withdrawalMatch = originalText.match(
    /^!банк\s+снять\s+(.+)$/i
  );

  if (withdrawalMatch) {
    return requestWithdrawal(
      context,
      withdrawalMatch[1]
    );
  }

  if (/^!банк\s+/i.test(originalText)) {
    await context.send({
      message:
        '❌ Неизвестная банковская команда.\n\n' +
        '!банк положить [сумма/всё]\n' +
        '!банк снять [сумма/всё]',
      keyboard: createBankReturnKeyboard()
    });

    return true;
  }

  return false;
}

module.exports = {
  handle
};
