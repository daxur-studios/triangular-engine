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
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  generateTerrainPatchMesh,
  type ITerrainField,
  type ITerrainFieldSample,
  PlaneTerrainDomain,
  type TerrainVector3,
} from 'triangular-engine/terrain';

const PATCH_SIZE_M = 512;
const PATCH_RESOLUTION = 32;
const PATCH_RADIUS = 2;
const LARGE_COORDINATE_M = 1_000_000_000;

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
  readonly largeCoordinates = signal(false);
  readonly wireframe = signal(false);
  readonly patchCount = (PATCH_RADIUS * 2 + 1) ** 2;
  readonly coordinateLabel = signal('0 m');

  private readonly engine = inject(EngineService);
  private readonly domain = new PlaneTerrainDomain(PATCH_SIZE_M);
  private readonly field = new TerrainLabField();
  private readonly terrain = new Group();
  private readonly materials: MeshStandardMaterial[] = [];

  constructor() {
    const destroyRef = inject(DestroyRef);
    const previousBackground = this.engine.scene.background;
    this.engine.scene.background = new Color('#071018');
    this.engine.scene.add(this.terrain);
    this.rebuild();
    destroyRef.onDestroy(() => {
      this.disposeTerrain();
      this.terrain.removeFromParent();
      this.engine.scene.background = previousBackground;
    });
  }

  toggleLargeCoordinates(): void {
    this.largeCoordinates.update((enabled) => !enabled);
    this.rebuild();
  }

  toggleWireframe(): void {
    this.wireframe.update((enabled) => !enabled);
    for (const material of this.materials)
      material.wireframe = this.wireframe();
  }

  private rebuild(): void {
    this.disposeTerrain();
    const centreTile = this.largeCoordinates()
      ? Math.floor(LARGE_COORDINATE_M / PATCH_SIZE_M)
      : 0;
    const localOriginX = centreTile * PATCH_SIZE_M;
    const localOriginZ = centreTile * PATCH_SIZE_M;
    this.coordinateLabel.set(
      this.largeCoordinates() ? `${localOriginX.toLocaleString()} m` : '0 m',
    );

    for (let dz = -PATCH_RADIUS; dz <= PATCH_RADIUS; dz++) {
      for (let dx = -PATCH_RADIUS; dx <= PATCH_RADIUS; dx++) {
        const address = { level: 0, x: centreTile + dx, z: centreTile + dz };
        const patch = generateTerrainPatchMesh(this.field, this.domain, {
          address,
          resolution: PATCH_RESOLUTION,
        });
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
          color: (dx + dz) % 2 === 0 ? '#5d9b55' : '#6aa65d',
          roughness: 0.92,
          wireframe: this.wireframe(),
        });
        const mesh = new Mesh(geometry, material);
        // Terrain owns f64 absolute coordinates; rendering uses a small local frame.
        mesh.position.set(
          patch.centerWorldM[0] - localOriginX,
          patch.centerWorldM[1],
          patch.centerWorldM[2] + localOriginZ,
        );
        this.materials.push(material);
        this.terrain.add(mesh);
      }
    }
  }

  private disposeTerrain(): void {
    for (const child of [...this.terrain.children]) {
      if (child instanceof Mesh) child.geometry.dispose();
      child.removeFromParent();
    }
    for (const material of this.materials) material.dispose();
    this.materials.length = 0;
  }
}
