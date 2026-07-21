const { Keyboard } = require('vk-io');

const {
  formatMoney,
  getBalance,
  getUserByVkId,
  getJobProfile,
  getTreasuryState,
  adjustTreasuryBalance,
  getPendingCreditRequest,
  getActiveTreasuryLoan,
  createTreasuryCreditRequest,
  decideTreasuryCreditRequest,
  repayTreasuryLoan
} = require('../database');

const {
  isAdmin,
  getAdminIds
} = require('../admin');

function parseAmount(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[₽$]$/, '')
    .trim();

  if (['всё', 'все', 'all'].includes(normalized)) {
    return 'all';
  }

  if (!/^\d[\d\s.,_]*$/.test(normalized)) {
    return null;
  }

  const amount = Number(
    normalized.replace(/[\s.,_]/g, '')
  );

  return Number.isSafeInteger(amount) && amount > 0
    ? amount
    : null;
}

function getUserName(vkId) {
  const user = getUserByVkId(vkId);
  return [user?.first_name, user?.last_name]
    .filter(Boolean)
    .join(' ') || `id${vkId}`;
}

function createTreasuryKeyboard(vkId) {
  const pending = getPendingCreditRequest(vkId);
  const loan = getActiveTreasuryLoan(vkId);
  const profile = getJobProfile(vkId);
  const keyboard = Keyboard.builder();

  if (loan) {
    keyboard.textButton({
      label: '💳 Погасить кредит',
      payload: {
        command: 'treasury_repay_all'
      },
      color: Keyboard.POSITIVE_COLOR
    });
  } else if (!pending && profile.level >= 5) {
    keyboard.textButton({
      label: '📝 Подать заявку',
      payload: {
        command: 'treasury_credit_help'
      },
      color: Keyboard.PRIMARY_COLOR
    });
  } else if (pending) {
    keyboard.textButton({
      label: '⏳ Заявка на рассмотрении',
      payload: { command: 'treasury_home' },
      color: Keyboard.SECONDARY_COLOR
    });
  } else {
    keyboard.textButton({
      label: '🔒 Кредит с 5 уровня',
      payload: {
        command: 'treasury_credit_help'
      },
      color: Keyboard.SECONDARY_COLOR
    });
  }

  return keyboard
    .row()
    .textButton({
      label: '🧾 Налоги',
      payload: { command: 'tax_home' },
      color: Keyboard.SECONDARY_COLOR
    })
    .textButton({
      label: '🔄 Обновить',
      payload: { command: 'treasury_home' },
      color: Keyboard.SECONDARY_COLOR
    })
    .inline();
}

function createReviewKeyboard(requestId) {
  return Keyboard.builder()
    .textButton({
      label: '✅ Одобрить',
      payload: {
        command: 'treasury_credit_review',
        requestId,
        approved: true
      },
      color: Keyboard.POSITIVE_COLOR
    })
    .textButton({
      label: '❌ Отклонить',
      payload: {
        command: 'treasury_credit_review',
        requestId,
        approved: false
      },
      color: Keyboard.NEGATIVE_COLOR
    })
    .inline();
}

async function sendTreasuryHome(context) {
  const vkId = Number(context.senderId);
  const treasury = getTreasuryState();
  const pending = getPendingCreditRequest(vkId);
  const loan = getActiveTreasuryLoan(vkId);
  const personalText = loan
    ? (
      '\n\n💳 Твой кредит\n' +
      `💵 Выдано: ${formatMoney(loan.principal)} ₽\n` +
      `🧾 Осталось вернуть: ${formatMoney(loan.remaining)} ₽\n` +
      `📅 Обещанный срок: ${loan.repaymentText}`
    )
    : pending
      ? (
        '\n\n⏳ Твоя заявка на рассмотрении\n' +
        `🆔 №${pending.id}\n` +
        `💵 Сумма: ${formatMoney(pending.amount)} ₽`
      )
      : '';

  await context.send({
    message:
      '🏛 Казна Zaffron\n\n' +
      `💰 Средств в казне: ${formatMoney(treasury.balance)} ₽\n\n` +
      '📊 Всего поступило:\n' +
      `📤 Всего выдано кредитов: ${formatMoney(treasury.totalLoansIssued)} ₽` +
      personalText,
    keyboard: createTreasuryKeyboard(vkId)
  });
  return true;
}

async function sendCreditHelp(context) {
  const profile = getJobProfile(
    Number(context.senderId)
  );

  if (profile.level < 5) {
    await context.send({
      message:
        '🔒 Кредиты доступны с 5 уровня.\n\n' +
        `⭐ Твой уровень: ${profile.level}\n` +
        '📈 Продолжай работать и повышать EXP.',
      keyboard: createTreasuryKeyboard(
        Number(context.senderId)
      )
    });
    return true;
  }

  await context.send({
    message:
      '📝 Заявка на кредит из казны\n\n' +
      'Напиши сумму, цель и срок возврата через символ «|».\n\n' +
      'Пример:\n' +
      '!кредит 100.000.000 | Покупка бизнеса | 7 дней\n\n' +
      'Заявку лично рассматривает администратор. Одновременно может быть только одна заявка или один активный кредит.',
    keyboard: createTreasuryKeyboard(
      Number(context.senderId)
    )
  });
  return true;
}

