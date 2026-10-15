/// <reference path="../pb_data/types.d.ts" />

/**
 * Crew – Kanäle heißen Chat 1, 2 und 3 (Slugs und URLs bleiben).
 */
const TITLES = [
  ["team", "Chat 1", "team"],
  ["peam", "Chat 2", "peam"],
  ["beam", "Chat 3", "beam"],
];

function setTitles(app, index) {
  for (const row of TITLES) {
    try {
      const record = app.findFirstRecordByData("channels", "slug", row[0]);
      record.set("title", row[index]);
      app.save(record);
    } catch (_) {}
  }
}

migrate((app) => setTitles(app, 1), (app) => setTitles(app, 2));
