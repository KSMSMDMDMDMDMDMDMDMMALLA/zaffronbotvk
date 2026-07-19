const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const FARM_MAX_PLOTS = 8;
const FARM_MAX_UPGRADE_LEVEL = 5;
const FARM_PLANT_COOLDOWN_MS = 10 * 1000;
const FARM_HARVEST_COOLDOWN_MS = 5 * 1000;

const PLOT_PRICES = Object.freeze([
  25_000,
  100_000,
  400_000,
  1_500_000,
  5_000_000,
  15_000_000,
  50_000_000,
  150_000_000
]);

const WAREHOUSE_CAPACITIES = Object.freeze([
  10_000,
  50_000,
  200_000,
  1_000_000,
  5_000_000,
  25_000_000
]);

const CROPS = Object.freeze([
  {
    key: 'wheat',
    title: 'Пшеница',
    emoji: '🌾',
    requiredPlots: 1,
    seedPrice: 500,
    sellPrice: 160,
    growTimeMs: 2 * MINUTE_MS,
    minYield: 5,
    maxYield: 8,
    maxSeedsPerPlot: 1000,
    germinationChance: 97,
    growthChance: 96,
    aliases: ['пшеница', 'пшеницу']
  },
  {
    key: 'beet',
    title: 'Свёкла',
    emoji: '🫜',
    requiredPlots: 1,
    seedPrice: 1_200,
    sellPrice: 400,
    growTimeMs: 5 * MINUTE_MS,
    minYield: 5,
    maxYield: 8,
    maxSeedsPerPlot: 1000,
    germinationChance: 96,
    growthChance: 94,
    aliases: ['свекла', 'свёкла', 'свеклу', 'свёклу']
  },
  {
    key: 'potato',
    title: 'Картофель',
    emoji: '🥔',
    requiredPlots: 2,
    seedPrice: 3_000,
    sellPrice: 900,
    growTimeMs: 15 * MINUTE_MS,
    minYield: 5,
    maxYield: 8,
    maxSeedsPerPlot: 1000,
    germinationChance: 95,
    growthChance: 93,
    aliases: ['картофель', 'картошка', 'картошку']
  },
  {
    key: 'carrot',
    title: 'Морковь',
    emoji: '🥕',
    requiredPlots: 2,
    seedPrice: 7_000,
    sellPrice: 2_200,
    growTimeMs: 30 * MINUTE_MS,
    minYield: 5,
    maxYield: 8,
    maxSeedsPerPlot: 1000,
    germinationChance: 94,
    growthChance: 92,
    aliases: ['морковь', 'морковка', 'морковку']
  },
  {
    key: 'corn',
    title: 'Кукуруза',
    emoji: '🌽',
    requiredPlots: 3,
    seedPrice: 18_000,
    sellPrice: 6_000,
    growTimeMs: HOUR_MS,
    minYield: 5,
    maxYield: 7,
    maxSeedsPerPlot: 1000,
    germinationChance: 93,
    growthChance: 91,
    aliases: ['кукуруза', 'кукурузу']
  },
  {
    key: 'tomato',
    title: 'Томаты',
    emoji: '🍅',
    requiredPlots: 4,
    seedPrice: 50_000,
    sellPrice: 18_000,
    growTimeMs: 2 * HOUR_MS,
    minYield: 4,
    maxYield: 7,
    maxSeedsPerPlot: 1000,
    germinationChance: 92,
    growthChance: 90,
    aliases: ['томат', 'томаты', 'помидор', 'помидоры']
  },
  {
    key: 'strawberry',
    title: 'Клубника',
    emoji: '🍓',
    requiredPlots: 5,
    seedPrice: 140_000,
    sellPrice: 55_000,
    growTimeMs: 4 * HOUR_MS,
    minYield: 4,
    maxYield: 7,
    maxSeedsPerPlot: 300,
    germinationChance: 90,
    growthChance: 89,
    aliases: ['клубника', 'клубнику']
  },
  {
    key: 'sunflower',
    title: 'Подсолнечник',
    emoji: '🌻',
    requiredPlots: 6,
    seedPrice: 400_000,
    sellPrice: 180_000,
    growTimeMs: 8 * HOUR_MS,
    minYield: 4,
    maxYield: 6,
    maxSeedsPerPlot: 100,
    germinationChance: 89,
    growthChance: 87,
    aliases: ['подсолнечник', 'семечки']
  },
  {
    key: 'grape',
    title: 'Виноград',
    emoji: '🍇',
    requiredPlots: 7,
    seedPrice: 3_000_000,
    sellPrice: 2_000_000,
    growTimeMs: 12 * HOUR_MS,
    minYield: 3,
    maxYield: 6,
    maxSeedsPerPlot: 10,
    germinationChance: 88,
    growthChance: 85,
    aliases: ['виноград']
  },
  {
    key: 'watermelon',
    title: 'Арбуз',
    emoji: '🍉',
    requiredPlots: 8,
    seedPrice: 10_000_000,
    sellPrice: 8_000_000,
    growTimeMs: 24 * HOUR_MS,
    minYield: 3,
    maxYield: 5,
    maxSeedsPerPlot: 3,
    germinationChance: 86,
    growthChance: 83,
    aliases: ['арбуз', 'арбузы']
  },
  {
    key: 'saffron',
    title: 'Шафран Zaffron',
    emoji: '🪻',
    requiredPlots: 8,
    seedPrice: 25_000_000,
    sellPrice: 22_000_000,
    growTimeMs: 48 * HOUR_MS,
    minYield: 4,
    maxYield: 6,
    maxSeedsPerPlot: 1,
    germinationChance: 82,
    growthChance: 80,
    aliases: [
      'шафран',
      'шафран zaffron',
      'zaffron'
    ]
  }
]);

