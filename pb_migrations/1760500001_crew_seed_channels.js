/// <reference path="../pb_data/types.d.ts" />

/**
 * Crew – die drei festen Kanäle.
 */
const CHANNELS = [
  { slug: "team", title: "team", description: "Alles, was das ganze Team betrifft.", position: 1 },
  { slug: "peam", title: "peam", description: "Planung, Prozesse und Projekte.", position: 2 },
  { slug: "beam", title: "beam", description: "Ideen, Links und alles dazwischen.", position: 3 },
];

migrate((app) => {
  const collection = app.findCollectionByNameOrId("channels");

  for (const data of CHANNELS) {
    let record;
    try {
      record = app.findFirstRecordByData("channels", "slug", data.slug);
    } catch (_) {
      record = new Record(collection);
    }
    record.set("slug", data.slug);
    record.set("title", data.title);
    record.set("description", data.description);
    record.set("position", data.position);
    app.save(record);
  }
}, (app) => {
  for (const data of CHANNELS) {
    try {
      app.delete(app.findFirstRecordByData("channels", "slug", data.slug));
    } catch (_) {}
  }
});
