import type { BrepApi } from './brep-kernel';
import { HOLE_INSET_MM, type PartParameters } from './part-parameters';

/** The branded solid type brepjs hands back from primitives and booleans. */
type BracketSolid = ReturnType<BrepApi['box']>;

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

/** Result of one brepjs build: render data plus the measurements a CAD user wants. */
export interface BuiltPart {
  readonly geometry: PartGeometry;
  readonly volumeMm3: number;
  readonly triangleCount: number;
  readonly filletApplied: boolean;
  readonly buildMs: number;
  readonly note: string | null;
  /** Write the same solid as STEP (exact CAD exchange). */
  exportStep(): Promise<Blob>;
  /** Write the same solid as STL (print/slicer exchange). */
  exportStl(): Promise<Blob>;
}

/** Smallest fillet worth attempting, in millimetres. */
const MIN_FILLET_MM = 0.5;
/** Keep the fillet clear of the plate's half-thickness. */
const FILLET_SAFETY_RATIO = 0.45;
/** How far the drill cylinder overshoots the plate on each side. */
const DRILL_OVERSHOOT = 1.5;

/**
 * Build the bracket on a real kernel: plate, optional flange, two drilled
 * holes and vertical-edge fillets, then tessellate it for the engine.
 *
 * Fillet failure is not fatal — the unfilleted solid is returned with a note,
 * because a POC should show the failure instead of hiding it.
 */
export function buildBracket(
  brep: BrepApi,
  params: PartParameters,
  toleranceMm: number,
): BuiltPart {
  const startedAt = performance.now();
  const {
    box,
    cylinder,
    cut,
    fuse,
    fillet,
    edgeFinder,
    mesh,
    meshEdges,
    measureVolume,
    toBufferGeometryData,
    toLineGeometryData,
    translate,
    exportSTEP,
    exportSTL,
    isOk,
    unwrap,
  } = brep;

  const { width, depth, thickness, flangeHeight, holeDiameter } = params;

  let body: BracketSolid = box(width, depth, thickness, { centered: true });
  if (flangeHeight > 0) {
    const flange = translate(box(thickness, depth, flangeHeight, { centered: true }), [
      -(width - thickness) / 2,
      0,
      thickness / 2 + flangeHeight / 2,
    ]);
    body = unwrap(fuse(body, flange));
  }

  const holeRadius = holeDiameter / 2;
  const holeX = width / 2 - Math.max(HOLE_INSET_MM, holeRadius * 1.6);
  const holesFit = holeRadius > 0 && holeX > holeRadius && holeRadius < depth / 2 - holeRadius;
  if (holesFit) {
    const drillHeight = thickness * DRILL_OVERSHOOT * 2;
    for (const x of [-holeX, holeX]) {
      const drill = cylinder(holeRadius, drillHeight, {
        at: [x, 0, -drillHeight / 2],
      });
      body = unwrap(cut(body, drill));
    }
  }

  const filletCeiling =
    Math.min(thickness / 2, flangeHeight > 0 ? flangeHeight / 2 : thickness / 2) *
    FILLET_SAFETY_RATIO;
  const requestedFillet = Math.min(params.filletRadius, filletCeiling);
  let filletApplied = false;
  let note: string | null = holesFit ? null : 'Holes skipped: they do not fit these dimensions.';
  if (requestedFillet >= MIN_FILLET_MM) {
    const verticalEdges = edgeFinder().inDirection('Z').findAll(body);
    const filleted = fillet(body, verticalEdges, requestedFillet);
    if (isOk(filleted)) {
      body = filleted.value;
      filletApplied = true;
    } else {
      note = `Fillet ${requestedFillet.toFixed(2)} mm rejected by the kernel; showing square edges.`;
    }
  }

  const solidMesh = mesh(body, { tolerance: toleranceMm });
  const edgeMesh = meshEdges(body, { tolerance: toleranceMm });
  const geometryData = toBufferGeometryData(solidMesh);
  const edgeData = toLineGeometryData(edgeMesh);

  return {
    geometry: {
      position: geometryData.position,
      normal: geometryData.normal,
      index: geometryData.index,
      edgePosition: edgeData.position,
    },
    volumeMm3: unwrap(measureVolume(body)),
    triangleCount: solidMesh.triangles.length / 3,
    filletApplied,
    buildMs: performance.now() - startedAt,
    note,
    exportStep: async () => unwrap(exportSTEP(body)),
    exportStl: async () => unwrap(exportSTL(body)),
  };
}
