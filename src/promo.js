const {
  formatMoney,
  redeemPromo
} = require('./database');

function extractPromoCode(value) {
  const code = String(value ?? '')
    .trim()
    .replace(/^(["'])(.*)\1$/, '$2')
    .trim();

  if (
    !/^[\p{L}\p{N}_-]{1,32}$/u.test(code)
  ) {
    return null;
  }

  return code;
}

async function handle(context) {
  const originalText =
    String(context.text ?? '')
      .trim();

  if (/^!promo\s*$/i.test(originalText)) {
    await context.reply(
      '🎟 Укажи промокод.\n\n' +
      'Пример:\n' +
      '!promo SUMMER'
    );

    return true;
  }

  const match = originalText.match(
    /^!promo\s+(.+)$/i
  );

  if (!match) {
    return false;
  }

  const code =
    extractPromoCode(match[1]);

  if (!code) {
    await context.reply(
      '❌ Неверный формат промокода.'
    );

    return true;
  }

  try {
    const result = redeemPromo(
      Number(context.senderId),
      code
    );

    if (result.status === 'not_found') {
      await context.reply(
        '❌ Такого промокода не существует.'
      );

      return true;
    }

    if (result.status === 'already_used') {
      await context.reply(
        '❌ Ты уже активировал этот промокод.'
      );

      return true;
    }

    if (result.rewardType === 'aura') {
      await context.send(
        '🎉 Промокод активирован!\n\n' +
        `✨ Получено: +${result.amount} ауры\n` +
        `🌟 Общая аура: ${result.total}`
      );

      return true;
    }

    await context.send(
      '🎉 Промокод активирован!\n\n' +
      `💵 Получено: +${formatMoney(result.amount)} ₽\n` +
      `🏦 Баланс: ${formatMoney(result.total)} ₽`
    );

    return true;
  } catch (error) {
    console.error(
      'Ошибка активации промокода:',
      error
    );

    await context.reply(
      '❌ Не удалось активировать промокод.'
    );

    return true;
  }
}

module.exports = {
  handle
};
