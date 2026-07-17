const cars = require('./cars');
const houses = require('./houses');
const businesses = require('./businesses');
const planes = require('./planes');
const yachts = require('./yachts');
const boats = require('./boats');
const boosts = require('./boosts');

const categories = [
  cars,
  houses,
  businesses,
  planes,
  yachts,
  boats,
  boosts
];

function normalizeName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"]/g, '')
    .replace(/\s+/g, ' ');
}

const categoriesByKey = new Map();
const categoriesByAlias = new Map();
const itemsByKey = new Map();
const itemsByAlias = new Map();

for (const category of categories) {
  categoriesByKey.set(category.key, category);

  for (const alias of [
    category.key,
    category.title,
    category.command,
    ...category.aliases
  ]) {
    categoriesByAlias.set(
      normalizeName(alias),
      category
    );
  }

  for (const item of category.items) {
    const catalogItem = {
      ...item,
      categoryKey: category.key,
      categoryTitle: category.title
    };

    itemsByKey.set(item.key, catalogItem);

    for (const alias of [
      item.key,
      item.title,
      ...item.aliases
    ]) {
      itemsByAlias.set(
        normalizeName(alias),
        catalogItem
      );
    }
  }
}

function getCategory(value) {
  return categoriesByKey.get(value) ??
    categoriesByAlias.get(normalizeName(value)) ??
    null;
}

function getItem(value) {
  return itemsByKey.get(value) ??
    itemsByAlias.get(normalizeName(value)) ??
    null;
}

module.exports = {
  categories,
  normalizeName,
  getCategory,
  getItem
};
