# Teamer.

Ein schlichter Team-Chat mit genau drei Kanälen – **team**, **peam** und **beam** – auf
[PocketBase](https://pocketbase.io). Ein Go-Binary mit SQLite liefert Auth, REST-API,
Realtime (SSE), API-Rules, Rate-Limiting, Admin-Dashboard und das Frontend. Davor sitzt
Caddy für HTTPS und Security-Header.

Das Design folgt der Mobbin-Sprache: galerieweiß, monochrom, Pillen, 24px-Karten, keine
Schatten. Das einzige Blau ist der Ungelesen-Punkt.

---

## Inhalt

1. [Architektur](#architektur)
2. [Schnellstart lokal (ohne Docker)](#schnellstart-lokal-ohne-docker)
3. [Betrieb mit Docker und HTTPS](#betrieb-mit-docker-und-https)
4. [Konfiguration (.env)](#konfiguration-env)
5. [Benutzerverwaltung](#benutzerverwaltung)
6. [Dashboard absichern](#dashboard-absichern)
7. [Backup und Wiederherstellung](#backup-und-wiederherstellung)
8. [Datenmodell und API-Rules](#datenmodell-und-api-rules)
9. [Sicherheit](#sicherheit)
10. [Tests](#tests)
11. [Annahmen](#annahmen)
12. [Updates](#updates)

---

## Architektur

```
Browser ──HTTPS──▶ Caddy (TLS, CSP & Security-Header, /_/ nur aus erlaubten Netzen)
                     │
                     ▼
                PocketBase 0.40.5
                ├─ REST + Realtime (SSE) + Auth + Rate-Limits
                ├─ pb_migrations/  Schema, API-Rules, Seed der Kanäle, Settings
                ├─ pb_hooks/       kleine Server-Regeln (Rolle, Sperre, Trimmen)
                ├─ pb_public/      statisches Frontend (Vanilla JS, ES-Module)
                └─ pb_data/        SQLite + Uploads (Docker-Volume)
```

Es gibt keinen eigenen Node- oder Express-Server und keinen Build-Schritt. Das Frontend sind
statische Dateien, die PocketBase direkt ausliefert. Saubere URLs wie `/login` und
`/channels/team` funktionieren über den Index-Fallback von PocketBase.

```
/
├─ docker-compose.yml       PocketBase + Caddy
├─ Dockerfile               gepinnte PocketBase-Version, läuft als User 10001
├─ docker-entrypoint.sh     Migrationen → Superuser-Upsert → serve
├─ Caddyfile                HTTPS, CSP, Security-Header, Dashboard-Sperre
├─ .env.example
├─ pb_migrations/
│  ├─ 1760500000_crew_schema.js         Collections + API-Rules
│  ├─ 1760500001_crew_seed_channels.js  team, peam, beam
│  ├─ 1760500002_crew_settings.js       Rate-Limits, Trusted Proxy, App-Name
│  ├─ 1760500003_crew_admin_users.js    Benutzerverwaltung für Admins
│  └─ 1760500004_crew_damages_orders.js Autoschaden + Bestellen
├─ pb_hooks/crew.pb.js      Default-Rolle, Sperre beendet Sitzungen, Text trimmen
├─ pb_public/
│  ├─ index.html
│  ├─ css/tokens.css        nur Design-Tokens
│  ├─ css/app.css           Komponenten (nutzt ausschließlich Tokens)
│  ├─ js/
│  │  ├─ app.js             Einstieg, Routing-Entscheidungen, Auth-Guard
│  │  ├─ router.js          History-API-Router
│  │  ├─ auth.js            Login-Seite, Session prüfen, Abmelden
│  │  ├─ shell.js           Sidebar, Off-Canvas-Menü
│  │  ├─ settings.js        Einstellungen (Profil, Passwort, Darstellung, Chat)
│  │  ├─ users.js           Benutzerverwaltung für Admins
│  │  ├─ damages.js         Autoschaden
│  │  ├─ orders.js          Bestellen
│  │  ├─ forms.js           gemeinsame Formular-Bausteine
│  │  ├─ prefs.js           Geräte-Einstellungen (Theme, Enter, Benachrichtigungen)
│  │  ├─ theme.js           setzt das Farbschema vor dem ersten Rendern
│  │  ├─ channels.js        Kanäle, Lesestatus, Ungelesen-Punkte
│  │  ├─ messages.js        Nachrichtenliste, Composer, Bearbeiten/Löschen
│  │  ├─ realtime.js        SSE-Verbindung, Reconnect, Statuszeile
│  │  ├─ ui.js              DOM-Helfer, Icons, Avatare, Zeiten, Links, Toasts
│  │  ├─ pb.js              PocketBase-Client
│  │  └─ vendor/            PocketBase JS SDK 0.28.1 (ES-Modul, lokal)
│  └─ fonts/                Inter Variable (selbst gehostet, OFL)
└─ scripts/
   ├─ create-user.mjs       Teammitglied anlegen/aktualisieren (CLI)
   └─ check-rules.mjs       prüft API-Rules per REST und Realtime
```

---

## Autoschaden und Bestellen

Unter den Kanälen stehen in der Sidebar zwei weitere Bereiche:

**Autoschaden** (`/autoschaden`)
- Schaden melden: **Kennzeichen** und **Beschreibung**. Das Kennzeichen wird einheitlich
  großgeschrieben gespeichert („b-ab 123“ → „B-AB 123“).
- **Nutzer sehen nur ihre eigenen Meldungen, Admins sehen alle** (mit Namen der meldenden Person).
- **Als behoben markieren** bzw. **Wieder öffnen** können die meldende Person und Admins.
  Wer und wann, trägt der Server ein („Behoben von … · Heute, 14:32“).
- Kennzeichen und Beschreibung sind nach dem Melden nicht mehr änderbar. Löschen können
  die meldende Person und Admins.
- Filter: Offen / Behoben / Alle.

**Bestellen** (`/bestellen`)
- Standort **Büro 1, Büro 2 oder Büro 3** wählen (die letzte Wahl wird gemerkt), dazu
  Artikel, Menge und optional eine Notiz.
- **Alle sehen alle Bestellungen.**
- Nur **Admins** markieren eine Bestellung als **erledigt** (oder öffnen sie wieder) und
  können Bestellungen löschen. Eigene offene Bestellungen kann man **zurückziehen**.
- Filter nach Status (Offen / Erledigt / Alle) und Standort.

Beide Listen aktualisieren sich live, wenn jemand anderes etwas ändert. Angezeigt werden
jeweils die neuesten 200 Einträge.

---

## Einstellungen für Nutzer

Ein Klick auf den eigenen Avatar bzw. Namen unten in der Sidebar öffnet `/settings`:

| Bereich | Inhalt | Gespeichert |
|---|---|---|
| **Profil** | Profilbild hochladen/entfernen (JPG, PNG, WebP, GIF, max. 2 MB), Name ändern, E-Mail und Rolle ansehen | PocketBase |
| **Passwort** | aktuelles Passwort + neues Passwort (min. 10 Zeichen) zweimal. Danach bleibt man auf diesem Gerät angemeldet, alle anderen Geräte werden abgemeldet. | PocketBase |
| **Darstellung** | Farbschema Hell / Dunkel / System (Dark Mode als reine Inversion) | dieses Gerät |
| **Chat** | „Enter sendet die Nachricht“ (aus: Strg/⌘ + Enter sendet), Desktop-Benachrichtigungen | dieses Gerät |
| **Sitzung** | Abmelden | – |

Unten steht „Made by Rootex“ und die Version.

Desktop-Benachrichtigungen erscheinen, solange Crew in einem Tab offen ist (im Hintergrund
oder in einem anderen Kanal). Echte Push-Nachrichten bei geschlossenem Browser gibt es
nicht. E-Mail und Rolle kann nur ein Admin im Dashboard ändern.

---

## Schnellstart lokal (ohne Docker)

1. PocketBase **0.40.5** für dein System von
   <https://github.com/pocketbase/pocketbase/releases/tag/v0.40.5> laden und das Binary
   `pocketbase` in den Projektordner legen.
2. Superuser anlegen (wendet dabei auch alle Migrationen an):
   ```sh
   ./pocketbase superuser upsert admin@example.com 'ein-langes-passwort'
   ```
3. Starten:
   ```sh
   ./pocketbase serve
   ```
   PocketBase findet `pb_migrations/`, `pb_hooks/` und `pb_public/` automatisch im
   Arbeitsverzeichnis.
4. Ein Teammitglied anlegen (siehe [Benutzerverwaltung](#benutzerverwaltung)), dann
   <http://127.0.0.1:8090> öffnen.

Ohne Caddy fehlen lokal die Security-Header (CSP usw.). Für einen realistischen Test
`DOMAIN=localhost` in der `.env` setzen und Docker verwenden (Caddy nutzt dann ein lokales
Zertifikat).

---

## Betrieb mit Docker und HTTPS

Voraussetzungen: ein Server mit Docker (Compose v2), eine Domain, deren A/AAAA-Record auf
den Server zeigt, und offene Ports **80** und **443** (TCP, für HTTP/3 auch 443/UDP).

```sh
cp .env.example .env
# DOMAIN, ACME_EMAIL, PB_SUPERUSER_EMAIL/PASSWORD und PB_ENCRYPTION_KEY setzen
docker compose up -d --build
docker compose logs -f
```

Beim Start passiert:

1. `pocketbase migrate up` legt alle Collections, Rules, die drei Kanäle und die
   Rate-Limits an (idempotent).
2. `pocketbase superuser upsert "$PB_SUPERUSER_EMAIL" "$PB_SUPERUSER_PASSWORD"` legt den
   Superuser an bzw. setzt dessen Passwort (übersprungen, wenn die Variablen leer sind).
3. `pocketbase serve` startet ohne Dev-Modus, ohne Auto-Migrationen und mit CORS nur für
   die eigene Domain.

Caddy holt automatisch ein Let's-Encrypt-Zertifikat, leitet HTTP auf HTTPS um und setzt die
Security-Header. PocketBase selbst ist **nicht öffentlich** erreichbar, nur über Caddy und
auf dem Host unter `127.0.0.1:8090`.

Der Container läuft als unprivilegierter User (UID 10001), mit read-only Dateisystem,
ohne Capabilities und mit `no-new-privileges`. Beschreibbar ist nur das Volume `pb_data`.

> Das Dockerfile lädt das offizielle Release-ZIP von GitHub. Optional lässt sich die
> Prüfsumme pinnen: `docker compose build --build-arg PB_SHA256=<sha256 aus checksums.txt>`.

---

## Konfiguration (.env)

| Variable | Pflicht | Bedeutung |
|---|---|---|
| `DOMAIN` | ja | Öffentliche Domain, z. B. `crew.example.com`. Lokal: `localhost`. |
| `ACME_EMAIL` | ja | Kontakt-E-Mail für Let's Encrypt. |
| `PB_SUPERUSER_EMAIL` | beim ersten Start | E-Mail des Superusers. |
| `PB_SUPERUSER_PASSWORD` | beim ersten Start | Passwort des Superusers. Wird bei **jedem** Start gesetzt, solange es in der `.env` steht. Nach dem ersten Start darf es entfernt werden. |
| `PB_ENCRYPTION_KEY` | empfohlen | Genau 32 Zeichen (`openssl rand -hex 16`). Verschlüsselt Einstellungen wie SMTP-/S3-Zugänge in `pb_data`. Danach nicht mehr ändern. |
| `ADMIN_ALLOWED_IPS` | nein | Netze, die das Dashboard `/_/` über die Domain erreichen dürfen. Standard `private_ranges`. |
| `PB_LOCAL_PORT` | nein | Lokaler Port (nur 127.0.0.1) für direkten Zugriff, Standard `8090`. |

Die `.env` steht in `.gitignore` und gehört nie ins Repository.

---

## Benutzerverwaltung

Es gibt **keine öffentliche Registrierung**. Konten legt ein Admin in der App oder ein Superuser im Dashboard an.

### Superuser anlegen

Automatisch über die `.env` (siehe oben) oder manuell:

```sh
# Docker
docker compose run --rm pocketbase superuser upsert admin@example.com 'langes-passwort'
# lokal
./pocketbase superuser upsert admin@example.com 'langes-passwort'
```

### Teammitglied anlegen

**In der App (empfohlen):** Wer die Rolle `admin` hat, sieht in der Sidebar über dem eigenen
Konto den Bereich **Benutzer** (`/users`). Dort:

- **Neues Konto:** Name, E-Mail, Startpasswort (wird zufällig erzeugt, mindestens 10 Zeichen)
  und Rolle eingeben. Nach dem Anlegen werden die Zugangsdaten **einmal** angezeigt, mit
  Kopieren-Button zum Weitergeben.
- **Alle Konten:** Übersicht mit E-Mail, Rolle und Status. Pro Konto gibt es
  **Passwort neu** (setzt ein neues Zufallspasswort und zeigt es an), **Zum Admin** bzw.
  **Zum Mitglied** und **Sperren** bzw. **Entsperren**. Jede Aktion fragt einmal nach
  („Wirklich …?“).
- Das eigene Konto lässt sich dort nicht ändern (kein Selbst-Sperren oder -Herabstufen).
  Das eigene Passwort ändert man in den Einstellungen.

Den **ersten Admin** legst du im Dashboard an (oder per Skript mit Rolle `admin`).

**Im Dashboard** (`https://DOMAIN/_/` bzw. per SSH-Tunnel, siehe unten):

1. Als Superuser anmelden.
2. Links **Collections → users** öffnen, oben **New record**.
3. `email`, `password` und `passwordConfirm` (mindestens 10 Zeichen), `name` ausfüllen.
4. `role`: `member` (Standard, wird bei leerem Feld automatisch gesetzt) oder `admin`.
5. `verified` aktivieren und speichern.

`admin` darf zusätzlich fremde Nachrichten löschen und Konten verwalten (siehe oben).

**Per Skript** (Node ≥ 18, nutzt die REST-API mit Superuser-Login; legt an oder
aktualisiert, falls die E-Mail schon existiert):

```sh
PB_URL=http://127.0.0.1:8090 SU_EMAIL=admin@example.com SU_PASSWORD='…' \
  node scripts/create-user.mjs mia@team.de 'mindestens-10-zeichen' "Mia Wagner" member
```

### Passwort zurücksetzen

- **Dashboard:** Collections → users → Konto öffnen → bei *Password* auf **Change password**,
  neues Passwort zweimal eingeben, speichern. Alle bestehenden Sitzungen des Kontos werden
  dabei ungültig.
- **Skript:** `create-user.mjs` mit derselben E-Mail und neuem Passwort erneut aufrufen.
- Mails zum Selbst-Zurücksetzen sind ohne SMTP-Konfiguration nicht aktiv (Dashboard →
  Settings → Mail settings), und die App bietet dafür bewusst keinen Link an.

### Konto sperren

In der App unter **Benutzer → Sperren** (als Admin) oder im Dashboard → Collections → users →
Konto öffnen → Feld **blocked** aktivieren → speichern.

- Login ist sofort nicht mehr möglich (`authRule: blocked = false`).
- Ein Hook erneuert den Token-Schlüssel des Kontos. Damit werden alle offenen Sitzungen
  sofort ungültig, und die Realtime-Verbindung verliert ihre Berechtigung. Die App merkt
  das bei der nächsten Aktion und zeigt die Login-Seite.
- Entsperren: Häkchen wieder entfernen.

Mitglieder können das Feld `blocked` nicht ändern, auch nicht beim eigenen Konto.

### Konto löschen

Nachrichten verweisen über eine Pflicht-Relation auf ihren Autor. Ein Konto mit Nachrichten
kann PocketBase deshalb nicht löschen („part of a required relation reference“). Optionen:

- **Empfohlen:** Konto **sperren**. Der Verlauf bleibt lesbar.
- Oder zuerst die Nachrichten des Kontos löschen (Collections → messages → Filter
  `author = "<id>"` → alle markieren → Delete), danach das Konto. Lesestatus
  (`channel_reads`) werden automatisch mitgelöscht.

---

## Dashboard absichern

Das Dashboard `/_/` ist im Betrieb nur über Caddy erreichbar und zusätzlich auf
`ADMIN_ALLOWED_IPS` beschränkt (Standard: private Netze, also LAN oder VPN). Alle anderen
bekommen ein 404.

Zugriff von unterwegs ohne Freigabe: per **SSH-Tunnel** auf den lokalen Port.

```sh
ssh -L 8090:127.0.0.1:8090 user@server
# dann im Browser: http://127.0.0.1:8090/_/
```

Eine feste IP freigeben: `ADMIN_ALLOWED_IPS="private_ranges 203.0.113.10/32"`, dann
`docker compose up -d caddy`.

Hinweis: Damit Caddy die echte Client-IP sieht, muss Docker die Quell-IP erhalten. Das ist
beim Standard-Port-Publishing unter Linux der Fall. Hinter einem weiteren Load-Balancer
müsste `trusted_proxies` in Caddy gesetzt werden.

Zusätzlich lässt sich in PocketBase unter **Settings → Application → Superuser IPs** eine
IP-Allowlist setzen. Wenn du das nutzt, die Docker-Netze nicht aussperren.

---

## Backup und Wiederherstellung

Alle Daten (SQLite-Datenbanken und Uploads wie Avatare) liegen im Volume `crew_pb_data`
(im Container `/pb/pb_data`).

**Variante A: eingebaute Backups (online, ohne Downtime)**
Dashboard → **Settings → Backups** → *Initialize new backup*. Die ZIP-Datei landet in
`pb_data/backups` und lässt sich dort herunterladen. Unter *Backups options* gibt es
automatische Backups per Cron, optional direkt in einen S3-Bucket. Wiederherstellen geht
in derselben Ansicht über *Restore*.

**Variante B: Volume sichern (kurze Downtime, ganz einfach)**

```sh
docker compose stop pocketbase
docker run --rm -v crew_pb_data:/data:ro -v "$PWD":/backup alpine \
  tar czf /backup/pb_data-$(date +%F).tar.gz -C /data .
docker compose start pocketbase
```

Wiederherstellen:

```sh
docker compose stop pocketbase
docker run --rm -v crew_pb_data:/data -v "$PWD":/backup alpine \
  sh -c 'rm -rf /data/* && tar xzf /backup/pb_data-YYYY-MM-DD.tar.gz -C /data && chown -R 10001:10001 /data'
docker compose start pocketbase
```

Backups regelmäßig an einen anderen Ort kopieren und gelegentlich eine Wiederherstellung
testen. `PB_ENCRYPTION_KEY` gehört mit ins Backup-Konzept (getrennt aufbewahren). Ohne ihn
lassen sich verschlüsselte Einstellungen nicht mehr lesen.

---

## Datenmodell und API-Rules

| Collection | Felder |
|---|---|
| `users` (Auth) | `email`, `password` (min. 10), `name` (Pflicht, max. 80), `avatar` (Bild, max. 2 MB, Thumbs 72×72/144×144), `role` (`admin`/`member`), `blocked` |
| `channels` | `slug` (unique, nur `team`/`peam`/`beam`), `title`, `description`, `position` |
| `messages` | `channel` → channels (Pflicht, kein Cascade), `author` → users (Pflicht), `body` (1–4000), `created`, `updated`; Index `(channel, created)` |
| `channel_reads` | `user` → users, `channel` → channels, `last_read` (Datum); Unique-Index `(user, channel)` |
| `damages` | `reporter` → users, `plate` (max. 20), `description` (max. 2000), `fixed`, `fixed_at`, `fixed_by` → users |
| `orders` | `requester` → users, `location` (`Büro 1`/`Büro 2`/`Büro 3`), `item` (max. 200), `quantity` (1–9999), `note` (max. 1000), `done`, `done_at`, `done_by` → users |

`null` heißt „nur Superuser“. Ein leerer String würde jeden zulassen und kommt nirgends vor.

| Collection | list / view | create | update | delete |
|---|---|---|---|---|
| users | `@request.auth.id != ""` | `@request.auth.role = "admin"` | `(id = @request.auth.id && @request.body.role:isset = false && @request.body.blocked:isset = false && @request.body.emailVisibility:isset = false) \|\| (@request.auth.role = "admin" && id != @request.auth.id)` | `null` |
| channels | `@request.auth.id != ""` | `null` | `null` | `null` |
| messages | `@request.auth.id != ""` | `@request.auth.id != "" && @request.body.author = @request.auth.id` | `author = @request.auth.id && @request.body.author:isset = false && @request.body.channel:isset = false` | `author = @request.auth.id \|\| @request.auth.role = "admin"` |
| damages | `reporter = @request.auth.id \|\| @request.auth.role = "admin"` | `@request.auth.id != "" && @request.body.reporter = @request.auth.id` | Melder oder Admin, **nur** `fixed` (alle anderen Felder `:isset = false`) | Melder oder Admin |
| orders | `@request.auth.id != ""` | `@request.auth.id != "" && @request.body.requester = @request.auth.id` | nur Admin, **nur** `done` | eigene offene (`requester = @request.auth.id && done = false`) oder Admin |
| channel_reads | `user = @request.auth.id` | `@request.auth.id != "" && @request.body.user = @request.auth.id` | `user = @request.auth.id && @request.body.user:isset = false && @request.body.channel:isset = false` | `user = @request.auth.id` |

Zusätzlich gilt für `users`: `authRule = blocked = false` und
`manageRule = @request.auth.role = "admin" && id != @request.auth.id`. Admins dürfen also andere
Konten verwalten (Passwort ohne altes Passwort setzen, E-Mail sehen), aber nicht sich selbst. Nur
Passwort-Login ist aktiv (OAuth2, OTP und MFA sind aus). Die Realtime-Abos prüfen dieselben
list/view-Rules: Ohne Login kommen keine Events an.

**Ungelesen-Logik:** Ein Kanal ist ungelesen, wenn
`channel = X && created > last_read && author != ich` mindestens einen Treffer hat
(`getList(1, 1)` → `totalItems`). `last_read` wird immer auf den `created`-Zeitstempel der
neuesten gesehenen Nachricht gesetzt, also auf Server-Zeit statt Client-Uhr. Live-Updates kommen
über ein zweites, schlankes Abo auf alle Nachrichten.

---

## Sicherheit

- **API-Rules** wie oben; geprüft mit `scripts/check-rules.mjs` (REST und Realtime, Gast,
  fremdes Konto, Admin).
- **Rate-Limits** (pro Client-IP, per Migration gesetzt):

  | Label | Limit |
  |---|---|
  | `*:auth` (Login) | 5 pro 60 s |
  | `*:requestPasswordReset` | 3 pro 300 s |
  | `*:authRefresh` | 10 pro 60 s |
  | `*:create`, `*:update`, `*:delete` | je 30 pro 60 s |
  | `*:file` | 300 pro 60 s |
  | `/api/batch` | 3 pro 1 s (Batch-API ist ohnehin aus) |
  | `/api/` | 300 pro 10 s |

  PocketBase liest die echte IP aus `X-Forwarded-For` (rechtester Eintrag, gesetzt von
  Caddy). Caddy überschreibt gefälschte Header von außen. Deshalb darf PocketBase nie direkt
  öffentlich erreichbar sein, sonst ließe sich das Limit per Header umgehen.
  Hinweis: Teilen sich viele Teammitglieder eine öffentliche IP (Büro-NAT), gilt das
  Login-Limit für alle gemeinsam. Bei Bedarf in Settings → Rate limiting anpassen.
- **XSS:** Das Token liegt (SDK-Standard) im `localStorage`, darum ist XSS das Hauptrisiko.
  Gegenmaßnahmen:
  - Nutzertext wird nur über Text-Nodes gerendert, nie über `innerHTML`.
  - Links werden nur für `http(s)` erzeugt, mit `rel="noopener noreferrer nofollow"`.
  - Keine externen Skripte, Fonts oder CDNs.
  - Strikte CSP von Caddy: `default-src 'self'`, ohne `unsafe-inline` und ohne `unsafe-eval`.
  - Keine Inline-Styles. Die Composer-Höhe wird über CSSOM gesetzt, was CSP-konform ist.
- **Header (Caddy):** `Content-Security-Policy` (inkl. `frame-ancestors 'none'`),
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`,
  `Strict-Transport-Security`, `Cross-Origin-Opener-Policy`, `Permissions-Policy`.
- **HTTPS** wird von Caddy erzwungen (automatische Zertifikate, HTTP → HTTPS).
- **Passwörter**: mindestens 10 Zeichen, von PocketBase mit bcrypt gehasht.
- **Login-Fehler** sind neutral („E-Mail oder Passwort stimmt nicht.“) und verraten nicht,
  ob eine E-Mail existiert.
- **E-Mail-Adressen** sind für andere unsichtbar (`emailVisibility = false`, und Nutzer können
  das nicht selbst umschalten).
- **Secrets** stehen nur in `.env`. Mitgeliefert wird nur `.env.example`.

---

## Tests

**API-Rules (REST und Realtime)** gegen eine laufende Instanz. Legt drei Test-Konten an
und räumt danach auf:

```sh
PB_URL=http://127.0.0.1:8090 SU_EMAIL=admin@example.com SU_PASSWORD='…' \
  node scripts/check-rules.mjs
# zusätzlich das Login-Rate-Limit prüfen (sperrt die eigene IP ~1 Minute):
CHECK_RATE_LIMIT=1 … node scripts/check-rules.mjs
```

Das Skript nutzt pro Login eine simulierte IP über `X-Forwarded-For`. Das funktioniert nur
beim direkten Zugriff auf PocketBase, nicht über Caddy.

Geprüft werden unter anderem:

- Gast sieht weder Nachrichten noch Kanäle noch Nutzer, per REST und per Realtime.
- Signup wird abgelehnt.
- Fremde Nachrichten lassen sich nicht ändern oder löschen; Admins dürfen löschen.
- Autor und Kanal einer Nachricht sind nicht änderbar.
- Die eigene Rolle ist nicht änderbar.
- Lesestatus sind privat.
- Gesperrte Konten können sich nicht anmelden, und ihre alten Tokens sind ungültig.
- Leere Nachrichten und solche über 4000 Zeichen werden abgelehnt.

---

## Annahmen

- **Delete-Rule für messages:** In der Vorgabe war die Zelle abgeschnitten (`author =
  @request.auth.id …`). Vermutlich wurde ein `||` als Tabellentrenner gelesen. Umgesetzt ist
  `author = @request.auth.id || @request.auth.role = "admin"`. Das Feld `role` bekommt
  damit eine Funktion: Admins können fremde Nachrichten moderieren (in der UI erscheint dann
  nur „Löschen“).
- **Strengere users-Update-Rule:** Neben `role` sind auch `blocked` und `emailVisibility`
  für Nutzer gesperrt.
- **Konto sperren:** Dafür gibt es das zusätzliche, versteckte Bool-Feld `blocked` plus
  `authRule`. PocketBase hat kein eingebautes „deaktiviert“.
- **Default `member`** setzt ein Hook, weil Select-Felder in PocketBase keinen Default haben.
- **Nachrichtentext** wird serverseitig getrimmt (Hook), damit reine Leerzeichen am
  Pflichtfeld scheitern.
- **PocketBase 0.40.5** (aktuelles stabiles Release vom 08.10.2026), **JS SDK 0.28.1**,
  **Caddy 2.11.7**, **Alpine 3.22**.
- **Zeitstempel:** Die Zeiten der Nachrichten sind 12 px groß und `--text-muted` (#707070),
  wie in der Komponenten-Vorgabe. Das Kontrastverhältnis von 4,95 : 1 erfüllt WCAG AA auch
  unterhalb von 14 px.
- **Relative Zeit:** „gerade eben“, „vor 5 Min.“, „vor 2 Std.“. Ältere Nachrichten zeigen die
  Uhrzeit, weil der Tag schon im Datumstrenner steht. Das genaue Datum steht im Tooltip.
- **Löschen** fragt inline nach („Löschen? Abbrechen / Löschen“) statt mit einem Dialog.
- **Dark Mode** ist umgesetzt, aber Standard bleibt hell. Umschalten in den Einstellungen.
- **Profilbild-Upload** (optional) ist umgesetzt, in den Einstellungen.
- **Ältere Nachrichten** werden per Cursor (`created <` älteste geladene) statt per
  Seitennummer geladen. So verrutscht nichts, wenn währenddessen neue Nachrichten kommen.
  Das Nachladen startet automatisch beim Hochscrollen, der Button „Ältere laden“ bleibt als
  Alternative.
- Nach einem **Reconnect** wird die neueste Seite neu geladen und mit dem lokalen Stand
  abgeglichen, inklusive zwischenzeitlich gelöschter Nachrichten. PocketBase trennt
  inaktive SSE-Verbindungen nach einigen Minuten. Die Statuszeile erscheint deshalb erst,
  wenn der Reconnect länger als 1,5 s dauert.

---

## Updates

1. Changelog von PocketBase lesen (<https://github.com/pocketbase/pocketbase/blob/master/CHANGELOG.md>).
2. **Backup** machen.
3. `PB_VERSION` in `docker-compose.yml` (Build-Arg) und `image:`-Tag anpassen.
4. `docker compose up -d --build` und danach `scripts/check-rules.mjs` laufen lassen.

Lizenzen: PocketBase und PocketBase JS SDK (MIT), Inter (SIL OFL 1.1,
`pb_public/fonts/Inter-OFL.txt`), Icons nach Lucide (ISC).
