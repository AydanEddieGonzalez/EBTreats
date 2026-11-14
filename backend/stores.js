// SNAP store lookup: finds EBT-authorized stores near a location using USDA's
// public SNAP Retailer Locator data (ArcGIS feature service, no API key needed).
//
// GET /stores?lat=37.87&lng=-122.27&radius=2&limit=25
// GET /stores?zip=94704&limit=25
// Add &sort=healthy to rank for healthy shopping instead of pure distance.
//
// By default stores are sorted nearest first. With sort=healthy they are ranked
// for healthy, budget-friendly shopping:
//   1. stores in a fruit/veg incentive program (e.g. Double Up Food Bucks) first
//   2. then stores likely to carry fresh produce (supermarkets, grocers, farmers markets)
//   3. then by distance
// Tune the ranking in rankStores() below.

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
  const incentive = String(attrs.Incentive_Program ?? '').trim();
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
    incentiveProgram: incentive || null,
    hasIncentive: incentive !== '',
    distanceMiles: origin && lat != null && lng != null
      ? Math.round(milesBetween(origin.lat, origin.lng, lat, lng) * 100) / 100
      : null,
  };
}

export function sortByDistance(stores) {
  return [...stores].sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity));
}

export function rankStores(stores) {
  return [...stores].sort((a, b) =>
    (Number(b.hasIncentive) - Number(a.hasIncentive)) ||
    (storeTypeScore(b.type) - storeTypeScore(a.type)) ||
    ((a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity))
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

export async function findStores({ lat, lng, zip, radius = 2, limit = 25, sort = 'nearest' }) {
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
  const ordered = sort === 'healthy' ? rankStores(stores) : sortByDistance(stores);
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
