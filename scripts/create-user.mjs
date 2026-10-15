#!/usr/bin/env node
/**
 * Legt ein Teammitglied an (oder setzt bei vorhandener E-Mail Name/Passwort/Rolle neu).
 *
 *   PB_URL=https://crew.example.com SU_EMAIL=… SU_PASSWORD=… \
 *   node scripts/create-user.mjs <email> <passwort> "<Name>" [member|admin]
 *
 * Nutzt die REST-API mit Superuser-Login. Benötigt Node >= 18.
 */

const BASE = (process.env.PB_URL || "http://127.0.0.1:8090").replace(/\/$/, "");
const { SU_EMAIL, SU_PASSWORD } = process.env;
const [email, password, name, role = "member"] = process.argv.slice(2);

if (!SU_EMAIL || !SU_PASSWORD || !email || !password || !name) {
  console.error('Aufruf: SU_EMAIL=… SU_PASSWORD=… node scripts/create-user.mjs <email> <passwort> "<Name>" [member|admin]');
  process.exit(2);
}
if (!["member", "admin"].includes(role)) {
  console.error('Rolle muss "member" oder "admin" sein.');
  process.exit(2);
}
if (password.length < 10) {
  console.error("Das Passwort braucht mindestens 10 Zeichen.");
  process.exit(2);
}

async function api(method, path, token, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const auth = await api("POST", "/api/collections/_superusers/auth-with-password", null, {
  identity: SU_EMAIL,
  password: SU_PASSWORD,
});

const filter = encodeURIComponent(`email = "${email.replace(/["\\]/g, "")}"`);
const existing = await api("GET", `/api/collections/users/records?filter=${filter}&perPage=1`, auth.token);
const data = { email, name, role, password, passwordConfirm: password, verified: true, emailVisibility: false };

if (existing.items.length) {
  const user = await api("PATCH", `/api/collections/users/records/${existing.items[0].id}`, auth.token, data);
  console.log(`Aktualisiert: ${user.email} (${user.role}, id ${user.id})`);
} else {
  const user = await api("POST", "/api/collections/users/records", auth.token, data);
  console.log(`Angelegt: ${user.email} (${user.role}, id ${user.id})`);
}
