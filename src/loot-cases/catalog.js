const crypto = require('node:crypto');

const RARITIES = Object.freeze({
  bad: {
    title: 'Плохой лут',
    emoji: '🗑'
  },
  medium: {
    title: 'Средний лут',
    emoji: '📦'
  },
  best: {
    title: 'Лучший лут',
    emoji: '🔥'
  },
  jackpot: {
    title: 'Джекпот',
    emoji: '👑'
  }
});

const CASES = Object.freeze([
  {
    key: 'bronze',
    title: 'Бронзовый кейс',
    shortTitle: 'Бронзовый',
    emoji: '🥉',
    price: 500_000,
    aliases: [
      'бронзовый',
      'бронза',
      'бронзовый кейс'
    ],
    loot: [
      {
        key: 'bronze-ferrari-scraps',
        title: 'Обломки Ferrari',
        emoji: '🏎',
        rarity: 'bad',
        sellValue: 30_000,
        weight: 70
      },
      {
        key: 'bronze-broken-iphone',
        title: 'Разбитый iPhone 16 Plus',
        emoji: '📱',
        rarity: 'bad',
        sellValue: 70_000,
        weight: 70
      },
      {
        key: 'bronze-gucci-shoe',
        title: 'Ботинок Gucci',
        emoji: '👞',
        rarity: 'bad',
        sellValue: 120_000,
        weight: 70
      },
      {
        key: 'bronze-toyota-camry',
        title: 'Toyota Camry',
        emoji: '🚗',
        rarity: 'medium',
        sellValue: 250_000,
        weight: 50,
        assetKey: 'car-toyota-camry',
        assetType: 'cars'
      },
      {
        key: 'bronze-copper',
        title: '50 кг меди',
        emoji: '🟤',
        rarity: 'medium',
        sellValue: 400_000,
        weight: 50
      },
      {
        key: 'bronze-apartment',
        title: 'Квартира',
        emoji: '🏢',
        rarity: 'medium',
        sellValue: 750_000,
        weight: 50,
        assetKey: 'house-apartment',
        assetType: 'houses'
      },
      {
        key: 'bronze-city-loot',
        title: 'Городской лут',
        emoji: '🌆',
        rarity: 'best',
        sellValue: 1_500_000,
        weight: 15
      },
      {
        key: 'bronze-ronaldo-sneakers',
        title: 'Кроссовки Роналду',
        emoji: '👟',
        rarity: 'best',
        sellValue: 1_000_000,
        weight: 20
      },
      {
        key: 'bronze-golden-ticket',
        title: 'Золотой билет',
        emoji: '🎫',
        rarity: 'jackpot',
        sellValue: 5_000_000,
        weight: 3
      }
    ]
  },
  {
    key: 'silver',
    title: 'Серебряный кейс',
    shortTitle: 'Серебряный',
    emoji: '🥈',
    price: 3_000_000,
    aliases: [
      'серебряный',
      'серебро',
      'серебряный кейс'
    ],
    loot: [
      {
        key: 'silver-rolex-scraps',
        title: 'Обломки Rolex Daytona',
        emoji: '⌚',
        rarity: 'bad',
        sellValue: 500_000,
        weight: 70
      },
      {
        key: 'silver-broken-macbook',
        title: 'Разбитый MacBook Pro',
        emoji: '💻',
        rarity: 'bad',
        sellValue: 900_000,
        weight: 70
      },
      {
        key: 'silver-gucci-suitcase',
        title: 'Чемодан Gucci без пары',
        emoji: '🧳',
        rarity: 'bad',
        sellValue: 1_200_000,
        weight: 70
      },
      {
        key: 'silver-bmw-m5',
        title: 'BMW M5 F90',
        emoji: '🚙',
        rarity: 'medium',
        sellValue: 750_000,
        weight: 50,
        assetKey: 'car-bmw-m5-f90',
        assetType: 'cars'
      },
      {
        key: 'silver-metal',
        title: '10 кг серебра',
        emoji: '🪙',
        rarity: 'medium',
        sellValue: 2_000_000,
        weight: 50
      },
      {
        key: 'silver-penthouse',
        title: 'Пентхаус',
        emoji: '🏙',
        rarity: 'medium',
        sellValue: 3_000_000,
        weight: 50,
        assetKey: 'house-penthouse',
        assetType: 'houses'
      },
      {
        key: 'silver-crypto-wallet',
        title: 'Криптокошелёк',
        emoji: '💳',
        rarity: 'best',
        sellValue: 8_000_000,
        weight: 15
      },
      {
        key: 'silver-messi-boots',
        title: 'Бутсы Лионеля Месси',
        emoji: '🥾',
        rarity: 'best',
        sellValue: 10_000_000,
        weight: 20
      },
      {
        key: 'silver-platinum-ticket',
        title: 'Платиновый билет',
        emoji: '🎟',
        rarity: 'jackpot',
        sellValue: 30_000_000,
        weight: 3
      }
    ]
  },
  {
    key: 'diamond',
    title: 'Алмазный кейс',
    shortTitle: 'Алмазный',
    emoji: '💎',
    price: 10_000_000,
    aliases: [
      'алмазный',
      'алмаз',
      'бриллиантовый',
      'алмазный кейс'
    ],
    loot: [
      {
        key: 'diamond-richard-mille',
        title: 'Треснувшие часы Richard Mille',
        emoji: '⌚',
        rarity: 'bad',
        sellValue: 2_000_000,
        weight: 70
      },
      {
        key: 'diamond-burnt-server',
        title: 'Сгоревший серверный шкаф',
        emoji: '🖥',
        rarity: 'bad',
        sellValue: 3_000_000,
        weight: 70
      },
      {
        key: 'diamond-dust',
        title: 'Алмазная крошка',
        emoji: '✨',
        rarity: 'bad',
        sellValue: 4_000_000,
        weight: 70
      },
      {
        key: 'diamond-lamborghini',
        title: 'Lamborghini Aventador',
        emoji: '🏎',
        rarity: 'medium',
        sellValue: 5_000_000,
        weight: 50,
        assetKey: 'car-lamborghini-aventador',
        assetType: 'cars'
      },
      {
        key: 'diamond-gold-bars',
        title: 'Золотые слитки',
        emoji: '🪙',
        rarity: 'medium',
        sellValue: 8_000_000,
        weight: 50
      },
      {
        key: 'diamond-villa',
        title: 'Вилла',
        emoji: '🏡',
        rarity: 'medium',
        sellValue: 12_000_000,
        weight: 50,
        assetKey: 'house-villa',
        assetType: 'houses'
      },
      {
        key: 'diamond-royal-treasure',
        title: 'Королевский клад',
        emoji: '🧰',
        rarity: 'best',
        sellValue: 30_000_000,
        weight: 15
      },
      {
        key: 'diamond-ronaldo-ball',
        title: 'Мяч с подписью Роналду',
        emoji: '⚽',
        rarity: 'best',
        sellValue: 50_000_000,
        weight: 20
      },
      {
        key: 'diamond-black-ticket',
        title: 'Чёрный алмазный билет',
        emoji: '🎫',
        rarity: 'jackpot',
        sellValue: 150_000_000,
        weight: 3
      }
    ]
  },
  {
    key: 'platinum',
    title: 'Platinum кейс',
    shortTitle: 'Platinum',
    emoji: '💿',
    price: 50_000_000,
    aliases: [
      'platinum',
      'платинум',
      'платиновый',
      'platinum кейс',
      'платинум кейс',
      'платиновый кейс'
    ],
    loot: [
      {
        key: 'platinum-cracked-patek',
        title: 'Треснувшие часы Patek Philippe',
        emoji: '⌚',
        rarity: 'bad',
        sellValue: 1_000_000,
        weight: 6_790
      },
      {
        key: 'platinum-broken-asic',
        title: 'Сломанный майнинг-ASIC',
        emoji: '🖥',
        rarity: 'bad',
        sellValue: 2_000_000,
        weight: 6_790
      },
      {
        key: 'platinum-empty-safe',
        title: 'Пустой платиновый сейф',
        emoji: '🗄',
        rarity: 'bad',
        sellValue: 3_000_000,
        weight: 6_790
      },
      {
        key: 'platinum-ferrari-sf90',
        title: 'Кепка Павла Дурова',
        emoji: '🏎',
        rarity: 'medium',
        sellValue: 8_000_000,
        weight: 4_850,
        assetKey: 'collectible-pavel-durov-cap',
        assetType: 'collectibles'
      },
      {
        key: 'platinum-ingot',
        title: 'Платиновый слиток',
        emoji: '🪙',
        rarity: 'medium',
        sellValue: 10_000_000,
        weight: 4_850
      },
      {
        key: 'platinum-mansion',
        title: 'Особняк',
        emoji: '🏛',
        rarity: 'medium',
        sellValue: 15_000_000,
        weight: 4_850,
        assetKey: 'house-mansion',
        assetType: 'houses'
      },
      {
        key: 'platinum-crypto-case',
        title: 'Портфель криптовалюты',
        emoji: '💼',
        rarity: 'best',
        sellValue: 80_000_000,
        weight: 1_455
      },
      {
        key: 'platinum-zaffron-crown',
        title: 'Корона Zaffron',
        emoji: '👑',
        rarity: 'best',
        sellValue: 55_000_000,
        weight: 1_940
      },
      {
        key: 'platinum-jackpot',
        title: 'Platinum Jackpot',
        emoji: '💰',
        rarity: 'jackpot',
        sellValue: 1_200_000_000,
        weight: 1_185
      }
    ]
  }
].map(caseItem => {
  const totalWeight = caseItem.loot.reduce(
    (sum, lootItem) => sum + lootItem.weight,
    0
  );

  return Object.freeze({
    ...caseItem,
    totalWeight,
    expectedValue: Math.round(
      caseItem.loot.reduce(
        (sum, lootItem) =>
          sum + lootItem.sellValue * lootItem.weight,
        0
      ) / totalWeight
    ),
    loot: Object.freeze(
      caseItem.loot.map(lootItem =>
        Object.freeze({
          ...lootItem,
          chance:
            lootItem.weight /
            totalWeight *
            100
        })
      )
    )
  });
}));

const casesByAlias = new Map();
const lootByKey = new Map();

function normalizeCaseName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
}

for (const caseItem of CASES) {
  for (const alias of [
    caseItem.key,
    caseItem.title,
    caseItem.shortTitle,
    ...caseItem.aliases
  ]) {
    casesByAlias.set(
      normalizeCaseName(alias),
      caseItem
    );
  }

  for (const lootItem of caseItem.loot) {
    lootByKey.set(lootItem.key, {
      ...lootItem,
      caseKey: caseItem.key
    });
  }
}

function getCase(value) {
  return casesByAlias.get(
    normalizeCaseName(value)
  ) ?? null;
}

function getLoot(value) {
  return lootByKey.get(String(value ?? '')) ?? null;
}

function rollCase(
  caseItem,
  randomInteger = crypto.randomInt
) {
  const roll = randomInteger(
    0,
    caseItem.totalWeight
  );
  let accumulatedWeight = 0;

  for (const lootItem of caseItem.loot) {
    accumulatedWeight += lootItem.weight;

    if (roll < accumulatedWeight) {
      return lootItem;
    }
  }

  return caseItem.loot.at(-1);
}

module.exports = {
  CASES,
  RARITIES,
  getCase,
  getLoot,
  rollCase
};
