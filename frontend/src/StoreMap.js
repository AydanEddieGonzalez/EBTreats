// Map page: shows nearby SNAP/EBT stores as pins on a Leaflet map.
// Data comes from the backend's GET /stores (backend/stores.js), already ranked:
// incentive-program stores first, then fresh-food store types, then distance.
//
// Props (all optional, so the page also works on its own at /map):
//   location       { lat, lng } from the location/budget input screen; if missing,
//                  the page asks the browser for the user's position.
//   onSelectStore  (store) => void, called when the user picks a store.

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './StoreMap.css';

const API_BASE_URL = 'http://localhost:3001';
const DEFAULT_CENTER = { lat: 37.8715, lng: -122.273 }; // Berkeley, used if location is unavailable
const RADIUS_OPTIONS = [1, 2, 5, 10];

function pinIcon(store, selected) {
  const classes = ['store-pin'];
  if (store.hasIncentive) classes.push('store-pin--incentive');
  if (selected) classes.push('store-pin--selected');
  return L.divIcon({
    className: '',
    html: `<div class="${classes.join(' ')}"></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    popupAnchor: [0, -24],
  });
}

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function popupHtml(store) {
  const lines = [
    `<strong>${escapeHtml(store.name)}</strong>`,
    escapeHtml([store.address, store.city, store.state].filter(Boolean).join(', ')),
    escapeHtml(store.type),
  ];
  if (store.distanceMiles != null) lines.push(`${store.distanceMiles} mi away`);
  if (store.hasIncentive) lines.push(`<span class="store-popup-incentive">${escapeHtml(store.incentiveProgram)}</span>`);
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${store.lat},${store.lng}`;
  lines.push(`<a href="${directions}" target="_blank" rel="noreferrer">Directions</a>`);
  return lines.filter(Boolean).join('<br/>');
}

async function fetchStores({ lat, lng, zip, radius }) {
  const params = new URLSearchParams({ limit: '50' });
  if (zip) params.set('zip', zip);
  else {
    params.set('lat', lat);
    params.set('lng', lng);
    params.set('radius', radius);
  }
  const res = await fetch(`${API_BASE_URL}/stores?${params}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Could not load stores');
  return body.stores ?? [];
}

export default function StoreMap({ location, onSelectStore }) {
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map()); // store id -> Leaflet marker
  const youMarkerRef = useRef(null);

  const [center, setCenter] = useState(location ?? null);
  const [radius, setRadius] = useState(2);
  const [zipInput, setZipInput] = useState('');
  const [zip, setZip] = useState('');
  const [stores, setStores] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [status, setStatus] = useState('Finding your location...');
  const [error, setError] = useState('');

  // Create the map once.
  useEffect(() => {
    // Leaflet's defaults only allow whole zoom levels, so a trackpad scroll (many tiny wheel
    // events) builds up and then jumps 1-2 levels at once. Continuous zoom (zoomSnap 0) lets
    // every scroll step move the map a little, so scroll and pinch zoom feel smooth.
    const map = L.map(mapDivRef.current, {
      zoomControl: true,
      zoomSnap: 0,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 100,
      wheelDebounceTime: 20,
    }).setView(
      [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 13,
    );
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    mapRef.current = map;
    const markers = markersRef.current;
    return () => {
      map.remove();
      mapRef.current = null;
      markers.clear();
      youMarkerRef.current = null;
    };
  }, []);

  // Follow a location passed in from the input screen.
  useEffect(() => {
    if (location?.lat != null && location?.lng != null) {
      setZip('');
      setCenter({ lat: Number(location.lat), lng: Number(location.lng) });
    }
  }, [location?.lat, location?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // No location given: ask the browser, fall back to the default center.
  useEffect(() => {
    if (location) return;
    if (!navigator.geolocation) {
      setCenter(DEFAULT_CENTER);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {
        setStatus('Location blocked, showing Berkeley. Search a zip code instead.');
        setCenter(DEFAULT_CENTER);
      },
      { timeout: 8000 },
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load stores whenever the search changes.
  useEffect(() => {
    if (!center && !zip) return;
    let cancelled = false;
    setStatus('Loading stores...');
    setError('');
    fetchStores({ lat: center?.lat, lng: center?.lng, zip, radius })
      .then((result) => {
        if (cancelled) return;
        setStores(result);
        setSelectedId(null);
        setStatus(result.length ? '' : 'No SNAP stores found here. Try a bigger radius.');
      })
      .catch((err) => {
        if (cancelled) return;
        setStores([]);
        setError(err.message === 'Failed to fetch'
          ? 'Could not reach the backend. Is it running on port 3001?'
          : err.message);
        setStatus('');
      });
    return () => { cancelled = true; };
  }, [center, zip, radius]);

  // Draw the "you are here" dot.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !center || zip) {
      youMarkerRef.current?.remove();
      youMarkerRef.current = null;
      return;
    }
    if (!youMarkerRef.current) {
      youMarkerRef.current = L.circleMarker([center.lat, center.lng], {
        radius: 8, color: '#ffffff', weight: 3, fillColor: '#2f6fde', fillOpacity: 1,
      }).bindTooltip('You').addTo(map);
    } else {
      youMarkerRef.current.setLatLng([center.lat, center.lng]);
    }
  }, [center, zip]);

  // Draw store pins and fit the view to them.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current.clear();

    const points = [];
    stores.forEach((store) => {
      if (store.lat == null || store.lng == null) return;
      const marker = L.marker([store.lat, store.lng], { icon: pinIcon(store, false) })
        .bindPopup(popupHtml(store))
        .on('click', () => setSelectedId(store.id))
        .addTo(map);
      markersRef.current.set(store.id, marker);
      points.push([store.lat, store.lng]);
    });
    if (center && !zip) points.push([center.lat, center.lng]);
    if (points.length) map.fitBounds(points, { padding: [40, 40], maxZoom: 15 });
  }, [stores]); // eslint-disable-line react-hooks/exhaustive-deps

  // Highlight the selected pin.
  useEffect(() => {
    stores.forEach((store) => {
      markersRef.current.get(store.id)?.setIcon(pinIcon(store, store.id === selectedId));
    });
    const selected = stores.find((s) => s.id === selectedId);
    if (selected) onSelectStore?.(selected);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  function selectFromList(store) {
    setSelectedId(store.id);
    const marker = markersRef.current.get(store.id);
    if (marker && mapRef.current) {
      mapRef.current.setView(marker.getLatLng(), Math.max(mapRef.current.getZoom(), 15));
      marker.openPopup();
    }
  }

  function submitZip(e) {
    e.preventDefault();
    if (!/^\d{5}$/.test(zipInput.trim())) {
      setError('Enter a 5-digit zip code');
      return;
    }
    setZip(zipInput.trim());
  }

  function useMyLocation() {
    setZip('');
    setZipInput('');
    if (!navigator.geolocation) return;
    setStatus('Finding your location...');
    navigator.geolocation.getCurrentPosition(
      (pos) => setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setStatus('Location blocked. Search a zip code instead.'),
      { timeout: 8000 },
    );
  }

  return (
    <div className="store-map-page">
      <div className="store-map-header">
        <h1>SNAP stores near you</h1>
        <form className="store-map-controls" onSubmit={submitZip}>
          <input
            type="text"
            inputMode="numeric"
            placeholder="Zip code"
            value={zipInput}
            onChange={(e) => setZipInput(e.target.value)}
            maxLength={5}
          />
          <button type="submit">Search</button>
          <button type="button" onClick={useMyLocation}>Use my location</button>
          <label>
            Within
            <select value={radius} onChange={(e) => setRadius(Number(e.target.value))} disabled={!!zip}>
              {RADIUS_OPTIONS.map((r) => <option key={r} value={r}>{r} mi</option>)}
            </select>
          </label>
        </form>
        <div className="store-map-legend">
          <span><i className="store-pin store-pin--incentive" /> Fruit and veg incentive</span>
          <span><i className="store-pin" /> SNAP store</span>
        </div>
      </div>

      {error && <p className="store-map-message store-map-message--error">{error}</p>}
      {status && <p className="store-map-message">{status}</p>}

      <div className="store-map-body">
        <div ref={mapDivRef} className="store-map-canvas" />
        <ul className="store-map-list">
          {stores.map((store) => (
            <li key={store.id}>
              <button
                type="button"
                className={`store-map-item${store.id === selectedId ? ' store-map-item--selected' : ''}`}
                onClick={() => selectFromList(store)}
              >
                <span className="store-map-item-name">{store.name}</span>
                <span className="store-map-item-meta">
                  {store.type}
                  {store.distanceMiles != null && ` · ${store.distanceMiles} mi`}
                </span>
                {store.hasIncentive && <span className="store-map-badge">{store.incentiveProgram}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
