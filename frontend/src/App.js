// EBTreats mobile app shell, following the "EBTreats Mobile Redesign" Figma file:
// bottom tabs (Home, List, Recipes, Stores, Chat), a welcome screen on first visit,
// and the existing modals for login, preferences, receipts, recipes and shopping plans. All data is live from the backend
// (backend/api_call.js); a signed-out guest keeps their pantry in this browser.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import pluralize from 'pluralize';
import Icon from './Icon';
import StoreMap from './StoreMap';
import { AuthModal, PreferencesModal, ReceiptModal, RecipeModal, ShoppingPlanModal } from './Modals';
import * as api from './api';
import { load, save } from './storage';
import './mobile.css';

const DEFAULT_PREFS = {
  budget: 50,
  time: 45,
  difficulty: 'Beginner',
  cuisines: [],
  appliances: ['Stove', 'Oven', 'Microwave'],
  allergens: [],
};
const TABS = [
  ['home', 'Home', 'home'],
  ['list', 'List', 'list'],
  ['recipes', 'Recipes', 'recipes'],
  ['stores', 'Stores', 'map'],
  ['chat', 'Chat', 'chat'],
];
const LIST_CATEGORIES = {
  produce: 'Produce',
  protein: 'Protein',
  dairy: 'Dairy',
  grains: 'Grains',
  frozen: 'Frozen',
  pantry: 'Pantry',
  other: 'Other',
};
const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
// The price shows on the right, so drop "about $x" from a planned item's detail line.
const listDetail = (item) => (Number(item.price) > 0 ? String(item.detail ?? '').replace(/\s*·?\s*about \$[\d.]+/, '') : item.detail);

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

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

