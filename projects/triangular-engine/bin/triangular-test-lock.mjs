// Cross-app timing lock for the triangular-test receiver. Dev only, local only.
// One file in the OS temp folder says which receiver is measuring right now, so timed cases from two apps on this
// machine never overlap. Best effort: two receivers that find the same stale lock at the same instant can both
// take it. That is rare enough for a dev tool, and the case is then marked, not failed.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const LOCK_FILE = 'triangular-test-measuring.json';
/** A lock whose `expiresAt` has passed is stale. The heartbeat keeps a live holder's lock ahead of this. */
export const LOCK_TTL_MS = 10_000;
export const LOCK_HEARTBEAT_MS = 2_000;

/** Signal 0 checks that the pid exists; EPERM means it exists under another user. */
export function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

/**
 * Lock for one receiver (`owner` is its root hash). `take({ runId, scenarioId, repetition })` returns `true` when the
 * caller now holds the lock, `false` when a live lock is held by anyone else (or by this receiver for another case).
 * `release(who)` only removes a lock this receiver holds for exactly that case. `waitFree()` resolves once no live lock
 * from another root remains, or `false` at its time limit. `dir`, `now`, `alive` and `pid` are injectable for specs.
 */
export function createMeasuringLock({
  owner, dir = tmpdir(), now = Date.now, alive = pidAlive, pid = process.pid, ttlMs = LOCK_TTL_MS, heartbeatMs = LOCK_HEARTBEAT_MS,
} = {}) {
  const file = join(dir, LOCK_FILE);
  const keyOf = (who) => `${owner}|${pid}|${who.runId}|${who.scenarioId}|${who.repetition}`;
  const read = () => {
    try { const lock = JSON.parse(readFileSync(file, 'utf8')); return lock && typeof lock === 'object' ? lock : undefined; } catch { return undefined; }
  };
  const live = (lock) => Boolean(lock) && Number(lock.expiresAt) > now() && alive(Number(lock.pid));
  const lockKey = (lock) => `${lock.root}|${lock.pid}|${lock.runId}|${lock.scenarioId}|${lock.repetition}`;
  let held;
  let timer;
  const stopHeartbeat = () => { if (timer) clearInterval(timer); timer = undefined; };
  /** Extends the held lock; drops the claim when the file no longer says it is ours (taken over after a stall). */
  const heartbeat = () => {
    if (!held) return stopHeartbeat();
    const lock = read();
    if (!lock || lockKey(lock) !== held.key) { held = undefined; return stopHeartbeat(); }
    held.info.expiresAt = now() + ttlMs;
    writeFileSync(file, JSON.stringify(held.info));
  };
  return {
    file,
    heartbeat,
    take(who) {
      // Still ours on disk: one held lock per receiver. Gone or taken over: this receiver no longer holds it.
      if (held) {
        const lock = read();
        if (lock && lockKey(lock) === held.key) return false;
        held = undefined;
        stopHeartbeat();
      }
      const lock = read();
      if (live(lock)) return false;
      // Stale (expired, or the holder's pid is gone): remove it, then create ours exclusively.
      if (lock) rmSync(file, { force: true });
      const info = { root: owner, runId: who.runId, scenarioId: who.scenarioId, repetition: who.repetition, pid, expiresAt: now() + ttlMs };
      try { writeFileSync(file, JSON.stringify(info), { flag: 'wx' }); } catch { return false; }
      held = { key: keyOf(who), info };
      if (heartbeatMs > 0 && !timer) { timer = setInterval(heartbeat, heartbeatMs); timer.unref?.(); }
      return true;
    },
    release(who) {
      if (!held || held.key !== keyOf(who)) return false;
      const lock = read();
      if (lock && lockKey(lock) === held.key) rmSync(file, { force: true });
      held = undefined;
      stopHeartbeat();
      return true;
    },
    async waitFree({ timeoutMs = 60_000, pollMs = 200, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
      const began = now();
      for (;;) {
        const lock = read();
        if (!live(lock) || String(lock.root) === owner) return true;
        if (now() - began >= timeoutMs) return false;
        await sleep(pollMs);
      }
    },
  };
}
