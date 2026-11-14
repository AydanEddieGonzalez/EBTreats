// EBTreats app shell, following the "EBT Grocery Shopping App" design:
// a top bar with a list/map switch, the grocery list + recipe card dashboard,
// the "Find stores" map, and a side drawer. All data is live from the backend
// (backend/api_call.js); a signed-out guest keeps their pantry in this browser.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import pluralize from 'pluralize';
import Icon from './Icon';
import StoreMap from './StoreMap';
import { AuthModal, PreferencesModal, ReceiptModal, RecipeModal, ShoppingPlanModal } from './Modals';
import * as api from './api';
import { load, save } from './storage';

const DEFAULT_PREFS = {
  budget: 50,
  time: 45,
  difficulty: 'Beginner',
  cuisines: [],
  appliances: ['Stove', 'Oven', 'Microwave'],
  allergens: [],
};
const THUMB_COLORS = ['#3f7f35', '#2578ad', '#ee9d32', '#8e5baf', '#5a9c85', '#c0603a'];

function words(name) {
  return String(name)
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)
    .map((w) => pluralize.singular(w));
}

const keyFor = (name) => words(name).join(' ');

// 'chicken' matches 'chicken breast': one name's words are all in the other's.
function sameItem(a, b) {
  const wa = words(a);
  const wb = new Set(words(b));
  if (!wa.length || !wb.size) return false;
  return wa.every((w) => wb.has(w)) || [...wb].every((w) => wa.includes(w));
}

