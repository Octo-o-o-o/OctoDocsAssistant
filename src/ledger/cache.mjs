import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { ensureDir } from '../utils/fs.mjs';
import { readLedger, splitLedger } from './store.mjs';
import { renderProjectViews } from '../render/project.mjs';

export function cachePath(root) {
  return join(root, '.octodocs', 'cache.sqlite');
}

function openCache(root) {
  return new Database(cachePath(root));
}

export async function rebuildCache(root) {
  await ensureDir(join(root, '.octodocs'));
  await rm(cachePath(root), { force: true });
  const records = await readLedger(root);
  const ledger = splitLedger(records);
  const db = openCache(root);
  try {
    db.exec(`
      PRAGMA journal_mode = DELETE;
      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        doc_status TEXT NOT NULL,
        tombstone INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        json TEXT NOT NULL
      );
      CREATE INDEX documents_path_idx ON documents(path);
      CREATE TABLE evidences (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        relation TEXT NOT NULL,
        path TEXT,
        symbol TEXT,
        json TEXT NOT NULL
      );
      CREATE INDEX evidences_relation_idx ON evidences(relation);
      CREATE TABLE claims (
        id TEXT PRIMARY KEY,
        subject TEXT NOT NULL,
        kind TEXT NOT NULL,
        intent TEXT NOT NULL,
        implementation TEXT NOT NULL,
        verification TEXT NOT NULL,
        lifecycle TEXT NOT NULL,
        confidence REAL NOT NULL,
        json TEXT NOT NULL
      );
      CREATE TABLE claim_aliases (
        alias TEXT PRIMARY KEY,
        claim_id TEXT NOT NULL
      );
      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        ts TEXT NOT NULL,
        source TEXT NOT NULL,
        type TEXT NOT NULL,
        change_fingerprint TEXT NOT NULL UNIQUE,
        json TEXT NOT NULL
      );
    `);
    const insertDoc = db.prepare('INSERT OR REPLACE INTO documents VALUES (@id, @path, @doc_status, @tombstone, @content_hash, @json)');
    const insertEvidence = db.prepare('INSERT OR REPLACE INTO evidences VALUES (@id, @kind, @relation, @path, @symbol, @json)');
    const insertClaim = db.prepare('INSERT OR REPLACE INTO claims VALUES (@id, @subject, @kind, @intent, @implementation, @verification, @lifecycle, @confidence, @json)');
    const insertAlias = db.prepare('INSERT OR REPLACE INTO claim_aliases VALUES (@alias, @claim_id)');
    const insertEvent = db.prepare('INSERT OR IGNORE INTO events VALUES (@id, @ts, @source, @type, @change_fingerprint, @json)');
    const transaction = db.transaction(() => {
      for (const doc of ledger.documents) {
        insertDoc.run({ ...doc, tombstone: doc.tombstone ? 1 : 0, json: JSON.stringify(doc) });
      }
      for (const ev of ledger.evidences) {
        insertEvidence.run({ id: ev.id, kind: ev.kind, relation: ev.relation, path: ev.path || null, symbol: ev.symbol || null, json: JSON.stringify(ev) });
      }
      for (const claim of ledger.claims) {
        insertClaim.run({ ...claim, json: JSON.stringify(claim) });
        for (const alias of claim.aliases || []) insertAlias.run({ alias, claim_id: claim.id });
      }
      for (const event of ledger.events) {
        insertEvent.run({ id: event.id, ts: event.ts, source: event.source, type: event.type, change_fingerprint: event.change_fingerprint, json: JSON.stringify(event) });
      }
    });
    transaction();
  } finally {
    db.close();
  }
  return {
    documents: ledger.documents.length,
    evidences: ledger.evidences.length,
    claims: ledger.claims.length,
    events: ledger.events.length,
    path: '.octodocs/cache.sqlite'
  };
}

export function queryCacheCounts(root) {
  const db = openCache(root);
  try {
    const tables = ['documents', 'evidences', 'claims', 'events'];
    return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
  } finally {
    db.close();
  }
}

export async function rebuildFromLedger(root, options = {}) {
  const cache = await rebuildCache(root);
  const render = await renderProjectViews(root, options);
  return { cache, render };
}
