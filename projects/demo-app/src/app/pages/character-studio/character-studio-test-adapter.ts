import {
  createTestMediaRecorderCapture,
  modeActionMs,
  type TestCheck,
  type TestContext,
  type TestMetric,
  type TestObservation,
  type TestRecordingCapture,
  type TestRunAdapter,
  type TestScenario,
  type TestSetting,
} from 'triangular-engine/testing';
import type { CharacterStudioTestSettings } from './character-studio-tests';
import type { ResolvedFocusFraming } from './character-studio-focus';

/**
 * Host interface providing the testing harness direct control and inspection
 * of the Character Studio page.
 */
export interface CharacterStudioTestHost {
  snapshot(): CharacterStudioTestSnapshot;
  restore(snapshot: CharacterStudioTestSnapshot): void;
  read(): CharacterStudioTestSettings;
  apply(settings: CharacterStudioTestSettings): void;
  renderedFrames(): number;
  errors(): string;
  resetErrors(): void;
  onRenderComplete(callback: (renderedAt: number) => void): () => void;
  speak(text: string): void;
  isSpeaking(): boolean;
  setTurntableAngle(radians: number | undefined): void;
  setCameraOrbit(azimuthRadians: number, elevationRadians: number): void;
  recording(): TestRecordingCapture;
  environment(): Readonly<Record<string, TestSetting>>;
  thumbnail?(settings: CharacterStudioTestSettings): Promise<Blob | undefined>;
  resolveFocusFraming?(settings: CharacterStudioTestSettings): ResolvedFocusFraming | undefined;
}

export interface CharacterStudioTestSnapshot {
  readonly settings: CharacterStudioTestSettings;
  readonly cameraPosition: readonly [number, number, number];
  readonly cameraTarget: readonly [number, number, number];
  readonly humanActorYaw: number;
  readonly catActorYaw: number;
  /** Optional studio-only presentation state captured by another host using this adapter. */
  readonly studioView?: string;
  readonly autoRotate?: boolean;
}

const RECORDING_WIDTH = 960;
const RECORDING_HEIGHT = 540;
const RECORDING_FPS = 20;
const RECORDING_VIDEO_BITRATE = 450_000;
const CAMERA_ORBIT_STEP_MS = 16;
const CAMERA_ORBIT_HORIZONTAL_SHARE = 0.5;
const CAMERA_ORBIT_FULL_TURN_RADIANS = Math.PI * 2;
const CAMERA_ORBIT_ANGLE_TOLERANCE_RADIANS = 0.08;
const CAMERA_ORBIT_LOW_ELEVATION_RADIANS = -0.12;
const CAMERA_ORBIT_HIGH_ELEVATION_RADIANS = 0.9;

const SETTLE_FRAMES = 3;
const TIMER_STEP_MS = 0.1;

export function settingsMismatches(
  actual: CharacterStudioTestSettings,
  expected: CharacterStudioTestSettings,
): string[] {
  const out: string[] = [];
  if (actual.characterType !== expected.characterType) {
    out.push(`characterType: expected ${expected.characterType}, found ${actual.characterType}`);
  }
  if (actual.presetId !== expected.presetId) {
    out.push(`presetId: expected ${expected.presetId}, found ${actual.presetId}`);
  }
  if (actual.emotion !== expected.emotion) {
    out.push(`emotion: expected ${expected.emotion}, found ${actual.emotion}`);
  }
  if (actual.gait !== expected.gait) {
    out.push(`gait: expected ${expected.gait}, found ${actual.gait}`);
  }
  if (actual.cameraFraming !== expected.cameraFraming) {
    out.push(`cameraFraming: expected ${expected.cameraFraming}, found ${actual.cameraFraming}`);
  }
  if (actual.layout !== expected.layout) {
    out.push(`layout: expected ${expected.layout}, found ${actual.layout}`);
  }
  return out;
}

/**
 * Create an aspect-preserving, bounded recording of the Character Studio canvas.
 *
 * PURPOSE: Supplies the opt-in test runner with a stable-size recording stream for either capsule character.
 * VALUE: Saved diagnostic clips remain small and do not stretch the source canvas.
 */
