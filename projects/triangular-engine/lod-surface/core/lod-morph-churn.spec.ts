import type { TextureHeightSource } from './lod-height-texture';
import { MorphMapResolver, type LodMorphSettings } from './lod-morph-frame';
import { PoleFanTopology } from './lod-morph-fan';
import { StretchMetric } from './lod-morph-metric';
import { PIXEL_FLOOR } from './lod-selector';
import { LodTerrainBody } from './lod-terrain-body';
import { ASPECT, FRAMES, PIXEL_ANGLE, RADIUS_M, VIEWPORT_PX, orbitView, pageHeights, pageTerrainSettings, sweepMorph, yieldToEventLoop } from './lod-morph-sweep.testing';
import { frustumNormals } from './lod-view';
import type { Vec3 } from './lod-domain';

/**
 * Measurement, not a behaviour test (Plan 059, G6j): why the drawn set changes between frames of the morph sweep, and what the pole fan
 * update costs on the packing frames. It runs the same sweep, camera path and budgets as `lod-morph-sweep.bench.spec.ts` (set-up in
 * `lod-morph-sweep.testing.ts`), in two paths: `body` (`LodTerrainBody.update`, the page path) and `sweep` (the bench's decomposed
 * replica). It prints one `LOD_MORPH_CHURN` block per run and asserts sanity only (frame count, finite non-negative numbers).
 *
 * Leaf identity is the cell (root, level, i, j), not the node index (nodes are pooled and reused). The pack trigger is replicated from
 * the mesh's `upload`: a repack happens when the morph key changed (kind, projection, basis) or when the tree signature (node, mask and
 * cell of each drawn leaf, in order) differs from the one the last pack wrote. The prediction is checked against `surface.packCount`.
 * The pole fan's update is timed by wrapping `PoleFanTopology.prototype.update` for the run (spec-only; the product code is unchanged).
 */

interface Dist { median: number; p95: number; max: number; mean: number }

const round = (x: number): number => Math.round(x * 1000) / 1000;

function dist(values: readonly number[]): Dist {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  const at = (q: number): number => s[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))] ?? 0;
  return { median: round(at(0.5)), p95: round(at(0.95)), max: round(s[n - 1] ?? 0), mean: round(s.reduce((a, b) => a + b, 0) / Math.max(1, n)) };
}

const fmt = (d: Dist): string => `median ${d.median}, p95 ${d.p95}, max ${d.max}`;

/** A leaf's cell as one number: root (0-5), level (0-31), i and j (0-65535). */
const cellKey = (root: number, level: number, i: number, j: number): number => ((root * 32 + level) * 65536 + i) * 65536 + j;

function decodeKey(key: number): { root: number; level: number; i: number; j: number } {
  const j = key % 65536;
  const rest = Math.floor(key / 65536);
  const i = rest % 65536;
  const rest2 = Math.floor(rest / 65536);
  return { root: Math.floor(rest2 / 32), level: rest2 % 32, i, j };
}

/** True when a proper ancestor of cell `key` is in `set` (the cell's parent is (i >> 1, j >> 1) one level up, as the selector splits). */
function hasAncestorIn(set: ReadonlySet<number>, key: number): boolean {
  const c = decodeKey(key);
  for (let l = c.level - 1; l >= 0; l--) {
    const s = c.level - l;
    if (set.has(cellKey(c.root, l, c.i >> s, c.j >> s))) return true;
  }
  return false;
}

/** Adds every proper ancestor of cell `key` to `out`. */
function addAncestors(key: number, out: Set<number>): void {
  const c = decodeKey(key);
  for (let l = c.level - 1; l >= 0; l--) {
    const s = c.level - l;
    out.add(cellKey(c.root, l, c.i >> s, c.j >> s));
  }
}

/** The drawn leaves of one frame, in the order the mesh packs them. */
interface Snapshot { keys: number[]; nodes: number[]; masks: number[] }

type Trigger = 'first' | 'key' | 'set' | 'order' | 'node' | 'mask' | 'none';
const TRIGGERS: readonly Trigger[] = ['first', 'key', 'set', 'order', 'node', 'mask', 'none'];
const emptyTally = (): Record<Trigger, number> => ({ first: 0, key: 0, set: 0, order: 0, node: 0, mask: 0, none: 0 });
const tallyText = (t: Record<Trigger, number>): string => TRIGGERS.filter((k) => t[k] > 0).map((k) => `${k} ${t[k]}`).join(', ') || 'none';

