/// <reference path="../pb_data/types.d.ts" />

/**
 * Crew – App-Einstellungen: Rate-Limits, Trusted Proxy, Meta.
 *
 * Rate-Limits gelten pro Client-IP. Da PocketBase hinter Caddy läuft,
 * wird die echte IP aus X-Forwarded-For gelesen (rechtester Eintrag,
 * den Caddy selbst setzt).
 */
migrate((app) => {
  const settings = app.settings();

  settings.meta.appName = "Crew";
  const appURL = $os.getenv("APP_URL");
  if (appURL) {
    settings.meta.appURL = appURL;
  }

  settings.trustedProxy.headers = ["X-Forwarded-For"];
  settings.trustedProxy.useLeftmostIP = false;

  settings.rateLimits.enabled = true;
  settings.rateLimits.rules = [
    // Login: streng, 5 Versuche pro Minute und IP.
    { label: "*:auth", maxRequests: 5, duration: 60 },
    { label: "*:requestPasswordReset", maxRequests: 3, duration: 300 },
    { label: "*:authRefresh", maxRequests: 10, duration: 60 },
    // Schreiben: moderat.
    { label: "*:create", maxRequests: 30, duration: 60 },
    { label: "*:update", maxRequests: 30, duration: 60 },
    { label: "*:delete", maxRequests: 30, duration: 60 },
    // Datei-Downloads (Avatare) und allgemeine API.
    { label: "*:file", maxRequests: 300, duration: 60 },
    { label: "/api/batch", maxRequests: 3, duration: 1 },
    { label: "/api/", maxRequests: 300, duration: 10 },
  ];

  app.save(settings);
}, (app) => {
  const settings = app.settings();
  settings.rateLimits.enabled = false;
  settings.trustedProxy.headers = [];
  app.save(settings);
});
