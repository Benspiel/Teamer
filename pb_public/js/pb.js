import PocketBase from "./vendor/pocketbase.es.mjs";

/** Ein gemeinsamer PocketBase-Client (gleiche Origin wie die App). */
export const pb = new PocketBase(window.location.origin);

// Parallele Requests (z. B. Ungelesen-Zähler für alle Kanäle) nicht gegenseitig abbrechen.
pb.autoCancellation(false);

/** Laufender Passwortwechsel: altes Token wird kurz ungültig, kein Auto-Logout. */
export const session = { renewing: false };

/** Aktuell angemeldeter User (oder null). */
export function me() {
  return pb.authStore.isValid ? pb.authStore.record : null;
}

export function isAuthed() {
  return pb.authStore.isValid && !!pb.authStore.record;
}

/** Wandelt PocketBase-Datumsstrings ("2026-10-15 06:38:55.464Z") in Date um. */
export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  return new Date(String(value).replace(" ", "T"));
}

/** Fehlerstatus aus einem ClientResponseError (0 = Netzwerkfehler). */
export function statusOf(err) {
  return typeof err?.status === "number" ? err.status : 0;
}

/** true, wenn der Fehler nur ein abgebrochener Request ist. */
export function isAbort(err) {
  return !!err?.isAbort;
}