function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  if (a.keys.length !== b.keys.length) return false;
  for (let k = 0; k < a.keys.length; k++) {
    if (a.keys[k] !== b.keys[k] || a.nodes[k] !== b.nodes[k] || a.masks[k] !== b.masks[k]) return false;
  }
  return true;
}

/** Why a pack wrote: the set of drawn cells changed, the same cells in another order, a node index reused, or only a mask changed. */
function classify(last: Snapshot, cur: Snapshot): Trigger {
  const curSet = new Set(cur.keys);
  if (last.keys.length !== cur.keys.length || last.keys.some((k) => !curSet.has(k))) return 'set';
  let sameOrder = true;
  for (let k = 0; k < last.keys.length; k++) if (last.keys[k] !== cur.keys[k]) sameOrder = false;
  if (!sameOrder) return 'order';
  for (let k = 0; k < last.nodes.length; k++) if (last.nodes[k] !== cur.nodes[k]) return 'node';
  for (let k = 0; k < last.masks.length; k++) if (last.masks[k] !== cur.masks[k]) return 'mask';
  return 'none';
}

type RunMode = 'body' | 'sweep';

/** What {@link measureChurn} reports: its numbers are checked for sanity only. */
interface ChurnResult { readonly frames: number; readonly nums: Record<string, number> }

