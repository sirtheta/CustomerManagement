/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

/**
 * EINMALIGES Wartungsskript: komprimiert bereits gespeicherte Kundendokumente
 * (Document) und Spesenbelege (ExpenseReceipt) in der Datenbank nach denselben
 * Regeln wie beim Upload (lib/file-compression.ts).
 *
 * Absichtlich NICHT Teil des Docker-Images (das Dockerfile kopiert nur
 * scripts/startup.js). Aufruf per SSH, siehe DEPLOYMENT.md bzw. Kommentar unten:
 *
 *   docker cp scripts/one-off/compress-existing.cjs customer-management:/tmp/
 *   docker exec -w /app customer-management node /tmp/compress-existing.cjs --dry-run
 *   docker exec -w /app customer-management node /tmp/compress-existing.cjs
 *   docker exec customer-management rm /tmp/compress-existing.cjs
 *
 * Optionen:
 *   --dry-run       nichts schreiben, nur Einsparung berechnen
 *   --skip-vacuum   am Ende kein VACUUM (Datei auf Platte bleibt gleich gross)
 *
 * Ablauf: Backup (VACUUM INTO -> backups/pre-compress-<Datum>.db) -> jede Zeile
 * einzeln komprimieren und nur bei >= 10 % Ersparnis zurückschreiben -> VACUUM.
 * Die Parameter müssen mit lib/file-compression.ts übereinstimmen.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const Database = require('better-sqlite3');
const sharp = require('sharp');

const execFileAsync = promisify(execFile);

const MAX_IMAGE_DIMENSION = 1600;
const JPEG_QUALITY = 80;
const MIN_SAVING_RATIO = 0.9;
const GHOSTSCRIPT_TIMEOUT_MS = 60_000;

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const SKIP_VACUUM = args.has('--skip-vacuum');

const dbPath = (process.env.DATABASE_URL ?? 'file:/app/data/customermanagement.db').replace(/^file:/, '');
const gsBin = process.env.GHOSTSCRIPT_BIN || (process.platform === 'win32' ? 'gswin64c' : 'gs');

const fmt = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;

function isSignedPdf(buf) {
  return buf.includes('/ByteRange');
}

async function compressImage(ext, buf) {
  const pipeline = sharp(buf)
    .rotate()
    .resize({ width: MAX_IMAGE_DIMENSION, height: MAX_IMAGE_DIMENSION, fit: 'inside', withoutEnlargement: true });
  return ext === '.png'
    ? pipeline.png({ compressionLevel: 9, effort: 10 }).toBuffer()
    : pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
}

async function compressPdf(buf) {
  if (isSignedPdf(buf)) return buf;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-pdf-'));
  try {
    const input = path.join(dir, 'in.pdf');
    const output = path.join(dir, 'out.pdf');
    fs.writeFileSync(input, buf);
    await execFileAsync(
      gsBin,
      [
        '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.5', '-dPDFSETTINGS=/ebook',
        '-dNOPAUSE', '-dBATCH', '-dQUIET', '-dSAFER', `-sOutputFile=${output}`, input,
      ],
      { timeout: GHOSTSCRIPT_TIMEOUT_MS },
    );
    const out = fs.readFileSync(output);
    return out.subarray(0, 4).toString('latin1') === '%PDF' ? out : buf;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Liefert die komprimierten Bytes oder null, wenn nichts zu gewinnen ist. */
async function tryCompress(ext, buf) {
  let result;
  if (ext === '.jpg' || ext === '.jpeg' || ext === '.png') result = await compressImage(ext, buf);
  else if (ext === '.pdf') result = await compressPdf(buf);
  else return null;
  return result.length < buf.length * MIN_SAVING_RATIO ? result : null;
}

async function main() {
  if (!fs.existsSync(dbPath)) throw new Error(`Datenbank nicht gefunden: ${dbPath}`);
  const db = new Database(dbPath, { fileMustExist: true });
  db.pragma('busy_timeout = 30000');

  const sizeBefore = fs.statSync(dbPath).size;
  console.log(`${DRY_RUN ? '[DRY-RUN] ' : ''}Datenbank: ${dbPath} (${fmt(sizeBefore)})`);

  if (!DRY_RUN) {
    const dir = process.env.BACKUP_DIR || path.join(path.dirname(dbPath), 'backups');
    const date = new Date().toISOString().slice(0, 10);
    const target = path.join(dir, `pre-compress-${date}.db`);
    if (fs.existsSync(target)) {
      console.log(`Backup existiert bereits, wird weiterverwendet: ${target}`);
    } else {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${target}.tmp`;
      fs.rmSync(tmp, { force: true });
      db.prepare('VACUUM INTO ?').run(tmp);
      fs.renameSync(tmp, target);
      console.log(`Backup geschrieben: ${target}`);
    }
  }

  const targets = [
    { table: 'Document', idCol: 'documentId', hasSize: false },
    { table: 'ExpenseReceipt', idCol: 'id', hasSize: true },
  ];

  let totalSaved = 0;
  let totalChanged = 0;

  for (const { table, idCol, hasSize } of targets) {
    const rows = db
      .prepare(
        `SELECT ${idCol} AS id, fileType, length(content) AS len FROM "${table}"
         WHERE lower(fileType) IN ('.jpg','.jpeg','.png','.pdf','jpg','jpeg','png','pdf')
         ORDER BY ${idCol}`,
      )
      .all();
    console.log(`\n${table}: ${rows.length} Dateien geprüft`);

    const read = db.prepare(`SELECT content FROM "${table}" WHERE ${idCol} = ?`);
    const write = db.prepare(
      hasSize
        ? `UPDATE "${table}" SET content = ?, size = ? WHERE ${idCol} = ?`
        : `UPDATE "${table}" SET content = ? WHERE ${idCol} = ?`,
    );

    let changed = 0;
    let saved = 0;
    for (const row of rows) {
      const ext = row.fileType.toLowerCase().startsWith('.') ? row.fileType.toLowerCase() : `.${row.fileType.toLowerCase()}`;
      try {
        const buf = read.get(row.id).content;
        const out = await tryCompress(ext, buf);
        if (!out) continue;
        saved += buf.length - out.length;
        changed++;
        console.log(`  #${row.id} ${ext}: ${fmt(buf.length)} -> ${fmt(out.length)}`);
        if (!DRY_RUN) {
          if (hasSize) write.run(out, out.length, row.id);
          else write.run(out, row.id);
        }
      } catch (err) {
        if (err && err.code === 'ENOENT') {
          console.error(`  Ghostscript (${gsBin}) nicht gefunden – PDFs werden übersprungen.`);
        } else {
          console.error(`  #${row.id} übersprungen: ${err.message}`);
        }
      }
    }
    console.log(`${table}: ${changed} ${DRY_RUN ? 'würden komprimiert' : 'komprimiert'}, ${fmt(saved)} gespart`);
    totalSaved += saved;
    totalChanged += changed;
  }

  console.log(`\nGesamt: ${totalChanged} Dateien, ${fmt(totalSaved)} ${DRY_RUN ? 'möglich' : 'gespart'}`);

  if (!DRY_RUN && totalChanged > 0 && !SKIP_VACUUM) {
    console.log('VACUUM läuft (kann bei grossen Datenbanken dauern, braucht freien Platz ≈ DB-Grösse)...');
    db.exec('VACUUM');
    console.log(`Datenbankdatei: ${fmt(sizeBefore)} -> ${fmt(fs.statSync(dbPath).size)}`);
  }
  db.close();
}

main().catch((err) => {
  console.error('Fehler:', err.message);
  process.exit(1);
});
