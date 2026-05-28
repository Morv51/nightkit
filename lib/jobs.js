"use strict";

const crypto = require("crypto");

const TTL_MS = 5 * 60 * 1000;
const SWEEP_MS = 60 * 1000;

const store = new Map();

function newId() {
  return crypto.randomBytes(8).toString("hex");
}

function create() {
  const id = newId();
  store.set(id, { status: "pending", createdAt: Date.now() });
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
    if (age > TTL_MS) store.delete(id);
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
