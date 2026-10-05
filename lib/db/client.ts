/**
 * Database client — auto-detects Turso Cloud vs local SQLite.
 *
 * If TURSO_DATABASE_URL is provided, uses @libsql/client (HTTP/Cloud compatible).
 * Otherwise, falls back to local SQLite using better-sqlite3.
 */

import { createClient, Client } from '@libsql/client';
import Database from 'better-sqlite3';
import path from 'path';

let _tursoClient: Client | null = null;
let _sqliteDb: Database.Database | null = null;

export function isTursoMode(): boolean {
  return Boolean(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);
}

export function getTursoClient(): Client {
  if (!_tursoClient) {
    const url = process.env.TURSO_DATABASE_URL!;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    _tursoClient = createClient({ url, authToken });
  }
  return _tursoClient;
}

export function getSqliteDb(): Database.Database {
  if (!_sqliteDb) {
    const DB_PATH = process.env.DB_PATH || './data/local.db';
    const fs = require('fs');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    _sqliteDb = new Database(DB_PATH);
    _sqliteDb.pragma('journal_mode = WAL');
    _sqliteDb.pragma('foreign_keys = ON');
  }
  return _sqliteDb;
}

/**
 * Executes a SELECT query and returns an array of typed row objects.
 */
export async function dbAll<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  if (isTursoMode()) {
    const client = getTursoClient();
    const res = await client.execute({ sql, args: params });
    return (res.rows as unknown) as T[];
  } else {
    const db = getSqliteDb();
    return db.prepare(sql).all(...params) as T[];
  }
}

/**
 * Executes a SELECT query and returns the first matching row or undefined.
 */
export async function dbGet<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
  if (isTursoMode()) {
    const client = getTursoClient();
    const res = await client.execute({ sql, args: params });
    return ((res.rows && res.rows.length > 0 ? res.rows[0] : undefined) as unknown) as T | undefined;
  } else {
    const db = getSqliteDb();
    return db.prepare(sql).get(...params) as T | undefined;
  }
}

/**
 * Executes an INSERT, UPDATE, or DELETE statement.
 */
export async function dbRun(sql: string, params: any[] = []): Promise<{ changes: number; lastInsertRowid?: number | bigint }> {
  if (isTursoMode()) {
    const client = getTursoClient();
    const res = await client.execute({ sql, args: params });
    return {
      changes: res.rowsAffected,
      lastInsertRowid: res.lastInsertRowid,
    };
  } else {
    const db = getSqliteDb();
    const res = db.prepare(sql).run(...params);
    return {
      changes: res.changes,
      lastInsertRowid: res.lastInsertRowid,
    };
  }
}

/**
 * Executes raw SQL DDL / batch commands.
 */
export async function dbExec(sql: string): Promise<void> {
  if (isTursoMode()) {
    const client = getTursoClient();
    if (client.executeMultiple) {
      await client.executeMultiple(sql);
    } else {
      await client.execute(sql);
    }
  } else {
    const db = getSqliteDb();
    db.exec(sql);
  }
}

// Backwards compatibility helper
export function getDb() {
  if (isTursoMode()) {
    // If someone calls getDb() directly in legacy code, provide a compatible proxy or sqlite fallback
    return getSqliteDb();
  }
  return getSqliteDb();
}

export function closeDb(): void {
  if (_sqliteDb) {
    _sqliteDb.close();
    _sqliteDb = null;
  }
  if (_tursoClient) {
    _tursoClient.close();
    _tursoClient = null;
  }
}

