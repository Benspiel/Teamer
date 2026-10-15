/**
 * Login-Seite, Abmelden, Session-Prüfung.
 */

import { pb, isAuthed, statusOf } from "./pb.js";
import { h, icon } from "./ui.js";

const NOTICE_KEY = "crew.notice";

/** Hinweis für die nächste Login-Seite merken (übersteht den Redirect). */
export function setLoginNotice(text) {
  try { sessionStorage.setItem(NOTICE_KEY, text); } catch (_) {}
}

function takeLoginNotice() {
  try {
    const text = sessionStorage.getItem(NOTICE_KEY);
    sessionStorage.removeItem(NOTICE_KEY);
    return text;
  } catch (_) {
    return null;
  }
}

/**
 * Beim App-Start: Token erneuern, damit abgelaufene oder gesperrte Konten
 * sauber rausfliegen. Netzwerkfehler lassen die Session bestehen (offline).
 */
export async function refreshSession() {
  if (!pb.authStore.token) return;
  if (!pb.authStore.isValid) {
    pb.authStore.clear();
    setLoginNotice("Bitte melde dich neu an.");
    return;
  }
  try {
    await pb.collection("users").authRefresh();
  } catch (err) {
    const status = statusOf(err);
    if (status === 401 || status === 403 || status === 404) {
      pb.authStore.clear();
      setLoginNotice("Bitte melde dich neu an.");
    }
  }
}

/**
 * Prüft, ob die Session serverseitig noch gültig ist (z. B. nach Sperrung
 * oder nach einem Reconnect). Ein 401 löst über pb.afterSend den Logout aus.
 * Gibt false zurück, wenn die Session sicher ungültig ist.
 */
export async function verifySession() {
  if (!pb.authStore.isValid) return false;
  try {
    await pb.collection("users").authRefresh();
    return true;
  } catch (err) {
    const status = statusOf(err);
    if (status === 401 || status === 403 || status === 404) {
      await logout("Bitte melde dich neu an.");
      return false;
    }
    return true; // offline o. Ä.: Session behalten
  }
}

/** Abmelden: Realtime schließen, Token löschen. Redirect übernimmt app.js (authStore.onChange). */
export async function logout(notice) {
  if (notice) setLoginNotice(notice);
  try { await pb.realtime.unsubscribe(); } catch (_) {}
  pb.authStore.clear();
}

function messageForLoginError(err) {
  const status = statusOf(err);
  if (status === 429) return "Zu viele Versuche. Bitte warte eine Minute und versuch es dann erneut.";
  if (status === 403) return "Anmeldung nicht möglich. Wende dich an deinen Admin.";
  if (status === 0) return "Keine Verbindung zum Server. Bitte versuch es erneut.";
  if (status >= 500) return "Da ist etwas schiefgelaufen. Bitte versuch es erneut.";
  // 400 = falsche Zugangsdaten. Bewusst neutral: verrät nicht, ob die E-Mail existiert.
  return "E-Mail oder Passwort stimmt nicht.";
}

function errorLine(id, cls) {
  return h("p", { id, class: cls, hidden: true });
}

function showError(node, text) {
  node.replaceChildren(icon("alert"), h("span", {}, text));
  node.hidden = false;
}

function hideError(node) {
  node.hidden = true;
  node.replaceChildren();
}

/** Rendert die Login-Seite in root. onSuccess wird nach erfolgreichem Login aufgerufen. */
export function renderLogin(root, onSuccess) {
  document.title = "Anmelden · Crew.";

  const notice = takeLoginNotice();

  const emailError = errorLine("email-error", "field-error");
  const passwordError = errorLine("password-error", "field-error");
  const formError = errorLine("form-error", "form-error");
  formError.setAttribute("role", "alert");

  const email = h("input", {
    id: "email",
    class: "input",
    type: "email",
    name: "email",
    autocomplete: "username",
    inputmode: "email",
    autocapitalize: "none",
    spellcheck: "false",
    placeholder: "du@team.de",
    "aria-describedby": "email-error",
  });

  const password = h("input", {
    id: "password",
    class: "input",
    type: "password",
    name: "password",
    autocomplete: "current-password",
    placeholder: "Passwort",
    "aria-describedby": "password-error",
  });

  const toggle = h("button", {
    class: "input-wrap__toggle",
    type: "button",
    "aria-label": "Passwort anzeigen",
    "aria-pressed": "false",
    "aria-controls": "password",
  }, icon("eye"));

  toggle.addEventListener("click", () => {
    const show = password.type === "password";
    password.type = show ? "text" : "password";
    toggle.setAttribute("aria-pressed", String(show));
    toggle.setAttribute("aria-label", show ? "Passwort verbergen" : "Passwort anzeigen");
    toggle.replaceChildren(icon(show ? "eye-off" : "eye"));
  });

  const submit = h("button", { class: "btn btn--primary btn--block", type: "submit" }, "Anmelden");

  const form = h("form", { class: "form", novalidate: true, "aria-describedby": "form-error" },
    h("div", { class: "field" },
      h("label", { class: "field__label", for: "email" }, "E-Mail"),
      email,
      emailError,
    ),
    h("div", { class: "field" },
      h("label", { class: "field__label", for: "password" }, "Passwort"),
      h("div", { class: "input-wrap" }, password, toggle),
      passwordError,
    ),
    formError,
    submit,
  );

  const setInvalid = (input, errorNode, text) => {
    if (text) {
      input.setAttribute("aria-invalid", "true");
      showError(errorNode, text);
    } else {
      input.removeAttribute("aria-invalid");
      hideError(errorNode);
    }
  };

  email.addEventListener("input", () => setInvalid(email, emailError, null));
  password.addEventListener("input", () => setInvalid(password, passwordError, null));

  let busy = false;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;

    hideError(formError);
    const emailValue = email.value.trim();
    const passwordValue = password.value;

    setInvalid(email, emailError, emailValue ? null : "Bitte gib deine E-Mail-Adresse ein.");
    setInvalid(password, passwordError, passwordValue ? null : "Bitte gib dein Passwort ein.");
    if (!emailValue) return email.focus();
    if (!passwordValue) return password.focus();

    busy = true;
    submit.disabled = true;
    submit.setAttribute("aria-busy", "true");
    submit.textContent = "Wird angemeldet …";

    try {
      await pb.collection("users").authWithPassword(emailValue, passwordValue);
      if (isAuthed()) onSuccess();
    } catch (err) {
      showError(formError, messageForLoginError(err));
      password.value = "";
      password.focus();
    } finally {
      busy = false;
      if (submit.isConnected) {
        submit.disabled = false;
        submit.removeAttribute("aria-busy");
        submit.textContent = "Anmelden";
      }
    }
  });

  const noticeNode = notice
    ? h("p", { class: "notice", role: "status" }, icon("alert"), h("span", {}, notice))
    : null;

  const page = h("main", { id: "main", class: "auth-page", tabindex: "-1" },
    h("section", { class: "card", "aria-labelledby": "login-title" },
      h("div", { class: "card__head" },
        h("p", { class: "wordmark" }, "Crew."),
        h("h1", { id: "login-title", class: "card__title" }, "Willkommen zurück."),
        h("p", { class: "card__subtitle" }, "Melde dich mit deinem Team-Konto an."),
      ),
      noticeNode,
      form,
      h("p", { class: "card__hint" }, "Noch kein Konto? Frag deinen Admin."),
    ),
  );

  root.replaceChildren(page);
  email.focus();
}
