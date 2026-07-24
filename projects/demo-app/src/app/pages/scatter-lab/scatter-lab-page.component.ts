import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ArrowHelper,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
  type Vector3Tuple,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  CylinderTerrainDomain,
  generateTerrainPatchMesh,
  PlaneTerrainDomain,
  SPHERE_TERRAIN_FACES,
  SphereTerrainDomain,
  type ITerrainField,
  type ITerrainFieldSample,
  type ITerrainPatchMesh,
  type TerrainVector3,
} from 'triangular-engine/terrain';
import {
  bucketScatterInstancesByLod,
  buildScatterInstancedMesh,
  buildScatterInstancedMeshesByLod,
  generateTerrainScatterInstances,
  selectFixedLevelScatterCells,
  type ITerrainScatterInstance,
  type ScatterLodDefinition,
  type ScatterPlacementRules,
} from 'triangular-engine/scatter';

type ScatterLabShape = 'plane' | 'sphere' | 'cylinder';

const PLANE_PATCH_SIZE_M = 80;
const PLANE_GRID_RADIUS = 2;
const SPHERE_RADIUS_M = 220;
const CYLINDER_RADIUS_M = 160;
const CYLINDER_LENGTH_M = 420;
const CYLINDER_ANGULAR_PATCHES = 8;
const CYLINDER_AXIAL_PATCHES = 3;
const TERRAIN_RESOLUTION = 18;
/** Roots restrict traversal to one terrain patch's own subtree, so an oversized radius never leaks into neighbors. */
const SCATTER_SELECT_RADIUS_M = 1_000_000;
const SCATTER_FIXED_LEVEL_DEPTH = 1;
const WORLD_SEED = 1_337;

const TREE_RULES: ScatterPlacementRules = {
  alignment: 'align-to-normal',
  slopeMax01: 0.55,
  embedDepthM: 0.3,
};
const TREE_LAYER_ID = 'trees';
const TREE_SPECIES_ID = 'pine';
const TREE_GENERATOR_VERSION = 1;
const TREE_CANDIDATE_POOL_SIZE = 10;
const TREE_SCALE = { min: 0.7, max: 1.6 };
/**
 * LOD/fade thresholds scale off each shape's own initial camera distance
 * rather than fixed meters — plane/sphere/cylinder previews frame the whole
 * terrain from very different distances (hundreds of meters, not a
 * walking-around distance), so a fixed threshold either culls everything or
 * fades nothing depending on shape.
 */
const TREE_LOD_NEAR_RATIO = 0.55;
const TREE_LOD_FAR_RATIO = 2.2;

const GRASS_RULES: ScatterPlacementRules = {
  alignment: 'align-to-surface-up',
  slopeMax01: 0.75,
};
const GRASS_LAYER_ID = 'grass';
const GRASS_SPECIES_ID = 'meadow-tuft';
const GRASS_GENERATOR_VERSION = 1;
const GRASS_CANDIDATE_POOL_SIZE = 36;
const GRASS_SCALE = { min: 0.5, max: 1.1 };
/** Grass has no far LOD tier, so it fades out by density instead of popping. */
const GRASS_FADE_START_RATIO = 0.5;
const GRASS_FADE_END_RATIO = 1.6;

/** Shared hill noise so every domain's field looks like the same terrain, just curved differently. */
function bumps(x: number, z: number): number {
  return (
    Math.sin(x / 40) * 6 + Math.cos(z / 55) * 5 + Math.sin((x + z) / 23) * 3
  );
}

class PlaneScatterField implements ITerrainField {
  readonly minElevationM = -20;
  readonly maxElevationM = 20;
  sample([x, _y, z]: TerrainVector3): ITerrainFieldSample {
    return { elevationM: bumps(x, z) };
  }
  sampleBatch(positions: Float64Array, out = new Float64Array(positions.length / 3)): Float64Array {
    for (let i = 0; i < out.length; i++) {
      out[i] = bumps(positions[i * 3], positions[i * 3 + 2]);
    }
    return out;
  }
}

class SphereScatterField implements ITerrainField {
  readonly minElevationM = -20;
  readonly maxElevationM = 20;
  constructor(private readonly radiusM: number) {}
  sample([x, y, z]: TerrainVector3): ITerrainFieldSample {
    return {
      elevationM: bumps(x * this.radiusM, z * this.radiusM) + Math.sin(y * 4) * 3,
    };
  }
  sampleBatch(positions: Float64Array, out = new Float64Array(positions.length / 3)): Float64Array {
    for (let i = 0; i < out.length; i++) {
      out[i] = this.sample([
        positions[i * 3],
        positions[i * 3 + 1],
        positions[i * 3 + 2],
      ]).elevationM;
    }
    return out;
  }
}

