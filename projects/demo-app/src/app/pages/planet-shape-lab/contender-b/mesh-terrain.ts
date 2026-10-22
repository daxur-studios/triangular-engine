/* eslint-disable @typescript-eslint/no-explicit-any */
import { BufferAttribute, BufferGeometry, FrontSide, Mesh, Vector3 } from 'three';
import { Fn, dot, float, length, max, mix, normalWorld, normalize, positionWorld, uniform, vec3, vec4 } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import type { ShapeOp } from '../shape-ops/shape-op';
import { createBField } from './b-field';
import { COLUMN_STRIDE, CROSSING_SLOTS, createColumnScan, type ComputeRenderer } from './column-scan-gpu';
import { LATTICE, LEAF_CELLS, MAX_LEVEL, faceDirection, leafAt, leafId, type LeafKey, type Vec3 } from './cube-sphere';
import { leafAngle, selectLeaves, type Band, type PinnedRect, type SelectedLeaf, type Selection } from './leaf-select';
import { LEAF_VERTICES, buildShellMesh, shellColumns } from './shell-mesh';
import { buildZoneMesh, type ZoneMesh, type ZoneSide } from './zone-mesh';

/**
 * Plan 055 contender B (shell + near volume blocks; A is B with the blocks off). Stage 1 of the seam spike: the height
 * shell alone, rebuilt for a camera position on request: leaves chosen on the CPU (`leaf-select.ts`), their columns
 * scanned on the GPU (`column-scan-gpu.ts`), the mesh assembled on the CPU (`shell-mesh.ts`). Positions are relative to
 * the camera of the last build, and the mesh is moved by the difference to the current camera, so small moves draw
 * without a rebuild.
 *
 * Selection needs each leaf's height range, which only a scan gives, so it deepens in passes: select down to a level
 * with the ranges known (a leaf's own, else its nearest scanned ancestor's widened by that ancestor's cell, else the
 * whole band), scan the drawn leaves not scanned yet, and go a few levels deeper. So every leaf's parent has been
 * scanned before the leaf is chosen, and a column only steps through the altitudes its parent's ground spans. Scans
 * are kept per leaf (heights do not depend on the camera) until the field changes.
 */

/** Target size of a shell cell on screen, in pixels. */
export const SHELL_CELL_PIXELS = 6;

/** Deepest level of each selection pass; the last is the cube-sphere's deepest. */
const PASS_LEVELS = [4, 7, 10, 13, 16, MAX_LEVEL];

/** Leaf scans kept at most; the cache is emptied past it. */
const SCAN_CACHE_LEAVES = 40_000;

/**
 * The near volume zone (`zone-mesh.ts`): a square of leaves around the ground under the camera, reaching this many
 * times the camera's height over the ground, with at most `ZONE_LEAVES` leaves a side (which sets its level), and none
 * when the camera is higher over the ground than `ZONE_MAX_HEIGHT_M`.
 */
const ZONE_REACH = 5;
const ZONE_LEAVES = 16;
const ZONE_MAX_HEIGHT_M = 20_000;

export interface MeshTerrainView {
  /** Unit forward and up of the camera in the body frame. */
  readonly forward: Readonly<Vec3>;
  readonly up: Readonly<Vec3>;
  readonly fovDeg: number;
  readonly aspect: number;
}

export interface MeshTerrainStats {
  readonly leaves: number;
  readonly culledLeaves: number;
  readonly balanceSplits: number;
  readonly passes: number;
  /** Leaves scanned by this build (the others came from the cache). */
  readonly scannedLeaves: number;
  readonly triangles: number;
  readonly overhangLeaves: number;
  readonly mostCrossings: number;
  /** Near volume zone: its level and leaves a side (0 without one), cells meshed, columns that overhang. */
  readonly zoneLevel: number;
  readonly zoneLeaves: number;
  readonly zoneCells: number;
  readonly zoneOverhangColumns: number;
  readonly zoneTriangles: number;
  /** Balance splits a pinned zone leaf blocked (each a crack at its edge). */
  readonly pinnedConflicts: number;
  readonly selectMs: number;
  readonly scanMs: number;
  readonly assembleMs: number;
}

