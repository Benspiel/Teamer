/**
 * Persönliche Einstellungen, die nur dieses Gerät betreffen
 * (Darstellung, Enter-Verhalten, Benachrichtigungen). Gespeichert im
 * localStorage; ohne Speicher gelten einfach die Standardwerte.
 */

const KEY = "crew.prefs";

const DEFAULTS = {
  theme: "light", // "light" | "dark" | "system"
  enterToSend: true, // false: Strg/⌘ + Enter sendet
  notify: false, // Desktop-Benachrichtigungen
};

const listeners = new Set();
let cache = null;

function read() {
  if (cache) return cache;
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(KEY) || "{}") || {};
  } catch (_) {}
  cache = { ...DEFAULTS, ...stored };
  return cache;
}

export function getPrefs() {
  return { ...read() };
}

export function setPref(key, value) {
  const next = { ...read(), [key]: value };
  cache = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (_) {}
  if (key === "theme") applyTheme(value);
  for (const fn of listeners) fn(next, key);
}

export function onPrefsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const DARK = window.matchMedia("(prefers-color-scheme: dark)");

/** Setzt data-theme auf <html> und passt die Browser-Leiste an. */
export function applyTheme(theme = read().theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  const dark = theme === "dark" || (theme === "system" && DARK.matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#141414" : "#ffffff");
  const scheme = document.querySelector('meta[name="color-scheme"]');
  if (scheme) scheme.setAttribute("content", dark ? "dark" : "light");
}

DARK.addEventListener("change", () => {
  if (read().theme === "system") applyTheme("system");
});

// Andere Tabs halten die Einstellungen synchron.
window.addEventListener("storage", (event) => {
  if (event.key !== KEY) return;
  cache = null;
  applyTheme();
  const next = read();
  for (const fn of listeners) fn(next, null);
});

applyTheme();
