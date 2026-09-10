import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, writeFile, chmod, access } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import path from 'node:path';

export async function openDatabase(directory, project) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const databaseFile = path.join(directory, 'acsbot.sqlite');
  const keyFile = path.join(directory, 'vault.key');
  let key;
  try { key = (await readFile(keyFile, 'utf8')).trim(); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    let databaseExists = true;
    try { await access(databaseFile); } catch (e) { if (e.code === 'ENOENT') databaseExists = false; else throw e; }
    if (databaseExists) throw new Error('A chave local está ausente. Restaure vault.key do mesmo backup do banco; nenhuma chave foi substituída.');
    key = randomBytes(32).toString('base64');
    await writeFile(keyFile, key + '\n', { mode: 0o600, flag: 'wx' });
  }
  if (!/^[A-Za-z0-9+/]{43}=$/.test(key) || Buffer.from(key, 'base64').length !== 32) throw new Error('Chave local inválida. Preserve o banco e restaure a chave do backup.');
  await chmod(keyFile, 0o600);
  const sqlite = new DatabaseSync(databaseFile);
  try {
    await chmod(databaseFile, 0o600);
    sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    sqlite.exec('CREATE TABLE IF NOT EXISTS acs_local_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL);');
    const journal = JSON.parse(await readFile(path.join(project, 'drizzle/meta/_journal.json'), 'utf8'));
    for (const entry of journal.entries) {
      const name = entry.tag + '.sql';
      const sql = await readFile(path.join(project, 'drizzle', name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = sqlite.prepare('SELECT checksum FROM acs_local_migrations WHERE name = ?').get(name);
      if (previous) {
        if (previous.checksum !== checksum) throw new Error('A migração ' + name + ' foi alterada após sua aplicação.');
        continue;
      }
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        sqlite.exec(sql);
        sqlite.prepare('INSERT INTO acs_local_migrations (name, checksum) VALUES (?, ?)').run(name, checksum);
        sqlite.exec('COMMIT');
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    }
    class Statement {
      constructor(sql, values = []) { this.sql = sql; this.values = values; }
      bind(...values) { return new Statement(this.sql, values); }
      async first() { return sqlite.prepare(this.sql).get(...this.values) || null; }
      async all() { return { results: sqlite.prepare(this.sql).all(...this.values) }; }
      async run() { return { meta: { changes: Number(sqlite.prepare(this.sql).run(...this.values).changes) } }; }
    }
    const db = {
      prepare: sql => new Statement(sql),
      batch: async statements => {
        sqlite.exec('BEGIN IMMEDIATE');
        try {
          const results = [];
          for (const statement of statements) results.push(await statement.run());
          sqlite.exec('COMMIT');
          return results;
        } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      },
    };
    return { db, key, close: () => sqlite.close() };
  } catch (error) { sqlite.close(); throw error; }
}