export interface MeshTerrain {
  readonly mesh: Mesh;
  /**
   * Writes red = distance from the camera, green 0, blue = the field at the drawn point in footprints (at the pixel angle
   * of `setProbePixelAngle`), alpha 1: the channels of terrain v2's depth probes.
   */
  readonly probeMaterial: MeshBasicNodeMaterial;
  readonly stats: MeshTerrainStats | undefined;
  setBody(radiusM: number): void;
  /** Camera in the body frame; moves the mesh, and marks it for a rebuild. */
  setCamera(x: number, y: number, z: number): void;
  setView(view: MeshTerrainView): void;
  setSun(x: number, y: number, z: number): void;
  /** Radians per screen pixel: leaves are chosen for it. */
  setPixelAngle(radians: number): void;
  /** Radians per probe pixel, for the probe's footprint only. */
  setProbePixelAngle(radians: number): void;
  setBiome(biome: number | undefined): void;
  setRock(grounded: number | undefined): void;
  setShapeOps(ops: readonly ShapeOp[] | undefined): void;
  /** The near volume zone on (B) or off (A: the height shell everywhere). */
  setBlocks(on: boolean): void;
  /** Rebuilds for the current camera and settings if anything changed; resolves when the mesh drawn is current. */
  update(renderer: ComputeRenderer): Promise<void>;
  dispose(): void;
}