async function notifyAdmins(vk, request) {
  const name = getUserName(request.vkId);
  const message =
    '📝 Новая заявка на кредит\n\n' +
    `🆔 Заявка №${request.id}\n` +
    `👤 @id${request.vkId} (${name})\n` +
    `💵 Сумма: ${formatMoney(request.amount)} ₽\n` +
    `🎯 Цель: ${request.purpose}\n` +
    `📅 Вернёт: ${request.repaymentText}\n\n` +
    `🏛 Сейчас в казне: ${formatMoney(getTreasuryState().balance)} ₽`;

  await Promise.allSettled(
    getAdminIds().map(peerId =>
      vk.api.messages.send({
        peer_id: peerId,
        random_id: 0,
        message,
        keyboard: createReviewKeyboard(
          request.id
        ).toString()
      })
    )
  );
}

async function submitCredit(context, vk, raw) {
  const parts = String(raw ?? '').split('|');

  if (parts.length !== 3) {
    return sendCreditHelp(context);
  }

  const amount = parseAmount(parts[0]);
  const purpose = parts[1].trim();
  const repaymentText = parts[2].trim();

  if (
    amount === null || amount === 'all' ||
    purpose.length < 3 || repaymentText.length < 2
  ) {
    return sendCreditHelp(context);
  }

  const result = createTreasuryCreditRequest({
    vkId: Number(context.senderId),
    amount,
    purpose,
    repaymentText
  });

  if (result.status === 'level_required') {
    await context.send(
      '🔒 Кредиты доступны только с 5 уровня.\n\n' +
      `⭐ Твой уровень: ${result.currentLevel}`
    );
    return true;
  }

  if (result.status === 'pending_exists') {
    await context.send(
      `⏳ Твоя заявка №${result.request.id} уже на рассмотрении.`
    );
    return true;
  }

  if (result.status === 'active_loan') {
    await context.send(
      '❌ Сначала нужно погасить текущий кредит.'
    );
    return true;
  }

  await notifyAdmins(vk, result.request);
  await context.send({
    message:
      '✅ Заявка отправлена администратору!\n\n' +
      `🆔 Номер: ${result.request.id}\n` +
      `💵 Сумма: ${formatMoney(amount)} ₽\n` +
      `🎯 Цель: ${purpose}\n` +
      `📅 Возврат: ${repaymentText}`,
    keyboard: createTreasuryKeyboard(
      Number(context.senderId)
    )
  });
  return true;
}

async function reviewCredit(context, vk, payload) {
  if (!isAdmin(context.senderId)) {
    await context.send('❌ Нет доступа.');
    return true;
  }

  const approved =
    payload.approved === true ||
    payload.approved === 'true';
  const result = decideTreasuryCreditRequest({
    requestId: payload.requestId,
    adminId: Number(context.senderId),
    approved
  });

  if (result.status === 'treasury_insufficient') {
    await context.send(
      '❌ В казне не хватает денег.\n\n' +
      `🏛 Казна: ${formatMoney(result.treasuryBalance)} ₽\n` +
      `📉 Не хватает: ${formatMoney(result.missing)} ₽`
    );
    return true;
  }

  if (['not_found', 'already_reviewed'].includes(result.status)) {
    await context.send('⏳ Эта заявка уже обработана или не найдена.');
    return true;
  }

  if (result.status === 'user_balance_limit') {
    await context.send('❌ Кредит нельзя выдать: баланс игрока достиг лимита.');
    return true;
  }

  if (result.status === 'borrower_level_required') {
    await context.send(
      '🔒 Кредит нельзя выдать: игрок ещё не достиг 5 уровня.\n\n' +
      `⭐ Уровень игрока: ${result.currentLevel}`
    );
    return true;
  }

  const request = result.request;
  const decisionText = result.status === 'approved'
    ? `✅ Кредит одобрен!\n💵 На баланс зачислено ${formatMoney(request.amount)} ₽.\n📅 Обещанный срок: ${request.repaymentText}`
    : '❌ Заявка на кредит отклонена.';

  try {
    await vk.api.messages.send({
      peer_id: request.vkId,
      random_id: 0,
      message:
        `🏛 Заявка №${request.id}\n\n` +
        decisionText
    });
  } catch (error) {
    console.error('Не удалось сообщить о кредите:', error?.message ?? error);
  }

  await context.send(
    result.status === 'approved'
      ? `✅ Кредит №${request.id} одобрен и выдан.`
      : `❌ Заявка №${request.id} отклонена.`
  );
  return true;
}

