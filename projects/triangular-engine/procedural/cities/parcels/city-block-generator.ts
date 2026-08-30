import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';

export type CityDistrictType = 'downtown' | 'commercial' | 'residential' | 'industrial';

/**
 * Procedural building instance envelope.
 */
export interface ICityBuildingInstance {
  readonly id: string;
  readonly position: readonly [number, number, number];
  readonly dimensions: readonly [number, number, number]; // [width, height, depth]
  readonly rotationY: number; // in radians
  readonly districtType: CityDistrictType;
  readonly colorHex: number;
}

export interface IGridCityOptions {
  readonly blockCountX?: number;
  readonly blockCountZ?: number;
  readonly blockSizeM?: number;
  readonly streetWidthM?: number;
  readonly maxFloorsHeightM?: number;
  readonly densityFactor?: number;
  readonly seed?: number;
}

export interface IVoronoiCityOptions {
  readonly cityRadiusM?: number;
  readonly cellCount?: number;
  readonly maxFloorsHeightM?: number;
  readonly seed?: number;
}

const DISTRICT_COLORS: Record<CityDistrictType, number[]> = {
  downtown: [0x4a6984, 0x5b7f95, 0x3d5a73, 0x6e90a6], // Glass/Steel slate blues
  commercial: [0x8c7863, 0x9e8974, 0x7a6752, 0xa69582], // Modern sandstone/concrete
  residential: [0xa35d48, 0xbd6e57, 0x8f4d3a, 0xcc7d66], // Warm terracotta/brick
  industrial: [0x545b62, 0x474c52, 0x636b73, 0x3b4045], // Dark industrial iron
};

/**
 * Deterministic pseudo-random number generator (Mulberry32).
 */
function createRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates an orthogonal grid city layout of blocks and parcels.
 */
export function generateGridCityBuildings(
  sampleGroundElevation: (x: number, z: number) => number,
  options: IGridCityOptions = {},
): readonly ICityBuildingInstance[] {
  const blocksX = options.blockCountX ?? 5;
  const blocksZ = options.blockCountZ ?? 5;
  const blockSize = options.blockSizeM ?? 36.0;
  const streetWidth = options.streetWidthM ?? 12.0;
  const maxHeight = options.maxFloorsHeightM ?? 70.0;
  const density = Math.max(0.1, Math.min(1.0, options.densityFactor ?? 0.85));
  const rng = createRng(options.seed ?? 12345);

  const buildings: ICityBuildingInstance[] = [];
  const totalGridWidth = blocksX * (blockSize + streetWidth);
  const totalGridDepth = blocksZ * (blockSize + streetWidth);
  const halfGridW = totalGridWidth * 0.5;
  const halfGridD = totalGridDepth * 0.5;

  const maxDistFromCenter = Math.sqrt(halfGridW * halfGridW + halfGridD * halfGridD);

  for (let bx = 0; bx < blocksX; bx++) {
    for (let bz = 0; bz < blocksZ; bz++) {
      const blockCenterX = -halfGridW + bx * (blockSize + streetWidth) + blockSize * 0.5 + streetWidth * 0.5;
      const blockCenterZ = -halfGridD + bz * (blockSize + streetWidth) + blockSize * 0.5 + streetWidth * 0.5;

      const distFromCenter = Math.sqrt(blockCenterX * blockCenterX + blockCenterZ * blockCenterZ);
      const centerFactor = 1.0 - Math.min(1.0, distFromCenter / (maxDistFromCenter * 0.85));

      // District zoning by distance to core
      let districtType: CityDistrictType;
      if (centerFactor > 0.65) {
        districtType = 'downtown';
      } else if (centerFactor > 0.4) {
        districtType = 'commercial';
      } else if (centerFactor > 0.15) {
        districtType = 'residential';
      } else {
        districtType = 'industrial';
      }

      // Subdivide block into 2x2 or 3x3 parcels
      const subCols = rng() > 0.4 ? 2 : 3;
      const subRows = rng() > 0.4 ? 2 : 3;
      const lotW = (blockSize - 2) / subCols;
      const lotD = (blockSize - 2) / subRows;

      for (let c = 0; c < subCols; c++) {
        for (let r = 0; r < subRows; r++) {
          if (rng() > density) continue; // vacant lot / plaza

          const lotCenterX = blockCenterX - blockSize * 0.5 + (c + 0.5) * lotW;
          const lotCenterZ = blockCenterZ - blockSize * 0.5 + (r + 0.5) * lotD;

          // Building footprint with setback
          const bldgW = lotW * (0.7 + rng() * 0.25);
          const bldgD = lotD * (0.7 + rng() * 0.25);

          // Height based on district + noise
          let baseHeightM = 8 + centerFactor * (maxHeight - 8);
          if (districtType === 'downtown') {
            baseHeightM *= 0.8 + rng() * 0.9; // skyscrapers
          } else if (districtType === 'commercial') {
            baseHeightM *= 0.6 + rng() * 0.6;
          } else if (districtType === 'residential') {
            baseHeightM = 6 + rng() * 18;
          } else {
            baseHeightM = 5 + rng() * 10;
          }

          const groundY = sampleGroundElevation(lotCenterX, lotCenterZ);
          const colors = DISTRICT_COLORS[districtType];
          const colorHex = colors[Math.floor(rng() * colors.length)];

          buildings.push({
            id: `bldg_g_${bx}_${bz}_${c}_${r}`,
            position: [lotCenterX, groundY, lotCenterZ],
            dimensions: [bldgW, baseHeightM, bldgD],
            rotationY: 0,
            districtType,
            colorHex,
          });
        }
      }
    }
  }

  return buildings;
}

