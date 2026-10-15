/**
 * Kanäle, Lesestatus (channel_reads) und Ungelesen-Punkte.
 *
 * Ungelesen = es gibt in einem Kanal eine Nachricht mit
 *   created > last_read && author != ich
 * last_read wird immer auf den Zeitstempel der neuesten gesehenen Nachricht
 * gesetzt (Server-Zeit), nie auf die Client-Uhr.
 */

import { pb, me } from "./pb.js";
import { subscribeMessages } from "./realtime.js";

let channels = [];
const reads = new Map(); // channelId -> { id, last_read }
const unread = new Set(); // channelIds
const listeners = new Set();
const pendingReads = new Map(); // channelId -> Promise
let activeChannelId = null;
let unsubscribe = null;

function emit() {
  for (const fn of listeners) fn();
}

export function onUnreadChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getChannels() {
  return channels;
}

export function findChannel(slug) {
  return channels.find((c) => c.slug === slug) || null;
}

export function hasUnread(channelId) {
  return unread.has(channelId);
}

export function setActiveChannel(channelId) {
  activeChannelId = channelId;
  if (unread.delete(channelId)) emit();
}

export async function loadChannels() {
  channels = await pb.collection("channels").getFullList({ sort: "position,slug" });
  return channels;
}

async function loadReads() {
  const user = me();
  if (!user) return;
  const list = await pb.collection("channel_reads").getFullList({
    filter: pb.filter("user = {:user}", { user: user.id }),
  });
  reads.clear();
  for (const r of list) reads.set(r.channel, { id: r.id, last_read: r.last_read });
}

async function checkUnread(channel) {
  const user = me();
  if (!user || channel.id === activeChannelId) return false;
  const read = reads.get(channel.id);
  let filter = pb.filter("channel = {:channel} && author != {:me}", { channel: channel.id, me: user.id });
  if (read?.last_read) filter += " && " + pb.filter("created > {:t}", { t: read.last_read });
  const res = await pb.collection("messages").getList(1, 1, { filter, fields: "id" });
  return res.totalItems > 0;
}

/** Lädt Lesestatus und berechnet alle Ungelesen-Punkte neu. */
export async function refreshUnread() {
  await loadReads();
  const results = await Promise.all(channels.map((c) => checkUnread(c).catch(() => false)));
  unread.clear();
  channels.forEach((c, i) => results[i] && unread.add(c.id));
  emit();
}

/**
 * Markiert einen Kanal bis einschließlich `created` als gelesen.
 * Ohne Nachricht (leerer Kanal) gibt es nichts zu markieren.
 */
export async function markRead(channelId, created) {
  const user = me();
  if (!user || !created) return;

  // Pro Kanal nacheinander schreiben, damit kein doppelter Datensatz entsteht.
  const previous = pendingReads.get(channelId) || Promise.resolve();
  const next = previous.then(async () => {
    const current = reads.get(channelId);
    if (current?.last_read && current.last_read >= created) return;
    try {
      if (current?.id) {
        const rec = await pb.collection("channel_reads").update(current.id, { last_read: created });
        reads.set(channelId, { id: rec.id, last_read: rec.last_read });
      } else {
        const rec = await pb.collection("channel_reads").create({
          user: user.id,
          channel: channelId,
          last_read: created,
        });
        reads.set(channelId, { id: rec.id, last_read: rec.last_read });
      }
    } catch (_) {
      // z. B. Unique-Konflikt aus einem zweiten Tab: Stand neu laden, beim nächsten Mal klappt es.
      await loadReads().catch(() => {});
    }
  });
  pendingReads.set(channelId, next.catch(() => {}));
  return next;
}

/** Ein Abo auf alle Nachrichten – nur für die Punkte in der Sidebar. */
export async function startUnreadTracking() {
  await stopUnreadTracking();
  unsubscribe = await subscribeMessages((event) => {
    const user = me();
    const rec = event.record;
    if (!user || !rec) return;
    if (event.action === "create") {
      if (rec.channel !== activeChannelId && rec.author !== user.id && !unread.has(rec.channel)) {
        unread.add(rec.channel);
        emit();
      }
    } else if (event.action === "delete" && unread.has(rec.channel)) {
      const channel = channels.find((c) => c.id === rec.channel);
      if (!channel) return;
      checkUnread(channel).then((has) => {
        if (!has && unread.delete(channel.id)) emit();
      }).catch(() => {});
    }
  }, { fields: "id,channel,author,created" });
}

export async function stopUnreadTracking() {
  try { await unsubscribe?.(); } catch (_) {}
  unsubscribe = null;
}

export function resetChannels() {
  channels = [];
  reads.clear();
  unread.clear();
  pendingReads.clear();
  listeners.clear();
  activeChannelId = null;
}
