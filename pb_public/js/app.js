/**
 * Crew – Einstiegspunkt: Routing, Auth-Guard, Lebenszyklus der Ansichten.
 *
 * Der Guard ist nur Komfort. Die eigentliche Sicherheit liegt in den
 * API-Rules von PocketBase (siehe pb_migrations/).
 */

import { pb, me, isAuthed, statusOf, session } from "./pb.js";
import { startRouter, navigate } from "./router.js";
import { renderLogin, refreshSession, logout } from "./auth.js";
import { statusPage } from "./ui.js";
import { createShell } from "./shell.js";
import { openChannel } from "./messages.js";
import { openSettings } from "./settings.js";
import { openUsers } from "./users.js";
import "./prefs.js";
import { startRealtime, stopRealtime, onReconnect } from "./realtime.js";
import {
  loadChannels, findChannel, getChannels, setActiveChannel, refreshUnread,
  startUnreadTracking, stopUnreadTracking, resetChannels,
} from "./channels.js";

const root = document.getElementById("app");
const DEFAULT_CHANNEL = "team";
const REFRESH_INTERVAL = 60 * 60 * 1000;

let shell = null;
let view = null;
let shellPromise = null;
let routeToken = 0;
let lastRefresh = Date.now();

// ------------------------------------------------------------ Session

async function handleExpired() {
  if (!pb.authStore.token) return;
  await logout("Bitte melde dich neu an.");
}

// 401 von irgendeinem Request (oder 403 mit abgelaufenem Token) → neu anmelden.
pb.afterSend = (response, data) => {
  const isLogin = response.url.includes("/auth-with-password");
  if (!isLogin && !session.renewing && pb.authStore.token) {
    if (response.status === 401 || (response.status === 403 && !pb.authStore.isValid)) {
      queueMicrotask(handleExpired);
    }
  }
  return data;
};

// Abmelden (auch in einem anderen Tab) → zurück zur Login-Seite.
pb.authStore.onChange(() => {
  if (!isAuthed() && shell) {
    teardown();
    navigate("/login", { replace: true });
  }
});

// Token läuft ab, während die App offen ist.
window.setInterval(() => {
  if (pb.authStore.token && !pb.authStore.isValid) handleExpired();
}, 60 * 1000);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !isAuthed()) return;
  if (Date.now() - lastRefresh > REFRESH_INTERVAL) {
    lastRefresh = Date.now();
    refreshSession().then(() => { if (!isAuthed()) handleExpired(); });
  }
  if (shell) refreshUnread().catch(() => {});
});

// ----------------------------------------------------------- Ansichten

async function teardown() {
  const oldView = view;
  const oldShell = shell;
  view = null;
  shell = null;
  shellPromise = null;
  await oldView?.destroy();
  oldShell?.destroy();
  await stopUnreadTracking();
  await stopRealtime();
  resetChannels();
}

async function ensureShell() {
  if (shell) return shell;
  if (shellPromise) return shellPromise;
  shellPromise = (async () => {
    await loadChannels();
    const s = createShell();
    root.replaceChildren(s.root);
    shell = s;
    await startRealtime();
    onReconnect(() => refreshUnread().catch(() => {}));
    await startUnreadTracking();
    refreshUnread().catch(() => {});
    return s;
  })();
  try {
    return await shellPromise;
  } catch (err) {
    shellPromise = null;
    throw err;
  }
}

function showStatus(options) {
  root.replaceChildren(statusPage(options));
  document.title = `${options.title} · Crew.`;
  root.querySelector("main")?.focus();
}

