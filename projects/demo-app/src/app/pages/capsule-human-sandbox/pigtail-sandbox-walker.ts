import { Box3, MathUtils, Mesh, Vector3 } from 'three';
import { FacialAnimationController } from 'triangular-engine/characters';
import type { CapsuleSpacesuitPreset } from '../character-studio/capsule-spacesuit-presets';
import { buildExperimentalPigtailBody } from '../character-studio/experimental-pigtail-body';
import { buildExperimentalPigtailHead } from '../character-studio/experimental-pigtail-head';
import {
  blendCapsuleHumanPoses,
  createFlatGroundSampler,
  EARTH_GRAVITY_MPS2,
  REST_CAPSULE_HUMAN_POSE,
  smoothstep01,
  type CapsuleHumanPose,
  type GroundSampler,
  type LocomotionPlugin,
  type Vec3Like,
} from './motion/capsule-motion-types';
import {
  createDefaultLocomotionPlugins,
  resolveLocomotionPlugin,
} from './motion/locomotion-registry';

const DEFAULT_MAX_SPEED = 1.4;
const MIN_WALK_DISTANCE = 0.04;
const PLUGIN_CROSSFADE_SECONDS = 0.15;

export interface PigtailWalkerOptions {
  readonly preset?: CapsuleSpacesuitPreset;
  readonly plugin?: LocomotionPlugin;
  readonly sampleGround?: GroundSampler;
  readonly maxSpeed?: number;
  readonly gait?: 'walk' | 'run';
  readonly gravity?: number;
}

export interface WalkMetrics {
  readonly maxFootSlipMm: number;
  readonly minSoleY: number;
  readonly maxFootLiftM: number;
  readonly maxAirHeightM: number;
  readonly airborneSeconds: number;
  readonly peakSpeedMps: number;
  readonly elapsedSeconds: number;
  readonly stepCount: number;
}

export interface CourseStageInfo {
  readonly leg: number;
  readonly total: number;
  readonly label: string;
}

const COURSE_LEG_1 = new Vector3(2.2, 0, -1.2);
const COURSE_LEG_2 = new Vector3(-1.6, 0, -1.7);
const COURSE_LEG_3 = new Vector3(0.0, 0, 0.35);

