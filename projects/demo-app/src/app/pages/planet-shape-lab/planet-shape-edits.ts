import { padEdit, unitM, type TerrainEdit } from './planet-shape-field';

/**
 * Plan 055: named edit lists for the lab and its tests, sized from the body radius so they read the same on every body.
 * `pad` is the default (the flat pad under the poses); `sites` adds one of each kind east of the poses (+X, where the
 * low flyover and the horizon-grazing views look): a raised flat base, a crater carved into the pad's rim, and a softened
 * stretch of canyon country.
 */
export type TerrainEditPresetId = 'pad' | 'none' | 'sites';

export const TERRAIN_EDIT_PRESETS: readonly { readonly id: TerrainEditPresetId; readonly label: string }[] = [
  { id: 'pad', label: 'pad' },
  { id: 'none', label: 'none' },
  { id: 'sites', label: 'pad + base sites' },
];

/** Body-relative point `angle` radians east of +Z (towards +X), `north` radians towards +Y, at `altitudeM`. */
function eastOfPoses(radiusM: number, angle: number, north: number, altitudeM: number): [number, number, number] {
  const r = radiusM + altitudeM;
  const x = Math.sin(angle) * Math.cos(north);
  const y = Math.sin(north);
  const z = Math.cos(angle) * Math.cos(north);
  return [x * r, y * r, z * r];
}

export function terrainEditPreset(id: TerrainEditPresetId, radiusM: number): readonly TerrainEdit[] {
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
