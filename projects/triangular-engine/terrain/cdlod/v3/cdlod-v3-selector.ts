import {
  CDLOD_CUBE_FACES,
  computePatchCenterAndRadii,
  CubeFaceId,
  faceUvToDirection,
  ICdlodEdgeMorph,
  IPlanetPatchAddress,
  planetPatchNeighbor,
  planetPatchUvBounds,
  PlanetPatchEdge,
} from '../cdlod-quadtree';
import { ICelestialBody, ISurfaceSampler, Vec3d } from 'triangular-engine/celestial';
import { PlanetaryFeaturePyramid, PYRAMID_FLAG_COASTLINE } from './planetary-feature-pyramid';

export interface ICdlodV3SelectionOptions {
  splitErrorPx: number;
  viewportHeightPx: number;
  fovRad: number;
  maxLevel: number;
  baseResolution: number;
  morphStartRatio?: number;
  silhouetteBoost?: number;
  coastlineBoost?: number;
  flatVarianceThresholdM?: number;
}

export interface ICdlodV3Patch {
  readonly address: IPlanetPatchAddress;
  readonly centerBodyFixedM: Vec3d;
  readonly boundingRadiusM: number;
  readonly resolution: number;
  readonly morphFactor: number;
  readonly edgeMorph: ICdlodEdgeMorph;
  readonly minElevationM: number;
  readonly maxElevationM: number;
  readonly varianceM: number;
  readonly isCoastline: boolean;
  readonly isOceanOnly: boolean;
}

interface IQuadtreeNode {
  readonly address: IPlanetPatchAddress;
  readonly centerM: Vec3d;
  readonly boundingRadiusM: number;
  readonly distanceM: number;
  readonly varianceM: number;
  readonly minElevM: number;
  readonly maxElevM: number;
  readonly isCoastline: boolean;
  readonly isOceanOnly: boolean;
  readonly errorPx: number;
  readonly isSilhouette: boolean;
  shouldSplit: boolean;
  children?: IQuadtreeNode[];
}

/**
 * Calculates geometric Screen-Space Error with Horizon Silhouette & Coastline Weighting.
 */
export class CdlodV3Selector {
  readonly body: ICelestialBody;
  readonly pyramid: PlanetaryFeaturePyramid;
  readonly sampler: ISurfaceSampler;

  constructor(
    body: ICelestialBody,
    pyramid: PlanetaryFeaturePyramid,
    sampler: ISurfaceSampler,
  ) {
    this.body = body;
    this.pyramid = pyramid;
    this.sampler = sampler;
  }

  /**
   * Selects optimal LOD patches for rendering.
   *
   * @param cameraBodyFixedM Camera position relative to planet center
   * @param options Selection parameters and quality knobs
   */
  selectPatches(
    cameraBodyFixedM: Vec3d,
    options: ICdlodV3SelectionOptions,
  ): ICdlodV3Patch[] {
    const splitErrorPx = Math.max(1, options.splitErrorPx);
    const vpH = options.viewportHeightPx || 1080;
    const fov = options.fovRad || (60 * Math.PI) / 180;
    const tanHalfFov = Math.tan(fov * 0.5);
    const maxLevel = Math.min(this.pyramid.maxLevel + 4, options.maxLevel ?? 12);
    const morphStart = options.morphStartRatio ?? 0.70;
    const silBoost = options.silhouetteBoost ?? 1.8;
    const coastBoost = options.coastlineBoost ?? 1.5;
    const flatThresholdM = options.flatVarianceThresholdM ?? 2.0;

    // 1. Build initial tree from the 6 cube faces
    const rootNodes: IQuadtreeNode[] = [];
    for (const face of CDLOD_CUBE_FACES) {
      const rootAddress: IPlanetPatchAddress = { face, level: 0, x: 0, y: 0 };
      const rootNode = this.#evaluateNode(
        rootAddress,
        cameraBodyFixedM,
        splitErrorPx,
        vpH,
        tanHalfFov,
        maxLevel,
        silBoost,
        coastBoost,
        flatThresholdM,
      );
      rootNodes.push(rootNode);
    }

