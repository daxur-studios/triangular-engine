import { MathUtils } from 'three';
import {
  clampNumber,
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

  function syncFeetAtRest(pos: Vec3Like, currentYaw: number, rig: RigMeasurements): void {
    plantedWorld = footRestWorldPosition(pos, currentYaw, rig.rightFootRestLocal);
    swingStartWorld = footRestWorldPosition(pos, currentYaw, rig.leftFootRestLocal);
    swingTargetWorld = { ...swingStartWorld };
    plantedYaw = currentYaw;
    swingStartYaw = currentYaw;
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
    syncFeetAtRest(state.position, yaw, rig);
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
      'Authored 4-beat Contact/Down/Passing/Up walk curves layered with world-locked boots and smooth turns.',
    reset,
    update,
  };
}
