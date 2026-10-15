/// <reference path="../pb_data/types.d.ts" />

/**
 * Crew – Benutzerverwaltung für Admins (role = "admin").
 *
 * - Admins dürfen Konten anlegen (createRule).
 * - Admins dürfen ANDERE Konten verwalten: Name, Rolle, Sperre und Passwort
 *   ohne altes Passwort (updateRule + manageRule). Das eigene Konto ändern
 *   auch Admins nur wie alle anderen (Rolle/Sperre bleiben gesperrt), damit
 *   sich niemand versehentlich selbst aussperrt oder herabstuft.
 * - Admins sehen die E-Mail-Adressen der verwalteten Konten.
 * - "blocked" ist nicht mehr versteckt: Versteckte Felder kann in PocketBase
 *   nur ein Superuser setzen. Mitglieder dürfen das Feld weiterhin nicht ändern.
 * - Löschen bleibt dem Superuser vorbehalten (Konten mit Nachrichten lassen
 *   sich ohnehin nicht löschen – stattdessen sperren).
 */
const SELF_UPDATE =
  "id = @request.auth.id && @request.body.role:isset = false && @request.body.blocked:isset = false && @request.body.emailVisibility:isset = false";
const ADMIN_OTHERS = '@request.auth.role = "admin" && id != @request.auth.id';

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");

  users.createRule = '@request.auth.role = "admin"';
  users.updateRule = `(${SELF_UPDATE}) || (${ADMIN_OTHERS})`;
  users.manageRule = ADMIN_OTHERS;

  users.fields.getByName("blocked").hidden = false;

  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");

  users.createRule = null;
  users.updateRule = SELF_UPDATE;
  users.manageRule = null;

  users.fields.getByName("blocked").hidden = true;

  app.save(users);
});
