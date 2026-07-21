const DAY_MS = 24 * 60 * 60 * 1000;

const PERKS = Object.freeze([
  Object.freeze({
    key: 'assistant',
    title: 'Помощник',
    emoji: '🤖',
    price: 20_000_000,
    durationMs: 3 * DAY_MS,
    durationTitle: '3 дня',
    description:
      'Автоматически собирает доход с аренды и бизнесов, а также созревший урожай.'
  }),
  Object.freeze({
    key: 'insurance',
    title: 'Страховка',
    emoji: '🛡',
    price: 10_000_000,
    durationMs: DAY_MS,
    durationTitle: '1 день',
    chargeAmount: 20_000_000,
    chargeTitle: 'Страховой запас',
    description:
      'С шансом 50/50 возвращает проигранную часть ставки в казино и «Ракете». Страховй запас — 20.000.000 ₽.'
  }),
  Object.freeze({
    key: 'housing-upgrade',
    title: 'Улучшения жилья',
    emoji: '🏡',
    price: 30_000_000,
    durationMs: 3 * DAY_MS,
    durationTitle: '3 дня',
    description:
      'Ремонт, мебель и охрана увеличивают доход всей сдаваемой недвижимости на 10%.'
  }),
  Object.freeze({
    key: 'auto-watering',
    title: 'Автополив',
    emoji: '💧',
    price: 35_000_000,
    durationMs: 7 * DAY_MS,
    durationTitle: '7 дней',
    chargeAmount: 10,
    chargeTitle: 'Посадок осталось',
    description:
      'Увеличивает урожайность следующих 10 посадок на 25%.'
  }),
  Object.freeze({
    key: 'vip-card',
    title: 'VIP-карта',
    emoji: '💼',
    price: 5_000_000,
    durationMs: 15 * DAY_MS,
    durationTitle: '15 дней',
    description:
      'Полностью убирает комиссию банка и денежных переводов.'
  })
]);

function normalizeName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
}

function getPerk(value) {
  const normalized = normalizeName(value);

  return PERKS.find(perk => [
    perk.key,
    perk.title
  ].some(alias =>
    normalizeName(alias) === normalized
  )) ?? null;
}

module.exports = {
  DAY_MS,
  PERKS,
  getPerk
};
