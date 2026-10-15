/// <reference path="../pb_data/types.d.ts" />

/**
 * Crew – Schema und API-Rules.
 *
 * Legt channels, messages und channel_reads an und erweitert die eingebaute
 * users-Collection. Alle Rules folgen der Tabelle in der README
 * ("API-Rules"). `null` = nur Superuser, niemals "" (= öffentlich).
 */
migrate((app) => {
  // ---------------------------------------------------------------- users
  const users = app.findCollectionByNameOrId("users");

  users.listRule = '@request.auth.id != ""';
  users.viewRule = '@request.auth.id != ""';
  users.createRule = null; // keine öffentliche Registrierung
  users.updateRule =
    'id = @request.auth.id && @request.body.role:isset = false && @request.body.blocked:isset = false && @request.body.emailVisibility:isset = false';
  users.deleteRule = null;
  users.manageRule = null;
  // Gesperrte Konten können sich weder anmelden noch ihr Token erneuern.
  users.authRule = "blocked = false";

  users.passwordAuth.enabled = true;
  users.passwordAuth.identityFields = ["email"];
  users.oauth2.enabled = false;
  users.otp.enabled = false;
  users.mfa.enabled = false;

  const password = users.fields.getByName("password");
  password.min = 10;

  const name = users.fields.getByName("name");
  name.required = true;
  name.min = 1;
  name.max = 80;

  const avatar = users.fields.getByName("avatar");
  avatar.maxSelect = 1;
  avatar.maxSize = 2 * 1024 * 1024;
  avatar.mimeTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  avatar.thumbs = ["72x72", "144x144"];

  users.fields.add(new SelectField({
    name: "role",
    values: ["admin", "member"],
    maxSelect: 1,
    required: false, // Default "member" setzt pb_hooks/crew.pb.js
  }));

  users.fields.add(new BoolField({
    name: "blocked",
    hidden: true, // für normale Nutzer unsichtbar
  }));

  app.save(users);

  // ------------------------------------------------------------- channels
  const channels = new Collection({
    type: "base",
    name: "channels",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "slug", type: "text", required: true, pattern: "^(team|peam|beam)$", max: 20 },
      { name: "title", type: "text", required: true, max: 80 },
      { name: "description", type: "text", max: 280 },
      { name: "position", type: "number", onlyInt: true },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_channels_slug ON channels (slug)",
    ],
  });
  app.save(channels);

  // ------------------------------------------------------------- messages
  const messages = new Collection({
    type: "base",
    name: "messages",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != "" && @request.body.author = @request.auth.id',
    updateRule:
      'author = @request.auth.id && @request.body.author:isset = false && @request.body.channel:isset = false',
    deleteRule: 'author = @request.auth.id || @request.auth.role = "admin"',
    fields: [
      {
        name: "channel",
        type: "relation",
        required: true,
        collectionId: channels.id,
        cascadeDelete: false,
        maxSelect: 1,
      },
      {
        name: "author",
        type: "relation",
        required: true,
        collectionId: users.id,
        cascadeDelete: false,
        maxSelect: 1,
      },
      { name: "body", type: "text", required: true, min: 1, max: 4000 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE INDEX idx_messages_channel_created ON messages (channel, created)",
    ],
  });
  app.save(messages);

  // -------------------------------------------------------- channel_reads
  const reads = new Collection({
    type: "base",
    name: "channel_reads",
    listRule: "user = @request.auth.id",
    viewRule: "user = @request.auth.id",
    createRule: '@request.auth.id != "" && @request.body.user = @request.auth.id',
    updateRule:
      "user = @request.auth.id && @request.body.user:isset = false && @request.body.channel:isset = false",
    deleteRule: "user = @request.auth.id",
    fields: [
      {
        name: "user",
        type: "relation",
        required: true,
        collectionId: users.id,
        cascadeDelete: true,
        maxSelect: 1,
      },
      {
        name: "channel",
        type: "relation",
        required: true,
        collectionId: channels.id,
        cascadeDelete: true,
        maxSelect: 1,
      },
      { name: "last_read", type: "date" },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_channel_reads_user_channel ON channel_reads (user, channel)",
    ],
  });
  app.save(reads);
}, (app) => {
  for (const name of ["channel_reads", "messages", "channels"]) {
    try {
      app.delete(app.findCollectionByNameOrId(name));
    } catch (_) {}
  }

  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("role");
  users.fields.removeByName("blocked");
  users.authRule = "";
  users.listRule = "id = @request.auth.id";
  users.viewRule = "id = @request.auth.id";
  users.updateRule = "id = @request.auth.id";
  users.deleteRule = "id = @request.auth.id";
  users.createRule = "";
  app.save(users);
});