class CylinderScatterField implements ITerrainField {
  readonly minElevationM = -20;
  readonly maxElevationM = 20;
  constructor(private readonly radiusM: number) {}
  sample([axialM, radialY, radialZ]: TerrainVector3): ITerrainFieldSample {
    const angle = Math.atan2(radialZ, radialY);
    return { elevationM: bumps(axialM, angle * this.radiusM) };
  }
  sampleBatch(positions: Float64Array, out = new Float64Array(positions.length / 3)): Float64Array {
    for (let i = 0; i < out.length; i++) {
      out[i] = this.sample([
        positions[i * 3],
        positions[i * 3 + 1],
        positions[i * 3 + 2],
      ]).elevationM;
    }
    return out;
  }
}

/** One demo-only fixture per shape: reused for both terrain rendering and scatter placement. */
interface IShapeFixture {
  readonly domain: {
    getPatchBounds(address: never): { minU: number; maxU: number; minV: number; maxV: number };
    getSurfacePosition(address: never, u: number, v: number, elevationM: number): TerrainVector3;
    getChildren(address: never): readonly unknown[];
  };
  readonly field: ITerrainField;
  readonly roots: readonly unknown[];
  readonly getCellKey: (address: unknown) => string;
  readonly getLevel: (address: unknown) => number;
  /** A point ON the terrain surface near the camera's view — LOD/fade distance is measured from here, not the (often airborne) camera itself. */
  readonly focusWorldM: TerrainVector3;
  /** Outward direction from focusWorldM, for drawing a flag marker that doesn't clip into the surface. */
  readonly focusUpM: TerrainVector3;
}

@Component({
  selector: 'app-scatter-lab-page',
  imports: [RouterLink, EngineModule, DecimalPipe],
  templateUrl: './scatter-lab-page.component.html',
  styleUrl: './scatter-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    EngineService.provide({
      showFPS: true,
      webGLRendererParameters: { logarithmicDepthBuffer: true },
    }),
  ],
  host: { class: 'flex-page' },
})
export class ScatterLabPageComponent {
  readonly shape = signal<ScatterLabShape>('plane');
  readonly density = signal(0.5);
  readonly treeCount = signal(0);
  readonly treeNearCount = signal(0);
  readonly treeFarCount = signal(0);
  readonly grassCount = signal(0);
  readonly cellCount = signal(0);

  readonly initialCameraPosition = signal<Vector3Tuple>([170, 130, 170]);
  readonly initialTarget = signal<Vector3Tuple>([0, 0, 0]);
  readonly initialUpVector = signal<Vector3Tuple>([0, 1, 0]);

  private readonly engine = inject(EngineService);
  private readonly treeGeometryNear = new ConeGeometry(0.9, 3.2, 6);
  /** Deliberately coarse (3-sided) so the near/far LOD swap reads as an obvious shape change, not just a poly-count nudge. */
  private readonly treeGeometryFar = new ConeGeometry(0.9, 3.2, 3);
  private readonly treeMaterial = new MeshStandardMaterial({
    color: '#3f8f4c',
    roughness: 0.85,
  });
  private readonly treeMaterialFar = new MeshStandardMaterial({
    color: '#2c6636',
    roughness: 1,
  });
  /** A squashed sphere reads as a low mound, not a smaller tree — trees and grass must never look like the same shape at two sizes. */
  private readonly grassGeometry = new SphereGeometry(0.45, 6, 4).scale(1, 0.4, 1);
  private readonly grassMaterial = new MeshStandardMaterial({
    color: '#d7e873',
    roughness: 0.95,
  });
  private readonly groundMaterial = new MeshStandardMaterial({
    color: '#7c8a5a',
    roughness: 0.95,
    vertexColors: true,
  });
  private group?: Group;

  constructor() {
    const destroyRef = inject(DestroyRef);
    const previousBackground = this.engine.scene.background;
    this.engine.scene.background = new Color('#071018');
    this.rebuild();
    destroyRef.onDestroy(() => {
      this.disposeScene();
      this.treeGeometryNear.dispose();
      this.treeGeometryFar.dispose();
      this.treeMaterial.dispose();
      this.treeMaterialFar.dispose();
      this.grassGeometry.dispose();
      this.grassMaterial.dispose();
      this.groundMaterial.dispose();
      this.engine.scene.background = previousBackground;
    });
  }

