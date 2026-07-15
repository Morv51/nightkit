"use strict";

const crypto = require("crypto");

const TTL_MS = 5 * 60 * 1000;
const SWEEP_MS = 60 * 1000;

const store = new Map();

function newId() {
  return crypto.randomBytes(8).toString("hex");
}

// ttlMs: eigene Aufbewahrungszeit fuer diesen Job. Ohne Angabe gilt TTL_MS.
// Noetig fuer Laeufe, die laenger als die Standardfrist brauchen — sonst raeumt der
// Sweeper den Job weg, waehrend er noch arbeitet, und das Polling meldet faelschlich 404.
function create(ttlMs) {
  const id = newId();
  const job = { status: "pending", createdAt: Date.now() };
  if (Number.isFinite(ttlMs) && ttlMs > 0) job.ttlMs = ttlMs;
  store.set(id, job);
  return id;
}

function get(id) {
  return store.get(id) || null;
}

function set(id, patch) {
  const existing = store.get(id);
  if (!existing) return;
  store.set(id, { ...existing, ...patch, updatedAt: Date.now() });
}

function remove(id) {
  store.delete(id);
}

function sweep(now = Date.now()) {
  for (const [id, job] of store) {
    const age = now - (job.updatedAt || job.createdAt);
    if (age > (job.ttlMs || TTL_MS)) store.delete(id);
  }
}

let sweepTimer = null;
function startSweeper() {
  if (sweepTimer) return;
  sweepTimer = setInterval(sweep, SWEEP_MS);
  sweepTimer.unref?.();
}

function stopSweeper() {
  if (!sweepTimer) return;
  clearInterval(sweepTimer);
  sweepTimer = null;
}

module.exports = { create, get, set, remove, sweep, startSweeper, stopSweeper };
