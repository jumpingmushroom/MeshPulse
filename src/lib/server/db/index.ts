import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { loadConfig } from '../config';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

export function openDb(path: string): Db {
	const sqlite = new Database(path);
	sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('foreign_keys = ON');
	const db = drizzle(sqlite, { schema });
	// Relative to cwd: repo root in dev/tests, next to build/ in production.
	migrate(db, { migrationsFolder: 'drizzle' });
	return db;
}

let db: Db | undefined;
export function getDb(): Db {
	return (db ??= openDb(loadConfig().databasePath));
}
