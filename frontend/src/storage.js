// Per-browser conveniences (signed-in username, preferences, notes, last recipes).
// Storage can be blocked (private mode), so every access is wrapped.
const PREFIX = 'ebtreats.';

export function load(key, fallback) {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    if (value === undefined || value === null || value === '') {
      window.localStorage.removeItem(PREFIX + key);
    } else {
      window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    }
  } catch {
    // storage unavailable: the app still works for this session
  }
}
