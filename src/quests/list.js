const { getItem } = require('../magazine/catalog');

function getAssetReward(itemKey) {
  const item = getItem(itemKey);

  if (!item) {
    throw new Error(
      `Не найден наградной товар: ${itemKey}`
    );
  }

  return {
    itemKey: item.key,
    itemType: item.categoryKey,
    title: item.title,
    price: item.price
  };
}

module.exports = Object.freeze([
  {
    key: 'start-first-job',
    title: 'Устроиться на работу',
    description:
      'Начать хотя бы одну смену на любой работе.',
    condition: {
      type: 'stat',
      key: 'jobs_started',
      target: 1
    },
    rewards: {
      experience: 1,
      dollars: 5000
    },
    rewardText: '1 EXP + 5.000 $'
  },
  {
    key: 'casino-play-50',
    title: 'Завсегдатай казино',
    description: 'Сыграть в казино 50 раз.',
    condition: {
      type: 'stat',
      key: 'casino_played',
      target: 50
    },
    rewards: {
      experience: 3,
      dollars: 15000
    },
    rewardText: '3 EXP + 15.000 $'
  },
  {
    key: 'reach-level-10',
    title: 'Достигнуть 10-го уровня',
    description: 'Повысить уровень игрока до 10.',
    condition: {
      type: 'level',
      target: 10
    },
    rewards: {
      asset: getAssetReward(
        'car-mercedes-amg-gt'
      )
    },
    rewardText: 'Mercedes-AMG GT'
  },
  {
    key: 'reach-level-20',
    title: 'Достигнуть 20-го уровня',
    description: 'Повысить уровень игрока до 20.',
    condition: {
      type: 'level',
      target: 20
    },
    rewards: {
      asset: getAssetReward(
        'house-penthouse'
      )
    },
    rewardText: 'Пентхаус'
  },
  {
    key: 'reach-level-3',
    title: 'Достигнуть 3-го уровня',
    description: 'Повысить уровень игрока до 3.',
    condition: {
      type: 'level',
      target: 3
    },
    rewards: {
      asset: getAssetReward(
        'car-toyota-camry'
      )
    },
    rewardText: 'Toyota Camry'
  },
  {
    key: 'redeem-promos-3',
    title: 'Активировать 3 промокода',
    description:
      'Успешно активировать 3 разных промокода.',
    condition: {
      type: 'stat',
      key: 'promos_redeemed',
      target: 3
    },
    rewards: {
      dollars: 100000
    },
    rewardText: '100.000 $'
  },
  {
    key: 'buy-first-business',
    title: 'Купить первый бизнес',
    description: 'Приобрести любой бизнес.',
    condition: {
      type: 'stat',
      key: 'businesses_bought',
      target: 1
    },
    rewards: {
      experience: 5,
      dollars: 77000
    },
    rewardText: '5 EXP + 77.000 $'
  },
  {
    key: 'receive-aura-5',
    title: 'Получить 5 ауры',
    description:
      'Достигнуть общей ауры 5 или больше.',
    condition: {
      type: 'stat',
      key: 'aura_peak',
      target: 5
    },
    rewards: {
      boosts: 3
    },
    rewardText: 'Буст x2 — 3 смены'
  },
  {
    key: 'buy-villa',
    title: 'Купить виллу',
    description: 'Хотя бы один раз приобрести виллу.',
    condition: {
      type: 'stat',
      key: 'villas_bought',
      target: 1
    },
    rewards: {
      dollars: 2000000
    },
    rewardText: '2.000.000 $'
  },
  {
    key: 'reach-balance-100k',
    title: 'Достигнуть баланса 100.000 $',
    description:
      'Иметь на руках хотя бы 100.000 $.',
    condition: {
      type: 'stat',
      key: 'balance_peak',
      target: 100000,
      unit: '$'
    },
    rewards: {
      experience: 10
    },
    rewardText: '10 EXP'
  },
  {
    key: 'reach-balance-1m',
    title: 'Достигнуть баланса 1.000.000 $',
    description:
      'Иметь на руках хотя бы 1.000.000 $.',
    condition: {
      type: 'stat',
      key: 'balance_peak',
      target: 1000000,
      unit: '$'
    },
    rewards: {
      dollars: 500000
    },
    rewardText: '500.000 $'
  },
  {
    key: 'give-first-aura',
    title: 'Впервые дать ауру',
    description:
      'Выдать +ауру другому игроку первый раз.',
    condition: {
      type: 'stat',
      key: 'aura_given',
      target: 1
    },
    rewards: {
      aura: 3
    },
    rewardText: '+3 ауры'
  },
  {
    key: 'play-memduel-3',
    title: 'Сыграть 3 мем-дуэли',
    description:
      'Завершить 3 мем-дуэли в роли любого участника.',
    condition: {
      type: 'stat',
      key: 'memduels_played',
      target: 3
    },
    rewards: {
      aura: 5,
      dollars: 50000
    },
    rewardText: '5 ауры + 50.000 $'
  },
  {
    key: 'guess-win-5',
    title: 'Победить в «Угадай» 5 раз',
    description:
      'Первым угадать число в 5 играх.',
    condition: {
      type: 'stat',
      key: 'guess_wins',
      target: 5
    },
    rewards: {
      dollars: 150000
    },
    rewardText: '150.000 $'
  },
  {
    key: 'view-profile-100',
    title: 'Посмотреть профиль 100 раз',
    description:
      'Открыть собственный профиль командой !п 100 раз.',
    condition: {
      type: 'stat',
      key: 'profile_views',
      target: 100
    },
    rewards: {
      dollars: 35000
    },
    rewardText: '35.000 $'
  },
  {
    key: 'play-potato-10',
    title: 'Сыграть в картошку 10 раз',
    description:
      'Запустить игру «Горячая картошка» 10 раз.',
    condition: {
      type: 'stat',
      key: 'potato_played',
      target: 10
    },
    rewards: {
      experience: 5
    },
    rewardText: '5 EXP'
  },
  {
    key: 'lose-casino-30',
    title: 'Проиграть в казино 30 раз',
    description:
      'Получить множитель ниже x1 в 30 играх казино.',
    condition: {
      type: 'stat',
      key: 'casino_losses',
      target: 30
    },
    rewards: {
      dollars: 100000
    },
    rewardText: '100.000 $'
  }
]);
