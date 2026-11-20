import { Box3, Vector3 } from 'three';
import { CAPSULE_SPACESUIT_PRESETS, type CapsuleSpacesuitPreset } from '../character-studio/capsule-spacesuit-presets';
import { buildExperimentalPigtailBody } from '../character-studio/experimental-pigtail-body';
import {
  blendCapsuleHumanPoses,
  createFlatGroundSampler,
  createRestCapsuleHumanPose,
  wrapAngle,
  ZERO_EULER,
  ZERO_VEC3,
  type CapsuleHumanPose,
} from './motion/capsule-motion-types';
import { createBaselineLocomotionPlugin } from './motion/baseline-locomotion.plugin';
import { createDefaultLocomotionPlugins } from './motion/locomotion-registry';
import { buildPigtailSandboxWalker } from './pigtail-sandbox-walker';

describe('Capsule spacesuit pose rig & locomotion plugins', () => {
  it('preserves exact rest silhouette, collar head height, and prop sockets on the upgraded body', () => {
    const body = buildExperimentalPigtailBody();
    try {
      body.root.updateMatrixWorld(true);
      const headWorldPos = body.headSocket.getWorldPosition(new Vector3());
      const headWorldScale = body.headSocket.getWorldScale(new Vector3());
      expect(headWorldPos.y).toBeCloseTo(7.95 * 0.35 * 0.55, 2);
      expect(headWorldScale.x).toBeCloseTo(0.55, 5);
      expect(body.leftPropSocket.name).toBe('pigtail-prop-socket-left');
      expect(body.rightPropSocket.name).toBe('pigtail-prop-socket-right');

      for (const side of ['left', 'right']) {
        const boot = body.root.getObjectByName(`pigtail-boot-${side}`)!;
        expect(new Box3().setFromObject(boot, true).min.y).toBeCloseTo(0, 6);
      }

      // Heel-strike and toe-off should lift the ankle automatically so soles never clip below y = 0.
      const baseHeadZ = headWorldPos.z;
      const testPose: CapsuleHumanPose = {
        ...createRestCapsuleHumanPose(),
        torsoRotation: { pitch: 0.25, yaw: 0, roll: 0 },
        leftFoot: { offset: ZERO_VEC3, rotation: { pitch: -0.25, yaw: 0, roll: 0 } },
        rightFoot: { offset: ZERO_VEC3, rotation: { pitch: 0.25, yaw: 0, roll: 0 } },
        restBlend: 0,
      };
      body.setPose(testPose);
      body.root.updateMatrixWorld(true);

      for (const side of ['left', 'right']) {
        const boot = body.root.getObjectByName(`pigtail-boot-${side}`)!;
        expect(new Box3().setFromObject(boot, true).min.y).toBeGreaterThanOrEqual(-0.002);
      }
      expect(body.headSocket.getWorldPosition(new Vector3()).z).toBeGreaterThan(baseHeadZ + 0.08);

      body.setPose(createRestCapsuleHumanPose());
      body.root.updateMatrixWorld(true);
      expect(body.headSocket.getWorldPosition(new Vector3()).z).toBeCloseTo(baseHeadZ, 6);
    } finally {
      body.dispose();
    }
  });

  it('uses the reviewed Shaggy proportions on the shared spacesuit rig', () => {
    const orange = buildPigtailSandboxWalker();
    const shaggy = buildPigtailSandboxWalker({ preset: 'shaggy' });
    try {
      orange.root.updateMatrixWorld(true);
      shaggy.root.updateMatrixWorld(true);
      const skin = (root: typeof shaggy.root) => root.getObjectByName('pigtail-skin')!;
      const head = (root: typeof shaggy.root) => new Box3().setFromObject(skin(root), true);
      const pack = (root: typeof shaggy.root) => new Box3().setFromObject(root.getObjectByName('pigtail-backpack')!, true);
      const size = (bounds: Box3) => bounds.getSize(new Vector3());
      expect(shaggy.root.getObjectByName('shaggy-ears')?.visible).toBeTrue();
      expect(orange.root.getObjectByName('shaggy-ears')?.visible).toBeFalse();
      expect(size(head(shaggy.root)).y / size(head(orange.root)).y).toBeCloseTo(.91 * 1.20, 5);
      expect(size(head(shaggy.root)).x / size(head(orange.root)).x).toBeCloseTo(1.075, 5);
      expect(size(pack(shaggy.root)).x / size(pack(orange.root)).x).toBeCloseTo(1.32, 5);
      expect(shaggy.measurements.hipHeight).toBeCloseTo(orange.measurements.hipHeight * .91, 5);
    } finally {
      orange.dispose();
      shaggy.dispose();
    }
  });

  it('blends full-body and masked partial-body poses cleanly', () => {
    const rest = createRestCapsuleHumanPose();
    const wavePose: CapsuleHumanPose = {
      torsoOffset: { x: 0.1, y: 0.04, z: 0 },
      torsoRotation: { pitch: 0.2, yaw: 0.3, roll: -0.1 },
      headOffset: ZERO_VEC3,
      headRotation: ZERO_EULER,
      leftFoot: { offset: { x: 0, y: 0.12, z: 0.2 }, rotation: ZERO_EULER },
      rightFoot: { offset: ZERO_VEC3, rotation: ZERO_EULER },
      leftHand: { offset: { x: 0, y: 0.2, z: 0 }, rotation: ZERO_EULER },
      rightHand: { offset: { x: 0.2, y: 0.4, z: 0.1 }, rotation: { pitch: -0.8, yaw: 0, roll: 0.4 } },
      restBlend: 0,
    };

    const full = blendCapsuleHumanPoses(rest, wavePose, 0.5, 'full-body');
    expect(full.torsoOffset.x).toBeCloseTo(0.05, 5);
    expect(full.leftFoot.offset.z).toBeCloseTo(0.1, 5);

    const rightArmOnly = blendCapsuleHumanPoses(rest, wavePose, 0.5, 'right-arm');
    expect(rightArmOnly.rightHand.offset.y).toBeCloseTo(0.2, 5);
    expect(rightArmOnly.rightHand.rotation.pitch).toBeCloseTo(-0.4, 5);
    expect(rightArmOnly.torsoOffset.x).toBe(0);
    expect(rightArmOnly.leftFoot.offset.z).toBe(0);
    expect(rightArmOnly.leftHand.offset.y).toBe(0);
  });

  for (const pluginFactory of createDefaultLocomotionPlugins()) {
    const pluginId = pluginFactory.id;

    describe(`plugin: ${pluginId}`, () => {
      let walker: ReturnType<typeof buildPigtailSandboxWalker> | undefined;

      function createWalker(preset?: CapsuleSpacesuitPreset) {
        const plugin =
          createDefaultLocomotionPlugins().find((p) => p.id === pluginId)!;
        walker = buildPigtailSandboxWalker({
          preset,
          plugin,
          sampleGround: createFlatGroundSampler(0),
          maxSpeed: 1.4,
        });
        return walker;
      }

      afterEach(() => {
        walker?.dispose();
        walker = undefined;
      });

      function verifyWalk(walker: ReturnType<typeof buildPigtailSandboxWalker>): void {
        const boots = ['left', 'right'].map(
          (side) => walker.root.getObjectByName(`pigtail-boot-${side}`)!,
        );
        const restLocal = boots.map((boot) => boot.position.clone());
        const previous = boots.map((boot) => boot.getWorldPosition(new Vector3()));
        const restHeight = previous.map((foot) => foot.y);
        const lift = [0, 0];
        let plantedSamples = 0;

        const target = new Vector3(1.8, 0, 2.4);
        expect(walker.walkTo(target)).toBeTrue();

        for (let frame = 0; frame < 450 && walker.walking; frame++) {
          walker.update(1 / 90);
          const feet = boots.map((boot) => boot.getWorldPosition(new Vector3()));
          const heights = feet.map((foot, index) => foot.y - restHeight[index]);
          feet.forEach((foot, index) => {
            lift[index] = Math.max(lift[index], heights[index]);
            if (frame > 0 && heights[index] < 1e-7 && previous[index].y - restHeight[index] < 1e-7) {
              const slip = foot.distanceTo(previous[index]);
              expect(slip).toBeLessThan(pluginId === 'baseline-distance' ? 0.0001 : 0.001);
              plantedSamples++;
            }
            const soleMin = new Box3().setFromObject(boots[index], true).min.y;
            expect(soleMin).toBeGreaterThanOrEqual(-0.003);
            previous[index].copy(foot);
          });
        }

        expect(plantedSamples).toBeGreaterThan(20);
        lift.forEach((height) => expect(height).toBeGreaterThan(0.07));
        expect(walker.walking).toBeFalse();
        expect(walker.root.position.distanceTo(target)).toBeLessThan(0.04);
        expect(walker.metrics.peakSpeedMps).toBeLessThanOrEqual(1.42);
        boots.forEach((boot, index) => {
          expect(boot.position.distanceTo(restLocal[index])).toBeLessThan(0.005);
          expect(new Box3().setFromObject(boot, true).min.y).toBeCloseTo(0, 4);
        });
      }

      for (const preset of CAPSULE_SPACESUIT_PRESETS) {
        it(`${preset.label} plants its feet, lifts both boots, and settles at the destination`, () => {
          verifyWalk(createWalker(preset.id));
        });
      }

      if (pluginId !== 'baseline-distance') {
        it('supports live mid-walk redirection with smooth turns, boot pitch, and torso weight', () => {
          const walker = createWalker();
          const leg1 = new Vector3(0, 0, 2.5);
          const leg2 = new Vector3(2.2, 0, -1.2);
          walker.walkTo(leg1);

          let maxYawDelta = 0;
          let maxBootPitch = 0;
          let maxTorsoAngle = 0;
          let redirected = false;
          let prevYaw = walker.root.rotation.y;

          const leftBoot = walker.root.getObjectByName('pigtail-boot-left')!;
          const rightBoot = walker.root.getObjectByName('pigtail-boot-right')!;
          const torso = walker.root.getObjectByName('pigtail-torso')!;

          for (let frame = 0; frame < 420 && walker.walking; frame++) {
            walker.update(1 / 60);
            if (!redirected && walker.root.position.z > 0.9) {
              redirected = true;
              walker.walkTo(leg2);
            }
            const dyaw = Math.abs(wrapAngle(walker.root.rotation.y - prevYaw));
            maxYawDelta = Math.max(maxYawDelta, dyaw);
            prevYaw = walker.root.rotation.y;

            maxBootPitch = Math.max(
              maxBootPitch,
              Math.abs(leftBoot.rotation.x),
              Math.abs(rightBoot.rotation.x),
            );
            const torsoRot = torso.parent!.parent!.rotation;
            maxTorsoAngle = Math.max(
              maxTorsoAngle,
              Math.abs(torsoRot.x),
              Math.abs(torsoRot.y),
              Math.abs(torsoRot.z),
            );
          }

          expect(redirected).toBeTrue();
          expect(walker.walking).toBeFalse();
          expect(walker.root.position.distanceTo(leg2)).toBeLessThan(0.04);
          expect(maxYawDelta).toBeLessThan(0.2);
          expect(maxBootPitch).toBeGreaterThan(0.12);
          expect(maxTorsoAngle).toBeGreaterThan(0.03);
        });
      }
    });
  }

  it('keeps Baseline queued-destination behavior intact', () => {
    const walker = buildPigtailSandboxWalker({
      plugin: createBaselineLocomotionPlugin(),
      sampleGround: createFlatGroundSampler(0),
    });
    try {
      const first = new Vector3(0, 0, 1);
      const last = new Vector3(-1, 0, 1);
      expect(walker.walkTo(walker.root.position)).toBeFalse();
      walker.walkTo(first);
      walker.update(0.1);
      walker.walkTo(new Vector3(1, 0, 1));
      walker.walkTo(last);

      walker.update(2);
      expect(walker.root.position).toEqual(first);
      expect(walker.walking).toBeTrue();
      walker.update(2);
      expect(walker.root.position).toEqual(last);
      expect(walker.walking).toBeFalse();
    } finally {
      walker.dispose();
    }
  });

  it('supports hot-swapping plugins and completing the deterministic 3-leg comparison course', () => {
    const plugins = createDefaultLocomotionPlugins();
    const walker = buildPigtailSandboxWalker({
      plugin: plugins[1],
      sampleGround: createFlatGroundSampler(0),
    });
    try {
      walker.startComparisonCourse();
      for (let frame = 0; frame < 600 && walker.walking; frame++) {
        if (frame === 120) {
          walker.setPlugin(plugins[2]);
        }
        walker.update(1 / 60);
      }

      expect(walker.walking).toBeFalse();
      expect(walker.courseStage).toBeNull();
      expect(Number.isFinite(walker.root.position.x)).toBeTrue();
      expect(Number.isFinite(walker.root.position.z)).toBeTrue();
      expect(walker.root.position.distanceTo(new Vector3(0, 0, 0.35))).toBeLessThan(0.06);
      expect(walker.metrics.stepCount).toBeGreaterThan(4);
    } finally {
      walker.dispose();
    }
  });
});
