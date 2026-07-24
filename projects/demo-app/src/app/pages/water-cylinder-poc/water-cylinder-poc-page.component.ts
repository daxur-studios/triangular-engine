import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  Color,
  CylinderGeometry,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type Vector3Tuple,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  CylinderWaterDomain,
  WaterSurfaceComponent,
  type WaterMotionPresetName,
  type WaterQualityPresetName,
  type WaterRenderPresetOverrides,
} from 'triangular-engine/water';

const MOTION_LABELS: Record<WaterMotionPresetName, string> = {
  calmLake: 'Calm lake',
  oceanSwell: 'Ocean swell',
  storm: 'Storm',
};

const QUALITY_LABELS: Record<WaterQualityPresetName, string> = {
  performance: 'Performance',
  balanced: 'Balanced',
  cinematic: 'Cinematic',
};

const CYLINDER_RADIUS_M = 500;
const CYLINDER_LENGTH_M = 1000;
const CYLINDER_CENTER = new Vector3(0, 0, 0);
const CYLINDER_AXIS = new Vector3(1, 0, 0);
const GROUND_ROTATION_RAD = -Math.PI / 2;

const BUMPS: ReadonlyArray<{
  readonly axialM: number;
  readonly angleRad: number;
  readonly radiusM: number;
  readonly heightM: number;
}> = [
  { axialM: -120, angleRad: 0, radiusM: 90, heightM: 14 },
  { axialM: 60, angleRad: 2.6, radiusM: 70, heightM: 10 },
  { axialM: 220, angleRad: -1.8, radiusM: 100, heightM: 16 },
];

const OCEAN_FLOOR_DEPTH_M = 6;

@Component({
  selector: 'app-water-cylinder-poc-page',
  imports: [RouterLink, EngineModule, WaterSurfaceComponent],
  templateUrl: './water-cylinder-poc-page.component.html',
  styleUrl: './water-cylinder-poc-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    EngineService.provide({
      showFPS: true,
      webGLRendererParameters: { logarithmicDepthBuffer: true },
    }),
  ],
  host: { class: 'flex-page' },
})
export class WaterCylinderPocPageComponent {
  readonly waterLevel = signal(10);
  readonly minWaterLevel = 2;
  readonly maxWaterLevel = 50;
  readonly motionKeys = Object.keys(MOTION_LABELS) as WaterMotionPresetName[];
  readonly motionLabels = MOTION_LABELS;
  readonly qualityKeys = Object.keys(
    QUALITY_LABELS,
  ) as WaterQualityPresetName[];
  readonly qualityLabels = QUALITY_LABELS;
  readonly activeMotion = signal<WaterMotionPresetName>('oceanSwell');
  readonly activeQuality = signal<WaterQualityPresetName>('balanced');
  readonly detailChop = signal(true);
  readonly shoreFade = signal(true);
  readonly lodDetail = signal(1);
  readonly wireframe = signal(false);

  readonly cylinderRadiusM = CYLINDER_RADIUS_M;
  readonly domain = computed(
    () =>
      new CylinderWaterDomain(CYLINDER_RADIUS_M - this.waterLevel(), {
        axis: CYLINDER_AXIS,
        center: CYLINDER_CENTER,
        lengthM: CYLINDER_LENGTH_M,
      }),
  );
  readonly presetOverrides = computed<WaterRenderPresetOverrides>(() => ({
    shading: {
      detailStrength: this.detailChop() ? 0.45 : 0,
      absorptionDistance: 40,
      shoreFadeDistance: this.shoreFade() ? 3 : 0,
      colorShallow: '#8fe3ff',
      colorDeep: '#0e4a73',
    },
  }));

  readonly initialCameraPosition: Vector3Tuple;
  readonly initialTarget: Vector3Tuple;
  readonly initialUpVector: Vector3Tuple;

  private readonly engine = inject(EngineService);
  private readonly groundMesh: Mesh;

