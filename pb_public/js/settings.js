/**
 * Einstellungen: Profil, Passwort, Darstellung, Chat, Benachrichtigungen.
 *
 * Profil und Passwort liegen in PocketBase (users-Collection; die Update-Rule
 * erlaubt nur das eigene Konto, Rolle und Sperre bleiben gesperrt).
 * Darstellung, Enter-Verhalten und Benachrichtigungen gelten pro Gerät (prefs.js).
 */

import { pb, me, statusOf, session } from "./pb.js";
import { h, icon, avatar, toast } from "./ui.js";
import { getPrefs, setPref } from "./prefs.js";
import { logout } from "./auth.js";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MIN_PASSWORD = 10;
const MAX_NAME = 80;

let fieldCounter = 0;

// ------------------------------------------------------------- Bausteine

function section(title, description, ...content) {
  const id = `settings-${++fieldCounter}`;
  return h("section", { class: "settings-section", "aria-labelledby": id },
    h("div", { class: "settings-section__head" },
      h("h2", { id, class: "settings-section__title" }, title),
      description ? h("p", { class: "settings-section__desc" }, description) : null,
    ),
    ...content,
  );
}

function errorLine(id) {
  return h("p", { id, class: "field-error", hidden: true });
}

function setFieldError(input, node, text) {
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

function textField({ label, type = "text", value = "", autocomplete, hint, maxlength }) {
  const id = `field-${++fieldCounter}`;
  const input = h("input", {
    id,
    class: "input",
    type,
    autocomplete,
    maxlength,
    "aria-describedby": `${id}-error${hint ? ` ${id}-hint` : ""}`,
  });
  input.value = value;
  const error = errorLine(`${id}-error`);
  const wrap = h("div", { class: "field" },
    h("label", { class: "field__label", for: id }, label),
    input,
    hint ? h("p", { id: `${id}-hint`, class: "field__hint" }, hint) : null,
    error,
  );
  input.addEventListener("input", () => setFieldError(input, error, null));
  return { wrap, input, error };
}

function busy(button, on, label) {
  button.disabled = on;
  if (on) button.setAttribute("aria-busy", "true");
  else button.removeAttribute("aria-busy");
  if (label) button.textContent = label;
}

/** Schalter (role="switch") mit Beschriftung und Beschreibung. */
function switchRow({ label, description, checked, onChange }) {
  const id = `switch-${++fieldCounter}`;
  const desc = h("p", { id: `${id}-desc`, class: "setting__desc" }, description);
  const button = h("button", {
    id,
    class: "switch",
    type: "button",
    role: "switch",
    "aria-checked": String(!!checked),
    "aria-labelledby": `${id}-label`,
    "aria-describedby": `${id}-desc`,
  }, h("span", { class: "switch__knob", "aria-hidden": "true" }));
  button.addEventListener("click", async () => {
    const next = button.getAttribute("aria-checked") !== "true";
    const accepted = await onChange(next);
    button.setAttribute("aria-checked", String(accepted === undefined ? next : accepted));
  });
  const row = h("div", { class: "setting" },
    h("div", { class: "setting__text" },
      h("span", { id: `${id}-label`, class: "setting__label" }, label),
      desc,
    ),
    button,
  );
  return { row, button, desc };
}

/** Segmentierte Auswahl (Pillen-Track), als Radiogruppe. */
function segmented({ label, options, value, onChange }) {
  const id = `seg-${++fieldCounter}`;
  const group = h("div", { class: "segmented", role: "radiogroup", "aria-labelledby": id });
  const buttons = options.map((opt) => {
    const b = h("button", {
      class: "segmented__option",
      type: "button",
      role: "radio",
      "aria-checked": String(opt.value === value),
      tabindex: opt.value === value ? "0" : "-1",
      dataset: { value: opt.value },
    }, opt.label);
    b.addEventListener("click", () => select(opt.value, true));
    return b;
  });
  group.append(...buttons);

  function select(next, focus) {
    for (const b of buttons) {
      const on = b.dataset.value === next;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
    onChange(next);
  }

  // Pfeiltasten wie bei Radiobuttons.
  group.addEventListener("keydown", (event) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const index = buttons.findIndex((b) => b.getAttribute("aria-checked") === "true");
    const next = buttons[(index + keys[event.key] + buttons.length) % buttons.length];
    select(next.dataset.value, true);
  });

  return h("div", { class: "setting setting--stack" },
    h("span", { id, class: "setting__label" }, label),
    group,
  );
}

// ------------------------------------------------------------------ Seite

/**
 * Rendert die Einstellungen in `container`.
 * onSessionRenewed: nach Passwortwechsel (neues Token) die Realtime-Verbindung neu aufbauen.
 */
export function openSettings({ container, menuButton, onSessionRenewed, onAuthError }) {
  let destroyed = false;
  const user = me();

  async function handleError(err, fallback) {
    const status = statusOf(err);
    if (status === 401) return onAuthError();
    if (status === 429) return toast("Zu viele Versuche. Bitte warte kurz.");
    toast(status === 0 ? "Keine Verbindung. Bitte versuch es erneut." : fallback);
  }

  // ------------------------------------------------------------ Profil
  const avatarSlot = h("div", { class: "profile__avatar" });
  const fileInput = h("input", { type: "file", accept: AVATAR_TYPES.join(","), hidden: true, tabindex: "-1" });
  const uploadButton = h("button", { class: "btn btn--outline btn--sm", type: "button" }, "Bild hochladen");
  const removeButton = h("button", { class: "btn btn--soft btn--sm", type: "button" }, "Entfernen");

  function renderAvatar() {
    const current = me();
    avatarSlot.replaceChildren(avatar(current));
    removeButton.hidden = !current?.avatar;
  }

  uploadButton.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    if (!AVATAR_TYPES.includes(file.type)) return toast("Bitte wähle ein JPG, PNG, WebP oder GIF.");
    if (file.size > MAX_AVATAR_BYTES) return toast("Das Bild darf höchstens 2 MB groß sein.");
    busy(uploadButton, true, "Lädt hoch …");
    try {
      const data = new FormData();
      data.append("avatar", file);
      await pb.collection("users").update(user.id, data);
      if (destroyed) return;
      renderAvatar();
      toast("Profilbild aktualisiert.");
    } catch (err) {
      handleError(err, "Das Bild konnte nicht gespeichert werden.");
    } finally {
      if (!destroyed) busy(uploadButton, false, "Bild hochladen");
    }
  });

  removeButton.addEventListener("click", async () => {
    busy(removeButton, true);
    try {
      await pb.collection("users").update(user.id, { avatar: null });
      if (destroyed) return;
      renderAvatar();
      uploadButton.focus();
      toast("Profilbild entfernt.");
    } catch (err) {
      handleError(err, "Das Bild konnte nicht entfernt werden.");
    } finally {
      if (!destroyed) busy(removeButton, false);
    }
  });

  const name = textField({ label: "Name", value: user?.name || "", autocomplete: "name", maxlength: MAX_NAME });
  const saveName = h("button", { class: "btn btn--primary", type: "submit" }, "Speichern");
  const nameForm = h("form", { class: "form", novalidate: true },
    name.wrap,
    h("div", { class: "form__actions" }, saveName),
  );

  nameForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = name.input.value.trim();
    if (!value) return setFieldError(name.input, name.error, "Bitte gib deinen Namen ein."), name.input.focus();
    if (value === me()?.name) return toast("Nichts geändert.");
    busy(saveName, true);
    try {
      await pb.collection("users").update(user.id, { name: value });
      if (destroyed) return;
      name.input.value = value;
      renderAvatar();
      toast("Name gespeichert.");
    } catch (err) {
      handleError(err, "Der Name konnte nicht gespeichert werden.");
    } finally {
      if (!destroyed) busy(saveName, false);
    }
  });

  const roleLabel = user?.role === "admin" ? "Admin" : "Mitglied";

  const profile = section("Profil", "So sehen dich die anderen im Chat.",
    h("div", { class: "profile" },
      avatarSlot,
      h("div", { class: "profile__actions" }, uploadButton, removeButton, fileInput),
    ),
    nameForm,
    h("dl", { class: "facts" },
      h("div", { class: "facts__row" },
        h("dt", {}, "E-Mail"),
        h("dd", {}, user?.email || "–"),
      ),
      h("div", { class: "facts__row" },
        h("dt", {}, "Rolle"),
        h("dd", {}, h("span", { class: "badge" }, roleLabel)),
      ),
    ),
  );
  renderAvatar();

  // ---------------------------------------------------------- Passwort
  const current = textField({ label: "Aktuelles Passwort", type: "password", autocomplete: "current-password" });
  const next = textField({
    label: "Neues Passwort",
    type: "password",
    autocomplete: "new-password",
    hint: `Mindestens ${MIN_PASSWORD} Zeichen.`,
  });
  const confirm = textField({ label: "Neues Passwort wiederholen", type: "password", autocomplete: "new-password" });
  const savePassword = h("button", { class: "btn btn--primary", type: "submit" }, "Passwort ändern");
  const passwordForm = h("form", { class: "form", novalidate: true },
    // Verstecktes Benutzerfeld hilft Passwort-Managern bei der Zuordnung.
    h("input", { type: "email", autocomplete: "username", value: user?.email || "", hidden: true, tabindex: "-1", "aria-hidden": "true" }),
    current.wrap,
    next.wrap,
    confirm.wrap,
    h("div", { class: "form__actions" }, savePassword),
  );

  passwordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const oldPassword = current.input.value;
    const password = next.input.value;
    const passwordConfirm = confirm.input.value;

    setFieldError(current.input, current.error, oldPassword ? null : "Bitte gib dein aktuelles Passwort ein.");
    setFieldError(next.input, next.error,
      password.length >= MIN_PASSWORD ? null : `Das neue Passwort braucht mindestens ${MIN_PASSWORD} Zeichen.`);
    setFieldError(confirm.input, confirm.error,
      passwordConfirm && passwordConfirm === password ? null : "Die Passwörter stimmen nicht überein.");
    if (password && password === oldPassword) {
      setFieldError(next.input, next.error, "Das neue Passwort muss sich vom aktuellen unterscheiden.");
    }
    const firstInvalid = passwordForm.querySelector('[aria-invalid="true"]');
    if (firstInvalid) return firstInvalid.focus();

    const email = me()?.email;
    busy(savePassword, true, "Wird geändert …");
    // Während des Wechsels wird das alte Token ungültig – kein Auto-Logout auslösen.
    session.renewing = true;
    try {
      await pb.collection("users").update(user.id, { oldPassword, password, passwordConfirm });
      try {
        if (!email) throw new Error("no email");
        await pb.collection("users").authWithPassword(email, password);
      } catch (_) {
        session.renewing = false;
        await logout("Passwort geändert. Bitte melde dich neu an.");
        return;
      }
      session.renewing = false;
      for (const f of [current, next, confirm]) f.input.value = "";
      toast("Passwort geändert. Andere Geräte wurden abgemeldet.");
      await onSessionRenewed();
    } catch (err) {
      session.renewing = false;
      if (destroyed) return;
      const data = err?.response?.data || {};
      if (statusOf(err) === 400 && data.oldPassword) {
        setFieldError(current.input, current.error, "Das aktuelle Passwort stimmt nicht.");
        current.input.focus();
      } else if (statusOf(err) === 400 && data.password) {
        setFieldError(next.input, next.error, "Dieses Passwort ist nicht erlaubt. Bitte wähle ein anderes.");
        next.input.focus();
      } else {
        handleError(err, "Das Passwort konnte nicht geändert werden.");
      }
    } finally {
      if (!destroyed && savePassword.isConnected) busy(savePassword, false, "Passwort ändern");
    }
  });

  const security = section("Passwort", "Nach der Änderung bleibst du hier angemeldet, alle anderen Geräte werden abgemeldet.",
    passwordForm);

  // -------------------------------------------------------- Darstellung
  const prefs = getPrefs();
  const appearance = section("Darstellung", "Gilt für dieses Gerät.",
    segmented({
      label: "Farbschema",
      value: prefs.theme,
      options: [
        { value: "light", label: "Hell" },
        { value: "dark", label: "Dunkel" },
        { value: "system", label: "System" },
      ],
      onChange: (value) => setPref("theme", value),
    }),
  );

  // --------------------------------------------------------------- Chat
  const enterRow = switchRow({
    label: "Enter sendet die Nachricht",
    description: "Aus: Strg + Enter bzw. ⌘ + Enter sendet, Enter macht eine neue Zeile.",
    checked: prefs.enterToSend,
    onChange: (value) => setPref("enterToSend", value),
  });

  const supported = "Notification" in window;
  const notifyText = () => {
    if (!supported) return "Dieser Browser unterstützt keine Benachrichtigungen.";
    if (Notification.permission === "denied") return "Im Browser blockiert. Erlaube Benachrichtigungen in den Website-Einstellungen.";
    return "Zeigt neue Nachrichten an, wenn Crew im Hintergrund offen ist.";
  };
  const notifyRow = switchRow({
    label: "Desktop-Benachrichtigungen",
    description: notifyText(),
    checked: supported && prefs.notify && Notification.permission === "granted",
    onChange: async (value) => {
      if (!supported) return false;
      if (value && Notification.permission !== "granted") {
        const result = await Notification.requestPermission();
        notifyRow.desc.textContent = notifyText();
        if (result !== "granted") {
          setPref("notify", false);
          return false;
        }
      }
      setPref("notify", value);
      if (value) toast("Benachrichtigungen sind an.");
      return value;
    },
  });
  if (!supported) notifyRow.button.disabled = true;

  const chat = section("Chat", null, enterRow.row, notifyRow.row);

  // ------------------------------------------------------------ Sitzung
  const logoutButton = h("button", { class: "btn btn--soft", type: "button" }, "Abmelden");
  logoutButton.addEventListener("click", () => logout());
  const account = section("Sitzung", "Meldet dich auf diesem Gerät ab.", h("div", {}, logoutButton));

  // ------------------------------------------------------------- Gerüst
  const header = h("header", { class: "channel-header" },
    menuButton,
    h("div", { class: "channel-header__text" },
      h("h1", { class: "channel-header__title" }, "Einstellungen."),
      h("p", { class: "channel-header__desc" }, "Profil, Sicherheit und Darstellung."),
    ),
  );

  const footer = h("footer", { class: "settings-footer" },
    h("p", { class: "settings-footer__brand" }, "Made by Rootex"),
    h("p", { class: "settings-footer__meta" }, "Crew. · Version 1.1"),
  );

  const content = h("div", { class: "settings" }, profile, security, appearance, chat, account, footer);
  const scroller = h("div", { class: "scroller" }, h("div", { class: "scroller__inner" }, content));

  container.replaceChildren(header, scroller);
  document.title = "Einstellungen · Crew.";

  return {
    focus() {
      container.focus({ preventScroll: true });
    },
    async destroy() {
      destroyed = true;
    },
  };
}
