/// <reference path="../pb_data/types.d.ts" />

/**
 * Crew – Autoschäden und Bestellungen.
 *
 * damages (Autoschaden)
 *   - Jeder meldet Schäden mit Kennzeichen + Beschreibung.
 *   - Nutzer sehen nur ihre eigenen Meldungen, Admins sehen alle.
 *   - "behoben" dürfen Melder und Admins setzen bzw. zurücknehmen.
 *     Andere Felder sind nach dem Melden nicht mehr änderbar.
 *
 * orders (Bestellen)
 *   - Jeder bestellt für einen der drei Standorte.
 *   - Alle sehen alle Bestellungen.
 *   - Nur Admins setzen "erledigt". Eigene offene Bestellungen kann man
 *     zurückziehen (löschen).
 *
 * Wer/wann erledigt bzw. behoben hat, setzt pb_hooks/crew.pb.js – nicht der Client.
 */
const ADMIN = '@request.auth.role = "admin"';
const LOCATIONS = ["Büro 1", "Büro 2", "Büro 3"];

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");

  // ------------------------------------------------------------- damages
  const damages = new Collection({
    type: "base",
    name: "damages",
    listRule: `reporter = @request.auth.id || ${ADMIN}`,
    viewRule: `reporter = @request.auth.id || ${ADMIN}`,
    createRule: '@request.auth.id != "" && @request.body.reporter = @request.auth.id',
    // Nur der Status ist änderbar – vom Melder oder von Admins.
    updateRule: `(reporter = @request.auth.id || ${ADMIN})`
      + " && @request.body.reporter:isset = false"
      + " && @request.body.plate:isset = false"
      + " && @request.body.description:isset = false"
      + " && @request.body.fixed_at:isset = false"
      + " && @request.body.fixed_by:isset = false",
    deleteRule: `reporter = @request.auth.id || ${ADMIN}`,
    fields: [
      { name: "reporter", type: "relation", required: true, collectionId: users.id, cascadeDelete: false, maxSelect: 1 },
      { name: "plate", type: "text", required: true, min: 1, max: 20 },
      { name: "description", type: "text", required: true, min: 1, max: 2000 },
      { name: "fixed", type: "bool" },
      { name: "fixed_at", type: "date" },
      { name: "fixed_by", type: "relation", collectionId: users.id, cascadeDelete: false, maxSelect: 1 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE INDEX idx_damages_reporter ON damages (reporter, created)",
      "CREATE INDEX idx_damages_fixed ON damages (fixed, created)",
    ],
  });
  app.save(damages);

  // -------------------------------------------------------------- orders
  const orders = new Collection({
    type: "base",
    name: "orders",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != "" && @request.body.requester = @request.auth.id',
    // Nur Admins, und nur der Status.
    updateRule: ADMIN
      + " && @request.body.requester:isset = false"
      + " && @request.body.location:isset = false"
      + " && @request.body.item:isset = false"
      + " && @request.body.quantity:isset = false"
      + " && @request.body.note:isset = false"
      + " && @request.body.done_at:isset = false"
      + " && @request.body.done_by:isset = false",
    deleteRule: `(requester = @request.auth.id && done = false) || ${ADMIN}`,
    fields: [
      { name: "requester", type: "relation", required: true, collectionId: users.id, cascadeDelete: false, maxSelect: 1 },
      { name: "location", type: "select", required: true, values: LOCATIONS, maxSelect: 1 },
      { name: "item", type: "text", required: true, min: 1, max: 200 },
      { name: "quantity", type: "number", required: true, onlyInt: true, min: 1, max: 9999 },
      { name: "note", type: "text", max: 1000 },
      { name: "done", type: "bool" },
      { name: "done_at", type: "date" },
      { name: "done_by", type: "relation", collectionId: users.id, cascadeDelete: false, maxSelect: 1 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE INDEX idx_orders_done ON orders (done, created)",
      "CREATE INDEX idx_orders_location ON orders (location, created)",
    ],
  });
  app.save(orders);
}, (app) => {
  for (const name of ["orders", "damages"]) {
    try {
      app.delete(app.findCollectionByNameOrId(name));
    } catch (_) {}
  }
});
