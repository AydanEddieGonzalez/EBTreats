// "Find stores" view: nearby SNAP/EBT stores on a Leaflet map, drawn in the
// design's style (toolbar, square pins with hover labels, legend, "You" marker).
// Data comes from the backend's GET /stores (backend/stores.js), already ranked:
// incentive-program stores first, then fresh-food store types, then distance.
//
// Props:
//   active         true while the map view is on screen. The first time it turns on,
//                  the page asks the browser for the user's location.
//   onSearch       optional, called with the current search ({ lat, lng, radius } or { zip }) or null
//   onSelectStore  optional, called with the store whose pin is picked, or null
//   onPlan         optional, shows a "Build a shopping list" button over the map
//   focus          optional { store, where }: search `where` and pick `store` (from the shopping list)

import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import Icon from './Icon';
import { findStores } from './api';

const DEFAULT_CENTER = { lat: 37.8715, lng: -122.273 }; // Berkeley, used if location is unavailable
const RADIUS_OPTIONS = [0.5, 1, 2, 5];
const FILTERS = ['All stores', 'Produce incentive', 'Grocery stores'];
const GROCERY_TYPES = new Set([
  'supermarket', 'super store', 'large grocery store', 'medium grocery store',
  'small grocery store', 'combination grocery/other', 'farmers and markets', 'farmers market',
]);
// Rough door-to-door speeds in mph, only used for the "nearest store" estimate.
const TRAVEL = [
  { icon: 'walk', label: 'walk', mph: 3 },
  { icon: 'bike', label: 'bike', mph: 10 },
  { icon: 'bus', label: 'transit', mph: 12 },
  { icon: 'car', label: 'drive', mph: 22 },
];

