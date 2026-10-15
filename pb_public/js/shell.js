/**
 * Geschützter Bereich: Sidebar (Wortmarke, Kanäle, Nutzer) + Inhaltsfläche.
 * Auf schmalen Screens ist die Sidebar ein Off-Canvas-Menü.
 */

import { pb, me } from "./pb.js";
import { h, icon, avatar } from "./ui.js";
import { getChannels, hasUnread, onUnreadChange } from "./channels.js";
import { logout } from "./auth.js";

const MOBILE = window.matchMedia("(max-width: 767px)");

export function createShell() {
  const channelLinks = new Map(); // slug -> { link, dot }
  let activeSlug = null;
  let lastFocus = null;

  // ------------------------------------------------------------ Sidebar
  const closeButton = h("button", {
    class: "btn btn--soft btn--icon sidebar__close",
    type: "button",
    "aria-label": "Menü schließen",
  }, icon("x"));

  const list = h("ul", { class: "channel-list" });
  for (const channel of getChannels()) {
    const dot = h("span", { class: "unread-dot", hidden: true, "aria-hidden": "true" });
    const link = h("a", {
      class: "channel-link",
      href: `/channels/${encodeURIComponent(channel.slug)}`,
      "data-link": "",
    },
      h("span", { class: "channel-link__hash", "aria-hidden": "true" }, "#"),
      h("span", { class: "channel-link__name" }, channel.slug),
      dot,
    );
    channelLinks.set(channel.slug, { link, dot, channel });
    list.append(h("li", {}, link));
  }

  // Weitere Bereiche unter den Kanälen.
  const AREAS = [
    ["damages", "/autoschaden", "Autoschaden", "car"],
    ["orders", "/bestellen", "Bestellen", "bag"],
  ];
  const areaLinks = new Map();
  const areaList = h("ul", { class: "channel-list", "aria-label": "Bereiche" });
  for (const [key, href, label, iconName] of AREAS) {
    const link = h("a", { class: "channel-link", href, "data-link": "" },
      h("span", { class: "channel-link__hash", "aria-hidden": "true" }, icon(iconName, { small: true })),
      h("span", { class: "channel-link__name" }, label),
    );
    areaLinks.set(key, link);
    areaList.append(h("li", {}, link));
  }

  const userArea = h("div", { class: "sidebar__user" });

  const sidebar = h("nav", { id: "sidebar", class: "sidebar", "aria-label": "Kanäle" },
    h("div", { class: "sidebar__brand" },
      h("span", { class: "wordmark" }, "Crew."),
      closeButton,
    ),
    h("div", { class: "sidebar__nav" }, list, areaList),
    userArea,
  );

  const scrim = h("div", { class: "scrim", "aria-hidden": "true" });
  const main = h("main", { id: "main", class: "main", tabindex: "-1" });
  const root = h("div", { class: "shell" }, sidebar, scrim, main);

  // --------------------------------------------------------- Nutzerbereich
  // Avatar + Name führen zu den Einstellungen (Profil, Passwort, Darstellung …).
  let settingsLink = null;
  let usersLink = null;

  function renderUser() {
    const user = me();
    if (!user) return;
    const current = settingsLink?.getAttribute("aria-current");
    const usersCurrent = usersLink?.getAttribute("aria-current");

    // Nur für Admins: Benutzerverwaltung. Rechte prüft trotzdem der Server.
    usersLink = null;
    if (user.role === "admin") {
      usersLink = h("a", { class: "channel-link", href: "/users", "data-link": "" },
        h("span", { class: "channel-link__hash", "aria-hidden": "true" }, icon("users", { small: true })),
        h("span", { class: "channel-link__name" }, "Benutzer"),
      );
      if (usersCurrent) usersLink.setAttribute("aria-current", usersCurrent);
      usersLink.addEventListener("click", () => closeNav({ restoreFocus: false }));
    }
    settingsLink = h("a", {
      class: "sidebar__me",
      href: "/settings",
      "data-link": "",
      title: "Einstellungen",
      "aria-label": `Einstellungen, angemeldet als ${user.name || "Unbenannt"}`,
    },
      avatar(user),
      h("span", { class: "sidebar__user-name" }, user.name || "Unbenannt"),
      icon("settings", { small: true }),
    );
    if (current) settingsLink.setAttribute("aria-current", current);
    settingsLink.addEventListener("click", () => closeNav({ restoreFocus: false }));

    const logoutButton = h("button", { class: "btn btn--soft btn--block", type: "button" }, "Abmelden");
    logoutButton.addEventListener("click", () => logout());

    userArea.replaceChildren(...[usersLink, settingsLink, logoutButton].filter(Boolean));
  }

  // Name/Profilbild geändert (auch in einem anderen Tab) → Sidebar aktualisieren.
  const offAuth = pb.authStore.onChange(() => renderUser());

  renderUser();

  // ----------------------------------------------------------- Ungelesen
  function renderUnread() {
    for (const { dot, channel, link } of channelLinks.values()) {
      const show = hasUnread(channel.id) && channel.slug !== activeSlug;
      dot.hidden = !show;
      link.setAttribute("aria-label", show ? `#${channel.slug}, neue Nachrichten` : `#${channel.slug}`);
    }
  }
  const offUnread = onUnreadChange(renderUnread);

  // ------------------------------------------------------- Off-Canvas-Menü
  function syncInert() {
    const open = root.classList.contains("is-nav-open");
    if (MOBILE.matches) {
      sidebar.inert = !open;
      main.inert = open;
    } else {
      sidebar.inert = false;
      main.inert = false;
    }
  }

  function openNav() {
    lastFocus = document.activeElement;
    root.classList.add("is-nav-open");
    syncInert();
    // Erst nach dem nächsten Frame ist die Sidebar sichtbar und fokussierbar.
    window.requestAnimationFrame(() => {
      const current = sidebar.querySelector('[aria-current="page"]') || sidebar.querySelector("a");
      current?.focus();
    });
    for (const btn of main.querySelectorAll(".menu-button")) btn.setAttribute("aria-expanded", "true");
  }

  function closeNav({ restoreFocus = true } = {}) {
    if (!root.classList.contains("is-nav-open")) return;
    root.classList.remove("is-nav-open");
    syncInert();
    for (const btn of main.querySelectorAll(".menu-button")) btn.setAttribute("aria-expanded", "false");
    if (restoreFocus && lastFocus?.isConnected) lastFocus.focus();
  }

  closeButton.addEventListener("click", () => closeNav());
  scrim.addEventListener("click", () => closeNav());
  const onKeydown = (event) => {
    if (event.key === "Escape" && root.classList.contains("is-nav-open")) {
      event.stopPropagation();
      closeNav();
    }
  };
  document.addEventListener("keydown", onKeydown);
  for (const nav of [list, areaList]) {
    nav.addEventListener("click", (event) => {
      if (event.target.closest("a")) closeNav({ restoreFocus: false });
    });
  }
  const onMediaChange = () => {
    if (!MOBILE.matches) root.classList.remove("is-nav-open");
    syncInert();
  };
  MOBILE.addEventListener("change", onMediaChange);
  syncInert();

  /** Menü-Button (Pille) für die Kopfzeile des Inhaltsbereichs. */
  function menuButton() {
    const btn = h("button", {
      class: "btn btn--soft btn--icon menu-button",
      type: "button",
      "aria-label": "Menü öffnen",
      "aria-controls": "sidebar",
      "aria-expanded": "false",
    }, icon("menu"));
    btn.addEventListener("click", openNav);
    return btn;
  }

  /** slug eines Kanals oder "settings", "users", "damages", "orders". */
  function setActive(slug) {
    activeSlug = slug;
    for (const [link, key] of [[settingsLink, "settings"], [usersLink, "users"], ...[...areaLinks].map(([k, l]) => [l, k])]) {
      if (!link) continue;
      if (slug === key) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    for (const [s, { link }] of channelLinks) {
      if (s === slug) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    renderUnread();
  }

  function destroy() {
    offUnread();
    offAuth();
    document.removeEventListener("keydown", onKeydown);
    MOBILE.removeEventListener("change", onMediaChange);
    root.remove();
  }

  return { root, main, setActive, menuButton, renderUser, destroy };
}