export function createCharacterStudioRecordingCapture(source: HTMLCanvasElement): TestRecordingCapture {
  if (!source.width || !source.height) throw new Error('The Character Studio canvas has no rendered frames');
  const scaled = document.createElement('canvas');
  scaled.width = RECORDING_WIDTH;
  scaled.height = RECORDING_HEIGHT;
  const paint = scaled.getContext('2d');
  if (!paint) throw new Error('Could not create the bounded recording canvas');

  let released = false;
  let frame = 0;
  let lastFrameAt = -Infinity;
  const draw = (now: number) => {
    if (released) return;
    if (now - lastFrameAt >= 1000 / RECORDING_FPS) {
      const scale = Math.min(RECORDING_WIDTH / source.width, RECORDING_HEIGHT / source.height);
      const width = source.width * scale;
      const height = source.height * scale;
      paint.fillStyle = '#0a0c16';
      paint.fillRect(0, 0, RECORDING_WIDTH, RECORDING_HEIGHT);
      paint.drawImage(source, (RECORDING_WIDTH - width) / 2, (RECORDING_HEIGHT - height) / 2, width, height);
      lastFrameAt = now;
    }
  };

  draw(performance.now());
  const stream = scaled.captureStream(RECORDING_FPS);
  let recorder: TestRecordingCapture;
  try {
    recorder = createTestMediaRecorderCapture(stream, {
      width: RECORDING_WIDTH,
      height: RECORDING_HEIGHT,
      videoBitsPerSecond: RECORDING_VIDEO_BITRATE,
    });
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    scaled.width = 0;
    scaled.height = 0;
    throw error;
  }

  const tick = (now: number) => {
    if (released) return;
    draw(now);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return {
    stop: () => recorder.stop(),
    dispose: () => {
      if (released) return;
      released = true;
      cancelAnimationFrame(frame);
      recorder.dispose();
      scaled.width = 0;
      scaled.height = 0;
    },
  };
}

/**
 * Creates the TestRunAdapter connecting triangular-engine/testing runner to Character Studio.
 */
export function createCharacterStudioTestAdapter(
  host: CharacterStudioTestHost,
): TestRunAdapter<CharacterStudioTestSettings, CharacterStudioTestSnapshot> {
  async function waitSettled(
    context: TestContext,
    scenario: TestScenario<CharacterStudioTestSettings>,
  ): Promise<void> {
    const startFrames = host.renderedFrames();
    while (host.renderedFrames() - startFrames < SETTLE_FRAMES) {
      context.signal.throwIfAborted();
      await context.wait(16);
    }
  }

  async function runTurntable(
    scenario: TestScenario<CharacterStudioTestSettings>,
    context: TestContext,
  ): Promise<number> {
    const durationMs = modeActionMs(scenario, context.mode);
    const began = performance.now();
    host.setTurntableAngle(0);
    while (true) {
      const elapsed = performance.now() - began;
      const t = Math.min(elapsed, durationMs) / durationMs;
      host.setTurntableAngle(t * Math.PI * 2);
      if (elapsed >= durationMs) return elapsed / 1000;
      await context.wait(16);
    }
  }

  interface CameraOrbitResult {
    readonly horizontalRadians: number;
    readonly minimumElevationRadians: number;
    readonly maximumElevationRadians: number;
  }

  async function runCameraOrbit(
    scenario: TestScenario<CharacterStudioTestSettings>,
    context: TestContext,
  ): Promise<CameraOrbitResult> {
    const durationMs = modeActionMs(scenario, context.mode);
    const stepCount = Math.max(4, Math.ceil(durationMs / CAMERA_ORBIT_STEP_MS));
    const horizontalSteps = Math.ceil(stepCount * CAMERA_ORBIT_HORIZONTAL_SHARE);
    const verticalSteps = stepCount - horizontalSteps;
    const waitMs = durationMs / stepCount;
    let minimumElevationRadians = Number.POSITIVE_INFINITY;
    let maximumElevationRadians = Number.NEGATIVE_INFINITY;
    for (let step = 0; step <= horizontalSteps; step++) {
      context.signal.throwIfAborted();
      const progress = step / horizontalSteps;
      host.setCameraOrbit(progress * CAMERA_ORBIT_FULL_TURN_RADIANS, CAMERA_ORBIT_LOW_ELEVATION_RADIANS);
      minimumElevationRadians = Math.min(minimumElevationRadians, CAMERA_ORBIT_LOW_ELEVATION_RADIANS);
      maximumElevationRadians = Math.max(maximumElevationRadians, CAMERA_ORBIT_LOW_ELEVATION_RADIANS);
      if (step < horizontalSteps) await context.wait(waitMs);
    }
    for (let step = 0; step <= verticalSteps; step++) {
      context.signal.throwIfAborted();
      const progress = step / verticalSteps;
      const arc = Math.sin(progress * Math.PI);
      const elevationRadians = CAMERA_ORBIT_LOW_ELEVATION_RADIANS +
        (CAMERA_ORBIT_HIGH_ELEVATION_RADIANS - CAMERA_ORBIT_LOW_ELEVATION_RADIANS) * arc;
      host.setCameraOrbit(0, elevationRadians);
      minimumElevationRadians = Math.min(minimumElevationRadians, elevationRadians);
      maximumElevationRadians = Math.max(maximumElevationRadians, elevationRadians);
      if (step < verticalSteps) await context.wait(waitMs);
    }
    return {
      horizontalRadians: CAMERA_ORBIT_FULL_TURN_RADIANS,
      minimumElevationRadians,
      maximumElevationRadians,
    };
  }

  return {
    windowModes: true,
    capture: () => host.snapshot(),
    restore: (snapshot) => {
      host.resetErrors();
      host.restore(snapshot);
    },
    apply: (scenario) => {
      host.resetErrors();
      host.apply(scenario.settings);
    },
    ready: (context, scenario) => waitSettled(context, scenario),
    measure: async (scenario, context): Promise<TestObservation> => {
      const settings = scenario.settings;
      const intervals: number[] = [];
      let frames = 0;
      let previousAt: number | undefined;
      let orbitResult: CameraOrbitResult | undefined;

      const offRender = host.onRenderComplete((renderedAt) => {
        frames++;
        if (previousAt !== undefined) {
          intervals.push(renderedAt - previousAt);
        }
        previousAt = renderedAt;
      });

      if (settings.speak && settings.speechText) {
        host.speak(settings.speechText);
      }

      try {
        if (settings.motion === 'turntable') {
          await runTurntable(scenario, context);
        } else if (settings.motion === 'camera-orbit') {
          orbitResult = await runCameraOrbit(scenario, context);
        } else {
          await context.measureWindow(scenario);
        }
      } finally {
        offRender();
        if (settings.motion === 'turntable') {
          host.setTurntableAngle(undefined);
        }
      }

      const checks: TestCheck[] = [];
      const mismatches = settingsMismatches(host.read(), settings);
      checks.push({
        name: 'Scenario state applied',
        passed: mismatches.length === 0,
        detail: mismatches.length === 0 ? 'Applied all settings' : mismatches.join('; '),
      });

      const err = host.errors();
      checks.push({
        name: 'No uncaught render errors',
        passed: !err,
        detail: err || undefined,
      });

      checks.push({
        name: 'Rendered frames during measurement',
        passed: frames >= 1,
        detail: `${frames} frames rendered`,
      });
      if (orbitResult) {
        const elevationRange = orbitResult.maximumElevationRadians - orbitResult.minimumElevationRadians;
        checks.push({
          name: 'Horizontal and vertical camera path completed',
          passed: orbitResult.horizontalRadians >= CAMERA_ORBIT_FULL_TURN_RADIANS - CAMERA_ORBIT_ANGLE_TOLERANCE_RADIANS &&
            elevationRange >= CAMERA_ORBIT_HIGH_ELEVATION_RADIANS - CAMERA_ORBIT_LOW_ELEVATION_RADIANS - 0.08,
          detail: `azimuth ${orbitResult.horizontalRadians.toFixed(2)} rad; elevation ${orbitResult.minimumElevationRadians.toFixed(2)} to ${orbitResult.maximumElevationRadians.toFixed(2)} rad`,
        });
      }

      const focusFraming =
        settings.focusTarget || settings.cameraFraming === 'face-close-up' || settings.cameraFraming === 'head-close-up'
          ? host.resolveFocusFraming?.(settings)
          : undefined;
      if (focusFraming) {
        checks.push({
          name: 'Focus target framed within viewport',
          passed:
            focusFraming.inFrame &&
            focusFraming.occupancy >= 0.35 &&
            focusFraming.occupancy <= 0.96,
          detail: `${focusFraming.targetId} (${focusFraming.boundsKind}) rect=[${focusFraming.projectedRect.join(', ')}] occupancy=${focusFraming.occupancy}`,
        });
      }

      const metrics: TestMetric[] = [
        {
          name: 'frameInterval',
          unit: 'ms',
          source: 'Inter-frame interval on main render loop (performance.now)',
          samples: intervals,
        },
      ];

      const details: Record<string, TestSetting> = {};
      if (orbitResult) {
        details['cameraPath'] = 'one horizontal turn followed by a vertical elevation sweep';
        details['horizontalRadians'] = orbitResult.horizontalRadians;
        details['minimumElevationRadians'] = orbitResult.minimumElevationRadians;
        details['maximumElevationRadians'] = orbitResult.maximumElevationRadians;
      }
      if (focusFraming) {
        details['focusTarget'] = focusFraming.targetId;
        details['focusBoundsKind'] = focusFraming.boundsKind;
        details['focusCameraPosition'] = focusFraming.cameraPosition.join(',');
        details['focusCameraTarget'] = focusFraming.cameraTarget.join(',');
        details['focusCameraDistance'] = focusFraming.cameraDistance;
        details['focusWorldMin'] = focusFraming.worldMin.join(',');
        details['focusWorldMax'] = focusFraming.worldMax.join(',');
        details['focusProjectedRect'] = focusFraming.projectedRect.join(',');
        if (focusFraming.shaderMouthRect) {
          details['focusShaderMouthRect'] = focusFraming.shaderMouthRect.join(',');
        }
        details['focusInFrame'] = focusFraming.inFrame;
        details['focusOccupancy'] = focusFraming.occupancy;
        if (focusFraming.limitations.length > 0) {
          details['focusLimitations'] = focusFraming.limitations.join(' | ');
        }
      }

      return {
        checks,
        metrics,
        ...(Object.keys(details).length > 0 ? { details } : {}),
      };
    },
    recording: (_scenario, context) => {
      context.signal.throwIfAborted();
      return host.recording();
    },
    thumbnail: async (scenario, context) => {
      const wantsStill =
        scenario.settings.focusTarget !== undefined ||
        scenario.settings.cameraFraming === 'face-close-up' ||
        scenario.settings.cameraFraming === 'head-close-up';
      if (context.repetition > 1 || !host.thumbnail || !wantsStill) return undefined;
      context.signal.throwIfAborted();
      const image = await host.thumbnail(scenario.settings);
      context.signal.throwIfAborted();
      return image ? [image] : undefined;
    },
  };
}
