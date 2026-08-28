/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const dbPath = (process.env.DATABASE_URL ?? 'file:/app/data/customermanagement.db')
  .replace(/^file:/, '');

const db = new Database(dbPath);
try {
  applyMigrations(db);
  seedAdminUser(db);
} finally {
  db.close();
}

// ── Apply pending Prisma migrations ──────────────────────────────────────────
// The production image has no Prisma CLI (it's a devDependency, pruned out), so
// we apply the migration SQL ourselves. Tracked in `_prisma_migrations` so this
// is idempotent and only new migrations run on an app upgrade.
function applyMigrations(db) {
  const migrationsDir = path.join(__dirname, '..', 'prisma', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.warn('[startup] No migrations directory found — skipping migrations.');
    return;
  }

  db.exec(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                  TEXT PRIMARY KEY NOT NULL,
    "checksum"            TEXT NOT NULL,
    "finished_at"         DATETIME,
    "migration_name"      TEXT NOT NULL,
    "logs"                TEXT,
    "rolled_back_at"      DATETIME,
    "started_at"          DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
  );`);

  const applied = new Set(
    db.prepare('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL')
      .all()
      .map((row) => row.migration_name),
  );

  const folders = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const name of folders) {
    if (applied.has(name)) continue;

    const sqlPath = path.join(migrationsDir, name, 'migration.sql');
    if (!fs.existsSync(sqlPath)) continue;

    const sql = fs.readFileSync(sqlPath, 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    const now = new Date().toISOString();

    const run = db.transaction(() => {
      db.exec(sql);
      db.prepare(
        `INSERT INTO "_prisma_migrations"
           (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
         VALUES (?, ?, ?, ?, ?, 1)`,
      ).run(crypto.randomUUID(), checksum, now, name, now);
    });
    db.pragma('foreign_keys = OFF');
    try {
      run();
    } finally {
      db.pragma('foreign_keys = ON');
    }

    console.log(`[startup] Applied migration: ${name}`);
  }
}

// ── Seed admin user if no users exist ────────────────────────────────────────
function seedAdminUser(db) {
  try {
    const { count } = db.prepare('SELECT COUNT(*) as count FROM "User"').get();
    if (count === 0) {
      const email = process.env.ADMIN_EMAIL    ?? 'admin@example.com';
      const name  = process.env.ADMIN_NAME     ?? 'Admin';
      let   hash  = process.env.ADMIN_PASSWORD_HASH;
      if (!hash) {
        let pw = process.env.ADMIN_PASSWORD;
        if (pw) {
          console.log('[startup] No ADMIN_PASSWORD_HASH set — hashed ADMIN_PASSWORD.');
        } else {
          pw = crypto.randomBytes(12).toString('base64url');
          console.log(`[startup] No ADMIN_PASSWORD(_HASH) set — generated one-time admin password: ${pw}`);
          console.log('[startup] Log in with this password and change it immediately.');
        }
        hash = bcrypt.hashSync(pw, 10);
      }
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO "User" (email, name, passwordHash, role, isActive, totpEnabled, createdAt, updatedAt)
         VALUES (?, ?, ?, 'Admin', 1, 0, ?, ?)`
      ).run(email, name, hash, now, now);
      console.log(`[startup] Admin user created: ${email}`);
    }
  } catch (err) {
    console.error('[startup] Admin seeding failed:', err.message);
    throw err;
  }
}