async function repayCredit(context, rawAmount) {
  const amount = parseAmount(rawAmount);

  if (!amount) {
    await context.send(
      '❌ Укажи сумму.\n\n' +
      'Пример: !кредит погасить 10.000.000\n' +
      'Или: !кредит погасить всё'
    );
    return true;
  }

  const result = repayTreasuryLoan({
    vkId: Number(context.senderId),
    amount
  });

  if (result.status === 'no_active_loan') {
    await context.send('✅ У тебя нет активного кредита.');
    return true;
  }

  if (result.status === 'insufficient_funds') {
    await context.send(
      '❌ Не хватает денег.\n\n' +
      `💳 Платёж: ${formatMoney(result.payment)} ₽\n` +
      `🏦 Баланс: ${formatMoney(result.balance)} ₽`
    );
    return true;
  }

  await context.send({
    message:
      (result.status === 'repaid'
        ? '✅ Кредит полностью погашен!'
        : '✅ Часть кредита погашена.') +
      `\n\n💸 Возвращено: ${formatMoney(result.payment)} ₽\n` +
      `🧾 Осталось: ${formatMoney(result.remaining)} ₽\n` +
      `🏦 Баланс: ${formatMoney(result.balance)} ₽`,
    keyboard: createTreasuryKeyboard(
      Number(context.senderId)
    )
  });
  return true;
}

async function handleAdminTreasury(
  context,
  action,
  rawAmount
) {
  if (!isAdmin(context.senderId)) {
    await context.send('❌ Нет доступа.');
    return true;
  }

  const treasury = getTreasuryState();
  const parsed = parseAmount(rawAmount);
  const amount = parsed === 'all' && action === 'withdraw'
    ? treasury.balance
    : parsed;

  if (
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    (action === 'deposit' && parsed === 'all')
  ) {
    await context.send(
      '❌ Неверная сумма.\n\n' +
      '\\казна пополнить 1.000.000.000\n' +
      '\\казна снять 100.000.000\n' +
      '\\казна снять всё'
    );
    return true;
  }

  const result = adjustTreasuryBalance({
    adminId: Number(context.senderId),
    amount,
    operation: action
  });

  if (result.status === 'treasury_limit') {
    await context.send('❌ Казна достигла технического лимита.');
    return true;
  }

  if (result.status === 'insufficient_treasury') {
    await context.send(
      '❌ В казне не хватает средств.\n\n' +
      `🏛 Казна: ${formatMoney(result.treasuryBalance)} ₽\n` +
      `📉 Не хватает: ${formatMoney(result.missing)} ₽`
    );
    return true;
  }

  if (result.status === 'admin_balance_limit') {
    await context.send('❌ Баланс администра достиг лимита.');
    return true;
  }

  await context.send(
    result.status === 'deposited'
      ? '✅ Казна пополнена.\n\n' +
        `📥 Добавлено: ${formatMoney(result.amount)} ₽\n` +
        `🏛 В казне: ${formatMoney(result.treasuryBalance)} ₽`
      : '✅ Средства сняты из казны.\n\n' +
        `📤 Снято: ${formatMoney(result.amount)} ₽\n` +
        `🏛 В казне: ${formatMoney(result.treasuryBalance)} ₽\n` +
        `🏦 Твой баланс: ${formatMoney(result.adminBalance)} ₽`
  );
  return true;
}

async function handle(context, vk) {
  const text = String(context.text ?? '').trim();
  const payload = context.messagePayload;

  const adminTreasuryMatch = text.match(
    /^\\казна\s+(пополнить|снять)\s+(.+)$/i
  );

  if (adminTreasuryMatch) {
    return handleAdminTreasury(
      context,
      adminTreasuryMatch[1].toLowerCase() === 'пополнить'
        ? 'deposit'
        : 'withdraw',
      adminTreasuryMatch[2]
    );
  }

  if (
    payload?.command === 'treasury_home' ||
    /^!казна$/i.test(text)
  ) return sendTreasuryHome(context);

  if (payload?.command === 'treasury_credit_help') {
    return sendCreditHelp(context);
  }

  if (payload?.command === 'treasury_credit_review') {
    return reviewCredit(context, vk, payload);
  }

  if (payload?.command === 'treasury_repay_all') {
    return repayCredit(context, 'всё');
  }

  const repayMatch = text.match(
    /^!кредит\s+погасить\s+(.+)$/i
  );
  if (repayMatch) return repayCredit(context, repayMatch[1]);

  const requestMatch = text.match(
    /^!кредит(?:\s+(.+))?$/i
  );
  if (requestMatch) {
    return requestMatch[1]
      ? submitCredit(context, vk, requestMatch[1])
      : sendCreditHelp(context);
  }

  return false;
}

module.exports = { handle };
