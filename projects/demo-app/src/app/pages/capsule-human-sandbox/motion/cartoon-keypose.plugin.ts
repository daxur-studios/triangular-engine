import { MathUtils } from 'three';
import {
  clampNumber,
  EARTH_GRAVITY_MPS2,
  footRestWorldPosition,
  footWorldToLocalOffset,
  lerpNumber,
  REST_CAPSULE_HUMAN_POSE,
  smoothstep01,
  wrapAngle,
  ZERO_VEC3,
  type CapsuleHumanPose,
  type FootPose,
  type GroundSampler,
  type LocomotionCommand,
  type LocomotionPlugin,
  type LocomotionStateSnapshot,
  type LocomotionStepResult,
  type RigMeasurements,
  type Vec3Like,
} from './capsule-motion-types';

interface HalfStrideKeyframe {
  readonly t: number;
  readonly torsoY: number;
  readonly swayTowardPlant: number;
  readonly torsoPitch: number;
  readonly torsoRollTowardPlant: number;
  readonly torsoTwistTowardSwing: number;
  readonly swingFootForward: number;
  readonly swingFootLift: number;
  readonly swingFootPitch: number;
  readonly plantFootPitch: number;
  readonly swingArmForward: number;
  readonly headPitch: number;
}

/**
 * Authored 4-beat cartoon walk cycle (`Contact -> Down -> Passing -> Up`) per half-stride.
 * Easy for agents or designers to inspect, tune, or remix without touching world foot-locking.
 */
const CARTOON_WALK_KEYFRAMES: readonly HalfStrideKeyframe[] = [
  {
    t: 0.0, // Contact
    torsoY: 0.004,
    swayTowardPlant: 0.018,
    torsoPitch: 0.095,
    torsoRollTowardPlant: 0.042,
    torsoTwistTowardSwing: 0.135,
    swingFootForward: -0.15,
    swingFootLift: 0.0,
    swingFootPitch: 0.22,
    plantFootPitch: -0.14,
    swingArmForward: 0.16,
    headPitch: 0.01,
  },
  {
    t: 0.18, // Down / Chunky-boot landing recoil
    torsoY: -0.036,
    swayTowardPlant: 0.036,
    torsoPitch: 0.11,
    torsoRollTowardPlant: 0.088,
    torsoTwistTowardSwing: 0.1,
    swingFootForward: -0.09,
    swingFootLift: 0.038,
    swingFootPitch: 0.16,
    plantFootPitch: 0.0,
    swingArmForward: 0.21,
    headPitch: 0.055,
  },
  {
    t: 0.5, // Passing / High boot lift + waddle
    torsoY: 0.012,
    swayTowardPlant: 0.046,
    torsoPitch: 0.075,
    torsoRollTowardPlant: 0.112,
    torsoTwistTowardSwing: 0.0,
    swingFootForward: 0.02,
    swingFootLift: 0.125,
    swingFootPitch: 0.1,
    plantFootPitch: 0.0,
    swingArmForward: 0.0,
    headPitch: -0.01,
  },
  {
    t: 0.78, // Up / Crest before heel strike
    torsoY: 0.042,
    swayTowardPlant: 0.024,
    torsoPitch: 0.055,
    torsoRollTowardPlant: 0.055,
    torsoTwistTowardSwing: -0.115,
    swingFootForward: 0.15,
    swingFootLift: 0.052,
    swingFootPitch: -0.22,
    plantFootPitch: 0.0,
    swingArmForward: -0.15,
    headPitch: -0.03,
  },
  {
    t: 1.0, // Next Contact (mirrors into opposite half-stride)
    torsoY: 0.004,
    swayTowardPlant: -0.018,
    torsoPitch: 0.095,
    torsoRollTowardPlant: -0.042,
    torsoTwistTowardSwing: -0.135,
    swingFootForward: 0.16,
    swingFootLift: 0.0,
    swingFootPitch: -0.14,
    plantFootPitch: 0.22,
    swingArmForward: -0.16,
    headPitch: 0.01,
  },
];

function sampleKeyframeTable(u: number): HalfStrideKeyframe {
  const clamped = clampNumber(u, 0, 1);
  let i = 0;
  while (i < CARTOON_WALK_KEYFRAMES.length - 2 && clamped > CARTOON_WALK_KEYFRAMES[i + 1].t) {
    i++;
  }
  const a = CARTOON_WALK_KEYFRAMES[i];
  const b = CARTOON_WALK_KEYFRAMES[i + 1];
  const span = Math.max(1e-5, b.t - a.t);
  const s = smoothstep01((clamped - a.t) / span);
  return {
    t: clamped,
    torsoY: lerpNumber(a.torsoY, b.torsoY, s),
    swayTowardPlant: lerpNumber(a.swayTowardPlant, b.swayTowardPlant, s),
    torsoPitch: lerpNumber(a.torsoPitch, b.torsoPitch, s),
    torsoRollTowardPlant: lerpNumber(a.torsoRollTowardPlant, b.torsoRollTowardPlant, s),
    torsoTwistTowardSwing: lerpNumber(a.torsoTwistTowardSwing, b.torsoTwistTowardSwing, s),
    swingFootForward: lerpNumber(a.swingFootForward, b.swingFootForward, s),
    swingFootLift: lerpNumber(a.swingFootLift, b.swingFootLift, s),
    swingFootPitch: lerpNumber(a.swingFootPitch, b.swingFootPitch, s),
    plantFootPitch: lerpNumber(a.plantFootPitch, b.plantFootPitch, s),
    swingArmForward: lerpNumber(a.swingArmForward, b.swingArmForward, s),
    headPitch: lerpNumber(a.headPitch, b.headPitch, s),
  };
}

interface HopKeyframe {
  readonly t: number;
  readonly torsoY: number;
  readonly torsoPitch: number;
  readonly torsoRollTowardLead: number;
  readonly torsoTwistTowardLead: number;
  readonly leadFootLift: number;
  readonly leadFootForward: number;
  readonly leadFootPitch: number;
  readonly trailFootLift: number;
  readonly trailFootForward: number;
  readonly trailFootPitch: number;
  readonly armLift: number;
  readonly armSpread: number;
  readonly armForward: number;
  readonly kneeBendZ: number;
  readonly headPitch: number;
}

const HOP_FLIGHT_START = 0.24;
const HOP_FLIGHT_END = 0.82;
const HOP_FLIGHT_SPAN = HOP_FLIGHT_END - HOP_FLIGHT_START;

/**
 * Authored low-gravity hop curve (`Squash/Load -> Takeoff -> Float Apex -> Reach -> Cushion Land`).
 * Foot linear offsets stay strictly zero outside `(0.24, 0.82)` so grounded boots never slip.
 */
