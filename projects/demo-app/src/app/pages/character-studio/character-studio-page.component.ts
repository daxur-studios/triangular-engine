import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  computed,
  inject,
  isDevMode,
  signal,
} from '@angular/core';
import { DecimalPipe, UpperCasePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  PerspectiveCamera,
} from 'three';
import { EngineModule, EngineService, ScreenshotService } from 'triangular-engine';
import { CapsuleCharacterActor } from 'triangular-engine/procedural';
import {
  ALL_CAPSULE_CHARACTER_PRESETS,
  EXTENDED_EMOTION_NAMES,
  preProcessText,
  wordsToVisemes,
} from 'triangular-engine/characters';
import { provideBrowserImageCompression } from 'triangular-engine/image-compression';
import { TestRunnerComponent, describeRendererGpu, type TestProgress, type TestSetting } from 'triangular-engine/testing';
import {
  createCharacterStudioTestAdapter,
  createCharacterStudioRecordingCapture,
  type CharacterStudioPerformanceCapture,
  type CharacterStudioRenderedFrameStats,
  type CharacterStudioTestHost,
  type CharacterStudioTestSnapshot,
} from './character-studio-test-adapter';
import {
  CAPSULE_FACIAL_EMOTIONS_SUITE_V1,
  CAPSULE_HAIR_COVERAGE_SUITE_V1,
  CAPSULE_HUMAN_AB_VARIANTS_SUITE_V1,
  CAPSULE_HUMAN_LINEUP_SUITE_V1,
  CAPSULE_ORANGE_PIGTAILS_BENCHMARK_SUITE_V1,
  CAPSULE_ORANGE_PIGTAILS_BENCHMARK_SUITE_V2,
  CAPSULE_VISUAL_VERIFICATION_SUITE_V1,
  CHARACTER_STUDIO_HUMAN_PERFORMANCE_SUITE_V1,
  type CharacterStudioTestSettings,
  type CameraFramingPreset,
  type CharacterStudioPerformanceMotion,
} from './character-studio-tests';
import type { VisualFocusTargetId } from './character-studio-focus';
import {
  createCharacterStudioContributions,
  type CharacterStudioContribution,
  type CharacterStudioExpression,
  type CharacterStudioFamilyId,
} from './character-studio-contributions';
import { EXPERIMENTAL_PIGTAIL_HEAD_ID, EXPERIMENTAL_PIGTAIL_PRESETS } from './experimental-pigtail-head';
import { EXPERIMENTAL_SPACE_CAT } from './experimental-space-cat';
import { CapsulePartPreviewComponent } from './capsule-part-preview.component';
import { CLASSIC_STACHE_YAW, DEFAULT_STACHE_SHAPE, type StacheShape } from './classic-stache-shapes';
import type { CapsuleHairStyle } from './experimental-capsule-hair';

type CharacterStudioView = 'front' | 'three-quarter' | 'profile' | 'back' | 'face' | 'hair';

const speechPreviewText = 'Hello, look at me talk!';
const speechPreviewTrack = wordsToVisemes(preProcessText(speechPreviewText));

interface PerformanceActorPlacement {
  readonly root: Group;
  readonly anchorX: number;
  readonly anchorZ: number;
  readonly phaseRadians: number;
}

interface CharacterStudioViewOption {
  readonly id: CharacterStudioView;
  readonly label: string;
}

