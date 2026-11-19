import { MathUtils } from 'three';
import {
  createFlatGroundSampler,
  REST_CAPSULE_HUMAN_POSE,
  ZERO_EULER,
  ZERO_VEC3,
  type CapsuleHumanPose,
  type LocomotionCommand,
  type LocomotionPlugin,
  type LocomotionStateSnapshot,
  type LocomotionStepResult,
  type RigMeasurements,
  type Vec3Like,
} from './capsule-motion-types';

const BASELINE_WALK_SPEED = 1.15;
const BASELINE_STEP_DISTANCE = 0.34;
const BASELINE_MIN_WALK_DISTANCE = 0.04;
const PITCH_SCALE = 0.29 / 0.1925;

/**
 * Baseline distance-rail walker extracted from the original `pigtail-sandbox-walker.ts`
 * so the race has an exact reference point alongside new motion strategies.
 */
export function createBaselineLocomotionPlugin(): LocomotionPlugin {
  let origin: Vec3Like = { ...ZERO_VEC3 };
  let destination: Vec3Like = { ...ZERO_VEC3 };
  let nextDestination: Vec3Like | undefined;
  let lastQueuedTarget: Vec3Like | undefined;
  let yaw = 0;
  let elapsed = 0;
  let length = 0;
  let stepCount = 0;
  let duration = 0;
  let ramp = 0;

  function beginWalk(start: Vec3Like, target: Vec3Like, command: LocomotionCommand): boolean {
    const distance = Math.hypot(target.x - start.x, target.z - start.z);
    if (distance < BASELINE_MIN_WALK_DISTANCE) return false;
    const speed = Math.min(BASELINE_WALK_SPEED, command.maxSpeed);
    const groundY = command.sampleGround(target.x, target.z).y;
    origin = { ...start };
    destination = { x: target.x, y: groundY, z: target.z };
    yaw = Math.atan2(destination.x - origin.x, destination.z - origin.z);
    length = distance;
    stepCount = Math.max(2, Math.ceil(distance / BASELINE_STEP_DISTANCE));
    ramp = Math.min(0.19, distance / speed);
    duration = distance / speed + ramp;
    elapsed = 0;
    return true;
  }

  function reset(state: LocomotionStateSnapshot): void {
    origin = { ...state.position };
    destination = { ...state.position };
    nextDestination = undefined;
    lastQueuedTarget = undefined;
    yaw = state.yaw;
    elapsed = 0;
    length = 0;
    stepCount = 0;
    duration = 0;
    ramp = 0;
  }

  function update(
    dt: number,
    command: LocomotionCommand,
    state: LocomotionStateSnapshot,
    _rig: RigMeasurements,
  ): LocomotionStepResult {
    const sampleGround = command.sampleGround ?? createFlatGroundSampler();

    if (length === 0) {
      if (command.target) {
        const started = beginWalk(state.position, command.target, command);
        if (!started) {
          return {
            position: state.position,
            yaw: state.yaw,
            pose: REST_CAPSULE_HUMAN_POSE,
            moving: false,
          };
        }
        lastQueuedTarget = { ...command.target };
      } else {
        return {
          position: state.position,
          yaw: state.yaw,
          pose: REST_CAPSULE_HUMAN_POSE,
          moving: false,
        };
      }
    } else if (command.target) {
      const differsFromCurrent =
        Math.hypot(command.target.x - destination.x, command.target.z - destination.z) > 0.01;
      const differsFromLast =
        !lastQueuedTarget ||
        Math.hypot(command.target.x - lastQueuedTarget.x, command.target.z - lastQueuedTarget.z) > 0.01;
      if (differsFromCurrent && differsFromLast) {
        nextDestination = { ...command.target };
        lastQueuedTarget = { ...command.target };
      }
    }

    if (dt <= 0) {
      return {
        position: state.position,
        yaw,
        pose: REST_CAPSULE_HUMAN_POSE,
        moving: length > 0,
      };
    }

    const speed = Math.min(BASELINE_WALK_SPEED, command.maxSpeed);
    elapsed = Math.min(elapsed + dt, duration);
    if (elapsed === duration) {
      const endGroundY = sampleGround(destination.x, destination.z).y;
      const landedPos: Vec3Like = { x: destination.x, y: endGroundY, z: destination.z };
      const landedYaw = yaw;
      length = 0;
      const next = nextDestination;
      nextDestination = undefined;
      let queued = false;
      if (next) {
        queued = beginWalk(landedPos, next, command);
      }
      return {
        position: landedPos,
        yaw: landedYaw,
        pose: REST_CAPSULE_HUMAN_POSE,
        moving: queued,
      };
    }

    const remaining = duration - elapsed;
    const distance =
      elapsed < ramp
        ? (speed * elapsed ** 2) / (2 * ramp)
        : remaining < ramp
          ? length - (speed * remaining ** 2) / (2 * ramp)
          : speed * (elapsed - ramp * 0.5);
    const t = distance / length;
    const posX = MathUtils.lerp(origin.x, destination.x, t);
    const posZ = MathUtils.lerp(origin.z, destination.z, t);
    const posY = sampleGround(posX, posZ).y;

    const stride = length / stepCount;
    const step = Math.floor(distance / stride);
    const progress = distance / stride - step;
    const movingLeft = step % 2 === 0;
    const contact = (index: number) => {
      if (index < 0) return 0;
      return index >= stepCount - 2 ? length : (index + 1.5) * stride;
    };
    const planted = { forward: contact(step - 1) - distance, lift: 0 };
    const arc = Math.sin(progress * Math.PI);
    const swing = {
      forward:
        MathUtils.lerp(contact(step - 2), contact(step), MathUtils.smoothstep(progress, 0, 1)) -
        distance,
      lift: arc ** 2 * stride * 0.32,
    };

    const leftFoot = movingLeft ? swing : planted;
    const rightFoot = movingLeft ? planted : swing;
    const leftWristZ = -leftFoot.forward * 0.9;
    const rightWristZ = -rightFoot.forward * 0.9;

    const pose: CapsuleHumanPose = {
      torsoOffset: {
        x: arc ** 2 * stride * (movingLeft ? 0.032 : -0.032),
        y: arc ** 2 * stride * 0.064,
        z: 0,
      },
      torsoRotation: ZERO_EULER,
      headOffset: ZERO_VEC3,
      headRotation: ZERO_EULER,
      leftFoot: {
        offset: { x: 0, y: leftFoot.lift, z: leftFoot.forward },
        rotation: ZERO_EULER,
      },
      rightFoot: {
        offset: { x: 0, y: rightFoot.lift, z: rightFoot.forward },
        rotation: ZERO_EULER,
      },
      leftHand: {
        offset: { x: 0, y: Math.abs(leftFoot.forward) * 0.12, z: leftWristZ },
        rotation: { pitch: -leftWristZ * PITCH_SCALE, yaw: 0, roll: 0 },
        elbowBend: { x: 0, y: 0, z: leftWristZ * 0.12 },
      },
      rightHand: {
        offset: { x: 0, y: Math.abs(rightFoot.forward) * 0.12, z: rightWristZ },
        rotation: { pitch: -rightWristZ * PITCH_SCALE, yaw: 0, roll: 0 },
        elbowBend: { x: 0, y: 0, z: rightWristZ * 0.12 },
      },
      restBlend: 0,
    };

    return {
      position: { x: posX, y: posY, z: posZ },
      yaw,
      pose,
      moving: true,
    };
  }

  return {
    id: 'baseline-distance',
    label: 'Baseline',
    approach: 'Current · Distance rail',
    summary: 'Original distance-driven walk with snap turns and queued redirects.',
    reset,
    update,
  };
}