function thumbColor(name) {
  let hash = 0;
  for (const ch of String(name)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return THUMB_COLORS[hash % THUMB_COLORS.length];
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

// Pantry items that expire within this many days get a "use this first" reminder.
const USE_FIRST_DAYS = 7;

function isTypingTarget(target) {
  return target instanceof Element
    && (target.closest('input, textarea, select, [contenteditable="true"]') || target.closest('.leaflet-container'));
}

function prefsFromUser(user, current) {
  const next = { ...current };
  if (typeof user.budget === 'number') next.budget = user.budget;
  if (typeof user.timeAvailable === 'number' && user.timeAvailable > 0) next.time = user.timeAvailable;
  if (Array.isArray(user.cuisinePreferences)) next.cuisines = user.cuisinePreferences;
  if (Array.isArray(user.appliances) && user.appliances.length) next.appliances = user.appliances;
  if (Array.isArray(user.dietaryRestrictions)) next.allergens = user.dietaryRestrictions;
  return next;
}

export default function App() {
  const [username, setUsername] = useState(() => load('user', ''));
  const [prefs, setPrefs] = useState(() => ({ ...DEFAULT_PREFS, ...load('prefs', {}) }));
  const [pantry, setPantry] = useState(() => (load('user', '') ? {} : load('guestPantry', {})));
  const [expiring, setExpiring] = useState([]);
  // When a guest added each pantry item ({ [name]: ISO date }); signed-in users have this on the server.
  const [guestAddedAt, setGuestAddedAt] = useState(() => load('guestAddedAt', {}));
  const [list, setList] = useState(() => load(`list.${load('user', '') || 'guest'}`, []));
  const [notes, setNotes] = useState(() => load(`notes.${load('user', '') || 'guest'}`, []));
  const [recipes, setRecipes] = useState(() => load('recipes', []));
  const [recipeIndex, setRecipeIndex] = useState(0);
  const [generating, setGenerating] = useState(false);
  // Set when the recipes came from the grocery list (meal prep): { shared: [...], unused: [...] }
  const [mealPlan, setMealPlan] = useState(() => load('mealPlan', null));

  const [view, setView] = useState('list');
  const [menuOpen, setMenuOpen] = useState(false);
  const [modal, setModal] = useState(null); // 'auth' | 'prefs' | 'receipt' | 'recipe' | 'plan'
  const [mapSearch, setMapSearch] = useState(null); // where the map last looked: { lat, lng, radius } or { zip }
  const [mapStore, setMapStore] = useState(null); // the store pin picked on the map
  const [mapFocus, setMapFocus] = useState(null); // { store, where }: show this store on the map
  const [recipeFront, setRecipeFront] = useState(false);
  const [noteDraft, setNoteDraft] = useState(null);
  const [toast, setToast] = useState(null);
  const touchStart = useRef(null);

  const owner = username || 'guest';
  const recipe = recipes[recipeIndex] ?? null;

  const notify = useCallback((message, kind = 'info') => setToast({ message, kind, at: Date.now() }), []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), toast.kind === 'error' ? 7000 : 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  // Persist per-browser state.
  useEffect(() => save('user', username), [username]);
  useEffect(() => save('prefs', prefs), [prefs]);
  useEffect(() => save('recipes', recipes), [recipes]);
  useEffect(() => save('mealPlan', mealPlan), [mealPlan]);
  useEffect(() => { if (!username) save('guestPantry', pantry); }, [pantry, username]);
  useEffect(() => save('guestAddedAt', guestAddedAt), [guestAddedAt]);
  useEffect(() => save(`list.${owner}`, list), [list, owner]);
  useEffect(() => save(`notes.${owner}`, notes), [notes, owner]);

  const refreshExpiring = useCallback((name) => {
    if (!name) return setExpiring([]);
    api.getExpiring(name, USE_FIRST_DAYS).then(setExpiring).catch(() => setExpiring([]));
  }, []);

  // Guests: work out "use this first" from the dates kept in this browser.
  useEffect(() => {
    if (username) return undefined;
    const items = Object.entries(pantry)
      .filter(([name, qty]) => qty > 0 && guestAddedAt[name])
      .map(([name, qty]) => ({ name, quantity: qty, addedAt: guestAddedAt[name] }));
    if (!items.length) {
      setExpiring([]);
      return undefined;
    }
    let cancelled = false;
    api.getExpiringFor(items, USE_FIRST_DAYS)
      .then((rows) => { if (!cancelled) setExpiring(rows); })
      .catch(() => { if (!cancelled) setExpiring([]); });
    return () => { cancelled = true; };
  }, [username, pantry, guestAddedAt]);

  const logOut = useCallback(() => {
    setUsername('');
    setPantry(load('guestPantry', {}));
    setList(load('list.guest', []));
    setNotes(load('notes.guest', []));
    setExpiring([]);
    setMenuOpen(false);
  }, []);

  // Load the signed-in user's pantry from the server.
  useEffect(() => {
    if (!username) return;
    api.getPantry(username)
      .then((items) => setPantry(items ?? {}))
      .catch((err) => {
        if (err.status === 404) {
          logOut();
          notify('Your account was not found. Please log in again.', 'error');
        } else {
          notify(err.message, 'error');
        }
      });
    refreshExpiring(username);
  }, [username, logOut, notify, refreshExpiring]);

  // Keyboard: Esc closes things; arrows switch views (not while typing or panning the map).
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        setModal(null);
        setRecipeFront(false);
      }
      if (modal || isTypingTarget(event.target)) return;
      if (event.key === 'ArrowRight') setView('map');
      if (event.key === 'ArrowLeft') setView('list');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal]);

  const finishSwipe = (event) => {
    if (touchStart.current === null) return;
    const delta = event.changedTouches[0].clientX - touchStart.current;
    if (delta < -55) setView('map');
    if (delta > 55) setView('list');
    touchStart.current = null;
  };

  // ---- pantry ---------------------------------------------------------------

  const pantryWordSets = useMemo(
    () => Object.entries(pantry).filter(([, qty]) => qty > 0).map(([name]) => words(name)).filter((w) => w.length),
    [pantry],
  );
  const hasItem = useCallback(
    (name) => {
      const have = new Set(words(name));
      return pantryWordSets.some((pw) => pw.every((w) => have.has(w)));
    },
    [pantryWordSets],
  );

  const changePantry = useCallback(async (changes) => {
    if (username) {
      try {
        const updated = await api.changePantry(username, changes);
        setPantry(updated ?? {});
        refreshExpiring(username);
      } catch (err) {
        notify(err.message, 'error');
        return false;
      }
    } else {
      setPantry((current) => {
        const next = { ...current };
        Object.entries(changes).forEach(([name, delta]) => {
          const qty = (next[name] ?? 0) + delta;
          if (qty > 0) next[name] = qty;
          else delete next[name];
        });
        return next;
      });
      // Remember when stock was added, so guests get "use this first" reminders too.
      const addedNow = Object.entries(changes).filter(([, delta]) => delta > 0).map(([name]) => name);
      if (addedNow.length) {
        const stamp = new Date().toISOString();
        setGuestAddedAt((current) => ({ ...current, ...Object.fromEntries(addedNow.map((name) => [name, stamp])) }));
      }
    }
    return true;
  }, [username, notify, refreshExpiring]);

  // ---- grocery list -----------------------------------------------------------

  const addToList = (items) => {
    setList((current) => {
      const seen = new Set(current.map((i) => keyFor(i.name)));
      const added = items.filter((i) => !seen.has(keyFor(i.name)) && seen.add(keyFor(i.name)));
      return [...current, ...added];
    });
  };

  function addPlanItems(items) {
    const seen = new Set(list.map((i) => keyFor(i.name)));
    const fresh = items.filter((i) => !seen.has(keyFor(i.name)));
    addToList(items);
    setModal(null);
    setView('list');
    const already = items.length - fresh.length;
    notify(`Added ${fresh.length} ${fresh.length === 1 ? 'item' : 'items'} to your list${already ? ` (${already} already there)` : ''}`);
  }

  function showStoreOnMap(store, where) {
    setModal(null);
    setMapFocus({ store, where, at: Date.now() });
    setView('map');
  }

  async function boughtItem(item) {
    const name = keyFor(item.name) || item.name.toLowerCase();
    if (await changePantry({ [name]: 1 })) {
      setList((current) => current.filter((i) => i !== item));
      notify(`${capitalize(item.name)} moved to your pantry`);
    }
  }

  async function usedItem(name) {
    if (await changePantry({ [name]: -(pantry[name] ?? 1) })) notify(`${capitalize(name)} removed from your pantry`);
  }

  function addNote(e) {
    e.preventDefault();
    const text = (noteDraft ?? '').trim();
    if (text) setNotes((current) => [...current, text]);
    setNoteDraft(null);
  }

  function promoteNote(index) {
    addToList([{ name: notes[index], detail: 'From your notes' }]);
    setNotes((current) => current.filter((_, i) => i !== index));
  }

  const expiringByName = useMemo(() => new Map(expiring.map((e) => [e.name, e.daysLeft])), [expiring]);
  const pantryRows = useMemo(
    () => Object.entries(pantry)
      .filter(([, qty]) => qty > 0)
      .map(([name, qty]) => ({ name, qty, daysLeft: expiringByName.get(name) }))
      .sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999) || a.name.localeCompare(b.name)),
    [pantry, expiringByName],
  );
  // The three pantry items to cook with first (pantryRows is sorted soonest first).
  const useFirst = pantryRows.filter((row) => row.daysLeft != null).slice(0, 3);

  // ---- recipes ----------------------------------------------------------------

  const recipeRequest = () => ({
    username,
    pantryItems: Object.keys(pantry),
    time: prefs.time,
    difficulty: prefs.difficulty,
    budget: prefs.budget,
    allergens: prefs.allergens,
    appliances: prefs.appliances,
    cuisines: prefs.cuisines,
  });

  async function generate() {
    setGenerating(true);
    try {
      const result = await api.generateRecipes(recipeRequest());
      if (!result.length) throw new Error('No recipes came back. Try again.');
      setRecipes(result);
      setRecipeIndex(0);
      setMealPlan(null);
      notify(`${result.length} new recipes ready`);
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setGenerating(false);
    }
  }

  // 2-3 meals cooked from the grocery list, sharing ingredients so nothing is bought for one meal.
  async function planMeals(names) {
    const shoppingList = [...new Set(names.map((n) => String(n).trim()).filter(Boolean))];
    if (shoppingList.length < 2) return notify('Add at least 2 items to your list first.', 'error');
    setGenerating(true);
    setView('list');
    try {
      const result = await api.generateMealPlan({ ...recipeRequest(), shoppingList });
      if (!result.recipes.length) throw new Error('No meals came back. Try again.');
      setRecipes(result.recipes);
      setRecipeIndex(0);
      setMealPlan({ shared: result.sharedIngredients, unused: result.unusedItems });
      setRecipeFront(true);
      const shared = result.sharedIngredients.length;
      notify(`${result.recipes.length} meals planned from your list${shared ? `, sharing ${shared} ${shared === 1 ? 'ingredient' : 'ingredients'}` : ''}`);
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setGenerating(false);
    }
  }

  function addAndPlanMeals(items) {
    addPlanItems(items);
    planMeals([...list.map((i) => i.name), ...items.map((i) => i.name)]);
  }

  const isListed = (name) => list.some((i) => sameItem(i.name, name));

  function addMissingFromRecipe(r) {
    const missing = r.ingredients
      .filter((ing) => !hasItem(ing.item) && !isListed(ing.item))
      .map((ing) => ({ name: ing.item, detail: [ing.amount, ing.unit].filter(Boolean).join(' '), source: r.name }));
    addToList(missing);
    setModal(null);
    setRecipeFront(false);
    notify(`Added ${missing.length} ${missing.length === 1 ? 'item' : 'items'} to your list`);
  }

  const match = recipe
    ? { have: recipe.ingredients.filter((ing) => hasItem(ing.item)).length, total: recipe.ingredients.length }
    : null;
  // Grocery-list items this meal shares with the other planned meals.
  const sharedHere = recipe && mealPlan
    ? mealPlan.shared.filter((s) => recipe.ingredients.some((ing) => sameItem(ing.item, s)))
    : [];

  // ---- account ----------------------------------------------------------------

  function onAuthed(user) {
    setUsername(user.username);
    setPrefs((current) => prefsFromUser(user, current));
    setPantry(user.ingredients ?? {});
    setList(load(`list.${user.username}`, []));
    setNotes(load(`notes.${user.username}`, []));
    setModal(null);
    notify(`Welcome, ${capitalize(user.username)}!`);
  }

  async function savePrefs(next) {
    setPrefs(next);
    setModal(null);
    if (username) {
      try {
        await api.savePreferences(username, next);
        notify('Preferences saved');
      } catch (err) {
        notify(`Saved on this device only: ${err.message}`, 'error');
      }
    } else {
      notify('Preferences saved on this device');
    }
  }

  async function addReceiptItems(items) {
    const changes = {};
    Object.entries(items).forEach(([name, qty]) => { changes[name.toLowerCase()] = qty; });
    if (await changePantry(changes)) {
      setModal(null);
      notify(`Added ${Object.keys(changes).length} items to your pantry`);
    }
  }

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
  const toBuyCount = list.length + notes.length;
  const openDrawerItem = (fn) => () => { setMenuOpen(false); fn(); };

  return (
    <div
      className="app-shell"
      onTouchStart={(e) => { touchStart.current = isTypingTarget(e.target) ? null : e.touches[0].clientX; }}
      onTouchEnd={finishSwipe}
    >
      <header className="topbar">
        <div className="topbar-left">
          <button className="icon-btn menu-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Icon name="menu" size={22} />
          </button>
          <button className="brand" onClick={() => setView('list')} aria-label="EBTreats home">
            <span className="brand-mark"><Icon name="leaf" size={17} /></span>
            EBTreats
          </button>
        </div>
        <div className="view-switch" aria-label="Select view">
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
            <Icon name="list" size={16} /> My list
          </button>
          <button className={view === 'map' ? 'active' : ''} onClick={() => setView('map')}>
            <Icon name="map" size={16} /> Find stores
          </button>
        </div>
        <div className="topbar-actions">
          <button className="benefit-pill" onClick={() => setModal('prefs')} title="Change your weekly budget">
            <Icon name="card" size={15} /> <strong>${prefs.budget}</strong>
            <span>weekly budget</span>
          </button>
          {username ? (
            <button className="avatar" onClick={() => setMenuOpen(true)} aria-label="Open account">
              {username.slice(0, 2).toUpperCase()}
            </button>
          ) : (
            <button className="login-btn" onClick={() => setModal('auth')}>Log in</button>
          )}
        </div>
      </header>

      <main className={`stage ${view}`}>
        <section className="map-view" aria-hidden={view !== 'map'}>
          <StoreMap
            active={view === 'map'}
            onSearch={setMapSearch}
            onSelectStore={setMapStore}
            onPlan={() => setModal('plan')}
            focus={mapFocus}
          />
        </section>

        <section className="dashboard" aria-hidden={view !== 'list'}>
          <div className="dashboard-heading">
            <div>
              <p className="eyebrow">{today}</p>
              <h1>{greeting()}{username ? `, ${capitalize(username)}` : ''}.</h1>
              <p>
                {toBuyCount > 0
                  ? <>You have <strong>{toBuyCount} {toBuyCount === 1 ? 'item' : 'items'}</strong> ready for your next shop.</>
                  : 'Build this week\'s list from recipes that use what you already have.'}
              </p>
            </div>
            <button className="swipe-hint" onClick={() => setView('map')}>
              <span>Find SNAP stores near you</span>
              <Icon name="chevron" size={16} />
            </button>
          </div>

          <div className="workspace">
            <article className={`grocery-sheet ${recipeFront ? 'behind' : ''}`}>
              <div className="sheet-head">
                <div>
                  <span className="list-kicker">MY GROCERY LIST</span>
                  <h2>For this week</h2>
                </div>
                <div className="sheet-meta">
                  <span><i className="dot buy" /> To buy</span>
                  <span><i className="dot have" /> Already have</span>
                </div>
              </div>

              {useFirst.length > 0 && (
                <div className="use-first" role="status">
                  <strong><Icon name="clock" size={14} /> Use this first</strong>
                  <span>
                    {useFirst.map((row) => `${capitalize(row.name)} (${row.daysLeft <= 0 ? 'today' : `${row.daysLeft} ${row.daysLeft === 1 ? 'day' : 'days'}`})`).join(', ')}
                  </span>
                </div>
              )}

              <div className="items">
                {list.length === 0 && pantryRows.length === 0 && (
                  <div className="list-empty">
                    <strong>Your list is empty</strong>
                    Scan a grocery receipt to fill your pantry, then pick a recipe.
                    Missing ingredients land here, so you only buy what you need.
                    <div className="list-actions" style={{ padding: 0 }}>
                      <button className="ghost-btn" onClick={() => setModal('plan')}><Icon name="list" size={14} /> Build my shopping list</button>
                      <button className="ghost-btn" onClick={() => setModal('receipt')}><Icon name="upload" size={14} /> Scan a receipt</button>
                      <button className="ghost-btn" onClick={generate} disabled={generating}><Icon name="sparkle" size={14} /> {generating ? 'Generating...' : 'Suggest recipes'}</button>
                    </div>
                  </div>
                )}

                {list.map((item) => (
                  <div className="grocery-item buy" key={`buy-${item.name}`}>
                    <div className="tag-dots"><i style={{ background: item.source ? '#ee9d32' : '#3f7f35' }} /></div>
                    <span className="item-thumb" style={{ background: thumbColor(item.name) }}>{item.name.charAt(0).toUpperCase()}</span>
                    <div className="item-copy">
                      <h3>{capitalize(item.name)}</h3>
                      <p>{item.detail || 'To buy'}</p>
                      {item.source ? <span>For {item.source}</span> : item.store ? <span>At {item.store}</span> : null}
                    </div>
                    <span className="have-label" />
                    <button className="score score-a" onClick={() => boughtItem(item)} aria-label={`I bought ${item.name}`} title="Bought it: move to pantry">
                      <Icon name="check" size={16} />
                    </button>
                  </div>
                ))}

                {pantryRows.map((row) => (
                  <div className="grocery-item have" key={`have-${row.name}`}>
                    <div className="tag-dots"><i style={{ background: row.daysLeft != null ? '#ee9d32' : '#aab1aa' }} /></div>
                    <span className="item-thumb" style={{ background: thumbColor(row.name) }}>{row.name.charAt(0).toUpperCase()}</span>
                    <div className="item-copy">
                      <h3>{capitalize(row.name)}</h3>
                      <p>{row.qty} in your pantry</p>
                      {row.daysLeft != null && (
                        <span>{row.daysLeft <= 0 ? 'Use today' : `Use within ${row.daysLeft} ${row.daysLeft === 1 ? 'day' : 'days'}`}</span>
                      )}
                    </div>
                    {row.daysLeft != null
                      ? <span className="use-soon"><Icon name="clock" size={13} /> Use soon</span>
                      : <span className="have-label"><Icon name="check" size={13} /> Have</span>}
                    <button className="score score-have" onClick={() => usedItem(row.name)} aria-label={`Used up ${row.name}`} title="Used it up: remove from pantry">
                      <Icon name="minus" size={16} />
                    </button>
                  </div>
                ))}
              </div>

              {(list.length > 0 || pantryRows.length > 0) && (
                <div className="list-actions">
                  <button className="ghost-btn" onClick={() => setModal('plan')}><Icon name="list" size={14} /> Build my shopping list</button>
                  <button className="ghost-btn" onClick={() => setModal('receipt')}><Icon name="upload" size={14} /> Scan a receipt</button>
                  {list.length > 1 && (
                    <button className="ghost-btn" onClick={() => planMeals(list.map((i) => i.name))} disabled={generating}>
                      <Icon name="sparkle" size={14} /> {generating ? 'Planning meals...' : 'Plan meals from my list'}
                    </button>
                  )}
                  {list.length > 0 && (
                    <button className="ghost-btn" onClick={() => setList([])}><Icon name="close" size={14} /> Clear to-buy items</button>
                  )}
                </div>
              )}

              <div className="notepad">
                <div className="notepad-title">
                  <span>QUICK NOTES</span>
                  <small>{notes.length ? 'Tap + to add to your list' : 'Jot anything down'}</small>
                </div>
                {notes.map((item, index) => (
                  <div className="note-row" key={`${item}-${index}`}>
                    <span>{index + 1}</span>
                    <p>{item}</p>
                    <button onClick={() => promoteNote(index)} aria-label={`Add ${item} to my list`}>
                      <Icon name="plus" size={15} />
                    </button>
                  </div>
                ))}
                {noteDraft !== null ? (
                  <form className="note-row" onSubmit={addNote}>
                    <span>{notes.length + 1}</span>
                    <input autoFocus value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} onBlur={() => { if (!noteDraft.trim()) setNoteDraft(null); }} placeholder="e.g. oat milk" />
                    <button type="submit" aria-label="Save note"><Icon name="check" size={15} /></button>
                  </form>
                ) : (
                  <button className="add-item" onClick={() => setNoteDraft('')}>
                    <Icon name="plus" size={16} /> Add an item
                  </button>
                )}
              </div>
            </article>

            <article className={`recipe-card ${recipeFront ? 'front' : ''}`} onClick={() => setRecipeFront(true)}>
              <div className="recipe-tab"><span>{recipe ? recipe.name : 'Recipes for you'}</span></div>
              <button
                className="recipe-mode"
                onClick={(e) => { e.stopPropagation(); generate(); }}
                disabled={generating}
                aria-label="Suggest new recipes"
                title="Suggest new recipes"
              >
                {recipe ? <Icon name="sparkle" size={21} /> : <span className="new-badge">!</span>}
              </button>
              <div className="recipe-image placeholder">
                <Icon name="leaf" size={64} />
                <span>
                  {!recipe ? 'COOK FROM WHAT YOU HAVE'
                    : mealPlan ? `MEAL ${recipeIndex + 1} OF ${recipes.length} · FROM YOUR LIST`
                      : `SUGGESTION ${recipeIndex + 1} OF ${recipes.length}`}
                </span>
              </div>
              <div className="recipe-content">
                {recipe ? (
                  <>
                    <p>{[recipe.cuisine, ...(recipe.tags ?? []).slice(0, 2)].filter(Boolean).join(' · ').toUpperCase() || 'SUGGESTED FOR YOU'}</p>
                    <h2>{recipe.name}</h2>
                    <div className="recipe-stats">
                      {recipe.time ? <span>{recipe.time} min</span> : null}
                      {recipe.time && recipe.budget ? <i /> : null}
                      {recipe.budget ? <span>About ${Number(recipe.budget).toFixed(2)}</span> : null}
                    </div>
                    <div className="ingredient-match">
                      <span><Icon name="leaf" size={14} /> {match.have} of {match.total} ingredients in your pantry</span>
                      <div><i style={{ width: `${match.total ? Math.round((match.have / match.total) * 100) : 0}%` }} /></div>
                    </div>
                    {sharedHere.length > 0 && (
                      <div className="meal-share">
                        <Icon name="list" size={13} /> Shares {sharedHere.slice(0, 3).join(', ')}{sharedHere.length > 3 ? '...' : ''} with your other meals
                      </div>
                    )}
                    <button className="recipe-cta" onClick={(e) => { e.stopPropagation(); setModal('recipe'); }}>
                      View recipe <Icon name="chevron" size={16} />
                    </button>
                  </>
                ) : (
                  <>
                    <p>PERSONALIZED · BUDGET FRIENDLY</p>
                    <h2>Meals from your pantry</h2>
                    <div className="recipe-blurb">
                      We suggest five meals that fit your ${prefs.budget} budget and {prefs.time} minutes,
                      using what you already have first.
                    </div>
                    <button className="recipe-cta" onClick={(e) => { e.stopPropagation(); generate(); }} disabled={generating}>
                      {generating ? 'Generating recipes...' : 'Suggest recipes'} <Icon name="chevron" size={16} />
                    </button>
                  </>
                )}
              </div>
              {recipes.length > 1 && (
                <button
                  className="next-recipe"
                  onClick={(e) => { e.stopPropagation(); setRecipeIndex((recipeIndex + 1) % recipes.length); }}
                  aria-label="Next recipe"
                >
                  <span />
                  <Icon name="chevron" size={22} />
                </button>
              )}
              {recipeFront && (
                <button className="send-back" onClick={(e) => { e.stopPropagation(); setRecipeFront(false); }}>
                  Back to list
                </button>
              )}
            </article>
          </div>
        </section>
      </main>

      <div className={`drawer-backdrop ${menuOpen ? 'show' : ''}`} onClick={() => setMenuOpen(false)} />
      <aside className={`side-drawer ${menuOpen ? 'open' : ''}`} aria-hidden={!menuOpen}>
        <div className="drawer-head">
          <span className="brand">
            <span className="brand-mark"><Icon name="leaf" size={17} /></span>
            EBTreats
          </span>
          <button className="icon-btn" onClick={() => setMenuOpen(false)} aria-label="Close menu">
            <Icon name="close" />
          </button>
        </div>
        <div className="profile-block">
          <div className="avatar large">{username ? username.slice(0, 2).toUpperCase() : <Icon name="user" size={20} />}</div>
          <div>
            <strong>{username ? capitalize(username) : 'Guest'}</strong>
            <span>{username ? 'Signed in' : 'Your pantry is saved on this device'}</span>
          </div>
        </div>
        <nav>
          <p>YOUR ACCOUNT</p>
          {username ? (
            <button onClick={logOut}>
              <Icon name="logout" /> Log out <Icon name="chevron" size={16} />
            </button>
          ) : (
            <button onClick={openDrawerItem(() => setModal('auth'))}>
              <Icon name="user" /> Log in or sign up <Icon name="chevron" size={16} />
            </button>
          )}
          <button onClick={openDrawerItem(() => setModal('prefs'))}>
            <Icon name="leaf" /> Dietary preferences
            {prefs.allergens.length > 0 && <span className="nav-tag">{prefs.allergens.length} allergies</span>}
            <Icon name="chevron" size={16} />
          </button>
          <button onClick={openDrawerItem(() => setModal('prefs'))}>
            <Icon name="sliders" /> Budget and cooking time <Icon name="chevron" size={16} />
          </button>
          <p>SHOPPING</p>
          <button onClick={openDrawerItem(() => setModal('plan'))}>
            <Icon name="list" /> Build my shopping list <Icon name="chevron" size={16} />
          </button>
          <button onClick={openDrawerItem(() => setModal('receipt'))}>
            <Icon name="upload" /> Scan a receipt <Icon name="chevron" size={16} />
          </button>
          <button onClick={openDrawerItem(() => setView('map'))}>
            <Icon name="pin" /> Find SNAP stores <Icon name="chevron" size={16} />
          </button>
          <button onClick={openDrawerItem(() => { setView('list'); generate(); })} disabled={generating}>
            <Icon name="sparkle" /> {generating ? 'Generating recipes...' : 'Suggest recipes'} <Icon name="chevron" size={16} />
          </button>
        </nav>
        <div className="drawer-foot">
          <span><Icon name="leaf" size={14} /> Store data from the USDA SNAP Retailer Locator</span>
        </div>
      </aside>

      {modal === 'auth' && <AuthModal onClose={() => setModal(null)} onAuthed={onAuthed} />}
      {modal === 'prefs' && <PreferencesModal prefs={prefs} onSave={savePrefs} onClose={() => setModal(null)} />}
      {modal === 'receipt' && <ReceiptModal onClose={() => setModal(null)} onAdd={addReceiptItems} />}
      {modal === 'plan' && (
        <ShoppingPlanModal
          prefs={prefs}
          pantryItems={pantryRows.map((row) => row.name)}
          mapSearch={mapSearch}
          mapStore={mapStore}
          onAddItems={addPlanItems}
          onPlanMeals={addAndPlanMeals}
          planning={generating}
          onShowStore={showStoreOnMap}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'recipe' && recipe && (
        <RecipeModal
          recipe={recipe}
          hasItem={hasItem}
          isListed={isListed}
          mealPlan={mealPlan && { ...mealPlan, sharedHere, count: recipes.length }}
          onClose={() => setModal(null)}
          onAddMissing={() => addMissingFromRecipe(recipe)}
        />
      )}

      {toast && (
        <div className={`toast ${toast.kind}`} role="status">
          {toast.message}
          <button onClick={() => setToast(null)} aria-label="Dismiss"><Icon name="close" size={14} /></button>
        </div>
      )}
    </div>
  );
}