@Component({
  selector: 'app-character-studio-page',
  imports: [EngineModule, RouterLink, DecimalPipe, UpperCasePipe, TestRunnerComponent, CapsulePartPreviewComponent],
  templateUrl: './character-studio-page.component.html',
  styleUrl: './character-studio-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true }), provideBrowserImageCompression()],
  host: { class: 'flex-page' },
})
export class CharacterStudioPageComponent {
  private readonly engine = inject(EngineService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly screenshot = inject(ScreenshotService);
  private readonly contributions = createCharacterStudioContributions();
  private readonly controlsRevision = signal(0);
  private speechUtterance?: SpeechSynthesisUtterance;
  private elapsedSeconds = 0;
  private variantSeed = 1;
  private cameraFraming: CameraFramingPreset = 'three-quarter';
  private activeFocusTarget?: VisualFocusTargetId;
  private engineError = '';
  private totalRenderedFrames = 0;
  private renderStartedAt = 0;
  private readonly renderCompleteCallbacks = new Set<(
    renderedAt: number,
    stats?: CharacterStudioRenderedFrameStats,
  ) => void>();
  private readonly performanceActors: CapsuleCharacterActor[] = [];
  private readonly performancePlacements: PerformanceActorPlacement[] = [];
  private performancePopulation?: number;
  private performanceMotion?: CharacterStudioPerformanceMotion;
  private performanceElapsedSeconds = 0;
  private performanceSetupCpuMs = 0;
  private performanceWindowActive = false;
  private readonly actorUpdateSamples: number[] = [];

  readonly familyOptions: readonly CharacterStudioContribution[] = [
    this.contributions.human,
    this.contributions.cat,
  ];
  readonly selectedFamilyId = signal<CharacterStudioFamilyId>('human');
  readonly activeFamily = computed(() => this.contributions[this.selectedFamilyId()]);
  readonly selectedPresetId = signal(this.contributions.human.defaultPresetId);
  readonly experimentalHeadSelected = computed(() =>
    EXPERIMENTAL_PIGTAIL_PRESETS.some(preset => preset.value === this.selectedPresetId()));
  readonly workshopOpen = signal(false);
  readonly workshopHair = signal<CapsuleHairStyle>('pigtails');
  readonly workshopLockLength = signal(1);
  readonly workshopYaw = signal(35);
  readonly stacheYaw = signal(CLASSIC_STACHE_YAW);
  readonly stacheShape = signal(DEFAULT_STACHE_SHAPE);
  readonly defaultStacheShape = DEFAULT_STACHE_SHAPE;
  readonly withMustache = signal(true);
  readonly stacheReference = signal('');
  readonly stacheReferenceYaw = CLASSIC_STACHE_YAW;
  readonly classicStacheSelected = computed(() => this.workshopOpen() && this.workshopHair() === 'classic-stache');
  readonly workshopHairChoices = [
    { id: 'pigtails', label: 'Pigtails' },
    { id: 'shaggy', label: 'Shaggy' },
    { id: 'classic-stache', label: 'Classic Stache' },
  ] as const;
  readonly workshopHairLabel = computed(() => this.workshopHair() === 'pigtails'
    ? 'Orange Pigtails' : this.workshopHairChoices.find(choice => choice.id === this.workshopHair())?.label);
  readonly speechPreviewNotice = signal('');
  readonly selectedMotionId = signal('idle');
  readonly selectedExpression = signal<CharacterStudioExpression>('happy');
  readonly autoRotate = signal(false);
  readonly runnerReady = signal(false);
  readonly runnerBusy = signal(false);
  readonly activeTestScenario = signal<string | null>(null);
  readonly activeView = signal<CharacterStudioView>('three-quarter');
  readonly cameraPosition = signal<[number, number, number]>([2.6, 1.7, 3.2]);
  readonly cameraTarget = signal<[number, number, number]>([0, 0.98, 0]);
  readonly cameraFovDegrees = signal(42);
  readonly viewOptions: readonly CharacterStudioViewOption[] = [
    { id: 'front', label: 'Front' },
    { id: 'three-quarter', label: '3/4' },
    { id: 'profile', label: 'Profile' },
    { id: 'back', label: 'Back' },
    { id: 'face', label: 'Face' },
    { id: 'hair', label: 'Head' },
  ];
  readonly expressionOptions = computed(() => {
    const ids: readonly CharacterStudioExpression[] = this.experimentalHeadSelected()
      ? [...EXTENDED_EMOTION_NAMES, 'awe']
      : EXTENDED_EMOTION_NAMES;
    return ids.map(id => ({ id, label: id[0].toUpperCase() + id.slice(1) }));
  });
  readonly testHistory = [
    CAPSULE_VISUAL_VERIFICATION_SUITE_V1,
    CAPSULE_FACIAL_EMOTIONS_SUITE_V1,
    CAPSULE_HUMAN_AB_VARIANTS_SUITE_V1,
    CAPSULE_ORANGE_PIGTAILS_BENCHMARK_SUITE_V1,
    CAPSULE_ORANGE_PIGTAILS_BENCHMARK_SUITE_V2,
    CAPSULE_HAIR_COVERAGE_SUITE_V1,
    CAPSULE_HUMAN_LINEUP_SUITE_V1,
    CHARACTER_STUDIO_HUMAN_PERFORMANCE_SUITE_V1,
  ] as const;
  readonly allowTestAutoStart = isDevMode();
  readonly activeControls = computed(() => {
    this.controlsRevision();
    return this.activeFamily().controlGroups();
  });
  readonly visiblePresets = computed(() => {
    const family = this.activeFamily();
    const selected = this.selectedPresetId();
    if (selected !== 'custom' || family.presets.some((preset) => preset.value === selected)) {
      return family.presets;
    }
    return [{ value: 'custom', label: 'Custom variation' }, ...family.presets];
  });
  readonly selectedPresetLabel = computed(() => {
    const selected = this.selectedPresetId();
    return this.activeFamily().presets.find((preset) => preset.value === selected)?.label ?? 'Custom variation';
  });

  private readonly testHost: CharacterStudioTestHost = {
    snapshot: () => ({
      settings: this.testHost.read(),
      cameraPosition: [...this.cameraPosition()] as [number, number, number],
      cameraTarget: [...this.cameraTarget()] as [number, number, number],
      humanActorYaw: this.contributions.human.root.rotation.y,
      catActorYaw: this.contributions.cat.root.rotation.y,
      studioView: this.activeView(),
      autoRotate: this.autoRotate(),
    }),
    restore: (snapshot) => {
      this.testHost.apply(snapshot.settings);
      this.cameraPosition.set([...snapshot.cameraPosition] as [number, number, number]);
      this.cameraTarget.set([...snapshot.cameraTarget] as [number, number, number]);
      this.contributions.human.root.rotation.y = snapshot.humanActorYaw;
      this.contributions.cat.root.rotation.y = snapshot.catActorYaw;
      this.autoRotate.set(snapshot.autoRotate ?? false);
      if (snapshot.studioView && this.viewOptions.some((view) => view.id === snapshot.studioView)) {
        this.activeView.set(snapshot.studioView as CharacterStudioView);
      }
    },
    read: () => {
      const family = this.activeFamily();
      const controlValue = (id: string): string | undefined => family.controlGroups()
        .flatMap((group) => group.controls)
        .find((item) => item.id === id)?.value;
      return {
        characterType: family.id,
        presetId: this.selectedPresetId(),
        emotion: this.selectedExpression(),
        gait: this.selectedMotionId() as CharacterStudioTestSettings['gait'],
        cameraFraming: this.cameraFraming,
        cameraFovDegrees: this.cameraFovDegrees(),
        ...(this.activeFocusTarget ? { focusTarget: this.activeFocusTarget } : {}),
        layout: this.performancePopulation !== undefined ? 'lineup' : 'hero',
        ...(this.performancePopulation !== undefined ? {
          performancePopulation: this.performancePopulation,
          performanceMotion: this.performanceMotion ?? 'idle',
        } : {}),
        ...(family.id === 'cat' ? {
          panicked: controlValue('panicked') === 'true',
          tuft: controlValue('tuft') === 'true',
          restMouthPose: controlValue('restMouthPose') as CharacterStudioTestSettings['restMouthPose'],
        } : {
          rightHandAction: controlValue('rightHandAction') as CharacterStudioTestSettings['rightHandAction'],
          leftHandAction: controlValue('leftHandAction') as CharacterStudioTestSettings['leftHandAction'],
        }),
      };
    },
    apply: (settings) => {
      if (this.workshopOpen()) {
        this.setWorkshopHair('pigtails', 1);
        this.workshopOpen.set(false);
      }
      const fov = settings.cameraFovDegrees ?? 42;
      this.cameraFovDegrees.set(fov);
      if (this.engine.camera instanceof PerspectiveCamera) {
        this.engine.camera.fov = fov;
        this.engine.camera.updateProjectionMatrix();
      }
      if (this.selectedFamilyId() !== settings.characterType) {
        this.selectedFamilyId.set(settings.characterType);
        this.syncFamilyVisibility();
      }
      const family = this.activeFamily();
      family.selectPreset(settings.presetId);
      this.selectedPresetId.set(settings.presetId);
      family.setMotion(settings.gait);
      this.selectedMotionId.set(settings.gait);
      this.selectExpression(settings.emotion);
      if (settings.hairStyleId !== undefined) family.setControl('hairStyleId', settings.hairStyleId);
      if (settings.facialHairId !== undefined) family.setControl('facialHairId', settings.facialHairId);
      if (settings.hairColor !== undefined) family.setControl('hairColor', settings.hairColor);
      if (settings.accessory !== undefined) family.setControl('accessory', settings.accessory);
      if (settings.helmet !== undefined) family.setControl('helmet', String(settings.helmet));
      if (settings.jetpack !== undefined) family.setControl('jetpack', String(settings.jetpack));
      if (settings.characterType === 'human') {
        family.setControl('rightHandAction', settings.rightHandAction ?? 'none');
        family.setControl('leftHandAction', settings.leftHandAction ?? 'none');
      } else {
        if (settings.rightHandAction) family.setControl('rightHandAction', settings.rightHandAction);
        if (settings.leftHandAction) family.setControl('leftHandAction', settings.leftHandAction);
      }
      if (settings.panicked !== undefined) family.setControl('panicked', String(settings.panicked));
      if (settings.tuft !== undefined) family.setControl('tuft', String(settings.tuft));
      if (settings.restMouthPose) family.setControl('restMouthPose', settings.restMouthPose);
      this.autoRotate.set(false);
      family.root.rotation.y = 0;
      family.update(0.25);
      this.setCameraFraming(settings.cameraFraming);
      if (settings.focusTarget) this.applyFocusTargetFraming(settings.focusTarget);
      if (settings.performancePopulation !== undefined && settings.performanceMotion !== undefined) {
        this.preparePerformanceScenario(settings);
      } else {
        this.clearPerformanceScenario();
      }
      this.refreshControls();
    },
    renderedFrames: () => this.totalRenderedFrames,
    errors: () => this.engineError,
    resetErrors: () => { this.engineError = ''; },
    onRenderComplete: (callback) => {
      this.renderCompleteCallbacks.add(callback);
      return () => this.renderCompleteCallbacks.delete(callback);
    },
    beginPerformanceWindow: () => {
      this.actorUpdateSamples.length = 0;
      this.performanceWindowActive = true;
    },
    endPerformanceWindow: (): CharacterStudioPerformanceCapture => {
      this.performanceWindowActive = false;
      return {
        actorUpdateCpuMs: [...this.actorUpdateSamples],
        scenarioSetupCpuMs: this.performanceSetupCpuMs,
      };
    },
    speak: () => {},
    isSpeaking: () => false,
    setTurntableAngle: (radians) => {
      this.activeFamily().root.rotation.y = radians ?? 0;
    },
    setCameraOrbit: (azimuthRadians, elevationRadians) => {
      const family = this.activeFamily();
      const radius = family.id === 'cat' ? 2 : 2.7;
      const targetY = family.id === 'cat' ? 0.36 : 1.2;
      const horizontalRadius = radius * Math.cos(elevationRadians);
      this.cameraPosition.set([
        Math.sin(azimuthRadians) * horizontalRadius,
        targetY + Math.sin(elevationRadians) * radius,
        Math.cos(azimuthRadians) * horizontalRadius,
      ]);
      this.cameraTarget.set([0, targetY, 0]);
    },
    recording: () => createCharacterStudioRecordingCapture(this.engine.canvas),
    environment: (): Readonly<Record<string, TestSetting>> => ({
      browser: typeof navigator !== 'undefined' ? navigator.userAgent : 'node',
      ...describeRendererGpu(this.engine.renderer as Parameters<typeof describeRendererGpu>[0]),
      'canvas.drawingBufferWidth': this.engine.renderer.domElement.width,
      'canvas.drawingBufferHeight': this.engine.renderer.domElement.height,
      devicePixelRatio: globalThis.devicePixelRatio ?? 1,
      'performance.targetFrameIntervalMs': 16.7,
    }),
    thumbnail: async (settings) => {
      const detail = settings.focusTarget !== undefined ||
        settings.cameraFraming === 'face-close-up' || settings.cameraFraming === 'head-close-up';
      return this.screenshot.capture({
        engine: this.engine,
        format: 'image/webp',
        quality: 0.9,
        ...(detail ? { resolution: { width: 1280, height: 720 }, samples: 4 } : {}),
        compress: {
          maxSizeMB: 0.05,
          maxWidthOrHeight: detail ? 640 : 240,
          fileType: 'image/webp',
          quality: detail ? 0.88 : 0.6,
        },
      });
    },
    resolveFocusFraming: (settings) => {
      const family = this.activeFamily();
      const targetId = settings.focusTarget ?? (family.id === 'cat'
        ? 'cat-face'
        : settings.cameraFraming === 'head-close-up' ? 'human-head-hair' : 'human-face');
      const canvas = this.engine.canvas;
      const bounds = canvas.getBoundingClientRect();
      const camera = this.engine.camera;
      return family.resolveFocusFraming(targetId, {
        fovDegrees: camera instanceof PerspectiveCamera ? camera.fov : 42,
        aspect: bounds.height > 0 ? bounds.width / bounds.height : 16 / 9,
        azimuthRadians: this.framingAzimuthRadians(settings.cameraFraming),
      });
    },
  };
  readonly testAdapter = createCharacterStudioTestAdapter(this.testHost);

  private readonly floor = new Mesh(
    new PlaneGeometry(60, 60),
    new MeshStandardMaterial({ color: '#151922', roughness: 0.92, metalness: 0.02 }),
  );
  private readonly pedestal = new Mesh(
    new CylinderGeometry(0.82, 0.88, 0.08, 64),
    new MeshStandardMaterial({ color: '#252c38', roughness: 0.58, metalness: 0.34 }),
  );

  constructor() {
    this.engine.scene.background = new Color('#10131b');
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -0.105;
    this.floor.receiveShadow = true;
    this.pedestal.position.y = -0.04;
    this.pedestal.receiveShadow = true;

    this.engine.scene.add(this.floor, this.pedestal, ...this.familyOptions.map((family) => family.root));
    this.syncFamilyVisibility();
    this.applyView('three-quarter');
    const query = inject(ActivatedRoute).snapshot.queryParamMap;
    const workshop = query.get('workshop');
    if (workshop === '1' || workshop === 'classic-stache') {
      this.toggleWorkshop();
      if (workshop === 'classic-stache') this.setWorkshopHair('classic-stache');
    } else if (query.get('preset') === EXPERIMENTAL_SPACE_CAT.id) {
      this.selectFamily('cat');
      this.selectPreset(EXPERIMENTAL_SPACE_CAT.id);
    }

    this.engine.tick$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((deltaSeconds) => this.update(deltaSeconds));
    this.engine.beforeRender$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => { this.renderStartedAt = performance.now(); });
    this.engine.renderComplete$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ renderedAt }) => {
        this.totalRenderedFrames++;
        const renderInfo = this.engine.renderer.info.render;
        const stats: CharacterStudioRenderedFrameStats = {
          ...(this.renderStartedAt > 0 ? { renderSubmitCpuMs: Math.max(0, renderedAt - this.renderStartedAt) } : {}),
          drawCalls: renderInfo.calls,
          triangles: renderInfo.triangles,
        };
        for (const callback of this.renderCompleteCallbacks) callback(renderedAt, stats);
        this.updateTestRunnerReadiness();
      });
    this.engine.error$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        this.engineError ||= `${event.phase}: ${String(event.error)}`;
      });

    this.destroyRef.onDestroy(() => {
      URL.revokeObjectURL(this.stacheReference());
      this.stopSpeechPreview();
      this.clearPerformanceScenario();
      for (const family of this.familyOptions) {
        this.engine.scene.remove(family.root);
        family.dispose();
      }
      this.engine.scene.remove(this.floor, this.pedestal);
      this.floor.geometry.dispose();
      (this.floor.material as MeshStandardMaterial).dispose();
      this.pedestal.geometry.dispose();
      (this.pedestal.material as MeshStandardMaterial).dispose();
      this.renderCompleteCallbacks.clear();
    });
  }

  selectFamily(id: CharacterStudioFamilyId): void {
    if (id === this.selectedFamilyId()) return;
    this.stopSpeechPreview();
    this.selectedFamilyId.set(id);
    const family = this.activeFamily();
    this.selectedPresetId.set(family.defaultPresetId);
    const initialMotion = id === 'cat' ? 'goofy_walk' : 'idle';
    this.selectedMotionId.set(initialMotion);
    family.setMotion(initialMotion);
    family.selectPreset(family.defaultPresetId);
    this.selectExpression(this.selectedExpression());
    this.syncFamilyVisibility();
    this.activeFocusTarget = undefined;
    this.applyView('three-quarter');
    this.refreshControls();
  }

  selectPreset(presetId: string): void {
    if (presetId === 'custom') return;
    const wasExperimental = this.experimentalHeadSelected();
    const changed = presetId !== this.selectedPresetId();
    if (wasExperimental && changed) this.stopSpeechPreview();
    this.activeFamily().selectPreset(presetId);
    this.selectedPresetId.set(presetId);
    if (changed && (wasExperimental || this.experimentalHeadSelected())) {
      this.selectExpression(this.selectedExpression());
      this.applyView(this.activeView());
    } else if (changed && this.activeFamily().id === 'cat') {
      this.applyView(this.activeView());
    }
    this.refreshControls();
  }

  selectMotion(motionId: string): void {
    this.activeFamily().setMotion(motionId);
    this.selectedMotionId.set(motionId);
  }

  toggleWorkshop(): void {
    if (this.runnerBusy()) return;
    if (this.workshopOpen()) {
      this.setWorkshopHair('pigtails', 1);
      this.workshopOpen.set(false);
    } else {
      this.selectFamily('human');
      this.selectPreset(EXPERIMENTAL_PIGTAIL_HEAD_ID);
      this.workshopOpen.set(true);
      this.workshopYaw.set(35);
    }
    afterNextRender(() => {
      if (this.classicStacheSelected()) this.setStacheYaw(this.stacheYaw());
      else this.applyView('three-quarter');
    }, { injector: this.injector });
  }

  setWorkshopHair(style: CapsuleHairStyle, length = this.workshopLockLength()): void {
    const changed = style !== this.workshopHair();
    this.contributions.human.setExperimentalHair(style, length, this.stacheShape(), this.withMustache());
    this.workshopHair.set(style);
    this.workshopLockLength.set(length);
    if (changed && style === 'classic-stache') this.setStacheYaw(this.stacheYaw());
  }

  setStacheShape(shape: StacheShape): void {
    this.stacheShape.set(shape);
    this.setWorkshopHair('classic-stache');
  }

  setMustache(visible: boolean): void {
    this.withMustache.set(visible);
    this.setWorkshopHair('classic-stache');
  }

  setStacheReference(input: HTMLInputElement): void {
    const file = input.files?.[0];
    if (!file) return;
    const previous = this.stacheReference();
    this.stacheReference.set(URL.createObjectURL(file));
    URL.revokeObjectURL(previous);
    input.value = '';
    this.setStacheYaw(CLASSIC_STACHE_YAW);
  }

  setStacheYaw(yaw: number): void {
    this.stacheYaw.set(yaw);
    this.autoRotate.set(false);
    const face = this.activeView() === 'face';
    this.activeView.set(face ? 'face' : 'three-quarter');
    this.cameraFraming = face ? 'face-close-up' : 'three-quarter';
    this.applyFocusTargetFraming(face ? 'human-head-hair' : 'human-full-body', -yaw * Math.PI / 180);
  }

  selectExpression(expression: CharacterStudioExpression): void {
    const available = expression === 'awe' && !this.experimentalHeadSelected() ? 'neutral' : expression;
    this.activeFamily().setExpression(available);
    this.selectedExpression.set(available);
  }

  previewSpeech(): void {
    const preview = this.contributions.human.speechPreview;
    if (!this.experimentalHeadSelected() || this.runnerBusy() || !preview) return;
    this.stopSpeechPreview();

    const playWithoutVoice = () => {
      preview.play(speechPreviewTrack);
      this.speechPreviewNotice.set('Voice unavailable. Playing the mouth animation.');
    };
    if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
      playWithoutVoice();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(speechPreviewText);
    utterance.lang = 'en';
    this.speechUtterance = utterance;
    let started = false;
    utterance.onstart = () => {
      if (this.speechUtterance !== utterance) return;
      started = true;
      preview.play(speechPreviewTrack);
    };
    utterance.onend = () => {
      if (this.speechUtterance === utterance) this.speechUtterance = undefined;
    };
    utterance.onerror = () => {
      if (this.speechUtterance !== utterance) return;
      this.speechUtterance = undefined;
      if (!started) playWithoutVoice();
    };
    window.speechSynthesis.speak(utterance);
  }

  private stopSpeechPreview(): void {
    if (this.speechUtterance) {
      this.speechUtterance = undefined;
      window.speechSynthesis.cancel();
    }
    this.contributions.human.speechPreview?.stop();
    this.speechPreviewNotice.set('');
  }

  setControl(controlId: string, value: string): void {
    this.activeFamily().setControl(controlId, value);
    this.selectedPresetId.set('custom');
    this.refreshControls();
  }

  randomize(): void {
    if (this.experimentalHeadSelected()) return;
    this.activeFamily().randomize(this.variantSeed++);
    this.selectedPresetId.set('custom');
    if (this.activeFamily().id === 'cat') this.applyView(this.activeView());
    this.refreshControls();
  }

  resetCharacter(): void {
    this.stopSpeechPreview();
    if (this.workshopOpen()) {
      this.stacheShape.set(DEFAULT_STACHE_SHAPE);
      this.withMustache.set(true);
      this.stacheYaw.set(CLASSIC_STACHE_YAW);
      this.setWorkshopHair('pigtails', 1);
      this.workshopYaw.set(35);
      this.selectExpression('happy');
      this.applyView('three-quarter');
      return;
    }
    const family = this.activeFamily();
    family.selectPreset(family.defaultPresetId);
    family.setMotion(family.id === 'cat' ? 'goofy_walk' : 'idle');
    family.setExpression('happy');
    if (family.id === 'human') {
      family.setControl('rightHandAction', 'none');
      family.setControl('leftHandAction', 'none');
    }
    this.selectedPresetId.set(family.defaultPresetId);
    this.selectedMotionId.set(family.id === 'cat' ? 'goofy_walk' : 'idle');
    this.selectedExpression.set('happy');
    this.activeFocusTarget = undefined;
    this.refreshControls();
    this.applyView('three-quarter');
  }

  setAutoRotate(): void {
    if (this.runnerBusy()) return;
    this.autoRotate.update((value) => !value);
  }

  applyView(view: CharacterStudioView): void {
    const family = this.activeFamily();
    const centerY = family.cameraTargetY;
    this.activeFocusTarget = undefined;

    if (this.experimentalHeadSelected()) {
      const experimentalView = view === 'hair' ? 'face' : view;
      this.activeView.set(experimentalView);
      this.autoRotate.set(false);
      this.cameraFraming = experimentalView === 'face' ? 'face-close-up' : experimentalView;
      this.applyFocusTargetFraming(experimentalView === 'face' ? 'human-head-hair' : 'human-full-body');
      return;
    }

    this.activeView.set(view);
    switch (view) {
      case 'front':
        this.cameraFraming = 'front';
        this.cameraTarget.set([0, centerY, 0]);
        this.cameraPosition.set([0, centerY + 0.7, this.cameraDistance(3.7)]);
        break;
      case 'profile':
        this.cameraFraming = 'profile';
        this.cameraTarget.set([0, centerY, 0]);
        this.cameraPosition.set([this.cameraDistance(3.8), centerY + 0.62, 0.12]);
        break;
      case 'back':
        this.cameraFraming = 'back';
        this.cameraTarget.set([0, centerY, 0]);
        this.cameraPosition.set([0, centerY + 0.7, -this.cameraDistance(3.7)]);
        break;
      case 'face':
        this.cameraFraming = 'face-close-up';
        this.applyFocusTargetFraming(family.id === 'cat' ? 'cat-face' : 'human-face');
        break;
      case 'hair':
        this.cameraFraming = 'head-close-up';
        this.applyFocusTargetFraming(family.id === 'cat' ? 'cat-face' : 'human-head-hair');
        break;
      case 'three-quarter':
      default:
        this.cameraFraming = 'three-quarter';
        this.cameraTarget.set([0, centerY, 0]);
        this.cameraPosition.set([this.cameraDistance(2.5), centerY + 0.68, this.cameraDistance(3.1)]);
        break;
    }
  }

  private setCameraFraming(framing: CameraFramingPreset): void {
    this.cameraFraming = framing;
    switch (framing) {
      case 'front': this.applyView('front'); break;
      case 'profile': this.applyView('profile'); break;
      case 'back': this.applyView('back'); break;
      case 'face-close-up': this.applyView('face'); break;
      case 'head-close-up': this.applyView('hair'); break;
      case 'full-shot':
      case 'three-quarter': this.applyView('three-quarter'); break;
    }
    this.cameraFraming = framing;
  }

  private framingAzimuthRadians(framing: CameraFramingPreset): number {
    switch (framing) {
      case 'profile': return this.experimentalHeadSelected() ? -Math.PI / 2 : -1.18;
      case 'back': return Math.PI;
      case 'three-quarter': return this.experimentalHeadSelected() ? -Math.PI / 4 : -0.55;
      default: return 0;
    }
  }

  private applyFocusTargetFraming(targetId: VisualFocusTargetId, azimuthRadians = this.framingAzimuthRadians(this.cameraFraming)): void {
    this.activeFocusTarget = targetId;
    const canvas = this.engine.canvas;
    const bounds = canvas.getBoundingClientRect();
    const camera = this.engine.camera;
    const framing = this.activeFamily().resolveFocusFraming(targetId, {
      fovDegrees: camera instanceof PerspectiveCamera ? camera.fov : 42,
      aspect: bounds.height > 0 ? bounds.width / bounds.height : 16 / 9,
      azimuthRadians,
      ...(this.experimentalHeadSelected() ? { elevationRadians: 0 } : {}),
    });
    this.cameraPosition.set([...framing.cameraPosition]);
    this.cameraTarget.set([...framing.cameraTarget]);
  }

  private cameraDistance(humanDistance: number): number {
    return this.activeFamily().id === 'human' ? humanDistance : humanDistance * 0.72;
  }

  private syncFamilyVisibility(): void {
    const activeId = this.selectedFamilyId();
    for (const family of this.familyOptions) {
      family.root.visible = family.id === activeId;
    }
  }

  private refreshControls(): void {
    this.controlsRevision.update((value) => value + 1);
  }

  private update(deltaSeconds: number): void {
    const updateStartedAt = this.performanceWindowActive ? performance.now() : 0;
    this.activeFamily().update(deltaSeconds);
    if (this.performancePopulation !== undefined) {
      if (this.performanceMotion === 'walk-path') {
        this.performanceElapsedSeconds += deltaSeconds;
        for (const placement of this.performancePlacements) {
          const angle = this.performanceElapsedSeconds * 0.55 + placement.phaseRadians;
          placement.root.position.set(
            placement.anchorX + Math.cos(angle) * 0.38,
            0,
            placement.anchorZ + Math.sin(angle) * 0.38,
          );
          placement.root.rotation.y = -angle;
        }
      }
      for (const actor of this.performanceActors) actor.update(deltaSeconds);
    }
    if (this.performanceWindowActive) this.actorUpdateSamples.push(performance.now() - updateStartedAt);
    if (!this.autoRotate()) return;
    this.elapsedSeconds += deltaSeconds;
    this.activeFamily().root.rotation.y = Math.sin(this.elapsedSeconds * 0.32) * 0.48;
  }

  private preparePerformanceScenario(settings: CharacterStudioTestSettings): void {
    this.clearPerformanceScenario();
    const startedAt = performance.now();
    const population = Math.min(48, Math.max(1, Math.floor(settings.performancePopulation ?? 1)));
    const motion = settings.performanceMotion ?? 'idle';
    const preset = ALL_CAPSULE_CHARACTER_PRESETS.find((candidate) => candidate.id === settings.presetId);
    if (!preset) throw new Error(`Unknown capsule human preset for performance case: ${settings.presetId}`);

    this.pedestal.visible = false;
    this.performancePopulation = population;
    this.performanceMotion = motion;
    this.performanceElapsedSeconds = 0;
    this.performancePlacements.length = 0;

    const columns = Math.ceil(Math.sqrt(population));
    const rows = Math.ceil(population / columns);
    const spacing = 1.7;
    const humanRoot = this.contributions.human.root;
    for (let index = 0; index < population; index++) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const anchorX = (column - (columns - 1) / 2) * spacing;
      const anchorZ = (row - (rows - 1) / 2) * spacing;
      const root = index === 0 ? humanRoot : this.createPerformanceActor(index, preset, settings.gait);
      root.position.set(anchorX, 0, anchorZ);
      root.rotation.y = 0;
      root.visible = true;
      this.performancePlacements.push({
        root,
        anchorX,
        anchorZ,
        phaseRadians: (index / Math.max(1, population)) * Math.PI * 2,
      });
    }

    const aspect = this.engine.height > 0 ? this.engine.width / this.engine.height : 16 / 9;
    const fov = this.engine.camera instanceof PerspectiveCamera ? this.engine.camera.fov : 42;
    const verticalHalfFov = (fov * Math.PI) / 360;
    const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * aspect);
    const boundsRadius = Math.hypot(((columns - 1) * spacing + 1.4) / 2, ((rows - 1) * spacing + 1.4) / 2) + 1.2;
    const distance = Math.max(4.2, boundsRadius / Math.sin(Math.min(verticalHalfFov, horizontalHalfFov)) * 0.72);
    this.cameraTarget.set([0, 0.96, 0]);
    this.cameraPosition.set([0, 0.96 + distance * 0.22, distance * Math.sqrt(1 - 0.22 * 0.22)]);
    this.performanceSetupCpuMs = performance.now() - startedAt;
  }

  private createPerformanceActor(index: number, preset: typeof ALL_CAPSULE_CHARACTER_PRESETS[number], gait: CharacterStudioTestSettings['gait']): Group {
    const actor = new CapsuleCharacterActor({ dna: preset, autoBlink: true });
    actor.root.name = `character-studio-performance-human-${index + 1}`;
    actor.setLocomotion(gait === 'idle' ? 'idle' : 'walk');
    actor.facialController.setExpression('happy', 1, 0);
    this.engine.scene.add(actor.root);
    this.performanceActors.push(actor);
    return actor.root;
  }

  private clearPerformanceScenario(): void {
    this.performanceWindowActive = false;
    for (const actor of this.performanceActors) {
      this.engine.scene.remove(actor.root);
      actor.dispose();
    }
    this.performanceActors.length = 0;
    this.performancePlacements.length = 0;
    this.contributions.human.root.position.set(0, 0, 0);
    this.pedestal.visible = true;
    this.performancePopulation = undefined;
    this.performanceMotion = undefined;
    this.performanceElapsedSeconds = 0;
    this.performanceSetupCpuMs = 0;
  }

  onTestProgress(progress: TestProgress | null): void {
    if (progress && !this.runnerBusy() && this.experimentalHeadSelected()) this.stopSpeechPreview();
    this.runnerBusy.set(progress !== null);
    this.activeTestScenario.set(progress?.label ?? null);
  }

  private updateTestRunnerReadiness(): void {
    if (this.runnerReady()) return;
    const canvas = this.engine.canvas;
    if (!canvas.isConnected) return;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 1 || bounds.height <= 1 ||
        Math.abs(this.engine.width - bounds.width) > 1 || Math.abs(this.engine.height - bounds.height) > 1) return;
    const camera = this.engine.camera;
    if (camera instanceof PerspectiveCamera && Math.abs(camera.aspect - bounds.width / bounds.height) > 0.01) return;
    this.runnerReady.set(true);
  }
}
