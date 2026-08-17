import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  type Vector3Tuple,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  GROUND_COVER_MEADOW_GRASS_ARCHETYPE,
  GROUND_COVER_MEADOW_GRASS_COLORS,
  buildGroundCoverClumpMesh,
  hashProceduralKey,
} from 'triangular-engine/procedural';
import {
  generateTerrainPatchMesh,
  PlaneTerrainDomain,
  type IPlaneTerrainPatchAddress,
  type ITerrainField,
  type ITerrainFieldSample,
  type ITerrainPatchMesh,
  type TerrainVector3,
} from 'triangular-engine/terrain';
import {
  buildScatterInstancedMesh,
  enableScatterWindSway,
  generateTerrainScatterInstances,
  selectFixedLevelScatterCells,
  type IScatterWindHandle,
  type ITerrainScatterInstance,
  type ScatterPlacementRules,
  type ScatterScaleRange,
  type ScatterWindDefinition,
} from 'triangular-engine/scatter';

const PLANE_PATCH_SIZE_M = 24;
const GRID_RADIUS = 1;
const TERRAIN_RESOLUTION = 12;
const SCATTER_SELECT_RADIUS_M = 1_000_000;
/**
 * Grass needs a much finer identity cell than trees so density reads as a
 * field rather than a scatter of dots — two levels deeper than a root patch
 * is 16 cells per root (quadtree), vs. flora-scatter-lab's one level (4).
 */
const SCATTER_FIXED_LEVEL_DEPTH = 2;
const WORLD_SEED = 4_211;

const GRASS_LAYER_ID = 'meadow-grass';
const GRASS_SPECIES_ID = GROUND_COVER_MEADOW_GRASS_ARCHETYPE.id;
const GRASS_GENERATOR_VERSION = 1;
/**
 * `baseDensity01` (below) clamps to [0,1] inside scatter's placement math, so
 * it can only ever thin this base pool, never grow past it — density values
 * above 1x scale the pool itself instead, see rebuildGrass().
 */
const GRASS_CANDIDATE_POOL_SIZE_BASE = 22;
const GRASS_DENSITY_MULTIPLIER_DEFAULT = 0.55;
const GRASS_DENSITY_MULTIPLIER_MAX = 5;
const GRASS_RULES: ScatterPlacementRules = {
  alignment: 'align-to-surface-up',
  slopeMax01: 0.85,
};
const GRASS_SCALE: ScatterScaleRange = { min: 0.75, max: 1.4 };
/** Lighter and quicker than flora's TREE_WIND (strength 0.05, frequency 0.9) — thin blades flutter faster than a canopy sways. */
const GRASS_WIND: ScatterWindDefinition = { strength: 0.06, frequency: 2.2 };

/** One clump mesh per seed, scatter buckets instances into whichever variant its instance ID hashes to — same "no per-instance mesh-variant primitive yet" workaround as flora-scatter-lab. */
const CLUMP_VARIANT_COUNT = 5;
const CLUMP_BASE_SEED = 1;

const GRASS_BASE_COLOR = new Color(GROUND_COVER_MEADOW_GRASS_COLORS.baseHex);
const GRASS_TIP_COLOR = new Color(GROUND_COVER_MEADOW_GRASS_COLORS.tipHex);

function gentleMeadowUndulationM(x: number, z: number): number {
  return Math.sin(x / 34) * 0.6 + Math.cos(z / 41) * 0.45;
}

class MeadowLabTerrainField implements ITerrainField {
  readonly minElevationM = -1.5;
  readonly maxElevationM = 1.5;

  sample([x, _y, z]: TerrainVector3): ITerrainFieldSample {
    return { elevationM: gentleMeadowUndulationM(x, z) };
  }

  sampleBatch(
    positions: Float64Array,
    out = new Float64Array(positions.length / 3),
  ): Float64Array {
    for (let i = 0; i < out.length; i++) {
      out[i] = gentleMeadowUndulationM(positions[i * 3], positions[i * 3 + 2]);
    }
    return out;
  }
}

interface IClumpVariant {
  readonly geometry: BufferGeometry;
}

