const countries = Object.freeze([
  {
    key: 'russia',
    title: 'Россия',
    flag: '🇷🇺',
    aliases: ['россия', 'россию', 'рф']
  },
  {
    key: 'germany',
    title: 'Германия',
    flag: '🇩🇪',
    aliases: ['германия', 'германию']
  },
  {
    key: 'france',
    title: 'Франция',
    flag: '🇫🇷',
    aliases: ['франция', 'францию']
  },
  {
    key: 'italy',
    title: 'Италия',
    flag: '🇮🇹',
    aliases: ['италия', 'италию']
  },
  {
    key: 'uae',
    title: 'ОАЭ',
    flag: '🇦🇪',
    aliases: [
      'оаэ',
      'эмираты',
      'объединенные арабские эмираты'
    ]
  },
  {
    key: 'japan',
    title: 'Япония',
    flag: '🇯🇵',
    aliases: ['япония', 'японию']
  },
  {
    key: 'china',
    title: 'Китай',
    flag: '🇨🇳',
    aliases: ['китай']
  },
  {
    key: 'usa',
    title: 'США',
    flag: '🇺🇸',
    aliases: [
      'сша',
      'америка',
      'соединенные штаты',
      'соединенные штаты америки'
    ]
  },
  {
    key: 'brazil',
    title: 'Бразилия',
    flag: '🇧🇷',
    aliases: ['бразилия', 'бразилию']
  },
  {
    key: 'australia',
    title: 'Австралия',
    flag: '🇦🇺',
    aliases: ['австралия', 'австралию']
  }
]);

function normalizeCountryName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"']/g, '')
    .replace(/\s+/g, ' ');
}

const countriesByKey = new Map();
const countriesByAlias = new Map();

for (const country of countries) {
  countriesByKey.set(country.key, country);

  for (const alias of [
    country.key,
    country.title,
    ...country.aliases
  ]) {
    countriesByAlias.set(
      normalizeCountryName(alias),
      country
    );
  }
}

function getCountry(value) {
  return countriesByKey.get(String(value)) ??
    countriesByAlias.get(
      normalizeCountryName(value)
    ) ??
    null;
}

module.exports = {
  countries,
  getCountry,
  normalizeCountryName
};
