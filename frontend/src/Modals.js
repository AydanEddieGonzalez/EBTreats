// Dialogs built on the design's .modal-layer / .card-modal / .detail-panel styles.
import { useState } from 'react';
import Icon from './Icon';
import * as api from './api';

export const CUISINES = ['American', 'Mexican', 'Italian', 'Chinese', 'Indian', 'Southern', 'Mediterranean'];
export const APPLIANCES = ['Stove', 'Oven', 'Microwave', 'Air Fryer', 'Slow Cooker', 'Blender'];
export const ALLERGENS = ['Milk', 'Egg', 'Peanut', 'Tree nut', 'Soy', 'Gluten', 'Fish', 'Shellfish'];

function Modal({ onClose, wide, children }) {
  return (
    <div className="modal-layer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className={wide ? 'detail-panel' : 'card-modal'} role="dialog" aria-modal="true">
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
        {children}
      </section>
    </div>
  );
}

export function AuthModal({ onClose, onAuthed }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    const name = username.trim();
    if (!name || !password) return setError('Enter a username and password.');
    if (mode === 'signup' && password !== confirm) return setError('The passwords do not match.');
    setBusy(true);
    try {
      if (mode === 'signup') await api.signup(name, password);
      const { user } = await api.login(name, password);
      onAuthed(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <span className="modal-icon"><Icon name="user" size={26} /></span>
      <p className="eyebrow">YOUR ACCOUNT</p>
      <h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
      <p className="modal-intro">
        Your account keeps your pantry, preferences and grocery list on every device.
      </p>
      <div className="view-switch auth-switch">
        <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Log in</button>
        <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Sign up</button>
      </div>
      <form onSubmit={submit}>
        {error && <p className="form-error">{error}</p>}
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </label>
        {mode === 'signup' && (
          <label>
            Confirm password
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </label>
        )}
        <button className="primary-btn" type="submit" disabled={busy}>
          {busy ? 'One moment...' : mode === 'login' ? 'Log in' : 'Create account'} <Icon name="chevron" size={17} />
        </button>
      </form>
    </Modal>
  );
}

function ChipGroup({ label, options, value, onChange }) {
  const toggle = (option) =>
    onChange(value.includes(option) ? value.filter((v) => v !== option) : [...value, option]);
  return (
    <div className="chip-group">
      <span>{label}</span>
      <div className="filter-row">
        {options.map((option) => (
          <button type="button" key={option} className={value.includes(option) ? 'selected' : ''} onClick={() => toggle(option)}>
            {value.includes(option) && <Icon name="check" size={12} />} {option}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PreferencesModal({ prefs, onSave, onClose }) {
  const [draft, setDraft] = useState(prefs);
  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));
  const hours = Math.floor(draft.time / 60);
  const mins = draft.time % 60;

  return (
    <Modal onClose={onClose}>
      <span className="modal-icon"><Icon name="sliders" size={26} /></span>
      <p className="eyebrow">PERSONALIZATION</p>
      <h2>Your cooking preferences</h2>
      <p className="modal-intro">Recipes and your grocery list follow these settings.</p>
      <form onSubmit={(e) => { e.preventDefault(); onSave(draft); }}>
        <label>
          Weekly food budget <span className="range-value">${draft.budget}</span>
          <input type="range" min="10" max="300" step="5" value={draft.budget} onChange={(e) => set('budget')(Number(e.target.value))} />
        </label>
        <label>
          Time to cook <span className="range-value">{hours ? `${hours} h ` : ''}{mins ? `${mins} min` : ''}</span>
          <input type="range" min="10" max="180" step="5" value={draft.time} onChange={(e) => set('time')(Number(e.target.value))} />
        </label>
        <label>
          Cooking skill
          <select value={draft.difficulty} onChange={(e) => set('difficulty')(e.target.value)}>
            <option>Beginner</option>
            <option>Intermediate</option>
            <option>Advanced</option>
          </select>
        </label>
        <ChipGroup label="Cuisines you like" options={CUISINES} value={draft.cuisines} onChange={set('cuisines')} />
        <ChipGroup label="Appliances you have" options={APPLIANCES} value={draft.appliances} onChange={set('appliances')} />
        <ChipGroup label="Allergies" options={ALLERGENS} value={draft.allergens} onChange={set('allergens')} />
        <button className="primary-btn" type="submit">
          <Icon name="check" size={17} /> Save preferences
        </button>
      </form>
    </Modal>
  );
}

export function ReceiptModal({ onClose, onAdd }) {
  const [file, setFile] = useState(null);
  const [found, setFound] = useState(null); // { [name]: quantity }
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function scan(e) {
    e.preventDefault();
    if (!file) return setError('Choose a photo of your receipt first.');
    setError('');
    setBusy(true);
    try {
      const result = await api.scanReceipt(file);
      const items = {};
      Object.entries(result ?? {}).forEach(([name, value]) => {
        const qty = Number(Array.isArray(value) ? value[0] : value) || 1;
        items[name] = qty;
      });
      setFound(items);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const names = found ? Object.keys(found) : [];

  return (
    <Modal onClose={onClose}>
      <span className="modal-icon"><Icon name="upload" size={26} /></span>
      <p className="eyebrow">ADD TO YOUR PANTRY</p>
      <h2>Scan a grocery receipt</h2>
      <p className="modal-intro">We read the food items on your receipt and add them to your pantry, so recipes use them first.</p>
      {error && <p className="form-error">{error}</p>}
      {found === null ? (
        <form onSubmit={scan}>
          <label className="file-drop">
            <Icon name="upload" size={24} />
            {file ? file.name : 'Choose a receipt photo'}
            <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <button className="primary-btn" type="submit" disabled={busy}>
            {busy ? 'Reading receipt...' : 'Read receipt'} <Icon name="chevron" size={17} />
          </button>
          {busy && <p className="form-note">This can take up to a minute. Each line is checked against USDA food data.</p>}
        </form>
      ) : names.length === 0 ? (
        <>
          <p className="form-note">We could not find food items on that receipt. Try a sharper, straight-on photo.</p>
          <button className="primary-btn" onClick={() => { setFound(null); setFile(null); }}>Try another photo</button>
        </>
      ) : (
        <>
          <ul className="found-list">
            {names.map((name) => (
              <li key={name}><span>{name}</span><strong>× {found[name]}</strong></li>
            ))}
          </ul>
          <button className="primary-btn" onClick={() => onAdd(found)}>
            <Icon name="plus" size={17} /> Add {names.length} {names.length === 1 ? 'item' : 'items'} to my pantry
          </button>
        </>
      )}
    </Modal>
  );
}

export function RecipeModal({ recipe, hasItem, onClose, onAddMissing }) {
  const missing = recipe.ingredients.filter((ing) => !hasItem(ing.item));
  return (
    <Modal onClose={onClose} wide>
      <p className="eyebrow">{[recipe.cuisine, ...(recipe.tags ?? []).slice(0, 2)].filter(Boolean).join(' · ').toUpperCase() || 'RECIPE'}</p>
      <h2>{recipe.name}</h2>
      <p className="detail-price">
        {recipe.time ? `${recipe.time} min` : ''}
        <strong>{recipe.budget ? `About $${Number(recipe.budget).toFixed(2)}` : ''}</strong>
      </p>

      <p className="section-label">INGREDIENTS</p>
      <ul className="recipe-detail-list">
        {recipe.ingredients.map((ing, i) => {
          const have = hasItem(ing.item);
          return (
            <li key={i}>
              <i className={have ? 'got' : 'need'}><Icon name={have ? 'check' : 'plus'} size={14} /></i>
              {ing.item}
              <span>{[ing.amount, ing.unit].filter(Boolean).join(' ')}{have ? ' · have' : ''}</span>
            </li>
          );
        })}
      </ul>

      {recipe.appliances?.length > 0 && (
        <>
          <p className="section-label">YOU WILL USE</p>
          <p className="form-note">{recipe.appliances.join(', ')}</p>
        </>
      )}

      <p className="section-label">STEPS</p>
      <ol className="recipe-steps">
        {recipe.instructions.map((step, i) => <li key={i}>{step}</li>)}
      </ol>

      {missing.length > 0 && (
        <button className="primary-btn" style={{ marginTop: 18 }} onClick={onAddMissing}>
          <Icon name="list" size={17} /> Put {missing.length} missing {missing.length === 1 ? 'item' : 'items'} on my list
        </button>
      )}
    </Modal>
  );
}

const GOALS = ['Eat more vegetables', 'More protein', 'Less sugar', 'Heart healthy', 'Kid friendly'];
const CATEGORY_ORDER = ['produce', 'protein', 'dairy', 'grains', 'frozen', 'pantry', 'other'];
const CATEGORY_LABELS = {
  produce: 'Fruits and vegetables',
  protein: 'Protein',
  dairy: 'Dairy',
  grains: 'Grains',
  frozen: 'Frozen',
  pantry: 'Pantry staples',
  other: 'Other',
};

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const titleCase = (text) => String(text ?? '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const amountText = (item) =>
  [item.quantity, item.unit].filter((v) => v !== undefined && v !== null && v !== '').join(' ');

// Shape a shopping-plan item for the grocery list in App.js ({ name, detail, store }).
export function planItemToListItem(item, store) {
  const price = Number(item.estimatedPrice) > 0 ? `about ${money(item.estimatedPrice)}` : '';
  return {
    name: item.name,
    detail: [amountText(item), price].filter(Boolean).join(' · ') || 'To buy',
    store: store?.name ? titleCase(store.name) : undefined,
  };
}

// "Build my shopping list": location + budget + goals go to POST /shopping-plan, and the
// healthy SNAP-eligible list comes back for the top-ranked store (or the pin picked on the map).
export function ShoppingPlanModal({ prefs, pantryItems, mapSearch, mapStore, onAddItems, onShowStore, onClose }) {
  const [budget, setBudget] = useState(Number(prefs.budget) || 50);
  const [householdSize, setHouseholdSize] = useState(1);
  const [days, setDays] = useState(7);
  const [goals, setGoals] = useState([]);
  const [otherGoal, setOtherGoal] = useState('');
  const [zip, setZip] = useState(mapSearch?.zip ?? '');
  const [coords, setCoords] = useState(
    mapSearch?.lat != null ? { lat: mapSearch.lat, lng: mapSearch.lng } : null,
  );
  const [forMapStore, setForMapStore] = useState(Boolean(mapStore));
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [plan, setPlan] = useState(null); // { stores, store, list, listError, where }
  const [picked, setPicked] = useState(() => new Set());

  function locate() {
    setError('');
    if (!navigator.geolocation) return setError('Location is not available here. Enter a zip code instead.');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setZip('');
        setLocating(false);
      },
      () => {
        setError('Location is blocked. Enter a zip code instead.');
        setLocating(false);
      },
      { timeout: 8000 },
    );
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    const zipValue = zip.trim();
    let where;
    if (/^\d{5}$/.test(zipValue)) where = { zip: zipValue };
    else if (zipValue) return setError('Enter a 5-digit zip code.');
    else if (coords) where = { ...coords, radius: mapSearch?.radius ?? 2 };
    else return setError('Use your location or enter a zip code.');

    const allGoals = [...goals, ...otherGoal.split(',').map((g) => g.trim()).filter(Boolean)];
    setBusy(true);
    try {
      const result = await api.getShoppingPlan({
        ...where,
        storeId: forMapStore && mapStore ? mapStore.id : undefined,
        budget,
        goals: allGoals,
        householdSize,
        days,
        allergens: prefs.allergens,
        pantryItems,
      });
      setPlan({ ...result, where });
      setPicked(new Set((result.list?.items ?? []).map((_, i) => i)));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function toggle(index) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  if (plan) {
    const { store, list } = plan;
    const items = list?.items ?? [];
    const chosen = items.filter((_, i) => picked.has(i));
    const chosenTotal = chosen.reduce((sum, item) => sum + (Number(item.estimatedPrice) || 0), 0);
    const groups = {};
    items.forEach((item, index) => {
      const key = CATEGORY_LABELS[item.category] ? item.category : 'other';
      (groups[key] ??= []).push({ item, index });
    });

    return (
      <Modal onClose={onClose} wide>
        <p className="eyebrow">YOUR SHOPPING LIST</p>
        <h2>{store ? titleCase(store.name) : 'No store found'}</h2>
        {store ? (
          <p className="plan-store">
            {[store.address, titleCase(store.city), store.state].filter(Boolean).join(', ')}
            {store.distanceMiles != null ? ` · ${store.distanceMiles} mi away` : ''}
          </p>
        ) : (
          <p className="form-note">No SNAP stores came back for that area. The list below assumes a typical supermarket.</p>
        )}
        {store?.hasIncentive && (
          <p className="plan-incentive">
            <Icon name="leaf" size={14} />
            <span>
              Produce incentive store{store.incentiveProgram ? ` (${store.incentiveProgram})` : ''}: fruits and
              vegetables bought with SNAP here can earn bonus dollars.
            </span>
          </p>
        )}

        {!list ? (
          <>
            <p className="form-error" style={{ marginTop: 16 }}>
              {plan.listError || 'Could not build the shopping list right now'}. The stores are still on the map.
            </p>
            <div className="plan-actions">
              <button className="primary-btn" onClick={submit} disabled={busy}>
                {busy ? 'Trying again...' : 'Try again'} <Icon name="chevron" size={17} />
              </button>
            </div>
          </>
        ) : (
          <>
            <div className={`plan-total ${list.overBudget ? 'over' : ''}`}>
              <div>
                <strong>{money(list.estimatedTotal)}</strong>
                <span>estimated of your {money(list.budget)} budget</span>
              </div>
              <em>{list.overBudget ? `${money(-list.remaining)} over` : `${money(list.remaining)} left`}</em>
            </div>

            {items.length === 0 && <p className="form-note">The list came back empty. Try a bigger budget or fewer limits.</p>}

            {CATEGORY_ORDER.filter((c) => groups[c]).map((category) => (
              <div key={category}>
                <p className="section-label">{CATEGORY_LABELS[category].toUpperCase()}</p>
                <ul className="recipe-detail-list plan-items">
                  {groups[category].map(({ item, index }) => (
                    <li key={index}>
                      <button
                        type="button"
                        className={`plan-check ${picked.has(index) ? 'on' : ''}`}
                        onClick={() => toggle(index)}
                        aria-pressed={picked.has(index)}
                        aria-label={`${picked.has(index) ? 'Leave out' : 'Include'} ${item.name}`}
                      >
                        <Icon name="check" size={13} />
                      </button>
                      <div className="plan-item-copy">
                        <strong>{item.name}</strong>
                        {item.reason && <small>{item.reason}</small>}
                      </div>
                      <span>
                        {amountText(item)}
                        <b>{money(item.estimatedPrice)}</b>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {list.goalNotes?.length > 0 && (
              <>
                <p className="section-label">HOW THIS FITS YOUR GOALS</p>
                <ul className="plan-notes">{list.goalNotes.map((note, i) => <li key={i}>{note}</li>)}</ul>
              </>
            )}
            {list.tips?.length > 0 && (
              <>
                <p className="section-label">TIPS</p>
                <ul className="plan-notes">{list.tips.map((tip, i) => <li key={i}>{tip}</li>)}</ul>
              </>
            )}

            <div className="plan-actions">
              <button
                className="primary-btn"
                disabled={chosen.length === 0}
                onClick={() => onAddItems(chosen.map((item) => planItemToListItem(item, store)))}
              >
                <Icon name="list" size={17} /> Put {chosen.length} {chosen.length === 1 ? 'item' : 'items'} on my list
                {chosen.length > 0 ? ` (${money(chosenTotal)})` : ''}
              </button>
            </div>
          </>
        )}

        <div className="list-actions plan-secondary">
          <button className="ghost-btn" onClick={() => setPlan(null)}>
            <Icon name="sliders" size={14} /> Change details
          </button>
          {store && (
            <button className="ghost-btn" onClick={() => onShowStore(store, plan.where)}>
              <Icon name="pin" size={14} /> See store on map
            </button>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose}>
      <span className="modal-icon"><Icon name="list" size={26} /></span>
      <p className="eyebrow">PLAN YOUR SHOP</p>
      <h2>Build my shopping list</h2>
      <p className="modal-intro">
        We find SNAP stores near you and build a healthy list that fits your budget, skipping what you already have.
      </p>
      <form onSubmit={submit}>
        {error && <p className="form-error">{error}</p>}

        <div className="chip-group">
          <span>Where you shop</span>
          <div className="plan-location">
            <button type="button" className={`ghost-btn ${coords && !zip.trim() ? 'active' : ''}`} onClick={locate} disabled={locating}>
              <Icon name="locate" size={14} />
              {locating ? 'Finding you...' : coords && !zip.trim() ? 'Using your location' : 'Use my location'}
            </button>
            <input
              value={zip}
              onChange={(e) => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
              placeholder="or a zip code"
              inputMode="numeric"
              aria-label="Zip code"
            />
          </div>
        </div>

        {mapStore && (
          <label className="checkbox-label plan-store-pick">
            <input type="checkbox" checked={forMapStore} onChange={(e) => setForMapStore(e.target.checked)} />
            Build it for {titleCase(mapStore.name)} (picked on the map)
          </label>
        )}

        <label>
          Budget for this trip <span className="range-value">${budget}</span>
          <input type="range" min="10" max="300" step="5" value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
        </label>

        <div className="form-row plan-row">
          <label>
            People eating
            <select value={householdSize} onChange={(e) => setHouseholdSize(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label>
            Food should last
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={3}>3 days</option>
              <option value={7}>1 week</option>
              <option value={14}>2 weeks</option>
            </select>
          </label>
        </div>

        <ChipGroup label="Goals" options={GOALS} value={goals} onChange={setGoals} />
        <label>
          Anything else? (optional)
          <input value={otherGoal} onChange={(e) => setOtherGoal(e.target.value)} placeholder="e.g. lower salt, quick lunches" />
        </label>

        {(prefs.allergens.length > 0 || pantryItems.length > 0) && (
          <p className="form-note" style={{ marginTop: 0, marginBottom: 14 }}>
            {[
              prefs.allergens.length > 0 && `Avoids your allergies: ${prefs.allergens.join(', ')}.`,
              pantryItems.length > 0 && `Skips ${pantryItems.length} ${pantryItems.length === 1 ? 'item' : 'items'} already in your pantry.`,
            ].filter(Boolean).join(' ')}
          </p>
        )}

        <button className="primary-btn" type="submit" disabled={busy || locating}>
          {busy ? 'Building your list...' : 'Build my list'} <Icon name="chevron" size={17} />
        </button>
        {busy && <p className="form-note">Finding stores and asking the AI for a list. This usually takes 5 to 20 seconds.</p>}
      </form>
    </Modal>
  );
}
