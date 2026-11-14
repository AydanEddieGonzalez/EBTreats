// Client for the Express backend (backend/api_call.js, port 3001).
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, options);
  } catch {
    throw new Error('Could not reach the server. Is the backend running on port 3001?');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
}

const sendJson = (method, data) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});

const userPath = (username) => encodeURIComponent(username);

// { message, user: { username, dietaryRestrictions, cuisinePreferences, budget, timeAvailable, appliances, ingredients } }
export const login = (username, password) => request('/login', sendJson('POST', { username, password }));

export const signup = (username, password) => request('/users', sendJson('POST', { username, password }));

// { [ingredient]: quantity }
export const getPantry = (username) => request(`/user-ingredients/${userPath(username)}`);

// changes: { [ingredient]: quantityDelta }. Returns the updated { [ingredient]: quantity }.
export const changePantry = (username, changes) =>
  request(`/user-ingredients/${userPath(username)}`, sendJson('PATCH', changes));

// [{ name, quantity, expiresOn, daysLeft }]
export const getExpiring = (username, days = 3) =>
  request(`/expiring/${userPath(username)}?days=${days}`);

export const savePreferences = (username, prefs) =>
  request(
    `/users/${userPath(username)}`,
    sendJson('PATCH', {
      budget: Number(prefs.budget),
      timeAvailable: Number(prefs.time),
      cuisinePreferences: prefs.cuisines,
      appliances: prefs.appliances,
      dietaryRestrictions: prefs.allergens,
    }),
  );

// [{ name, ingredients: [{item, amount, unit}], instructions: [str], appliances, budget, time, cuisine, tags }]
export const generateRecipes = (payload) =>
  request('/generate_recipes', sendJson('POST', payload)).then((body) => body.recipes ?? []);

// Meal prep (recipe-gen): 2-3 recipes cooked from one shopping list so items are shared.
// payload: the same fields as generateRecipes plus shoppingList: [item names]
// Returns { recipes, sharedIngredients, unusedItems }.
export const generateMealPlan = (payload) =>
  request('/generate_recipes', sendJson('POST', payload)).then((body) => ({
    recipes: body.recipes ?? [],
    sharedIngredients: body.sharedIngredients ?? [],
    unusedItems: body.unusedItems ?? [],
  }));

// { [ingredient]: [quantity, unit] }
export function scanReceipt(file) {
  const formData = new FormData();
  formData.append('file', file);
  return request('/ocr', { method: 'POST', body: formData });
}

// Core loop (backend/shoppingPlan.js): location and budget in, stores and a shopping list out.
// body: { lat, lng } or { zip }, plus { budget, radius, storeId, goals, householdSize, days,
//        dietaryRestrictions, allergens, pantryItems }
// Returns { stores, store, list, listError?, details? }. list is
// { items: [{ name, category, quantity, unit, estimatedPrice, snapEligible, reason }],
//   estimatedTotal, budget, remaining, overBudget, goalNotes, tips } or null.
export const getShoppingPlan = (body) => request('/shopping-plan', sendJson('POST', body));

// SNAP stores, ranked by the backend (incentive program, then store type, then distance).
export function findStores({ lat, lng, zip, radius }) {
  const params = new URLSearchParams({ limit: '60' });
  if (zip) {
    params.set('zip', zip);
  } else {
    params.set('lat', lat);
    params.set('lng', lng);
    params.set('radius', radius);
  }
  return request(`/stores?${params}`).then((body) => body.stores ?? []);
}