const UPGRADES = Object.freeze({
  irrigation: {
    key: 'irrigation',
    title: 'Система полива',
    emoji: '💧',
    description: '+1% к всходам, +2% к созреванию и −5% времени роста за уровень.',
    costs: Object.freeze([
      150_000,
      750_000,
      3_000_000,
      12_000_000,
      50_000_000
    ])
  },
  soil: {
    key: 'soil',
    title: 'Плодородная почва',
    emoji: '🪱',
    description: '+10% к количеству собранного урожая за уровень.',
    costs: Object.freeze([
      100_000,
      500_000,
      2_000_000,
      8_000_000,
      35_000_000
    ])
  },
  warehouse: {
    key: 'warehouse',
    title: 'Склад',
    emoji: '📦',
    description: 'Увеличивает максимальное количество хранимого урожая.',
    costs: Object.freeze([
      75_000,
      350_000,
      1_500_000,
      7_000_000,
      30_000_000
    ])
  }
});

function normalizeName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
}

function getCrop(value) {
  const normalized = normalizeName(value);

  return CROPS.find(crop => [
    crop.key,
    crop.title,
    ...crop.aliases
  ].some(alias =>
    normalizeName(alias) === normalized
  )) ?? null;
}

function getUpgrade(value) {
  return UPGRADES[String(value ?? '').trim()] ?? null;
}

function getPlotPrice(plotCount) {
  return PLOT_PRICES[Number(plotCount)] ?? null;
}

function getWarehouseCapacity(level) {
  const safeLevel = Math.min(
    FARM_MAX_UPGRADE_LEVEL,
    Math.max(0, Math.trunc(Number(level) || 0))
  );

  return WAREHOUSE_CAPACITIES[safeLevel];
}

function getCropChances(crop, irrigationLevel) {
  const level = Math.min(
    FARM_MAX_UPGRADE_LEVEL,
    Math.max(0, Math.trunc(Number(irrigationLevel) || 0))
  );
  const germination = Math.min(
    99,
    crop.germinationChance + level
  );
  const growth = Math.min(
    99,
    crop.growthChance + level * 2
  );

  return {
    germination,
    growth,
    total: Math.floor(
      germination * growth / 100
    )
  };
}

function getCropGrowTime(crop, irrigationLevel) {
  const level = Math.min(
    FARM_MAX_UPGRADE_LEVEL,
    Math.max(0, Math.trunc(Number(irrigationLevel) || 0))
  );

  return Math.max(
    MINUTE_MS,
    Math.floor(
      crop.growTimeMs *
      (100 - level * 5) /
      100
    )
  );
}

function getCropYieldRange(crop, soilLevel) {
  const level = Math.min(
    FARM_MAX_UPGRADE_LEVEL,
    Math.max(0, Math.trunc(Number(soilLevel) || 0))
  );
  const multiplier = 100 + level * 10;

  return {
    min: Math.max(
      1,
      Math.floor(crop.minYield * multiplier / 100)
    ),
    max: Math.max(
      1,
      Math.floor(crop.maxYield * multiplier / 100)
    )
  };
}

module.exports = {
  CROPS,
  UPGRADES,
  FARM_MAX_PLOTS,
  FARM_MAX_UPGRADE_LEVEL,
  FARM_PLANT_COOLDOWN_MS,
  FARM_HARVEST_COOLDOWN_MS,
  getCrop,
  getUpgrade,
  getPlotPrice,
  getWarehouseCapacity,
  getCropChances,
  getCropGrowTime,
  getCropYieldRange
};
