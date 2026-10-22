import { padEdit, unitM, type TerrainEdit } from './planet-shape-field';
import { shapeOpFromTerrainEdit, type ShapeOp } from './shape-ops/shape-op';

/**
 * Plan 055: named edit lists for the lab and its tests, sized from the body radius so they read the same on every body.
 * `pad` is the default (the flat pad under the poses); `sites` adds one of each kind east of the poses (+X, where the
 * low flyover and the horizon-grazing views look): a raised flat base, a crater carved into the pad's rim, and a softened
 * stretch of canyon country. `landforms` (shape ops only) adds a mountain, a crater, a ridge, a road and the three 3D
 * shapes a height field cannot hold: an overhang, an arch and a tunnel.
 */
export type TerrainEditPresetId = 'pad' | 'none' | 'sites' | 'landforms';

export const TERRAIN_EDIT_PRESETS: readonly { readonly id: TerrainEditPresetId; readonly label: string }[] = [
  { id: 'pad', label: 'pad' },
  { id: 'none', label: 'none' },
  { id: 'sites', label: 'pad + base sites' },
  { id: 'landforms', label: 'pad + landforms' },
];

/** Body-relative point `angle` radians east of +Z (towards +X), `north` radians towards +Y, at `altitudeM`. */
function eastOfPoses(radiusM: number, angle: number, north: number, altitudeM: number): [number, number, number] {
  const r = radiusM + altitudeM;
  const x = Math.sin(angle) * Math.cos(north);
  const y = Math.sin(north);
  const z = Math.cos(angle) * Math.cos(north);
  return [x * r, y * r, z * r];
}

export function terrainEditPreset(id: Exclude<TerrainEditPresetId, 'landforms'>, radiusM: number): readonly TerrainEdit[] {
  if (id === 'none') return [];
  const pad = padEdit(radiusM);
  if (id === 'pad') return [pad];
  const unit = unitM(radiusM);
  return [
    pad,
    // A raised flat base, level a unit above the sphere; its wide edge keeps the field's slope low enough to march.
    { kind: 'flatten', centre: eastOfPoses(radiusM, 0.014, 0.002, 0), radiusM: 0.0015 * radiusM, edgeM: 0.003 * radiusM, heightM: unit },
    // A bowl carved into the pad's rim.
    { kind: 'carve', centre: eastOfPoses(radiusM, 0.0045, -0.001, 0), radiusM: 0.001 * radiusM, edgeM: 0.0002 * radiusM },
    // Canyon country further out, softened to a fifth of its relief.
    { kind: 'soften', centre: eastOfPoses(radiusM, 0.035, 0, 0), radiusM: 0.006 * radiusM, edgeM: 0.004 * radiusM, strength: 0.2 },
  ];
}

/** A preset as shape ops: the edit presets converted one to one, and the landforms. */
export function shapeOpPreset(id: TerrainEditPresetId, radiusM: number): readonly ShapeOp[] {
  if (id !== 'landforms') return terrainEditPreset(id, radiusM).map((edit, i) => shapeOpFromTerrainEdit(edit, `${id}-${i}`));
  const u = unitM(radiusM);
  // Offsets in relief units east (and north) of the poses, so the set reads the same on every body.
  const at = (east: number, north: number, altitude = 0) => eastOfPoses(radiusM, (east * u) / radiusM, (north * u) / radiusM, altitude * u);
  return [
    shapeOpFromTerrainEdit(padEdit(radiusM), 'pad'),
    // Raised, not added: it stands in canyon country, and added to a canyon floor it would barely reach the plain.
    {
      id: 'mountain', shape: { kind: 'cone', centre: at(30, 4), radiusM: 9 * u, heightM: 5 * u, edgeM: 2 * u, sharpness: 1.3 },
      blend: { mode: 'raise', smoothM: 0.6 * u }, fidelity: 'silhouette',
    },
    {
      id: 'crater', shape: { kind: 'crater', centre: at(16, -8), radiusM: 4 * u, depthM: 1.5 * u, rimHeightM: 0.8 * u, rimWidthM: 2 * u, edgeM: u },
      blend: { mode: 'add' },
    },
    {
      id: 'ridge', shape: { kind: 'path', points: [at(14, 10), at(24, 14), at(36, 12)], heightsM: [2 * u, 3 * u, 2.5 * u], widthM: 3 * u, edgeM: 2 * u, profile: 'round' },
      blend: { mode: 'raise', smoothM: 0.5 * u },
    },
    {
      id: 'road', shape: { kind: 'path', points: [at(2, 0), at(12, 1), at(22, -1)], heightsM: [0, 0.2 * u, 0.4 * u], widthM: 0.6 * u, edgeM: 0.6 * u },
      blend: { mode: 'set' }, fidelity: 'contact',
    },
    // A ledge on the mountain's near flank (the cone is 2.3 units high there), sticking out over the slope below.
    { id: 'overhang', shape: { kind: 'sphere', centre: at(25.8, 4, 2.6), radiusM: 1.3 * u }, blend: { mode: 'union', smoothM: 0.3 * u }, fidelity: 'topology' },
    // A bent tube rising out of the plain and back into it.
    {
      id: 'arch', shape: { kind: 'tube', points: [at(10, -3, -0.6), at(11, -3, 1.6), at(13, -3, 2.2), at(15, -3, 1.6), at(16, -3, -0.6)], radiusM: 0.45 * u },
      blend: { mode: 'union', smoothM: 0.2 * u }, fidelity: 'topology',
    },
    // Straight through the mountain's foot, open at both ends.
    { id: 'tunnel', shape: { kind: 'tube', points: [at(24, -2, 0.8), at(37, 2, 0.8)], radiusM: 0.6 * u }, blend: { mode: 'subtract', smoothM: 0.2 * u }, fidelity: 'topology' },
  ];
}