const LEAF_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 4C12 4 5 8 5 15c0 2 1 4 3 5 7-1 11-6 12-16Z"/><path d="M4 21c3-5 7-8 12-11"/></svg>';
const STORE_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10v11h16V10M3 10l2-6h14l2 6c-1 2-4 2-5 0-1 2-4 2-5 0-1 2-4 2-5 0-1 2-3 1-3 0ZM9 21v-6h6v6"/></svg>';

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function titleCase(text) {
  return String(text ?? '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function storeSubtitle(store) {
  const parts = [store.hasIncentive ? store.incentiveProgram : 'EBT accepted'];
  if (store.distanceMiles != null) parts.push(`${store.distanceMiles} mi`);
  return parts.join(' · ');
}

function pinIcon(store, selected) {
  const classes = ['store-pin'];
  if (store.hasIncentive) classes.push('produce');
  if (selected) classes.push('selected');
  return L.divIcon({
    className: `store-marker${selected ? ' is-selected' : ''}`,
    html: `<div class="${classes.join(' ')}">
      <span class="pin-square">${store.hasIncentive ? LEAF_SVG : STORE_SVG}</span>
      <span class="store-label"><strong>${escapeHtml(titleCase(store.name))}</strong><small>${escapeHtml(storeSubtitle(store))}</small></span>
    </div>`,
    iconSize: [42, 42],
    iconAnchor: [21, 42],
    popupAnchor: [0, -40],
  });
}

const youIcon = L.divIcon({
  className: 'you-marker',
  html: '<div class="you-are-here"><span></span><em>You</em></div>',
  iconSize: [30, 40],
  iconAnchor: [15, 9],
});

function popupHtml(store) {
  const lines = [
    `<strong>${escapeHtml(titleCase(store.name))}</strong>`,
    escapeHtml([store.address, titleCase(store.city), store.state].filter(Boolean).join(', ')),
    escapeHtml(store.type),
  ];
  if (store.distanceMiles != null) lines.push(`${store.distanceMiles} mi away`);
  if (store.hasIncentive) lines.push(`<span class="popup-incentive">${escapeHtml(store.incentiveProgram)}</span>`);
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${store.lat},${store.lng}`;
  lines.push(`<a href="${directions}" target="_blank" rel="noreferrer">Directions</a>`);
  return lines.filter(Boolean).join('<br/>');
}

function matchesFilter(store, filter) {
  if (filter === 'Produce incentive') return store.hasIncentive;
  if (filter === 'Grocery stores') return GROCERY_TYPES.has(String(store.type ?? '').trim().toLowerCase());
  return true;
}

export default function StoreMap({ active, onSearch, onSelectStore, onPlan, focus }) {
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map()); // store id -> Leaflet marker
  const youMarkerRef = useRef(null);
  const askedForLocation = useRef(false);
  const pendingFocusId = useRef(null); // store to pick once the next search loads
  const popupForId = useRef(null); // store whose popup opens once its pin is drawn

  const [center, setCenter] = useState(null);
  const [radius, setRadius] = useState(1);
  const [query, setQuery] = useState('');
  const [zip, setZip] = useState('');
  const [filter, setFilter] = useState('All stores');
  const [travel, setTravel] = useState('walk');
  const [stores, setStores] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  // Typing a name filters the loaded stores. A 5-digit zip is a new search (on submit).
  const nameQuery = /^\d{1,5}$/.test(query.trim()) ? '' : query.trim().toLowerCase();
  const visibleStores = useMemo(
    () => stores.filter((s) => matchesFilter(s, filter)
      && (!nameQuery || String(s.name).toLowerCase().includes(nameQuery))),
    [stores, filter, nameQuery],
  );

  // Create the map once.
  useEffect(() => {
    // Continuous zoom (zoomSnap 0) keeps trackpad scroll and pinch zoom smooth.
    const map = L.map(mapDivRef.current, {
      zoomControl: true,
      zoomSnap: 0,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 100,
      wheelDebounceTime: 20,
    }).setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 14);
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

  function locate() {
    setZip('');
    if (!navigator.geolocation) {
      setStatus('Location is not available here. Search a zip code instead.');
      setCenter((c) => c ?? DEFAULT_CENTER);
      return;
    }
    setStatus('Finding your location...');
    navigator.geolocation.getCurrentPosition(
      (pos) => setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {
        setStatus('Location blocked, showing Berkeley. Search a zip code instead.');
        setCenter((c) => c ?? DEFAULT_CENTER);
      },
      { timeout: 8000 },
    );
  }

  // The map is laid out while hidden, so re-measure it when it comes on screen,
  // and ask for the location the first time.
  useEffect(() => {
    if (!active) return undefined;
    const timer = setTimeout(() => mapRef.current?.invalidateSize(), 120);
    if (!askedForLocation.current && !focus?.store) {
      askedForLocation.current = true;
      locate();
    }
    return () => clearTimeout(timer);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load stores whenever the search changes.
  useEffect(() => {
    if (!center && !zip) return undefined;
    let cancelled = false;
    setStatus('Loading SNAP stores...');
    setError('');
    findStores({ lat: center?.lat, lng: center?.lng, zip, radius })
      .then((result) => {
        if (cancelled) return;
        setStores(result);
        const focusId = pendingFocusId.current;
        pendingFocusId.current = null;
        setSelectedId(focusId != null && result.some((s) => s.id === focusId) ? focusId : null);
        setStatus(result.length ? '' : 'No SNAP stores found here. Try a bigger distance.');
      })
      .catch((err) => {
        if (cancelled) return;
        setStores([]);
        setError(err.message);
        setStatus('');
      });
    return () => { cancelled = true; };
  }, [center, zip, radius]);

  // Draw the "You" marker.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !center || zip) {
      youMarkerRef.current?.remove();
      youMarkerRef.current = null;
      return;
    }
    if (!youMarkerRef.current) {
      youMarkerRef.current = L.marker([center.lat, center.lng], { icon: youIcon, keyboard: false, zIndexOffset: 500 })
        .addTo(map);
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
    visibleStores.forEach((store) => {
      if (store.lat == null || store.lng == null) return;
      const marker = L.marker([store.lat, store.lng], { icon: pinIcon(store, store.id === selectedId), title: store.name })
        .bindPopup(popupHtml(store))
        .on('click', () => setSelectedId(store.id))
        .addTo(map);
      markersRef.current.set(store.id, marker);
      points.push([store.lat, store.lng]);
    });
    if (center && !zip) points.push([center.lat, center.lng]);
    if (points.length > 1) map.fitBounds(points, { padding: [50, 50], maxZoom: 16 });
    else if (points.length === 1) map.setView(points[0], 15);
  }, [visibleStores]); // eslint-disable-line react-hooks/exhaustive-deps

  // Highlight the selected pin.
  useEffect(() => {
    visibleStores.forEach((store) => {
      markersRef.current.get(store.id)?.setIcon(pinIcon(store, store.id === selectedId));
    });
    onSelectStore?.(stores.find((s) => s.id === selectedId) ?? null);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tell the app where the map is looking, so the shopping list can use the same place.
  useEffect(() => {
    if (zip) onSearch?.({ zip });
    else if (center) onSearch?.({ lat: center.lat, lng: center.lng, radius });
    else onSearch?.(null);
  }, [center, zip, radius]); // eslint-disable-line react-hooks/exhaustive-deps

  // "See store on map" from the shopping list: run the list's search and pick its store.
  useEffect(() => {
    if (!focus?.store) return;
    const { store, where } = focus;
    askedForLocation.current = true; // don't replace this search with a location prompt
    setFilter('All stores');
    setQuery('');
    popupForId.current = store.id;
    if (stores.some((s) => s.id === store.id)) {
      setSelectedId(store.id);
      return;
    }
    pendingFocusId.current = store.id;
    if (where?.zip) {
      setZip(where.zip);
    } else if (where?.lat != null) {
      setZip('');
      if (where.radius) setRadius(where.radius);
      setCenter({ lat: where.lat, lng: where.lng });
    }
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Open the focused store's popup once its pin is drawn.
  useEffect(() => {
    if (selectedId == null || popupForId.current !== selectedId) return;
    const marker = markersRef.current.get(selectedId);
    if (!marker) return;
    popupForId.current = null;
    marker.openPopup();
  }, [selectedId, visibleStores, focus]);

  function submitSearch(e) {
    e.preventDefault();
    const value = query.trim();
    if (/^\d{5}$/.test(value)) {
      setError('');
      setZip(value);
    } else if (/^\d+$/.test(value)) {
      setError('Enter a 5-digit zip code');
    }
  }

  const selected = stores.find((s) => s.id === selectedId) ?? null;
  const nearest = visibleStores
    .filter((s) => s.distanceMiles != null)
    .reduce((best, s) => (!best || s.distanceMiles < best.distanceMiles ? s : best), null);
  const speed = TRAVEL.find((t) => t.icon === travel)?.mph ?? 3;
  const minutes = nearest ? Math.max(1, Math.round((nearest.distanceMiles / speed) * 60)) : null;

  return (
    <>
      <div className="map-toolbar">
        <form className="map-search" onSubmit={submitSearch}>
          <Icon name="search" size={20} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a zip code or store name..."
            aria-label="Search a zip code or store name"
          />
          <button type="button" onClick={() => { setQuery(''); locate(); }} aria-label="Use my location" title="Use my location">
            <Icon name="locate" size={19} />
          </button>
          <button type="submit" className="search-submit" aria-label="Search">
            <Icon name="chevron" size={19} />
          </button>
        </form>
        <div className="filter-row">
          {FILTERS.map((name) => (
            <button key={name} onClick={() => setFilter(name)} className={filter === name ? 'selected' : ''}>
              {name === 'Produce incentive' && <Icon name="leaf" size={14} />}
              {name}
            </button>
          ))}
          <div className="filter-spacer" />
          {RADIUS_OPTIONS.map((value) => (
            <button
              key={value}
              onClick={() => setRadius(value)}
              className={radius === value && !zip ? 'selected' : ''}
              disabled={!!zip}
              title={zip ? 'Zip search shows the whole zip code' : undefined}
            >
              {value} mi
            </button>
          ))}
        </div>
        <div className="travel-row">
          <span>Travel by</span>
          {TRAVEL.map(({ icon, label }) => (
            <button key={label} className={travel === icon ? 'selected' : ''} onClick={() => setTravel(icon)}>
              <Icon name={icon} size={15} /> {label}
            </button>
          ))}
          <span className="travel-time">
            {minutes != null ? `Nearest store about ${minutes} min away` : zip ? `Zip ${zip}` : ''}
          </span>
        </div>
      </div>
      <div className="map-canvas">
        <div ref={mapDivRef} className="leaflet-host" />
        {(error || status) && <div className={`map-status${error ? ' error' : ''}`}>{error || status}</div>}
        {onPlan && stores.length > 0 && (
          <button className="map-plan-btn" onClick={onPlan}>
            <Icon name="list" size={16} />
            {selected ? `Build a list for ${titleCase(selected.name)}` : 'Build a shopping list here'}
          </button>
        )}
        <div className="map-legend">
          <span>
            <i className="produce-key"><Icon name="leaf" size={13} /></i> Produce incentive
          </span>
          <span>
            <i><Icon name="store" size={13} /></i> SNAP store
          </span>
          <span>{visibleStores.length} shown</span>
        </div>
      </div>
    </>
  );
}
