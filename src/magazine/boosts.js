module.exports = {
  key: 'boosts',
  title: 'Бусты смены',
  profileLabel: 'Бусты смены x2',
  command: 'бустов',
  emoji: '⚡',
  aliases: [
    'бусты',
    'бустов',
    'буст',
    'exp',
    'буст exp',
    'бусты exp'
  ],
  items: [
    {
      key: 'boost-job-x2',
      title: 'Буст x2 — 1 смена',
      price: 100000,
      consumable: true,
      quantity: 1,
      description: 'Следующая смена даст x2 зарплату и +2 EXP.',
      aliases: [
        'буст смены x2',
        'буст x2',
        'x2',
        'х2'
      ]
    },
    {
      key: 'boost-job-x2-3',
      title: 'Буст x2 — 3 смены',
      price: 270000,
      consumable: true,
      quantity: 3,
      description: 'Три следующие смены дадут x2 зарплату и EXP.',
      aliases: [
        'буст x2 3',
        'буст на 3 смены',
        '3 буста'
      ]
    },
    {
      key: 'boost-job-x2-5',
      title: 'Буст x2 — 5 смен',
      price: 425000,
      consumable: true,
      quantity: 5,
      description: 'Пять следующих смен дадут x2 зарплату и EXP.',
      aliases: [
        'буст x2 5',
        'буст на 5 смен',
        '5 бустов'
      ]
    },
    {
      key: 'boost-job-x2-10',
      title: 'Буст x2 — 10 смен',
      price: 800000,
      consumable: true,
      quantity: 10,
      description: 'Десять следующих смен дадут x2 зарплату и EXP.',
      aliases: [
        'буст x2 10',
        'буст на 10 смен',
        '10 бустов'
      ]
    }
  ]
};
