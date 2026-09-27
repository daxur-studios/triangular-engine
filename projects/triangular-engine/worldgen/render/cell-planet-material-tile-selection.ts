import { Frustum, Matrix4, Sphere, Vector3, type Camera } from 'three';
import {
  LatLonTerrainDomain,
  selectTerrainMaterialTiles,
  type ITerrainMaterialTileAddress,
  type ITerrainMaterialTileSelection,
} from 'triangular-engine/terrain';
import {
  EQUAL_EARTH_PROJECTION,
  EQUIRECTANGULAR_PROJECTION,
  type MapProjectionKind,
} from './map-projections';

export interface ICellPlanetMaterialTileSelectionOptions {
  readonly domain: LatLonTerrainDomain;
  readonly radiusM: number;
  readonly camera: Camera;
  readonly viewportWidthPixels: number;
  readonly viewportHeightPixels: number;
  readonly morphProgress: number;
  readonly projectionKind: MapProjectionKind;
  readonly heightScaleM: number;
  /** Interior texels per tile divided by the desired screen-space pixels per texel. */
  readonly targetTilePixels: number;
  readonly previousRefined?: ReadonlySet<string>;
  readonly maxTiles?: number;
  readonly maxLevel?: number;
  /** Returns the resident centre elevation for this tile, if one is available. */
  readonly elevationAt?: (
    address: ITerrainMaterialTileAddress,
  ) => number | undefined;
}

/** Selects texture detail independently of mesh LOD for a spherical/morphing cell planet. */
export function selectCellPlanetMaterialTiles(
  options: ICellPlanetMaterialTileSelectionOptions,
): ITerrainMaterialTileSelection {
  const {
    camera,
    domain,
    radiusM: radius,
    viewportWidthPixels,
    viewportHeightPixels,
    heightScaleM,
  } = options;
  const morph = Math.max(0, Math.min(1, options.morphProgress));
  const viewportWidth = Math.max(1, viewportWidthPixels);
  const viewportHeight = Math.max(1, viewportHeightPixels);
  camera.updateMatrixWorld();

  const viewProjection = new Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  const frustum = new Frustum().setFromProjectionMatrix(viewProjection);
  const cameraPosition = new Vector3().setFromMatrixPosition(
    camera.matrixWorld,
  );
  const cameraDistance = cameraPosition.length();
  const focalPixels =
    Math.max(
      viewportWidth * camera.projectionMatrix.elements[0],
      viewportHeight * camera.projectionMatrix.elements[5],
    ) * 0.5;
  const bounds = new Sphere();
  const centerDirection = new Vector3();
  const projection =
    options.projectionKind === 'equirectangular'
      ? EQUIRECTANGULAR_PROJECTION
      : EQUAL_EARTH_PROJECTION;
  const mapWidth = Math.PI * 2 * radius;
  const mapHeight = Math.PI * radius;

  const measure = (address: ITerrainMaterialTileAddress): number => {
    if (address.level === 0) return Math.max(viewportWidth, viewportHeight) * 4;
    const divisions = 2 ** address.level;
    const longitude = ((address.x + 0.5) / divisions - 0.5) * Math.PI * 2;
    const latitude = ((address.y + 0.5) / divisions - 0.5) * Math.PI;
    const direction = domain.getFieldPosition(
      { level: 0, x: 0, y: 0 },
      longitude,
      latitude,
    );
    centerDirection.set(...direction);

    let elevation = 0.35;
    for (let level = address.level; level >= 0; level--) {
      const divisor = 2 ** (address.level - level);
      const sampled = options.elevationAt?.({
        level,
        x: Math.floor(address.x / divisor),
        y: Math.floor(address.y / divisor),
      });
      if (sampled !== undefined && Number.isFinite(sampled)) {
        elevation = sampled;
        break;
      }
    }

    const height = elevation * heightScaleM;
    const projected = projection.project(
      longitude,
      latitude,
      mapWidth,
      mapHeight,
    );
    bounds.center.set(
      direction[0] * (radius + height) * (1 - morph) +
        (projected.x - mapWidth * 0.5) * morph,
      direction[1] * (radius + height) * (1 - morph) +
        (mapHeight * 0.5 - projected.y) * morph,
      direction[2] * (radius + height) * (1 - morph) + height * morph,
    );

    // Conservative angular and relief bounds keep fine texture selection ahead of camera motion.
    const halfAngle = Math.min(Math.PI, (1.5 * Math.PI) / divisions);
    const reliefMargin = heightScaleM * 2;
    bounds.radius = radius * halfAngle * 1.3 + reliefMargin;
    if (!frustum.intersectsSphere(bounds)) return 0;
    if (morph < 0.001 && cameraDistance > radius + reliefMargin) {
      const angle = Math.acos(
        Math.max(
          -1,
          Math.min(1, centerDirection.dot(cameraPosition) / cameraDistance),
        ),
      );
      const horizon = Math.acos(Math.min(1, radius / cameraDistance));
      if (angle - halfAngle > horizon + 0.12) return 0;
    }

    const distance = Math.max(
      radius * 0.000001,
      cameraPosition.distanceTo(bounds.center) - radius * halfAngle * 1.3,
    );
    return ((mapWidth / divisions) * focalPixels) / distance;
  };

  return selectTerrainMaterialTiles({
    measure,
    targetTilePixels: options.targetTilePixels,
    previousRefined: options.previousRefined,
    maxTiles: options.maxTiles,
    maxLevel: options.maxLevel,
  });
}
