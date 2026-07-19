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
      price: 1000000,
      consumable: true,
      quantity: 1,
      description: 'Следующая смена даст x2 зарплату и +2 EXP.',
      aliases: [
        'буст смены x2',
        'буст x2',
        'x2',
        'х2'
      ]
    }
  ]
};