async function measureChurn(heights: TextureHeightSource, mode: RunMode, budget: number): Promise<ChurnResult> {
  const body = new LodTerrainBody(pageTerrainSettings(heights));
  const morph: LodMorphSettings & { morph: number } = { morph: 0, projection: 'equal-earth', projectionCentre: { lonDeg: 0, latDeg: 0 } };
  body.setMorph(morph);
  const { camera, axes, position, frustumFov } = orbitView(body);

  let stretch: StretchMetric;
  if (mode === 'body') {
    body.setMorphMetric(true);
    stretch = (body as unknown as { stretch: StretchMetric }).stretch;
  } else {
    stretch = new StretchMetric(body.selector, { radiusM: RADIUS_M, refreshBudget: budget });
  }
  const selector = body.selector;
  const surface = body.surface;
  const view = { camera: [0, 0, 0] as Vec3, pixelAngle: PIXEL_ANGLE, frustum: new Float64Array(12) };
  const resolver = new MorphMapResolver();
  const keyResolver = new MorphMapResolver();

  // Spec-only wrappers: the pole fan's update inside the mesh's pack (every topology of the run), and the body's syncPoleFan.
  let fanMs = 0;
  let fanCalls = 0;
  let fanRebuilds = 0;
  const proto = PoleFanTopology.prototype as unknown as { update(...args: unknown[]): boolean };
  const realFanUpdate = proto.update;
  proto.update = function (this: unknown, ...args: unknown[]): boolean {
    const t = performance.now();
    const rebuilt = realFanUpdate.apply(this, args);
    fanMs += performance.now() - t;
    fanCalls++;
    if (rebuilt) fanRebuilds++;
    return rebuilt;
  };
  const bodyHook = body as unknown as { syncPoleFan(): void };
  const realSync = bodyHook.syncPoleFan;
  let syncMs = 0;
  bodyHook.syncPoleFan = function (): void {
    const t = performance.now();
    realSync.call(body);
    syncMs += performance.now() - t;
  };

  // Per frame series (index = frame).
  const drawnAt: number[] = [];
  const leavesAt: number[] = [];
  const enterAt: number[] = [];
  const leaveAt: number[] = [];
  const changeAt: number[] = [];
  const levelAt: number[] = [];
  const packAt: boolean[] = [];
  const refreshedAt: boolean[] = [];
  const frameMsAt: number[] = [];
  const fanMsAt: number[] = [];
  const fanCallsAt: number[] = [];
  const syncAt: number[] = [];
  const kindAt: number[] = [];
  const rebuildAt: number[] = [];
  const trigAt: Trigger[] = [];

  let prev: Snapshot | undefined;
  let prevSet = new Set<number>();
  let prevLeaves = -1;
  let packed: Snapshot | undefined;
  let prevKind = -1;
  const keyVec = new Float64Array(8);
  const prevKeyVec = new Float64Array(8);
  let agree = 0;
  let levelIn = 0;
  let levelOut = 0;
  let leavesChangedFrames = 0;
  let drawnOnlyFrames = 0;
  let refreshedFramesCount = 0;

  try {
    for (let f = 0; f < FRAMES; f++) {
      await yieldToEventLoop();
      morph.morph = sweepMorph(f);
      const versionBefore = selector.version;
      const packsBefore = surface.packCount;
      fanMs = 0;
      fanCalls = 0;
      fanRebuilds = 0;
      syncMs = 0;

      const t0 = performance.now();
      if (mode === 'body') {
        body.update(camera, VIEWPORT_PX);
      } else {
        // The bench's decomposed frame: the stretch metric and the selector's camera, the selection, then the upload.
        const map = resolver.resolve(morph, RADIUS_M);
        stretch.update({ morph: map.morph, projection: map.projection, radiusM: map.radius, basis: map.basis });
        const cam = map.morph > 0 ? stretch.placeCamera(position, [0, 0, 0]) : position;
        view.camera = cam;
        frustumNormals(axes, frustumFov, ASPECT, view.frustum);
        selector.select(view);
        view.camera = position;
        surface.setDetailFade(Math.max(4, PIXEL_FLOOR) * view.pixelAngle);
        surface.upload(selector, position);
      }
      const frameMs = performance.now() - t0;

      // After the frame: the drawn leaves, the morph key, and the pack the mesh made.
      const versionChanged = selector.version !== versionBefore;
      const actualPack = surface.packCount !== packsBefore;
      const stats = selector.stats;
      const cur: Snapshot = { keys: [], nodes: [], masks: [] };
      for (let k = 0; k < stats.drawn; k++) {
        const node = selector.leaves[k]!;
        cur.keys.push(cellKey(selector.root[node]!, selector.level[node]!, selector.i[node]!, selector.j[node]!));
        cur.nodes.push(node);
        cur.masks.push(selector.masks[k]!);
      }
      const curSet = new Set(cur.keys);

      const keyMap = keyResolver.resolve(morph, RADIUS_M);
      const kind = keyMap.morph > 0 ? 1 : 0;
      if (kind === 1) {
        const b = keyMap.basis;
        keyVec[0] = keyMap.projection === 'equal-earth' ? 1 : 0;
        for (let c = 0; c < 3; c++) {
          keyVec[1 + c] = b.forward[c]!;
          keyVec[4 + c] = b.up[c]!;
        }
      }
      let sameKey = true;
      if (kind === 1) for (let c = 0; c < 7; c++) if (keyVec[c] !== prevKeyVec[c]) sameKey = false;
      const keyChanged = kind !== prevKind || (kind === 1 && !sameKey);
      if (kind === 1) prevKeyVec.set(keyVec);
      prevKind = kind;

      const first = packed === undefined;
      const mismatch = packed === undefined || !sameSnapshot(packed, cur);
      const predicted = first || keyChanged || (versionChanged && mismatch);
      if (predicted === actualPack) agree++;
      let trigger: Trigger = 'none';
      if (actualPack) {
        trigger = first ? 'first' : keyChanged ? 'key' : classify(packed!, cur);
        packed = cur;
      }

      // Change against the previous frame (frame 0 has none).
      let change = 0;
      let enter = 0;
      let leave = 0;
      let level = 0;
      if (prev) {
        const enterKeys = cur.keys.filter((k) => !prevSet.has(k));
        const leaveKeys = prev.keys.filter((k) => !curSet.has(k));
        const ancOfEnter = new Set<number>();
        const ancOfLeave = new Set<number>();
        for (const k of enterKeys) addAncestors(k, ancOfEnter);
        for (const k of leaveKeys) addAncestors(k, ancOfLeave);
        // A leaf is level-related when it replaces or is replaced by a parent or child (a split: parent out, children in; a merge the reverse).
        const inLevel = enterKeys.filter((k) => hasAncestorIn(prevSet, k) || ancOfLeave.has(k)).length;
        const outLevel = leaveKeys.filter((k) => hasAncestorIn(curSet, k) || ancOfEnter.has(k)).length;
        levelIn += inLevel;
        levelOut += outLevel;
        enter = enterKeys.length;
        leave = leaveKeys.length;
        level = inLevel + outLevel;
        change = enter + leave;
        if (stats.leaves !== prevLeaves) leavesChangedFrames++;
        else if (change > 0) drawnOnlyFrames++;
      }
      if (stats.geometryMeasured > 0) refreshedFramesCount++;

      drawnAt.push(stats.drawn);
      leavesAt.push(stats.leaves);
      enterAt.push(enter);
      leaveAt.push(leave);
      changeAt.push(change);
      levelAt.push(level);
      packAt.push(actualPack);
      refreshedAt.push(stats.geometryMeasured > 0);
      frameMsAt.push(frameMs);
      fanMsAt.push(fanMs);
      fanCallsAt.push(fanCalls);
      rebuildAt.push(fanRebuilds);
      syncAt.push(syncMs);
      kindAt.push(kind);
      trigAt.push(trigger);

      prev = cur;
      prevSet = curSet;
      prevLeaves = stats.leaves;
    }
  } finally {
    proto.update = realFanUpdate;
    bodyHook.syncPoleFan = realSync;
  }

  // Aggregates. Frame 0 has no previous frame, so the change series is frames 1 to FRAMES - 1.
  const idx = Array.from({ length: FRAMES - 1 }, (_, k) => k + 1);
  const changes = idx.map((f) => changeAt[f]!);
  const zeroFrames = changes.filter((c) => c === 0).length;
  const enters = idx.map((f) => enterAt[f]!);
  const leaves = idx.map((f) => leaveAt[f]!);
  const totalChange = changes.reduce((a, b) => a + b, 0);
  const levelTotal = idx.reduce((a, f) => a + levelAt[f]!, 0);
  const packIdx = Array.from({ length: FRAMES }, (_, k) => k).filter((f) => packAt[f]);
  const packsZeroChange = idx.filter((f) => packAt[f] && changeAt[f] === 0);
  const zeroTrig = emptyTally();
  for (const f of packsZeroChange) zeroTrig[trigAt[f]!]++;
  const trig = emptyTally();
  for (const f of packIdx) trig[trigAt[f]!]++;
  const refreshIdx = Array.from({ length: FRAMES }, (_, k) => k).filter((f) => refreshedAt[f]);
  const refreshChange = idx.filter((f) => refreshedAt[f]).map((f) => changeAt[f]!);
  const idleChange = idx.filter((f) => !refreshedAt[f]).map((f) => changeAt[f]!);
  const refreshPacks = refreshIdx.filter((f) => packAt[f]).length;
  const idlePacks = packIdx.length - refreshPacks;
  const packFanMs = packIdx.filter((f) => kindAt[f] === 1).map((f) => fanMsAt[f]!);
  const packMorph0 = packIdx.filter((f) => kindAt[f] === 0).length;
  const packRebuilds = packIdx.filter((f) => kindAt[f] === 1 && rebuildAt[f]! > 0).length;
  const nonPackFanCalls = Array.from({ length: FRAMES }, (_, k) => k).filter((f) => !packAt[f]).reduce((a, f) => a + fanCallsAt[f]!, 0);
  const nonPackFanMs = Array.from({ length: FRAMES }, (_, k) => k).filter((f) => !packAt[f]).map((f) => fanMsAt[f]!);
  const sumFan = fanMsAt.reduce((a, b) => a + b, 0);
  const sumFrame = frameMsAt.reduce((a, b) => a + b, 0);
  const sumFanPack = packIdx.reduce((a, f) => a + fanMsAt[f]!, 0);
  const sumFramePack = packIdx.reduce((a, f) => a + frameMsAt[f]!, 0);
  const packFrameMs = packIdx.map((f) => frameMsAt[f]!);
  const idleFrameMs = Array.from({ length: FRAMES }, (_, k) => k).filter((f) => !packAt[f]).map((f) => frameMsAt[f]!);
  const pct = (a: number, b: number): number => (b > 0 ? round((100 * a) / b) : 0);
  const sync = dist(syncAt);

  const lines: string[] = [];
  const label = mode === 'body' ? 'body.update (page path)' : 'sweep (decomposed replica)';
  lines.push(`LOD_MORPH_CHURN ${label}, budget ${budget}, frames ${FRAMES}, packs ${packIdx.length}, predicted pack agreement ${agree}/${FRAMES}`);
  lines.push(`  drawn leaves per frame: ${fmt(dist(drawnAt))}`);
  lines.push(`  change per frame (entering + leaving vs previous frame): ${fmt(dist(changes))}`);
  lines.push(`  entering per frame: ${fmt(dist(enters))}; leaving per frame: ${fmt(dist(leaves))}`);
  lines.push(`  frames with zero change: ${zeroFrames} of ${idx.length}; frames with any change: ${idx.length - zeroFrames}`);
  lines.push(`  change by cause (sum over frames): level-related ${pct(levelTotal, totalChange)}% (${levelIn} in, ${levelOut} out), same-level or unrelated ${pct(totalChange - levelTotal, totalChange)}%`);
  lines.push(`  frames whose leaf count changed (tree grew or shrank): ${leavesChangedFrames}; frames where only the drawn count changed (culling): ${drawnOnlyFrames}`);
  lines.push(`  frames where the metric measured nodes: ${refreshIdx.length} (change ${fmt(dist(refreshChange))}; packs ${refreshPacks}); other frames: ${idleChange.length} (change ${fmt(dist(idleChange))}; packs ${idlePacks})`);
  lines.push(`  packs by trigger: ${tallyText(trig)}`);
  lines.push(`  packs that moved nothing (zero change vs previous frame): ${packsZeroChange.length}; their triggers: ${tallyText(zeroTrig)}`);
  lines.push(`  packs at morph 0 (no fan call): ${packMorph0}`);
  lines.push(`  pole fan update on packs at morph > 0: ${fmt(dist(packFanMs))} ms; rebuilt (its leaves, basis or radius changed) on ${packRebuilds} of them`);
  const fanRebuiltMs = packIdx.filter((f) => kindAt[f] === 1 && rebuildAt[f]! > 0).map((f) => fanMsAt[f]!);
  const fanKeptMs = packIdx.filter((f) => kindAt[f] === 1 && rebuildAt[f]! === 0).map((f) => fanMsAt[f]!);
  lines.push(`  pole fan ms split: on packs where it rebuilt ${fmt(dist(fanRebuiltMs))}; on packs where it returned early ${fmt(dist(fanKeptMs))}`);
  lines.push(`  pole fan calls on non-packing frames: ${nonPackFanCalls} (ms ${fmt(dist(nonPackFanMs))})`);
  lines.push(`  pole fan share of frame time: all frames ${pct(sumFan, sumFrame)}%; packing frames ${pct(sumFanPack, sumFramePack)}%`);
  lines.push(`  frame ms, packing frames: ${fmt(dist(packFrameMs))}; non-packing frames: ${fmt(dist(idleFrameMs))}`);
  if (mode === 'body') lines.push(`  body.syncPoleFan ms: ${fmt(sync)}`);
  console.log(lines.join('\n'));

  stretch.dispose();
  body.dispose();

  const nums: Record<string, number> = {
    packs: packIdx.length, agree, zeroFrames, levelTotal, totalChange, packsZeroChange: packsZeroChange.length, packMorph0,
    nonPackFanCalls, sumFan: round(sumFan), sumFrame: round(sumFrame), fanRebuilds: packRebuilds,
    changeMedian: dist(changes).median, changeP95: dist(changes).p95, changeMax: dist(changes).max,
    syncMedian: sync.median, syncMax: sync.max, fanMedian: dist(packFanMs).median, fanP95: dist(packFanMs).p95,
  };
  return { frames: changeAt.length, nums };
}

describe('LOD morph churn (measurement, headless CPU)', () => {
  const runs: [RunMode, number][] = [
    ['body', 300],
    ['sweep', 300],
    ['sweep', 1000],
    ['sweep', Infinity],
  ];
  for (const [mode, budget] of runs) {
    it(`churn ${mode} budget ${budget}`, async () => {
      const h = await pageHeights();
      const r = await measureChurn(h, mode, budget);
      expect(r.frames).toBe(FRAMES);
      for (const [name, value] of Object.entries(r.nums)) {
        expect(Number.isFinite(value) && value >= 0).withContext(name).toBe(true);
      }
    }, 300_000);
  }
});
