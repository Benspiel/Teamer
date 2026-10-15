/// <reference path="../pb_data/types.d.ts" />

/**
 * Crew – kleine serverseitige Ergänzungen zu den API-Rules.
 */

// Neue Konten bekommen standardmäßig die Rolle "member".
onRecordCreate((e) => {
  if (!e.record.getString("role")) {
    e.record.set("role", "member");
  }
  e.next();
}, "users");

// Wird ein Konto gesperrt, werden alle bestehenden Sitzungen sofort ungültig.
onRecordUpdate((e) => {
  const original = e.record.original();
  if (e.record.getBool("blocked") && !original.getBool("blocked")) {
    e.record.refreshTokenKey();
  }
  e.next();
}, "users");

// Nachrichtentext trimmen, damit reine Leerzeichen an "required" scheitern.
onRecordCreateRequest((e) => {
  e.record.set("body", e.record.getString("body").trim());
  e.next();
}, "messages");

onRecordUpdateRequest((e) => {
  e.record.set("body", e.record.getString("body").trim());
  e.next();
}, "messages");

// ---------------------------------------------------------------- Autoschaden

// Neue Meldungen sind immer offen; Kennzeichen einheitlich schreiben ("b-ab 123" → "B-AB 123").
onRecordCreateRequest((e) => {
  const plate = e.record.getString("plate").trim().replace(/\s+/g, " ").toUpperCase();
  e.record.set("plate", plate);
  e.record.set("description", e.record.getString("description").trim());
  e.record.set("fixed", false);
  e.record.set("fixed_at", "");
  e.record.set("fixed_by", "");
  e.next();
}, "damages");

// "behoben" setzt bzw. löscht automatisch Zeitpunkt und Person.
onRecordUpdateRequest((e) => {
  const before = e.record.original().getBool("fixed");
  const after = e.record.getBool("fixed");
  if (after && !before) {
    e.record.set("fixed_at", new DateTime());
    e.record.set("fixed_by", e.auth ? e.auth.id : "");
  } else if (!after && before) {
    e.record.set("fixed_at", "");
    e.record.set("fixed_by", "");
  }
  e.next();
}, "damages");

// ------------------------------------------------------------------ Bestellen

onRecordCreateRequest((e) => {
  e.record.set("item", e.record.getString("item").trim());
  e.record.set("note", e.record.getString("note").trim());
  e.record.set("done", false);
  e.record.set("done_at", "");
  e.record.set("done_by", "");
  e.next();
}, "orders");

onRecordUpdateRequest((e) => {
  const before = e.record.original().getBool("done");
  const after = e.record.getBool("done");
  if (after && !before) {
    e.record.set("done_at", new DateTime());
    e.record.set("done_by", e.auth ? e.auth.id : "");
  } else if (!after && before) {
    e.record.set("done_at", "");
    e.record.set("done_by", "");
  }
  e.next();
}, "orders");
