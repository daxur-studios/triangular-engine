import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  computed,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
  type WebGLRenderer,
} from 'three';
import {
  EngineModule,
  EngineService,
  OrbitControlsComponent,
} from 'triangular-engine';
import {
  findCellAt,
  normalize,
  type IVec3,
  type IPlanetSurfaceSampler,
} from 'triangular-engine/worldgen';
import {
  buildPlanetGlobeGeometry,
  createCellPerPixelLookupUniforms,
  enableCellPerPixelLookup,
  setCellPerPixelLookupEnabled,
  updateCellPerPixelLookup,
} from 'triangular-engine/worldgen/render';
import {
  TestRunnerComponent,
  type TestProgress,
  type TestRunResult,
} from 'triangular-engine/testing';
import {
  buildIllustrativeFixture,
  ILLUSTRATIVE_HEIGHT_SCALE_M,
  ILLUSTRATIVE_RADIUS_M,
  type IllustrativeLandmark,
  type IllustrativeStyle,
} from './illustrative-cell-planet-fixture';
import {
  ILLUSTRATIVE_TEST_HISTORY,
  type IllustrativeSettings,
} from './illustrative-cell-planet-tests';
import { createIllustrativeAdapter } from './illustrative-cell-planet-adapter';

/** Fixed, indexed shape fixture using the existing globe adapter; no new renderer or animation loop. */
@Component({
  selector: 'app-illustrative-cell-planet',
  imports: [EngineModule, ReactiveFormsModule, TestRunnerComponent],
  providers: EngineService.provide({ showFPS: true }),
  templateUrl: './illustrative-cell-planet-page.component.html',
  styleUrl: './illustrative-cell-planet-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex-page' },
})
export class IllustrativeCellPlanetPageComponent {
  readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  readonly orbit = viewChild(OrbitControlsComponent);
  readonly fixture = buildIllustrativeFixture();
  readonly radius = ILLUSTRATIVE_RADIUS_M;
  readonly heightScale = ILLUSTRATIVE_HEIGHT_SCALE_M;
  readonly history = ILLUSTRATIVE_TEST_HISTORY;
  readonly busy = signal(false);
  readonly rendered = signal(false);
  readonly activeLabel = signal('');
  readonly lastResult = signal<TestRunResult<IllustrativeSettings> | null>(
    null,
  );
  readonly state = signal<IllustrativeSettings>({
    style: 'illustrative',
    landmark: 'volcano',
    altitudeM: 90_000,
    crisp: true,
    facets: true,
    motion: 'still',
  });
  readonly form = new FormGroup({
    style: new FormControl<IllustrativeStyle>('illustrative', {
      nonNullable: true,
    }),
    landmark: new FormControl<IllustrativeLandmark>('volcano', {
      nonNullable: true,
    }),
    crisp: new FormControl(true, { nonNullable: true }),
    facets: new FormControl(true, { nonNullable: true }),
  });
  readonly sampler = computed(() =>
    this.state().style === 'illustrative'
      ? this.fixture.illustratedSampler
      : this.fixture.world.sampler,
  );
  readonly initialPosition: [number, number, number];
  readonly initialTarget: [number, number, number];
  readonly initialUp: [number, number, number];
  private readonly lookupUniforms = createCellPerPixelLookupUniforms();
  private terrain?: Mesh<BufferGeometry, MeshStandardMaterial>;
  private ocean?: Mesh<SphereGeometry, MeshStandardMaterial>;
  private requestedAt = performance.now();
  private firstFrameMs = 0;
  private initialFixtureToRenderMs = 0;
  private framePending = true;

  readonly adapter = createIllustrativeAdapter({
    capture: () => ({
      settings: { ...this.state() },
      position: this.engine.camera.position.toArray(),
      quaternion: this.engine.camera.quaternion.toArray(),
      up: this.engine.camera.up.toArray(),
      target: this.orbit()!.orbitControls()!.target.toArray(),
      enabled: this.orbit()!.orbitControls()!.enabled,
      damping: this.orbit()!.orbitControls()!.enableDamping,
    }),
    apply: (settings) => this.apply(settings),
    restore: (snapshot) => {
      this.apply(snapshot.settings);
      this.engine.camera.position.fromArray(snapshot.position);
      this.engine.camera.quaternion.fromArray(snapshot.quaternion);
      this.engine.camera.up.fromArray(snapshot.up);
      const controls = this.orbit()!.orbitControls()!;
      controls.target.fromArray(snapshot.target);
      controls.enabled = snapshot.enabled;
      controls.enableDamping = snapshot.damping;
      controls.update();
    },
    onBeforeFrame: (callback) => {
      const s = this.engine.beforeRender$.subscribe(callback);
      return () => s.unsubscribe();
    },
    onFrame: (callback) => {
      const s = this.engine.renderComplete$.subscribe((f) =>
        callback(f.renderedAt),
      );
      return () => s.unsubscribe();
    },
    move: (settings, fraction) => this.move(settings, fraction),
    observe: () => this.observe(),
    environment: () => this.environment(),
  });

