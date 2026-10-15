/**
 * Geschützter Bereich: Sidebar (Wortmarke, Kanäle, Nutzer) + Inhaltsfläche.
 * Auf schmalen Screens ist die Sidebar ein Off-Canvas-Menü.
 */

import { pb, me, statusOf } from "./pb.js";
import { h, icon, avatar, toast } from "./ui.js";
import { getChannels, hasUnread, onUnreadChange } from "./channels.js";
import { logout } from "./auth.js";

const MOBILE = window.matchMedia("(max-width: 767px)");
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

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

  const userArea = h("div", { class: "sidebar__user" });

  const sidebar = h("nav", { id: "sidebar", class: "sidebar", "aria-label": "Kanäle" },
    h("div", { class: "sidebar__brand" },
      h("span", { class: "wordmark" }, "Crew."),
      closeButton,
    ),
    list,
    userArea,
  );

  const scrim = h("div", { class: "scrim", "aria-hidden": "true" });
  const main = h("main", { id: "main", class: "main", tabindex: "-1" });
  const root = h("div", { class: "shell" }, sidebar, scrim, main);

  // --------------------------------------------------------- Nutzerbereich
  const fileInput = h("input", {
    type: "file",
    accept: AVATAR_TYPES.join(","),
    hidden: true,
    tabindex: "-1",
  });

  function renderUser() {
    const user = me();
    if (!user) return;
    const avatarButton = h("button", {
      class: "avatar-button",
      type: "button",
      title: "Profilbild ändern",
      "aria-label": "Profilbild ändern",
    }, avatar(user));
    avatarButton.addEventListener("click", () => fileInput.click());

    const logoutButton = h("button", { class: "btn btn--soft btn--block", type: "button" }, "Abmelden");
    logoutButton.addEventListener("click", () => logout());

    userArea.replaceChildren(
      h("div", { class: "sidebar__me" },
        avatarButton,
        h("span", { class: "sidebar__user-name", title: user.name }, user.name || "Unbenannt"),
      ),
      logoutButton,
      fileInput,
    );
  }

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    const user = me();
    if (!file || !user) return;
    if (!AVATAR_TYPES.includes(file.type)) return toast("Bitte wähle ein JPG, PNG, WebP oder GIF.");
    if (file.size > MAX_AVATAR_BYTES) return toast("Das Bild darf höchstens 2 MB groß sein.");
    const button = userArea.querySelector(".avatar-button");
    button?.setAttribute("aria-busy", "true");
    try {
      const data = new FormData();
      data.append("avatar", file);
      await pb.collection("users").update(user.id, data);
      renderUser();
      toast("Profilbild aktualisiert.");
    } catch (err) {
      button?.removeAttribute("aria-busy");
      toast(statusOf(err) === 0 ? "Keine Verbindung. Bitte versuch es erneut." : "Das Bild konnte nicht gespeichert werden.");
    }
  });

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
  list.addEventListener("click", (event) => {
    if (event.target.closest("a")) closeNav({ restoreFocus: false });
  });
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

  function setActive(slug) {
    activeSlug = slug;
    for (const [s, { link }] of channelLinks) {
      if (s === slug) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    renderUnread();
  }

  function destroy() {
    offUnread();
    document.removeEventListener("keydown", onKeydown);
    MOBILE.removeEventListener("change", onMediaChange);
    root.remove();
  }

  return { root, main, setActive, menuButton, renderUser, destroy };
}
