/**
 * Realtime-Verbindung (SSE über das PocketBase SDK).
 *
 * - Zeigt bei Verbindungsabbruch eine dezente Statuszeile.
 * - Meldet erfolgreiche Reconnects, damit Verlauf und Ungelesen-Status
 *   neu geladen werden (Events während der Trennung gehen sonst verloren).
 *
 * PocketBase trennt inaktive SSE-Verbindungen nach einigen Minuten; das SDK
 * verbindet sofort neu. Die Statuszeile erscheint deshalb erst, wenn der
 * Reconnect nicht innerhalb kurzer Zeit gelingt.
 */

import { pb } from "./pb.js";

const BANNER_DELAY = 1500;

const reconnectListeners = new Set();
const statusListeners = new Set();

let started = false;
let hasConnected = false;
let disconnected = false;
let bannerTimer = 0;
let unsubscribeConnect = null;

function setStatus(offline) {
  for (const fn of statusListeners) fn(offline);
}

export function onConnectionStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

export function onReconnect(fn) {
  reconnectListeners.add(fn);
  return () => reconnectListeners.delete(fn);
}

export async function startRealtime() {
  if (started) return;
  started = true;
  hasConnected = false;
  disconnected = false;

  pb.realtime.onDisconnect = (activeSubscriptions) => {
    // Leere Liste = gewolltes Abmelden, kein Fehler.
    if (!started || !activeSubscriptions.length) return;
    disconnected = true;
    window.clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => {
      if (disconnected) setStatus(true);
    }, BANNER_DELAY);
  };

  unsubscribeConnect = await pb.realtime.subscribe("PB_CONNECT", () => {
    window.clearTimeout(bannerTimer);
    setStatus(false);
    if (hasConnected && disconnected) {
      for (const fn of reconnectListeners) {
        try { fn(); } catch (err) { console.error(err); }
      }
    }
    hasConnected = true;
    disconnected = false;
  });
}

export async function stopRealtime() {
  started = false;
  window.clearTimeout(bannerTimer);
  setStatus(false);
  pb.realtime.onDisconnect = undefined;
  try { await unsubscribeConnect?.(); } catch (_) {}
  unsubscribeConnect = null;
  reconnectListeners.clear();
}

/**
 * Abonniert messages mit Filter. Gibt eine Funktion zum Abbestellen zurück.
 * Nutzt bewusst die vom SDK gelieferte Unsubscribe-Funktion, damit andere
 * Abos auf dasselbe Topic ("*") erhalten bleiben.
 */
export async function subscribeMessages(callback, options) {
  return pb.collection("messages").subscribe("*", callback, options);
}

