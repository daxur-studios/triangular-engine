import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  GridHelper,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  CylinderTerrainDomain,
  generateTerrainPatchMesh,
  getPlaneTerrainPatchKey,
  type ITerrainField,
  type ITerrainFieldSample,
  type ITerrainPatchMesh,
  type IPlaneTerrainPatchAddress,
  PlaneTerrainDomain,
  selectPlaneTerrainPatches,
  SPHERE_TERRAIN_FACES,
  SphereTerrainDomain,
  type TerrainVector3,
} from 'triangular-engine/terrain';

const PATCH_SIZE_M = 512;
const PATCH_RESOLUTION = 32;
const PATCH_RADIUS = 2;
const LARGE_COORDINATE_M = 1_000_000_000;
const ORIENTATION_GRID_SIZE_M = 20_000;
const ORIENTATION_GRID_DIVISIONS = 100;
const ORIENTATION_GRID_Y_M = -100;
const SPHERE_RADIUS_M = 650;
const SPHERE_PATCH_LEVEL = 1;
const CYLINDER_RADIUS_M = 1_500;
const CYLINDER_LENGTH_M = 4_000;
const CYLINDER_ANGULAR_PATCHES = 12;
const CYLINDER_AXIAL_PATCHES = 4;

type TerrainShape = 'plane' | 'sphere' | 'cylinder';

interface ITerrainPatchVisual {
  readonly mesh: Mesh;
  readonly border: LineSegments;
  readonly material: MeshStandardMaterial;
  readonly borderMaterial: LineBasicMaterial;
}

class TerrainLabField implements ITerrainField {
  readonly minElevationM = -22;
  readonly maxElevationM = 22;

  sample([x, _y, z]: TerrainVector3): ITerrainFieldSample {
    return {
      elevationM:
        Math.sin(x / 95) * 12 +
        Math.cos(z / 135) * 7 +
        Math.sin((x + z) / 43) * 3,
    };
  }

  sampleBatch(
    positions: Float64Array,
    output = new Float64Array(positions.length / 3),
  ): Float64Array {
    for (let i = 0; i < output.length; i++) {
      output[i] = this.sample([
        positions[i * 3],
        positions[i * 3 + 1],
        positions[i * 3 + 2],
      ]).elevationM;
    }
    return output;
  }
}

class SphereTerrainLabField implements ITerrainField {
  readonly minElevationM = -45;
  readonly maxElevationM = 45;

  sample([x, y, z]: TerrainVector3): ITerrainFieldSample {
    return {
      elevationM:
        Math.sin(x * 8 + z * 3) * 20 +
        Math.cos(y * 11 - x * 2) * 13 +
        Math.sin((x + y + z) * 17) * 6,
    };
  }

  sampleBatch(
    positions: Float64Array,
    output = new Float64Array(positions.length / 3),
  ): Float64Array {
    for (let i = 0; i < output.length; i++) {
      output[i] = this.sample([
        positions[i * 3],
        positions[i * 3 + 1],
        positions[i * 3 + 2],
      ]).elevationM;
    }
    return output;
  }
}

class CylinderTerrainLabField implements ITerrainField {
  readonly minElevationM = -55;
  readonly maxElevationM = 55;

  sample([axialM, radialY, radialZ]: TerrainVector3): ITerrainFieldSample {
    const angle = Math.atan2(radialZ, radialY);
    return {
      elevationM:
        Math.sin(axialM / 170 + angle * 3) * 24 +
        Math.cos(axialM / 390 - angle * 7) * 17 +
        Math.sin(axialM / 83 + angle * 11) * 8,
    };
  }

  sampleBatch(
    positions: Float64Array,
    output = new Float64Array(positions.length / 3),
  ): Float64Array {
    for (let i = 0; i < output.length; i++) {
      output[i] = this.sample([
        positions[i * 3],
        positions[i * 3 + 1],
        positions[i * 3 + 2],
      ]).elevationM;
    }
    return output;
  }
}

