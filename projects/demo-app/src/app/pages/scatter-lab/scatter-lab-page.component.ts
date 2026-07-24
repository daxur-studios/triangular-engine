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
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
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
  buildScatterInstancedMesh,
  generateTerrainScatterInstances,
  selectFixedLevelScatterCells,
  type ITerrainScatterInstance,
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
  readonly cellCount = signal(0);

  readonly initialCameraPosition = signal<Vector3Tuple>([170, 130, 170]);
  readonly initialTarget = signal<Vector3Tuple>([0, 0, 0]);
  readonly initialUpVector = signal<Vector3Tuple>([0, 1, 0]);

  private readonly engine = inject(EngineService);
  private readonly treeGeometry = new ConeGeometry(0.9, 3.2, 6);
  private readonly treeMaterial = new MeshStandardMaterial({
    color: '#3f8f4c',
    roughness: 0.85,
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
      this.treeGeometry.dispose();
      this.treeMaterial.dispose();
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
    };
  }

  private rebuild(): void {
    this.disposeScene();
    const shape = this.shape();
    const fixture = this.getFixture(shape);
    const group = new Group();
    const allInstances: ITerrainScatterInstance[] = [];
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
        const instances = generateTerrainScatterInstances({
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
        });
        allInstances.push(...instances);
      }
    }

    const treeMesh = buildScatterInstancedMesh({
      instances: allInstances,
      geometry: this.treeGeometry,
      material: this.treeMaterial,
      rules: TREE_RULES,
      scale: TREE_SCALE,
      anchorWorldM: [0, 0, 0],
      castShadow: false,
    });
    group.add(treeMesh);

    this.engine.scene.add(group);
    this.group = group;
    this.treeCount.set(allInstances.length);
    this.cellCount.set(cellCount);
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
    this.group.traverse((object) => {
      if (object instanceof Mesh) {
        // treeGeometry/treeMaterial/groundMaterial are shared across rebuilds — only per-patch resources are owned here.
        if (object.geometry !== this.treeGeometry) object.geometry.dispose();
        if (object.material !== this.groundMaterial && object.material !== this.treeMaterial) {
          (object.material as MeshStandardMaterial).dispose();
        }
      }
    });
    this.group.removeFromParent();
    this.group = undefined;
  }
}