const MOON_HOP_KEYFRAMES: readonly HopKeyframe[] = [
  {
    t: 0.0, // Start load
    torsoY: 0.0,
    torsoPitch: 0.05,
    torsoRollTowardLead: 0.0,
    torsoTwistTowardLead: 0.0,
    leadFootLift: 0.0,
    leadFootForward: 0.0,
    leadFootPitch: 0.0,
    trailFootLift: 0.0,
    trailFootForward: 0.0,
    trailFootPitch: 0.0,
    armLift: 0.0,
    armSpread: 0.01,
    armForward: 0.0,
    kneeBendZ: 0.01,
    headPitch: 0.02,
  },
  {
    t: 0.16, // Deep squash windup
    torsoY: -0.088,
    torsoPitch: 0.18,
    torsoRollTowardLead: -0.02,
    torsoTwistTowardLead: -0.04,
    leadFootLift: 0.0,
    leadFootForward: 0.0,
    leadFootPitch: 0.0,
    trailFootLift: 0.0,
    trailFootForward: 0.0,
    trailFootPitch: 0.0,
    armLift: 0.03,
    armSpread: 0.045,
    armForward: -0.18,
    kneeBendZ: 0.095,
    headPitch: 0.065,
  },
  {
    t: HOP_FLIGHT_START, // Takeoff push-off
    torsoY: 0.024,
    torsoPitch: 0.09,
    torsoRollTowardLead: 0.03,
    torsoTwistTowardLead: 0.06,
    leadFootLift: 0.0,
    leadFootForward: 0.0,
    leadFootPitch: 0.2,
    trailFootLift: 0.0,
    trailFootForward: 0.0,
    trailFootPitch: 0.22,
    armLift: 0.16,
    armSpread: 0.095,
    armForward: 0.13,
    kneeBendZ: 0.01,
    headPitch: -0.02,
  },
  {
    t: 0.53, // Float apex
    torsoY: 0.014,
    torsoPitch: 0.025,
    torsoRollTowardLead: 0.055,
    torsoTwistTowardLead: 0.11,
    leadFootLift: 0.105,
    leadFootForward: 0.135,
    leadFootPitch: -0.17,
    trailFootLift: 0.048,
    trailFootForward: -0.105,
    trailFootPitch: 0.24,
    armLift: 0.22,
    armSpread: 0.175,
    armForward: -0.17,
    kneeBendZ: 0.0,
    headPitch: -0.06,
  },
  {
    t: HOP_FLIGHT_END, // Touchdown contact
    torsoY: -0.012,
    torsoPitch: 0.12,
    torsoRollTowardLead: 0.02,
    torsoTwistTowardLead: 0.04,
    leadFootLift: 0.0,
    leadFootForward: 0.0,
    leadFootPitch: -0.09,
    trailFootLift: 0.0,
    trailFootForward: 0.0,
    trailFootPitch: 0.08,
    armLift: 0.11,
    armSpread: 0.11,
    armForward: -0.08,
    kneeBendZ: 0.035,
    headPitch: 0.02,
  },
  {
    t: 0.91, // Cushion absorb
    torsoY: -0.072,
    torsoPitch: 0.15,
    torsoRollTowardLead: -0.015,
    torsoTwistTowardLead: 0.0,
    leadFootLift: 0.0,
    leadFootForward: 0.0,
    leadFootPitch: 0.0,
    trailFootLift: 0.0,
    trailFootForward: 0.0,
    trailFootPitch: 0.0,
    armLift: 0.04,
    armSpread: 0.05,
    armForward: -0.04,
    kneeBendZ: 0.088,
    headPitch: 0.055,
  },
  {
    t: 1.0, // Rebound recover
    torsoY: 0.0,
    torsoPitch: 0.05,
    torsoRollTowardLead: 0.0,
    torsoTwistTowardLead: 0.0,
    leadFootLift: 0.0,
    leadFootForward: 0.0,
    leadFootPitch: 0.0,
    trailFootLift: 0.0,
    trailFootForward: 0.0,
    trailFootPitch: 0.0,
    armLift: 0.0,
    armSpread: 0.01,
    armForward: 0.0,
    kneeBendZ: 0.01,
    headPitch: 0.02,
  },
];

function sampleHopKeyframeTable(u: number): HopKeyframe {
  const clamped = clampNumber(u, 0, 1);
  let i = 0;
  while (i < MOON_HOP_KEYFRAMES.length - 2 && clamped > MOON_HOP_KEYFRAMES[i + 1].t) {
    i++;
  }
  const a = MOON_HOP_KEYFRAMES[i];
  const b = MOON_HOP_KEYFRAMES[i + 1];
  const span = Math.max(1e-5, b.t - a.t);
  const s = smoothstep01((clamped - a.t) / span);
  return {
    t: clamped,
    torsoY: lerpNumber(a.torsoY, b.torsoY, s),
    torsoPitch: lerpNumber(a.torsoPitch, b.torsoPitch, s),
    torsoRollTowardLead: lerpNumber(a.torsoRollTowardLead, b.torsoRollTowardLead, s),
    torsoTwistTowardLead: lerpNumber(a.torsoTwistTowardLead, b.torsoTwistTowardLead, s),
    leadFootLift: lerpNumber(a.leadFootLift, b.leadFootLift, s),
    leadFootForward: lerpNumber(a.leadFootForward, b.leadFootForward, s),
    leadFootPitch: lerpNumber(a.leadFootPitch, b.leadFootPitch, s),
    trailFootLift: lerpNumber(a.trailFootLift, b.trailFootLift, s),
    trailFootForward: lerpNumber(a.trailFootForward, b.trailFootForward, s),
    trailFootPitch: lerpNumber(a.trailFootPitch, b.trailFootPitch, s),
    armLift: lerpNumber(a.armLift, b.armLift, s),
    armSpread: lerpNumber(a.armSpread, b.armSpread, s),
    armForward: lerpNumber(a.armForward, b.armForward, s),
    kneeBendZ: lerpNumber(a.kneeBendZ, b.kneeBendZ, s),
    headPitch: lerpNumber(a.headPitch, b.headPitch, s),
  };
}

/**
 * Hybrid locomotion: authored 4-keyframe cartoon walk curves for snappy bounce,
 * waddle, and weight, layered with world-space planted-foot locking and `sampleGround`.
 */