/** Visual Phase 1 fixture for absolute-coordinate, patch-local plane terrain. */
@Component({
  selector: 'app-terrain-lab-page',
  imports: [RouterLink, EngineModule],
  templateUrl: './terrain-lab-page.component.html',
  styleUrl: './terrain-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class TerrainLabPageComponent {
  readonly shape = signal<TerrainShape>('plane');
  readonly largeCoordinates = signal(false);
  readonly patchBorders = signal(true);
  readonly wireframe = signal(false);
  readonly patchCount = signal(0);
  readonly coordinateLabel = signal('0 m');
  readonly centrePatchLabel = signal('0, 0');

  private readonly engine = inject(EngineService);
  private readonly domain = new PlaneTerrainDomain(PATCH_SIZE_M);
  private readonly field = new TerrainLabField();
  private readonly sphereDomain = new SphereTerrainDomain(SPHERE_RADIUS_M);
  private readonly sphereField = new SphereTerrainLabField();
  private readonly cylinderDomain = new CylinderTerrainDomain({
    radiusM: CYLINDER_RADIUS_M,
    lengthM: CYLINDER_LENGTH_M,
    levelZeroAngularPatchCount: CYLINDER_ANGULAR_PATCHES,
    levelZeroAxialPatchCount: CYLINDER_AXIAL_PATCHES,
  });
  private readonly cylinderField = new CylinderTerrainLabField();
  private readonly terrain = new Group();
  private readonly orientationGrid = new GridHelper(
    ORIENTATION_GRID_SIZE_M,
    ORIENTATION_GRID_DIVISIONS,
    '#46617a',
    '#263846',
  );
  private readonly patches = new Map<string, ITerrainPatchVisual>();
  private renderOriginX = 0;
  private renderOriginZ = 0;
  private selectionCentreKey = '';

  constructor() {
    const destroyRef = inject(DestroyRef);
    const previousBackground = this.engine.scene.background;
    this.engine.scene.background = new Color('#071018');
    this.orientationGrid.position.y = ORIENTATION_GRID_Y_M;
    this.engine.scene.add(this.orientationGrid, this.terrain);
    this.rebuild();
    this.engine.tick$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe(() => this.updateCameraSelection());
    destroyRef.onDestroy(() => {
      this.disposeTerrain();
      this.terrain.removeFromParent();
      this.orientationGrid.removeFromParent();
      this.orientationGrid.geometry.dispose();
      if (Array.isArray(this.orientationGrid.material)) {
        for (const material of this.orientationGrid.material)
          material.dispose();
      } else {
        this.orientationGrid.material.dispose();
      }
      this.engine.scene.background = previousBackground;
    });
  }

  toggleLargeCoordinates(): void {
    if (this.shape() !== 'plane') return;
    this.largeCoordinates.update((enabled) => !enabled);
    this.rebuild();
  }

  selectShape(shape: TerrainShape): void {
    if (shape === this.shape()) return;
    this.shape.set(shape);
    this.orientationGrid.visible = shape === 'plane';
    this.rebuild();
  }

  toggleWireframe(): void {
    this.wireframe.update((enabled) => !enabled);
    for (const patch of this.patches.values())
      patch.material.wireframe = this.wireframe();
  }

  togglePatchBorders(): void {
    this.patchBorders.update((enabled) => !enabled);
    for (const patch of this.patches.values())
      patch.borderMaterial.visible = this.patchBorders();
  }

  private rebuild(): void {
    this.disposeTerrain();
    if (this.shape() === 'sphere') {
      this.selectionCentreKey = '';
      this.coordinateLabel.set('Body centre');
      this.centrePatchLabel.set('all six faces');
      this.buildSphere();
      return;
    }
    if (this.shape() === 'cylinder') {
      this.selectionCentreKey = '';
      this.coordinateLabel.set('Body centre');
      this.centrePatchLabel.set('complete inner wall');
      this.buildCylinder();
      return;
    }
    const centreTile = this.largeCoordinates()
      ? Math.floor(LARGE_COORDINATE_M / PATCH_SIZE_M)
      : 0;
    this.renderOriginX = centreTile * PATCH_SIZE_M;
    this.renderOriginZ = -centreTile * PATCH_SIZE_M;
    this.selectionCentreKey = '';
    this.coordinateLabel.set(
      this.largeCoordinates()
        ? `${this.renderOriginX.toLocaleString()} m`
        : '0 m',
    );
    this.updateCameraSelection();
  }

  private updateCameraSelection(): void {
    if (this.shape() !== 'plane') return;
    const camera = this.engine.camera;
    const worldX = this.renderOriginX + camera.position.x;
    const worldZ = this.renderOriginZ + camera.position.z;
    const centre = selectPlaneTerrainPatches(this.domain, worldX, worldZ, 0)[0];
    const centreKey = getPlaneTerrainPatchKey(centre);
    if (centreKey === this.selectionCentreKey) return;
    this.selectionCentreKey = centreKey;
    this.centrePatchLabel.set(`${centre.x}, ${centre.z}`);

    const selected = selectPlaneTerrainPatches(
      this.domain,
      worldX,
      worldZ,
      PATCH_RADIUS,
    );
    const selectedKeys = new Set(selected.map(getPlaneTerrainPatchKey));

    for (const [key, patch] of this.patches) {
      if (!selectedKeys.has(key)) this.removePatch(key, patch);
    }
    for (const address of selected) {
      const key = getPlaneTerrainPatchKey(address);
      if (!this.patches.has(key)) this.addPlanePatch(key, address);
    }
    this.patchCount.set(this.patches.size);
  }

  private addPlanePatch(key: string, address: IPlaneTerrainPatchAddress): void {
    const patch = generateTerrainPatchMesh(this.field, this.domain, {
      address,
      resolution: PATCH_RESOLUTION,
    });
    this.installPatch(
      key,
      patch,
      (address.x + address.z) % 2 === 0 ? '#5d9b55' : '#6aa65d',
      this.renderOriginX,
      this.renderOriginZ,
    );
  }

  private buildSphere(): void {
    const tilesPerAxis = 2 ** SPHERE_PATCH_LEVEL;
    for (const [faceIndex, face] of SPHERE_TERRAIN_FACES.entries()) {
      for (let y = 0; y < tilesPerAxis; y++) {
        for (let x = 0; x < tilesPerAxis; x++) {
          const address = { face, level: SPHERE_PATCH_LEVEL, x, y };
          const key = `${face}:${SPHERE_PATCH_LEVEL}:${x}:${y}`;
          const patch = generateTerrainPatchMesh(
            this.sphereField,
            this.sphereDomain,
            { address, resolution: PATCH_RESOLUTION },
          );
          const lightness = (faceIndex + x + y) % 2 === 0;
          this.installPatch(
            key,
            patch,
            lightness ? '#608f53' : '#527c49',
            0,
            0,
          );
        }
      }
    }
    this.patchCount.set(this.patches.size);
  }

  private buildCylinder(): void {
    const counts = this.cylinderDomain.getPatchCounts(0);
    for (let axialIndex = 0; axialIndex < counts.axial; axialIndex++) {
      for (
        let angularIndex = 0;
        angularIndex < counts.angular;
        angularIndex++
      ) {
        const address = { level: 0, angularIndex, axialIndex };
        const key = `cylinder:0:${angularIndex}:${axialIndex}`;
        const patch = generateTerrainPatchMesh(
          this.cylinderField,
          this.cylinderDomain,
          { address, resolution: PATCH_RESOLUTION },
        );
        this.installPatch(
          key,
          patch,
          (angularIndex + axialIndex) % 2 === 0 ? '#688d4f' : '#587943',
          0,
          0,
        );
      }
    }
    this.patchCount.set(this.patches.size);
  }

  private installPatch(
    key: string,
    patch: ITerrainPatchMesh<unknown>,
    color: string,
    renderOriginX: number,
    renderOriginZ: number,
  ): void {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(patch.surface.positions, 3),
    );
    geometry.setAttribute(
      'normal',
      new BufferAttribute(patch.surface.normals, 3),
    );
    geometry.setAttribute('uv', new BufferAttribute(patch.surface.uvs, 2));
    geometry.setIndex(new BufferAttribute(patch.surface.indices, 1));
    const material = new MeshStandardMaterial({
      color,
      roughness: 0.92,
      wireframe: this.wireframe(),
    });
    const mesh = new Mesh(geometry, material);
    const borderMaterial = new LineBasicMaterial({
      color: '#d7f08a',
      depthTest: false,
      transparent: true,
      opacity: 0.9,
      visible: this.patchBorders(),
    });
    const border = new LineSegments(
      this.createPatchBorderGeometry(
        patch.surface.positions,
        patch.surface.normals,
      ),
      borderMaterial,
    );
    border.renderOrder = 1;
    // Terrain owns f64 absolute coordinates; rendering uses a small local frame.
    const renderX = patch.centerWorldM[0] - renderOriginX;
    const renderY = patch.centerWorldM[1];
    const renderZ = patch.centerWorldM[2] - renderOriginZ;
    mesh.position.set(renderX, renderY, renderZ);
    border.position.set(renderX, renderY, renderZ);
    this.terrain.add(mesh, border);
    this.patches.set(key, { mesh, border, material, borderMaterial });
  }

  private removePatch(key: string, patch: ITerrainPatchVisual): void {
    patch.mesh.removeFromParent();
    patch.border.removeFromParent();
    patch.mesh.geometry.dispose();
    patch.border.geometry.dispose();
    patch.material.dispose();
    patch.borderMaterial.dispose();
    this.patches.delete(key);
  }

  private createPatchBorderGeometry(
    positions: Float32Array,
    normals: Float32Array,
  ): BufferGeometry {
    const rowLength = PATCH_RESOLUTION + 1;
    const segmentCount = PATCH_RESOLUTION * 4;
    const borderPositions = new Float32Array(segmentCount * 2 * 3);
    let outputOffset = 0;

    const appendVertex = (vertexIndex: number): void => {
      const inputOffset = vertexIndex * 3;
      borderPositions[outputOffset++] =
        positions[inputOffset] + normals[inputOffset] * 0.15;
      borderPositions[outputOffset++] =
        positions[inputOffset + 1] + normals[inputOffset + 1] * 0.15;
      borderPositions[outputOffset++] =
        positions[inputOffset + 2] + normals[inputOffset + 2] * 0.15;
    };
    const appendSegment = (start: number, end: number): void => {
      appendVertex(start);
      appendVertex(end);
    };

    for (let index = 0; index < PATCH_RESOLUTION; index++) {
      appendSegment(index, index + 1);
      appendSegment(
        PATCH_RESOLUTION * rowLength + index,
        PATCH_RESOLUTION * rowLength + index + 1,
      );
      appendSegment(index * rowLength, (index + 1) * rowLength);
      appendSegment(
        index * rowLength + PATCH_RESOLUTION,
        (index + 1) * rowLength + PATCH_RESOLUTION,
      );
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(borderPositions, 3));
    return geometry;
  }

  private disposeTerrain(): void {
    for (const [key, patch] of [...this.patches]) this.removePatch(key, patch);
    this.patchCount.set(0);
  }
}