  constructor() {
    const params = this.route.snapshot.queryParamMap;
    const style = params.get('style');
    const landmark = params.get('view');
    const altitudeM = Number(params.get('altitudeM') ?? 90_000);
    const initial: IllustrativeSettings = {
      ...this.state(),
      ...(style === 'cell-features' || style === 'illustrative'
        ? { style }
        : {}),
      ...(landmark && Object.hasOwn(this.fixture.anchors, landmark)
        ? { landmark: landmark as IllustrativeLandmark }
        : {}),
      ...(Number.isFinite(altitudeM) &&
      altitudeM >= 10_000 &&
      altitudeM <= 1_000_000
        ? { altitudeM }
        : {}),
    };
    this.state.set(initial);
    this.form.patchValue(initial, { emitEvent: false });
    const direction = this.fixture.anchors[initial.landmark];
    const pose = this.pose(direction, initial.altitudeM);
    this.initialPosition = pose.position.toArray();
    this.initialTarget = pose.target.toArray();
    this.initialUp = [direction.x, direction.y, direction.z];
    updateCellPerPixelLookup(this.lookupUniforms, this.fixture.lookup);

    effect(() => {
      const sampler = this.sampler();
      untracked(() => this.installTerrain(sampler));
    });
    effect(() => {
      const { crisp, facets } = this.state();
      setCellPerPixelLookupEnabled(this.lookupUniforms, crisp);
      if (this.terrain && this.terrain.material.flatShading !== facets) {
        this.terrain.material.flatShading = facets;
        this.terrain.material.needsUpdate = true;
      }
    });
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      const value = this.form.getRawValue();
      // A style/appearance change preserves even a manually orbited camera pose.
      this.apply(
        { ...this.state(), ...value, motion: 'still' },
        value.landmark !== this.state().landmark,
      );
    });
    this.engine.renderComplete$.pipe(takeUntilDestroyed()).subscribe(() => {
      if (this.framePending) {
        this.firstFrameMs = performance.now() - this.requestedAt;
        this.framePending = false;
      }
      if (!this.rendered() && this.terrain && this.orbit()?.orbitControls()) {
        this.initialFixtureToRenderMs =
          performance.now() - this.fixture.startedAt;
        this.rendered.set(true);
      }
    });
    this.destroyRef.onDestroy(() => {
      for (const mesh of [this.terrain, this.ocean]) {
        if (mesh) {
          this.engine.scene.remove(mesh);
          mesh.geometry.dispose();
          mesh.material.dispose();
        }
      }
      this.lookupUniforms.uCellData.value.dispose();
      this.lookupUniforms.uCellIds.value.dispose();
    });
  }

  private installTerrain(sampler: IPlanetSurfaceSampler): void {
    const data = buildPlanetGlobeGeometry({
      sampler,
      radius: this.radius,
      heightScale: this.heightScale,
      longitudeSegments: 256,
      latitudeRings: 128,
      cellIdAt: (direction) =>
        findCellAt(this.fixture.world.graph, direction).id,
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(data.normals, 3));
    geometry.setAttribute(
      'planetDirection',
      new BufferAttribute(data.directions, 3),
    );
    const colours = new Float32Array(data.vertexCount * 3);
    for (let i = 0; i < data.vertexCount; i++) {
      const offset = data.cellIds[i] * 4;
      colours.set(
        this.fixture.lookup.cellData.subarray(offset, offset + 3),
        i * 3,
      );
    }
    geometry.setAttribute('color', new BufferAttribute(colours, 3));
    geometry.setIndex(new BufferAttribute(data.indices, 1));
    geometry.computeBoundingSphere();
    if (this.terrain) {
      this.terrain.geometry.dispose();
      this.terrain.geometry = geometry;
    } else {
      const material = new MeshStandardMaterial({
        vertexColors: true,
        roughness: 1,
        flatShading: this.state().facets,
      });
      const seaLevel = this.fixture.world.tectonics.seaLevelElevation;
      material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            '#include <common>\nattribute vec3 planetDirection;\nvarying vec3 vSphereNorm;\nvarying float vIllustrativeHeight;',
          )
          .replace(
            '#include <begin_vertex>',
            '#include <begin_vertex>\nvSphereNorm = planetDirection;\nvIllustrativeHeight = (length(position) - ' +
              this.radius.toFixed(1) +
              ') / ' +
              this.heightScale.toFixed(1) +
              ' - ' +
              seaLevel.toFixed(9) +
              ';',
          );
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            '#include <common>\nvarying float vIllustrativeHeight;',
          )
          .replace(
            '#include <color_fragment>',
            '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.24, 0.28, 0.30), smoothstep(0.14, 0.20, vIllustrativeHeight));\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.92, 0.94), smoothstep(0.34, 0.39, vIllustrativeHeight));',
          );
      };
      material.customProgramCacheKey = () => 'illustrative-indexed-globe-v1';
      enableCellPerPixelLookup(material, this.lookupUniforms);
      setCellPerPixelLookupEnabled(this.lookupUniforms, this.state().crisp);
      this.terrain = new Mesh(geometry, material);
      this.terrain.name = 'illustrative-terrain';
      this.engine.scene.add(this.terrain);
      this.ocean = new Mesh(
        new SphereGeometry(this.radius + seaLevel * this.heightScale, 128, 64),
        new MeshStandardMaterial({ color: '#125c88', roughness: 0.5 }),
      );
      this.ocean.name = 'illustrative-ocean';
      this.engine.scene.add(this.ocean);
    }
  }

  apply(settings: IllustrativeSettings, reposition = true): void {
    this.requestedAt = performance.now();
    this.framePending = true;
    this.state.set(settings);
    this.form.patchValue(settings, { emitEvent: false });
    const controls = this.orbit()?.orbitControls();
    if (controls && this.busy()) {
      controls.enabled = false;
      controls.enableDamping = false;
    }
    if (reposition) this.move(settings, 0);
  }

  private pose(direction: IVec3, altitude: number) {
    const d = new Vector3(direction.x, direction.y, direction.z);
    const ref =
      Math.abs(d.y) < 0.92 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
    const tangent = new Vector3().crossVectors(ref, d).normalize();
    const target = d.clone().multiplyScalar(this.radius);
    return {
      target,
      position: d
        .clone()
        .multiplyScalar(this.radius + altitude)
        .addScaledVector(tangent, altitude * 1.25),
    };
  }

  move(settings: IllustrativeSettings, fraction: number): void {
    let direction = this.fixture.anchors[settings.landmark];
    let altitude = settings.altitudeM;
    const anchors: IllustrativeLandmark[] =
      settings.motion === 'teleport'
        ? ['coast', 'mountain', 'volcano', 'seam', 'north-pole', 'coast']
        : ['lowland', 'mountain', 'volcano', 'coast'];
    if (settings.motion === 'zoom')
      altitude *= 1 - 0.75 * Math.sin(Math.PI * fraction);
    if (settings.motion === 'teleport')
      direction =
        this.fixture.anchors[
          anchors[
            Math.min(anchors.length - 1, Math.floor(fraction * anchors.length))
          ]
        ];
    if (settings.motion === 'flyover') {
      const scaled = fraction * (anchors.length - 1);
      const i = Math.min(anchors.length - 2, Math.floor(scaled));
      const a = this.fixture.anchors[anchors[i]],
        b = this.fixture.anchors[anchors[i + 1]];
      const t = scaled - i;
      direction = normalize({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
      });
    }
    const camera = this.engine.camera;
    if (!camera) return;
    const pose = this.pose(direction, altitude);
    camera.up.set(direction.x, direction.y, direction.z);
    camera.position.copy(pose.position);
    camera.lookAt(pose.target);
    this.orbit()?.orbitControls()?.target.copy(pose.target);
  }

  progress(progress: TestProgress | null): void {
    this.busy.set(progress !== null);
    this.activeLabel.set(progress?.label ?? '');
  }

  observe() {
    const info = this.engine.renderer.info;
    const positions = this.terrain?.geometry.getAttribute('position').array;
    const finite = !!positions && positions.every(Number.isFinite);
    return {
      metrics: [
        {
          name: 'option-to-first-frame',
          unit: 'ms',
          source:
            'Option apply through next completed render; graph is already resident',
          samples: [this.firstFrameMs],
        },
        {
          name: 'draw-calls',
          unit: 'count',
          source: 'renderer.info.render last completed frame',
          samples: [info.render.calls],
        },
        {
          name: 'triangles',
          unit: 'count',
          source: 'renderer.info.render last completed frame',
          samples: [info.render.triangles],
        },
        {
          name: 'geometries',
          unit: 'count',
          source: 'renderer.info.memory; allocation count, not bytes',
          samples: [info.memory.geometries],
        },
      ],
      checks: [
        { name: 'finite terrain positions', passed: finite },
        {
          name: 'rendered terrain',
          passed: info.render.triangles > 0 && !!this.terrain,
        },
        {
          name: 'required landmarks generated',
          passed: Object.values(this.fixture.anchorCellIds).every(
            Number.isInteger,
          ),
          detail: JSON.stringify(this.fixture.anchorCellIds),
        },
      ],
      limitations: [
        'Fixed tessellation comparison: no streaming/LOD claim.',
        '2048×1024 nearest cell-ID atlas; close boundary aliasing needs separate assessment.',
        'Hardware timings and human appearance acceptance remain pending.',
      ],
      details: {
        style: this.state().style,
        coldFixtureGenerationMs: this.fixture.generationMs,
        initialFixtureToRenderMs: this.initialFixtureToRenderMs,
      },
    };
  }

  environment() {
    const renderer = this.engine.renderer as WebGLRenderer;
    const gl = renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = debug
      ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL))
      : 'unknown';
    return {
      renderer: renderer.constructor.name,
      gpu,
      softwareRenderer: /swiftshader|llvmpipe|software/i.test(gpu),
      viewport: renderer.domElement.width + 'x' + renderer.domElement.height,
      fixture: 'volcanic:71:600:relax2:jitter0.15:plates10',
      radiusM: this.radius,
      heightScaleM: this.heightScale,
      mesh: '256×128 indexed globe + 128×64 ocean',
      build: 'local uncommitted source',
    };
  }
}
