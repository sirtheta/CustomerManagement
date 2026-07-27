import { readFile, writeFile, unlink, mkdir, readdir, stat } from "fs/promises";
import path from "path";
import { config } from "@/lib/config";
import log from "@/lib/logger";

let _cacheDir: string | undefined;
function getCacheDir(): string {
  return (_cacheDir ??= path.join(process.cwd(), config.pdf.cacheDir));
}

const CACHE_TTL_MS = config.pdf.cacheTtlMs;
const CACHE_MAX_FILES = config.pdf.cacheMaxFiles;

function cacheFilePath(key: string): string {
  const safe = key.replace(/[^a-z0-9_-]/gi, "_");
  return path.join(getCacheDir(), `${safe}.pdf`);
}

export async function readCache(key: string): Promise<Buffer | null> {
  const filePath = cacheFilePath(key);
  try {
    const s = await stat(filePath);
    if (Date.now() - s.mtimeMs > CACHE_TTL_MS) {
      await unlink(filePath).catch(() => {});
      return null;
    }
    return await readFile(filePath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log.warn({ err, module: "pdf-cache" }, "Cache read error");
    }
    return null;
  }
}

export async function writeCache(key: string, data: Buffer): Promise<void> {
  const dir = getCacheDir();
  await mkdir(dir, { recursive: true }).catch((err) => {
    log.warn({ err, module: "pdf-cache" }, "Cache dir creation error");
  });

  try {
    const names = await readdir(dir);
    const files = await Promise.all(
      names.map(async (name) => {
        const p = path.join(dir, name);
        const s = await stat(p);
        return { path: p, mtime: s.mtimeMs };
      })
    );
    files.sort((a, b) => a.mtime - b.mtime);
    if (files.length >= CACHE_MAX_FILES) {
      const toDelete = files.slice(0, files.length - CACHE_MAX_FILES + 1);
      await Promise.all(toDelete.map((f) => unlink(f.path).catch(() => {})));
    }
  } catch (err) {
    log.warn({ err, module: "pdf-cache" }, "Cache eviction error");
  }

  await writeFile(cacheFilePath(key), data).catch((err) => {
    log.warn({ err, module: "pdf-cache" }, "Cache write error");
  });
}