  selectShape(shape: ScatterLabShape): void {
    if (shape === this.shape()) return;
    this.shape.set(shape);
    this.setCameraForShape(shape);
    this.rebuild();
  }

  setDensity(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.density.set(Math.max(0, Math.min(1, value)));
    this.rebuild();
  }

  private setCameraForShape(shape: ScatterLabShape): void {
    if (shape === 'plane') {
      this.initialCameraPosition.set([170, 130, 170]);
      this.initialTarget.set([0, 0, 0]);
      this.initialUpVector.set([0, 1, 0]);
    } else if (shape === 'sphere') {
      this.initialCameraPosition.set([0, 0, SPHERE_RADIUS_M * 1.9]);
      this.initialTarget.set([0, 0, 0]);
      this.initialUpVector.set([0, 1, 0]);
    } else {
      this.initialCameraPosition.set([0, CYLINDER_RADIUS_M * 0.4, 0]);
      this.initialTarget.set([CYLINDER_LENGTH_M * 0.3, 0, 0]);
      this.initialUpVector.set([0, 1, 0]);
    }
  }

  private getFixture(shape: ScatterLabShape): IShapeFixture {
    if (shape === 'plane') {
      const domain = new PlaneTerrainDomain(PLANE_PATCH_SIZE_M);
      const roots: { level: number; x: number; z: number }[] = [];
      for (let z = -PLANE_GRID_RADIUS; z <= PLANE_GRID_RADIUS; z++) {
        for (let x = -PLANE_GRID_RADIUS; x <= PLANE_GRID_RADIUS; x++) {
          roots.push({ level: 0, x, z });
        }
      }
      return {
        domain: domain as never,
        field: new PlaneScatterField(),
        roots,
        getCellKey: (a) => {
          const v = a as { level: number; x: number; z: number };
          return `plane:${v.level}:${v.x}:${v.z}`;
        },
        getLevel: (a) => (a as { level: number }).level,
        focusWorldM: [0, 0, 0],
        focusUpM: [0, 1, 0],
      };
    }
    if (shape === 'sphere') {
      const domain = new SphereTerrainDomain(SPHERE_RADIUS_M);
      const roots = SPHERE_TERRAIN_FACES.map((face) => ({
        face,
        level: 0,
        x: 0,
        y: 0,
      }));
      return {
        domain: domain as never,
        field: new SphereScatterField(SPHERE_RADIUS_M),
        roots,
        getCellKey: (a) => {
          const v = a as { face: string; level: number; x: number; y: number };
          return `sphere:${v.face}:${v.level}:${v.x}:${v.y}`;
        },
        getLevel: (a) => (a as { level: number }).level,
        /** Nearest point on the sphere's surface to the initial camera, which sits straight out along +z. */
        focusWorldM: [0, 0, SPHERE_RADIUS_M],
        focusUpM: [0, 0, 1],
      };
    }
    const domain = new CylinderTerrainDomain({
      radiusM: CYLINDER_RADIUS_M,
      lengthM: CYLINDER_LENGTH_M,
      levelZeroAngularPatchCount: CYLINDER_ANGULAR_PATCHES,
      levelZeroAxialPatchCount: CYLINDER_AXIAL_PATCHES,
    });
    const counts = domain.getPatchCounts(0);
    const roots = Array.from({ length: counts.axial }, (_, axialIndex) =>
      Array.from({ length: counts.angular }, (_unused, angularIndex) => ({
        level: 0,
        angularIndex,
        axialIndex,
      })),
    ).flat();
    return {
      domain: domain as never,
      field: new CylinderScatterField(CYLINDER_RADIUS_M),
      roots,
      getCellKey: (a) => {
        const v = a as { level: number; angularIndex: number; axialIndex: number };
        return `cylinder:${v.level}:${v.angularIndex}:${v.axialIndex}`;
      },
      getLevel: (a) => (a as { level: number }).level,
      /** Interior-wall point in the direction the initial camera is offset from the axis. */
      focusWorldM: [0, CYLINDER_RADIUS_M, 0],
      /** Interior of the cylinder is open toward the axis, not outward through the wall. */
      focusUpM: [0, -1, 0],
    };
  }

