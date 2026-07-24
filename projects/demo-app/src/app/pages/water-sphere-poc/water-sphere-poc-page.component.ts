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
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
  type Vector3Tuple,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  SphereWaterDomain,
  WATER_RENDER_PRESETS,
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

/** Small "planet" so a full orbit (poles included) fits in a short flythrough. */
const SPHERE_RADIUS_M = 500;
const SPHERE_CENTER = new Vector3(0, 0, 0);

const ISLANDS: ReadonlyArray<{
  readonly direction: Vector3;
  readonly cosAngularRadius: number;
  readonly heightM: number;
}> = [
  {
    direction: new Vector3(1, 0.4, 0.2).normalize(),
    cosAngularRadius: Math.cos(0.35),
    heightM: 14,
  },
  {
    direction: new Vector3(-0.6, 0.2, -0.8).normalize(),
    cosAngularRadius: Math.cos(0.28),
    heightM: 10,
  },
  {
    direction: new Vector3(0.1, -0.3, 0.95).normalize(),
    cosAngularRadius: Math.cos(0.4),
    heightM: 16,
  },
];

/** Narrow great-circle valleys for testing ordinary and deep water together. */
const CREVICES: ReadonlyArray<{
  readonly centerDirection: Vector3;
  readonly planeNormal: Vector3;
  readonly cosAngularExtent: number;
  readonly halfWidthSin: number;
  readonly featherWidthSin: number;
  readonly depthM: number;
}> = [
  {
    centerDirection: ISLANDS[0].direction,
    planeNormal: new Vector3(-0.2, 0, 1).normalize(),
    cosAngularExtent: Math.cos(0.55),
    halfWidthSin: Math.sin(0.025),
    featherWidthSin: Math.sin(0.075),
    depthM: 30,
  },
  {
    centerDirection: new Vector3(-0.45, 0.15, 0.88).normalize(),
    planeNormal: new Vector3(0.9, 0.25, 0.42).normalize(),
    cosAngularExtent: Math.cos(0.7),
    halfWidthSin: Math.sin(0.04),
    featherWidthSin: Math.sin(0.1),
    depthM: 22,
  },
  {
    centerDirection: new Vector3(-0.7, -0.5, -0.35).normalize(),
    planeNormal: new Vector3(-0.35, 0.8, -0.44).normalize(),
    cosAngularExtent: Math.cos(0.65),
    halfWidthSin: Math.sin(0.03),
    featherWidthSin: Math.sin(0.085),
    depthM: 36,
  },
];

const OCEAN_FLOOR_DEPTH_M = 6;
const DEFAULT_RING_COUNT = 5;
const MIN_RING_COUNT = 1;
const MAX_RING_COUNT = 7;

@Component({
  selector: 'app-water-sphere-poc-page',
  imports: [RouterLink, EngineModule, WaterSurfaceComponent],
  templateUrl: './water-sphere-poc-page.component.html',
  styleUrl: './water-sphere-poc-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    EngineService.provide({
      showFPS: true,
      webGLRendererParameters: { logarithmicDepthBuffer: true },
    }),
  ],
  host: { class: 'flex-page' },
})
export class WaterSpherePocPageComponent {
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
  readonly wireframe = signal(false);
  readonly ringCount = signal(DEFAULT_RING_COUNT);
  readonly minRingCount = MIN_RING_COUNT;
  readonly maxRingCount = MAX_RING_COUNT;
  readonly outerExtentMeters = computed(() => {
    const grid = WATER_RENDER_PRESETS[this.activeQuality()].grid;
    const halfCountPatches = grid.coreSizePatches / 2;
    const patchWorldSize = grid.baseCellSize * 2 ** this.ringCount();
    return Math.round(halfCountPatches * patchWorldSize);
  });

  readonly sphereRadiusM = SPHERE_RADIUS_M;
  readonly domain = new SphereWaterDomain(SPHERE_RADIUS_M, {
    center: SPHERE_CENTER,
  });
  readonly presetOverrides = computed<WaterRenderPresetOverrides>(() => ({
    grid: { ringCount: this.ringCount() },
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

    const startFrame = this.domain.getLocalFrame(
      ISLANDS[0].direction.clone().multiplyScalar(SPHERE_RADIUS_M + 1),
    );
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
      new MeshStandardMaterial({ color: '#8f7a52', roughness: 0.95 }),
    );
    this.engine.scene.add(this.groundMesh);

    destroyRef.onDestroy(() => {
      this.engine.scene.background = previousBackground;
      this.groundMesh.removeFromParent();
      this.groundMesh.geometry.dispose();
      (this.groundMesh.material as MeshStandardMaterial).dispose();
    });
  }

  setRingCount(value: number | string): void {
    this.ringCount.set(
      Math.min(
        MAX_RING_COUNT,
        Math.max(MIN_RING_COUNT, Math.round(Number(value))),
      ),
    );
  }

  toggleWireframe(): void {
    this.wireframe.update((value) => !value);
    (this.groundMesh.material as MeshStandardMaterial).wireframe =
      this.wireframe();
  }
}

function createGroundGeometry(): SphereGeometry {
  const baseRadius = SPHERE_RADIUS_M - OCEAN_FLOOR_DEPTH_M;
  const geometry = new SphereGeometry(baseRadius, 96, 64);
  const position = geometry.attributes['position'];
  const direction = new Vector3();
  for (let i = 0; i < position.count; i++) {
    direction
      .set(position.getX(i), position.getY(i), position.getZ(i))
      .normalize();
    let bump = 0;
    for (const island of ISLANDS) {
      const cos = direction.dot(island.direction);
      bump = Math.max(
        bump,
        smoothstep(island.cosAngularRadius, 1, cos) * island.heightM,
      );
    }
    let creviceDepth = 0;
    for (const crevice of CREVICES) {
      const across = Math.abs(direction.dot(crevice.planeNormal));
      const crossSection =
        1 - smoothstep(crevice.halfWidthSin, crevice.featherWidthSin, across);
      const along = smoothstep(
        crevice.cosAngularExtent,
        1,
        direction.dot(crevice.centerDirection),
      );
      creviceDepth = Math.max(
        creviceDepth,
        crossSection * along * crevice.depthM,
      );
    }
    const radius = baseRadius + bump - creviceDepth;
    position.setXYZ(
      i,
      direction.x * radius,
      direction.y * radius,
      direction.z * radius,
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}