export function createMeshTerrain(): MeshTerrain {
  // Two fields: one around the camera of the build (the compute passes), one around the current camera (the probe).
  const buildField = createBField();
  const drawField = createBField();
  const scanner = createColumnScan(buildField);
  const uSun = uniform(new Vector3(0, 1, 0)) as any;
  const uCamera = drawField.origin;
  /** The probe's pixel angle (the footprint of its field readout); the leaves follow the screen's (`setPixelAngle`). */
  const uProbePixelAngle = uniform(0.001) as any;

  const material = new MeshBasicNodeMaterial({ side: FrontSide });
  material.colorNode = Fn(() => {
    const n = normalize(normalWorld).toVar();
    const up = normalize(positionWorld.add(uCamera)).toVar();
    const flat = dot(n, up).clamp(0, 1).toVar();
    const albedo = mix(vec3(0.42, 0.34, 0.28), vec3(0.55, 0.5, 0.38), flat.mul(flat));
    const light = float(0.22).add(max(dot(n, uSun), 0).mul(0.95));
    return vec4(albedo.mul(light), 1);
  })();

  const probeMaterial = new MeshBasicNodeMaterial({ side: FrontSide });
  probeMaterial.outputNode = Fn(() => {
    const x = positionWorld.toVar();
    const t = length(x).toVar();
    const footprint = max(t.mul(uProbePixelAngle), float(1e-3)).toVar();
    return vec4(t, 0, drawField.density(x, drawField.altitudeOf(x), footprint).div(footprint), 1);
  })();

  const mesh = new Mesh(new BufferGeometry(), material);
  mesh.frustumCulled = false;

  let radius = 1;
  let camera: Vec3 = [0, 0, 1];
  let built: Vec3 | undefined;
  let view: MeshTerrainView | undefined;
  let pixelAngle = 0.001;
  let dirty = true;
  let running: Promise<void> | undefined;
  let stats: MeshTerrainStats | undefined;
  let blocks = true;
  /** Per scanned leaf: its columns' scan, the range of its outermost ground, and the range of all its crossings. */
  const scans = new Map<string, { readonly scan: Float32Array; readonly band: Band; readonly full: Band }>();

  /** A leaf's range from its own scan, else its nearest scanned ancestor's (`full` picks all crossings over the outermost). */
  const rangeOf = (key: LeafKey, id: string, full: boolean): Band | undefined => {
    const own = scans.get(id);
    if (own) return full ? own.full : own.band;
    for (let level = key.level - 1; level >= 0; level--) {
      const shift = key.level - level;
      const found = scans.get(`${key.face}/${level}/${key.i >> shift}/${key.j >> shift}`);
      if (found) {
        // Ground between the ancestor's columns may rise or fall past them by about a cell.
        const margin = (radius * leafAngle(level)) / LEAF_CELLS;
        const band = full ? found.full : found.band;
        return { bottomM: band.bottomM - margin, topM: band.topM + margin };
      }
    }
    return undefined;
  };
  const boundsOf = (key: LeafKey, id: string) => rangeOf(key, id, false);

  const scanLeaves = async (renderer: ComputeRenderer, leaves: readonly SelectedLeaf[], origin: Vec3) => {
    if (!leaves.length) return;
    if (scans.size + leaves.length > SCAN_CACHE_LEAVES) scans.clear();
    buildField.setOrigin(...origin);
    const columns = shellColumns(leaves, { radiusM: radius, origin, band: buildField.band }, (leaf) => rangeOf(leaf.key, leaf.id, true));
    const result = await scanner.scan(renderer, columns);
    const perLeaf = LEAF_VERTICES * LEAF_VERTICES * COLUMN_STRIDE;
    leaves.forEach((leaf, l) => {
      const scan = result.slice(l * perLeaf, (l + 1) * perLeaf);
      let bottomM = Infinity;
      let topM = -Infinity;
      let lowest = Infinity;
      for (let c = 0; c < perLeaf; c += COLUMN_STRIDE) {
        bottomM = Math.min(bottomM, scan[c + 1]);
        topM = Math.max(topM, scan[c + 1]);
        const crossings = Math.min(scan[c], CROSSING_SLOTS);
        lowest = Math.min(lowest, scan[c + Math.max(1, crossings)]);
      }
      scans.set(leaf.id, { scan, band: { bottomM, topM }, full: { bottomM: lowest, topM } });
    });
  };

  const place = () => {
    if (built) mesh.position.set(built[0] - camera[0], built[1] - camera[1], built[2] - camera[2]);
  };

  /** Height of the camera over the outermost ground under it, from the deepest scanned leaf there. */
  const heightOverGround = (origin: Vec3): number | undefined => {
    const distance = Math.hypot(...origin);
    const direction: Vec3 = [origin[0] / distance, origin[1] / distance, origin[2] / distance];
    for (let level = MAX_LEVEL; level >= 0; level--) {
      const found = scans.get(leafId(leafAt(direction, level)));
      if (found) return distance - radius - found.band.topM;
    }
    return undefined;
  };

  /** The near volume zone for a camera, or none (see `ZONE_REACH`). */
  const zoneFor = (origin: Vec3): PinnedRect | undefined => {
    const height = heightOverGround(origin);
    if (height === undefined || height > ZONE_MAX_HEIGHT_M) return undefined;
    const reach = ZONE_REACH * Math.max(height, 50);
    const level = Math.min(MAX_LEVEL, Math.floor(Math.log2((radius * (Math.PI / 2) * ZONE_LEAVES) / (2 * reach))));
    const distance = Math.hypot(...origin);
    const centre = leafAt([origin[0] / distance, origin[1] / distance, origin[2] / distance], level);
    const half = Math.ceil(reach / (radius * leafAngle(level)));
    const last = 2 ** level - 1;
    return {
      face: centre.face, level, i0: Math.max(0, centre.i - half), i1: Math.min(last, centre.i + half),
      j0: Math.max(0, centre.j - half), j1: Math.min(last, centre.j + half),
    };
  };

  /** The level of the leaf just outside the zone at boundary column (x, y), on `side`. */
  const outsideLevel = (selection: Selection, zone: PinnedRect) => (side: ZoneSide, x: number, y: number): number => {
    const columns = LATTICE / 2 ** (MAX_LEVEL - zone.level);
    const sx = side === 0 ? x - 0.5 : side === 1 ? x + 0.5 : x + 0.5;
    const sy = side === 2 ? y - 0.5 : side === 3 ? y + 0.5 : y + 0.5;
    const leaf = selection.holding(faceDirection(zone.face, (2 * sx) / columns - 1, (2 * sy) / columns - 1));
    return leaf?.key.level ?? zone.level;
  };

  const build = async (renderer: ComputeRenderer): Promise<void> => {
    dirty = false;
    const origin: Vec3 = [...camera];
    let selectMs = 0;
    let scanMs = 0;
    let scannedLeaves = 0;
    let passes = 0;
    const scanMissing = async (leaves: readonly SelectedLeaf[]) => {
      const began = performance.now();
      const missing = leaves.filter((leaf) => !scans.has(leaf.id));
      await scanLeaves(renderer, missing, origin);
      scannedLeaves += missing.length;
      scanMs += performance.now() - began;
    };
    const select = (maxLevel: number, pinned?: PinnedRect): Selection => {
      const began = performance.now();
      const selection = selectLeaves({
        radiusM: radius, camera: origin, ...(view ?? {}), pixelAngle, cellPixels: SHELL_CELL_PIXELS, band: buildField.band, boundsOf, maxLevel,
        pinned: pinned && pinned.level <= maxLevel ? pinned : undefined,
      });
      passes++;
      selectMs += performance.now() - began;
      return selection;
    };
    let selection: Selection | undefined;
    for (const maxLevel of PASS_LEVELS) {
      selection = select(maxLevel);
      await scanMissing(selection.drawn);
    }
    // The zone, and the passes again with it pinned (its leaves all scanned, culled or not: it is meshed whole).
    const zone = blocks ? zoneFor(origin) : undefined;
    if (zone) {
      for (const maxLevel of PASS_LEVELS) {
        if (maxLevel < zone.level && maxLevel !== MAX_LEVEL) continue;
        selection = select(maxLevel, zone);
        await scanMissing(selection.drawn);
      }
      const inZone: SelectedLeaf[] = [];
      for (let i = zone.i0; i <= zone.i1; i++) {
        for (let j = zone.j0; j <= zone.j1; j++) {
          const key: LeafKey = { face: zone.face, level: zone.level, i, j };
          inZone.push({ key, id: leafId(key), culled: false, coarserEdges: 0 });
        }
      }
      await scanMissing(inZone);
    }
    selection = selection!;
    const assembling = performance.now();
    const isZone = (leaf: SelectedLeaf) => !!zone && leaf.key.face === zone.face && leaf.key.level === zone.level
      && leaf.key.i >= zone.i0 && leaf.key.i <= zone.i1 && leaf.key.j >= zone.j0 && leaf.key.j <= zone.j1;
    let zoneMesh: ZoneMesh | undefined;
    if (zone) {
      const shown = selection;
      zoneMesh = buildZoneMesh({
        radiusM: radius, origin, zone, outsideLevel: outsideLevel(selection, zone),
        visible: (i, j) => shown.leaves.get(leafId({ face: zone.face, level: zone.level, i, j }))?.culled === false,
        scanOf: (i, j) => scans.get(leafId({ face: zone.face, level: zone.level, i, j }))!.scan,
      });
    }
    const drawn = selection.drawn.filter((leaf) => scans.has(leaf.id) && !isZone(leaf));
    const perLeaf = LEAF_VERTICES * LEAF_VERTICES * COLUMN_STRIDE;
    const scan = new Float32Array(drawn.length * perLeaf);
    drawn.forEach((leaf, l) => scan.set(scans.get(leaf.id)!.scan, l * perLeaf));
    const shell = buildShellMesh(drawn, scan, { radiusM: radius, origin, band: buildField.band, fixedHeights: zoneMesh?.boundaryHeights });
    const geometry = new BufferGeometry();
    const vertices = shell.positions.length / 3;
    const positions = new Float32Array(shell.positions.length + (zoneMesh?.positions.length ?? 0));
    const normals = new Float32Array(positions.length);
    positions.set(shell.positions);
    normals.set(shell.normals);
    const indices = new Uint32Array(shell.indices.length + (zoneMesh?.indices.length ?? 0));
    indices.set(shell.indices);
    if (zoneMesh) {
      positions.set(zoneMesh.positions, shell.positions.length);
      normals.set(zoneMesh.normals, shell.normals.length);
      for (let t = 0; t < zoneMesh.indices.length; t++) indices[shell.indices.length + t] = zoneMesh.indices[t] + vertices;
    }
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(normals, 3));
    geometry.setIndex(new BufferAttribute(indices, 1));
    mesh.geometry.dispose();
    mesh.geometry = geometry;
    built = origin;
    place();
    stats = {
      leaves: drawn.length, culledLeaves: selection.leaves.size - selection.drawn.length, balanceSplits: selection.balanceSplits,
      passes, scannedLeaves, triangles: indices.length / 3, overhangLeaves: shell.overhangLeaves, mostCrossings: shell.mostCrossings,
      zoneLevel: zone?.level ?? 0, zoneLeaves: zone ? zone.i1 - zone.i0 + 1 : 0, zoneCells: zoneMesh?.cells ?? 0,
      zoneOverhangColumns: zoneMesh?.overhangColumns ?? 0, zoneTriangles: (zoneMesh?.indices.length ?? 0) / 3,
      pinnedConflicts: selection.pinnedConflicts, selectMs, scanMs, assembleMs: performance.now() - assembling,
    };
  };

  const changed = () => { dirty = true; };
  /** The field changed: every scan is stale. */
  const fieldChanged = () => {
    scans.clear();
    dirty = true;
  };

  return {
    mesh,
    probeMaterial,
    get stats() { return stats; },
    setBody(radiusM) {
      radius = radiusM;
      buildField.setBody(radiusM);
      drawField.setBody(radiusM);
      fieldChanged();
    },
    setCamera(x, y, z) {
      if (x === camera[0] && y === camera[1] && z === camera[2]) return;
      camera = [x, y, z];
      drawField.setOrigin(x, y, z);
      place();
      changed();
    },
    setView(next) {
      if (view && view.fovDeg === next.fovDeg && view.aspect === next.aspect && view.forward.every((v, k) => v === next.forward[k])
        && view.up.every((v, k) => v === next.up[k])) return;
      view = next;
      changed();
    },
    setSun(x, y, z) { uSun.value.set(x, y, z); },
    setProbePixelAngle(radians) { uProbePixelAngle.value = radians; },
    setPixelAngle(radians) {
      if (radians !== pixelAngle) {
        pixelAngle = radians;
        changed();
      }
    },
    setBiome(biome) { buildField.setBiome(biome); drawField.setBiome(biome); fieldChanged(); },
    setRock(grounded) { buildField.setRock(grounded); drawField.setRock(grounded); fieldChanged(); },
    setShapeOps(ops) { buildField.setShapeOps(ops); drawField.setShapeOps(ops); fieldChanged(); },
    setBlocks(on) {
      if (on !== blocks) {
        blocks = on;
        changed();
      }
    },
    async update(renderer) {
      while (running || dirty) {
        if (!running) running = build(renderer).finally(() => { running = undefined; });
        await running;
      }
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      probeMaterial.dispose();
    },
  };
}
