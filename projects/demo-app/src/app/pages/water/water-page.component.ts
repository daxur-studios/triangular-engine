import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Vector3,
  type Vector3Tuple,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  PostprocessingComposerComponent,
  ToneMappingEffectComponent,
} from 'triangular-engine/postprocessing';
import {
  generateTerrainPatchMesh,
  CylinderTerrainDomain,
  PlaneTerrainDomain,
  selectAdaptiveTerrainPatches,
  SphereTerrainDomain,
  SPHERE_TERRAIN_FACES,
  type ITerrainField,
  type ITerrainFieldSample,
  type ITerrainPatchMesh,
  type TerrainVector3,
} from 'triangular-engine/terrain';
import {
  CylinderWaterDomain,
  PlaneWaterDomain,
  SphereWaterDomain,
  WaterSurfaceComponent,
  type WaterMotionPresetName,
  type WaterQualityPresetName,
  type WaterSurfaceDomain,
} from 'triangular-engine/water';
import { WaterUnderwaterEffectComponent } from 'triangular-engine/water/postprocessing';

type DomainKind = 'plane' | 'sphere' | 'cylinder';

interface DemoDomain {
  readonly label: string;
  readonly description: string;
}

const SPHERE_RADIUS = 180;
const CYLINDER_RADIUS = 180;
const CYLINDER_LENGTH = 600;

const DOMAINS: Readonly<Record<DomainKind, DemoDomain>> = {
  plane: {
    label: 'Flat world',
    description:
      'A 1.6 km coast with beaches, sandbars, a continental shelf, and a deep offshore basin.',
  },
  sphere: {
    label: 'Sphere',
    description:
      'A terrain-generated ocean planet with continents, island chains, shelves, trenches, and abyssal basins.',
  },
  cylinder: {
    label: 'Cylinder',
    description: 'Interior ocean on an O’Neill-cylinder wall.',
  },
};

const DOMAIN_KEYS = Object.keys(DOMAINS) as DomainKind[];
const QUALITY_KEYS: readonly WaterQualityPresetName[] = [
  'performance',
  'balanced',
  'cinematic',
];
const MOTION_KEYS: readonly WaterMotionPresetName[] = [
  'calmLake',
  'oceanSwell',
  'storm',
];

@Component({
  selector: 'app-water-page',
  imports: [
    RouterLink,
    EngineModule,
    PostprocessingComposerComponent,
    ToneMappingEffectComponent,
    WaterSurfaceComponent,
    WaterUnderwaterEffectComponent,
  ],
  templateUrl: './water-page.component.html',
  styleUrl: './water-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    EngineService.provide({
      showFPS: true,
      webGLRendererParameters: { logarithmicDepthBuffer: true },
    }),
  ],
  host: { class: 'flex-page' },
})
export class WaterPageComponent {
  readonly domains = DOMAINS;
  readonly domainKeys = DOMAIN_KEYS;
  readonly qualityKeys = QUALITY_KEYS;
  readonly motionKeys = MOTION_KEYS;
  readonly activeDomain = signal<DomainKind>('plane');
  readonly activeQuality = signal<WaterQualityPresetName>('balanced');
  readonly activeMotion = signal<WaterMotionPresetName>('oceanSwell');
  readonly underwaterEnabled = signal(true);
  readonly wireframe = signal(false);
  readonly waterHeight = signal(0);
  readonly worldSize = signal(1);
  readonly worldScale = computed(() => 2 ** (this.worldSize() - 1));
  readonly worldSizeDescription = computed(() => {
    const scale = this.worldScale();
    switch (this.activeDomain()) {
      case 'sphere':
        return `adaptive LOD · radius ${SPHERE_RADIUS * scale} m`;
      case 'cylinder':
        return `${8 * scale} × ${4 * scale} root chunks · adaptive LOD`;
      default:
        return `${2 * scale} × ${2 * scale} root chunks · adaptive LOD`;
    }
  });
  readonly relativeUp = signal(true);
  readonly orbitUp = signal<Vector3Tuple>([0, 1, 0]);
  readonly activeWaterDomain = computed<WaterSurfaceDomain>(() => {
    const height = this.waterHeight();
    const scale = this.worldScale();
    switch (this.activeDomain()) {
      case 'sphere':
        return new SphereWaterDomain(SPHERE_RADIUS * scale + height);
      case 'cylinder':
        return new CylinderWaterDomain(
          Math.max(1, CYLINDER_RADIUS * scale - height),
          {
          axis: new Vector3(1, 0, 0),
            lengthM: CYLINDER_LENGTH * scale,
          },
        );
      default:
        return new PlaneWaterDomain({ seaLevelY: height });
    }
  });
  readonly cameraPosition = computed<Vector3Tuple>(() => {
    const scale = this.worldScale();
    switch (this.activeDomain()) {
      case 'sphere': {
        const direction = new Vector3(310, -80, 145).normalize();
        const distance = SPHERE_RADIUS * scale + 170;
        return [
          direction.x * distance,
          direction.y * distance,
          direction.z * distance,
        ];
      }
      case 'cylinder':
        return [-55, CYLINDER_RADIUS * scale - 24, 45];
      default:
        return [-430, 115, 330];
    }
  });
  readonly cameraTarget = computed<Vector3Tuple>(() => {
    const scale = this.worldScale();
    switch (this.activeDomain()) {
      case 'cylinder':
        return [35, CYLINDER_RADIUS * scale, 0];
      case 'plane':
        return [35, -6, -20];
      default:
        return [0, 0, 0];
    }
  });

