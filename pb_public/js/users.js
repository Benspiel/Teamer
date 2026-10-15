/**
 * Benutzerverwaltung für Admins (role = "admin"): Konten anlegen,
 * Rolle ändern, sperren/entsperren, Passwort neu setzen.
 *
 * Die Rechte prüft der Server (Migration 1760500003). Diese Seite ist nur
 * die Oberfläche dafür; Mitglieder bekommen sie gar nicht erst angezeigt.
 */

import { pb, me, statusOf } from "./pb.js";
import { h, icon, avatar, toast } from "./ui.js";

const MIN_PASSWORD = 10;
const MAX_NAME = 80;
const CONFIRM_TIMEOUT = 4000;
// Ohne leicht verwechselbare Zeichen (0/O, 1/l/I), gut zum Weitergeben.
const PASSWORD_CHARS = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PASSWORD_LENGTH = 14;

let counter = 0;

export function generatePassword() {
  const bytes = new Uint32Array(PASSWORD_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => PASSWORD_CHARS[n % PASSWORD_CHARS.length]).join("");
}

function field({ label, type = "text", autocomplete = "off", maxlength, hint }) {
  const id = `user-field-${++counter}`;
  const input = h("input", {
    id,
    class: "input",
    type,
    autocomplete,
    maxlength,
    spellcheck: "false",
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
  return { wrap, input, error };
}

function setError(input, node, text) {
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

/** Zeigt Zugangsdaten einmalig an, mit Kopieren-Button. */
function credentialsCard({ title, name, email, password }) {
  const text = `Crew – Zugangsdaten für ${name}\nAdresse: ${window.location.origin}\nE-Mail: ${email}\nPasswort: ${password}`;
  const copy = h("button", { class: "btn btn--primary btn--sm", type: "button" }, "Kopieren");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Zugangsdaten kopiert.");
    } catch (_) {
      toast("Kopieren nicht möglich. Bitte markieren und manuell kopieren.");
    }
  });
  const close = h("button", { class: "btn btn--soft btn--sm", type: "button" }, "Schließen");
  const card = h("div", { class: "credentials", role: "status" },
    h("p", { class: "credentials__title" }, title),
    h("p", { class: "credentials__hint" },
      "Gib diese Daten an die Person weiter. Das Passwort wird nur jetzt angezeigt; sie kann es danach in den Einstellungen ändern."),
    h("dl", { class: "facts" },
      h("div", { class: "facts__row" }, h("dt", {}, "E-Mail"), h("dd", {}, email)),
      h("div", { class: "facts__row" }, h("dt", {}, "Passwort"), h("dd", { class: "credentials__secret" }, password)),
    ),
    h("div", { class: "credentials__actions" }, copy, close),
  );
  close.addEventListener("click", () => card.remove());
  return card;
}

/**
 * Rendert die Benutzerverwaltung in `container`.
 */
