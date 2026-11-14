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
