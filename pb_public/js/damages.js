/**
 * Kfz-Meldungen: Schäden mit Kennzeichen melden und als behoben markieren.
 *
 * Nutzer sehen nur ihre eigenen Meldungen, Admins sehen alle (API-Rules).
 * "behoben" dürfen Melder und Admins setzen; wer/wann setzt der Server.
 */

import { pb, me, statusOf } from "./pb.js";
import { h, toast, shortDate, fullDate } from "./ui.js";
import {
  field, segmented, confirmButton, actionButton, section, renderPage, errorHandler, liveReload,
} from "./forms.js";

const LIMIT = 200;
const MAX_PLATE = 20;
const MAX_DESCRIPTION = 2000;

export function openDamages({ container, menuButton, onAuthError }) {
  const user = me();
  const isAdmin = user?.role === "admin";
  const handleError = errorHandler(onAuthError);
  let destroyed = false;
  let items = [];
  let filter = "open";

  // --------------------------------------------------------- Melden
  const plate = field({
    label: "Kennzeichen",
    maxlength: MAX_PLATE,
    placeholder: "z. B. B-AB 1234",
    autocapitalize: "characters",
    spellcheck: "false",
  });
  plate.input.addEventListener("blur", () => {
    plate.input.value = plate.input.value.trim().replace(/\s+/g, " ").toUpperCase();
  });
  const description = field({
    label: "Meldung",
    multiline: true,
    maxlength: MAX_DESCRIPTION,
    placeholder: "Text eingeben",
  });
  const submit = h("button", { class: "btn btn--primary", type: "submit" }, "Absenden");
  const form = h("form", { class: "form", novalidate: true },
    plate.wrap, description.wrap, h("div", { class: "form__actions" }, submit));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const plateValue = plate.input.value.trim().replace(/\s+/g, " ").toUpperCase();
    const text = description.input.value.trim();
    plate.fail(plateValue ? null : "Bitte gib das Kennzeichen ein.");
    description.fail(text ? null : "Bitte gib einen Text ein.");
    const invalid = form.querySelector('[aria-invalid="true"]');
    if (invalid) return invalid.focus();

    submit.disabled = true;
    submit.setAttribute("aria-busy", "true");
    try {
      await pb.collection("damages").create({ reporter: user.id, plate: plateValue, description: text });
      if (destroyed) return;
      form.reset();
      toast("Meldung abgeschickt.");
      setFilter("open");
      await load();
      plate.input.focus();
    } catch (err) {
      handleError(err, "Die Meldung konnte nicht abgeschickt werden.");
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
  const filterControl = segmented({
    label: "Anzeigen",
    small: true,
    value: filter,
    options: [["open", "Offen"], ["fixed", "Behoben"], ["all", "Alle"]],
    onChange: (v) => { filter = v; render(); },
  });
  const setFilter = (v) => { filter = v; filterControl.set(v); };

  async function setFixed(item, fixed) {
    try {
      await pb.collection("damages").update(item.id, { fixed });
      toast(fixed ? "Als behoben markiert." : "Wieder geöffnet.");
      await load();
    } catch (err) {
      handleError(err, "Der Status konnte nicht geändert werden.");
    }
  }

  function entry(item) {
    const reporter = item.expand?.reporter?.name || "Unbekannt";
    const fixer = item.expand?.fixed_by?.name;
    const meta = [isAdmin || item.reporter !== user?.id ? `Gemeldet von ${reporter}` : "Gemeldet", shortDate(item.created)];

    const actions = h("div", { class: "entry__actions" },
      item.fixed
        ? actionButton("Wieder öffnen", () => setFixed(item, false))
        : actionButton("Als behoben markieren", () => setFixed(item, true), "btn--primary"),
      confirmButton("Löschen", "Wirklich löschen?", async () => {
        try {
          await pb.collection("damages").delete(item.id);
          toast("Meldung gelöscht.");
          await load();
        } catch (err) {
          handleError(err, "Die Meldung konnte nicht gelöscht werden.");
        }
      }),
    );

    return h("li", { class: item.fixed ? "entry is-done" : "entry" },
      h("div", { class: "entry__head" },
        h("span", { class: "plate" }, item.plate),
        h("span", { class: item.fixed ? "badge badge--inverse" : "badge" }, item.fixed ? "Behoben" : "Offen"),
      ),
      h("p", { class: "entry__body" }, item.description),
      h("p", { class: "entry__meta" },
        h("time", { datetime: item.created, title: fullDate(item.created) }, meta.join(" · ")),
      ),
      item.fixed
        ? h("p", { class: "entry__meta" },
          `Behoben${fixer ? ` von ${fixer}` : ""}${item.fixed_at ? ` · ${shortDate(item.fixed_at)}` : ""}`)
        : null,
      actions,
    );
  }

  function render() {
    const visible = items.filter((i) => filter === "all" || (filter === "fixed" ? i.fixed : !i.fixed));
    list.replaceChildren(...visible.map(entry));
    const open = items.filter((i) => !i.fixed).length;
    listSection.desc.textContent = `${open} offen, ${items.length - open} behoben.`;
    listSection.desc.hidden = false;
    empty.hidden = visible.length > 0;
    empty.textContent = filter === "fixed" ? "Noch nichts behoben." : filter === "open" ? "Keine offenen Schäden." : "Noch keine Schäden gemeldet.";
  }

  async function load() {
    try {
      const res = await pb.collection("damages").getList(1, LIMIT, {
        sort: "-created",
        expand: "reporter,fixed_by",
        skipTotal: true,
      });
      if (destroyed) return;
      items = res.items;
      render();
    } catch (err) {
      if (!destroyed && statusOf(err) !== 0) handleError(err, "Schäden konnten nicht geladen werden.");
    }
  }

  const createSection = section("Kfz-Meldung", "Kennzeichen und kurzer Text genügen.", form);
  const listSection = section(isAdmin ? "Alle Schäden" : "Meine Schäden", null,
    filterControl.wrap, empty, list);

  renderPage({
    container,
    menuButton,
    title: "Kfz-Meldungen.",
    description: isAdmin ? "Alle gemeldeten Schäden im Blick." : "Melde Schäden und sieh, ob sie behoben sind.",
    docTitle: "Kfz-Meldungen",
    content: [createSection.el, listSection.el],
  });

  load();
  const stopLive = liveReload("damages", load);

  return {
    async destroy() {
      destroyed = true;
      await stopLive();
    },
  };
}
