// Save Bytes: turns the saved pantry into inputs for the shopping list
// and a "use this first" list. Pure functions; no database calls here.
import pluralize from 'pluralize';

// Same canonical names as Pantry._CANON in data_classes/UserPantry.py. Keep both lists in sync.
const CANON = {
  'white rice': 'rice',
  'brown rice': 'rice',
  'brocolli': 'broccoli',
  'garbanzo beans': 'chickpeas',
};

// Rough fridge/pantry shelf life in days. Anything not listed uses DEFAULT_SHELF_LIFE_DAYS.
const SHELF_LIFE_DAYS = {
  'milk': 7, 'chicken': 2, 'chicken breast': 2, 'beef': 3, 'ground beef': 2, 'fish': 2, 'salmon': 2,
  'egg': 21, 'cheese': 21, 'yogurt': 14, 'bread': 7, 'lettuce': 7, 'spinach': 5, 'tomato': 7,
  'banana': 5, 'strawberry': 4, 'berry': 4, 'apple': 30, 'carrot': 21, 'broccoli': 5,
  'onion': 30, 'potato': 30, 'garlic': 60, 'rice': 365, 'pasta': 365, 'flour': 180, 'bean': 365,
};
const DEFAULT_SHELF_LIFE_DAYS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeName(name) {
  const s = String(name ?? '').trim().toLowerCase();
  return CANON[s] ?? s;
}

export function shelfLifeFor(ingredient) {
  const key = pluralize.singular(String(ingredient).trim().toLowerCase());
  if (SHELF_LIFE_DAYS[key] !== undefined) return SHELF_LIFE_DAYS[key];
  const partial = Object.keys(SHELF_LIFE_DAYS).find(k => key.includes(k));
  return partial ? SHELF_LIFE_DAYS[partial] : DEFAULT_SHELF_LIFE_DAYS;
}

// Works for a Mongoose Map (non-lean query) and for a plain object (lean query).
function entriesOf(map) {
  if (!map) return [];
  return map instanceof Map ? [...map.entries()] : Object.entries(map);
}

function getFrom(map, key) {
  if (!map) return undefined;
  return map instanceof Map ? map.get(key) : map[key];
}

// Names the shopping list must not buy again: quantity above 0, normalized, no duplicates.
export function pantryNamesFor(user) {
  const names = new Set();
  for (const [name, qty] of entriesOf(user?.ingredients)) {
    if (Number(qty) > 0) names.add(normalizeName(name));
  }
  return [...names];
}

// Items expiring within `withinDays`, soonest first. Same rules as GET /expiring.
export function expiringItemsFor(user, withinDays = 3, now = Date.now()) {
  const items = [];
  for (const [name, qty] of entriesOf(user?.ingredients)) {
    const added = getFrom(user?.ingredientAddedAt, name);
    if (!added) continue; // added before dates were tracked
    const expiresOn = new Date(new Date(added).getTime() + shelfLifeFor(name) * DAY_MS);
    const daysLeft = Math.ceil((expiresOn.getTime() - now) / DAY_MS);
    if (daysLeft <= withinDays) items.push({ name, quantity: qty, expiresOn, daysLeft });
  }
  return items.sort((a, b) => a.daysLeft - b.daysLeft);
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Removes shopping-list items that match something already at home.
// Matches whole words, so "egg" does not remove "eggplant".
export function dropPantryItems(items, pantryNames) {
  const singular = (n) => pluralize.singular(normalizeName(n));
  const words = pantryNames.map(singular).filter(Boolean);
  return items.filter(item => {
    const name = singular(item.name);
    return !words.some(w => new RegExp(`\\b${escapeRegex(w)}\\b`).test(name));
  });
}