  private rebuild(): void {
    this.disposeScene();
    const shape = this.shape();
    const fixture = this.getFixture(shape);
    const group = new Group();
    const allTreeInstances: ITerrainScatterInstance[] = [];
    const allGrassInstances: ITerrainScatterInstance[] = [];
    /**
     * LOD/fade distance is measured from a point ON the terrain, not the
     * orbit camera itself — the camera is airborne well above/outside the
     * surface to frame the whole shape, so distance-from-camera never
     * intersects the ground at a sane radius. Thresholds still scale off
     * camera-to-target distance as a proxy for "how zoomed out is this
     * shape's preview," just anchored at a grounded focus point instead.
     */
    const viewpointWorldM = fixture.focusWorldM;
    const cameraWorldM = this.initialCameraPosition();
    const targetWorldM = this.initialTarget();
    const sceneScaleM = Math.hypot(
      cameraWorldM[0] - targetWorldM[0],
      cameraWorldM[1] - targetWorldM[1],
      cameraWorldM[2] - targetWorldM[2],
    );
    const treeLodTiers: readonly ScatterLodDefinition[] = [
      { kind: 'mesh', maxDistanceM: sceneScaleM * TREE_LOD_NEAR_RATIO, castShadow: true },
      { kind: 'mesh', maxDistanceM: sceneScaleM * TREE_LOD_FAR_RATIO, castShadow: false },
    ];
    const grassFadeStartM = sceneScaleM * GRASS_FADE_START_RATIO;
    const grassFadeEndM = sceneScaleM * GRASS_FADE_END_RATIO;
    group.add(
      this.buildDistanceDebugHelpers(
        viewpointWorldM,
        fixture.focusUpM,
        grassFadeStartM,
        grassFadeEndM,
      ),
    );
    let cellCount = 0;

    for (const address of fixture.roots) {
      const patch = generateTerrainPatchMesh(fixture.field, fixture.domain as never, {
        address: address as never,
        resolution: TERRAIN_RESOLUTION,
      }) as ITerrainPatchMesh<unknown>;
      group.add(this.buildTerrainMesh(patch));

      const cellAddresses = selectFixedLevelScatterCells(fixture.domain as never, {
        roots: [address],
        anchorWorldM: [0, 0, 0],
        radiusM: SCATTER_SELECT_RADIUS_M,
        fixedLevel: fixture.getLevel(address) + SCATTER_FIXED_LEVEL_DEPTH,
        getLevel: fixture.getLevel,
      });
      cellCount += cellAddresses.length;

      for (const cellAddress of cellAddresses) {
        allTreeInstances.push(
          ...generateTerrainScatterInstances({
            field: fixture.field,
            domain: fixture.domain as never,
            cellAddress: cellAddress as never,
            cellKey: fixture.getCellKey(cellAddress),
            identity: {
              worldSeed: WORLD_SEED,
              layerId: TREE_LAYER_ID,
              speciesId: TREE_SPECIES_ID,
              generatorVersion: TREE_GENERATOR_VERSION,
            },
            candidatePoolSize: TREE_CANDIDATE_POOL_SIZE,
            rules: TREE_RULES,
            baseDensity01: this.density(),
          }),
        );

        allGrassInstances.push(
          ...generateTerrainScatterInstances({
            field: fixture.field,
            domain: fixture.domain as never,
            cellAddress: cellAddress as never,
            cellKey: fixture.getCellKey(cellAddress),
            identity: {
              worldSeed: WORLD_SEED,
              layerId: GRASS_LAYER_ID,
              speciesId: GRASS_SPECIES_ID,
              generatorVersion: GRASS_GENERATOR_VERSION,
            },
            candidatePoolSize: GRASS_CANDIDATE_POOL_SIZE,
            rules: GRASS_RULES,
            baseDensity01: this.density(),
            distanceFade: {
              viewpointWorldM,
              fadeStartM: grassFadeStartM,
              fadeEndM: grassFadeEndM,
            },
          }),
        );
      }
    }

    const treeLods = bucketScatterInstancesByLod({
      instances: allTreeInstances,
      lods: treeLodTiers,
      viewpointWorldM,
    });
    const treeMeshes = buildScatterInstancedMeshesByLod({
      buckets: treeLods.buckets,
      assetsByTier: (tierIndex) => ({
        geometry: tierIndex === 0 ? this.treeGeometryNear : this.treeGeometryFar,
        material: tierIndex === 0 ? this.treeMaterial : this.treeMaterialFar,
      }),
      rules: TREE_RULES,
      scale: TREE_SCALE,
      anchorWorldM: [0, 0, 0],
    });
    for (const { mesh } of treeMeshes) group.add(mesh);

    const grassMesh = buildScatterInstancedMesh({
      instances: allGrassInstances,
      geometry: this.grassGeometry,
      material: this.grassMaterial,
      rules: GRASS_RULES,
      scale: GRASS_SCALE,
      anchorWorldM: [0, 0, 0],
      castShadow: false,
    });
    group.add(grassMesh);

    this.engine.scene.add(group);
    this.group = group;
    this.treeCount.set(treeLods.buckets.reduce((sum, b) => sum + b.instances.length, 0));
    this.treeNearCount.set(treeLods.buckets.find((b) => b.tierIndex === 0)?.instances.length ?? 0);
    this.treeFarCount.set(treeLods.buckets.find((b) => b.tierIndex === 1)?.instances.length ?? 0);
    this.grassCount.set(allGrassInstances.length);
    this.cellCount.set(cellCount);
  }