/**
 * Generates an organic Voronoi / radial layout of city buildings.
 */
export function generateVoronoiCityBuildings(
  sampleGroundElevation: (x: number, z: number) => number,
  options: IVoronoiCityOptions = {},
): readonly ICityBuildingInstance[] {
  const radius = options.cityRadiusM ?? 100.0;
  const cellCount = options.cellCount ?? 32;
  const maxHeight = options.maxFloorsHeightM ?? 65.0;
  const rng = createRng(options.seed ?? 67890);

  const buildings: ICityBuildingInstance[] = [];

  // Generate radial rings of building parcels
  const rings = 5;
  for (let ring = 1; ring <= rings; ring++) {
    const ringRadius = (ring / rings) * radius;
    const ringCircumference = 2 * Math.PI * ringRadius;
    const itemsInRing = Math.floor(ringCircumference / 24);

    for (let i = 0; i < itemsInRing; i++) {
      const angle = (i / itemsInRing) * Math.PI * 2 + (rng() - 0.5) * 0.2;
      const rOffset = ringRadius + (rng() - 0.5) * 12;

      const posX = Math.cos(angle) * rOffset;
      const posZ = Math.sin(angle) * rOffset;

      const dist = Math.sqrt(posX * posX + posZ * posZ);
      const centerFactor = 1.0 - Math.min(1.0, dist / radius);

      let districtType: CityDistrictType;
      if (centerFactor > 0.6) {
        districtType = 'downtown';
      } else if (centerFactor > 0.35) {
        districtType = 'commercial';
      } else if (centerFactor > 0.15) {
        districtType = 'residential';
      } else {
        districtType = 'industrial';
      }

      const bldgW = 12 + rng() * 10;
      const bldgD = 12 + rng() * 10;
      let heightM = 8 + centerFactor * (maxHeight - 8) * (0.7 + rng() * 0.7);

      const groundY = sampleGroundElevation(posX, posZ);
      const colors = DISTRICT_COLORS[districtType];
      const colorHex = colors[Math.floor(rng() * colors.length)];

      // Align building tangent to the radial ring
      const rotationY = -angle;

      buildings.push({
        id: `bldg_v_${ring}_${i}`,
        position: [posX, groundY, posZ],
        dimensions: [bldgW, heightM, bldgD],
        rotationY,
        districtType,
        colorHex,
      });
    }
  }

  return buildings;
}

/**
 * Creates a high-performance Three.js InstancedMesh for rendering all city buildings in 1 draw call.
 */
export function buildCityBuildingsInstancedMesh(
  buildings: readonly ICityBuildingInstance[],
  options: { readonly wireframe?: boolean; readonly foundationDepthM?: number } = {},
): InstancedMesh {
  const count = buildings.length;
  if (count === 0) {
    const emptyGeom = new BoxGeometry(0.1, 0.1, 0.1);
    return new InstancedMesh(emptyGeom, new MeshStandardMaterial(), 0);
  }

  // Unit cube base geometry
  const baseGeom = new BoxGeometry(1.0, 1.0, 1.0);
  // Shift origin to bottom-center of cube
  baseGeom.translate(0, 0.5, 0);

  const material = new MeshStandardMaterial({
    roughness: 0.75,
    metalness: 0.25,
    wireframe: options.wireframe ?? false,
  });

  const instancedMesh = new InstancedMesh(baseGeom, material, count);
  instancedMesh.instanceMatrix.setUsage(DynamicDrawUsage);

  const mat4 = new Matrix4();
  const pos = new Vector3();
  const quat = new Quaternion();
  const scale = new Vector3();
  const color = new Color();

  const foundation = options.foundationDepthM ?? 2.0;

  for (let i = 0; i < count; i++) {
    const bldg = buildings[i];
    const totalHeight = bldg.dimensions[1] + foundation;

    pos.set(bldg.position[0], bldg.position[1] - foundation, bldg.position[2]);
    quat.setFromAxisAngle(new Vector3(0, 1, 0), bldg.rotationY);
    scale.set(bldg.dimensions[0], totalHeight, bldg.dimensions[2]);

    mat4.compose(pos, quat, scale);
    instancedMesh.setMatrixAt(i, mat4);

    color.setHex(bldg.colorHex);
    instancedMesh.setColorAt(i, color);
  }

  instancedMesh.instanceMatrix.needsUpdate = true;
  if (instancedMesh.instanceColor) {
    instancedMesh.instanceColor.needsUpdate = true;
  }

  return instancedMesh;
}
