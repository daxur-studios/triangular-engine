import {
  box,
  cylinder,
  cut,
  defineParams,
  edgeFinder,
  fillet,
  fuse,
  getBounds,
  isOk,
  translate,
  unwrap,
  withScope,
} from 'brepjs';

/**
 * A parametric mounting bracket: a centred plate, an optional vertical flange
 * fused to one side, two drilled mounting holes, and a fillet on the vertical
 * edges.
 *
 * This file is a `brep` part, not an app module. `brep verify` runs it on a
 * real kernel and reports what the kernel measured, which is the only feedback
 * an agent authoring geometry can trust. `src/app/part/bracket-render.ts`
 * tessellates the same solid for the engine, so the verified part and the
 * rendered part cannot drift.
 *
 * Units are millimetres and the build is Z-up, matching brepjs.
 */

/** The solid type the functional API hands back. */
type BracketSolid = ReturnType<typeof box>;

/** Distance from the plate's side edge to the centre of a mounting hole. */
export const HOLE_INSET_MM = 18;

/** A hole centre stays at least this many radii clear of the plate's side. */
const HOLE_EDGE_CLEARANCE_RADII = 1.6;

/** The drill is this many plate thicknesses long, so it cuts cleanly through. */
const DRILL_OVERSHOOT_RATIO = 3;

/** A fallback fillet is never larger than this share of the plate thickness. */
const FILLET_MAX_THICKNESS_RATIO = 0.9;

/** Tolerance when matching an edge to the plate's outline, in millimetres. */
const EDGE_MATCH_EPSILON_MM = 0.01;

/** Smallest fillet worth attempting, in millimetres. */
const MIN_FILLET_MM = 0.5;

/** The dimensions a caller can change, and what a UI needs to build a control for each. */
export const params = defineParams({
  width: {
    type: 'number',
    default: 120,
    min: 60,
    max: 200,
    step: 1,
    unit: 'mm',
    label: 'Width',
    group: 'Plate',
  },
  depth: {
    type: 'number',
    default: 80,
    min: 40,
    max: 160,
    step: 1,
    unit: 'mm',
    label: 'Depth',
    group: 'Plate',
  },
  thickness: {
    type: 'number',
    default: 8,
    min: 4,
    max: 20,
    step: 0.5,
    unit: 'mm',
    label: 'Thickness',
    group: 'Plate',
  },
  flangeHeight: {
    type: 'number',
    default: 40,
    min: 0,
    max: 100,
    step: 1,
    unit: 'mm',
    label: 'Flange',
    group: 'Flange',
  },
  holeDiameter: {
    type: 'number',
    default: 9,
    min: 3,
    max: 20,
    step: 0.5,
    unit: 'mm',
    label: 'Hole dia',
    group: 'Holes',
  },
  filletRadius: {
    type: 'number',
    default: 4,
    min: 0,
    max: 10,
    step: 0.5,
    unit: 'mm',
    label: 'Fillet',
    group: 'Fillet',
  },
});

/** The values a build takes, as declared above. */
export type BracketValues = typeof params.values;

/**
 * What the part is supposed to measure, so `brep verify` can fail a part that
 * builds but is the wrong size.
 *
 * Only extents this file places itself are declared: the plate is centred, and
 * the flange's top face sits exactly `flangeHeight` above the plate's top. A
 * fillet only ever removes material, so it cannot move any of these faces, and
 * the assertion holds whether or not the kernel accepts the fillet.
 */
export const expected = (p = params.values) => ({
  bounds: {
    xMin: -p.width / 2,
    xMax: p.width / 2,
    yMin: -p.depth / 2,
    yMax: p.depth / 2,
    zMin: -p.thickness / 2,
    zMax: p.thickness / 2 + p.flangeHeight,
  },
  tolerancePct: 0.5,
});

/** One build: the solid plus what the builder had to do to get it. */
export interface BracketBuild {
  /** The built solid. Owned by the caller; it survives the disposal scope. */
  readonly solid: BracketSolid;
  /** False when the kernel rejected every fillet radius this build tried. */
  readonly filletApplied: boolean;
  /** Something the caller should tell the user, or null. */
  readonly note: string | null;
}