// Pantry items that expire within this many days get a "use this first" reminder.
const USE_FIRST_DAYS = 7;

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

  const [view, setView] = useState('home'); // 'home' | 'list' | 'recipes' | 'stores' | 'chat'
  const [menuOpen, setMenuOpen] = useState(false);
  const [modal, setModal] = useState(null); // 'auth' | 'prefs' | 'receipt' | 'recipe' | 'plan'
  const [mapSearch, setMapSearch] = useState(null); // where the map last looked: { lat, lng, radius } or { zip }
  const [mapStore, setMapStore] = useState(null); // the store pin picked on the map
  const [mapFocus, setMapFocus] = useState(null); // { store, where }: show this store on the map
  const [toast, setToast] = useState(null);
  const [listTab, setListTab] = useState('buy'); // 'buy' | 'have'
  const [addDraft, setAddDraft] = useState('');
  const [chat, setChat] = useState([]); // goal chat: [{ role, text, error? }]
  const [chatDraft, setChatDraft] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [goals, setGoals] = useState(() => load('goals', []));
  const [welcomed, setWelcomed] = useState(() => Boolean(load('user', '')) || load('welcomed', false));
  const mainRef = useRef(null);

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
  useEffect(() => save('goals', goals), [goals]);
  useEffect(() => save('welcomed', welcomed || ''), [welcomed]);

  // Signed-in users keep their goals on their profile.
  useEffect(() => {
    if (!username) return;
    api.getGoals(username).then((saved) => { if (saved.length) setGoals(saved); }).catch(() => {});
  }, [username]);

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

  // Keyboard: Esc closes the drawer and modals.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        setModal(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
    setView('stores');
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
  const daysText = (d) => (d <= 0 ? 'today' : `${d} ${d === 1 ? 'day' : 'days'}`);

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
    setView('recipes');
    try {
      const result = await api.generateMealPlan({ ...recipeRequest(), shoppingList });
      if (!result.recipes.length) throw new Error('No meals came back. Try again.');
      setRecipes(result.recipes);
      setRecipeIndex(0);
      setMealPlan({ shared: result.sharedIngredients, unused: result.unusedItems });
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
    notify(`Added ${missing.length} ${missing.length === 1 ? 'item' : 'items'} to your list`);
  }

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
    setWelcomed(true);
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

  const listTotal = list.reduce((sum, i) => sum + (Number(i.price) || 0), 0);
  const pricedCount = list.filter((i) => Number(i.price) > 0).length;
  const budget = Number(prefs.budget) || 0;
  const budgetLeft = budget - listTotal;
  const budgetPct = budget ? Math.min(100, Math.round((listTotal / budget) * 100)) : 0;
  const todayLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase();
  const openDrawerItem = (fn) => () => { setMenuOpen(false); fn(); };
  const matchFor = (r) => {
    const ings = r?.ingredients ?? [];
    return { have: ings.filter((ing) => hasItem(ing.item)).length, total: ings.length };
  };
  const openRecipe = (index) => { setRecipeIndex(index); setModal('recipe'); };

  function goTab(next) {
    setView(next);
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }

  function submitAddItem(e) {
    e.preventDefault();
    const name = addDraft.trim();
    if (!name) return;
    if (isListed(name)) notify(`${capitalize(name)} is already on your list`);
    else addToList([{ name, detail: 'Added by you' }]);
    setAddDraft('');
  }

  const removeFromList = (item) => setList((current) => current.filter((i) => i !== item));

  async function sendChat(text) {
    const message = String(text ?? '').trim();
    if (!message || chatBusy) return;
    const next = [...chat, { role: 'user', text: message }];
    setChat(next);
    setChatDraft('');
    setChatBusy(true);
    try {
      const res = await api.goalChat({
        username: username || undefined,
        messages: next.filter((m) => !m.error).map(({ role, text: t }) => ({ role, text: t })),
        goals: username ? undefined : goals,
      });
      setChat([...next, { role: 'assistant', text: res.reply || 'Got it.' }]);
      if (Array.isArray(res.goals)) setGoals(res.goals);
    } catch (err) {
      setChat([...next, { role: 'assistant', text: `Sorry, I couldn't answer that: ${err.message}`, error: true }]);
    } finally {
      setChatBusy(false);
    }
  }

  // Grocery list grouped by aisle when the items carry a category (from a shopping plan).
  const listGroups = useMemo(() => {
    const groups = new Map();
    list.forEach((item) => {
      const key = LIST_CATEGORIES[item.category] ? item.category : 'other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    return Object.keys(LIST_CATEGORIES).filter((k) => groups.has(k)).map((k) => [k, groups.get(k)]);
  }, [list]);
  const showGroupLabels = listGroups.length > 1 || (listGroups[0] && listGroups[0][0] !== 'other');

  const authModal = modal === 'auth' && <AuthModal onClose={() => setModal(null)} onAuthed={onAuthed} />;

  // ---- first visit ---------------------------------------------------------
  if (!welcomed && !username) {
    return (
      <div className="m-app">
        <main className="m-screen m-welcome">
          <div className="m-brand">
            <span className="m-brand-mark"><Icon name="leaf" size={20} /></span>
            EBTreats
          </div>
          <div className="m-welcome-hero" aria-hidden="true">
            <div className="m-row m-row-demo">
              <span className="m-check on"><Icon name="check" size={14} /></span>
              <div className="m-row-text"><strong className="done">Spinach</strong><small>For green enchiladas</small></div>
              <b>$1.29</b>
            </div>
            <div className="m-row m-row-demo">
              <span className="m-check" />
              <div className="m-row-text"><strong>Black beans</strong><small>For bean tacos</small></div>
              <b>$0.99</b>
            </div>
            <div className="m-row m-row-demo">
              <span className="m-check pantry"><Icon name="leaf" size={13} /></span>
              <div className="m-row-text"><strong>Eggs</strong><small>Already in your pantry</small></div>
              <b className="muted">$0.00</b>
            </div>
            <span className="m-pill amber"><Icon name="sparkle" size={14} /> Only buy what you need</span>
          </div>
          <h1 className="m-display">Stretch your EBT further, and eat better.</h1>
          <p className="m-lead">Plan healthy meals from what you already have, find SNAP stores nearby, and only buy what you need.</p>
          <div className="m-welcome-actions">
            <button className="m-btn primary" onClick={() => setModal('auth')}>Create free account</button>
            <button className="m-btn secondary" onClick={() => setModal('auth')}>Log in</button>
            <button className="m-btn ghost" onClick={() => setWelcomed(true)}>Continue as guest</button>
          </div>
        </main>
        {authModal}
      </div>
    );
  }

  // ---- screens -------------------------------------------------------------
  const homeScreen = (
    <div className="m-page">
      <header className="m-head">
        <div>
          <p className="m-eyebrow">{todayLabel}</p>
          <h1 className="m-title">{greeting()}{username ? `, ${capitalize(username)}` : ''}.</h1>
        </div>
        <button className="m-avatar" onClick={() => setMenuOpen(true)} aria-label="Open account">
          {username ? username.slice(0, 2).toUpperCase() : <Icon name="user" size={18} />}
        </button>
      </header>

      <section className={`m-budget ${budgetLeft < 0 ? 'over' : ''}`}>
        <div className="m-budget-top">
          <Icon name="card" size={18} />
          <span>Weekly SNAP budget</span>
          <button onClick={() => setModal('prefs')}>Edit</button>
        </div>
        <div className="m-budget-amount">
          <strong>{money(Math.abs(budgetLeft))}</strong>
          <span>{budgetLeft < 0 ? 'over' : 'left'} of {money(budget)}</span>
        </div>
        <div className="m-meter"><i style={{ width: `${budgetPct}%` }} /></div>
        <p>{pricedCount ? `Your list is about ${money(listTotal)} so far` : 'Build a list to see how it fits your budget'}</p>
      </section>

      <div className="m-quick">
        <button onClick={() => setModal('receipt')}>
          <span className="m-icon-tile"><Icon name="camera" size={20} /></span>
          <strong>Scan receipt</strong><small>Fill your pantry</small>
        </button>
        <button onClick={() => goTab('chat')}>
          <span className="m-icon-tile"><Icon name="sparkle" size={20} /></span>
          <strong>Plan with chat</strong><small>Goals to list</small>
        </button>
        <button onClick={() => goTab('stores')}>
          <span className="m-icon-tile"><Icon name="map" size={20} /></span>
          <strong>Find stores</strong><small>SNAP nearby</small>
        </button>
      </div>

      {useFirst.length > 0 && (
        <button className="m-soon" role="status" onClick={() => { goTab('recipes'); if (!recipes.length) generate(); }}>
          <Icon name="clock" size={22} />
          <div>
            <strong>Use this first: {useFirst.map((row) => capitalize(row.name)).join(', ')}</strong>
            <small>{useFirst.map((row) => `${capitalize(row.name)} in ${daysText(row.daysLeft)}`).join(' · ')}</small>
          </div>
          <Icon name="chevron" size={20} />
        </button>
      )}

      <div className="m-section-head">
        <h2>Recipes for you</h2>
        {recipes.length > 0 && <button onClick={() => goTab('recipes')}>See all</button>}
      </div>
      {recipes.length > 0 ? (
        <div className="m-carousel">
          {recipes.map((r, i) => (
            <RecipeCard key={`${r.name}-${i}`} recipe={r} match={matchFor(r)} onOpen={() => openRecipe(i)} />
          ))}
        </div>
      ) : (
        <EmptyRecipes generating={generating} onGenerate={generate} budget={prefs.budget} time={prefs.time} />
      )}
    </div>
  );

  const listScreen = (
    <div className="m-page">
      <header className="m-head">
        <h1 className="m-title">This week&apos;s list</h1>
        <button className="m-icon-btn" onClick={() => setModal('plan')} aria-label="Build my shopping list" title="Build my shopping list">
          <Icon name="sparkle" size={20} />
        </button>
      </header>
      <div className="m-seg" role="tablist" aria-label="List view">
        <button role="tab" aria-selected={listTab === 'buy'} className={listTab === 'buy' ? 'on' : ''} onClick={() => setListTab('buy')}>
          To buy <i>{list.length}</i>
        </button>
        <button role="tab" aria-selected={listTab === 'have'} className={listTab === 'have' ? 'on' : ''} onClick={() => setListTab('have')}>
          In pantry <i>{pantryRows.length}</i>
        </button>
      </div>

      {listTab === 'buy' ? (
        <>
          <form className="m-add" onSubmit={submitAddItem}>
            <Icon name="plus" size={20} />
            <input value={addDraft} onChange={(e) => setAddDraft(e.target.value)} placeholder="Add an item…" aria-label="Add an item" />
            {addDraft.trim() && <button type="submit">Add</button>}
          </form>
          {list.length === 0 ? (
            <div className="m-empty">
              <strong>Your list is empty</strong>
              <p>Scan a receipt to fill your pantry, then pick a recipe. Missing ingredients land here, so you only buy what you need.</p>
              <div className="m-actions">
                <button className="m-btn primary" onClick={() => setModal('plan')}><Icon name="list" size={16} /> Build my shopping list</button>
                <button className="m-btn secondary" onClick={() => goTab('chat')}><Icon name="sparkle" size={16} /> Plan with chat</button>
              </div>
            </div>
          ) : (
            listGroups.map(([key, items]) => (
              <div className="m-group" key={key}>
                {showGroupLabels && <p className="m-eyebrow">{LIST_CATEGORIES[key].toUpperCase()}</p>}
                <div className="m-rows">
                  {items.map((item) => (
                    <div className="m-row" key={`buy-${item.name}`}>
                      <button className="m-check" onClick={() => boughtItem(item)} aria-label={`I bought ${item.name}`} title="Bought it: move to pantry">
                        <Icon name="check" size={14} />
                      </button>
                      <div className="m-row-text">
                        <strong>{capitalize(item.name)}</strong>
                        <small>{[listDetail(item), item.source ? `for ${item.source}` : item.store ? `at ${item.store}` : null].filter(Boolean).join(' · ')}</small>
                      </div>
                      {Number(item.price) > 0 && <b>{money(item.price)}</b>}
                      <button className="m-row-x" onClick={() => removeFromList(item)} aria-label={`Remove ${item.name}`}>
                        <Icon name="close" size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
          {list.length > 0 && (
            <div className="m-actions">
              {list.length > 1 && (
                <button className="m-btn secondary" onClick={() => planMeals(list.map((i) => i.name))} disabled={generating}>
                  <Icon name="sparkle" size={16} /> {generating ? 'Planning meals…' : 'Plan meals from my list'}
                </button>
              )}
              <button className="m-btn ghost" onClick={() => setList([])}><Icon name="close" size={16} /> Clear list</button>
            </div>
          )}
        </>
      ) : (
        <>
          {useFirst.length > 0 && (
            <div className="m-pill amber m-use-first" role="status">
              <Icon name="clock" size={13} /> Use this first: {useFirst.map((row) => `${capitalize(row.name)} (${daysText(row.daysLeft)})`).join(', ')}
            </div>
          )}
          {pantryRows.length === 0 ? (
            <div className="m-empty">
              <strong>Your pantry is empty</strong>
              <p>Scan a grocery receipt, or check items off your list as you buy them.</p>
            </div>
          ) : (
            <div className="m-rows">
              {pantryRows.map((row) => (
                <div className="m-row" key={`have-${row.name}`}>
                  <span className="m-check pantry"><Icon name="leaf" size={13} /></span>
                  <div className="m-row-text">
                    <strong>{capitalize(row.name)}</strong>
                    <small>{row.qty} in your pantry</small>
                  </div>
                  {row.daysLeft != null && (
                    <span className="m-pill amber small">
                      <Icon name="clock" size={12} /> {row.daysLeft <= 0 ? 'Use today' : `${row.daysLeft}d left`}
                    </span>
                  )}
                  <button className="m-row-x" onClick={() => usedItem(row.name)} aria-label={`Used up ${row.name}`} title="Used it up">
                    <Icon name="minus" size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="m-actions">
            <button className="m-btn secondary" onClick={() => setModal('receipt')}><Icon name="camera" size={16} /> Scan a receipt</button>
          </div>
        </>
      )}
    </div>
  );

  const recipesScreen = (
    <div className="m-page">
      <header className="m-head">
        <div>
          <h1 className="m-title">Recipes</h1>
          <p className="m-sub">Picked from your pantry, budget and goals</p>
        </div>
        <button className="m-icon-btn" onClick={generate} disabled={generating} aria-label="Suggest new recipes" title="Suggest new recipes">
          <Icon name="sparkle" size={20} />
        </button>
      </header>
      <button className="m-promo" onClick={() => goTab('chat')}>
        <span className="m-icon-tile dark"><Icon name="sparkle" size={20} /></span>
        <div><strong>Plan 3 meals that share ingredients</strong><small>Fewer items, less waste. Takes a minute.</small></div>
        <Icon name="chevron" size={20} />
      </button>
      {mealPlan && recipes.length > 0 && (
        <p className="m-note">
          <Icon name="list" size={14} /> Meals from your list
          {mealPlan.shared?.length ? `, sharing ${mealPlan.shared.slice(0, 3).join(', ')}` : ''}
        </p>
      )}
      {generating && <p className="m-note"><Icon name="sparkle" size={14} /> Cooking up recipes… this takes a few seconds.</p>}
      {recipes.length > 0 ? (
        <div className="m-stack">
          {recipes.map((r, i) => (
            <RecipeCard key={`${r.name}-${i}`} recipe={r} match={matchFor(r)} onOpen={() => openRecipe(i)} wide />
          ))}
        </div>
      ) : (
        !generating && <EmptyRecipes generating={generating} onGenerate={generate} budget={prefs.budget} time={prefs.time} />
      )}
    </div>
  );

  const chatScreen = (
    <div className="m-page m-chat">
      <header className="m-head">
        <div>
          <h1 className="m-title">Plan with EBTreats</h1>
          <p className="m-sub">Tell me your goals. I&apos;ll build the list.</p>
        </div>
        <button className="m-icon-btn" onClick={() => setChat([])} aria-label="New chat" title="New chat">
          <Icon name="plus" size={20} />
        </button>
      </header>
      <div className="m-bubble">
        Hi{username ? ` ${capitalize(username)}` : ''}! What are you aiming for this week? I&apos;ll keep it within your {money(budget)} budget.
      </div>
      {chat.map((m, i) => (
        <div key={i} className={`m-bubble ${m.role === 'user' ? 'me' : ''} ${m.error ? 'error' : ''}`}>{m.text}</div>
      ))}
      {chatBusy && <div className="m-bubble typing" aria-label="EBTreats is typing"><i /><i /><i /></div>}
      {goals.length > 0 && (
        <div className="m-goals">
          <p className="m-eyebrow">YOUR GOALS</p>
          <div className="m-chip-row">{goals.map((g) => <span key={g} className="m-chip on">{g}</span>)}</div>
          <button className="m-btn primary" onClick={() => setModal('plan')}><Icon name="list" size={16} /> Build my shopping list</button>
        </div>
      )}
      {chat.length === 0 && !chatBusy && (
        <div className="m-chip-row">
          {['More protein', 'Less sugar', 'Kid friendly', 'Eat more vegetables'].map((q) => (
            <button key={q} className="m-chip" onClick={() => sendChat(q)}>{q}</button>
          ))}
        </div>
      )}
    </div>
  );

  const screens = { home: homeScreen, list: listScreen, recipes: recipesScreen, chat: chatScreen };

  return (
    <div className="m-app">
      <main className={`m-screen ${view === 'stores' ? 'hide' : ''}`} ref={mainRef}>
        {screens[view]}
      </main>

      <section className={`m-stores ${view === 'stores' ? 'show' : ''}`} aria-hidden={view !== 'stores'}>
        <StoreMap
          active={view === 'stores'}
          onSearch={setMapSearch}
          onSelectStore={setMapStore}
          onPlan={() => setModal('plan')}
          focus={mapFocus}
        />
      </section>

      {view === 'list' && listTab === 'buy' && list.length > 0 && (
        <div className="m-summary">
          <div>
            <strong>{pricedCount ? `Est. ${money(listTotal)}` : `${list.length} ${list.length === 1 ? 'item' : 'items'}`}</strong>
            <small className={budgetLeft < 0 ? 'over' : ''}>
              {pricedCount ? (budgetLeft < 0 ? `${money(-budgetLeft)} over budget` : `Fits your budget · ${money(budgetLeft)} left`) : 'Prices show up for planned items'}
            </small>
          </div>
          <button className="m-btn primary" onClick={() => setModal('plan')}>Cheapest store</button>
        </div>
      )}

      {view === 'chat' && (
        <form className="m-composer" onSubmit={(e) => { e.preventDefault(); sendChat(chatDraft); }}>
          <input value={chatDraft} onChange={(e) => setChatDraft(e.target.value)} placeholder="Ask about meals, budget, goals…" aria-label="Message" />
          <button type="submit" disabled={!chatDraft.trim() || chatBusy} aria-label="Send"><Icon name="send" size={20} /></button>
        </form>
      )}

      <nav className="m-tabbar" aria-label="Main">
        {TABS.map(([id, label, icon]) => (
          <button key={id} className={view === id ? 'on' : ''} onClick={() => goTab(id)} aria-current={view === id ? 'page' : undefined}>
            <span>
              <Icon name={icon} size={22} />
              {id === 'list' && list.length > 0 && <em>{list.length}</em>}
            </span>
            {label}
          </button>
        ))}
      </nav>

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
        </nav>
        <div className="drawer-foot">
          <span><Icon name="leaf" size={14} /> Store data from the USDA SNAP Retailer Locator</span>
        </div>
      </aside>

      {authModal}
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
          initialGoals={goals}
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

function RecipeCard({ recipe, match, onOpen, wide = false }) {
  const meta = [
    recipe.time ? `${recipe.time} min` : null,
    recipe.budget ? `about ${money(recipe.budget)}` : null,
  ].filter(Boolean).join(' · ');
  return (
    <button className={`m-recipe ${wide ? 'wide' : ''}`} onClick={onOpen}>
      <div className="m-recipe-img">
        <Icon name="recipes" size={44} />
        {match.total > 0 && (
          <span className="m-pill amber"><Icon name="leaf" size={13} /> Uses {match.have} of {match.total} you have</span>
        )}
      </div>
      <div className="m-recipe-body">
        <h3>{recipe.name}</h3>
        {meta && <p><Icon name="clock" size={15} /> {meta}</p>}
      </div>
    </button>
  );
}

function EmptyRecipes({ generating, onGenerate, budget, time }) {
  return (
    <div className="m-empty">
      <strong>Meals from your pantry</strong>
      <p>We suggest meals that fit your ${budget} budget and {time} minutes, using what you already have first.</p>
      <div className="m-actions">
        <button className="m-btn primary" onClick={onGenerate} disabled={generating}>
          <Icon name="sparkle" size={16} /> {generating ? 'Generating recipes…' : 'Suggest recipes'}
        </button>
      </div>
    </div>
  );
}
