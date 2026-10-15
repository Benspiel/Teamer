<hr>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <img src="assets/logo-light.svg" alt="Teamer" width="420">
  </picture>
</p>

<hr>

<p align="center">
  <b>Drei Kanäle. Ein Team. Kein Ballast.</b><br>
  Ein <b>schlichter, sicherer Team-Chat</b> mit Kfz-Meldungen und Bestellungen – <b>selbst gehostet</b> auf PocketBase.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/backend-PocketBase%200.40-2f6bff?style=for-the-badge&labelColor=555" alt="PocketBase 0.40">
  <img src="https://img.shields.io/badge/realtime-SSE-2f6bff?style=for-the-badge&labelColor=555" alt="Realtime per SSE">
  <img src="https://img.shields.io/badge/https-Caddy-2f6bff?style=for-the-badge&labelColor=555" alt="HTTPS mit Caddy">
  <img src="https://img.shields.io/badge/deploy-Docker-2f6bff?style=for-the-badge&labelColor=555" alt="Docker">
  <img src="https://img.shields.io/badge/build-keiner-2f6bff?style=for-the-badge&labelColor=555" alt="Kein Build-Schritt">
  <img src="https://img.shields.io/badge/stack-HTML%20%C2%B7%20CSS%20%C2%B7%20JS-2f6bff?style=for-the-badge&labelColor=555" alt="HTML CSS JS">
</p>

---

## ✨ Was Teamer kann

| | |
|---|---|
| 💬 **Drei feste Kanäle** | **Chat 1**, **Chat 2** und **Chat 3** – kein Kanal-Wildwuchs, keine Threads, einfach schreiben. |
| ⚡ **Live in Echtzeit** | Nachrichten, Lesestatus und Ungelesen-Punkte aktualisieren sich sofort per Server-Sent Events – inklusive automatischem Reconnect. |
| 🚗 **Kfz-Meldungen** | Schäden mit Kennzeichen und Beschreibung melden, als behoben markieren, nach Offen / Behoben filtern. Nutzer sehen ihre eigenen, Admins alle Meldungen. |
| 📦 **Bestellen** | Artikel, Menge und Notiz für **Büro 1–3** anfragen. Alle sehen alle Bestellungen, Admins haken sie als erledigt ab. |
| 👥 **Benutzerverwaltung** | Admins legen Konten direkt in der App an, setzen Passwörter neu, vergeben Rollen und sperren Konten – Sitzungen enden dabei sofort. |
| 🎨 **Ruhiges Design** | Galerieweiß, monochrom, Pillen und 24px-Karten. Das einzige Blau ist der Ungelesen-Punkt. Dark Mode inklusive. |
| 🔔 **Benachrichtigungen** | Desktop-Benachrichtigungen, solange Teamer in einem Tab offen ist. „Enter sendet“ frei einstellbar. |
| 🔒 **Sicher ab Werk** | Strikte CSP, Rate-Limits, keine öffentliche Registrierung, keine externen Skripte oder CDNs, gesperrtes Admin-Dashboard. |

---

## 🚀 Loslegen

### Mit Docker (empfohlen)

Voraussetzung: ein Server mit Docker Compose v2, eine Domain und offene Ports **80/443**.

```bash
git clone https://github.com/Benspiel/Teamer.git
cd Teamer
cp .env.example .env      # DOMAIN, ACME_EMAIL, Superuser und PB_ENCRYPTION_KEY eintragen
docker compose up -d --build
```

Caddy holt automatisch ein Let's-Encrypt-Zertifikat. Migrationen, Kanäle und Rate-Limits werden beim Start angelegt.

### Lokal ohne Docker

```bash
# PocketBase 0.40.5 herunterladen und das Binary in den Projektordner legen
./pocketbase superuser upsert admin@example.com 'ein-langes-passwort'
./pocketbase serve
```

Dann <http://127.0.0.1:8090> öffnen. Das erste Konto legst du im Dashboard unter `/_/` an.

> 💡 Es gibt **keine öffentliche Registrierung**. Konten erstellt ein Admin in der App unter **Benutzer** oder per `scripts/create-user.mjs`.

---

## 🧠 Wie das funktioniert

Kein eigener Node-Server, kein Build-Schritt: **ein einziges PocketBase-Binary** liefert Auth, API, Realtime und das Frontend aus. Davor sitzt Caddy für HTTPS und Security-Header.

