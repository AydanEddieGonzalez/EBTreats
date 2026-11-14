// SNAP store lookup: finds EBT-authorized stores near a location using USDA's
// public SNAP Retailer Locator data (ArcGIS feature service, no API key needed).
//
// GET /stores?lat=37.87&lng=-122.27&radius=2&limit=25
// GET /stores?zip=94704&limit=25
// Add &sort=nearest for pure distance order instead of the healthy ranking.
//
// Returns stores ranked for healthy, budget-friendly shopping (see rankStores below):
//   1. stores in a fruit/veg incentive program first
//   2. then nearest first
//   3. ties (e.g. zip searches, which have no distance) go to stores likely to carry
//      fresh produce (supermarkets, grocers, farmers markets)
//
// Which field marks an incentive store: in this USDA layer the fruit/veg incentive stores
// (GusNIP, e.g. Double Up Food Bucks, Market Match) are the ones with a Grantee_Name, the
// organization running the incentive there (about 1,300 stores nationwide). Incentive_Program
// is blank for almost every store and only ever says "Waiver", so it is not used for ranking.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SNAP_URL =
  'https://services1.arcgis.com/RLQu0rK7h4kbsBq5/arcgis/rest/services/snap_retailer_location_data/FeatureServer/0/query';

const FIELDS = [
  'Record_ID', 'Store_Name', 'Store_Street_Address', 'Additonal_Address', 'City', 'State',
  'Zip_Code', 'Store_Type', 'Latitude', 'Longitude', 'Incentive_Program', 'Grantee_Name',
];

// Higher = more likely to carry fresh, healthy food. Unknown types get 1.
const STORE_TYPE_SCORE = {
  'supermarket': 3,
  'super store': 3,
  'farmers and markets': 3,
  'farmers market': 3,
  'large grocery store': 3,
  'medium grocery store': 2,
  'small grocery store': 2,
  'combination grocery/other': 2,
  'specialty store': 1,
  'convenience store': 0,
};

const MAX_RADIUS_MILES = 25;
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();

function milesBetween(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 3958.8; // earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function storeTypeScore(type) {
  const key = String(type ?? '').trim().toLowerCase();
  return STORE_TYPE_SCORE[key] ?? 1;
}

function toStore(attrs, origin) {
  const lat = attrs.Latitude;
  const lng = attrs.Longitude;
  const grantee = String(attrs.Grantee_Name ?? '').trim();
  return {
    id: attrs.Record_ID,
    name: attrs.Store_Name,
    address: [attrs.Store_Street_Address, attrs.Additonal_Address].filter(Boolean).join(', '),
    city: attrs.City,
    state: attrs.State,
    zip: attrs.Zip_Code,
    type: attrs.Store_Type,
    lat,
    lng,
    // name of the organization running the fruit/veg incentive at this store, or null
    incentiveProgram: grantee || null,
    hasIncentive: grantee !== '',
    distanceMiles: origin && lat != null && lng != null
      ? Math.round(milesBetween(origin.lat, origin.lng, lat, lng) * 100) / 100
      : null,
  };
}

export function sortByDistance(stores) {
  return [...stores].sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity));
}

// Incentive-program stores first, then nearest. Store type and name only break ties.
export function rankStores(stores) {
  return [...stores].sort((a, b) =>
    (Number(b.hasIncentive) - Number(a.hasIncentive)) ||
    ((a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity)) ||
    (storeTypeScore(b.type) - storeTypeScore(a.type)) ||
    String(a.name ?? '').localeCompare(String(b.name ?? ''))
  );
}

