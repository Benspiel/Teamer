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
