import { MathUtils } from 'three';
import {
  clampNumber,
  EARTH_GRAVITY_MPS2,
  footRestWorldPosition,
  footWorldToLocalOffset,
  lerpNumber,
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

  // Low-gravity ballistic hop state (Mars / Moon).
  let justReset = true;
  let airHeight = 0;
  let airVelY = 0;
  let airborne = false;
  let crouchTimer = 0;
  let crouchDuration = 0.16;
  let hopLeadSide: 'left' | 'right' = 'left';
  let hopLaunchVel = 0.8;
  let hopVelX = 0;
  let hopVelZ = 0;
  let airStartLeftOffset: Vec3Like = { ...ZERO_VEC3 };
  let airStartRightOffset: Vec3Like = { ...ZERO_VEC3 };

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
    justReset = true;
    airHeight = 0;
    airVelY = 0;
    airborne = false;
    crouchTimer = 0;
    crouchDuration = 0.16;
    hopLeadSide = 'left';
    hopLaunchVel = 0.8;
    hopVelX = 0;
    hopVelZ = 0;
    airStartLeftOffset = { ...ZERO_VEC3 };
    airStartRightOffset = { ...ZERO_VEC3 };
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
    crouchSquash = 0,
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

      const trailBendZ =
        localOffset.z < -0.04 ? clampNumber(-localOffset.z * 0.25, 0, 0.055) : 0;
      const squatBendZ = clampNumber(crouchSquash * 0.11, 0, 0.11);
      const kneeX =
        crouchSquash > 0.02 || localOffset.z < -0.04
          ? sign * Math.max(localOffset.z < -0.04 ? 0.012 : 0, crouchSquash * 0.032)
          : 0;

      return {
        offset: { x: localOffset.x, y: localOffset.y, z: localOffset.z },
        rotation: {
          pitch: slopePitch + pushOffPitch,
          yaw: relYaw,
          roll: slopeRoll,
        },
        kneeBend:
          trailBendZ > 0 || squatBendZ > 0
            ? { x: kneeX, y: 0, z: Math.max(trailBendZ, squatBendZ) }
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

  function buildAirFootPose(
    isLead: boolean,
    side: 'left' | 'right',
    flightU: number,
    hopBlend: number,
    startOffset: Vec3Like,
  ): FootPose {
    const sign = side === 'left' ? -1 : 1;
    const u = clampNumber(flightU, 0, 1);
    const s = smoothstep01(u);
    const tuckArc = Math.sin(u * Math.PI);
    const landFade = 1 - smoothstep01(clampNumber((u - 0.72) / 0.28, 0, 1));
    const startCarry = 1 - s;

    const lift = (isLead ? 0.095 : 0.045) * tuckArc * hopBlend * landFade;
    const forward = (isLead ? 0.13 : -0.10) * tuckArc * hopBlend * landFade;

    let pitch = 0;
    if (isLead) {
      if (u < 0.25) {
        pitch = lerpNumber(0.22, 0.04, smoothstep01(u / 0.25)) * hopBlend;
      } else if (u < 0.78) {
        pitch = lerpNumber(0.04, -0.22, smoothstep01((u - 0.25) / 0.53)) * hopBlend;
      } else {
        pitch = lerpNumber(-0.22, 0, smoothstep01((u - 0.78) / 0.22)) * hopBlend;
      }
    } else if (u < 0.65) {
      pitch = lerpNumber(0.20, 0.26, tuckArc) * hopBlend;
    } else {
      pitch = lerpNumber(0.22, 0, smoothstep01((u - 0.65) / 0.35)) * hopBlend;
    }

    return {
      offset: {
        x: startOffset.x * startCarry,
        y: Math.max(0, startOffset.y * startCarry) + lift,
        z: startOffset.z * startCarry + forward,
      },
      rotation: { pitch, yaw: 0, roll: 0 },
      kneeBend: {
        x: sign * (0.015 + 0.032 * tuckArc * hopBlend),
        y: 0,
        z: (isLead ? 0.095 : 0.048) * tuckArc * hopBlend * landFade,
      },
    };
  }

  function stepBounceSpring(safeDt: number): void {
    const stiffness = 175;
    const damping = 18;
    const springAccel = -stiffness * bounceSpringY - damping * bounceSpringVel;
    bounceSpringVel += springAccel * safeDt;
    bounceSpringY = clampNumber(bounceSpringY + bounceSpringVel * safeDt, -0.05, 0.045);
  }

  function updateLowGravityHop(
    safeDt: number,
    g: number,
    hopBlend: number,
    command: LocomotionCommand,
    state: LocomotionStateSnapshot,
    rig: RigMeasurements,
  ): LocomotionStepResult {
    let yawError = 0;
    let hasTarget = false;
    let distToTarget = 0;

    if (command.target) {
      const dx = command.target.x - state.position.x;
      const dz = command.target.z - state.position.z;
      distToTarget = Math.hypot(dx, dz);
      if (distToTarget > 0.022) {
        hasTarget = true;
        yawError = wrapAngle(Math.atan2(dx, dz) - yaw);
      }
    }

    // Check if an off-rest Earth step was still in flight when gravity dropped.
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
        bounceSpringVel -= 0.22;
      }
    }

    // Trigger takeoff once crouch windup finishes with both boots grounded.
    if (!airborne && !leftFoot.swinging && !rightFoot.swinging && hasTarget && distToTarget > 0.045) {
      crouchDuration = lerpNumber(0.11, 0.20, hopBlend);
      crouchTimer += safeDt;
      if (crouchTimer >= crouchDuration) {
        crouchTimer = 0;
        hopLeadSide = hopLeadSide === 'left' ? 'right' : 'left';
        const shortScale = clampNumber(Math.sqrt(distToTarget / 1.05), 0.42, 1.0);
        const baseLaunch = lerpNumber(0.68, 0.88, hopBlend) * shortScale;
        hopLaunchVel = baseLaunch;
        airVelY = baseLaunch;
        airborne = true;

        const flightTime = (2 * hopLaunchVel) / g;
        const cruiseHopSpeed = Math.min(
          command.maxSpeed * 0.92,
          command.gait === 'run' ? command.maxSpeed : 1.26,
        );
        const alignFactor = Math.max(0.32, Math.cos(yawError * 0.65));
        const desiredHorizDist = Math.min(distToTarget, cruiseHopSpeed * alignFactor * flightTime);
        const launchHorizSpeed = clampNumber(
          desiredHorizDist / Math.max(0.12, flightTime),
          0.06,
          command.maxSpeed * 0.92,
        );
        hopVelX = Math.sin(yaw) * launchHorizSpeed;
        hopVelZ = Math.cos(yaw) * launchHorizSpeed;
        airStartLeftOffset = footWorldToLocalOffset(
          leftFoot.plantedPos,
          state.position,
          yaw,
          rig.leftFootRestLocal,
        );
        airStartRightOffset = footWorldToLocalOffset(
          rightFoot.plantedPos,
          state.position,
          yaw,
          rig.rightFootRestLocal,
        );
      }
    } else if (!airborne) {
      crouchTimer = Math.max(0, crouchTimer - safeDt * 4);
    }

    if (airborne) {
      airVelY -= g * safeDt;
      airHeight += airVelY * safeDt;

      if (hasTarget) {
        const desiredTurn = clampNumber(yawError * 6.5, -4.6, 4.6);
        turnRate = MathUtils.damp(turnRate, desiredTurn, 12, safeDt);
        const stepYaw = clampNumber(turnRate * safeDt, -Math.abs(yawError), Math.abs(yawError));
        yaw = wrapAngle(
          yaw + (Math.abs(yawError) < 1e-4 ? 0 : Math.sign(yawError) * Math.abs(stepYaw)),
        );

        const tRem = Math.max(
          0.08,
          (airVelY + Math.sqrt(Math.max(0, airVelY * airVelY + 2 * g * Math.max(0, airHeight)))) /
            g,
        );
        const speedCap = Math.min(
          command.maxSpeed * 0.92,
          command.gait === 'run' ? command.maxSpeed : 1.26,
        );
        const desiredHorizSpeed = clampNumber(distToTarget / tRem, 0.08, speedCap);
        const steerFactor = Math.max(0.25, Math.cos(yawError * 0.6));
        const desVelX = Math.sin(yaw) * desiredHorizSpeed * steerFactor;
        const desVelZ = Math.cos(yaw) * desiredHorizSpeed * steerFactor;
        hopVelX = MathUtils.damp(hopVelX, desVelX, 2.8, safeDt);
        hopVelZ = MathUtils.damp(hopVelZ, desVelZ, 2.8, safeDt);
      } else {
        turnRate = MathUtils.damp(turnRate, 0, 10, safeDt);
        hopVelX = MathUtils.damp(hopVelX, 0, 4, safeDt);
        hopVelZ = MathUtils.damp(hopVelZ, 0, 4, safeDt);
      }

      const horizSpeed = Math.hypot(hopVelX, hopVelZ);
      const speedCap = command.maxSpeed * 0.96;
      if (horizSpeed > speedCap && horizSpeed > 1e-6) {
        hopVelX *= speedCap / horizSpeed;
        hopVelZ *= speedCap / horizSpeed;
      }

      const nextX = state.position.x + hopVelX * safeDt;
      const nextZ = state.position.z + hopVelZ * safeDt;
      const nextGround = command.sampleGround(nextX, nextZ);

      if (airHeight > 0) {
        restBlend = 0;
        const nextPos: Vec3Like = { x: nextX, y: nextGround.y + airHeight, z: nextZ };
        const flightU = clampNumber(1 - (airVelY / Math.max(0.25, hopLaunchVel) + 1) * 0.5, 0, 1);
        const tuckArc = Math.sin(flightU * Math.PI);
        const leftIsLead = hopLeadSide === 'left';

        stepBounceSpring(safeDt);
        const floatWeight = hopBlend * tuckArc;
        const targetArmSwing = (leftIsLead ? -0.15 : 0.15) * floatWeight;
        smoothedSwayX = MathUtils.damp(
          smoothedSwayX,
          (leftIsLead ? 0.022 : -0.022) * floatWeight,
          10,
          safeDt,
        );
        smoothedRollZ = MathUtils.damp(smoothedRollZ, -turnRate * 0.036, 10, safeDt);
        smoothedPitchX = MathUtils.damp(
          smoothedPitchX,
          lerpNumber(0.14, 0.035, tuckArc) * hopBlend,
          8,
          safeDt,
        );
        smoothedTwistY = MathUtils.damp(
          smoothedTwistY,
          (leftIsLead ? -0.095 : 0.095) * floatWeight,
          10,
          safeDt,
        );
        smoothedArmSwing = MathUtils.damp(smoothedArmSwing, targetArmSwing, 10, safeDt);
        smoothedHeadYaw = MathUtils.damp(
          smoothedHeadYaw,
          hasTarget ? clampNumber(yawError * 0.35, -0.28, 0.28) : 0,
          10,
          safeDt,
        );

        const floatSpread = (0.04 + 0.13 * tuckArc) * hopBlend;
        const floatLift = (0.045 + 0.16 * tuckArc) * hopBlend;
        const leftArmZ = smoothedArmSwing;
        const rightArmZ = -smoothedArmSwing;

        const pose: CapsuleHumanPose = {
          torsoOffset: { x: smoothedSwayX, y: bounceSpringY, z: 0 },
          torsoRotation: { pitch: smoothedPitchX, yaw: smoothedTwistY, roll: smoothedRollZ },
          headOffset: ZERO_VEC3,
          headRotation: {
            pitch: -smoothedPitchX * 0.45 - 0.045 * tuckArc * hopBlend,
            yaw: smoothedHeadYaw - smoothedTwistY * 0.4,
            roll: -smoothedRollZ * 0.48,
          },
          leftFoot: buildAirFootPose(leftIsLead, 'left', flightU, hopBlend, airStartLeftOffset),
          rightFoot: buildAirFootPose(
            !leftIsLead,
            'right',
            flightU,
            hopBlend,
            airStartRightOffset,
          ),
          leftHand: {
            offset: {
              x: -floatSpread - Math.abs(leftArmZ) * 0.06,
              y: floatLift + Math.max(0, leftArmZ) * 0.18,
              z: leftArmZ,
            },
            rotation: { pitch: -leftArmZ * 1.1 - 0.15 * floatWeight, yaw: 0, roll: -0.24 * floatWeight },
            elbowBend: { x: -0.045 * floatWeight, y: 0, z: -0.05 + leftArmZ * 0.12 },
          },
          rightHand: {
            offset: {
              x: floatSpread + Math.abs(rightArmZ) * 0.06,
              y: floatLift + Math.max(0, rightArmZ) * 0.18,
              z: rightArmZ,
            },
            rotation: { pitch: -rightArmZ * 1.1 - 0.15 * floatWeight, yaw: 0, roll: 0.24 * floatWeight },
            elbowBend: { x: 0.045 * floatWeight, y: 0, z: -0.05 + rightArmZ * 0.12 },
          },
          restBlend: 0,
        };

        return { position: nextPos, yaw, pose, moving: true };
      }

      // Touchdown! Lock both boots seamlessly at current stance and trigger landing recoil.
      airHeight = 0;
      airVelY = 0;
      airborne = false;
      crouchTimer = 0;
      velX = 0;
      velZ = 0;
      hopVelX = 0;
      hopVelZ = 0;
      const landedPos: Vec3Like = { x: nextX, y: nextGround.y, z: nextZ };
      const leftRest = footRestWorldPosition(landedPos, yaw, rig.leftFootRestLocal);
      const rightRest = footRestWorldPosition(landedPos, yaw, rig.rightFootRestLocal);
      leftFoot = makeFootState(
        { x: leftRest.x, y: command.sampleGround(leftRest.x, leftRest.z).y, z: leftRest.z },
        yaw,
      );
      rightFoot = makeFootState(
        { x: rightRest.x, y: command.sampleGround(rightRest.x, rightRest.z).y, z: rightRest.z },
        yaw,
      );
      bounceSpringVel -= 0.28 + 0.18 * hopBlend;
    }

    // Grounded low-gravity crouch, landing absorption, or final settle.
    let nextX = state.position.x;
    let nextZ = state.position.z;
    velX = 0;
    velZ = 0;

    if (hasTarget && distToTarget > 0.045) {
      const desiredTurn = clampNumber(yawError * 7.0, -5.2, 5.2);
      turnRate = MathUtils.damp(turnRate, desiredTurn, 16, safeDt);
      const stepYaw = clampNumber(turnRate * safeDt, -Math.abs(yawError), Math.abs(yawError));
      const proposedYaw = wrapAngle(
        yaw + (Math.abs(yawError) < 1e-4 ? 0 : Math.sign(yawError) * Math.abs(stepYaw)),
      );
      if (
        Math.abs(wrapAngle(proposedYaw - leftFoot.plantedYaw)) < 0.45 &&
        Math.abs(wrapAngle(proposedYaw - rightFoot.plantedYaw)) < 0.45
      ) {
        yaw = proposedYaw;
      }
    } else {
      turnRate = MathUtils.damp(turnRate, 0, 14, safeDt);
      if (command.target && distToTarget <= 0.045) {
        nextX = MathUtils.damp(state.position.x, command.target.x, 18, safeDt);
        nextZ = MathUtils.damp(state.position.z, command.target.z, 18, safeDt);
        if (Math.hypot(command.target.x - nextX, command.target.z - nextZ) < 0.005) {
          nextX = command.target.x;
          nextZ = command.target.z;
        }
      }
    }

    const nextGround = command.sampleGround(nextX, nextZ);
    const nextPos: Vec3Like = { x: nextX, y: nextGround.y, z: nextZ };
    const isSettling = !hasTarget || distToTarget <= 0.045;
    const readyToSettleFeet =
      !command.target ||
      Math.hypot(command.target.x - nextX, command.target.z - nextZ) <= 0.002;

    if (isSettling && readyToSettleFeet && !leftFoot.swinging && !rightFoot.swinging) {
      const leftIdeal = footRestWorldPosition(nextPos, yaw, rig.leftFootRestLocal);
      const rightIdeal = footRestWorldPosition(nextPos, yaw, rig.rightFootRestLocal);
      const leftErr = Math.hypot(
        leftFoot.plantedPos.x - leftIdeal.x,
        leftFoot.plantedPos.z - leftIdeal.z,
      );
      const rightErr = Math.hypot(
        rightFoot.plantedPos.x - rightIdeal.x,
        rightFoot.plantedPos.z - rightIdeal.z,
      );
      if (leftErr > 0.0012 && leftErr >= rightErr) {
        startSwing(
          leftFoot,
          rightFoot,
          'left',
          rig.leftFootRestLocal,
          nextPos,
          yaw,
          0,
          0,
          command.sampleGround,
          true,
        );
      } else if (rightErr > 0.0012) {
        startSwing(
          rightFoot,
          leftFoot,
          'right',
          rig.rightFootRestLocal,
          nextPos,
          yaw,
          0,
          0,
          command.sampleGround,
          true,
        );
      }
    }

    const leftRestWorld = footRestWorldPosition(nextPos, yaw, rig.leftFootRestLocal);
    const rightRestWorld = footRestWorldPosition(nextPos, yaw, rig.rightFootRestLocal);
    const feetSettled =
      !leftFoot.swinging &&
      !rightFoot.swinging &&
      Math.hypot(leftFoot.plantedPos.x - leftRestWorld.x, leftFoot.plantedPos.z - leftRestWorld.z) <
        0.0015 &&
      Math.hypot(
        rightFoot.plantedPos.x - rightRestWorld.x,
        rightFoot.plantedPos.z - rightRestWorld.z,
      ) < 0.0015;

    const stillActive =
      hasTarget || !readyToSettleFeet || leftFoot.swinging || rightFoot.swinging || !feetSettled;
    restBlend = MathUtils.damp(restBlend, stillActive ? 0 : 1, stillActive ? 22 : 16, safeDt);

    stepBounceSpring(safeDt);
    const crouchNorm =
      !isSettling && crouchDuration > 0 ? clampNumber(crouchTimer / crouchDuration, 0, 1) : 0;
    const crouchSquash = Math.sin(crouchNorm * Math.PI);
    const crouchDip = -crouchSquash * (0.048 + 0.042 * hopBlend);
    const kneeSquash = clampNumber(crouchSquash + Math.max(0, -bounceSpringY) * 14, 0, 1);

    smoothedSwayX = MathUtils.damp(smoothedSwayX, 0, 12, safeDt);
    smoothedRollZ = MathUtils.damp(smoothedRollZ, -turnRate * 0.03, 12, safeDt);
    smoothedPitchX = MathUtils.damp(
      smoothedPitchX,
      hasTarget ? (0.14 + 0.04 * hopBlend) * crouchSquash + 0.05 : 0,
      12,
      safeDt,
    );
    smoothedTwistY = MathUtils.damp(smoothedTwistY, 0, 12, safeDt);
    smoothedArmSwing = MathUtils.damp(smoothedArmSwing, -0.15 * crouchSquash * hopBlend, 12, safeDt);
    smoothedHeadYaw = MathUtils.damp(
      smoothedHeadYaw,
      hasTarget ? clampNumber(yawError * 0.38, -0.28, 0.28) : 0,
      10,
      safeDt,
    );

    const moving = stillActive || restBlend < 0.995;
    if (!moving) {
      return {
        position: nextPos,
        yaw,
        pose: REST_CAPSULE_HUMAN_POSE,
        moving: false,
      };
    }

    const crouchArmSpread = 0.045 * crouchSquash * hopBlend;
    const pose: CapsuleHumanPose = {
      torsoOffset: {
        x: smoothedSwayX,
        y: bounceSpringY + crouchDip,
        z: 0,
      },
      torsoRotation: {
        pitch: smoothedPitchX,
        yaw: smoothedTwistY,
        roll: smoothedRollZ,
      },
      headOffset: ZERO_VEC3,
      headRotation: {
        pitch: -smoothedPitchX * 0.3 + bounceSpringY * 0.5,
        yaw: smoothedHeadYaw,
        roll: -smoothedRollZ * 0.45,
      },
      leftFoot: buildFootPose(
        leftFoot,
        rightFoot,
        'left',
        rig.leftFootRestLocal,
        nextPos,
        yaw,
        command.sampleGround,
        isSettling && !hasTarget,
        kneeSquash,
      ),
      rightFoot: buildFootPose(
        rightFoot,
        leftFoot,
        'right',
        rig.rightFootRestLocal,
        nextPos,
        yaw,
        command.sampleGround,
        isSettling && !hasTarget,
        kneeSquash,
      ),
      leftHand: {
        offset: {
          x: -crouchArmSpread,
          y: Math.abs(smoothedArmSwing) * 0.25,
          z: smoothedArmSwing,
        },
        rotation: { pitch: -smoothedArmSwing * 1.15, yaw: 0, roll: -0.08 * crouchSquash },
        elbowBend: { x: -0.025, y: 0, z: -0.045 + smoothedArmSwing * 0.12 },
      },
      rightHand: {
        offset: {
          x: crouchArmSpread,
          y: Math.abs(smoothedArmSwing) * 0.25,
          z: smoothedArmSwing,
        },
        rotation: { pitch: -smoothedArmSwing * 1.15, yaw: 0, roll: 0.08 * crouchSquash },
        elbowBend: { x: 0.025, y: 0, z: -0.045 + smoothedArmSwing * 0.12 },
      },
      restBlend: stillActive ? 0 : restBlend,
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
        airborne = true;
        airHeight = startAir;
        airVelY = state.velocity.y;
        hopLaunchVel = Math.max(0.55, Math.abs(state.velocity.y));
        hopVelX = state.velocity.x;
        hopVelZ = state.velocity.z;
      }
    }

    const g = clampNumber(command.gravity, 0.4, 25);
    const gRatio = g / EARTH_GRAVITY_MPS2;
    const hopBlend = smoothstep01((0.65 - gRatio) / 0.42);
    if (hopBlend > 0.05 || airborne) {
      return updateLowGravityHop(safeDt, g, hopBlend, command, state, rig);
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
      'World-space step planner with smooth steering, live redirects, landing recoil, terrain slopes, and Earth/Mars/Moon gravity hops.',
    reset,
    update,
  };
}