export function createCartoonKeyposePlugin(): LocomotionPlugin {
  const STRIDE_LENGTH = 0.42;

  let yaw = 0;
  let velX = 0;
  let velZ = 0;
  let turnRate = 0;
  let cyclePhase = 0; // [0, 1) = left swings & right planted, [1, 2) = right swings & left planted
  let currentStepIndex = 0;

  let plantedWorld: Vec3Like = { ...ZERO_VEC3 };
  let plantedYaw = 0;
  let swingStartWorld: Vec3Like = { ...ZERO_VEC3 };
  let swingStartYaw = 0;
  let swingTargetWorld: Vec3Like = { ...ZERO_VEC3 };

  let activeAmplitude = 0;
  let restBlend = 1;
  let isIdle = true;
  let smoothedHeadYaw = 0;
  let justReset = true;

  // Low-gravity hop mode state (Mars / Moon).
  let inHopMode = false;
  let hopPhase = 0;
  let hopIndex = 0;
  let hopDuration = 1.0;
  let hopApexHeight = 0.25;
  let hopFlightGravity = EARTH_GRAVITY_MPS2;
  let hopStyleScale = 1.0;
  let hopStartPos: Vec3Like = { ...ZERO_VEC3 };
  let hopTargetPos: Vec3Like = { ...ZERO_VEC3 };
  let hopStartYaw = 0;
  let hopEndYaw = 0;
  let hopFlightVelX = 0;
  let hopFlightVelZ = 0;
  let leftFootWorld: Vec3Like = { ...ZERO_VEC3 };
  let rightFootWorld: Vec3Like = { ...ZERO_VEC3 };
  let airStartLeftOffset: Vec3Like = { ...ZERO_VEC3 };
  let airStartRightOffset: Vec3Like = { ...ZERO_VEC3 };
  let hopFlightStarted = false;
  let hopLanded = false;
  let hopRedirected = false;

  function syncFeetAtRest(pos: Vec3Like, currentYaw: number, rig: RigMeasurements): void {
    plantedWorld = footRestWorldPosition(pos, currentYaw, rig.rightFootRestLocal);
    swingStartWorld = footRestWorldPosition(pos, currentYaw, rig.leftFootRestLocal);
    swingTargetWorld = { ...swingStartWorld };
    plantedYaw = currentYaw;
    swingStartYaw = currentYaw;
  }

  function lockBothFeetAtRest(pos: Vec3Like, currentYaw: number, rig: RigMeasurements, sampleGround?: GroundSampler): void {
    const leftRest = footRestWorldPosition(pos, currentYaw, rig.leftFootRestLocal);
    const rightRest = footRestWorldPosition(pos, currentYaw, rig.rightFootRestLocal);
    leftFootWorld = {
      x: leftRest.x,
      y: sampleGround ? sampleGround(leftRest.x, leftRest.z).y : pos.y,
      z: leftRest.z,
    };
    rightFootWorld = {
      x: rightRest.x,
      y: sampleGround ? sampleGround(rightRest.x, rightRest.z).y : pos.y,
      z: rightRest.z,
    };
  }

  function reset(state: LocomotionStateSnapshot, rig: RigMeasurements): void {
    yaw = state.yaw;
    velX = 0;
    velZ = 0;
    turnRate = 0;
    cyclePhase = 0;
    currentStepIndex = 0;
    activeAmplitude = 0;
    restBlend = 1;
    isIdle = true;
    smoothedHeadYaw = 0;
    justReset = true;
    inHopMode = false;
    hopPhase = 0;
    hopIndex = 0;
    hopDuration = 1.0;
    hopApexHeight = 0.25;
    hopFlightGravity = EARTH_GRAVITY_MPS2;
    hopStyleScale = 1.0;
    hopStartPos = { ...state.position };
    hopTargetPos = { ...state.position };
    hopStartYaw = yaw;
    hopEndYaw = yaw;
    hopFlightVelX = 0;
    hopFlightVelZ = 0;
    airStartLeftOffset = { ...ZERO_VEC3 };
    airStartRightOffset = { ...ZERO_VEC3 };
    hopFlightStarted = false;
    hopLanded = false;
    hopRedirected = false;
    syncFeetAtRest(state.position, yaw, rig);
    lockBothFeetAtRest(state.position, yaw, rig);
  }

  function advanceHalfStride(
    nextPos: Vec3Like,
    nextYaw: number,
    speed: number,
    hasTarget: boolean,
    swingRestLocal: Vec3Like,
    sampleGround: GroundSampler,
  ): void {
    // Previous swinging foot has now landed and becomes the new planted foot.
    const landedWorld: Vec3Like = {
      x: swingTargetWorld.x,
      y: sampleGround(swingTargetWorld.x, swingTargetWorld.z).y,
      z: swingTargetWorld.z,
    };
    const oldPlanted = { ...plantedWorld };
    const oldPlantedYaw = plantedYaw;

    plantedWorld = landedWorld;
    plantedYaw = nextYaw;
    swingStartWorld = oldPlanted;
    swingStartYaw = oldPlantedYaw;

    // Predict where the newly swinging foot should land at the end of this half-stride.
    const lookAhead = hasTarget ? clampNumber(speed * 0.24, 0.04, 0.24) : 0;
    const predictedCenter: Vec3Like = {
      x: nextPos.x + Math.sin(nextYaw) * lookAhead,
      y: nextPos.y,
      z: nextPos.z + Math.cos(nextYaw) * lookAhead,
    };
    const ideal = footRestWorldPosition(predictedCenter, nextYaw, swingRestLocal);
    swingTargetWorld = {
      x: ideal.x,
      y: sampleGround(ideal.x, ideal.z).y,
      z: ideal.z,
    };
  }

  function beginNextHop(
    startPos: Vec3Like,
    currentYaw: number,
    g: number,
    moonFactor: number,
    command: LocomotionCommand,
    distToTarget: number,
    rig: RigMeasurements,
  ): void {
    const groundY = command.sampleGround(startPos.x, startPos.z).y;
    hopStartPos = { x: startPos.x, y: groundY, z: startPos.z };
    hopStartYaw = currentYaw;
    hopFlightGravity = g;
    hopStyleScale = lerpNumber(0.62, 1.08, moonFactor);
    hopFlightStarted = false;
    hopLanded = false;
    hopRedirected = false;
    lockBothFeetAtRest(hopStartPos, currentYaw, rig, command.sampleGround);

    const desiredYaw = command.target
      ? Math.atan2(command.target.x - startPos.x, command.target.z - startPos.z)
      : currentYaw;
    const yawDiff = wrapAngle(desiredYaw - currentYaw);
    hopEndYaw = wrapAngle(currentYaw + clampNumber(yawDiff, -1.65, 1.65));

    const baseApex = lerpNumber(0.058, 0.265, moonFactor);
    const shortScale = clampNumber(Math.sqrt(distToTarget / 1.0), 0.42, 1.0);
    hopApexHeight = baseApex * shortScale;

    const flightDur = Math.sqrt((8 * hopApexHeight) / g);
    hopDuration = clampNumber(flightDur / HOP_FLIGHT_SPAN, 0.42, 1.65);
    const actualFlightDur = hopDuration * HOP_FLIGHT_SPAN;

    const maxHopSpeed = Math.min(
      command.maxSpeed * 0.88,
      command.gait === 'run' ? command.maxSpeed : 1.24,
    );
    const alignScale = Math.max(0.28, Math.cos(yawDiff * 0.6));
    const maxStepDist = maxHopSpeed * alignScale * actualFlightDur;
    const stepDist = Math.min(distToTarget, maxStepDist);

    if (command.target && stepDist >= distToTarget - 0.015 && Math.abs(yawDiff) <= 1.65) {
      hopTargetPos = {
        x: command.target.x,
        y: command.sampleGround(command.target.x, command.target.z).y,
        z: command.target.z,
      };
    } else {
      const tx = startPos.x + Math.sin(hopEndYaw) * stepDist;
      const tz = startPos.z + Math.cos(hopEndYaw) * stepDist;
      hopTargetPos = {
        x: tx,
        y: command.sampleGround(tx, tz).y,
        z: tz,
      };
    }

    hopFlightVelX = (hopTargetPos.x - hopStartPos.x) / actualFlightDur;
    hopFlightVelZ = (hopTargetPos.z - hopStartPos.z) / actualFlightDur;
  }

  function updateLowGravityHop(
    safeDt: number,
    g: number,
    wantsHopMode: boolean,
    moonFactor: number,
    command: LocomotionCommand,
    state: LocomotionStateSnapshot,
    rig: RigMeasurements,
  ): LocomotionStepResult {
    const distToTarget = command.target
      ? Math.hypot(command.target.x - state.position.x, command.target.z - state.position.z)
      : 0;
    const hasTarget = distToTarget > 0.022;

    if (hopPhase === 0 && !hopFlightStarted) {
      if (!wantsHopMode || !hasTarget) {
        inHopMode = false;
        syncFeetAtRest(state.position, yaw, rig);
        return {
          position: {
            x: state.position.x,
            y: command.sampleGround(state.position.x, state.position.z).y,
            z: state.position.z,
          },
          yaw,
          pose: REST_CAPSULE_HUMAN_POSE,
          moving: false,
        };
      }
      beginNextHop(state.position, yaw, g, moonFactor, command, distToTarget, rig);
    }

    // Speed up completion slightly if Earth gravity is turned back on mid-hop.
    const hopDtScale = wantsHopMode
      ? 1
      : clampNumber(Math.sqrt(g / Math.max(0.4, hopFlightGravity)), 1.0, 2.3);
    const prevPhase = hopPhase;
    hopPhase += (safeDt * hopDtScale) / hopDuration;

    const airDt = Math.max(
      0,
      (Math.min(hopPhase, HOP_FLIGHT_END) - Math.max(prevPhase, HOP_FLIGHT_START)) *
        hopDuration,
    );

    let nextX = state.position.x;
    let nextZ = state.position.z;
    let airHeight = 0;

    if (hopPhase <= HOP_FLIGHT_START) {
      // Grounded crouch windup: keep hips and boots planted so slip stays strictly zero.
      nextX = hopStartPos.x;
      nextZ = hopStartPos.z;
      const desiredCrouchYaw = clampNumber(wrapAngle(hopEndYaw - hopStartYaw), -0.42, 0.42);
      const crouchTargetYaw = wrapAngle(hopStartYaw + desiredCrouchYaw);
      const yawDiff = wrapAngle(crouchTargetYaw - yaw);
      const maxTurnStep = clampNumber(yawDiff, -3.4 * safeDt, 3.4 * safeDt);
      yaw = wrapAngle(yaw + maxTurnStep);
      velX = 0;
      velZ = 0;
    } else if (hopPhase < HOP_FLIGHT_END || !hopLanded) {
      if (!hopFlightStarted) {
        hopFlightStarted = true;
        airStartLeftOffset = footWorldToLocalOffset(
          leftFootWorld,
          hopStartPos,
          yaw,
          rig.leftFootRestLocal,
        );
        airStartRightOffset = footWorldToLocalOffset(
          rightFootWorld,
          hopStartPos,
          yaw,
          rig.rightFootRestLocal,
        );
      }

      const airU = clampNumber((hopPhase - HOP_FLIGHT_START) / HOP_FLIGHT_SPAN, 0, 1);

      // Handle live mid-walk redirection cleanly in flight without exceeding speed cap.
      if (command.target && airU < 0.72) {
        const targetShift = Math.hypot(
          command.target.x - hopTargetPos.x,
          command.target.z - hopTargetPos.z,
        );
        if (targetShift > 0.28 || hopRedirected) {
          hopRedirected = true;
          const desiredYaw = Math.atan2(
            command.target.x - state.position.x,
            command.target.z - state.position.z,
          );
          const yawDiff = wrapAngle(desiredYaw - yaw);
          yaw = wrapAngle(yaw + clampNumber(yawDiff, -4.6 * airDt, 4.6 * airDt));
          hopEndYaw = yaw;

          const remAirSec = Math.max(0.05, (HOP_FLIGHT_END - hopPhase) * hopDuration);
          const maxHopSpeed = Math.min(
            command.maxSpeed * 0.9,
            command.gait === 'run' ? command.maxSpeed : 1.24,
          );
          const curDist = Math.hypot(
            command.target.x - state.position.x,
            command.target.z - state.position.z,
          );
          const targetSpeed =
            clampNumber(curDist / remAirSec, 0.08, maxHopSpeed) *
            Math.max(0.28, Math.cos(yawDiff * 0.6));
          hopFlightVelX = MathUtils.damp(
            hopFlightVelX,
            Math.sin(yaw) * targetSpeed,
            3.2,
            Math.max(airDt, safeDt),
          );
          hopFlightVelZ = MathUtils.damp(
            hopFlightVelZ,
            Math.cos(yaw) * targetSpeed,
            3.2,
            Math.max(airDt, safeDt),
          );
          const velMag = Math.hypot(hopFlightVelX, hopFlightVelZ);
          if (velMag > maxHopSpeed && velMag > 1e-6) {
            hopFlightVelX *= maxHopSpeed / velMag;
            hopFlightVelZ *= maxHopSpeed / velMag;
          }
        }
      }

      if (!hopRedirected) {
        const yawDiff = wrapAngle(hopEndYaw - yaw);
        const remAirSec = Math.max(1e-4, (HOP_FLIGHT_END - Math.max(prevPhase, HOP_FLIGHT_START)) * hopDuration);
        const turnRateNeeded = clampNumber(yawDiff / remAirSec, -4.8, 4.8);
        const stepYaw = clampNumber(turnRateNeeded * Math.max(airDt, safeDt), -Math.abs(yawDiff), Math.abs(yawDiff));
        yaw = wrapAngle(
          yaw + (Math.abs(yawDiff) < 1e-4 ? 0 : Math.sign(yawDiff) * Math.abs(stepYaw)),
        );
      }

      nextX = state.position.x + hopFlightVelX * airDt;
      nextZ = state.position.z + hopFlightVelZ * airDt;
      velX = hopFlightVelX;
      velZ = hopFlightVelZ;

      if (hopPhase >= HOP_FLIGHT_END) {
        hopLanded = true;
        airHeight = 0;
        velX = 0;
        velZ = 0;
        hopStartPos = {
          x: nextX,
          y: command.sampleGround(nextX, nextZ).y,
          z: nextZ,
        };
        hopTargetPos = { ...hopStartPos };
        yaw = hopEndYaw;
        lockBothFeetAtRest(hopTargetPos, yaw, rig, command.sampleGround);
      } else {
        const airArc = 4 * airU * (1 - airU);
        airHeight = airArc * hopApexHeight;
      }
    } else {
      // Grounded cushion absorption before starting the next hop or settling to rest.
      nextX = hopTargetPos.x;
      nextZ = hopTargetPos.z;
      velX = 0;
      velZ = 0;
      airHeight = 0;
    }

    const groundCenter = command.sampleGround(nextX, nextZ);
    const nextPos: Vec3Like = { x: nextX, y: groundCenter.y + airHeight, z: nextZ };

    const arrivedAtEnd =
      hopPhase >= 1.0 &&
      (!hasTarget ||
        (command.target !== null &&
          Math.hypot(command.target.x - nextX, command.target.z - nextZ) <= 0.025));

    if (hopPhase >= 1.0) {
      if (!wantsHopMode) {
        inHopMode = false;
        hopPhase = 0;
        hopFlightStarted = false;
        hopLanded = false;
        cyclePhase = 0;
        currentStepIndex = 0;
        syncFeetAtRest(nextPos, yaw, rig);
        if (!hasTarget) {
          isIdle = true;
          return {
            position: { x: nextX, y: groundCenter.y, z: nextZ },
            yaw,
            pose: REST_CAPSULE_HUMAN_POSE,
            moving: false,
          };
        }
        // Start an immediate Earth step smoothly from landed stance.
        return update(safeDt, command, { position: nextPos, yaw, velocity: { x: 0, y: 0, z: 0 } }, rig);
      }

      if (!arrivedAtEnd && hasTarget) {
        hopIndex++;
        hopPhase = 0;
        beginNextHop(
          { x: nextX, y: groundCenter.y, z: nextZ },
          yaw,
          g,
          moonFactor,
          command,
          Math.hypot(command.target!.x - nextX, command.target!.z - nextZ),
          rig,
        );
      }
    }

    if (arrivedAtEnd) {
      restBlend = MathUtils.damp(restBlend, 1, 16, safeDt);
      if (restBlend >= 0.995) {
        isIdle = true;
        inHopMode = false;
        hopPhase = 0;
        hopFlightStarted = false;
        hopLanded = false;
        syncFeetAtRest(nextPos, yaw, rig);
        return {
          position: { x: nextX, y: groundCenter.y, z: nextZ },
          yaw,
          pose: REST_CAPSULE_HUMAN_POSE,
          moving: false,
        };
      }
    } else {
      restBlend = MathUtils.damp(restBlend, 0, 24, safeDt);
    }

    const k = sampleHopKeyframeTable(clampNumber(hopPhase, 0, 1));
    const leadIsLeft = hopIndex % 2 === 0;
    const leadSign = leadIsLeft ? -1 : 1;
    const isGroundedPhase = hopPhase <= HOP_FLIGHT_START || hopPhase >= HOP_FLIGHT_END;
    const airU = clampNumber((hopPhase - HOP_FLIGHT_START) / HOP_FLIGHT_SPAN, 0, 1);
    const startFade = isGroundedPhase ? 1 : 1 - smoothstep01(airU);

    let leftPose: FootPose;
    let rightPose: FootPose;

    if (isGroundedPhase) {
      const leftLocal = footWorldToLocalOffset(
        leftFootWorld,
        nextPos,
        yaw,
        rig.leftFootRestLocal,
      );
      const rightLocal = footWorldToLocalOffset(
        rightFootWorld,
        nextPos,
        yaw,
        rig.rightFootRestLocal,
      );
      leftPose = {
        offset: leftLocal,
        rotation: {
          pitch: (leadIsLeft ? k.leadFootPitch : k.trailFootPitch) * hopStyleScale,
          yaw: clampNumber(wrapAngle(hopStartYaw - yaw), -0.45, 0.45),
          roll: 0,
        },
        kneeBend: { x: -0.025 * (k.kneeBendZ / 0.095), y: 0, z: k.kneeBendZ },
      };
      rightPose = {
        offset: rightLocal,
        rotation: {
          pitch: (leadIsLeft ? k.trailFootPitch : k.leadFootPitch) * hopStyleScale,
          yaw: clampNumber(wrapAngle(hopStartYaw - yaw), -0.45, 0.45),
          roll: 0,
        },
        kneeBend: { x: 0.025 * (k.kneeBendZ / 0.095), y: 0, z: k.kneeBendZ },
      };
    } else {
      const leftLift = (leadIsLeft ? k.leadFootLift : k.trailFootLift) * hopStyleScale;
      const rightLift = (leadIsLeft ? k.trailFootLift : k.leadFootLift) * hopStyleScale;
      const leftForward = (leadIsLeft ? k.leadFootForward : k.trailFootForward) * hopStyleScale;
      const rightForward = (leadIsLeft ? k.trailFootForward : k.leadFootForward) * hopStyleScale;
      leftPose = {
        offset: {
          x: airStartLeftOffset.x * startFade,
          y: Math.max(0, airStartLeftOffset.y * startFade) + leftLift,
          z: airStartLeftOffset.z * startFade + leftForward,
        },
        rotation: {
          pitch: (leadIsLeft ? k.leadFootPitch : k.trailFootPitch) * hopStyleScale,
          yaw: 0,
          roll: 0,
        },
        kneeBend: {
          x: -(0.014 + 0.03 * (leftLift / 0.105)),
          y: 0,
          z: Math.max(0.02, leftLift * 0.95),
        },
      };
      rightPose = {
        offset: {
          x: airStartRightOffset.x * startFade,
          y: Math.max(0, airStartRightOffset.y * startFade) + rightLift,
          z: airStartRightOffset.z * startFade + rightForward,
        },
        rotation: {
          pitch: (leadIsLeft ? k.trailFootPitch : k.leadFootPitch) * hopStyleScale,
          yaw: 0,
          roll: 0,
        },
        kneeBend: {
          x: 0.014 + 0.03 * (rightLift / 0.105),
          y: 0,
          z: Math.max(0.02, rightLift * 0.95),
        },
      };
    }

    const leftArmZ = (leadIsLeft ? -k.armForward : k.armForward) * hopStyleScale;
    const rightArmZ = -leftArmZ;
    const spread = k.armSpread * hopStyleScale;
    const armLift = k.armLift * hopStyleScale;
    const torsoRoll = -leadSign * k.torsoRollTowardLead * hopStyleScale;
    const torsoTwist = leadSign * k.torsoTwistTowardLead * hopStyleScale;
    const targetHeadYaw = command.target
      ? clampNumber(
          wrapAngle(
            Math.atan2(command.target.x - nextX, command.target.z - nextZ) - yaw,
          ) * 0.38,
          -0.28,
          0.28,
        )
      : 0;
    smoothedHeadYaw = MathUtils.damp(smoothedHeadYaw, targetHeadYaw, 10, safeDt);

    const pose: CapsuleHumanPose = {
      torsoOffset: {
        x: 0,
        y: k.torsoY * (0.75 + 0.25 * hopStyleScale),
        z: 0,
      },
      torsoRotation: {
        pitch: k.torsoPitch,
        yaw: torsoTwist,
        roll: torsoRoll,
      },
      headOffset: ZERO_VEC3,
      headRotation: {
        pitch: k.headPitch * hopStyleScale,
        yaw: smoothedHeadYaw - torsoTwist * 0.45,
        roll: -torsoRoll * 0.5,
      },
      leftFoot: leftPose,
      rightFoot: rightPose,
      leftHand: {
        offset: { x: -spread, y: armLift, z: leftArmZ },
        rotation: {
          pitch: -leftArmZ * 1.1 - armLift * 0.65,
          yaw: 0,
          roll: -0.06 - spread * 1.25,
        },
        elbowBend: { x: -0.035, y: 0, z: -0.05 + leftArmZ * 0.12 },
      },
      rightHand: {
        offset: { x: spread, y: armLift, z: rightArmZ },
        rotation: {
          pitch: -rightArmZ * 1.1 - armLift * 0.65,
          yaw: 0,
          roll: 0.06 + spread * 1.25,
        },
        elbowBend: { x: 0.035, y: 0, z: -0.05 + rightArmZ * 0.12 },
      },
      restBlend: arrivedAtEnd ? restBlend : 0,
    };

    return { position: nextPos, yaw, pose, moving: true };
  }

  function update(
    dt: number,
    command: LocomotionCommand,
    state: LocomotionStateSnapshot,
    rig: RigMeasurements,
  ): LocomotionStepResult {
    const safeDt = Math.max(0, dt);
    if (safeDt === 0) {
      return {
        position: state.position,
        yaw,
        pose: REST_CAPSULE_HUMAN_POSE,
        moving: false,
      };
    }

    if (justReset) {
      justReset = false;
      const startGroundY = command.sampleGround(state.position.x, state.position.z).y;
      const startAir = Math.max(0, state.position.y - startGroundY);
      if (startAir > 0.02) {
        inHopMode = true;
        isIdle = false;
        hopPhase = 0.53;
        hopDuration = 1.05;
        hopApexHeight = Math.max(0.18, startAir);
        hopFlightGravity = clampNumber(command.gravity, 0.4, 25);
        hopStyleScale = 1.0;
        hopFlightStarted = true;
        hopLanded = false;
        hopFlightVelX = state.velocity.x;
        hopFlightVelZ = state.velocity.z;
        hopEndYaw = yaw;
      }
    }

    const g = clampNumber(command.gravity, 0.4, 25);
    const gRatio = g / EARTH_GRAVITY_MPS2;
    const wantsHopMode = gRatio < 0.65;
    const moonFactor = smoothstep01((0.46 - gRatio) / 0.29);

    if (wantsHopMode && !inHopMode) {
      const dist = command.target
        ? Math.hypot(command.target.x - state.position.x, command.target.z - state.position.z)
        : 0;
      if (dist > 0.022) {
        inHopMode = true;
        isIdle = false;
        hopPhase = 0;
        hopFlightStarted = false;
        hopLanded = false;
        lockBothFeetAtRest(state.position, yaw, rig, command.sampleGround);
      }
    }

    if (inHopMode) {
      return updateLowGravityHop(safeDt, g, wantsHopMode, moonFactor, command, state, rig);
    }

    let desiredVelX = 0;
    let desiredVelZ = 0;
    let yawError = 0;
    let hasTarget = false;
    let distToTarget = 0;

    if (command.target) {
      const dx = command.target.x - state.position.x;
      const dz = command.target.z - state.position.z;
      distToTarget = Math.hypot(dx, dz);
      if (distToTarget > 0.022) {
        hasTarget = true;
        const targetYaw = Math.atan2(dx, dz);
        yawError = wrapAngle(targetYaw - yaw);
        const maxTurnRate = command.gait === 'run' ? 6.8 : 5.4;
        const desiredTurn = clampNumber(yawError * 7.2, -maxTurnRate, maxTurnRate);
        turnRate = MathUtils.damp(turnRate, desiredTurn, 16, safeDt);
        const stepYaw = clampNumber(turnRate * safeDt, -Math.abs(yawError), Math.abs(yawError));
        yaw = wrapAngle(yaw + (Math.abs(yawError) < 1e-4 ? 0 : Math.sign(yawError) * Math.abs(stepYaw)));

        const cruiseSpeed =
          command.gait === 'run'
            ? command.maxSpeed
            : Math.min(command.maxSpeed, Math.min(command.maxSpeed * 0.92, 1.28));
        const brakingDist = command.gait === 'run' ? 0.52 : 0.34;
        const slowFactor = clampNumber(distToTarget / brakingDist, 0.2, 1.0);
        const alignFactor = Math.max(0.2, Math.cos(yawError * 0.7));
        const targetSpeed = cruiseSpeed * slowFactor * alignFactor;

        desiredVelX = Math.sin(yaw) * targetSpeed;
        desiredVelZ = Math.cos(yaw) * targetSpeed;
      } else {
        turnRate = MathUtils.damp(turnRate, 0, 14, safeDt);
      }
    } else {
      turnRate = MathUtils.damp(turnRate, 0, 14, safeDt);
    }

    const accelRate = hasTarget ? 11 : 16;
    velX = MathUtils.damp(velX, desiredVelX, accelRate, safeDt);
    velZ = MathUtils.damp(velZ, desiredVelZ, accelRate, safeDt);
    const rawSpeed = Math.hypot(velX, velZ);
    if (rawSpeed > command.maxSpeed && rawSpeed > 1e-6) {
      velX *= command.maxSpeed / rawSpeed;
      velZ *= command.maxSpeed / rawSpeed;
    }

    let nextX = state.position.x + velX * safeDt;
    let nextZ = state.position.z + velZ * safeDt;
    if (command.target && distToTarget <= 0.03) {
      nextX = MathUtils.damp(state.position.x, command.target.x, 18, safeDt);
      nextZ = MathUtils.damp(state.position.z, command.target.z, 18, safeDt);
      if (Math.hypot(command.target.x - nextX, command.target.z - nextZ) < 0.005) {
        nextX = command.target.x;
        nextZ = command.target.z;
        velX = 0;
        velZ = 0;
      }
    }

    const groundCenter = command.sampleGround(nextX, nextZ);
    const nextPos: Vec3Like = { x: nextX, y: groundCenter.y, z: nextZ };
    const speed = Math.hypot(velX, velZ);
    const stepDistance = Math.hypot(nextX - state.position.x, nextZ - state.position.z);

    if (isIdle && !hasTarget) {
      return {
        position: nextPos,
        yaw,
        pose: REST_CAPSULE_HUMAN_POSE,
        moving: false,
      };
    }

    // Initialize feet on ground when starting from idle.
    if (isIdle && hasTarget) {
      isIdle = false;
      cyclePhase = 0;
      currentStepIndex = 0;
      plantedWorld = footRestWorldPosition(nextPos, yaw, rig.rightFootRestLocal);
      plantedWorld = { ...plantedWorld, y: command.sampleGround(plantedWorld.x, plantedWorld.z).y };
      plantedYaw = yaw;
      swingStartWorld = footRestWorldPosition(nextPos, yaw, rig.leftFootRestLocal);
      swingStartWorld = {
        ...swingStartWorld,
        y: command.sampleGround(swingStartWorld.x, swingStartWorld.z).y,
      };
      swingStartYaw = yaw;
      const firstLook = clampNumber(distToTarget * 0.4, 0.06, 0.22);
      const firstIdeal = footRestWorldPosition(
        { x: nextPos.x + Math.sin(yaw) * firstLook, y: nextPos.y, z: nextPos.z + Math.cos(yaw) * firstLook },
        yaw,
        rig.leftFootRestLocal,
      );
      swingTargetWorld = { ...firstIdeal, y: command.sampleGround(firstIdeal.x, firstIdeal.z).y };
    }

    // Advance authored cycle phase smoothly from distance traveled (with gentle turning cadence).
    const uBefore = cyclePhase - currentStepIndex;
    const leftRestBefore = footRestWorldPosition(nextPos, yaw, rig.leftFootRestLocal);
    const rightRestBefore = footRestWorldPosition(nextPos, yaw, rig.rightFootRestLocal);
    const swingLeftBefore = currentStepIndex % 2 === 0;
    const plantErrBefore = Math.hypot(
      plantedWorld.x - (swingLeftBefore ? rightRestBefore.x : leftRestBefore.x),
      plantedWorld.z - (swingLeftBefore ? rightRestBefore.z : leftRestBefore.z),
    );
    const swingTargetErrBefore = Math.hypot(
      swingStartWorld.x - (swingLeftBefore ? leftRestBefore.x : rightRestBefore.x),
      swingStartWorld.z - (swingLeftBefore ? leftRestBefore.z : rightRestBefore.z),
    );
    const needSettleCadence =
      !hasTarget &&
      restBlend < 0.995 &&
      ((uBefore > 0.08 && uBefore < 0.92) || plantErrBefore >= 0.035 || swingTargetErrBefore >= 0.035);
    const effectiveAdvance = hasTarget
      ? stepDistance + Math.abs(turnRate) * 0.04 * safeDt
      : 0;
    const minCadence = needSettleCadence ? 2.6 * safeDt : 0;
    const phaseDelta = effectiveAdvance / STRIDE_LENGTH + minCadence;
    cyclePhase += phaseDelta;

    const newStepIndex = Math.floor(cyclePhase);
    while (currentStepIndex < newStepIndex) {
      currentStepIndex++;
      const nextSwingSideIsLeft = currentStepIndex % 2 === 0;
      const swingRest = nextSwingSideIsLeft ? rig.leftFootRestLocal : rig.rightFootRestLocal;
      advanceHalfStride(nextPos, yaw, speed, hasTarget, swingRest, command.sampleGround);
    }

    const u = cyclePhase - currentStepIndex;
    const swingLeft = currentStepIndex % 2 === 0;
    const swingSign = swingLeft ? -1 : 1; // -1 = left (-X), +1 = right (+X)
    const plantSign = -swingSign;

    // Update swing destination continuously so live mid-walk redirects steer the airborne foot.
    if (hasTarget) {
      const swingRest = swingLeft ? rig.leftFootRestLocal : rig.rightFootRestLocal;
      const lookAhead = clampNumber(Math.min(distToTarget * 0.65, speed * 0.24), 0.02, 0.24);
      const predictedCenter: Vec3Like = {
        x: nextPos.x + Math.sin(yaw) * lookAhead,
        y: nextPos.y,
        z: nextPos.z + Math.cos(yaw) * lookAhead,
      };
      const ideal = footRestWorldPosition(predictedCenter, yaw, swingRest);
      swingTargetWorld = {
        x: ideal.x,
        y: command.sampleGround(ideal.x, ideal.z).y,
        z: ideal.z,
      };
    } else {
      const swingRest = swingLeft ? rig.leftFootRestLocal : rig.rightFootRestLocal;
      const restTarget = footRestWorldPosition(nextPos, yaw, swingRest);
      swingTargetWorld = {
        x: restTarget.x,
        y: command.sampleGround(restTarget.x, restTarget.z).y,
        z: restTarget.z,
      };
    }

    const targetAmp = hasTarget ? clampNumber(speed / Math.max(0.5, command.maxSpeed), 0.35, 1) : 0;
    activeAmplitude = MathUtils.damp(activeAmplitude, targetAmp, hasTarget ? 12 : 9, safeDt);

    const k = sampleKeyframeTable(u);

    // Planted foot stays locked in world space during stance!
    const plantRest = swingLeft ? rig.rightFootRestLocal : rig.leftFootRestLocal;
    const plantLocal = footWorldToLocalOffset(plantedWorld, nextPos, yaw, plantRest);
    const plantRelYaw = clampNumber(wrapAngle(plantedYaw - yaw), -0.45, 0.45);
    const plantPose: FootPose = {
      offset: plantLocal,
      rotation: {
        pitch: k.plantFootPitch * activeAmplitude,
        yaw: plantRelYaw,
        roll: 0,
      },
      kneeBend:
        plantLocal.z < -0.03
          ? { x: plantSign * 0.012, y: 0, z: clampNumber(-plantLocal.z * 0.22, 0, 0.05) }
          : ZERO_VEC3,
    };

    // Swinging foot interpolates from previous world spot to predicted landing spot + authored lift.
    const swingRest = swingLeft ? rig.leftFootRestLocal : rig.rightFootRestLocal;
    const moveS = smoothstep01(u);
    const swingWorldX = lerpNumber(swingStartWorld.x, swingTargetWorld.x, moveS);
    const swingWorldZ = lerpNumber(swingStartWorld.z, swingTargetWorld.z, moveS);
    const swingGroundY = lerpNumber(swingStartWorld.y, swingTargetWorld.y, moveS);
    const liftAmp = Math.max(0.68, activeAmplitude);
    const swingWorld: Vec3Like = {
      x: swingWorldX,
      y: swingGroundY + k.swingFootLift * liftAmp,
      z: swingWorldZ,
    };
    const swingLocal = footWorldToLocalOffset(swingWorld, nextPos, yaw, swingRest);
    const swingYaw = swingStartYaw + wrapAngle(yaw - swingStartYaw) * moveS;
    const swingPose: FootPose = {
      offset: swingLocal,
      rotation: {
        pitch: k.swingFootPitch * activeAmplitude,
        yaw: clampNumber(wrapAngle(swingYaw - yaw), -0.45, 0.45),
        roll: 0,
      },
      kneeBend: {
        x: swingSign * (0.015 + 0.025 * (k.swingFootLift / 0.125)),
        y: 0,
        z: 0.035 + 0.095 * (k.swingFootLift / 0.125),
      },
    };

    // Check arrival & settle back to exact approved silhouette.
    const leftRest = footRestWorldPosition(nextPos, yaw, rig.leftFootRestLocal);
    const rightRest = footRestWorldPosition(nextPos, yaw, rig.rightFootRestLocal);
    const plantErr = Math.hypot(
      plantedWorld.x - (swingLeft ? rightRest.x : leftRest.x),
      plantedWorld.z - (swingLeft ? rightRest.z : leftRest.z),
    );
    const swingErr = Math.hypot(
      swingWorld.x - (swingLeft ? leftRest.x : rightRest.x),
      swingWorld.z - (swingLeft ? leftRest.z : rightRest.z),
    );

    const footGrounded = u <= 0.08 || u >= 0.92 || k.swingFootLift < 0.015;
    const settlingComplete =
      !hasTarget && speed < 0.04 && footGrounded && plantErr < 0.035 && swingErr < 0.035;
    restBlend = MathUtils.damp(restBlend, settlingComplete ? 1 : 0, settlingComplete ? 16 : 24, safeDt);

    if (settlingComplete && restBlend >= 0.995) {
      isIdle = true;
      syncFeetAtRest(nextPos, yaw, rig);
      return {
        position: nextPos,
        yaw,
        pose: REST_CAPSULE_HUMAN_POSE,
        moving: false,
      };
    }

    const leftArmZ = (swingLeft ? k.swingArmForward : -k.swingArmForward) * activeAmplitude;
    const rightArmZ = -leftArmZ;

    // Sign convention check: roll > 0 tilts top toward -X (left).
    // When plantSign is -1 (left), +k.torsoRollTowardPlant leans over left supporting leg.
    // When plantSign is +1 (right), -k.torsoRollTowardPlant leans over right supporting leg.
    const torsoRoll = -plantSign * k.torsoRollTowardPlant * activeAmplitude - turnRate * 0.035;
    // Sign convention check: yaw < 0 advances +X (right) shoulder; when left swings (swingSign = -1),
    // right shoulder leads forward -> yaw < 0 -> +swingSign * torsoTwistTowardSwing.
    const torsoTwist = swingSign * k.torsoTwistTowardSwing * activeAmplitude;
    smoothedHeadYaw = MathUtils.damp(
      smoothedHeadYaw,
      hasTarget ? clampNumber(yawError * 0.4, -0.3, 0.3) : 0,
      10,
      safeDt,
    );

    const pose: CapsuleHumanPose = {
      torsoOffset: {
        x: plantSign * k.swayTowardPlant * activeAmplitude,
        y: k.torsoY * activeAmplitude,
        z: 0,
      },
      torsoRotation: {
        pitch: k.torsoPitch * activeAmplitude,
        yaw: torsoTwist,
        roll: torsoRoll,
      },
      headOffset: ZERO_VEC3,
      headRotation: {
        pitch: k.headPitch * activeAmplitude,
        yaw: smoothedHeadYaw - torsoTwist * 0.45,
        roll: -torsoRoll * 0.5,
      },
      leftFoot: swingLeft ? swingPose : plantPose,
      rightFoot: swingLeft ? plantPose : swingPose,
      leftHand: {
        offset: {
          x: -Math.abs(leftArmZ) * 0.09,
          y: Math.abs(leftArmZ) * 0.18,
          z: leftArmZ,
        },
        rotation: {
          pitch: -leftArmZ * 1.2,
          yaw: 0,
          roll: -0.06,
        },
        elbowBend: {
          x: -0.025,
          y: 0,
          z: -0.05 + leftArmZ * 0.14,
        },
      },
      rightHand: {
        offset: {
          x: Math.abs(rightArmZ) * 0.09,
          y: Math.abs(rightArmZ) * 0.18,
          z: rightArmZ,
        },
        rotation: {
          pitch: -rightArmZ * 1.2,
          yaw: 0,
          roll: 0.06,
        },
        elbowBend: {
          x: 0.025,
          y: 0,
          z: -0.05 + rightArmZ * 0.14,
        },
      },
      restBlend: settlingComplete ? restBlend : 0,
    };

    return {
      position: nextPos,
      yaw,
      pose,
      moving: true,
    };
  }

  return {
    id: 'cartoon-keypose',
    label: 'Key-Pose Bounce',
    approach: 'Hybrid · 4-key cartoon + foot lock',
    summary:
      'Authored Contact/Down/Passing/Up Earth walk and Squash/Float/Cushion Moon/Mars hop keyframes with world-locked boots.',
    reset,
    update,
  };
}
