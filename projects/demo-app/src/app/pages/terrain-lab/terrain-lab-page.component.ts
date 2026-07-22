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
  selectAdaptiveTerrainPatches,
  selectPlaneTerrainPatches,
  SPHERE_TERRAIN_FACES,
  SphereTerrainDomain,
  type TerrainVector3,
} from 'triangular-engine/terrain';

const PATCH_SIZE_M = 512;
const PATCH_RESOLUTION = 24;
const PATCH_RADIUS = 2;
const MAX_STREAMING_RADIUS = 4;
const MAX_LOD_LEVEL = 3;
const LOD_SKIRT_DEPTH_M = 35;
const LARGE_COORDINATE_M = 1_000_000_000;
const ORIENTATION_GRID_SIZE_M = 20_000;
const ORIENTATION_GRID_DIVISIONS = 100;
const ORIENTATION_GRID_Y_M = -100;
const SPHERE_RADIUS_M = 650;
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
  readonly minElevationM = -90;
  readonly maxElevationM = 190;

  sample([x, _y, z]: TerrainVector3): ITerrainFieldSample {
    return {
      elevationM: biomeElevation(x, z),
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
  readonly minElevationM = -90;
  readonly maxElevationM = 190;

  constructor(private readonly radiusM: number) {}

  sample([x, y, z]: TerrainVector3): ITerrainFieldSample {
    return {
      elevationM: biomeElevation(x * this.radiusM, z * this.radiusM, y * 3),
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
  readonly minElevationM = -90;
  readonly maxElevationM = 190;

  constructor(private readonly radiusM: number) {}

  sample([axialM, radialY, radialZ]: TerrainVector3): ITerrainFieldSample {
    const angle = Math.atan2(radialZ, radialY);
    return {
      elevationM: biomeElevation(
        axialM,
        angle * this.radiusM,
        Math.sin(angle * 2),
      ),
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

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Broad deterministic regions: low ocean basins, calm meadow, and ridged mountains. */
function biomeElevation(x: number, z: number, offset = 0): number {
  const continental =
    Math.sin(x / 780 + offset) * 0.65 + Math.cos(z / 920 - offset) * 0.55;
  const mountainMask = smoothstep(0.35, 0.85, continental);
  const oceanMask = smoothstep(0.3, 0.8, -continental);
  const meadow = Math.sin(x / 145) * 3 + Math.cos(z / 180) * 2;
  const ridges =
    35 +
    Math.abs(Math.sin(x / 105 + z / 170)) * 105 +
    Math.abs(Math.cos(z / 73 - x / 210)) * 35;
  const oceanFloor = -72 + Math.sin(x / 310 + z / 270) * 5;
  return (
    meadow * (1 - mountainMask) * (1 - oceanMask) +
    ridges * mountainMask +
    oceanFloor * oceanMask
  );
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
  readonly streamingRadius = signal(1);
  readonly sphereSizeScale = signal(1);
  readonly cylinderSizeScale = signal(1);
  readonly patchCount = signal(0);
  readonly coordinateLabel = signal('0 m');
  readonly centrePatchLabel = signal('0, 0');
  readonly lodLabel = signal('L0: 0');

  private readonly engine = inject(EngineService);
  private readonly domain = new PlaneTerrainDomain(PATCH_SIZE_M);
  private readonly field = new TerrainLabField();
  private sphereDomain = new SphereTerrainDomain(SPHERE_RADIUS_M);
  private sphereField = new SphereTerrainLabField(SPHERE_RADIUS_M);
  private cylinderDomain = new CylinderTerrainDomain({
    radiusM: CYLINDER_RADIUS_M,
    lengthM: CYLINDER_LENGTH_M,
    levelZeroAngularPatchCount: CYLINDER_ANGULAR_PATCHES,
    levelZeroAxialPatchCount: CYLINDER_AXIAL_PATCHES,
  });
  private cylinderField = new CylinderTerrainLabField(CYLINDER_RADIUS_M);
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
  private selectionSignature = '';

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

  setStreamingRadius(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.streamingRadius.set(
      Math.max(1, Math.min(MAX_STREAMING_RADIUS, Math.round(value))),
    );
    this.selectionSignature = '';
    this.updateCameraSelection();
  }

  bodySizeScale(): number {
    return this.shape() === 'sphere'
      ? this.sphereSizeScale()
      : this.cylinderSizeScale();
  }

  bodySizeLabel(): string {
    if (this.shape() === 'sphere') {
      return `${Math.round(SPHERE_RADIUS_M * this.sphereSizeScale()).toLocaleString()} m radius`;
    }
    if (this.shape() === 'cylinder') {
      return `${Math.round(CYLINDER_RADIUS_M * this.cylinderSizeScale()).toLocaleString()} m radius × ${Math.round(CYLINDER_LENGTH_M * this.cylinderSizeScale()).toLocaleString()} m long`;
    }
    return 'Unbounded';
  }

  setBodySizeScale(event: Event): void {
    if (this.shape() === 'plane') return;
    const nextScale = Math.max(
      0.5,
      Math.min(3, Number((event.target as HTMLInputElement).value)),
    );
    const previousScale = this.bodySizeScale();
    if (this.shape() === 'sphere') {
      this.sphereSizeScale.set(nextScale);
      const radiusM = SPHERE_RADIUS_M * nextScale;
      this.sphereDomain = new SphereTerrainDomain(radiusM);
      this.sphereField = new SphereTerrainLabField(radiusM);
    } else {
      this.cylinderSizeScale.set(nextScale);
      const radiusM = CYLINDER_RADIUS_M * nextScale;
      this.cylinderDomain = new CylinderTerrainDomain({
        radiusM,
        lengthM: CYLINDER_LENGTH_M * nextScale,
        levelZeroAngularPatchCount: CYLINDER_ANGULAR_PATCHES,
        levelZeroAxialPatchCount: CYLINDER_AXIAL_PATCHES,
      });
      this.cylinderField = new CylinderTerrainLabField(radiusM);
    }
    this.engine.camera.position.multiplyScalar(nextScale / previousScale);
    this.rebuild();
  }

  private rebuild(): void {
    this.disposeTerrain();
    if (this.shape() === 'sphere') {
      this.selectionSignature = '';
      this.coordinateLabel.set('Body centre');
      this.centrePatchLabel.set('all six faces');
      this.updateCameraSelection();
      return;
    }
    if (this.shape() === 'cylinder') {
      this.selectionSignature = '';
      this.coordinateLabel.set('Body centre');
      this.centrePatchLabel.set('complete inner wall');
      this.updateCameraSelection();
      return;
    }
    const centreTile = this.largeCoordinates()
      ? Math.floor(LARGE_COORDINATE_M / PATCH_SIZE_M)
      : 0;
    this.renderOriginX = centreTile * PATCH_SIZE_M;
    this.renderOriginZ = -centreTile * PATCH_SIZE_M;
    this.selectionSignature = '';
    this.coordinateLabel.set(
      this.largeCoordinates()
        ? `${this.renderOriginX.toLocaleString()} m`
        : '0 m',
    );
    this.updateCameraSelection();
  }

  private updateCameraSelection(): void {
    const camera = this.engine.camera;
    const worldX = this.renderOriginX + camera.position.x;
    const worldZ = this.renderOriginZ + camera.position.z;
    const shape = this.shape();
    const selected =
      shape === 'plane'
        ? this.selectPlaneLod(worldX, worldZ)
        : shape === 'sphere'
          ? this.selectSphereLod()
          : this.selectCylinderLod();
    const entries = selected.map((address) => ({
      address,
      key: this.getPatchKey(shape, address),
    }));
    const signature = entries.map(({ key }) => key).join('|');
    if (signature === this.selectionSignature) return;
    this.selectionSignature = signature;
    const selectedKeys = new Set(entries.map(({ key }) => key));

    for (const [key, patch] of this.patches) {
      if (!selectedKeys.has(key)) this.removePatch(key, patch);
    }
    for (const { address, key } of entries) {
      if (!this.patches.has(key)) this.addSelectedPatch(shape, key, address);
    }
    this.patchCount.set(this.patches.size);
    this.updateLodLabel(
      entries.map(({ address }) => (address as { level: number }).level),
    );
  }

  private selectPlaneLod(
    worldX: number,
    worldZ: number,
  ): readonly IPlaneTerrainPatchAddress[] {
    const centre = selectPlaneTerrainPatches(this.domain, worldX, worldZ, 0)[0];
    this.centrePatchLabel.set(`${centre.x}, ${centre.z}`);
    const roots = selectPlaneTerrainPatches(
      this.domain,
      worldX,
      worldZ,
      PATCH_RADIUS * this.streamingRadius(),
    );
    return selectAdaptiveTerrainPatches(this.domain, {
      roots,
      cameraWorldM: [worldX, this.engine.camera.position.y, worldZ],
      getLevel: (address) => address.level,
      maxLevel: MAX_LOD_LEVEL,
      refinementDistanceM: 1_150 * this.streamingRadius(),
    });
  }

  private selectSphereLod() {
    const roots = SPHERE_TERRAIN_FACES.map((face) => ({
      face,
      level: 0,
      x: 0,
      y: 0,
    }));
    return selectAdaptiveTerrainPatches(this.sphereDomain, {
      roots,
      cameraWorldM: [
        this.engine.camera.position.x,
        this.engine.camera.position.y,
        this.engine.camera.position.z,
      ],
      getLevel: (address) => address.level,
      maxLevel: MAX_LOD_LEVEL,
      refinementDistanceM:
        1_600 * this.streamingRadius() * this.sphereSizeScale(),
    });
  }

  private selectCylinderLod() {
    const counts = this.cylinderDomain.getPatchCounts(0);
    const roots = Array.from({ length: counts.axial }, (_, axialIndex) =>
      Array.from({ length: counts.angular }, (_unused, angularIndex) => ({
        level: 0,
        angularIndex,
        axialIndex,
      })),
    ).flat();
    return selectAdaptiveTerrainPatches(this.cylinderDomain, {
      roots,
      cameraWorldM: [
        this.engine.camera.position.x,
        this.engine.camera.position.y,
        this.engine.camera.position.z,
      ],
      getLevel: (address) => address.level,
      maxLevel: MAX_LOD_LEVEL,
      refinementDistanceM:
        1_400 * this.streamingRadius() * this.cylinderSizeScale(),
    });
  }

  private getPatchKey(shape: TerrainShape, address: unknown): string {
    if (shape === 'plane')
      return `plane:${getPlaneTerrainPatchKey(address as IPlaneTerrainPatchAddress)}`;
    if (shape === 'sphere') {
      const value = address as {
        face: string;
        level: number;
        x: number;
        y: number;
      };
      return `sphere:${value.face}:${value.level}:${value.x}:${value.y}`;
    }
    const value = address as {
      level: number;
      angularIndex: number;
      axialIndex: number;
    };
    return `cylinder:${value.level}:${value.angularIndex}:${value.axialIndex}`;
  }

  private addSelectedPatch(
    shape: TerrainShape,
    key: string,
    address: unknown,
  ): void {
    const domain =
      shape === 'plane'
        ? this.domain
        : shape === 'sphere'
          ? this.sphereDomain
          : this.cylinderDomain;
    const field =
      shape === 'plane'
        ? this.field
        : shape === 'sphere'
          ? this.sphereField
          : this.cylinderField;
    const patch = generateTerrainPatchMesh(field, domain as never, {
      address: address as never,
      resolution: PATCH_RESOLUTION,
      skirtDepthM: LOD_SKIRT_DEPTH_M,
    });
    this.installPatch(
      key,
      patch,
      shape,
      shape === 'plane' ? this.renderOriginX : 0,
      shape === 'plane' ? this.renderOriginZ : 0,
    );
  }

  private updateLodLabel(levels: readonly number[]): void {
    const counts = new Map<number, number>();
    for (const level of levels) counts.set(level, (counts.get(level) ?? 0) + 1);
    this.lodLabel.set(
      [...counts]
        .sort(([a], [b]) => a - b)
        .map(([level, count]) => `L${level}: ${count}`)
        .join(' · '),
    );
  }

  private installPatch(
    key: string,
    patch: ITerrainPatchMesh<unknown>,
    shape: TerrainShape,
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
    geometry.setAttribute(
      'color',
      new BufferAttribute(
        this.createBiomeColors(
          shape,
          patch.centerWorldM,
          patch.surface.positions,
        ),
        3,
      ),
    );
    geometry.setIndex(new BufferAttribute(patch.surface.indices, 1));
    const material = new MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.92,
      wireframe: this.wireframe(),
      vertexColors: true,
    });
    const mesh = new Mesh(geometry, material);
    if (patch.skirt) {
      const skirtGeometry = new BufferGeometry();
      skirtGeometry.setAttribute(
        'position',
        new BufferAttribute(patch.skirt.positions, 3),
      );
      skirtGeometry.setAttribute(
        'normal',
        new BufferAttribute(patch.skirt.normals, 3),
      );
      skirtGeometry.setAttribute('uv', new BufferAttribute(patch.skirt.uvs, 2));
      skirtGeometry.setAttribute(
        'color',
        new BufferAttribute(
          this.createBiomeColors(
            shape,
            patch.centerWorldM,
            patch.skirt.positions,
          ),
          3,
        ),
      );
      skirtGeometry.setIndex(new BufferAttribute(patch.skirt.indices, 1));
      mesh.add(new Mesh(skirtGeometry, material));
    }
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

  private createBiomeColors(
    shape: TerrainShape,
    centerWorldM: TerrainVector3,
    positions: Float32Array,
  ): Float32Array {
    const colors = new Float32Array(positions.length);
    const ocean = new Color('#315f78');
    const meadow = new Color('#5f9856');
    const mountain = new Color('#806f5b');
    const snow = new Color('#c3c5bc');
    const color = new Color();
    for (let offset = 0; offset < colors.length; offset += 3) {
      const x = centerWorldM[0] + positions[offset];
      const y = centerWorldM[1] + positions[offset + 1];
      const z = centerWorldM[2] + positions[offset + 2];
      const elevation =
        shape === 'plane'
          ? y
          : shape === 'sphere'
            ? Math.hypot(x, y, z) - SPHERE_RADIUS_M * this.sphereSizeScale()
            : CYLINDER_RADIUS_M * this.cylinderSizeScale() - Math.hypot(y, z);
      if (elevation < -25) {
        color.copy(ocean);
      } else if (elevation < 45) {
        color.copy(meadow);
      } else if (elevation < 135) {
        color.copy(meadow).lerp(mountain, (elevation - 45) / 90);
      } else {
        color.copy(mountain).lerp(snow, Math.min(1, (elevation - 135) / 45));
      }
      colors[offset] = color.r;
      colors[offset + 1] = color.g;
      colors[offset + 2] = color.b;
    }
    return colors;
  }

  private removePatch(key: string, patch: ITerrainPatchVisual): void {
    patch.mesh.removeFromParent();
    patch.border.removeFromParent();
    patch.mesh.traverse((object) => {
      if (object instanceof Mesh) object.geometry.dispose();
    });
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