  /**
   * Debug-only visualization of the (frozen) ground focus point LOD/distance-fade
   * math is measured from, and the grass fade start/end radii around it —
   * added because that point is otherwise invisible and easy to lose track
   * of once you've orbited away from the shape's initial camera framing.
   */
  private buildDistanceDebugHelpers(
    viewpointWorldM: TerrainVector3,
    focusUpM: TerrainVector3,
    grassFadeStartM: number,
    grassFadeEndM: number,
  ): Group {
    const helpers = new Group();
    const origin = new Vector3(viewpointWorldM[0], viewpointWorldM[1], viewpointWorldM[2]);
    const up = new Vector3(focusUpM[0], focusUpM[1], focusUpM[2]);

    const flagLengthM = Math.min(20, grassFadeStartM * 0.25);
    const marker = new ArrowHelper(up, origin, flagLengthM, 0xffee55);
    helpers.add(marker);

    const startSphere = new Mesh(
      new SphereGeometry(grassFadeStartM, 24, 16),
      new MeshBasicMaterial({ color: 0x66ffcc, wireframe: true, transparent: true, opacity: 0.35 }),
    );
    startSphere.position.copy(origin);
    helpers.add(startSphere);

    const endSphere = new Mesh(
      new SphereGeometry(grassFadeEndM, 24, 16),
      new MeshBasicMaterial({ color: 0xffdd33, wireframe: true, transparent: true, opacity: 0.2 }),
    );
    endSphere.position.copy(origin);
    helpers.add(endSphere);

    return helpers;
  }

  private buildTerrainMesh(patch: ITerrainPatchMesh<unknown>): Mesh {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(patch.surface.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(patch.surface.normals, 3));
    geometry.setAttribute('uv', new BufferAttribute(patch.surface.uvs, 2));
    geometry.setAttribute('color', new BufferAttribute(this.colorByHeight(patch), 3));
    geometry.setIndex(new BufferAttribute(patch.surface.indices, 1));
    const mesh = new Mesh(geometry, this.groundMaterial);
    mesh.position.set(
      patch.centerWorldM[0],
      patch.centerWorldM[1],
      patch.centerWorldM[2],
    );
    return mesh;
  }

  private colorByHeight(patch: ITerrainPatchMesh<unknown>): Float32Array {
    const low = new Color('#4c6b3a');
    const high = new Color('#8f8770');
    const colors = new Float32Array(patch.surface.positions.length);
    const color = new Color();
    for (let offset = 0; offset < colors.length; offset += 3) {
      const heightM = patch.surface.positions[offset + 1];
      const t = Math.max(0, Math.min(1, (heightM + 6) / 12));
      color.copy(low).lerp(high, t);
      colors[offset] = color.r;
      colors[offset + 1] = color.g;
      colors[offset + 2] = color.b;
    }
    return colors;
  }

  private disposeScene(): void {
    if (!this.group) return;
    const sharedGeometries: unknown[] = [this.treeGeometryNear, this.treeGeometryFar, this.grassGeometry];
    const sharedMaterials: unknown[] = [
      this.groundMaterial,
      this.treeMaterial,
      this.treeMaterialFar,
      this.grassMaterial,
    ];
    this.group.traverse((object) => {
      if (object instanceof Mesh) {
        // Species geometries/materials are shared across rebuilds — only per-patch resources are owned here.
        if (!sharedGeometries.includes(object.geometry)) object.geometry.dispose();
        if (!sharedMaterials.includes(object.material)) {
          (object.material as MeshStandardMaterial).dispose();
        }
      }
    });
    this.group.removeFromParent();
    this.group = undefined;
  }
}