  private readonly engine = inject(EngineService);
  private fixtures = createFixtures(1);
  private fixtureWorldSize = 1;

  constructor() {
    const destroyRef = inject(DestroyRef);
    const previousBackground = this.engine.scene.background;
    this.engine.scene.background = new Color('#04121c');
    for (const fixture of Object.values(this.fixtures)) {
      this.engine.scene.add(fixture);
    }

    effect(() => {
      const active = this.activeDomain();
      const wireframe = this.wireframe();
      const worldSize = this.worldSize();
      if (worldSize !== this.fixtureWorldSize) {
        this.disposeFixtures();
        this.fixtures = createFixtures(2 ** (worldSize - 1));
        this.fixtureWorldSize = worldSize;
        for (const fixture of Object.values(this.fixtures)) {
          this.engine.scene.add(fixture);
        }
      }
      for (const [kind, fixture] of Object.entries(this.fixtures)) {
        fixture.visible = kind === active;
        fixture.traverse((child) => {
          if (child instanceof Mesh) {
            (child.material as MeshStandardMaterial).wireframe = wireframe;
          }
        });
      }
    });

    const upSubscription = this.engine.postTick$.subscribe(() => {
      this.updateOrbitUp();
    });

    destroyRef.onDestroy(() => {
      upSubscription.unsubscribe();
      this.engine.scene.background = previousBackground;
      this.disposeFixtures();
    });
  }

  selectDomain(kind: DomainKind): void {
    this.activeDomain.set(kind);
  }

  toggleUnderwater(): void {
    this.underwaterEnabled.update((value) => !value);
  }

  toggleWireframe(): void {
    this.wireframe.update((value) => !value);
  }

  setWaterHeight(input: HTMLInputElement): void {
    this.waterHeight.set(Number(input.value));
  }

  setWorldSize(input: HTMLInputElement): void {
    this.worldSize.set(Number(input.value));
  }

  private updateOrbitUp(): void {
    const kind = this.activeDomain();
    if (!this.relativeUp() || kind === 'plane') {
      this.setOrbitUp([0, 1, 0]);
      return;
    }

    const camera = this.engine.camera.position;
    if (kind === 'sphere') {
      const up = camera.clone().normalize();
      this.setOrbitUp([up.x, up.y, up.z]);
      return;
    }

    // Cylinder gravity points away from the habitat wall and toward its
    // X-axis, so remove the camera's axial component and negate the result.
    const up = new Vector3(0, camera.y, camera.z).normalize().negate();
    this.setOrbitUp([up.x, up.y, up.z]);
  }

