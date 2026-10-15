/**
 * Gemeinsame Bausteine für Formular-Seiten (Autoschaden, Bestellen):
 * Felder mit Fehlertext, segmentierte Auswahl, Nachfrage-Button, Seitengerüst.
 */

import { pb, statusOf } from "./pb.js";
import { h, icon, toast } from "./ui.js";

let counter = 0;
const CONFIRM_TIMEOUT = 4000;

export function setError(input, node, text) {
  if (text) {
    input.setAttribute("aria-invalid", "true");
    node.replaceChildren(icon("alert"), h("span", {}, text));
    node.hidden = false;
  } else {
    input.removeAttribute("aria-invalid");
    node.hidden = true;
    node.replaceChildren();
  }
}

/** Beschriftetes Eingabefeld (input oder textarea) mit Fehler- und Hinweiszeile. */
export function field({ label, multiline = false, hint, ...attrs }) {
  const id = `form-field-${++counter}`;
  const input = h(multiline ? "textarea" : "input", {
    id,
    class: "input",
    ...(multiline ? { rows: 3 } : { type: "text" }),
    autocomplete: "off",
    ...attrs,
    "aria-describedby": `${id}-error${hint ? ` ${id}-hint` : ""}`,
  });
  const error = h("p", { id: `${id}-error`, class: "field-error", hidden: true });
  const wrap = h("div", { class: "field" },
    h("label", { class: "field__label", for: id }, label),
    input,
    hint ? h("p", { id: `${id}-hint`, class: "field__hint" }, hint) : null,
    error,
  );
  input.addEventListener("input", () => setError(input, error, null));
  return { wrap, input, error, fail: (text) => setError(input, error, text) };
}

/** Segmentierte Auswahl als Radiogruppe (Pfeiltasten wechseln). */
export function segmented({ label, options, value, onChange, small = false }) {
  const id = `form-seg-${++counter}`;
  let current = value;
  const buttons = options.map(([v, text]) => {
    const b = h("button", {
      class: "segmented__option",
      type: "button",
      role: "radio",
      "aria-checked": String(v === current),
      tabindex: v === current ? "0" : "-1",
      dataset: { value: v },
    }, text);
    b.addEventListener("click", () => set(v, true));
    return b;
  });
  const group = h("div", {
    class: small ? "segmented segmented--sm" : "segmented",
    role: "radiogroup",
    "aria-labelledby": id,
  }, buttons);

  function set(v, fromUser) {
    current = v;
    for (const b of buttons) {
      const on = b.dataset.value === v;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && fromUser) b.focus();
    }
    if (fromUser) onChange?.(v);
  }

  group.addEventListener("keydown", (event) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const i = options.findIndex(([v]) => v === current);
    set(options[(i + step + options.length) % options.length][0], true);
  });

  const wrap = h("div", { class: "field" },
    h("span", { id, class: small ? "visually-hidden" : "field__label" }, label),
    group,
  );
  return { wrap, get value() { return current; }, set: (v) => set(v, false) };
}

/** Button mit Rückfrage: erster Klick fragt, zweiter führt aus. */
export function confirmButton(label, confirmLabel, action, { variant = "btn--soft" } = {}) {
  const b = h("button", { class: `btn ${variant} btn--sm`, type: "button" }, label);
  let armed = 0;
  const reset = () => {
    armed = 0;
    if (!b.isConnected) return;
    b.textContent = label;
    b.classList.remove("btn--primary");
    b.classList.add(variant);
  };
  b.addEventListener("click", async () => {
    if (!armed) {
      b.textContent = confirmLabel;
      b.classList.remove(variant);
      b.classList.add("btn--primary");
      armed = window.setTimeout(reset, CONFIRM_TIMEOUT);
      return;
    }
    window.clearTimeout(armed);
    armed = 0;
    b.disabled = true;
    b.setAttribute("aria-busy", "true");
    try {
      await action();
    } finally {
      if (b.isConnected) {
        b.disabled = false;
        b.removeAttribute("aria-busy");
        reset();
      }
    }
  });
  return b;
}

/** Einfacher Aktions-Button mit Ladezustand. */
export function actionButton(label, action, variant = "btn--soft") {
  const b = h("button", { class: `btn ${variant} btn--sm`, type: "button" }, label);
  b.addEventListener("click", async () => {
    b.disabled = true;
    b.setAttribute("aria-busy", "true");
    try {
      await action();
    } finally {
      if (b.isConnected) {
        b.disabled = false;
        b.removeAttribute("aria-busy");
      }
    }
  });
  return b;
}

/** Karte mit Überschrift (wie in den Einstellungen). */
export function section(title, description, ...content) {
  const id = `form-section-${++counter}`;
  const desc = h("p", { class: "settings-section__desc" }, description || "");
  desc.hidden = !description;
  const el = h("section", { class: "settings-section", "aria-labelledby": id },
    h("div", { class: "settings-section__head" },
      h("h2", { id, class: "settings-section__title" }, title),
      desc,
    ),
    ...content,
  );
  return { el, desc };
}

/** Kopfzeile + scrollender Inhalt im Hauptbereich. */
export function renderPage({ container, menuButton, title, description, docTitle, content }) {
  const header = h("header", { class: "channel-header" },
    menuButton,
    h("div", { class: "channel-header__text" },
      h("h1", { class: "channel-header__title" }, title),
      h("p", { class: "channel-header__desc" }, description),
    ),
  );
  container.replaceChildren(header,
    h("div", { class: "scroller" }, h("div", { class: "scroller__inner" },
      h("div", { class: "settings" }, ...content))));
  document.title = `${docTitle} · Crew.`;
}

/** Fehler → freundlicher Toast; 401 → neu anmelden. */
export function errorHandler(onAuthError) {
  return (err, fallback) => {
    const status = statusOf(err);
    if (status === 401) return onAuthError();
    if (status === 429) return toast("Zu viele Anfragen. Bitte warte kurz.");
    toast(status === 0 ? "Keine Verbindung. Bitte versuch es erneut." : fallback);
  };
}

/**
 * Live-Updates für eine Collection: ruft `reload` gebündelt auf.
 * Gibt eine Funktion zum Abbestellen zurück.
 */
export function liveReload(collection, reload) {
  let timer = 0;
  let unsubscribe = null;
  let stopped = false;
  pb.collection(collection).subscribe("*", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(reload, 150);
  }).then((fn) => {
    if (stopped) fn();
    else unsubscribe = fn;
  }).catch(() => {});
  return async () => {
    stopped = true;
    window.clearTimeout(timer);
    try { await unsubscribe?.(); } catch (_) {}
  };
}