    // 2. Expand nodes recursively
    for (const root of rootNodes) {
      this.#expandTree(
        root,
        cameraBodyFixedM,
        splitErrorPx,
        vpH,
        tanHalfFov,
        maxLevel,
        silBoost,
        coastBoost,
        flatThresholdM,
      );
    }

    // 3. Balance 2:1 neighbor levels across all leaves
    this.#balanceNeighborLevels(
      rootNodes,
      cameraBodyFixedM,
      splitErrorPx,
      vpH,
      tanHalfFov,
      maxLevel,
      silBoost,
      coastBoost,
      flatThresholdM,
    );

    // 4. Collect leaf nodes
    const leaves: IQuadtreeNode[] = [];
    for (const root of rootNodes) {
      this.#collectLeaves(root, leaves);
    }

    // 5. Index leaves by patch address string for neighbor queries
    const leafMap = new Map<string, IQuadtreeNode>();
    for (const leaf of leaves) {
      leafMap.set(
        `${leaf.address.face}:${leaf.address.level}:${leaf.address.x}:${leaf.address.y}`,
        leaf,
      );
    }

    // 6. Compute morph factors & edge morphs
    const result: ICdlodV3Patch[] = [];
    for (const leaf of leaves) {
      // Calculate continuous morph factor
      let morphFactor = 0.0;
      if (leaf.errorPx > splitErrorPx * morphStart) {
        morphFactor = Math.min(
          1.0,
          Math.max(
            0.0,
            (leaf.errorPx - splitErrorPx * morphStart) /
              (splitErrorPx * (1.0 - morphStart)),
          ),
        );
      }

      // Edge morph to eliminate T-junction seams with coarser neighbors
      const edgeMorph: ICdlodEdgeMorph = {
        left: this.#computeEdgeMorph(leaf, 'left', leafMap),
        right: this.#computeEdgeMorph(leaf, 'right', leafMap),
        bottom: this.#computeEdgeMorph(leaf, 'bottom', leafMap),
        top: this.#computeEdgeMorph(leaf, 'top', leafMap),
      };

      result.push({
        address: leaf.address,
        centerBodyFixedM: leaf.centerM,
        boundingRadiusM: leaf.boundingRadiusM,
        resolution: options.baseResolution,
        morphFactor,
        edgeMorph,
        minElevationM: leaf.minElevM,
        maxElevationM: leaf.maxElevM,
        varianceM: leaf.varianceM,
        isCoastline: leaf.isCoastline,
        isOceanOnly: leaf.isOceanOnly,
      });
    }

    return result;
  }

  #evaluateNode(
    address: IPlanetPatchAddress,
    cameraBodyFixedM: Vec3d,
    splitErrorPx: number,
    viewportHeightPx: number,
    tanHalfFov: number,
    maxLevel: number,
    silhouetteBoost: number,
    coastlineBoost: number,
    flatThresholdM: number,
  ): IQuadtreeNode {
    const bounds = planetPatchUvBounds(address);
    const midU = (bounds.minU + bounds.maxU) * 0.5;
    const midV = (bounds.minV + bounds.maxV) * 0.5;
    const centerDir = faceUvToDirection(address.face, midU, midV);

    // Exact center elevation to match generateCdlodPatchGeometry / computePatchCenterAndRadii
    const centerElev = this.sampler.sample(centerDir).elevationM;
    const centerRadiusM = this.body.radiusM + centerElev;
    const centerM: Vec3d = [
      centerDir[0] * centerRadiusM,
      centerDir[1] * centerRadiusM,
      centerDir[2] * centerRadiusM,
    ];

    let minElev = centerElev;
    let maxElev = centerElev;
    let variance = 10.0;

    if (address.level <= this.pyramid.maxLevel) {
      const node = this.pyramid.getNode(address);
      if (node) {
        minElev = node.minElevationM;
        maxElev = node.maxElevationM;
        variance = node.varianceM;
      }
    } else {
      const pLevel = this.pyramid.maxLevel;
      const shift = address.level - pLevel;
      const px = address.x >> shift;
      const py = address.y >> shift;
      minElev = this.pyramid.getMinElevationM(address.face, pLevel, px, py);
      maxElev = this.pyramid.getMaxElevationM(address.face, pLevel, px, py);
      variance =
        this.pyramid.getVarianceM(address.face, pLevel, px, py) /
        (1 << shift);
    }

    const seaLevelM = this.body.terrain?.ocean?.seaLevelM ?? 0;
    const hasOcean = !!this.body.terrain?.ocean;
    const isOcean = hasOcean && maxElev < seaLevelM - 10;
    const isCoast =
      hasOcean && minElev <= seaLevelM + 5 && maxElev >= seaLevelM - 5;

    const cornerDir = faceUvToDirection(address.face, bounds.maxU, bounds.maxV);
    const chordDist = Math.hypot(
      cornerDir[0] - centerDir[0],
      cornerDir[1] - centerDir[1],
      cornerDir[2] - centerDir[2],
    );
    const boundingRadiusM =
      chordDist * (this.body.radiusM + Math.max(0, maxElev)) +
      Math.max(50, (maxElev - minElev) * 0.5);

    // Distance to camera
    const dx = cameraBodyFixedM[0] - centerM[0];
    const dy = cameraBodyFixedM[1] - centerM[1];
    const dz = cameraBodyFixedM[2] - centerM[2];
    const centerDistM = Math.hypot(dx, dy, dz);
    const surfaceDistM = Math.max(1.0, centerDistM - boundingRadiusM);

    // Camera distance from planet center
    const camDist = Math.hypot(
      cameraBodyFixedM[0],
      cameraBodyFixedM[1],
      cameraBodyFixedM[2],
    );
    const planetR = this.body.radiusM;

    // Geometric Horizon Culling: test if patch is occluded behind the planetary curvature
    const dotCamPatch =
      (cameraBodyFixedM[0] * centerDir[0] +
        cameraBodyFixedM[1] * centerDir[1] +
        cameraBodyFixedM[2] * centerDir[2]) /
      camDist;

    const horizonAngle = Math.acos(Math.min(1.0, planetR / camDist));
    const mountainHorizonAngle = Math.acos(
      Math.min(1.0, planetR / (planetR + Math.max(100, maxElev))),
    );
    const patchAngle = Math.asin(Math.min(1.0, boundingRadiusM / planetR));
    const maxVisibleAngle = horizonAngle + mountainHorizonAngle + patchAngle;
    const camPatchAngle = Math.acos(
      Math.max(-1.0, Math.min(1.0, dotCamPatch)),
    );

    const isBehindHorizon = camPatchAngle > maxVisibleAngle;
    if (isBehindHorizon && address.level > 0) {
      // Patch is fully over the planet horizon -> keep coarse, never split
      return {
        address,
        centerM,
        boundingRadiusM,
        distanceM: surfaceDistM,
        varianceM: variance,
        minElevM: minElev,
        maxElevM: maxElev,
        isCoastline: isCoast,
        isOceanOnly: isOcean,
        errorPx: 0,
        isSilhouette: false,
        shouldSplit: false,
      };
    }

    // Silhouette Detection: angle between view vector and patch surface normal
    const invDist = 1.0 / Math.max(1.0, centerDistM);
    const viewDir: Vec3d = [dx * invDist, dy * invDist, dz * invDist];
    const cosAngle = Math.abs(
      viewDir[0] * centerDir[0] +
        viewDir[1] * centerDir[1] +
        viewDir[2] * centerDir[2],
    );
    // When cosAngle is close to 0, patch is perpendicular to camera view (on the horizon silhouette)
    const isSilhouette = cosAngle < 0.35;
    let silFactor = 1.0;
    if (isSilhouette) {
      silFactor = 1.0 + silhouetteBoost * (1.0 - cosAngle / 0.35);
    }

    // Level geometric error scale: geometric error decays by half at each subdivision level
    const levelErrorScale = 1.0 / (1 << address.level);
    const effectiveVariance =
      (isCoast ? Math.max(15.0, variance) : variance) * levelErrorScale;
    let errorPx =
      (effectiveVariance * viewportHeightPx) /
      (2.0 * surfaceDistM * tanHalfFov);
    errorPx *= silFactor;

    let nodeMaxLevel = maxLevel;
    if (surfaceDistM > 400_000) {
      nodeMaxLevel = Math.min(nodeMaxLevel, 3);
    } else if (surfaceDistM > 150_000) {
      nodeMaxLevel = Math.min(nodeMaxLevel, 4);
    } else if (surfaceDistM > 50_000) {
      nodeMaxLevel = Math.min(nodeMaxLevel, 5);
    } else if (surfaceDistM > 20_000) {
      nodeMaxLevel = Math.min(nodeMaxLevel, 6);
    } else if (surfaceDistM > 8_000) {
      nodeMaxLevel = Math.min(nodeMaxLevel, 7);
    } else if (surfaceDistM > 3_000) {
      nodeMaxLevel = Math.min(nodeMaxLevel, 8);
    } else if (surfaceDistM > 1_000) {
      nodeMaxLevel = Math.min(nodeMaxLevel, 9);
    }

    // Flat region suppression: flat ground / calm water does not split past level 3
    let shouldSplit = false;
    if (address.level < nodeMaxLevel) {
      if (isOcean && !isCoast) {
        // Pure ocean water never needs deep subdivision
        shouldSplit = surfaceDistM < 300.0 && address.level < 3;
      } else if (variance < flatThresholdM && !isCoast) {
        // Flat terrain only splits if camera is extremely close
        shouldSplit = surfaceDistM < 80.0 && address.level < 4;
      } else {
        shouldSplit = errorPx >= splitErrorPx;
      }
    }

    return {
      address,
      centerM,
      boundingRadiusM,
      distanceM: surfaceDistM,
      varianceM: variance,
      minElevM: minElev,
      maxElevM: maxElev,
      isCoastline: isCoast,
      isOceanOnly: isOcean,
      errorPx,
      isSilhouette,
      shouldSplit,
    };
  }

  #expandTree(
    node: IQuadtreeNode,
    cameraBodyFixedM: Vec3d,
    splitErrorPx: number,
    vpH: number,
    tanHalfFov: number,
    maxLevel: number,
    silBoost: number,
    coastBoost: number,
    flatThresholdM: number,
  ): void {
    if (!node.shouldSplit || node.address.level >= maxLevel) return;

    const nextLevel = node.address.level + 1;
    const nx = node.address.x * 2;
    const ny = node.address.y * 2;

    const c00 = this.#evaluateNode(
      { face: node.address.face, level: nextLevel, x: nx, y: ny },
      cameraBodyFixedM,
      splitErrorPx,
      vpH,
      tanHalfFov,
      maxLevel,
      silBoost,
      coastBoost,
      flatThresholdM,
    );
    const c10 = this.#evaluateNode(
      { face: node.address.face, level: nextLevel, x: nx + 1, y: ny },
      cameraBodyFixedM,
      splitErrorPx,
      vpH,
      tanHalfFov,
      maxLevel,
      silBoost,
      coastBoost,
      flatThresholdM,
    );
    const c01 = this.#evaluateNode(
      { face: node.address.face, level: nextLevel, x: nx, y: ny + 1 },
      cameraBodyFixedM,
      splitErrorPx,
      vpH,
      tanHalfFov,
      maxLevel,
      silBoost,
      coastBoost,
      flatThresholdM,
    );
    const c11 = this.#evaluateNode(
      { face: node.address.face, level: nextLevel, x: nx + 1, y: ny + 1 },
      cameraBodyFixedM,
      splitErrorPx,
      vpH,
      tanHalfFov,
      maxLevel,
      silBoost,
      coastBoost,
      flatThresholdM,
    );

    node.children = [c00, c10, c01, c11];

    for (const child of node.children) {
      this.#expandTree(
        child,
        cameraBodyFixedM,
        splitErrorPx,
        vpH,
        tanHalfFov,
        maxLevel,
        silBoost,
        coastBoost,
        flatThresholdM,
      );
    }
  }

  #balanceNeighborLevels(
    roots: IQuadtreeNode[],
    cameraBodyFixedM: Vec3d,
    splitErrorPx: number,
    vpH: number,
    tanHalfFov: number,
    maxLevel: number,
    silBoost: number,
    coastBoost: number,
    flatThresholdM: number,
  ): void {
    let changed = true;
    let passes = 0;
    const maxPasses = 32;

    while (changed && passes < maxPasses) {
      changed = false;
      passes++;

      const leaves: IQuadtreeNode[] = [];
      for (const root of roots) {
        this.#collectLeaves(root, leaves);
      }

      for (const leaf of leaves) {
        // Check 4 cardinal neighbors
        for (const edge of ['left', 'right', 'bottom', 'top'] as const) {
          const nAddr = planetPatchNeighbor(leaf.address, edge);
          const neighborLeaf = this.#findLeafAt(roots, nAddr);
          if (
            neighborLeaf &&
            neighborLeaf.address.level < leaf.address.level - 1
          ) {
            // Split the coarse neighbor by 1 level to maintain 2:1 ratio
            neighborLeaf.shouldSplit = true;
            const nextLvl = neighborLeaf.address.level + 1;
            const nx = neighborLeaf.address.x * 2;
            const ny = neighborLeaf.address.y * 2;
            neighborLeaf.children = [
              this.#evaluateNode(
                { face: neighborLeaf.address.face, level: nextLvl, x: nx, y: ny },
                cameraBodyFixedM,
                splitErrorPx,
                vpH,
                tanHalfFov,
                maxLevel,
                silBoost,
                coastBoost,
                flatThresholdM,
              ),
              this.#evaluateNode(
                {
                  face: neighborLeaf.address.face,
                  level: nextLvl,
                  x: nx + 1,
                  y: ny,
                },
                cameraBodyFixedM,
                splitErrorPx,
                vpH,
                tanHalfFov,
                maxLevel,
                silBoost,
                coastBoost,
                flatThresholdM,
              ),
              this.#evaluateNode(
                {
                  face: neighborLeaf.address.face,
                  level: nextLvl,
                  x: nx,
                  y: ny + 1,
                },
                cameraBodyFixedM,
                splitErrorPx,
                vpH,
                tanHalfFov,
                maxLevel,
                silBoost,
                coastBoost,
                flatThresholdM,
              ),
              this.#evaluateNode(
                {
                  face: neighborLeaf.address.face,
                  level: nextLvl,
                  x: nx + 1,
                  y: ny + 1,
                },
                cameraBodyFixedM,
                splitErrorPx,
                vpH,
                tanHalfFov,
                maxLevel,
                silBoost,
                coastBoost,
                flatThresholdM,
              ),
            ];
            changed = true;
          }
        }
      }
    }
  }

  #collectLeaves(node: IQuadtreeNode, outLeaves: IQuadtreeNode[]): void {
    if (!node.children || node.children.length === 0) {
      outLeaves.push(node);
      return;
    }
    for (const child of node.children) {
      this.#collectLeaves(child, outLeaves);
    }
  }

  #findLeafAt(roots: IQuadtreeNode[], address: IPlanetPatchAddress): IQuadtreeNode | null {
    const fIdx = CDLOD_CUBE_FACES.indexOf(address.face);
    if (fIdx < 0) return null;
    let curr = roots[fIdx];
    if (!curr) return null;

    while (curr.children && curr.children.length > 0) {
      if (curr.address.level === address.level) break;
      const shift = address.level - (curr.address.level + 1);
      if (shift < 0) break;
      const targetBitX = (address.x >> shift) & 1;
      const targetBitY = (address.y >> shift) & 1;
      const childIdx = targetBitY * 2 + targetBitX;
      curr = curr.children[childIdx];
      if (!curr) return null;
    }
    return curr;
  }

  #computeEdgeMorph(
    leaf: IQuadtreeNode,
    edge: PlanetPatchEdge,
    leafMap: Map<string, IQuadtreeNode>,
  ): number {
    const nAddr = planetPatchNeighbor(leaf.address, edge);
    // If neighbor exists at coarse level (parent level), morph this edge to match
    const parentX = nAddr.x >> 1;
    const parentY = nAddr.y >> 1;
    const parentKey = `${nAddr.face}:${leaf.address.level - 1}:${parentX}:${parentY}`;
    const coarseNeighbor = leafMap.get(parentKey);
    if (coarseNeighbor) {
      return 1.0;
    }
    return 0.0;
  }
}
