const crypto = require('node:crypto');

const lootTable = Object.freeze([
  {
    key: 'crucian-carp',
    title: 'Карась',
    emoji: '🐟',
    kind: 'fish',
    rarity: 'common',
    weight: 3000,
    minWeightGrams: 100,
    maxWeightGrams: 1500,
    valuePerKilogram: 2500,
    minValue: 1000,
    maxValue: 4000
  },
  {
    key: 'perch',
    title: 'Окунь',
    emoji: '🐟',
    kind: 'fish',
    rarity: 'common',
    weight: 2200,
    minWeightGrams: 150,
    maxWeightGrams: 2500,
    valuePerKilogram: 2000,
    minValue: 1200,
    maxValue: 5000
  },
  {
    key: 'carp',
    title: 'Карп',
    emoji: '🐠',
    kind: 'fish',
    rarity: 'common',
    weight: 1500,
    minWeightGrams: 500,
    maxWeightGrams: 6000,
    valuePerKilogram: 800,
    minValue: 1500,
    maxValue: 5000
  },
  {
    key: 'pike',
    title: 'Щука',
    emoji: '🐊',
    kind: 'fish',
    rarity: 'uncommon',
    weight: 900,
    minWeightGrams: 700,
    maxWeightGrams: 8000,
    valuePerKilogram: 650,
    minValue: 2000,
    maxValue: 5000
  },
  {
    key: 'catfish',
    title: 'Сом',
    emoji: '🐋',
    kind: 'fish',
    rarity: 'uncommon',
    weight: 500,
    minWeightGrams: 2000,
    maxWeightGrams: 20000,
    valuePerKilogram: 250,
    minValue: 2500,
    maxValue: 5000
  },
  {
    key: 'old-boot',
    title: 'Старый сапог',
    emoji: '🥾',
    kind: 'junk',
    rarity: 'common',
    weight: 900,
    minWeightGrams: 200,
    maxWeightGrams: 1200,
    valuePerKilogram: 2000,
    minValue: 1000,
    maxValue: 3000
  },
  {
    key: 'tin-can',
    title: 'Жестяная банка',
    emoji: '🥫',
    kind: 'junk',
    rarity: 'common',
    weight: 850,
    minWeightGrams: 50,
    maxWeightGrams: 500,
    valuePerKilogram: 5000,
    minValue: 1000,
    maxValue: 2500
  },
  {
    key: 'old-coins',
    title: 'Мешочек старинных монет',
    emoji: '🪙',
    kind: 'treasure',
    rarity: 'rare',
    weight: 100,
    minWeightGrams: 50,
    maxWeightGrams: 300,
    valuePerKilogram: 200000,
    minValue: 10000,
    maxValue: 50000
  },
  {
    key: 'lost-jewelry',
    title: 'Потерянное украшение',
    emoji: '💍',
    kind: 'treasure',
    rarity: 'rare',
    weight: 30,
    minWeightGrams: 50,
    maxWeightGrams: 500,
    valuePerKilogram: 400000,
    minValue: 25000,
    maxValue: 100000
  },
  {
    key: 'treasure-chest',
    title: 'Сундук с сокровищами',
    emoji: '🧰',
    kind: 'treasure',
    rarity: 'legendary',
    weight: 10,
    minWeightGrams: 2000,
    maxWeightGrams: 10000,
    valuePerKilogram: 20000,
    minValue: 80000,
    maxValue: 200000
  },
  {
    key: 'golden-fish',
    title: 'Золотая рыбка',
    emoji: '🌟',
    kind: 'fish',
    rarity: 'legendary',
    weight: 10,
    minWeightGrams: 100,
    maxWeightGrams: 500,
    valuePerKilogram: 300000,
    minValue: 50000,
    maxValue: 150000
  }
]);

function getLuckAdjustedWeight(item, luckBonus) {
  const safeLuckBonus = Math.max(
    0,
    Number(luckBonus) || 0
  );
  let multiplier = 1;

  if (item.rarity === 'rare') {
    multiplier += safeLuckBonus / 100;
  } else if (item.rarity === 'legendary') {
    multiplier += safeLuckBonus * 2 / 100;
  }

  return Math.max(
    1,
    Math.round(item.weight * multiplier)
  );
}

function rollFishingLoot(
  luckBonus = 0,
  randomInteger = crypto.randomInt
) {
  const weightedItems = lootTable.map(item => ({
    item,
    adjustedWeight:
      getLuckAdjustedWeight(item, luckBonus)
  }));
  const totalWeight = weightedItems.reduce(
    (total, entry) =>
      total + entry.adjustedWeight,
    0
  );
  const roll = randomInteger(0, totalWeight);
  let accumulatedWeight = 0;
  let selectedItem = weightedItems[0].item;

  for (const entry of weightedItems) {
    accumulatedWeight += entry.adjustedWeight;

    if (roll < accumulatedWeight) {
      selectedItem = entry.item;
      break;
    }
  }

  const weightGrams = randomInteger(
    selectedItem.minWeightGrams,
    selectedItem.maxWeightGrams + 1
  );
  const rawValue = Math.floor(
    weightGrams *
    selectedItem.valuePerKilogram /
    1000
  );
  const value = Math.min(
    selectedItem.maxValue ??
      Number.MAX_SAFE_INTEGER,
    Math.max(
      selectedItem.minValue ?? 1,
      rawValue
    )
  );

  return {
    ...selectedItem,
    weightGrams,
    value
  };
}

module.exports = {
  lootTable,
  getLuckAdjustedWeight,
  rollFishingLoot
};
