#!/usr/bin/env node
/**
 * Prüft die API-Rules gegen eine laufende Crew-Instanz (REST + Realtime).
 *
 *   PB_URL=http://127.0.0.1:8090 \
 *   SU_EMAIL=admin@example.com SU_PASSWORD='…' \
 *   node scripts/check-rules.mjs
 *
 * Legt drei Test-Konten an (Mitglied A, Mitglied B, Admin C), führt die
 * Prüfungen aus und räumt danach wieder auf. Benötigt Node >= 18.
 * Mit CHECK_RATE_LIMIT=1 wird zusätzlich das Login-Rate-Limit geprüft
 * (sperrt die eigene IP danach für ~1 Minute für Logins).
 */

const BASE = (process.env.PB_URL || "http://127.0.0.1:8090").replace(/\/$/, "");
const SU_EMAIL = process.env.SU_EMAIL;
const SU_PASSWORD = process.env.SU_PASSWORD;

if (!SU_EMAIL || !SU_PASSWORD) {
  console.error("SU_EMAIL und SU_PASSWORD setzen.");
  process.exit(2);
}

let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? "  ok  " : "  FAIL"}  ${label}`);
  if (!cond) failures++;
};

async function api(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: token } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

// Jeder Login kommt von einer anderen (simulierten) IP, damit das strenge
// Login-Rate-Limit die Regelprüfungen nicht verfälscht. Funktioniert nur,
// weil PocketBase X-Forwarded-For vertraut (im Betrieb setzt Caddy den Header).
let ipCounter = 1;
async function login(collection, email, password, ip) {
  ip ||= `198.51.100.${(ipCounter++ % 250) + 1}`;
  return api("POST", `/api/collections/${collection}/auth-with-password`, {
    body: { identity: email, password },
    headers: { "x-forwarded-for": ip },
  });
}

/** Öffnet eine Realtime-Verbindung und sammelt Events für `topics`. */
async function realtime(topics, token) {
  const ctrl = new AbortController();
  const res = await fetch(BASE + "/api/realtime", { signal: ctrl.signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";
  let resolveConnect;
  const connected = new Promise((r) => (resolveConnect = r));

  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const ev = {};
          for (const line of chunk.split("\n")) {
            const m = line.match(/^(\w+):(.*)$/);
            if (m) ev[m[1]] = (ev[m[1]] || "") + m[2];
          }
          if (ev.event === "PB_CONNECT") resolveConnect(JSON.parse(ev.data).clientId);
          else if (ev.event) events.push({ topic: ev.event, data: JSON.parse(ev.data) });
        }
      }
    } catch (_) {}
  })();

  const clientId = await connected;
  const sub = await api("POST", "/api/realtime", {
    token,
    body: { clientId, subscriptions: topics },
  });
  return { events, status: sub.status, close: () => ctrl.abort() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now().toString(36);
const PW = "TestPasswort-" + stamp;

async function main() {
  console.log(`Crew rule check gegen ${BASE}\n`);

  const su = await login("_superusers", SU_EMAIL, SU_PASSWORD);
  if (su.status !== 200) throw new Error("Superuser-Login fehlgeschlagen: " + su.status);
  const suToken = su.data.token;

  const mk = async (key, role) => {
    const r = await api("POST", "/api/collections/users/records", {
      token: suToken,
      body: {
        email: `crew-test-${key}-${stamp}@example.invalid`,
        password: PW,
        passwordConfirm: PW,
        name: `Test ${key.toUpperCase()}`,
        verified: true,
        ...(role ? { role } : {}),
      },
    });
    if (r.status !== 200) throw new Error(`User ${key}: ${JSON.stringify(r.data)}`);
    return r.data;
  };

  const created = [];
  try {
    const A = await mk("a"); created.push(A);
    const B = await mk("b"); created.push(B);
    const C = await mk("c", "admin"); created.push(C);

    ok(A.role === "member", "neues Konto bekommt role=member");

    const ta = (await login("users", A.email, PW)).data.token;
    const tb = (await login("users", B.email, PW)).data.token;
    const tc = (await login("users", C.email, PW)).data.token;
    ok(ta && tb && tc, "Login mit E-Mail + Passwort funktioniert");

    const wrong = await login("users", A.email, "falsches-passwort-123");
    ok(wrong.status === 400, "falsches Passwort → 400");
    const unknown = await login("users", "gibtsnicht@example.invalid", "falsches-passwort-123");
    ok(unknown.status === 400 && unknown.data?.message === wrong.data?.message,
      "unbekannte E-Mail → identische Antwort (kein User-Enumeration)");

    // --- Kanäle
    const chans = await api("GET", "/api/collections/channels/records?sort=position", { token: ta });
    const slugs = chans.data.items.map((c) => c.slug).join(",");
    ok(slugs === "team,peam,beam", `genau drei Kanäle in Reihenfolge (${slugs})`);
    const team = chans.data.items[0];
    const peam = chans.data.items[1];

    const guestChans = await api("GET", "/api/collections/channels/records");
    ok(guestChans.data.totalItems === 0, "Gast sieht keine Kanäle");
    const chanCreate = await api("POST", "/api/collections/channels/records", {
      token: ta, body: { slug: "team", title: "x" },
    });
    ok(chanCreate.status === 403, "Mitglied kann keine Kanäle anlegen (403)");

    // --- Realtime-Abos vor dem Schreiben öffnen
    const rtGuest = await realtime(["messages/*"], null);
    const rtB = await realtime(["messages/*"], tb);

    // --- Nachrichten
    const msg = await api("POST", "/api/collections/messages/records", {
      token: ta, body: { channel: team.id, author: A.id, body: "  Hallo vom Regeltest  " },
    });
    ok(msg.status === 200, "A kann Nachricht senden");
    ok(msg.data?.body === "Hallo vom Regeltest", "Text wird serverseitig getrimmt");

    const spoof = await api("POST", "/api/collections/messages/records", {
      token: ta, body: { channel: team.id, author: B.id, body: "fake" },
    });
    ok(spoof.status >= 400, `A kann nicht als B senden (${spoof.status})`);

    const empty = await api("POST", "/api/collections/messages/records", {
      token: ta, body: { channel: team.id, author: A.id, body: "   " },
    });
    ok(empty.status === 400, "leere Nachricht → 400");

    const tooLong = await api("POST", "/api/collections/messages/records", {
      token: ta, body: { channel: team.id, author: A.id, body: "x".repeat(4001) },
    });
    ok(tooLong.status === 400, "4001 Zeichen → 400");

    const guestMsg = await api("POST", "/api/collections/messages/records", {
      body: { channel: team.id, author: A.id, body: "anon" },
    });
    ok(guestMsg.status >= 400, `Gast kann nicht senden (${guestMsg.status})`);

    const guestList = await api("GET", "/api/collections/messages/records");
    ok(guestList.status === 403 || guestList.data?.totalItems === 0, "Gast: Nachrichtenliste leer/403");
    const guestView = await api("GET", `/api/collections/messages/records/${msg.data.id}`);
    ok(guestView.status === 404 || guestView.status === 403, `Gast: Einzelansicht gesperrt (${guestView.status})`);

    await sleep(800);
    ok(rtB.status === 204 && rtB.events.some((e) => e.data.record?.id === msg.data.id),
      "B erhält create-Event per Realtime");
    ok(rtGuest.events.length === 0, "Gast erhält kein Realtime-Event");

    const bEdit = await api("PATCH", `/api/collections/messages/records/${msg.data.id}`, {
      token: tb, body: { body: "gehackt" },
    });
    ok(bEdit.status === 404 || bEdit.status === 403, `B kann fremde Nachricht nicht bearbeiten (${bEdit.status})`);
    const bDel = await api("DELETE", `/api/collections/messages/records/${msg.data.id}`, { token: tb });
    ok(bDel.status === 404 || bDel.status === 403, `B kann fremde Nachricht nicht löschen (${bDel.status})`);

    const aEdit = await api("PATCH", `/api/collections/messages/records/${msg.data.id}`, {
      token: ta, body: { body: "bearbeitet" },
    });
    ok(aEdit.status === 200 && aEdit.data.body === "bearbeitet", "A kann eigene Nachricht bearbeiten");

    const aMove = await api("PATCH", `/api/collections/messages/records/${msg.data.id}`, {
      token: ta, body: { channel: peam.id },
    });
    ok(aMove.status >= 400, `A kann Kanal der Nachricht nicht ändern (${aMove.status})`);
    const aReauthor = await api("PATCH", `/api/collections/messages/records/${msg.data.id}`, {
      token: ta, body: { author: B.id },
    });
    ok(aReauthor.status >= 400, `A kann Autor nicht ändern (${aReauthor.status})`);

    await sleep(500);
    ok(rtB.events.some((e) => e.data.action === "update" && e.data.record?.id === msg.data.id),
      "B erhält update-Event per Realtime");

    const cDel = await api("DELETE", `/api/collections/messages/records/${msg.data.id}`, { token: tc });
    ok(cDel.status === 204, "Admin C kann fremde Nachricht löschen");
    await sleep(500);
    ok(rtB.events.some((e) => e.data.action === "delete" && e.data.record?.id === msg.data.id),
      "B erhält delete-Event per Realtime");
    ok(rtGuest.events.length === 0, "Gast erhält weiterhin kein Realtime-Event");

    rtGuest.close();
    rtB.close();

    const own = await api("POST", "/api/collections/messages/records", {
      token: ta, body: { channel: team.id, author: A.id, body: "meine" },
    });
    const aDel = await api("DELETE", `/api/collections/messages/records/${own.data.id}`, { token: ta });
    ok(aDel.status === 204, "A kann eigene Nachricht löschen");

    // --- users
    const signup = await api("POST", "/api/collections/users/records", {
      body: { email: `signup-${stamp}@example.invalid`, password: PW, passwordConfirm: PW, name: "x" },
    });
    ok(signup.status === 403, `öffentliche Registrierung abgelehnt (${signup.status})`);

    const roleUp = await api("PATCH", `/api/collections/users/records/${A.id}`, {
      token: ta, body: { role: "admin" },
    });
    ok(roleUp.status >= 400, `A kann eigene Rolle nicht ändern (${roleUp.status})`);
    const nameUp = await api("PATCH", `/api/collections/users/records/${A.id}`, {
      token: ta, body: { name: "Test A neu" },
    });
    ok(nameUp.status === 200, "A kann eigenen Namen ändern");
    const otherUp = await api("PATCH", `/api/collections/users/records/${B.id}`, {
      token: ta, body: { name: "x" },
    });
    ok(otherUp.status === 404 || otherUp.status === 403, `A kann B nicht ändern (${otherUp.status})`);
    const userDel = await api("DELETE", `/api/collections/users/records/${A.id}`, { token: ta });
    ok(userDel.status === 403 || userDel.status === 404, `A kann sich nicht selbst löschen (${userDel.status})`);

    const userView = await api("GET", `/api/collections/users/records/${B.id}`, { token: ta });
    ok(userView.status === 200 && !userView.data.email && userView.data.blocked === undefined,
      "andere sehen weder E-Mail noch Sperr-Flag");
    const guestUsers = await api("GET", "/api/collections/users/records");
    ok(guestUsers.data?.totalItems === 0 || guestUsers.status === 403, "Gast sieht keine Nutzer");

    // --- channel_reads
    const now = new Date().toISOString().replace("T", " ");
    const rA = await api("POST", "/api/collections/channel_reads/records", {
      token: ta, body: { user: A.id, channel: team.id, last_read: now },
    });
    ok(rA.status === 200, "A kann eigenen Lesestatus anlegen");
    const rDup = await api("POST", "/api/collections/channel_reads/records", {
      token: ta, body: { user: A.id, channel: team.id, last_read: now },
    });
    ok(rDup.status === 400, "Lesestatus (user, channel) ist eindeutig");
    const rB = await api("POST", "/api/collections/channel_reads/records", {
      token: tb, body: { user: A.id, channel: peam.id, last_read: now },
    });
    ok(rB.status >= 400, `B kann keinen Lesestatus für A anlegen (${rB.status})`);
    const rList = await api("GET", "/api/collections/channel_reads/records", { token: tb });
    ok(rList.data.items.every((r) => r.user === B.id), "B sieht nur eigene Lesestatus");
    const rUpd = await api("PATCH", `/api/collections/channel_reads/records/${rA.data.id}`, {
      token: tb, body: { last_read: now },
    });
    ok(rUpd.status === 404 || rUpd.status === 403, `B kann A's Lesestatus nicht ändern (${rUpd.status})`);

    // --- Sperren
    const block = await api("PATCH", `/api/collections/users/records/${B.id}`, {
      token: suToken, body: { blocked: true },
    });
    ok(block.status === 200, "Superuser kann Konto sperren");
    const blockedLogin = await login("users", B.email, PW);
    ok(blockedLogin.status === 400 || blockedLogin.status === 403, `gesperrtes Konto kann sich nicht anmelden (${blockedLogin.status})`);
    const blockedRefresh = await api("POST", "/api/collections/users/auth-refresh", { token: tb });
    ok(blockedRefresh.status === 401, `altes Token des gesperrten Kontos ist ungültig (${blockedRefresh.status})`);

    if (process.env.CHECK_RATE_LIMIT === "1") {
      let limited = false;
      for (let i = 0; i < 8; i++) {
        const r = await login("users", A.email, "falsches-passwort-123", "203.0.113.7");
        if (r.status === 429) { limited = true; break; }
      }
      ok(limited, "Login-Rate-Limit greift (429)");
    }
  } finally {
    for (const u of created) {
      const msgs = await api("GET",
        `/api/collections/messages/records?perPage=200&filter=${encodeURIComponent(`author="${u.id}"`)}`,
        { token: suToken });
      for (const m of msgs.data?.items || []) {
        await api("DELETE", `/api/collections/messages/records/${m.id}`, { token: suToken });
      }
      await api("DELETE", `/api/collections/users/records/${u.id}`, { token: suToken });
    }
  }

  console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen.` : "\nAlle Prüfungen bestanden.");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
