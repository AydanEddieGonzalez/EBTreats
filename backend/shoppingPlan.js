// Core loop route: location and budget in, ranked SNAP stores and a healthy shopping list out.
//
// POST /shopping-plan
// Body (JSON):
//   location, one of:
//     lat, lng          numbers, e.g. from the browser's geolocation
//     zip               5-digit string
//   radius             miles to search around lat/lng (default 2, max 25)
//   storeLimit         how many stores to return (default 25)
//   storeId            optional: build the list for this store (e.g. the pin the user tapped on the map);
//                      otherwise the list is built for the top-ranked store
//   budget             required, USD for this trip
//   goals              optional list of health goals, e.g. ["eat more vegetables"]
//   householdSize, days, dietaryRestrictions, allergens, pantryItems
//                      optional, passed to the shopping list generator (llm_pipeline/shopping_list.py)
//
// Response 200:
//   {
//     stores: [...],    // ranked like GET /stores: incentive-program stores first, then nearest
//     store: {...},     // the store the list was built for, or null if no stores were found
//     list: {...},      // { items, estimatedTotal, budget, remaining, overBudget, goalNotes, tips },
//                       // or null if the AI step failed
//     listError: "..."  // only present when list is null, so the page can still show the stores
//   }
// Errors: 400 bad input, 502 USDA store data unreachable.

import path from 'path';
import { fileURLToPath } from 'url';
import { findStores } from './stores.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOPPING_LIST_CLI = path.resolve(__dirname, '../llm_pipeline/shopping_list_cli.py');

function toList(value) {
  if (value == null || value === '') return [];
  return (Array.isArray(value) ? value : [value]).map(String).map((s) => s.trim()).filter(Boolean);
}

function parseLocation(body) {
  const { lat, lng, zip } = body;
  if (lat !== undefined && lng !== undefined && lat !== null && lng !== null) {
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) {
      return { error: 'lat and lng must be valid numbers' };
    }
    return { lat: la, lng: ln };
  }
  if (zip !== undefined && /^\d{5}$/.test(String(zip).trim())) return { zip: String(zip).trim() };
  return { error: 'Send lat and lng, or a 5-digit zip' };
}

function pickStore(stores, storeId) {
  if (storeId != null && storeId !== '') {
    const match = stores.find((s) => String(s.id) === String(storeId));
    if (match) return match;
  }
  return stores[0] ?? null;
}

export function registerShoppingPlanRoutes(app, { runPython }) {
  app.post('/shopping-plan', async (req, res) => {
    const body = req.body ?? {};

    const location = parseLocation(body);
    if (location.error) return res.status(400).json({ error: location.error });

    const budget = Number(body.budget);
    if (!Number.isFinite(budget) || budget <= 0) {
      return res.status(400).json({ error: 'budget is required and must be a number greater than 0' });
    }

    let stores;
    try {
      stores = await findStores({
        lat: location.lat ?? null,
        lng: location.lng ?? null,
        zip: location.zip,
        radius: body.radius,
        limit: body.storeLimit,
      });
    } catch (error) {
      console.error('Shopping plan store lookup error:', error.message);
      return res.status(502).json({ error: 'Could not reach the USDA store data', details: error.message });
    }

    const store = pickStore(stores, body.storeId);
    const listRequest = {
      budget,
      goals: toList(body.goals),
      householdSize: Number(body.householdSize) || 1,
      days: Number(body.days) || 7,
      dietaryRestrictions: toList(body.dietaryRestrictions),
      allergens: toList(body.allergens),
      pantryItems: toList(body.pantryItems),
      store: store && {
        name: store.name,
        type: store.type,
        hasIncentive: store.hasIncentive,
        incentiveProgram: store.incentiveProgram,
      },
    };

    try {
      const list = await runPython(SHOPPING_LIST_CLI, [], listRequest);
      return res.status(200).json({ stores, store, list });
    } catch (error) {
      // The stores are still useful on their own, so return them with the error instead of failing.
      // runPython puts Python's stderr in the message; its last line is the actual failure
      const lines = String(error.message ?? error).trim().split(/\r?\n/).filter(Boolean);
      const details = lines[lines.length - 1] ?? 'Unknown error';
      console.error('Shopping list generation error:', details);
      return res.status(200).json({ stores, store, list: null, listError: 'Could not build the shopping list right now', details });
    }
  });
}
