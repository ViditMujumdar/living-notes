/**
 * Persistent storage for public shares.
 * Uses Node's built-in SQLite (node:sqlite, Node >= 22.13) with the file under DATA_DIR.
 * Falls back to an atomic JSON file in DATA_DIR if node:sqlite is unavailable.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { SharePayload } from '../shared/schema';

export interface ShareRecord extends Omit<SharePayload, 'image'> { image: string | null }

export interface Store {
  kind: 'sqlite' | 'json';
  putShare(rec: ShareRecord): Promise<void>;
  getShare(id: string): Promise<ShareRecord | null>;
}

export async function createStore(dataDir: string): Promise<Store> {
  fs.mkdirSync(dataDir, { recursive: true });
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path.join(dataDir, 'living-notes.db'));
    db.exec(`PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS shares (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        title TEXT NOT NULL,
        payload TEXT NOT NULL,
        image TEXT
      );`);
    const ins = db.prepare('INSERT INTO shares (id, created_at, title, payload, image) VALUES (?, ?, ?, ?, ?)');
    const sel = db.prepare('SELECT id, created_at, title, payload, image FROM shares WHERE id = ?');
    return {
      kind: 'sqlite',
      async putShare(r) {
        ins.run(r.id, r.createdAt, r.title, JSON.stringify({ config: r.config, summary: r.summary, assumptions: r.assumptions }), r.image);
      },
      async getShare(id) {
        const row = sel.get(id) as { id: string; created_at: string; title: string; payload: string; image: string | null } | undefined;
        if (!row) return null;
        const p = JSON.parse(row.payload);
        return { id: row.id, createdAt: row.created_at, title: row.title, config: p.config, summary: p.summary, assumptions: p.assumptions, image: row.image };
      },
    };
  } catch {
    const file = path.join(dataDir, 'shares.json');
    let data: Record<string, ShareRecord> = {};
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* new */ }
    const write = () => { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp, file); };
    return {
      kind: 'json',
      async putShare(r) { data[r.id] = r; write(); },
      async getShare(id) { return data[id] ?? null; },
    };
  }
}