export function openUsers({ container, menuButton, onAuthError }) {
  let destroyed = false;
  let users = [];
  const self = me();

  async function handleError(err, fallback) {
    const status = statusOf(err);
    if (status === 401) return onAuthError();
    if (status === 429) return toast("Zu viele Anfragen. Bitte warte kurz.");
    toast(status === 0 ? "Keine Verbindung. Bitte versuch es erneut." : fallback);
  }

  // ------------------------------------------------------- Neues Konto
  const name = field({ label: "Name", autocomplete: "off", maxlength: MAX_NAME });
  const email = field({ label: "E-Mail", type: "email", autocomplete: "off" });
  const password = field({
    label: "Startpasswort",
    autocomplete: "new-password",
    hint: `Mindestens ${MIN_PASSWORD} Zeichen. Wird nach dem Anlegen einmal angezeigt.`,
  });
  password.input.value = generatePassword();

  const regenerate = h("button", { class: "btn btn--soft btn--sm", type: "button" }, "Neu erzeugen");
  regenerate.addEventListener("click", () => {
    password.input.value = generatePassword();
    setError(password.input, password.error, null);
  });
  const anchor = password.input.nextSibling;
  password.wrap.insertBefore(h("div", { class: "field__row" }, password.input, regenerate), anchor);

  let role = "member";
  const roleButtons = [["member", "Mitglied"], ["admin", "Admin"]].map(([value, label]) => {
    const b = h("button", {
      class: "segmented__option",
      type: "button",
      role: "radio",
      "aria-checked": String(value === role),
      tabindex: value === role ? "0" : "-1",
      dataset: { value },
    }, label);
    b.addEventListener("click", () => selectRole(value, true));
    return b;
  });
  function selectRole(value, focus) {
    role = value;
    for (const b of roleButtons) {
      const on = b.dataset.value === value;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
  }
  const roleId = `user-role-${++counter}`;
  const roleGroup = h("div", { class: "segmented", role: "radiogroup", "aria-labelledby": roleId }, roleButtons);
  roleGroup.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    selectRole(role === "member" ? "admin" : "member", true);
  });

  const submit = h("button", { class: "btn btn--primary", type: "submit" }, "Konto anlegen");
  const result = h("div", { class: "users-result" });

  const form = h("form", { class: "form", novalidate: true },
    name.wrap,
    email.wrap,
    password.wrap,
    h("div", { class: "field" },
      h("span", { id: roleId, class: "field__label" }, "Rolle"),
      roleGroup,
      h("p", { class: "field__hint" }, "Admins können Konten verwalten und fremde Nachrichten löschen."),
    ),
    h("div", { class: "form__actions" }, submit),
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const nameValue = name.input.value.trim();
    const emailValue = email.input.value.trim();
    const passwordValue = password.input.value;

    setError(name.input, name.error, nameValue ? null : "Bitte gib einen Namen ein.");
    setError(email.input, email.error,
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue) ? null : "Bitte gib eine gültige E-Mail-Adresse ein.");
    setError(password.input, password.error,
      passwordValue.length >= MIN_PASSWORD ? null : `Das Passwort braucht mindestens ${MIN_PASSWORD} Zeichen.`);
    const invalid = form.querySelector('[aria-invalid="true"]');
    if (invalid) return invalid.focus();

    submit.disabled = true;
    submit.setAttribute("aria-busy", "true");
    try {
      const record = await pb.collection("users").create({
        name: nameValue,
        email: emailValue,
        password: passwordValue,
        passwordConfirm: passwordValue,
        role,
        verified: true,
        emailVisibility: false,
      });
      if (destroyed) return;
      result.replaceChildren(credentialsCard({
        title: `Konto für ${record.name} angelegt.`,
        name: record.name,
        email: emailValue,
        password: passwordValue,
      }));
      form.reset();
      password.input.value = generatePassword();
      selectRole("member");
      upsertUser(record);
      result.querySelector("button")?.focus();
    } catch (err) {
      const data = err?.response?.data || {};
      if (statusOf(err) === 400 && data.email) {
        setError(email.input, email.error,
          data.email.code === "validation_not_unique"
            ? "Für diese E-Mail gibt es schon ein Konto."
            : "Bitte gib eine gültige E-Mail-Adresse ein.");
        email.input.focus();
      } else if (statusOf(err) === 400 && data.password) {
        setError(password.input, password.error, "Dieses Passwort ist nicht erlaubt.");
        password.input.focus();
      } else {
        handleError(err, "Das Konto konnte nicht angelegt werden.");
      }
    } finally {
      if (!destroyed) {
        submit.disabled = false;
        submit.removeAttribute("aria-busy");
      }
    }
  });

  // ------------------------------------------------------------ Liste
  const list = h("ul", { class: "user-list", "aria-label": "Konten" });
  const count = h("p", { class: "settings-section__desc" }, "Lädt …");
  const listResult = h("div", { class: "users-result" });

  function upsertUser(record) {
    const i = users.findIndex((u) => u.id === record.id);
    if (i >= 0) users[i] = record;
    else users.push(record);
    renderList();
  }

  /** Zweistufiger Button: erster Klick fragt nach, zweiter führt aus. */
  function confirmButton(label, confirmLabel, action) {
    const b = h("button", { class: "btn btn--soft btn--sm", type: "button" }, label);
    let armed = 0;
    b.addEventListener("click", async () => {
      if (!armed) {
        b.textContent = confirmLabel;
        b.classList.replace("btn--soft", "btn--primary");
        armed = window.setTimeout(() => {
          armed = 0;
          if (b.isConnected) {
            b.textContent = label;
            b.classList.replace("btn--primary", "btn--soft");
          }
        }, CONFIRM_TIMEOUT);
        return;
      }
      window.clearTimeout(armed);
      armed = 0;
      b.disabled = true;
      b.setAttribute("aria-busy", "true");
      await action();
    });
    return b;
  }

  async function update(user, data, message) {
    try {
      const record = await pb.collection("users").update(user.id, data);
      if (destroyed) return null;
      upsertUser(record);
      toast(message);
      return record;
    } catch (err) {
      renderList();
      handleError(err, "Die Änderung konnte nicht gespeichert werden.");
      return null;
    }
  }

  function renderRow(user) {
    const isSelf = user.id === self?.id;
    const badges = h("div", { class: "user-row__badges" },
      user.role === "admin" ? h("span", { class: "badge" }, "Admin") : null,
      user.blocked ? h("span", { class: "badge badge--inverse" }, "Gesperrt") : null,
      isSelf ? h("span", { class: "badge" }, "Du") : null,
    );

    const actions = h("div", { class: "user-row__actions" });
    if (!isSelf) {
      actions.append(
        confirmButton("Passwort neu", "Wirklich neu setzen?", async () => {
          const pw = generatePassword();
          const record = await update(user, { password: pw, passwordConfirm: pw }, "Neues Passwort gesetzt.");
          if (record) {
            listResult.replaceChildren(credentialsCard({
              title: `Neues Passwort für ${record.name}.`,
              name: record.name,
              email: record.email || "",
              password: pw,
            }));
            listResult.querySelector("button")?.focus();
          }
        }),
        user.role === "admin"
          ? confirmButton("Zum Mitglied", "Wirklich herabstufen?", () =>
            update(user, { role: "member" }, `${user.name} ist jetzt Mitglied.`))
          : confirmButton("Zum Admin", "Wirklich Admin machen?", () =>
            update(user, { role: "admin" }, `${user.name} ist jetzt Admin.`)),
        user.blocked
          ? confirmButton("Entsperren", "Wirklich entsperren?", () =>
            update(user, { blocked: false }, `${user.name} ist entsperrt.`))
          : confirmButton("Sperren", "Wirklich sperren?", () =>
            update(user, { blocked: true }, `${user.name} ist gesperrt und wurde abgemeldet.`)),
      );
    }

    return h("li", { class: user.blocked ? "user-row is-blocked" : "user-row" },
      h("div", { class: "user-row__who" },
        avatar(user),
        h("div", { class: "user-row__text" },
          h("span", { class: "user-row__name" }, user.name || "Unbenannt"),
          h("span", { class: "user-row__email" }, user.email || ""),
        ),
        badges,
      ),
      actions.childElementCount ? actions : null,
    );
  }

  function renderList() {
    users.sort((a, b) => (a.name || "").localeCompare(b.name || "", "de-DE"));
    list.replaceChildren(...users.map(renderRow));
    const blocked = users.filter((u) => u.blocked).length;
    count.textContent = `${users.length} ${users.length === 1 ? "Konto" : "Konten"}`
      + (blocked ? `, davon ${blocked} gesperrt` : "") + ".";
  }

  async function load() {
    try {
      users = await pb.collection("users").getFullList({ sort: "name" });
      if (!destroyed) renderList();
    } catch (err) {
      if (destroyed) return;
      count.textContent = "Konten konnten nicht geladen werden.";
      handleError(err, "Konten konnten nicht geladen werden.");
    }
  }

  // ------------------------------------------------------------ Gerüst
  const header = h("header", { class: "channel-header" },
    menuButton,
    h("div", { class: "channel-header__text" },
      h("h1", { class: "channel-header__title" }, "Benutzer."),
      h("p", { class: "channel-header__desc" }, "Konten für dein Team anlegen und verwalten."),
    ),
  );

  const createSection = h("section", { class: "settings-section", "aria-labelledby": "users-new" },
    h("div", { class: "settings-section__head" },
      h("h2", { id: "users-new", class: "settings-section__title" }, "Neues Konto"),
      h("p", { class: "settings-section__desc" }, "Es gibt keine öffentliche Registrierung. Neue Leute legst du hier an."),
    ),
    form,
    result,
  );

  const listSection = h("section", { class: "settings-section", "aria-labelledby": "users-all" },
    h("div", { class: "settings-section__head" },
      h("h2", { id: "users-all", class: "settings-section__title" }, "Alle Konten"),
      count,
    ),
    listResult,
    list,
    h("p", { class: "field__hint" },
      "Gesperrte Konten können sich nicht anmelden und werden sofort überall abgemeldet. Löschen geht nur im Dashboard."),
  );

  const content = h("div", { class: "settings" }, createSection, listSection);
  container.replaceChildren(header, h("div", { class: "scroller" }, h("div", { class: "scroller__inner" }, content)));
  document.title = "Benutzer · Crew.";

  load();

  return {
    async destroy() {
      destroyed = true;
    },
  };
}