  constructor() {
    const destroyRef = inject(DestroyRef);
    const previousBackground = this.engine.scene.background;
    this.engine.scene.background = new Color('#04121c');

    const firstBump = BUMPS[0];
    const referencePoint = nativeCylinderPointToWorld(
      Math.cos(firstBump.angleRad) * (CYLINDER_RADIUS_M + 1),
      firstBump.axialM,
      Math.sin(firstBump.angleRad) * (CYLINDER_RADIUS_M + 1),
    );
    const startFrame = this.domain().getLocalFrame(referencePoint);
    const startCamera = startFrame.origin
      .clone()
      .addScaledVector(startFrame.normal, 25)
      .addScaledVector(startFrame.tangentU, -40);
    const startTarget = startFrame.origin
      .clone()
      .addScaledVector(startFrame.tangentU, 40);
    this.initialCameraPosition = [startCamera.x, startCamera.y, startCamera.z];
    this.initialTarget = [startTarget.x, startTarget.y, startTarget.z];
    this.initialUpVector = [
      startFrame.normal.x,
      startFrame.normal.y,
      startFrame.normal.z,
    ];

    this.groundMesh = new Mesh(
      createGroundGeometry(),
      new MeshStandardMaterial({
        color: '#8f7a52',
        roughness: 0.95,
        // The geometry remains inward-facing for the shared depth prepass,
        // while the display fixture stays inspectable from outside.
        side: DoubleSide,
      }),
    );
    this.engine.scene.add(this.groundMesh);

    destroyRef.onDestroy(() => {
      this.engine.scene.background = previousBackground;
      this.groundMesh.removeFromParent();
      this.groundMesh.geometry.dispose();
      (this.groundMesh.material as MeshStandardMaterial).dispose();
    });
  }

  setWaterLevel(value: number | string): void {
    this.waterLevel.set(
      Math.min(this.maxWaterLevel, Math.max(this.minWaterLevel, Number(value))),
    );
  }

  toggleWireframe(): void {
    this.wireframe.update((value) => !value);
    (this.groundMesh.material as MeshStandardMaterial).wireframe =
      this.wireframe();
  }
}

function createGroundGeometry(): CylinderGeometry {
  const baseRadius = CYLINDER_RADIUS_M - OCEAN_FLOOR_DEPTH_M;
  const geometry = new CylinderGeometry(
    baseRadius,
    baseRadius,
    CYLINDER_LENGTH_M,
    96,
    64,
    true,
  );
  const position = geometry.attributes['position'];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const angle = Math.atan2(z, x);
    let bump = 0;
    for (const feature of BUMPS) {
      const axialDelta = y - feature.axialM;
      const angleDelta = Math.atan2(
        Math.sin(angle - feature.angleRad),
        Math.cos(angle - feature.angleRad),
      );
      const arcDelta = angleDelta * baseRadius;
      const distance = Math.hypot(axialDelta, arcDelta);
      bump = Math.max(
        bump,
        smoothstep(feature.radiusM, 0, distance) * feature.heightM,
      );
    }
    const radius = baseRadius - bump;
    position.setXYZ(i, Math.cos(angle) * radius, y, Math.sin(angle) * radius);
  }
  // CylinderGeometry faces outward by default. This fixture is an interior
  // ocean, so make the seabed genuinely inward-facing instead of relying on a
  // DoubleSide display material. The depth prepass can then capture the same
  // shore geometry that the main scene renders.
  const index = geometry.index;
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const second = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, second);
    }
    index.needsUpdate = true;
  }
  geometry.computeVertexNormals();
  geometry.rotateZ(GROUND_ROTATION_RAD);
  return geometry;
}

function nativeCylinderPointToWorld(
  nativeX: number,
  nativeY: number,
  nativeZ: number,
): Vector3 {
  const cos = Math.cos(GROUND_ROTATION_RAD);
  const sin = Math.sin(GROUND_ROTATION_RAD);
  return new Vector3(
    nativeX * cos - nativeY * sin,
    nativeX * sin + nativeY * cos,
    nativeZ,
  );
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}
