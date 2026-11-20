import * as nodeFs from 'node:fs';
import { dirname, join } from 'node:path';

/** One file to create (before = null), change, or delete (after = null), relative to the project folder. */
export type FileChange = { path: string; before: string | null; after: string | null };
export type FsLike = Pick<typeof nodeFs, 'existsSync' | 'readFileSync' | 'writeFileSync' | 'renameSync' | 'unlinkSync' | 'mkdirSync' | 'readdirSync' | 'rmdirSync'>;

const read = (fs: FsLike, file: string) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);

/** Compares the wanted contents (null = absent) with what is on disk; returns only real differences, sorted. */
export function diffFiles(dir: string, next: Map<string, string | null>, fs: FsLike = nodeFs): FileChange[] {
  return [...next]
    .map(([path, after]) => ({ path, before: read(fs, join(dir, path)), after }))
    .filter((c) => c.before !== c.after)
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Writes all changes or none: new contents go to temporary files first, originals are moved aside,
 * then everything is swapped in. On any error every file is put back as it was, and the error rethrown.
 */
export function applyChanges(dir: string, changes: FileChange[], fs: FsLike = nodeFs): void {
  const tmp = (p: string) => `${join(dir, p)}.qa-suite-tmp`;
  const bak = (p: string) => `${join(dir, p)}.qa-suite-bak`;
  const written: string[] = [];
  const movedAside: string[] = [];
  const swappedIn: string[] = [];
  try {
    for (const c of changes) {
      if (c.after === null) continue;
      fs.mkdirSync(dirname(join(dir, c.path)), { recursive: true });
      fs.writeFileSync(tmp(c.path), c.after);
      written.push(c.path);
    }
    for (const c of changes) {
      if (c.before === null) continue;
      fs.renameSync(join(dir, c.path), bak(c.path));
      movedAside.push(c.path);
    }
    for (const c of changes) {
      if (c.after === null) continue;
      fs.renameSync(tmp(c.path), join(dir, c.path));
      swappedIn.push(c.path);
    }
  } catch (error) {
    for (const p of swappedIn) safely(() => fs.unlinkSync(join(dir, p)));
    for (const p of movedAside) safely(() => fs.renameSync(bak(p), join(dir, p)));
    for (const p of written) safely(() => fs.existsSync(tmp(p)) && fs.unlinkSync(tmp(p)));
    for (const c of changes) if (c.before === null) removeEmptyParents(dir, c.path, fs);
    throw error;
  }
  for (const p of movedAside) safely(() => fs.unlinkSync(bak(p)));
  for (const c of changes) if (c.after === null) removeEmptyParents(dir, c.path, fs);
}

function safely(fn: () => unknown) {
  try {
    fn();
  } catch {
    // best effort while restoring; the original error is what the user needs to see
  }
}

function removeEmptyParents(dir: string, path: string, fs: FsLike) {
  let folder = dirname(path);
  while (folder !== '.' && folder !== '') {
    const full = join(dir, folder);
    if (!fs.existsSync(full) || fs.readdirSync(full).length) return;
    fs.rmdirSync(full);
    folder = dirname(folder);
  }
}
