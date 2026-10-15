/**
 * Bestellen: Bestellungen für Büro 1, Büro 2 oder Büro 3.
 *
 * Alle sehen alle Bestellungen. Nur Admins setzen "erledigt" (API-Rules).
 * Eigene offene Bestellungen kann man zurückziehen.
 */

import { pb, me, statusOf } from "./pb.js";
import { h, toast, shortDate, fullDate } from "./ui.js";
import {
  field, segmented, confirmButton, actionButton, section, renderPage, errorHandler, liveReload,
} from "./forms.js";

export const LOCATIONS = ["Büro 1", "Büro 2", "Büro 3"];
const LIMIT = 200;
const MAX_ITEM = 200;
const MAX_NOTE = 1000;
const MAX_QUANTITY = 9999;
const LAST_LOCATION_KEY = "crew.lastLocation";

function lastLocation() {
  try {
    const v = localStorage.getItem(LAST_LOCATION_KEY);
    return LOCATIONS.includes(v) ? v : LOCATIONS[0];
  } catch (_) {
    return LOCATIONS[0];
  }
}

export function openOrders({ container, menuButton, onAuthError }) {
  const user = me();
  const isAdmin = user?.role === "admin";
  const handleError = errorHandler(onAuthError);
  let destroyed = false;
  let items = [];
  let statusFilter = "open";
  let locationFilter = "all";

  // ------------------------------------------------------- Bestellen
  const location = segmented({
    label: "Standort",
    value: lastLocation(),
    options: LOCATIONS.map((l) => [l, l]),
    onChange: (v) => { try { localStorage.setItem(LAST_LOCATION_KEY, v); } catch (_) {} },
  });
  const item = field({ label: "Was wird gebraucht?", maxlength: MAX_ITEM, placeholder: "z. B. Druckerpapier A4" });
  const quantity = field({
    label: "Menge",
    type: "number",
    inputmode: "numeric",
    min: "1",
    max: String(MAX_QUANTITY),
    step: "1",
  });
  quantity.input.value = "1";
  const note = field({ label: "Notiz (optional)", maxlength: MAX_NOTE, placeholder: "Marke, Link, bis wann …" });
  const submit = h("button", { class: "btn btn--primary", type: "submit" }, "Bestellen");
  const form = h("form", { class: "form", novalidate: true },
    location.wrap,
    item.wrap,
    h("div", { class: "form__grid" }, quantity.wrap, note.wrap),
    h("div", { class: "form__actions" }, submit),
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const itemValue = item.input.value.trim();
    const qty = Number(quantity.input.value);
    item.fail(itemValue ? null : "Bitte gib an, was bestellt werden soll.");
    quantity.fail(Number.isInteger(qty) && qty >= 1 && qty <= MAX_QUANTITY
      ? null : `Bitte eine ganze Zahl von 1 bis ${MAX_QUANTITY}.`);
    const invalid = form.querySelector('[aria-invalid="true"]');
    if (invalid) return invalid.focus();

    submit.disabled = true;
    submit.setAttribute("aria-busy", "true");
    try {
      await pb.collection("orders").create({
        requester: user.id,
        location: location.value,
        item: itemValue,
        quantity: qty,
        note: note.input.value.trim(),
      });
      if (destroyed) return;
      item.input.value = "";
      note.input.value = "";
      quantity.input.value = "1";
      toast(`Bestellt für ${location.value}.`);
      setStatus("open");
      await load();
      item.input.focus();
    } catch (err) {
      handleError(err, "Die Bestellung konnte nicht gespeichert werden.");
    } finally {
      if (!destroyed) {
        submit.disabled = false;
        submit.removeAttribute("aria-busy");
      }
    }
  });

  // ---------------------------------------------------------- Liste
  const list = h("ul", { class: "entry-list", "aria-live": "polite" });
  const empty = h("p", { class: "entry-empty", hidden: true });
  const statusControl = segmented({
    label: "Status",
    small: true,
    value: statusFilter,
    options: [["open", "Offen"], ["done", "Erledigt"], ["all", "Alle"]],
    onChange: (v) => { statusFilter = v; render(); },
  });
  const setStatus = (v) => { statusFilter = v; statusControl.set(v); };
  const locationControl = segmented({
    label: "Standort",
    small: true,
    value: locationFilter,
    options: [["all", "Alle Standorte"], ...LOCATIONS.map((l) => [l, l])],
    onChange: (v) => { locationFilter = v; render(); },
  });

  async function setDone(order, done) {
    try {
      await pb.collection("orders").update(order.id, { done });
      toast(done ? "Als erledigt markiert." : "Wieder geöffnet.");
      await load();
    } catch (err) {
      handleError(err, "Der Status konnte nicht geändert werden.");
    }
  }

  async function remove(order, message) {
    try {
      await pb.collection("orders").delete(order.id);
      toast(message);
      await load();
    } catch (err) {
      handleError(err, "Die Bestellung konnte nicht entfernt werden.");
    }
  }

  function entry(order) {
    const requester = order.expand?.requester?.name || "Unbekannt";
    const doneBy = order.expand?.done_by?.name;
    const own = order.requester === user?.id;

    const actions = h("div", { class: "entry__actions" });
    if (isAdmin) {
      actions.append(order.done
        ? actionButton("Wieder öffnen", () => setDone(order, false))
        : actionButton("Erledigt", () => setDone(order, true), "btn--primary"));
    }
    if (own && !order.done) {
      actions.append(confirmButton("Zurückziehen", "Wirklich zurückziehen?", () => remove(order, "Bestellung zurückgezogen.")));
    } else if (isAdmin) {
      actions.append(confirmButton("Löschen", "Wirklich löschen?", () => remove(order, "Bestellung gelöscht.")));
    }

    return h("li", { class: order.done ? "entry is-done" : "entry" },
      h("div", { class: "entry__head" },
        h("span", { class: "entry__title" }, `${order.quantity} × ${order.item}`),
        h("span", { class: "badge" }, order.location),
        h("span", { class: order.done ? "badge badge--inverse" : "badge" }, order.done ? "Erledigt" : "Offen"),
      ),
      order.note ? h("p", { class: "entry__body" }, order.note) : null,
      h("p", { class: "entry__meta" },
        h("time", { datetime: order.created, title: fullDate(order.created) },
          `${own ? "Von dir" : `Von ${requester}`} · ${shortDate(order.created)}`),
      ),
      order.done
        ? h("p", { class: "entry__meta" },
          `Erledigt${doneBy ? ` von ${doneBy}` : ""}${order.done_at ? ` · ${shortDate(order.done_at)}` : ""}`)
        : null,
      actions.childElementCount ? actions : null,
    );
  }

  function render() {
    const visible = items.filter((o) =>
      (statusFilter === "all" || (statusFilter === "done" ? o.done : !o.done))
      && (locationFilter === "all" || o.location === locationFilter));
    list.replaceChildren(...visible.map(entry));
    const open = items.filter((o) => !o.done).length;
    listSection.desc.textContent = `${open} offen, ${items.length - open} erledigt.`;
    listSection.desc.hidden = false;
    empty.hidden = visible.length > 0;
    empty.textContent = statusFilter === "done" ? "Noch nichts erledigt." : "Keine offenen Bestellungen.";
  }

  async function load() {
    try {
      const res = await pb.collection("orders").getList(1, LIMIT, {
        sort: "-created",
        expand: "requester,done_by",
        skipTotal: true,
      });
      if (destroyed) return;
      items = res.items;
      render();
    } catch (err) {
      if (!destroyed && statusOf(err) !== 0) handleError(err, "Bestellungen konnten nicht geladen werden.");
    }
  }

  const createSection = section("Neue Bestellung", "Für welchen Standort wird etwas gebraucht?", form);
  const listSection = section("Alle Bestellungen", null,
    h("div", { class: "filters" }, statusControl.wrap, locationControl.wrap), empty, list);

  renderPage({
    container,
    menuButton,
    title: "Bestellen.",
    description: isAdmin
      ? "Bestellungen für alle Standorte. Du kannst sie als erledigt markieren."
      : "Bestell, was im Büro fehlt. Alle sehen, was schon bestellt ist.",
    docTitle: "Bestellen",
    content: [createSection.el, listSection.el],
  });

  load();
  const stopLive = liveReload("orders", load);

  return {
    async destroy() {
      destroyed = true;
      await stopLive();
    },
  };
}
