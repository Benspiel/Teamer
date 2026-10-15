/**
 * Kanal-Ansicht: Kopfzeile, Nachrichtenliste, Composer.
 *
 * - Neueste unten, Auto-Scroll nur wenn man schon unten war.
 * - Gruppierung: gleicher Autor, gleicher Tag, < 5 Minuten Abstand.
 * - Ältere Nachrichten per Cursor (created < älteste geladene), 50 pro Seite.
 * - Live-Updates über ein gefiltertes Realtime-Abo pro Kanal.
 */

import { pb, me, toDate, statusOf } from "./pb.js";
import { h, icon, avatar, timeEl, fullDate, refreshTimes, dayLabel, dayKey, isSameDay, linkify, toast } from "./ui.js";
import { subscribeMessages, onReconnect, onConnectionStatus } from "./realtime.js";
import { markRead } from "./channels.js";
import { verifySession } from "./auth.js";

const PAGE_SIZE = 50;
const MAX_LENGTH = 4000;
const COUNTER_FROM = 3500;
const GROUP_WINDOW = 5 * 60 * 1000;
const BOTTOM_THRESHOLD = 80;
const LONG_PRESS = 500;
const EXPAND = "author";

const byCreated = (a, b) =>
  a.created < b.created ? -1 : a.created > b.created ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * Erzeugt die Ansicht für einen Kanal und hängt sie in `container`.
 * Gibt { destroy } zurück.
 */
