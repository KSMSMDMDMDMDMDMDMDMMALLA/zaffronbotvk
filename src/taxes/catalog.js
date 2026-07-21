const DAY_MS = 24 * 60 * 60 * 1000;
const TAX_PERIOD_MS = 7 * DAY_MS;
const MAX_ACCRUAL_PERIODS = 3;

const TAX_CATEGORIES = Object.freeze([
  Object.freeze({
    key: 'business',
    title: 'Бизнесы',
    emoji: '🏢',
    itemType: 'businesses'
  }),
  Object.freeze({
    key: 'car',
    title: 'Автомобили',
    emoji: '🚗',
    itemType: 'cars'
  }),
  Object.freeze({
    key: 'property',
    title: 'Жильё',
    emoji: '🏠',
    itemType: 'houses'
  })
]);

function getTaxCategory(value) {
  const key = String(value ?? '').trim();
  return TAX_CATEGORIES.find(item =>
    item.key === key
  ) ?? null;
}

function getBusinessTaxBps(price) {
  if (price <= 10_000_000) return 100;
  if (price <= 1_000_000_000) return 150;
  if (price <= 100_000_000_000) return 200;
  if (price <= 1_000_000_000_000) return 250;
  return 300;
}

module.exports = {
  DAY_MS,
  TAX_PERIOD_MS,
  MAX_ACCRUAL_PERIODS,
  TAX_CATEGORIES,
  getTaxCategory,
  getBusinessTaxBps
};
