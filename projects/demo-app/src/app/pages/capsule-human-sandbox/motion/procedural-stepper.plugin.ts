import { MathUtils } from 'three';
import {
  clampNumber,
  footRestWorldPosition,
  footWorldToLocalOffset,
  lerpNumber,
  localToWorldDelta,
  REST_CAPSULE_HUMAN_POSE,
  smoothstep01,
  worldDeltaToLocal,
  wrapAngle,
  ZERO_EULER,
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

interface FootState {
  plantedPos: Vec3Like;
  plantedYaw: number;
  swinging: boolean;
  swingStartPos: Vec3Like;
  swingEndPos: Vec3Like;
  swingStartYaw: number;
  swingEndYaw: number;
  swingElapsed: number;
  swingDuration: number;
}

function makeFootState(worldPos: Vec3Like, yaw: number): FootState {
  return {
    plantedPos: { ...worldPos },
    plantedYaw: yaw,
    swinging: false,
    swingStartPos: { ...worldPos },
    swingEndPos: { ...worldPos },
    swingStartYaw: yaw,
    swingEndYaw: yaw,
    swingElapsed: 0,
    swingDuration: 0.25,
  };
}

/**
 * Procedural world-space step planner with smooth steering, mid-walk redirection,
 * explicit double-support settle, landing recoil, and zero-slip planted feet.
 */
export function createProceduralStepperPlugin(): LocomotionPlugin {
  let yaw = 0;
  let velX = 0;
  let velZ = 0;
  let turnRate = 0;
  let leftFoot = makeFootState(ZERO_VEC3, 0);
  let rightFoot = makeFootState(ZERO_VEC3, 0);
  let doubleSupportTimer = 1;
  let lastSwungSide: 'left' | 'right' = 'right';

  let bounceSpringY = 0;
  let bounceSpringVel = 0;
  let smoothedSwayX = 0;
  let smoothedRollZ = 0;
  let smoothedPitchX = 0;
  let smoothedTwistY = 0;
  let smoothedArmSwing = 0;
  let smoothedHeadYaw = 0;
  let restBlend = 1;

  function reset(state: LocomotionStateSnapshot, rig: RigMeasurements): void {
    yaw = state.yaw;
    velX = 0;
    velZ = 0;
    turnRate = 0;
    leftFoot = makeFootState(
      footRestWorldPosition(state.position, yaw, rig.leftFootRestLocal),
      yaw,
    );
    rightFoot = makeFootState(
      footRestWorldPosition(state.position, yaw, rig.rightFootRestLocal),
      yaw,
    );
    doubleSupportTimer = 1;
    lastSwungSide = 'right';
    bounceSpringY = 0;
    bounceSpringVel = 0;
    smoothedSwayX = 0;
    smoothedRollZ = 0;
    smoothedPitchX = 0;
    smoothedTwistY = 0;
    smoothedArmSwing = 0;
    smoothedHeadYaw = 0;
    restBlend = 1;
  }

  function startSwing(
    foot: FootState,
    oppositeFoot: FootState,
    side: 'left' | 'right',
    footRestLocal: Vec3Like,
    nextPos: Vec3Like,
    nextYaw: number,
    lookAheadX: number,
    lookAheadZ: number,
    sampleGround: GroundSampler,
    isFinalSettle: boolean,
  ): void {
    const predictedCenter: Vec3Like = {
      x: nextPos.x + lookAheadX,
      y: nextPos.y,
      z: nextPos.z + lookAheadZ,
    };
    const ideal = footRestWorldPosition(predictedCenter, nextYaw, footRestLocal);

    // Keep stride comfortable and prevent crossing over the planted boot.
    let dx = ideal.x - nextPos.x;
    let dz = ideal.z - nextPos.z;
    const maxOffset = 0.44;
    const mag = Math.hypot(dx, dz);
    if (mag > maxOffset) {
      dx *= maxOffset / mag;
      dz *= maxOffset / mag;
    }

    let endX = nextPos.x + dx;
    let endZ = nextPos.z + dz;
    const sepX = endX - oppositeFoot.plantedPos.x;
    const sepZ = endZ - oppositeFoot.plantedPos.z;
    const sep = Math.hypot(sepX, sepZ);
    const minSep = 0.16;
    if (!isFinalSettle && sep < minSep && sep > 1e-4) {
      const push = (minSep - sep) / sep;
      endX += sepX * push;
      endZ += sepZ * push;
    }

    const groundY = sampleGround(endX, endZ).y;
    const stepTravel = Math.hypot(endX - foot.plantedPos.x, endZ - foot.plantedPos.z);

    foot.swinging = true;
    foot.swingStartPos = { ...foot.plantedPos };
    foot.swingEndPos = { x: endX, y: groundY, z: endZ };
    foot.swingStartYaw = foot.plantedYaw;
    foot.swingEndYaw = nextYaw;
    foot.swingElapsed = 0;
    foot.swingDuration = isFinalSettle
      ? 0.18
      : clampNumber(0.22 + stepTravel * 0.2, 0.22, 0.34);
    lastSwungSide = side;
  }

  function buildFootPose(
    foot: FootState,
    opposite: FootState,
    side: 'left' | 'right',
    footRestLocal: Vec3Like,
    rootPos: Vec3Like,
    rootYaw: number,
    sampleGround: GroundSampler,
    isFinalSettle: boolean,
  ): FootPose {
    const sign = side === 'left' ? -1 : 1;

    if (!foot.swinging) {
      const localOffset = footWorldToLocalOffset(
        foot.plantedPos,
        rootPos,
        rootYaw,
        footRestLocal,
      );
      const relYaw = clampNumber(wrapAngle(foot.plantedYaw - rootYaw), -0.45, 0.45);
      const ground = sampleGround(foot.plantedPos.x, foot.plantedPos.z);
      const localNormal = worldDeltaToLocal(ground.normal, rootYaw);
      const slopePitch = Math.atan2(localNormal.z, Math.max(0.2, localNormal.y));
      const slopeRoll = -Math.atan2(localNormal.x, Math.max(0.2, localNormal.y));

      // Gentle push-off pitch only late in opposite swing when this foot trails behind hips.
      let pushOffPitch = 0;
      if (opposite.swinging && localOffset.z < -0.05) {
        const oppU = clampNumber(opposite.swingElapsed / opposite.swingDuration, 0, 1);
        if (oppU > 0.65) {
          const pushT = smoothstep01((oppU - 0.65) / 0.35);
          pushOffPitch = pushT * clampNumber((-localOffset.z - 0.05) * 1.1, 0, 0.19);
        }
      }

      return {
        offset: { x: localOffset.x, y: localOffset.y, z: localOffset.z },
        rotation: {
          pitch: slopePitch + pushOffPitch,
          yaw: relYaw,
          roll: slopeRoll,
        },
        kneeBend:
          localOffset.z < -0.04
            ? { x: sign * 0.012, y: 0, z: clampNumber(-localOffset.z * 0.25, 0, 0.055) }
            : ZERO_VEC3,
      };
    }

    const u = clampNumber(foot.swingElapsed / foot.swingDuration, 0, 1);
    const s = smoothstep01(u);
    const stepTravel = Math.hypot(
      foot.swingEndPos.x - foot.swingStartPos.x,
      foot.swingEndPos.z - foot.swingStartPos.z,
    );
    const peakU = 0.44;
    const arc =
      u < peakU
        ? Math.sin((u / peakU) * Math.PI * 0.5)
        : Math.cos(((u - peakU) / (1 - peakU)) * Math.PI * 0.5);
    const maxLift = isFinalSettle
      ? clampNumber(0.055 + stepTravel * 0.25, 0.055, 0.09)
      : clampNumber(0.088 + stepTravel * 0.11, 0.088, 0.135);

    const worldX = lerpNumber(foot.swingStartPos.x, foot.swingEndPos.x, s);
    const worldZ = lerpNumber(foot.swingStartPos.z, foot.swingEndPos.z, s);
    const baseY = lerpNumber(foot.swingStartPos.y, foot.swingEndPos.y, s);
    const worldFoot: Vec3Like = {
      x: worldX,
      y: baseY + Math.pow(Math.max(0, arc), 1.1) * maxLift,
      z: worldZ,
    };

    const localOffset = footWorldToLocalOffset(worldFoot, rootPos, rootYaw, footRestLocal);
    const swingYaw =
      foot.swingStartYaw + wrapAngle(foot.swingEndYaw - foot.swingStartYaw) * s;
    const relYaw = clampNumber(wrapAngle(swingYaw - rootYaw), -0.45, 0.45);

    // Heel-strike preparation: gentle toe-trail early, toe-up mid-to-late, flat at landing.
    let pitch = 0;
    if (!isFinalSettle) {
      if (u < 0.30) {
        pitch = lerpNumber(0.14, -0.05, smoothstep01(u / 0.3));
      } else if (u < 0.84) {
        pitch = lerpNumber(-0.05, -0.23, smoothstep01((u - 0.3) / 0.54));
      } else {
        pitch = lerpNumber(-0.23, 0, smoothstep01((u - 0.84) / 0.16));
      }
    }

    return {
      offset: localOffset,
      rotation: { pitch, yaw: relYaw, roll: 0 },
      kneeBend: {
        x: sign * (0.015 + 0.025 * arc),
        y: 0,
        z: 0.035 + 0.095 * arc,
      },
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
        const maxTurnRate = command.gait === 'run' ? 6.8 : 5.2;
        const desiredTurn = clampNumber(yawError * 7.0, -maxTurnRate, maxTurnRate);
        turnRate = MathUtils.damp(turnRate, desiredTurn, 16, safeDt);
        const stepYaw = clampNumber(turnRate * safeDt, -Math.abs(yawError), Math.abs(yawError));
        yaw = wrapAngle(yaw + (Math.abs(yawError) < 1e-4 ? 0 : Math.sign(yawError) * Math.abs(stepYaw)));

        const cruiseSpeed =
          command.gait === 'run'
            ? command.maxSpeed
            : Math.min(command.maxSpeed, Math.min(command.maxSpeed * 0.9, 1.24));
        const brakingDist = command.gait === 'run' ? 0.55 : 0.36;
        const slowFactor = clampNumber(distToTarget / brakingDist, 0.2, 1.0);
        const alignFactor = Math.max(0.18, Math.cos(yawError * 0.72));
        const targetSpeed = cruiseSpeed * slowFactor * alignFactor;

        // Drive forward velocity along current facing so turns curve organically.
        desiredVelX = Math.sin(yaw) * targetSpeed;
        desiredVelZ = Math.cos(yaw) * targetSpeed;
      } else {
        turnRate = MathUtils.damp(turnRate, 0, 14, safeDt);
      }
    } else {
      turnRate = MathUtils.damp(turnRate, 0, 14, safeDt);
    }

    const accelRate = hasTarget ? 10 : 15;
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

    const nextGround = command.sampleGround(nextX, nextZ);
    const nextPos: Vec3Like = { x: nextX, y: nextGround.y, z: nextZ };
    const speed = Math.hypot(velX, velZ);
    const speedNorm = clampNumber(speed / Math.max(0.5, command.maxSpeed), 0, 1);

    // Advance swinging foot if active.
    for (const [side, foot] of [
      ['left', leftFoot] as const,
      ['right', rightFoot] as const,
    ]) {
      if (!foot.swinging) continue;
      foot.swingElapsed += safeDt;
      if (foot.swingElapsed >= foot.swingDuration) {
        foot.swinging = false;
        foot.plantedPos = { ...foot.swingEndPos };
        foot.plantedYaw = foot.swingEndYaw;
        doubleSupportTimer = 0;
        lastSwungSide = side;
        // Downward weight recoil on boot impact.
        bounceSpringVel -= 0.24 + 0.14 * speedNorm;
      }
    }

    const isSettling = !hasTarget || distToTarget < 0.045;
    if (!leftFoot.swinging && !rightFoot.swinging) {
      doubleSupportTimer += safeDt;
      const minDoubleSupport = hasTarget && speed > 0.25 ? 0.028 : 0.015;
      if (doubleSupportTimer >= minDoubleSupport) {
        const lookAhead = isSettling ? 0 : clampNumber(speed * 0.175, 0.04, 0.21);
        const lookAheadX = Math.sin(yaw) * lookAhead;
        const lookAheadZ = Math.cos(yaw) * lookAhead;
        const idealCenter: Vec3Like = {
          x: nextPos.x + lookAheadX,
          y: nextPos.y,
          z: nextPos.z + lookAheadZ,
        };
        const leftIdeal = footRestWorldPosition(idealCenter, yaw, rig.leftFootRestLocal);
        const rightIdeal = footRestWorldPosition(idealCenter, yaw, rig.rightFootRestLocal);

        const leftErr =
          Math.hypot(leftFoot.plantedPos.x - leftIdeal.x, leftFoot.plantedPos.z - leftIdeal.z) +
          Math.abs(wrapAngle(leftFoot.plantedYaw - yaw)) * 0.18;
        const rightErr =
          Math.hypot(rightFoot.plantedPos.x - rightIdeal.x, rightFoot.plantedPos.z - rightIdeal.z) +
          Math.abs(wrapAngle(rightFoot.plantedYaw - yaw)) * 0.18;

        const threshold = isSettling ? 0.004 : 0.145;
        const pickLeft =
          leftErr > rightErr + 0.005
            ? true
            : rightErr > leftErr + 0.005
              ? false
              : lastSwungSide === 'right';

        if (pickLeft && leftErr > threshold) {
          startSwing(
            leftFoot,
            rightFoot,
            'left',
            rig.leftFootRestLocal,
            nextPos,
            yaw,
            lookAheadX,
            lookAheadZ,
            command.sampleGround,
            isSettling,
          );
        } else if (!pickLeft && rightErr > threshold) {
          startSwing(
            rightFoot,
            leftFoot,
            'right',
            rig.rightFootRestLocal,
            nextPos,
            yaw,
            lookAheadX,
            lookAheadZ,
            command.sampleGround,
            isSettling,
          );
        }
      }
    }

    // Check whether character has finished arriving and settled both feet.
    const leftRestWorld = footRestWorldPosition(nextPos, yaw, rig.leftFootRestLocal);
    const rightRestWorld = footRestWorldPosition(nextPos, yaw, rig.rightFootRestLocal);
    const feetSettled =
      !leftFoot.swinging &&
      !rightFoot.swinging &&
      Math.hypot(leftFoot.plantedPos.x - leftRestWorld.x, leftFoot.plantedPos.z - leftRestWorld.z) <
        0.005 &&
      Math.hypot(
        rightFoot.plantedPos.x - rightRestWorld.x,
        rightFoot.plantedPos.z - rightRestWorld.z,
      ) < 0.005;

    const stillActive = hasTarget || leftFoot.swinging || rightFoot.swinging || !feetSettled;
    restBlend = MathUtils.damp(restBlend, stillActive ? 0 : 1, stillActive ? 22 : 16, safeDt);

    // Secondary torso bounce spring + passing arc.
    let swingArc = 0;
    let supportSign = 0;
    if (leftFoot.swinging) {
      const u = leftFoot.swingElapsed / leftFoot.swingDuration;
      swingArc = Math.sin(u * Math.PI);
      supportSign = 1; // Right foot (+X) bears weight.
    } else if (rightFoot.swinging) {
      const u = rightFoot.swingElapsed / rightFoot.swingDuration;
      swingArc = Math.sin(u * Math.PI);
      supportSign = -1; // Left foot (-X) bears weight.
    }

    const stiffness = 175;
    const damping = 18;
    const springAccel = -stiffness * bounceSpringY - damping * bounceSpringVel;
    bounceSpringVel += springAccel * safeDt;
    bounceSpringY = clampNumber(bounceSpringY + bounceSpringVel * safeDt, -0.045, 0.045);

    const passingRise = swingArc * 0.026 * (0.35 + 0.65 * speedNorm);
    const targetSwayX = supportSign * 0.036 * (0.3 + 0.7 * speedNorm);
    const targetRollZ = -supportSign * 0.068 * (0.25 + 0.75 * speedNorm) - turnRate * 0.032;
    const targetPitchX = 0.082 * speedNorm;

    const leftPose = buildFootPose(
      leftFoot,
      rightFoot,
      'left',
      rig.leftFootRestLocal,
      nextPos,
      yaw,
      command.sampleGround,
      isSettling && !hasTarget,
    );
    const rightPose = buildFootPose(
      rightFoot,
      leftFoot,
      'right',
      rig.rightFootRestLocal,
      nextPos,
      yaw,
      command.sampleGround,
      isSettling && !hasTarget,
    );

    const strideDeltaZ = rightPose.offset.z - leftPose.offset.z;
    const targetTwistY = clampNumber(strideDeltaZ * 0.42, -0.14, 0.14);
    const targetArmSwing = clampNumber(strideDeltaZ * 0.95, -0.22, 0.22);
    const targetHeadYaw = hasTarget ? clampNumber(yawError * 0.38, -0.28, 0.28) : 0;

    smoothedSwayX = MathUtils.damp(smoothedSwayX, targetSwayX, 12, safeDt);
    smoothedRollZ = MathUtils.damp(smoothedRollZ, targetRollZ, 12, safeDt);
    smoothedPitchX = MathUtils.damp(smoothedPitchX, targetPitchX, 10, safeDt);
    smoothedTwistY = MathUtils.damp(smoothedTwistY, targetTwistY, 14, safeDt);
    smoothedArmSwing = MathUtils.damp(smoothedArmSwing, targetArmSwing, 14, safeDt);
    smoothedHeadYaw = MathUtils.damp(smoothedHeadYaw, targetHeadYaw, 10, safeDt);

    const leftArmZ = smoothedArmSwing;
    const rightArmZ = -smoothedArmSwing;

    const pose: CapsuleHumanPose = {
      torsoOffset: {
        x: smoothedSwayX,
        y: bounceSpringY + passingRise,
        z: 0,
      },
      torsoRotation: {
        pitch: smoothedPitchX,
        yaw: smoothedTwistY,
        roll: smoothedRollZ,
      },
      headOffset: ZERO_VEC3,
      headRotation: {
        pitch: -smoothedPitchX * 0.35 + bounceSpringY * 0.5,
        yaw: smoothedHeadYaw - smoothedTwistY * 0.45,
        roll: -smoothedRollZ * 0.48,
      },
      leftFoot: leftPose,
      rightFoot: rightPose,
      leftHand: {
        offset: {
          x: -Math.abs(leftArmZ) * 0.08,
          y: Math.abs(leftArmZ) * 0.16,
          z: leftArmZ,
        },
        rotation: {
          pitch: -leftArmZ * 1.15,
          yaw: 0,
          roll: -0.05,
        },
        elbowBend: {
          x: -0.025,
          y: 0,
          z: -0.045 + leftArmZ * 0.12,
        },
      },
      rightHand: {
        offset: {
          x: Math.abs(rightArmZ) * 0.08,
          y: Math.abs(rightArmZ) * 0.16,
          z: rightArmZ,
        },
        rotation: {
          pitch: -rightArmZ * 1.15,
          yaw: 0,
          roll: 0.05,
        },
        elbowBend: {
          x: 0.025,
          y: 0,
          z: -0.045 + rightArmZ * 0.12,
        },
      },
      restBlend: stillActive ? 0 : restBlend,
    };

    const moving = stillActive || restBlend < 0.995;
    if (!moving) {
      return {
        position: nextPos,
        yaw,
        pose: REST_CAPSULE_HUMAN_POSE,
        moving: false,
      };
    }

    return {
      position: nextPos,
      yaw,
      pose,
      moving: true,
    };
  }

  return {
    id: 'procedural-stepper',
    label: 'Step Planner',
    approach: 'Procedural · World foot lock',
    summary:
      'World-space step planner with smooth steering, live redirects, landing recoil, and terrain slope adaptation.',
    reset,
    update,
  };
}