export function buildPigtailSandboxWalker(options: PigtailWalkerOptions = {}) {
  const body = buildExperimentalPigtailBody(options.preset);
  const facialController = new FacialAnimationController({ autoBlink: true });
  const head = buildExperimentalPigtailHead(facialController, undefined, true, options.preset);
  if (options.preset === 'shaggy') {
    facialController.setFaceChannel('mouth.smile', .65, 0);
    facialController.setFaceChannel('mouth.widen', .35, 0);
    facialController.setFaceChannel('mouth.jawOpen', .095, 0);
  }
  body.headSocket.add(head.head);

  const root = body.root;
  root.traverse((object) => {
    if (object instanceof Mesh) object.castShadow = true;
  });

  const sampleGround: GroundSampler =
    options.sampleGround ?? createFlatGroundSampler(0);
  const maxSpeed = options.maxSpeed ?? DEFAULT_MAX_SPEED;
  let gait: 'walk' | 'run' = options.gait ?? 'walk';
  let gravity = MathUtils.clamp(options.gravity ?? EARTH_GRAVITY_MPS2, 0.4, 25);

  let activePlugin: LocomotionPlugin =
    options.plugin ??
    resolveLocomotionPlugin(createDefaultLocomotionPlugins());

  const boots = ['left', 'right'].map(
    (side) => root.getObjectByName(`pigtail-boot-${side}`)!,
  );

  let target: Vec3Like | null = null;
  let moving = false;
  let velocity: Vec3Like = { x: 0, y: 0, z: 0 };
  let lastPose: CapsuleHumanPose = REST_CAPSULE_HUMAN_POSE;
  let fadeFromPose: CapsuleHumanPose | undefined;
  let fadeElapsed = 0;

  let courseLeg: 1 | 2 | 3 | null = null;

  // Shared secondary spring for pigtail tufts driven by torso velocity & tilt.
  let prevTorsoX = 0;
  let prevTorsoY = 0;
  let pigtailPitch = 0;
  let pigtailPitchVel = 0;
  let pigtailRoll = 0;
  let pigtailRollVel = 0;

  // Live walk telemetry metrics.
  const tmpBootPos = new Vector3();
  const tmpBox = new Box3();
  let prevBootWorld: [Vector3 | null, Vector3 | null] = [null, null];
  let prevBootGrounded: [boolean, boolean] = [true, true];
  let bootWasLifted: [boolean, boolean] = [false, false];
  let metricsState: WalkMetrics = {
    maxFootSlipMm: 0,
    minSoleY: 0,
    maxFootLiftM: 0,
    maxAirHeightM: 0,
    airborneSeconds: 0,
    peakSpeedMps: 0,
    elapsedSeconds: 0,
    stepCount: 0,
  };

  function resetMetrics(): void {
    prevBootWorld = [null, null];
    prevBootGrounded = [true, true];
    bootWasLifted = [false, false];
    metricsState = {
      maxFootSlipMm: 0,
      minSoleY: 0,
      maxFootLiftM: 0,
      maxAirHeightM: 0,
      airborneSeconds: 0,
      peakSpeedMps: 0,
      elapsedSeconds: 0,
      stepCount: 0,
    };
  }

  function snapshotState() {
    return {
      position: {
        x: root.position.x,
        y: root.position.y,
        z: root.position.z,
      },
      yaw: root.rotation.y,
      velocity,
    };
  }

  activePlugin.reset(snapshotState(), body.measurements);

  function resetTo(position: Vec3Like, yaw = 0): void {
    const groundY = sampleGround(position.x, position.z).y;
    root.position.set(position.x, groundY, position.z);
    root.rotation.set(0, yaw, 0);
    velocity = { x: 0, y: 0, z: 0 };
    target = null;
    moving = false;
    courseLeg = null;
    fadeFromPose = undefined;
    lastPose = REST_CAPSULE_HUMAN_POSE;
    body.setPose(REST_CAPSULE_HUMAN_POSE);
    pigtailPitch = 0;
    pigtailPitchVel = 0;
    pigtailRoll = 0;
    pigtailRollVel = 0;
    prevTorsoX = 0;
    prevTorsoY = 0;
    head.setPigtailLag(0, 0);
    activePlugin.reset(snapshotState(), body.measurements);
    resetMetrics();
    root.updateMatrixWorld(true);
  }

  function setPlugin(nextPlugin: LocomotionPlugin): void {
    if (nextPlugin.id === activePlugin.id) return;
    fadeFromPose = lastPose;
    fadeElapsed = 0;
    activePlugin = nextPlugin;
    activePlugin.reset(snapshotState(), body.measurements);
  }

  function walkTo(destination: Vector3): boolean {
    const distance = Math.hypot(
      destination.x - root.position.x,
      destination.z - root.position.z,
    );
    if (distance < MIN_WALK_DISTANCE && !moving) return false;
    if (!moving) resetMetrics();
    courseLeg = null;
    const groundY = sampleGround(destination.x, destination.z).y;
    target = { x: destination.x, y: groundY, z: destination.z };
    moving = true;
    return true;
  }

  function startComparisonCourse(): void {
    const startY = sampleGround(0, 0).y;
    resetTo({ x: 0, y: startY, z: 0 }, 0);
    courseLeg = 1;
    const leg1Y = sampleGround(COURSE_LEG_1.x, COURSE_LEG_1.z).y;
    target = { x: COURSE_LEG_1.x, y: leg1Y, z: COURSE_LEG_1.z };
    moving = true;
  }

  function updateComparisonCourseProgress(): void {
    if (courseLeg === 1) {
      const dist = Math.hypot(
        COURSE_LEG_1.x - root.position.x,
        COURSE_LEG_1.z - root.position.z,
      );
      if (dist < 0.9) {
        courseLeg = 2;
        const leg2Y = sampleGround(COURSE_LEG_2.x, COURSE_LEG_2.z).y;
        target = { x: COURSE_LEG_2.x, y: leg2Y, z: COURSE_LEG_2.z };
      }
    } else if (courseLeg === 2) {
      const dist = Math.hypot(
        COURSE_LEG_2.x - root.position.x,
        COURSE_LEG_2.z - root.position.z,
      );
      if (dist < 0.35) {
        courseLeg = 3;
        const leg3Y = sampleGround(COURSE_LEG_3.x, COURSE_LEG_3.z).y;
        target = { x: COURSE_LEG_3.x, y: leg3Y, z: COURSE_LEG_3.z };
      }
    } else if (courseLeg === 3 && !moving) {
      courseLeg = null;
    }
  }

  function updatePigtailSpring(
    dt: number,
    pose: CapsuleHumanPose,
    speed: number,
    rootVelY: number,
    currentGravity: number,
  ): void {
    if (dt <= 0) return;
    const torsoVelX = (pose.torsoOffset.x - prevTorsoX) / dt;
    const totalTorsoVelY = rootVelY + (pose.torsoOffset.y - prevTorsoY) / dt;
    prevTorsoX = pose.torsoOffset.x;
    prevTorsoY = pose.torsoOffset.y;

    const activeWeight = 1 - Math.max(0, Math.min(1, pose.restBlend ?? 0));
    const targetPitch = MathUtils.clamp(
      (-totalTorsoVelY * 0.38 + speed * 0.045) * activeWeight,
      -0.24,
      0.24,
    );
    const targetRoll = MathUtils.clamp(
      (-torsoVelX * 0.45 + pose.torsoRotation.roll * 0.65) * activeWeight,
      -0.24,
      0.24,
    );

    const gScale = Math.sqrt(MathUtils.clamp(currentGravity / EARTH_GRAVITY_MPS2, 0.12, 2.0));
    const k = 120 * gScale;
    const c = 15 * gScale;
    pigtailPitchVel += (k * (targetPitch - pigtailPitch) - c * pigtailPitchVel) * dt;
    pigtailPitch = MathUtils.clamp(pigtailPitch + pigtailPitchVel * dt, -0.26, 0.26);

    pigtailRollVel += (k * (targetRoll - pigtailRoll) - c * pigtailRollVel) * dt;
    pigtailRoll = MathUtils.clamp(pigtailRoll + pigtailRollVel * dt, -0.26, 0.26);

    head.setPigtailLag(pigtailPitch, pigtailRoll);
  }

  function recordWalkMetrics(dt: number, speed: number): void {
    root.updateMatrixWorld(true);
    let maxSlipMm = metricsState.maxFootSlipMm;
    let minSoleY = metricsState.minSoleY;
    let maxLiftM = metricsState.maxFootLiftM;
    let stepCount = metricsState.stepCount;
    const bootSoleHeights: [number, number] = [0, 0];

    boots.forEach((boot, index) => {
      boot.getWorldPosition(tmpBootPos);
      const localGroundY = sampleGround(tmpBootPos.x, tmpBootPos.z).y;
      const height = tmpBootPos.y - localGroundY;
      maxLiftM = Math.max(maxLiftM, height);

      const soleMin = tmpBox.setFromObject(boot, true).min.y - localGroundY;
      bootSoleHeights[index] = soleMin;
      minSoleY = Math.min(minSoleY, soleMin);

      if (height > 0.022) {
        bootWasLifted[index] = true;
      } else if (bootWasLifted[index] && height < 0.006) {
        bootWasLifted[index] = false;
        stepCount++;
      }

      const grounded = height < 1e-4;
      const prev = prevBootWorld[index];
      if (prev && grounded && prevBootGrounded[index]) {
        const slipMm = Math.hypot(tmpBootPos.x - prev.x, tmpBootPos.z - prev.z) * 1000;
        if (slipMm > maxSlipMm) maxSlipMm = slipMm;
      }
      if (!prev) {
        prevBootWorld[index] = tmpBootPos.clone();
      } else {
        prev.copy(tmpBootPos);
      }
      prevBootGrounded[index] = grounded;
    });

    const minBootSoleClearance = Math.min(bootSoleHeights[0], bootSoleHeights[1]);
    const maxAirHeightM = Math.max(
      metricsState.maxAirHeightM,
      Math.max(0, minBootSoleClearance),
    );
    const airborneSeconds =
      metricsState.airborneSeconds + (minBootSoleClearance > 0.015 ? dt : 0);

    metricsState = {
      maxFootSlipMm: maxSlipMm,
      minSoleY,
      maxFootLiftM: maxLiftM,
      maxAirHeightM,
      airborneSeconds,
      peakSpeedMps: Math.max(metricsState.peakSpeedMps, speed),
      elapsedSeconds: metricsState.elapsedSeconds + dt,
      stepCount,
    };
  }

  function update(delta: number): void {
    head.update(delta);
    if (delta <= 0) return;

    const prevX = root.position.x;
    const prevZ = root.position.z;

    const stepResult = activePlugin.update(
      delta,
      { target, maxSpeed, gait, sampleGround, gravity },
      snapshotState(),
      body.measurements,
    );

    // Harness fairness speed clamp: prevents any plugin from exceeding `maxSpeed`.
    let nextX = stepResult.position.x;
    let nextZ = stepResult.position.z;
    const dx = nextX - prevX;
    const dz = nextZ - prevZ;
    const stepDist = Math.hypot(dx, dz);
    const maxStepDist = maxSpeed * delta + 1e-4;
    if (stepDist > maxStepDist && stepDist > 1e-6) {
      const ratio = maxStepDist / stepDist;
      nextX = prevX + dx * ratio;
      nextZ = prevZ + dz * ratio;
    }
    const clampedGroundY = sampleGround(nextX, nextZ).y;
    const rawNextY = Number.isFinite(stepResult.position.y)
      ? stepResult.position.y
      : clampedGroundY;
    const nextY = stepResult.moving
      ? MathUtils.clamp(rawNextY, clampedGroundY, clampedGroundY + 3.0)
      : clampedGroundY;
    const clampedPos: Vec3Like = { x: nextX, y: nextY, z: nextZ };

    const actualDist = Math.hypot(nextX - prevX, nextZ - prevZ);
    const speed = actualDist / delta;
    const rootVelY = (nextY - root.position.y) / delta;
    velocity = {
      x: (nextX - prevX) / delta,
      y: rootVelY,
      z: (nextZ - prevZ) / delta,
    };

    root.position.set(clampedPos.x, clampedPos.y, clampedPos.z);
    root.rotation.y = stepResult.yaw;

    let finalPose = stepResult.pose;
    if (fadeFromPose) {
      fadeElapsed += delta;
      if (fadeElapsed >= PLUGIN_CROSSFADE_SECONDS) {
        fadeFromPose = undefined;
      } else {
        finalPose = blendCapsuleHumanPoses(
          fadeFromPose,
          stepResult.pose,
          smoothstep01(fadeElapsed / PLUGIN_CROSSFADE_SECONDS),
          'full-body',
        );
      }
    }

    lastPose = finalPose;
    body.setPose(finalPose);
    updatePigtailSpring(delta, finalPose, speed, rootVelY, gravity);

    moving = stepResult.moving;
    if (!moving) {
      target = null;
      velocity = { x: 0, y: 0, z: 0 };
      prevBootWorld = [null, null];
    } else {
      recordWalkMetrics(delta, speed);
    }

    updateComparisonCourseProgress();
  }

  return {
    root,
    facialController,
    measurements: body.measurements,
    leftPropSocket: body.leftPropSocket,
    rightPropSocket: body.rightPropSocket,
    update,
    walkTo,
    resetTo,
    setPlugin,
    setGait(nextGait: 'walk' | 'run') {
      gait = nextGait;
    },
    setGravity(nextGravity: number) {
      gravity = MathUtils.clamp(nextGravity, 0.4, 25);
    },
    get gravity(): number {
      return gravity;
    },
    startComparisonCourse,
    get plugin(): LocomotionPlugin {
      return activePlugin;
    },
    get walking(): boolean {
      return moving;
    },
    get metrics(): WalkMetrics {
      return metricsState;
    },
    get courseStage(): CourseStageInfo | null {
      if (courseLeg === null) return null;
      const labels = {
        1: 'Straight 2.5m',
        2: 'Mid-walk 125° turn',
        3: 'Return & settle',
      } as const;
      return { leg: courseLeg, total: 3, label: labels[courseLeg] };
    },
    dispose() {
      head.dispose();
      body.dispose();
    },
  };
}