  private setOrbitUp(next: Vector3Tuple): void {
    const current = this.orbitUp();
    if (
      Math.abs(current[0] - next[0]) +
        Math.abs(current[1] - next[1]) +
        Math.abs(current[2] - next[2]) >
      0.001
    ) {
      this.orbitUp.set(next);
    }
  }

  private disposeFixtures(): void {
    for (const fixture of Object.values(this.fixtures)) {
      fixture.removeFromParent();
      fixture.traverse((child) => {
        if (child instanceof Mesh) {
          child.geometry.dispose();
          (child.material as MeshStandardMaterial).dispose();
        }
      });
    }
  }
}

function createFixtures(worldScale: number): Record<DomainKind, Object3D> {
  return {
    plane: createCoastalTerrain(worldScale),
    sphere: createOceanPlanetTerrain(worldScale),
    cylinder: createCylinderTerrain(worldScale),
  };
}

const COAST_PATCH_SIZE_M = 800;
const TERRAIN_PATCH_RESOLUTION = 48;
const TERRAIN_MAX_LOD_LEVEL = 2;
const TERRAIN_SKIRT_DEPTH_M = 5;

class CoastalTerrainField implements ITerrainField {
  readonly minElevationM = -58;
  readonly maxElevationM = 55;

  sample([x, _y, z]: TerrainVector3): ITerrainFieldSample {
    // The warped coast runs roughly north/south. Its wide shelf makes the
    // absorption gradient readable before the floor drops into the basin.
    const coastX =
      115 +
      Math.sin(z * 0.008) * 55 +
      Math.sin(z * 0.021 + 1.4) * 18;
    const offshoreM = coastX - x;
    const shelf = -2.5 - smoothstep(35, 235, offshoreM) * 9;
    const basin = -smoothstep(220, 570, offshoreM) * 38;

    const sandbars =
      Math.exp(-Math.pow((offshoreM - 75) / 32, 2)) *
      (3.2 + Math.sin(z * 0.035) * 1.3);
    const seabedVariation =
      Math.sin(x * 0.017 + z * 0.012) * 1.4 +
      Math.sin(x * 0.006 - z * 0.019) * 0.9;

    const inlandRise = smoothstep(-25, 260, x - coastX) * 25;
    const inlandHills =
      Math.max(0, x - coastX) / 260 *
      (8 + Math.sin(z * 0.013) * 6 + Math.sin(x * 0.018) * 4);
    const beach = smoothstep(-18, 42, x - coastX) * 5;

    // A low island adds a second shoreline and a protected shallow lagoon.
    const islandDistance = Math.hypot(x + 230, z - 145);
    const island = smoothstep(145, 38, islandDistance) * 18;
    const lagoon = smoothstep(75, 25, Math.hypot(x + 205, z - 135)) * -7;

    return {
      elevationM:
        shelf +
        basin +
        sandbars +
        seabedVariation +
        inlandRise +
        inlandHills +
        beach +
        island +
        lagoon,
    };
  }