```
 Browser ──HTTPS──► Caddy  (TLS · CSP · Security-Header · /_/ nur aus erlaubten Netzen)
                      │
                      ▼
                 PocketBase 0.40.5
                 ├─ REST + Realtime (SSE) + Auth + Rate-Limits
                 ├─ pb_migrations/   Schema, API-Rules, Kanäle, Settings
                 ├─ pb_hooks/        Rolle, Sperre, Text trimmen
                 ├─ pb_public/       Frontend (Vanilla JS, ES-Module)
                 └─ pb_data/         SQLite + Uploads (Docker-Volume)
```

<details>
<summary><b>🔐 Sicherheit im Detail</b></summary>

<br>

- **API-Rules** für jede Collection – geprüft per `scripts/check-rules.mjs` über REST *und* Realtime (Gast, fremdes Konto, Admin).
- **Rate-Limits** pro Client-IP: z. B. 5 Logins pro Minute, 30 Schreibzugriffe pro Minute.
- **XSS-Schutz:** Nutzertext wird nur über Text-Nodes gerendert, Links nur für `http(s)` mit `rel="noopener noreferrer nofollow"`.
- **Strikte CSP** (`default-src 'self'`, ohne `unsafe-inline`/`unsafe-eval`), dazu HSTS, `X-Frame-Options: DENY`, `nosniff` und mehr.
- **Konten sperren** erneuert den Token-Schlüssel – alle offenen Sitzungen und Realtime-Verbindungen verlieren sofort ihre Berechtigung.
- **Container-Härtung:** unprivilegierter User, read-only Dateisystem, keine Capabilities, `no-new-privileges`.
- **E-Mail-Adressen** sind für andere Nutzer unsichtbar, Login-Fehler verraten nicht, ob ein Konto existiert.

</details>

<details>
<summary><b>🗄️ Datenmodell</b></summary>

<br>

| Collection | Zweck |
|---|---|
| `users` | Konten mit Name, Avatar, Rolle (`admin` / `member`) und Sperr-Flag |
| `channels` | Die drei Kanäle Chat 1–3 (Slugs `team`, `peam`, `beam`) |
| `messages` | Nachrichten (1–4000 Zeichen) mit Autor und Kanal |
| `channel_reads` | Privater Lesestatus pro Nutzer und Kanal |
| `damages` | Kfz-Meldungen mit Kennzeichen und Behoben-Status |
| `orders` | Bestellungen mit Standort, Artikel, Menge und Erledigt-Status |

</details>

---

## 🗂️ Projektstruktur

```
├── docker-compose.yml     # PocketBase + Caddy
├── Dockerfile             # gepinnte PocketBase-Version, läuft als User 10001
├── Caddyfile              # HTTPS, CSP, Security-Header, Dashboard-Sperre
├── pb_migrations/         # Schema, API-Rules, Seeds, Settings
├── pb_hooks/              # kleine Server-Regeln
├── pb_public/             # Frontend: HTML, Design-Tokens, ES-Module, Inter-Font
└── scripts/               # create-user.mjs, check-rules.mjs
```

---

## 📚 Dokumentation

Alles zu Konfiguration, Benutzerverwaltung, Cloudflare Tunnel, Backups, API-Rules, Tests und Updates steht im **[Handbuch](docs/HANDBUCH.md)**.

| Thema | Link |
|---|---|
| ⚙️ Konfiguration (`.env`) | [Handbuch → Konfiguration](docs/HANDBUCH.md#konfiguration-env) |
| 👤 Benutzer anlegen, sperren, löschen | [Handbuch → Benutzerverwaltung](docs/HANDBUCH.md#benutzerverwaltung) |
| ☁️ Betrieb mit Cloudflare Tunnel | [Handbuch → Cloudflare Tunnel](docs/HANDBUCH.md#betrieb-mit-cloudflare-tunnel) |
| 💾 Backup & Wiederherstellung | [Handbuch → Backup](docs/HANDBUCH.md#backup-und-wiederherstellung) |
| 🧪 Tests der API-Rules | [Handbuch → Tests](docs/HANDBUCH.md#tests) |
| 🔄 PocketBase aktualisieren | [Handbuch → Updates](docs/HANDBUCH.md#updates) |

---

## 🙏 Danksagung

- [PocketBase](https://pocketbase.io) und das PocketBase JS SDK (MIT)
- [Caddy](https://caddyserver.com) für automatisches HTTPS
- [Inter](https://rsms.me/inter/) als selbst gehostete Schrift (SIL OFL 1.1)
- Icons nach [Lucide](https://lucide.dev) (ISC)

<p align="center"><sub>Made by Rootex · Mit 💬 und PocketBase gebaut.</sub></p>
