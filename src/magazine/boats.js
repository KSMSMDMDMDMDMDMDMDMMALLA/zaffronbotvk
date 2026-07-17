module.exports = {
  key: 'boats',
  title: 'Лодки',
  profileLabel: 'Лодки',
  command: 'лодок',
  emoji: '🚤',
  aliases: [
    'лодки',
    'лодок',
    'лодка'
  ],
  items: [
    {
      key: 'boat-karas',
      title: 'Лодка «Карась»',
      price: 30000,
      fishingLuck: 0,
      description: 'Базовая лодка для рыбалки.',
      aliases: [
        'лодка карась',
        'карась'
      ]
    },
    {
      key: 'boat-wave',
      title: 'ПВХ «Волна»',
      price: 50000,
      fishingLuck: 3,
      description: 'Шанс редкого улова +3%.',
      aliases: [
        'пвх волна',
        'волна'
      ]
    },
    {
      key: 'boat-breeze',
      title: 'Моторная «Бриз»',
      price: 75000,
      fishingLuck: 6,
      description: 'Шанс редкого улова +6%.',
      aliases: [
        'моторная бриз',
        'лодка бриз',
        'бриз'
      ]
    },
    {
      key: 'boat-neptune',
      title: 'Катер «Нептун»',
      price: 100000,
      fishingLuck: 9,
      description: 'Шанс редкого улова +9%.',
      aliases: [
        'катер нептун',
        'нептун'
      ]
    },
    {
      key: 'boat-barracuda',
      title: 'Катер «Барракуда»',
      price: 130000,
      fishingLuck: 12,
      description: 'Шанс редкого улова +12%.',
      aliases: [
        'катер барракуда',
        'барракуда'
      ]
    },
    {
      key: 'boat-storm',
      title: 'Speedboat «Storm»',
      price: 165000,
      fishingLuck: 15,
      description: 'Шанс редкого улова +15%.',
      aliases: [
        'speedboat storm',
        'лодка storm',
        'шторм'
      ]
    },
    {
      key: 'boat-fishing-pro',
      title: 'Fishing Pro',
      price: 200000,
      fishingLuck: 18,
      description: 'Шанс редкого улова +18%.',
      aliases: [
        'fishing pro',
        'фишинг про'
      ]
    }
  ]
};