  sampleBatch(
    positions: Float64Array,
    out = new Float64Array(positions.length / 3),
  ): Float64Array {
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

function createCoastalTerrain(worldScale: number): Group {
  const group = new Group();
  const domain = new PlaneTerrainDomain(COAST_PATCH_SIZE_M);
  const field = new CoastalTerrainField();

  const chunksPerSide = 2 * worldScale;
  const start = -Math.floor(chunksPerSide / 2);
  const roots = [];
  for (let z = start; z < start + chunksPerSide; z++) {
    for (let x = start; x < start + chunksPerSide; x++) {
      roots.push({ level: 0, x, z });
    }
  }
  const camera = getInitialCameraPosition('plane', worldScale);
  const selected = selectAdaptiveTerrainPatches(domain, {
    roots,
    cameraWorldM: camera,
    getLevel: (address) => address.level,
    maxLevel: TERRAIN_MAX_LOD_LEVEL,
    refinementDistanceM: 1_100 * worldScale,
  });
  for (const address of selected) {
    const patch = generateTerrainPatchMesh(field, domain, {
      address,
      resolution: TERRAIN_PATCH_RESOLUTION,
      skirtDepthM: TERRAIN_SKIRT_DEPTH_M,
    });
    group.add(createCoastalPatchMesh(patch));
  }

  return group;
}

function createCoastalPatchMesh(
  patch: ITerrainPatchMesh<unknown>,
  colors = createTerrainColors(patch.surface.positions),
  skirtColors = patch.skirt
    ? createTerrainColors(patch.skirt.positions)
    : undefined,
): Mesh {
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
    new BufferAttribute(colors, 3),
  );
  geometry.setIndex(new BufferAttribute(patch.surface.indices, 1));

  const mesh = new Mesh(
    geometry,
    new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.96,
      side: DoubleSide,
    }),
  );
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
      new BufferAttribute(skirtColors!, 3),
    );
    skirtGeometry.setIndex(new BufferAttribute(patch.skirt.indices, 1));
    mesh.add(new Mesh(skirtGeometry, mesh.material));
  }
  mesh.position.fromArray(patch.centerWorldM);
  return mesh;
}

class OceanPlanetTerrainField implements ITerrainField {
  readonly minElevationM = -46;
  readonly maxElevationM = 32;

  sample([x, y, z]: TerrainVector3): ITerrainFieldSample {
    const length = Math.hypot(x, y, z) || 1;
    const direction = new Vector3(x / length, y / length, z / length);

    // A broad, irregular continent faces the initial camera. Layering several
    // soft radial masses produces bays, peninsulas, and a long readable shelf.
    const continent =
      sphericalBump(direction, [0.9, 0.08, 0.42], 0.94, 0.38) * 55 +
      sphericalBump(direction, [0.62, -0.55, 0.56], 0.68, 0.25) * 31 +
      sphericalBump(direction, [0.54, 0.62, 0.58], 0.58, 0.2) * 24;

    const islandArc =
      sphericalBump(direction, [0.18, -0.18, 0.97], 0.24, 0.07) * 29 +
      sphericalBump(direction, [-0.04, -0.34, 0.94], 0.2, 0.06) * 25 +
      sphericalBump(direction, [-0.28, -0.42, 0.86], 0.18, 0.055) * 22;

    const abyss =
      sphericalBump(direction, [-0.62, 0.06, 0.78], 0.72, 0.22) * -13;
    const trench =
      Math.exp(-Math.pow((direction.dot(new Vector3(-0.45, -0.35, 0.82)) - 0.91) / 0.035, 2)) *
      -10;
    const relief =
      Math.sin(direction.x * 17 + direction.z * 9) * 2.2 +
      Math.sin(direction.y * 23 - direction.x * 7) * 1.4 +
      Math.sin((direction.x + direction.y + direction.z) * 31) * 0.7;

    return {
      elevationM: Math.min(32, Math.max(-46, -31 + continent + islandArc + abyss + trench + relief)),
    };
  }

