import { validateShapeOp, type ShapeOp } from './shape-op';

/**
 * Plan 055 Phase 1b: the op log. Shape programs and player edits append to it; save files store it; undo drops the last
 * entry. Replaying a log always gives the same op list, and `hashShapeOps` of that list is the check (same log, same
 * hash, on every machine), so a save, a replay and an undo can be compared without comparing terrain.
 *
 * - `add` appends a new op (its id must be new);
 * - `replace` swaps an existing op for a new version in place, keeping its position in the apply order;
 * - `remove` drops an op.
 */
export type OpLogEntry =
  | { readonly type: 'add'; readonly op: ShapeOp }
  | { readonly type: 'replace'; readonly op: ShapeOp }
  | { readonly type: 'remove'; readonly id: string };

export const OP_LOG_VERSION = 1;

export interface SerializedOpLog {
  readonly version: number;
  readonly entries: readonly OpLogEntry[];
}

/** The op list a log describes, in apply order. Throws on an entry that does not fit (unknown id, duplicate id, bad op). */
export function replayOpLog(entries: readonly OpLogEntry[]): ShapeOp[] {
  const ops: ShapeOp[] = [];
  const index = new Map<string, number>();
  entries.forEach((entry, n) => applyEntry(ops, index, entry, n));
  return ops;
}

function applyEntry(ops: ShapeOp[], index: Map<string, number>, entry: OpLogEntry, n: number): void {
  switch (entry?.type) {
    case 'add':
      validateShapeOp(entry.op);
      if (index.has(entry.op.id)) throw new Error(`Op log entry ${n}: op ${entry.op.id} already exists`);
      index.set(entry.op.id, ops.length);
      ops.push(entry.op);
      return;
    case 'replace': {
      validateShapeOp(entry.op);
      const at = index.get(entry.op.id);
      if (at === undefined) throw new Error(`Op log entry ${n}: no op ${entry.op.id} to replace`);
      ops[at] = entry.op;
      return;
    }
    case 'remove': {
      const at = index.get(entry.id);
      if (at === undefined) throw new Error(`Op log entry ${n}: no op ${entry.id} to remove`);
      ops.splice(at, 1);
      index.delete(entry.id);
      for (let i = at; i < ops.length; i++) index.set(ops[i].id, i);
      return;
    }
    default:
      throw new Error(`Op log entry ${n}: unknown type ${(entry as { type?: string })?.type}`);
  }
}

/** JSON with object keys sorted, so the same ops always give the same text whatever order their keys were written in. */
function canonicalJson(value: unknown): string {
  if (typeof value === 'number') return JSON.stringify(Object.is(value, -0) ? 0 : value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((key) => (value as Record<string, unknown>)[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** A 64-bit hash (16 hex digits) of a string: two multiply-xor lanes, mixed at the end (after bryc's public-domain cyrb53). */
function hash64(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/** Hash of an op list in apply order: equal lists (as data) give equal hashes. */
export function hashShapeOps(ops: readonly ShapeOp[]): string {
  return hash64(canonicalJson(ops));
}

/** Entries of a parsed save, checked by replaying them. */
export function parseOpLog(data: unknown): OpLogEntry[] {
  const log = data as SerializedOpLog;
  if (!log || typeof log !== 'object' || !Array.isArray(log.entries)) throw new Error('Op log: expected { version, entries }');
  if (log.version !== OP_LOG_VERSION) throw new Error(`Op log: version ${log.version} is not ${OP_LOG_VERSION}`);
  replayOpLog(log.entries);
  return [...log.entries];
}

/** A growing log with its current op list. */
export interface OpLog {
  readonly entries: readonly OpLogEntry[];
  /** The ops after every entry, in apply order. */
  readonly ops: readonly ShapeOp[];
  /** Appends an entry, or throws and leaves the log as it was. */
  append(entry: OpLogEntry): void;
  /** Drops the last entry and returns it. */
  undo(): OpLogEntry | undefined;
  hash(): string;
  toJSON(): SerializedOpLog;
}

export function createOpLog(initial: readonly OpLogEntry[] = []): OpLog {
  const entries = [...initial];
  let ops = replayOpLog(entries);
  let index = new Map(ops.map((op, i) => [op.id, i]));
  return {
    get entries() { return entries; },
    get ops() { return ops; },
    append(entry) {
      const nextOps = [...ops];
      const nextIndex = new Map(index);
      applyEntry(nextOps, nextIndex, entry, entries.length);
      entries.push(entry);
      ops = nextOps;
      index = nextIndex;
    },
    undo() {
      const last = entries.pop();
      if (last) {
        ops = replayOpLog(entries);
        index = new Map(ops.map((op, i) => [op.id, i]));
      }
      return last;
    },
    hash: () => hashShapeOps(ops),
    toJSON: () => ({ version: OP_LOG_VERSION, entries: [...entries] }),
  };
}