interface IGrassScatterCell {
  readonly address: IPlaneTerrainPatchAddress;
  readonly cellKey: string;
}

/**
 * Slice 2 of the grass work: clumps now sway in a uniform wind
 * (`enableScatterWindSway`, same primitive flora-scatter-lab uses for trees)
 * on top of slice 1's geometry + density on scatter's existing pipeline.
 * Regional/gust wind variation is not here yet — every blade shares one
 * phase-desynced sway. See the flora-scatter-lab pattern this mirrors (one
 * InstancedMesh per seeded variant, bucketed by an instance-ID hash) — trees
 * registered a branching flora species the same way this registers a
 * non-branching ground-cover one.
 */
@Component({
  selector: 'app-meadow-lab-page',
  imports: [RouterLink, EngineModule, DecimalPipe],
  templateUrl: './meadow-lab-page.component.html',
  styleUrl: './meadow-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class MeadowLabPageComponent {
  readonly grassInstanceCount = signal(0);
  readonly cellCount = signal(0);
  readonly variantCount = CLUMP_VARIANT_COUNT;
  readonly density = signal(GRASS_DENSITY_MULTIPLIER_DEFAULT);

  readonly initialCameraPosition = signal<Vector3Tuple>([0, 4, 12]);
  readonly initialTarget = signal<Vector3Tuple>([0, 0.3, 0]);

  private readonly engine = inject(EngineService);

  private readonly domain = new PlaneTerrainDomain(PLANE_PATCH_SIZE_M);
  private readonly field = new MeadowLabTerrainField();
  private readonly groundMaterial = new MeshStandardMaterial({
    color: '#5a6b3c',
    roughness: 0.95,
  });
  private readonly grassMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
  });

  private readonly variants: IClumpVariant[] = this.buildVariants();
  private readonly groundMeshes: Mesh[] = [];
  private readonly grassMeshes: InstancedMesh[] = [];
  private readonly cells: IGrassScatterCell[] = [];
  private readonly windHandle: IScatterWindHandle;

  constructor() {
    const destroyRef = inject(DestroyRef);
    const previousBackground = this.engine.scene.background;
    this.engine.scene.background = new Color('#bcd8ea');

    this.windHandle = enableScatterWindSway(this.grassMaterial, GRASS_WIND);

    this.buildTerrain();
    this.rebuildGrass(this.density());

    this.engine.elapsedTime$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((elapsedTimeS) => this.windHandle.setTimeS(elapsedTimeS));

    destroyRef.onDestroy(() => {
      for (const mesh of this.groundMeshes) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
      }
      for (const mesh of this.grassMeshes) {
        mesh.removeFromParent();
      }
      for (const variant of this.variants) variant.geometry.dispose();
      this.groundMaterial.dispose();
      this.grassMaterial.dispose();
      this.engine.scene.background = previousBackground;
    });
  }

  setDensity(value: number | string): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.max(0.05, Math.min(GRASS_DENSITY_MULTIPLIER_MAX, parsed));
    this.density.set(clamped);
    this.rebuildGrass(clamped);
  }

  private buildVariants(): IClumpVariant[] {
    const variants: IClumpVariant[] = [];
    for (let i = 0; i < CLUMP_VARIANT_COUNT; i++) {
      const seed = CLUMP_BASE_SEED + i;
      const { geometry } = buildGroundCoverClumpMesh(GROUND_COVER_MEADOW_GRASS_ARCHETYPE, seed);
      this.colorizeByHeight(geometry);
      variants.push({ geometry });
    }
    return variants;
  }

  private colorizeByHeight(geometry: BufferGeometry): void {
    const height01 = geometry.getAttribute('height01');
    const colors = new Float32Array(height01.count * 3);
    const blended = new Color();
    for (let i = 0; i < height01.count; i++) {
      blended.copy(GRASS_BASE_COLOR).lerp(GRASS_TIP_COLOR, height01.getX(i));
      colors[i * 3] = blended.r;
      colors[i * 3 + 1] = blended.g;
      colors[i * 3 + 2] = blended.b;
    }
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  }

  private variantIndexForInstance(instanceId: string): number {
    return hashProceduralKey(instanceId) % CLUMP_VARIANT_COUNT;
  }

  private buildTerrain(): void {
    const roots: IPlaneTerrainPatchAddress[] = [];
    for (let z = -GRID_RADIUS; z <= GRID_RADIUS; z++) {
      for (let x = -GRID_RADIUS; x <= GRID_RADIUS; x++) {
        roots.push({ level: 0, x, z });
      }
    }

    let cellCount = 0;

    for (const address of roots) {
      const patch = generateTerrainPatchMesh(this.field, this.domain, {
        address,
        resolution: TERRAIN_RESOLUTION,
      });
      const groundMesh = this.buildGroundMesh(patch);
      this.groundMeshes.push(groundMesh);
      this.engine.scene.add(groundMesh);

      const cellAddresses = selectFixedLevelScatterCells(this.domain, {
        roots: [address],
        anchorWorldM: [0, 0, 0],
        radiusM: SCATTER_SELECT_RADIUS_M,
        fixedLevel: address.level + SCATTER_FIXED_LEVEL_DEPTH,
        getLevel: (a) => a.level,
      });
      cellCount += cellAddresses.length;

      for (const cellAddress of cellAddresses) {
        this.cells.push({
          address: cellAddress,
          cellKey: `plane:${cellAddress.level}:${cellAddress.x}:${cellAddress.z}`,
        });
      }
    }

    this.cellCount.set(cellCount);
  }

  /**
   * Re-runs placement + instancing only — terrain and cell addresses (built
   * once in buildTerrain) stay fixed as density changes. `densityMultiplier`
   * above 1x grows the candidate pool itself (baseDensity01 pins at 1, fully
   * accepting it) since baseDensity01 alone can only thin the base pool, not
   * exceed it.
   */
  private rebuildGrass(densityMultiplier: number): void {
    for (const mesh of this.grassMeshes) mesh.removeFromParent();
    this.grassMeshes.length = 0;

    const candidatePoolSize = Math.max(
      1,
      Math.round(GRASS_CANDIDATE_POOL_SIZE_BASE * Math.max(1, densityMultiplier)),
    );
    const baseDensity01 = Math.min(1, densityMultiplier);

    const instancesByVariant: ITerrainScatterInstance[][] = Array.from(
      { length: CLUMP_VARIANT_COUNT },
      () => [],
    );
    let grassInstanceCount = 0;

    for (const cell of this.cells) {
      const instances = generateTerrainScatterInstances({
        field: this.field,
        domain: this.domain,
        cellAddress: cell.address,
        cellKey: cell.cellKey,
        identity: {
          worldSeed: WORLD_SEED,
          layerId: GRASS_LAYER_ID,
          speciesId: GRASS_SPECIES_ID,
          generatorVersion: GRASS_GENERATOR_VERSION,
        },
        candidatePoolSize,
        rules: GRASS_RULES,
        baseDensity01,
      });

      for (const instance of instances) {
        const variantIndex = this.variantIndexForInstance(instance.instanceId);
        instancesByVariant[variantIndex].push(instance);
        grassInstanceCount++;
      }
    }

    for (let i = 0; i < CLUMP_VARIANT_COUNT; i++) {
      const instances = instancesByVariant[i];
      if (instances.length === 0) continue;
      const mesh = buildScatterInstancedMesh({
        instances,
        geometry: this.variants[i].geometry,
        material: this.grassMaterial,
        rules: GRASS_RULES,
        scale: GRASS_SCALE,
        anchorWorldM: [0, 0, 0],
        castShadow: false,
      });
      this.engine.scene.add(mesh);
      this.grassMeshes.push(mesh);
    }

    this.grassInstanceCount.set(grassInstanceCount);
  }

  private buildGroundMesh(patch: ITerrainPatchMesh<IPlaneTerrainPatchAddress>): Mesh {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(patch.surface.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(patch.surface.normals, 3));
    geometry.setIndex(new BufferAttribute(patch.surface.indices, 1));
    const mesh = new Mesh(geometry, this.groundMaterial);
    mesh.receiveShadow = true;
    mesh.position.set(patch.centerWorldM[0], patch.centerWorldM[1], patch.centerWorldM[2]);
    return mesh;
  }
}