  sampleBatch(
    positions: Float64Array,
    out = new Float64Array(positions.length / 3),
  ): Float64Array {
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

function createOceanPlanetTerrain(worldScale: number): Group {
  const group = new Group();
  const radius = SPHERE_RADIUS * worldScale;
  const domain = new SphereTerrainDomain(radius);
  const field = new OceanPlanetTerrainField();
  const roots = SPHERE_TERRAIN_FACES.map((face) => ({
    face,
    level: 0,
    x: 0,
    y: 0,
  }));
  const selected = selectAdaptiveTerrainPatches(domain, {
    roots,
    cameraWorldM: getInitialCameraPosition('sphere', worldScale),
    getLevel: (address) => address.level,
    maxLevel: TERRAIN_MAX_LOD_LEVEL + Math.log2(worldScale),
    refinementDistanceM: 720 * worldScale,
  });
  for (const address of selected) {
    const patch = generateTerrainPatchMesh(field, domain, {
      address,
      resolution: TERRAIN_PATCH_RESOLUTION,
      skirtDepthM: TERRAIN_SKIRT_DEPTH_M,
    });
    group.add(
      createCoastalPatchMesh(
        patch,
        createSphereTerrainColors(
          patch.centerWorldM,
          patch.surface.positions,
          radius,
        ),
        patch.skirt
          ? createSphereTerrainColors(
              patch.centerWorldM,
              patch.skirt.positions,
              radius,
            )
          : undefined,
      ),
    );
  }
  return group;
}

class CylinderHabitatTerrainField implements ITerrainField {
  readonly minElevationM = -42;
  readonly maxElevationM = 28;

  sample([x, y, z]: TerrainVector3): ITerrainFieldSample {
    const angle = Math.atan2(z, y);
    const coast =
      Math.sin(angle * 3 + x * 0.006) * 11 +
      Math.sin(angle * 7 - x * 0.012) * 4;
    const broadShelf = -9 + coast;
    const basin =
      -26 * smoothstep(0.25, 0.85, Math.sin(angle - x * 0.0015) * 0.5 + 0.5);
    const islands =
      Math.max(0, Math.sin(angle * 5 + x * 0.018) - 0.55) * 38;
    const relief =
      Math.sin(x * 0.025 + angle * 9) * 2 +
      Math.sin(x * 0.009 - angle * 13) * 1.2;
    return {
      elevationM: Math.min(
        this.maxElevationM,
        Math.max(this.minElevationM, broadShelf + basin + islands + relief),
      ),
    };
  }

  sampleBatch(
    positions: Float64Array,
    out = new Float64Array(positions.length / 3),
  ): Float64Array {
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

function createCylinderTerrain(worldScale: number): Group {
  const group = new Group();
  const radius = CYLINDER_RADIUS * worldScale;
  const domain = new CylinderTerrainDomain({
    radiusM: radius,
    lengthM: CYLINDER_LENGTH * worldScale,
    levelZeroAngularPatchCount: 8 * worldScale,
    levelZeroAxialPatchCount: 4 * worldScale,
  });
  const field = new CylinderHabitatTerrainField();
  const counts = domain.getPatchCounts(0);
  const roots = [];
  for (let axialIndex = 0; axialIndex < counts.axial; axialIndex++) {
    for (
      let angularIndex = 0;
      angularIndex < counts.angular;
      angularIndex++
    ) {
      roots.push({ level: 0, angularIndex, axialIndex });
    }
  }
  const selected = selectAdaptiveTerrainPatches(domain, {
    roots,
    cameraWorldM: getInitialCameraPosition('cylinder', worldScale),
    getLevel: (address) => address.level,
    maxLevel: TERRAIN_MAX_LOD_LEVEL,
    refinementDistanceM: 520 * worldScale,
  });
  for (const address of selected) {
    const patch = generateTerrainPatchMesh(field, domain, {
      address,
      resolution: TERRAIN_PATCH_RESOLUTION,
      skirtDepthM: TERRAIN_SKIRT_DEPTH_M,
    });
    group.add(
      createCoastalPatchMesh(
        patch,
        createCylinderTerrainColors(
          patch.centerWorldM,
          patch.surface.positions,
          radius,
        ),
        patch.skirt
          ? createCylinderTerrainColors(
              patch.centerWorldM,
              patch.skirt.positions,
              radius,
            )
          : undefined,
      ),
    );
  }
  return group;
}

function getInitialCameraPosition(
  kind: DomainKind,
  worldScale: number,
): TerrainVector3 {
  if (kind === 'sphere') {
    const direction = new Vector3(310, -80, 145).normalize();
    return direction
      .multiplyScalar(SPHERE_RADIUS * worldScale + 170)
      .toArray() as TerrainVector3;
  }
  if (kind === 'cylinder') {
    return [-55, CYLINDER_RADIUS * worldScale - 24, 45];
  }
  return [-430, 115, 330];
}

function createCylinderTerrainColors(
  center: TerrainVector3,
  positions: Float32Array,
  radiusM: number,
): Float32Array {
  const colors = new Float32Array(positions.length);
  const deep = new Color('#303b3c');
  const shelf = new Color('#716950');
  const beach = new Color('#b99d66');
  const green = new Color('#65754a');
  const color = new Color();

  for (let offset = 0; offset < positions.length; offset += 3) {
    const radialDistance = Math.hypot(
      positions[offset + 1] + center[1],
      positions[offset + 2] + center[2],
    );
    const elevation = radiusM - radialDistance;
    if (elevation < -12) {
      color.copy(deep).lerp(shelf, smoothstep(-42, -12, elevation));
    } else if (elevation < 3) {
      color.copy(shelf).lerp(beach, smoothstep(-12, 3, elevation));
    } else {
      color.copy(beach).lerp(green, smoothstep(3, 18, elevation));
    }
    color.toArray(colors, offset);
  }
  return colors;
}

function createSphereTerrainColors(
  center: TerrainVector3,
  positions: Float32Array,
  radiusM: number,
): Float32Array {
  const abyss = new Color('#252f35');
  const deep = new Color('#3e4a4b');
  const shelf = new Color('#756b55');
  const beach = new Color('#c0a66c');
  const green = new Color('#66794e');
  const highland = new Color('#817a6d');
  const color = new Color();
  const colors = new Float32Array(positions.length);

  for (let offset = 0; offset < positions.length; offset += 3) {
    const radius = Math.hypot(
      positions[offset] + center[0],
      positions[offset + 1] + center[1],
      positions[offset + 2] + center[2],
    );
    const elevation = radius - radiusM;
    if (elevation < -24) {
      color.copy(abyss).lerp(deep, smoothstep(-46, -24, elevation));
    } else if (elevation < -3) {
      color.copy(deep).lerp(shelf, smoothstep(-24, -3, elevation));
    } else if (elevation < 3) {
      color.copy(shelf).lerp(beach, smoothstep(-3, 3, elevation));
    } else if (elevation < 20) {
      color.copy(beach).lerp(green, smoothstep(3, 10, elevation));
    } else {
      color.copy(green).lerp(highland, smoothstep(20, 32, elevation));
    }
    color.toArray(colors, offset);
  }
  return colors;
}

function sphericalBump(
  direction: Vector3,
  center: Vector3Tuple,
  outerAngle: number,
  innerAngle: number,
): number {
  const centerDirection = new Vector3(...center).normalize();
  const angle = Math.acos(
    Math.min(1, Math.max(-1, direction.dot(centerDirection))),
  );
  return smoothstep(outerAngle, innerAngle, angle);
}

function createTerrainColors(positions: Float32Array): Float32Array {
  const deep = new Color('#313a36');
  const shelf = new Color('#665f4b');
  const sand = new Color('#b79a63');
  const grass = new Color('#687348');
  const rock = new Color('#777268');
  const color = new Color();
  const colors = new Float32Array(positions.length);

  for (let offset = 0; offset < positions.length; offset += 3) {
    const elevation = positions[offset + 1];
    if (elevation < -12) {
      color.copy(deep).lerp(shelf, smoothstep(-52, -12, elevation));
    } else if (elevation < 2.5) {
      color.copy(shelf).lerp(sand, smoothstep(-12, 2.5, elevation));
    } else if (elevation < 24) {
      color.copy(sand).lerp(grass, smoothstep(2.5, 10, elevation));
    } else {
      color.copy(grass).lerp(rock, smoothstep(24, 52, elevation));
    }
    color.toArray(colors, offset);
  }
  return colors;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
