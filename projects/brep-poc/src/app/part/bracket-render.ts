import type { BracketBuild } from './bracket.brep';
import type { BrepApi } from './brep-kernel';

/**
 * Triangle data in brepjs coordinates (millimetres, Z-up). The scene converts
 * to engine units and Y-up; nothing here knows about Three.js.
 */
export interface PartGeometry {
  readonly position: Float32Array;
  readonly normal: Float32Array;
  readonly index: Uint32Array;
  readonly edgePosition: Float32Array;
}

/**
 * A built part tessellated for the engine, with both exports still bound to the
 * same solid the viewport shows.
 */
export interface RenderedPart {
  readonly geometry: PartGeometry;
  readonly volumeMm3: number;
  readonly triangleCount: number;
  readonly filletApplied: boolean;
  readonly note: string | null;
  /** The kernel shape behind this part. `delete()` it before dropping the part. */
  readonly solid: BracketBuild['solid'];
  /** Write the same solid as STEP (exact CAD exchange). */
  exportStep(): Promise<Blob>;
  /** Write the same solid as STL (print/slicer exchange). */
  exportStl(): Promise<Blob>;
}

/**
 * Tessellate a verified build for the engine. All kernel calls come from the
 * lazily loaded `brepjs` API, so this module never pulls the WASM bundle into
 * the initial chunk.
 */
export function renderBracket(
  brep: BrepApi,
  build: BracketBuild,
  toleranceMm: number,
): RenderedPart {
  const {
    mesh,
    meshEdges,
    toBufferGeometryData,
    toLineGeometryData,
    measureVolume,
    unwrap,
    exportSTEP,
    exportSTL,
  } = brep;

  const solidMesh = mesh(build.solid, { tolerance: toleranceMm });
  const edgeMesh = meshEdges(build.solid, { tolerance: toleranceMm });
  const geometryData = toBufferGeometryData(solidMesh);
  const edgeData = toLineGeometryData(edgeMesh);

  return {
    geometry: {
      position: geometryData.position,
      normal: geometryData.normal,
      index: geometryData.index,
      edgePosition: edgeData.position,
    },
    volumeMm3: unwrap(measureVolume(build.solid)),
    triangleCount: solidMesh.triangles.length / 3,
    filletApplied: build.filletApplied,
    note: build.note,
    solid: build.solid,
    exportStep: async () => unwrap(exportSTEP(build.solid)),
    exportStl: async () => unwrap(exportSTL(build.solid)),
  };
}