async function querySnap(params) {
  const url = `${SNAP_URL}?${new URLSearchParams({
    outFields: FIELDS.join(','),
    returnGeometry: 'false',
    resultRecordCount: '1000',
    f: 'json',
    ...params,
  })}`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.features;

  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`USDA service returned HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`USDA service error: ${data.error.message ?? JSON.stringify(data.error)}`);
  const features = (data.features ?? []).map((f) => f.attributes);
  cache.set(url, { at: Date.now(), features });
  return features;
}

export async function findStores({ lat, lng, zip, radius = 2, limit = 25, sort = 'healthy' }) {
  let rows;
  let origin = null;
  if (lat != null && lng != null) {
    origin = { lat: Number(lat), lng: Number(lng) };
    rows = await querySnap({
      where: '1=1',
      geometry: `${origin.lng},${origin.lat}`,
      geometryType: 'esriGeometryPoint',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      distance: String(Math.min(Number(radius) || 2, MAX_RADIUS_MILES)),
      units: 'esriSRUnit_StatuteMile',
    });
  } else {
    rows = await querySnap({ where: `Zip_Code='${zip}'` });
  }
  const stores = rows.map((r) => toStore(r, origin));
  const ordered = sort === 'nearest' ? sortByDistance(stores) : rankStores(stores);
  return ordered.slice(0, Math.max(1, Math.min(Number(limit) || 25, 200)));
}

export function registerStoreRoutes(app) {
  app.get('/stores', async (req, res) => {
    try {
      const { lat, lng, zip, radius, limit, sort } = req.query;
      const hasCoords = lat !== undefined && lng !== undefined;
      if (hasCoords) {
        const la = Number(lat);
        const ln = Number(lng);
        if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) {
          return res.status(400).json({ error: 'lat and lng must be valid numbers' });
        }
      } else if (!zip || !/^\d{5}$/.test(String(zip))) {
        return res.status(400).json({ error: 'Send lat and lng, or a 5-digit zip' });
      }
      const stores = await findStores({ lat: hasCoords ? lat : null, lng: hasCoords ? lng : null, zip, radius, limit, sort });
      return res.status(200).json({ count: stores.length, stores });
    } catch (error) {
      console.error('Store lookup error:', error.message);
      return res.status(502).json({ error: 'Could not reach the USDA store data', details: error.message });
    }
  });
}


// ===========================================================================
// LOCAL CSV FALLBACK (everything above this line is unchanged)
//
// Put one state's USDA SNAP retailer CSV at backend/data/snap_stores.csv
// (or set SNAP_CSV_PATH). Then call registerStoreFallbackRoutes(app) in place of
// registerStoreRoutes(app): same GET /stores API, but if the live USDA lookup takes
// longer than SNAP_LIVE_TIMEOUT_MS (default 5000) or fails, the answer is served
// from the CSV and the response says source: 'local'.
// With no CSV present it behaves exactly like findStores() (source: 'live').
// ===========================================================================

const STORES_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CSV_PATH = path.join(STORES_DIR, 'data', 'snap_stores.csv');
const DEFAULT_LIVE_TIMEOUT_MS = 5000;

// Minimal CSV parser (quoted fields, "" escapes, CRLF, BOM) so no extra dependency is needed.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// CSV header (lowercased) -> the field names the live service uses (see FIELDS), so rows
// from the CSV can go through the existing toStore() / rankStores() unchanged.
const CSV_COLUMNS = {
  ...Object.fromEntries(FIELDS.map((f) => [f.toLowerCase(), f])),
  additional_address: 'Additonal_Address', // USDA's live field name is misspelled
  lat: 'Latitude',
  lon: 'Longitude',
  lng: 'Longitude',
};

let localData = null; // loaded once: { rows, bounds, path }

// Loads the local CSV into memory (once) and returns { rows, bounds, path }.
// A missing or unreadable file is not an error: rows is just empty and the fallback is off.
export function loadLocalStores() {
  if (localData) return localData;
  const csvPath = process.env.SNAP_CSV_PATH || DEFAULT_CSV_PATH;
  localData = { rows: [], bounds: null, path: csvPath };
  try {
    const [header, ...body] = parseCsv(fs.readFileSync(csvPath, 'utf8'));
    const cols = (header ?? []).map((h) => CSV_COLUMNS[h.trim().toLowerCase()] ?? null);
    if (!cols.includes('Latitude') || !cols.includes('Longitude')) {
      throw new Error('CSV needs Latitude and Longitude columns');
    }

    const bounds = { minLat: Infinity, maxLat: -Infinity, minLng: Infinity, maxLng: -Infinity };
    for (const cells of body) {
      const row = {};
      cols.forEach((name, i) => {
        if (name) row[name] = (cells[i] ?? '').trim();
      });
      const la = parseFloat(row.Latitude);
      const ln = parseFloat(row.Longitude);
      const hasCoords = Number.isFinite(la) && Number.isFinite(ln) && !(la === 0 && ln === 0);
      row.Latitude = hasCoords ? la : null;
      row.Longitude = hasCoords ? ln : null;
      if (row.Zip_Code) row.Zip_Code = row.Zip_Code.slice(0, 5).padStart(5, '0');
      if (hasCoords) {
        bounds.minLat = Math.min(bounds.minLat, la);
        bounds.maxLat = Math.max(bounds.maxLat, la);
        bounds.minLng = Math.min(bounds.minLng, ln);
        bounds.maxLng = Math.max(bounds.maxLng, ln);
      }
      localData.rows.push(row);
    }
    localData.bounds = localData.rows.length ? bounds : null;
    console.log(`Local SNAP fallback ready: ${localData.rows.length} stores from ${csvPath}`);
  } catch (err) {
    localData.rows = [];
    if (err.code === 'ENOENT') {
      console.log(`No local SNAP CSV at ${csvPath}; the live USDA service is the only source.`);
    } else {
      console.error(`Could not load local SNAP CSV (${csvPath}): ${err.message}`);
    }
  }
  return localData;
}

// Same inputs and output shape as findStores(), but answered from the local CSV.
// Returns null when the CSV can't answer (no file, origin outside the CSV's state, or a ZIP
// with no rows), so the caller can surface the original error instead of a misleading
// "0 stores". The state's bounding box is a rough rectangle, but enough to tell
// "this is the CSV's state" from "somewhere it has no data for".
export function findStoresLocal({ lat, lng, zip, radius = 2, limit = 25 }) {
  const { rows, bounds } = loadLocalStores();
  if (!rows.length) return null;

  let origin = null;
  let hits;
  if (lat != null && lng != null) {
    origin = { lat: Number(lat), lng: Number(lng) };
    const inside =
      bounds &&
      origin.lat >= bounds.minLat && origin.lat <= bounds.maxLat &&
      origin.lng >= bounds.minLng && origin.lng <= bounds.maxLng;
    if (!inside) return null;
    const miles = Math.min(Number(radius) || 2, MAX_RADIUS_MILES);
    hits = rows.filter((r) =>
      r.Latitude != null && milesBetween(origin.lat, origin.lng, r.Latitude, r.Longitude) <= miles
    );
  } else {
    hits = rows.filter((r) => r.Zip_Code === String(zip));
    if (!hits.length) return null;
  }

  return rankStores(hits.map((r) => toStore(r, origin)))
    .slice(0, Math.max(1, Math.min(Number(limit) || 25, 200)));
}

// Rejects if `promise` hasn't settled within `ms`. The original promise is left running
// (findStores can't be aborted from outside), so a slow live answer still lands in the
// 10-minute cache and makes the next identical request instant.
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Live SNAP lookup timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// findStores() with the local CSV as a fallback. Returns { stores, source }, where source
// is 'live' or 'local'. If the live lookup fails and the CSV can't answer either, the
// original live error is rethrown.
export async function findStoresWithFallback(opts) {
  if (!loadLocalStores().rows.length) {
    return { stores: await findStores(opts), source: 'live' };
  }
  const timeoutMs = Number(process.env.SNAP_LIVE_TIMEOUT_MS) || DEFAULT_LIVE_TIMEOUT_MS;
  try {
    return { stores: await withTimeout(findStores(opts), timeoutMs), source: 'live' };
  } catch (err) {
    const stores = findStoresLocal(opts);
    if (!stores) throw err;
    console.warn(`Live SNAP lookup failed (${err.message}); serving ${stores.length} stores from local CSV`);
    return { stores, source: 'local' };
  }
}

// Drop-in replacement for registerStoreRoutes(): same GET /stores validation and response,
// plus `source`, backed by findStoresWithFallback(). Also loads the CSV at startup so the
// first request doesn't pay for parsing.
export function registerStoreFallbackRoutes(app) {
  loadLocalStores();

  app.get('/stores', async (req, res) => {
    try {
      const { lat, lng, zip, radius, limit } = req.query;
      const hasCoords = lat !== undefined && lng !== undefined;
      if (hasCoords) {
        const la = Number(lat);
        const ln = Number(lng);
        if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) {
          return res.status(400).json({ error: 'lat and lng must be valid numbers' });
        }
      } else if (!zip || !/^\d{5}$/.test(String(zip))) {
        return res.status(400).json({ error: 'Send lat and lng, or a 5-digit zip' });
      }
      const { stores, source } = await findStoresWithFallback({
        lat: hasCoords ? lat : null,
        lng: hasCoords ? lng : null,
        zip,
        radius,
        limit,
      });
      return res.status(200).json({ count: stores.length, source, stores });
    } catch (error) {
      console.error('Store lookup error:', error.message);
      return res.status(502).json({ error: 'Could not reach the USDA store data', details: error.message });
    }
  });
}


