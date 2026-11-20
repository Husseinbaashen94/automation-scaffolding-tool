import type { FileChange } from './changeset.js';

const MAX_LINES_PER_FILE = 25;
const show = (v: unknown) => {
  if (v === undefined) return '';
  const s = JSON.stringify(v);
  return s.length > 80 ? s.slice(0, 77) + '...' : s;
};
const key = (path: string, k: string | number) => (typeof k === 'number' ? `${path}[${k}]` : path ? `${path}.${k}` : k);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Every leaf value that differs between two JSON values, as "path: old → new". */
function jsonDiff(a: unknown, b: unknown, path = ''): string[] {
  if (Array.isArray(a) && Array.isArray(b)) {
    return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => jsonDiff(a[i], b[i], key(path, i))).flat();
  }
  if (isObject(a) && isObject(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => k !== '$schema');
    return keys.flatMap((k) => jsonDiff(a[k], b[k], key(path, k)));
  }
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  return [`${path || '(file)'}: ${a === undefined ? '(added)' : show(a)} → ${b === undefined ? '(removed)' : show(b)}`];
}

const parse = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** A readable list of what a command will change, followed by notes. Works without colour. */
export function renderSummary(changes: FileChange[], notes: string[]): string {
  const lines: string[] = [];
  if (!changes.length) lines.push('Nothing to change: the coverage already matches.');
  for (const c of changes) {
    if (c.before === null) lines.push(`+ ${c.path}`);
    else if (c.after === null) lines.push(`- ${c.path}`);
    else {
      lines.push(`~ ${c.path}`);
      const a = parse(c.before);
      const b = parse(c.after);
      const diff = a !== undefined && b !== undefined ? jsonDiff(a, b) : ['(text changed)'];
      lines.push(...diff.slice(0, MAX_LINES_PER_FILE).map((d) => `    ${d}`));
      if (diff.length > MAX_LINES_PER_FILE) lines.push(`    … and ${diff.length - MAX_LINES_PER_FILE} more`);
    }
  }
  if (notes.length) lines.push('', ...notes);
  return lines.join('\n');
}