export function openChannel({ channel, container, menuButton, onAuthError }) {
  const user = me();
  const isAdmin = user?.role === "admin";

  const messages = new Map(); // id -> record
  const nodes = new Map(); // id -> { li, record, ... }
  const dayNodes = new Map(); // dayKey -> li
  let hasMore = false;
  let loadingOlder = false;
  let loaded = false;
  let destroyed = false;
  let unsubscribe = null;
  let activeMenu = null; // Nachricht mit geöffneten Aktionen (Long-Press)

  // -------------------------------------------------------------- Gerüst
  const header = h("header", { class: "channel-header" },
    menuButton,
    h("div", { class: "channel-header__text" },
      h("h1", { class: "channel-header__title", id: "channel-title" },
        h("span", { class: "channel-link__hash", "aria-hidden": "true" }, "#"),
        channel.title || channel.slug,
      ),
      channel.description
        ? h("p", { class: "channel-header__desc" }, channel.description)
        : null,
    ),
  );

  const olderButton = h("button", { class: "btn btn--soft btn--sm", type: "button" }, "Ältere laden");
  const olderRow = h("div", { class: "load-older", hidden: true }, olderButton);

  const list = h("ol", {
    class: "messages",
    "aria-live": "polite",
    "aria-relevant": "additions",
    "aria-busy": "true",
    "aria-labelledby": "channel-title",
  });

  const empty = h("div", { class: "empty", hidden: true },
    h("p", {}, "Noch keine Nachrichten."),
    h("p", {}, "Schreib die erste."),
  );
  const loading = h("div", { class: "loading", role: "status" }, "Nachrichten werden geladen …");

  const inner = h("div", { class: "scroller__inner" }, olderRow, loading, empty, list);
  const scroller = h("div", { class: "scroller" }, inner);

  const banner = h("p", { class: "conn-banner", role: "status", hidden: true },
    "Verbindung getrennt. Versuche neu zu verbinden …");

  // ------------------------------------------------------------ Composer
  const input = h("textarea", {
    id: "composer-input",
    class: "composer__input",
    rows: 1,
    maxlength: MAX_LENGTH,
    placeholder: `Nachricht an #${channel.slug}`,
    autocomplete: "off",
    "aria-describedby": "composer-meta",
  });
  const sendButton = h("button", {
    class: "composer__send",
    type: "submit",
    disabled: true,
    "aria-label": "Senden",
  }, icon("arrow-up"));
  const box = h("div", { class: "composer__box" }, input, sendButton);
  const meta = h("p", { id: "composer-meta", class: "composer__meta", hidden: true });
  const composer = h("form", { class: "composer", "aria-label": "Nachricht schreiben" },
    h("label", { class: "visually-hidden", for: "composer-input" }, `Nachricht an #${channel.slug}`),
    box,
    meta,
  );

  container.replaceChildren(header, scroller, banner, composer);
  document.title = `#${channel.slug} · Crew.`;

  // ------------------------------------------------------------- Helfer
  const isAtBottom = () =>
    scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < BOTTOM_THRESHOLD;
  const scrollToBottom = () => { scroller.scrollTop = scroller.scrollHeight; };

  function sorted() {
    return Array.from(messages.values()).sort(byCreated);
  }

  function newest() {
    let latest = null;
    for (const m of messages.values()) if (!latest || byCreated(m, latest) > 0) latest = m;
    return latest;
  }

  function oldest() {
    let first = null;
    for (const m of messages.values()) if (!first || byCreated(m, first) < 0) first = m;
    return first;
  }

  async function handleError(err, fallback) {
    const status = statusOf(err);
    if (status === 401) return onAuthError();
    // 400/403/404 können auch ein serverseitig entzogenes Token bedeuten.
    if ([400, 403, 404].includes(status) && !(await verifySession())) return;
    toast(status === 0 ? "Keine Verbindung. Bitte versuch es erneut." : fallback);
  }

  function markLatestRead() {
    if (document.visibilityState !== "visible") return;
    const latest = newest();
    if (latest) markRead(channel.id, latest.created);
  }

  // ------------------------------------------------------- Nachricht-DOM
  function canEdit(record) {
    return record.author === user?.id;
  }

  function canDelete(record) {
    return record.author === user?.id || isAdmin;
  }

  function isEdited(record) {
    return toDate(record.updated) - toDate(record.created) > 1000;
  }

  function authorOf(record) {
    return record.expand?.author || { name: "Unbekannt" };
  }

  function buildBody(record) {
    const body = h("div", { class: "msg__body" }, linkify(record.body || ""));
    if (isEdited(record)) {
      body.append(h("span", { class: "msg__edited", title: `Bearbeitet: ${fullDate(record.updated)}` }, "(bearbeitet)"));
    }
    return body;
  }

  function buildActions(entry) {
    const { record } = entry;
    const actions = h("div", { class: "msg__actions" });
    const editAllowed = canEdit(record);
    const deleteAllowed = canDelete(record);
    if (!editAllowed && !deleteAllowed) return null;

    const renderDefault = () => {
      const buttons = [];
      if (editAllowed) {
        buttons.push(h("button", {
          class: "action",
          type: "button",
          "aria-label": "Nachricht bearbeiten",
          title: "Bearbeiten",
          onclick: () => startEdit(entry),
        }, icon("pencil", { small: true })));
      }
      if (deleteAllowed) {
        buttons.push(h("button", {
          class: "action",
          type: "button",
          "aria-label": "Nachricht löschen",
          title: "Löschen",
          onclick: () => renderConfirm(),
        }, icon("trash", { small: true })));
      }
      actions.replaceChildren(...buttons);
    };

    const renderConfirm = () => {
      const cancel = h("button", {
        class: "action",
        type: "button",
        onclick: () => { renderDefault(); actions.querySelector("button")?.focus(); },
      }, "Abbrechen");
      const confirm = h("button", {
        class: "action action--confirm",
        type: "button",
        onclick: () => remove(entry),
      }, "Löschen");
      actions.replaceChildren(h("span", { class: "action__label" }, "Löschen?"), cancel, confirm);
      cancel.focus();
    };

    actions.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && actions.querySelector(".action--confirm")) {
        event.stopPropagation();
        renderDefault();
        actions.querySelector("button")?.focus();
      }
    });

    entry.resetActions = renderDefault;
    renderDefault();
    return actions;
  }

  function createEntry(record) {
    const entry = { record, editing: false };
    const li = h("li", { class: "msg", dataset: { id: record.id } });
    entry.li = li;
    renderEntry(entry);
    attachLongPress(entry);
    return entry;
  }

  function renderEntry(entry) {
    const { record, li } = entry;
    const author = authorOf(record);
    const gutter = h("div", { class: "msg__gutter" }, avatar(author));
    const metaRow = h("div", { class: "msg__meta" },
      h("span", { class: "msg__author" }, author.name || "Unbekannt"),
      timeEl(record.created, "msg__time"),
    );
    const mainCol = h("div", { class: "msg__main" }, metaRow);
    if (entry.editing) mainCol.append(entry.editForm);
    else mainCol.append(buildBody(record));
    const actions = buildActions(entry);
    li.replaceChildren(...[gutter, mainCol, actions].filter(Boolean));
  }

  function attachLongPress(entry) {
    let timer = 0;
    let startX = 0;
    let startY = 0;
    const { li } = entry;
    li.addEventListener("touchstart", (event) => {
      if (!canEdit(entry.record) && !canDelete(entry.record)) return;
      if (event.target.closest("a, button, textarea")) return;
      const t = event.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      timer = window.setTimeout(() => {
        openMenu(entry);
        if (navigator.vibrate) navigator.vibrate(10);
      }, LONG_PRESS);
    }, { passive: true });
    li.addEventListener("touchmove", (event) => {
      const t = event.touches[0];
      if (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) window.clearTimeout(timer);
    }, { passive: true });
    li.addEventListener("touchend", () => window.clearTimeout(timer));
    li.addEventListener("touchcancel", () => window.clearTimeout(timer));
    li.addEventListener("contextmenu", (event) => {
      if (activeMenu === entry && event.target.closest(".msg")) event.preventDefault();
    });
  }

  function openMenu(entry) {
    closeMenu();
    activeMenu = entry;
    entry.li.classList.add("is-active");
  }

  function closeMenu() {
    if (!activeMenu) return;
    activeMenu.li.classList.remove("is-active");
    activeMenu.resetActions?.();
    activeMenu = null;
  }

  const onDocPointer = (event) => {
    if (activeMenu && !activeMenu.li.contains(event.target)) closeMenu();
  };
  document.addEventListener("pointerdown", onDocPointer);

  // ------------------------------------------------------------ Rendern
  function dayNode(created) {
    const key = dayKey(created);
    let li = dayNodes.get(key);
    const label = dayLabel(created);
    if (!li) {
      li = h("li", { class: "day", role: "separator", "aria-label": label },
        h("span", { class: "day__label", "aria-hidden": "true" }, label));
      dayNodes.set(key, li);
    } else if (li.getAttribute("aria-label") !== label) {
      li.setAttribute("aria-label", label);
      li.firstChild.textContent = label;
    }
    return li;
  }

  /** Bringt die Liste mit minimalen DOM-Bewegungen in die richtige Reihenfolge. */
  function render() {
    const desired = [];
    let prev = null;
    for (const record of sorted()) {
      if (!prev || !isSameDay(prev.created, record.created)) desired.push(dayNode(record.created));
      let entry = nodes.get(record.id);
      if (!entry) {
        entry = createEntry(record);
        nodes.set(record.id, entry);
      }
      const grouped = !!prev
        && prev.author === record.author
        && isSameDay(prev.created, record.created)
        && toDate(record.created) - toDate(prev.created) < GROUP_WINDOW;
      entry.li.classList.toggle("msg--grouped", grouped);
      desired.push(entry.li);
      prev = record;
    }

    const keep = new Set(desired);
    for (const child of Array.from(list.children)) if (!keep.has(child)) child.remove();
    let cursor = list.firstChild;
    for (const node of desired) {
      if (cursor === node) {
        cursor = cursor.nextSibling;
      } else {
        list.insertBefore(node, cursor);
      }
    }
    for (const [key, li] of dayNodes) if (!li.isConnected) dayNodes.delete(key);

    loading.hidden = loaded;
    empty.hidden = !loaded || messages.size > 0;
    olderRow.hidden = !hasMore;
  }

  function upsert(record) {
    messages.set(record.id, record);
    const entry = nodes.get(record.id);
    if (entry && entry.record !== record) {
      entry.record = record;
      if (!entry.editing) renderEntry(entry);
      else entry.pendingRender = true;
    }
  }

  function removeLocal(id) {
    messages.delete(id);
    const entry = nodes.get(id);
    if (entry) {
      if (activeMenu === entry) activeMenu = null;
      nodes.delete(id);
    }
  }

  // ------------------------------------------------------------- Laden
  async function fetchPage(beforeRecord) {
    let filter = pb.filter("channel = {:channel}", { channel: channel.id });
    if (beforeRecord) {
      filter += " && " + pb.filter("(created < {:c} || (created = {:c} && id < {:id}))", {
        c: beforeRecord.created,
        id: beforeRecord.id,
      });
    }
    return pb.collection("messages").getList(1, PAGE_SIZE, {
      filter,
      sort: "-created,-id",
      expand: EXPAND,
      skipTotal: true,
    });
  }

  async function loadInitial() {
    try {
      const page = await fetchPage(null);
      if (destroyed) return;
      for (const record of page.items) upsert(record);
      hasMore = page.items.length === PAGE_SIZE;
      loaded = true;
      render();
      list.setAttribute("aria-busy", "false");
      scrollToBottom();
      markLatestRead();
    } catch (err) {
      if (destroyed) return;
      loaded = true;
      render();
      list.setAttribute("aria-busy", "false");
      handleError(err, "Nachrichten konnten nicht geladen werden.");
    }
  }

  /** Nach Reconnect: neueste Seite neu holen und mit dem lokalen Stand abgleichen. */
  async function reconcile({ verify = true } = {}) {
    // Ohne gültige Session käme eine leere Liste zurück – vorher prüfen.
    if (verify && (!(await verifySession()) || destroyed)) return;
    try {
      const wasAtBottom = isAtBottom();
      const page = await fetchPage(null);
      if (destroyed) return;
      const fresh = new Set(page.items.map((r) => r.id));
      const cutoff = page.items.length === PAGE_SIZE ? page.items[page.items.length - 1] : null;
      // Lokale Nachrichten im Zeitfenster der frischen Seite, die es nicht mehr gibt → gelöscht.
      for (const record of Array.from(messages.values())) {
        if (fresh.has(record.id)) continue;
        if (!cutoff || byCreated(record, cutoff) > 0) removeLocal(record.id);
      }
      for (const record of page.items) upsert(record);
      if (!cutoff) hasMore = false;
      render();
      if (wasAtBottom) scrollToBottom();
      markLatestRead();
    } catch (err) {
      if (!destroyed && statusOf(err) === 401) onAuthError();
    }
  }

  async function loadOlder() {
    if (loadingOlder || !hasMore || destroyed) return;
    const first = oldest();
    if (!first) return;
    loadingOlder = true;
    olderButton.disabled = true;
    olderButton.textContent = "Lädt …";
    list.setAttribute("aria-busy", "true");
    const prevHeight = scroller.scrollHeight;
    const prevTop = scroller.scrollTop;
    try {
      const page = await fetchPage(first);
      if (destroyed) return;
      for (const record of page.items) upsert(record);
      hasMore = page.items.length === PAGE_SIZE;
      render();
      scroller.scrollTop = prevTop + (scroller.scrollHeight - prevHeight);
    } catch (err) {
      if (!destroyed) handleError(err, "Ältere Nachrichten konnten nicht geladen werden.");
    } finally {
      loadingOlder = false;
      olderButton.disabled = false;
      olderButton.textContent = "Ältere laden";
      list.setAttribute("aria-busy", "false");
    }
  }

  olderButton.addEventListener("click", loadOlder);

  // Infinite Scroll: Button oben sichtbar → automatisch nachladen.
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting) && loaded) loadOlder();
  }, { root: scroller, rootMargin: "200px 0px 0px 0px" });
  observer.observe(olderRow);

  // ---------------------------------------------------------- Realtime
  function onEvent(event) {
    if (destroyed || !event.record) return;
    const record = event.record;
    if (record.channel !== channel.id) return;
    const wasAtBottom = isAtBottom();
    if (event.action === "delete") {
      removeLocal(record.id);
    } else {
      upsert(record);
    }
    render();
    if (event.action === "create") {
      if (wasAtBottom || record.author === user?.id) scrollToBottom();
      if (record.author !== user?.id) markLatestRead();
    }
  }

  const offReconnect = onReconnect(() => reconcile());
  const offStatus = onConnectionStatus((offline) => { banner.hidden = !offline; });

  const onVisible = () => {
    if (document.visibilityState === "visible") markLatestRead();
  };
  document.addEventListener("visibilitychange", onVisible);

  const timeTicker = window.setInterval(() => refreshTimes(list), 30 * 1000);

  // ----------------------------------------------------------- Senden
  function updateComposer() {
    const value = input.value;
    const trimmed = value.trim();
    sendButton.disabled = !trimmed || value.length > MAX_LENGTH || composer.dataset.busy === "true";

    // Höhe an den Inhalt anpassen (CSSOM, CSP-konform); max-height begrenzt per CSS.
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
    const css = getComputedStyle(input);
    const singleLine = parseFloat(css.lineHeight) + parseFloat(css.paddingTop) + parseFloat(css.paddingBottom);
    box.classList.toggle("is-multiline", input.scrollHeight > singleLine * 1.4);

    const left = MAX_LENGTH - value.length;
    if (value.length >= COUNTER_FROM) {
      meta.hidden = false;
      meta.textContent = left === 1 ? "1 Zeichen übrig" : `${left} Zeichen übrig`;
    } else {
      meta.hidden = true;
    }
  }

  async function send() {
    const body = input.value.trim();
    if (!body || body.length > MAX_LENGTH || composer.dataset.busy === "true") return;
    composer.dataset.busy = "true";
    sendButton.disabled = true;
    sendButton.setAttribute("aria-busy", "true");
    try {
      const record = await pb.collection("messages").create(
        { channel: channel.id, author: user.id, body },
        { expand: EXPAND },
      );
      if (destroyed) return;
      upsert(record);
      render();
      scrollToBottom();
      markRead(channel.id, record.created);
      input.value = "";
    } catch (err) {
      if (statusOf(err) === 429) toast("Langsamer, bitte. Versuch es gleich noch einmal.");
      else handleError(err, "Nachricht konnte nicht gesendet werden.");
    } finally {
      delete composer.dataset.busy;
      sendButton.removeAttribute("aria-busy");
      if (!destroyed) {
        updateComposer();
        input.focus();
      }
    }
  }

  input.addEventListener("input", updateComposer);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
    }
  });
  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    send();
  });

  // ------------------------------------------------- Bearbeiten/Löschen
  function startEdit(entry) {
    if (entry.editing) return;
    closeMenu();
    const textarea = h("textarea", {
      class: "input",
      maxlength: MAX_LENGTH,
      "aria-label": "Nachricht bearbeiten",
    });
    textarea.value = entry.record.body;
    const cancel = h("button", { class: "btn btn--soft btn--sm", type: "button" }, "Abbrechen");
    const save = h("button", { class: "btn btn--primary btn--sm", type: "submit" }, "Speichern");
    const form = h("form", { class: "edit-form" },
      textarea,
      h("div", { class: "edit-form__row" },
        h("span", { class: "edit-form__hint" }, "Enter speichert, Esc bricht ab."),
        cancel,
        save,
      ),
    );

    const stop = () => {
      entry.editing = false;
      entry.editForm = null;
      entry.li.classList.remove("is-editing");
      renderEntry(entry);
      entry.pendingRender = false;
    };

    const submit = async () => {
      const body = textarea.value.trim();
      if (!body) return textarea.focus();
      if (body === entry.record.body) return stop();
      save.disabled = true;
      save.setAttribute("aria-busy", "true");
      try {
        const record = await pb.collection("messages").update(entry.record.id, { body }, { expand: EXPAND });
        messages.set(record.id, record);
        entry.record = record;
        stop();
        entry.li.querySelector(".action")?.focus();
      } catch (err) {
        save.disabled = false;
        save.removeAttribute("aria-busy");
        handleError(err, "Änderung konnte nicht gespeichert werden.");
      }
    };

    form.addEventListener("submit", (event) => { event.preventDefault(); submit(); });
    cancel.addEventListener("click", () => { stop(); entry.li.querySelector(".action")?.focus(); });
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        stop();
        entry.li.querySelector(".action")?.focus();
      } else if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        submit();
      }
    });

    entry.editing = true;
    entry.editForm = form;
    entry.li.classList.add("is-editing");
    renderEntry(entry);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  async function remove(entry) {
    try {
      await pb.collection("messages").delete(entry.record.id);
      if (destroyed) return;
      removeLocal(entry.record.id);
      render();
      input.focus();
    } catch (err) {
      entry.resetActions?.();
      handleError(err, "Nachricht konnte nicht gelöscht werden.");
    }
  }

  // ------------------------------------------------------------- Start
  // Abo und Verlauf parallel starten; upsert() ist idempotent, doppelte Events schaden nicht.
  const subscribed = subscribeMessages(onEvent, {
    filter: pb.filter("channel = {:channel}", { channel: channel.id }),
    expand: EXPAND,
  }).then((fn) => {
    unsubscribe = fn;
    // Verlauf war schneller als das Abo: Lücke dazwischen schließen.
    if (loaded && !destroyed) reconcile({ verify: false });
  }).catch((err) => {
    if (!destroyed && statusOf(err) === 401) onAuthError();
  });
  loadInitial();

  updateComposer();

  return {
    focusComposer() {
      input.focus({ preventScroll: true });
    },
    async destroy() {
      destroyed = true;
      observer.disconnect();
      offReconnect();
      offStatus();
      window.clearInterval(timeTicker);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("pointerdown", onDocPointer);
      await subscribed;
      try { await unsubscribe?.(); } catch (_) {}
    },
  };
}
