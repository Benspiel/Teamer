/**
 * DOM-Helfer, Icons, Avatare, Toasts, Zeitformate, Links.
 * Nutzertext wird ausschließlich als Text-Node eingefügt – nie als HTML.
 */

import { pb, toDate } from "./pb.js";

// --------------------------------------------------------------------- DOM

/**
 * h("button", { class: "btn", onclick: fn, "aria-label": "…" }, "Text", childNode)
 * Strings werden als Text-Nodes eingefügt.
 */
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value);
    } else if (key in node && typeof value !== "string") {
      node[key] = value;
    } else {
      node.setAttribute(key, value === true ? "" : value);
    }
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

// ------------------------------------------------------------------- Icons
// Lucide (ISC-Lizenz), 24×24, Linien-Icons, Farbe über currentColor.

const ICONS = {
  "arrow-up": [["path", { d: "m5 12 7-7 7 7" }], ["path", { d: "M12 19V5" }]],
  menu: [
    ["line", { x1: 4, x2: 20, y1: 6, y2: 6 }],
    ["line", { x1: 4, x2: 20, y1: 12, y2: 12 }],
    ["line", { x1: 4, x2: 20, y1: 18, y2: 18 }],
  ],
  x: [["path", { d: "M18 6 6 18" }], ["path", { d: "m6 6 12 12" }]],
  pencil: [
    ["path", { d: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" }],
    ["path", { d: "m15 5 4 4" }],
  ],
  trash: [
    ["path", { d: "M3 6h18" }],
    ["path", { d: "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" }],
    ["path", { d: "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" }],
  ],
  eye: [
    ["path", { d: "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" }],
    ["circle", { cx: 12, cy: 12, r: 3 }],
  ],
  "eye-off": [
    ["path", { d: "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" }],
    ["path", { d: "M14.084 14.158a3 3 0 0 1-4.242-4.242" }],
    ["path", { d: "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" }],
    ["path", { d: "m2 2 20 20" }],
  ],
  alert: [
    ["circle", { cx: 12, cy: 12, r: 10 }],
    ["line", { x1: 12, x2: 12, y1: 8, y2: 12 }],
    ["line", { x1: 12, x2: 12.01, y1: 16, y2: 16 }],
  ],
  users: [
    ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" }],
    ["circle", { cx: 9, cy: 7, r: 4 }],
    ["path", { d: "M22 21v-2a4 4 0 0 0-3-3.87" }],
    ["path", { d: "M16 3.13a4 4 0 0 1 0 7.75" }],
  ],
  settings: [
    ["path", { d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" }],
    ["circle", { cx: 12, cy: 12, r: 3 }],
  ],
  "log-out": [
    ["path", { d: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" }],
    ["polyline", { points: "16 17 21 12 16 7" }],
    ["line", { x1: 21, x2: 9, y1: 12, y2: 12 }],
  ],
};

const SVG_NS = "http://www.w3.org/2000/svg";

export function icon(name, { small = false } = {}) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", small ? "icon icon--sm" : "icon");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const [tag, attrs] of ICONS[name] || []) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    svg.append(el);
  }
  return svg;
}

// ------------------------------------------------------------------ Avatar

export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = Array.from(parts[0])[0] || "";
  const last = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] || "" : "";
  return (first + last).toLocaleUpperCase("de-DE");
}

/** Kreis-Avatar: Bild (falls vorhanden) oder Initialen. Dekorativ (aria-hidden). */
export function avatar(user) {
  const node = h("span", { class: "avatar", "aria-hidden": "true" });
  if (user?.avatar) {
    const img = h("img", {
      src: pb.files.getURL(user, user.avatar, { thumb: "72x72" }),
      alt: "",
      loading: "lazy",
      decoding: "async",
    });
    img.addEventListener("error", () => img.replaceWith(initials(user?.name)), { once: true });
    node.append(img);
  } else {
    node.textContent = initials(user?.name);
  }
  return node;
}

// ------------------------------------------------------------------- Toast

export function toast(message, duration = 3000) {
  const host = document.getElementById("toasts");
  if (!host) return;
  const node = h("div", { class: "toast" }, message);
  host.append(node);
  window.setTimeout(() => node.remove(), duration);
}

// ------------------------------------------------------------------ Zeiten

const fmtTime = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const fmtFull = new Intl.DateTimeFormat("de-DE", { dateStyle: "full", timeStyle: "short" });
const fmtDay = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short" });
const fmtDayYear = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", year: "numeric" });
const fmtRel = new Intl.RelativeTimeFormat("de-DE", { numeric: "auto", style: "short" });

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export function dayKey(value) {
  const d = toDate(value);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function isSameDay(a, b) {
  return dayKey(a) === dayKey(b);
}

/** "Heute", "Gestern", "12. Okt." (bzw. mit Jahr, wenn nicht aktuelles Jahr). */
export function dayLabel(value) {
  const d = toDate(value);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (isSameDay(d, today)) return "Heute";
  if (isSameDay(d, yesterday)) return "Gestern";
  return d.getFullYear() === today.getFullYear() ? fmtDay.format(d) : fmtDayYear.format(d);
}

/** Relative Zeit für Nachrichten: "gerade eben", "vor 5 Min.", "vor 2 Std.", sonst Uhrzeit. */
export function relativeTime(value) {
  const d = toDate(value);
  const diff = Date.now() - d.getTime();
  if (diff < 45 * 1000) return "gerade eben";
  if (diff < HOUR) return fmtRel.format(-Math.round(diff / MINUTE), "minute");
  if (isSameDay(d, new Date())) return fmtRel.format(-Math.floor(diff / HOUR), "hour");
  return fmtTime.format(d);
}

export function fullDate(value) {
  return fmtFull.format(toDate(value));
}

/** <time> mit relativer Anzeige und exaktem Datum als Tooltip. */
export function timeEl(value, className) {
  const d = toDate(value);
  return h("time", {
    class: className,
    datetime: d.toISOString(),
    title: fullDate(value),
    dataset: { relative: value },
  }, relativeTime(value));
}

/** Aktualisiert alle relativen Zeitangaben unterhalb von root. */
export function refreshTimes(root = document) {
  for (const node of root.querySelectorAll("time[data-relative]")) {
    const text = relativeTime(node.dataset.relative);
    if (node.textContent !== text) node.textContent = text;
  }
}

// ------------------------------------------------------------------- Links

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const TRAILING = new Set([".", ",", ";", ":", "!", "?", ")", "]", "}", "'", '"', "»"]);

/** Satzzeichen am Ende abschneiden; ")" bleibt, wenn sie im Link geöffnet wurde. */
function trimTrailing(url) {
  const count = (s, c) => s.split(c).length - 1;
  while (url && TRAILING.has(url.at(-1))) {
    if (url.at(-1) === ")" && count(url, "(") >= count(url, ")")) break;
    url = url.slice(0, -1);
  }
  return url;
}

/** Text → Fragment mit klickbaren http(s)-Links. Alles andere bleibt Text. */
export function linkify(text) {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const url = trimTrailing(match[0]);
    if (!url) continue;
    const start = match.index;
    if (start > last) frag.append(text.slice(last, start));
    let safe = null;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") safe = parsed.href;
    } catch (_) {}
    if (safe) {
      frag.append(h("a", { href: safe, target: "_blank", rel: "noopener noreferrer nofollow" }, url));
    } else {
      frag.append(url);
    }
    last = start + url.length;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

// ---------------------------------------------------------- Status-Seiten

/** 404- und Fehlerseite im gleichen Design. */
export function statusPage({ title, text }) {
  return h("main", { id: "main", class: "status-page", tabindex: "-1" },
    h("div", { class: "status" },
      h("p", { class: "wordmark" }, "Crew."),
      h("h1", { class: "status__title" }, title),
      h("p", { class: "status__text" }, text),
      h("a", { class: "btn btn--primary", href: "/channels/team", "data-link": "" }, "Zurück zu team"),
    ),
  );
}