async function showChannel(slug, token) {
  let s;
  try {
    s = await ensureShell();
  } catch (err) {
    if (token !== routeToken) return;
    if (statusOf(err) === 401) return handleExpired();
    await teardown();
    return showStatus({
      title: "Etwas ist schiefgelaufen.",
      text: "Die Kanäle konnten nicht geladen werden. Prüf deine Verbindung und versuch es erneut.",
    });
  }
  if (token !== routeToken) return;

  const channel = findChannel(slug);
  if (!channel) {
    const fallback = findChannel(DEFAULT_CHANNEL) || getChannels()[0];
    if (fallback && fallback.slug !== slug) {
      return navigate(`/channels/${fallback.slug}`, { replace: true });
    }
    return showStatus({ title: "Keine Kanäle.", text: "Es sind noch keine Kanäle eingerichtet." });
  }

  const hadFocusInMain = s.main.contains(document.activeElement);
  await view?.destroy();
  if (token !== routeToken) return;

  setActiveChannel(channel.id);
  s.setActive(channel.slug);
  view = openChannel({
    channel,
    container: s.main,
    menuButton: s.menuButton(),
    onAuthError: handleExpired,
  });
  if (!hadFocusInMain && !window.matchMedia("(pointer: coarse)").matches) view.focusComposer();
}

async function showSettings(token) {
  let s;
  try {
    s = await ensureShell();
  } catch (err) {
    if (token !== routeToken) return;
    if (statusOf(err) === 401) return handleExpired();
    await teardown();
    return showStatus({
      title: "Etwas ist schiefgelaufen.",
      text: "Die Einstellungen konnten nicht geladen werden. Prüf deine Verbindung und versuch es erneut.",
    });
  }
  if (token !== routeToken) return;
  await view?.destroy();
  if (token !== routeToken) return;

  setActiveChannel(null);
  s.setActive("settings");
  view = openSettings({
    container: s.main,
    menuButton: s.menuButton(),
    onAuthError: handleExpired,
    // Neues Token nach Passwortwechsel: Realtime mit neuer Berechtigung neu aufbauen.
    onSessionRenewed: async () => {
      await teardown();
      navigate("/settings", { replace: true });
    },
  });
}

async function showUsers(token) {
  if (me()?.role !== "admin") {
    return navigate(`/channels/${DEFAULT_CHANNEL}`, { replace: true });
  }
  let s;
  try {
    s = await ensureShell();
  } catch (err) {
    if (token !== routeToken) return;
    if (statusOf(err) === 401) return handleExpired();
    await teardown();
    return showStatus({
      title: "Etwas ist schiefgelaufen.",
      text: "Die Benutzer konnten nicht geladen werden. Prüf deine Verbindung und versuch es erneut.",
    });
  }
  if (token !== routeToken) return;
  await view?.destroy();
  if (token !== routeToken) return;

  setActiveChannel(null);
  s.setActive("users");
  view = openUsers({ container: s.main, menuButton: s.menuButton(), onAuthError: handleExpired });
}

// --------------------------------------------------------------- Routing

async function route(path) {
  const token = ++routeToken;

  if (path === "/login") {
    if (isAuthed()) return navigate(`/channels/${DEFAULT_CHANNEL}`, { replace: true });
    if (shell) await teardown();
    return renderLogin(root, () => navigate(`/channels/${DEFAULT_CHANNEL}`, { replace: true }));
  }

  if (!isAuthed()) {
    return navigate("/login", { replace: true });
  }

  if (path === "/" || path === "/channels") {
    return navigate(`/channels/${DEFAULT_CHANNEL}`, { replace: true });
  }

  if (path === "/settings") {
    return showSettings(token);
  }

  if (path === "/users") {
    return showUsers(token);
  }

  const match = path.match(/^\/channels\/([^/]+)$/);
  if (match) {
    let slug;
    try { slug = decodeURIComponent(match[1]); } catch (_) { slug = ""; }
    return showChannel(slug, token);
  }

  if (shell) await teardown();
  if (token !== routeToken) return;
  showStatus({
    title: "Seite nicht gefunden.",
    text: "Diese Adresse gibt es bei uns nicht. Vielleicht ein Tippfehler?",
  });
}

// Skip-Link: Fokus auf den Inhalt, ohne die URL zu ändern.
document.addEventListener("click", (event) => {
  const link = event.target.closest(".skip-link");
  if (!link) return;
  event.preventDefault();
  const main = document.getElementById("main");
  if (main) {
    main.focus();
    main.scrollIntoView({ block: "start" });
  }
});

// ------------------------------------------------------------------ Start

(async () => {
  if (pb.authStore.token) {
    await refreshSession();
    lastRefresh = Date.now();
  }
  startRouter(route);
})();