/**
 * Build the bracket. Every intermediate shape is released when the build
 * returns, so repeated rebuilds in a live app do not grow WASM memory.
 *
 * Fillet rejection is not fatal: the square-edged solid is returned with a
 * note, because a parametric UI should degrade rather than throw.
 */
export function buildBracket(p: BracketValues = params.values): BracketBuild {
  return withScope((scope) => {
    let solid: BracketSolid = box(p.width, p.depth, p.thickness, { centered: true });

    /** Release the previous body and take the new one. */
    const advance = (next: BracketSolid): void => {
      scope.register(solid);
      solid = next;
    };

    if (p.flangeHeight > 0) {
      const flange = scope.register(
        translate(scope.register(box(p.thickness, p.depth, p.flangeHeight, { centered: true })), [
          -(p.width - p.thickness) / 2,
          0,
          p.thickness / 2 + p.flangeHeight / 2,
        ]),
      );
      advance(unwrap(fuse(solid, flange)));
    }

    const holeRadius = p.holeDiameter / 2;
    const holeX = p.width / 2 - Math.max(HOLE_INSET_MM, holeRadius * HOLE_EDGE_CLEARANCE_RADII);
    const holesFit =
      holeRadius > 0 && holeX > holeRadius && holeRadius < p.depth / 2 - holeRadius;
    if (holesFit) {
      const drillHeight = p.thickness * DRILL_OVERSHOOT_RATIO;
      for (const x of [-holeX, holeX]) {
        const drill = scope.register(cylinder(holeRadius, drillHeight, { at: [x, 0, -drillHeight / 2] }));
        advance(unwrap(cut(solid, drill)));
      }
    }

    /**
     * The plate's four vertical corner edges. Selecting "every vertical edge"
     * also picks up the flange's corners and the hole bores' seam edges, and
     * blending those together produces a shape that fails BRepCheck. The plate
     * outline is the part worth rounding.
     */
    const plateCorners = () =>
      edgeFinder()
        .inDirection('Z')
        .when((edge) => {
          const bounds = getBounds(edge);
          return (
            Math.abs(Math.abs(bounds.xMax) - p.width / 2) < EDGE_MATCH_EPSILON_MM &&
            Math.abs(Math.abs(bounds.yMax) - p.depth / 2) < EDGE_MATCH_EPSILON_MM &&
            bounds.zMax <= p.thickness / 2 + EDGE_MATCH_EPSILON_MM
          );
        })
        .findAll(solid);

    /** Fillet the plate corners at `radius`, or null when the kernel refuses. */
    const attemptFillet = (radius: number): BracketSolid | null => {
      const result = fillet(solid, plateCorners(), radius);
      return isOk(result) ? result.value : null;
    };

    let filletApplied = false;
    let note: string | null = holesFit ? null : 'Holes skipped: they do not fit these dimensions.';
    if (p.filletRadius >= MIN_FILLET_MM) {
      const exact = attemptFillet(p.filletRadius);
      const ceiling =
        FILLET_MAX_THICKNESS_RATIO *
        Math.min(p.thickness, p.width / 2, p.depth / 2);
      const reduced =
        exact === null && ceiling >= MIN_FILLET_MM && ceiling < p.filletRadius
          ? attemptFillet(ceiling)
          : null;
      const applied = exact ?? reduced;
      if (applied !== null) {
        advance(applied);
        filletApplied = true;
        if (exact === null) {
          note = `Fillet reduced to ${ceiling.toFixed(2)} mm: the kernel rejected ${p.filletRadius} mm here.`;
        }
      } else {
        note = `Fillet rejected by the kernel at ${p.filletRadius} mm; showing square edges.`;
      }
    }

    return { solid, filletApplied, note };
  });
}

/** The `brep` entry point: the shape alone, built at the declared defaults. */
export default (p: BracketValues = params.values) => buildBracket(p).solid;
