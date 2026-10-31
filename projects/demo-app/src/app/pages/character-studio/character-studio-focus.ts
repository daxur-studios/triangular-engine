import { Box3, Object3D, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { CapsuleCatActor, CapsuleCharacterActor } from 'triangular-engine/procedural';

/**
 * Scene-owned visual focus targets used by capsule character review and framing.
 */
export type VisualFocusTargetId =
  | 'human-face'
  | 'human-head-hair'
  | 'human-mouth'
  | 'human-eyes'
  | 'human-hand-prop'
  | 'human-full-body'
  | 'cat-face'
  | 'cat-mouth'
  | 'cat-full-body';

export type VisualFocusBoundsKind = 'scene-object' | 'synthetic-shader' | 'composite';

/**
 * Scene-owned description of a visual focus region in world space.
 */
export interface VisualFocusTargetDescription {
  readonly id: VisualFocusTargetId;
  readonly label: string;
  readonly boundsKind: VisualFocusBoundsKind;
  readonly worldBounds: Box3;
  readonly forwardNormal: Vector3;
  readonly defaultPadding: number;
  readonly subBounds: {
    readonly sceneGeometry?: Box3;
    readonly shaderMouth?: Box3;
  };
  readonly limitations: readonly string[];
}

/**
 * Normalized `[x, y, width, height]` rectangle in `0..1` image space (top-left origin),
 * compatible with `TestReviewAnnotation.rect`.
 */
export type NormalizedViewportRect = readonly [number, number, number, number];

export interface CameraFocusFitOptions {
  /** Vertical field of view in degrees (default `42`). */
  readonly fovDegrees?: number;
  /** Viewport aspect ratio `width / height` (default `16 / 9`). */
  readonly aspect?: number;
  /** Fractional margin around the target bounds (e.g. `0.22` adds 22% padding). */
  readonly padding?: number;
  /** Optional pitch offset in radians (positive looks slightly down from above). */
  readonly elevationRadians?: number;
}

export interface ResolvedFocusFraming {
  readonly targetId: VisualFocusTargetId;
  readonly label: string;
  readonly boundsKind: VisualFocusBoundsKind;
  readonly cameraPosition: readonly [number, number, number];
  readonly cameraTarget: readonly [number, number, number];
  readonly cameraDistance: number;
  readonly worldMin: readonly [number, number, number];
  readonly worldMax: readonly [number, number, number];
  readonly projectedRect: NormalizedViewportRect;
  readonly shaderMouthRect?: NormalizedViewportRect;
  readonly inFrame: boolean;
  readonly occupancy: number;
  readonly limitations: readonly string[];
}

export interface CharacterStudioFocusSceneActors {
  readonly humanActor?: CapsuleCharacterActor;
  readonly catActor?: CapsuleCatActor;
}

const WORLD_UP = new Vector3(0, 1, 0);

function expandBoxByObject(box: Box3, obj: Object3D | undefined): void {
  if (!obj || !obj.visible) return;
  obj.updateWorldMatrix(true, true);
  const temp = new Box3().setFromObject(obj);
  if (!temp.isEmpty()) {
    box.union(temp);
  }
}

function getActorWorldForward(root: Object3D): Vector3 {
  root.updateWorldMatrix(true, false);
  const worldQuat = new Quaternion();
  root.getWorldQuaternion(worldQuat);
  const forward = new Vector3(0, 0, 1).applyQuaternion(worldQuat).normalize();
  if (forward.lengthSq() < 1e-6) {
    return new Vector3(0, 0, 1);
  }
  return forward;
}

/**
 * Resolves a scene-owned `VisualFocusTargetDescription` from live character actors.
 *
 * Combines measurable Three.js scene-object bounds with deterministic synthetic
 * bounds for 2D SDF shader-created mouths derived directly from shader uniforms.
 */
export function resolveCharacterStudioFocusTarget(
  targetId: VisualFocusTargetId,
  actors: CharacterStudioFocusSceneActors,
): VisualFocusTargetDescription {
  switch (targetId) {
    case 'human-mouth': {
      const human = actors.humanActor;
      if (!human) {
        return createFallbackFocusTarget(targetId, 'Human 2D SDF Mouth');
      }
      human.root.updateMatrixWorld(true);
      const shaderMouth = human.capsuleBody.getMouthWorldBounds();
      const worldBounds = shaderMouth.clone();
      return {
        id: targetId,
        label: 'Human 2D SDF Mouth (shader-derived)',
        boundsKind: 'synthetic-shader',
        worldBounds,
        forwardNormal: getActorWorldForward(human.torsoGroup),
        defaultPadding: 0.45,
        subBounds: { shaderMouth },
        limitations: [
          'Mouth is rendered in fragment shader on the capsule cylinder; 3D bounds are synthesized from uBodyRadius, uMouthCenterY, uMouthWidth, uMouthOpen, and uMouthCurve.',
        ],
      };
    }

    case 'human-eyes': {
      const human = actors.humanActor;
      if (!human) {
        return createFallbackFocusTarget(targetId, 'Human Googly Eyes & Brows');
      }
      human.root.updateMatrixWorld(true);
      const sceneGeometry = new Box3();
      expandBoxByObject(sceneGeometry, human.capsuleFaceRig.leftEye.root);
      expandBoxByObject(sceneGeometry, human.capsuleFaceRig.rightEye.root);
      expandBoxByObject(sceneGeometry, human.capsuleFaceRig.leftBrow);
      expandBoxByObject(sceneGeometry, human.capsuleFaceRig.rightBrow);
      expandBoxByObject(sceneGeometry, human.capsuleFaceRig.noseMesh);
      return {
        id: targetId,
        label: 'Human Googly Eyes & Brows',
        boundsKind: 'scene-object',
        worldBounds: sceneGeometry.clone(),
        forwardNormal: getActorWorldForward(human.torsoGroup),
        defaultPadding: 0.35,
        subBounds: { sceneGeometry },
        limitations: [],
      };
    }

    case 'human-face': {
      const human = actors.humanActor;
      if (!human) {
        return createFallbackFocusTarget(targetId, 'Human Face (Eyes, Brows, Nose & Shader Mouth)');
      }
      human.root.updateMatrixWorld(true);
      const sceneGeometry = new Box3();
      expandBoxByObject(sceneGeometry, human.capsuleFaceRig.leftEye.root);
      expandBoxByObject(sceneGeometry, human.capsuleFaceRig.rightEye.root);
      expandBoxByObject(sceneGeometry, human.capsuleFaceRig.leftBrow);
      expandBoxByObject(sceneGeometry, human.capsuleFaceRig.rightBrow);
      expandBoxByObject(sceneGeometry, human.capsuleFaceRig.noseMesh);
      expandBoxByObject(sceneGeometry, human.capsuleHairKit.facialHairGroup);
      if (human.dna.hairStyleId === 'sprout') {
        expandBoxByObject(sceneGeometry, human.capsuleHairKit.root);
      }

      const shaderMouth = human.capsuleBody.getMouthWorldBounds();
      const worldBounds = sceneGeometry.clone().union(shaderMouth);

      // Include capsule cheek width, chin margin above collar seam, and forehead margin above brows
      // so the complete face reads naturally without wide-angle close-up distortion.
      const bodyCenter = new Vector3();
      worldBounds.getCenter(bodyCenter);
      const r = human.dna.bodyRadius;
      const cheekHalfWidth = r * 1.1;
      worldBounds.min.x = Math.min(worldBounds.min.x, bodyCenter.x - cheekHalfWidth);
      worldBounds.max.x = Math.max(worldBounds.max.x, bodyCenter.x + cheekHalfWidth);
      worldBounds.min.y -= r * 0.24;
      worldBounds.max.y += r * 0.28;

      return {
        id: targetId,
        label: 'Human Face (Eyes, Brows, Nose & Shader Mouth)',
        boundsKind: 'composite',
        worldBounds,
        forwardNormal: getActorWorldForward(human.torsoGroup),
        defaultPadding: 0.34,
        subBounds: { sceneGeometry, shaderMouth },
        limitations: [
          'Combines Three.js eye/brow/nose mesh bounds with synthetic shader mouth bounds derived from capsule body uniforms.',
        ],
      };
    }

    case 'human-head-hair': {
      const human = actors.humanActor;
      if (!human) {
        return createFallbackFocusTarget(targetId, 'Human Head, Hair & Face');
      }
      human.root.updateMatrixWorld(true);
      const sceneGeometry = new Box3();
      expandBoxByObject(sceneGeometry, human.capsuleFaceRig.root);
      expandBoxByObject(sceneGeometry, human.capsuleHairKit.root);
      expandBoxByObject(sceneGeometry, human.capsuleSpaceGear.headGearGroup);

      // Ensure the top dome of the capsule head and collar seam are included even when bald and helmetless
      const headTopLocal = new Vector3(
        0,
        human.dna.bodyHeight * 0.5 + human.dna.bodyRadius * 1.04,
        human.dna.bodyRadius,
      );
      const headBottomLocal = new Vector3(
        0,
        -human.dna.bodyHeight * 0.04,
        human.dna.bodyRadius,
      );
      const headLeftLocal = new Vector3(-human.dna.bodyRadius * 1.08, human.dna.bodyHeight * 0.25, 0);
      const headRightLocal = new Vector3(human.dna.bodyRadius * 1.08, human.dna.bodyHeight * 0.25, 0);
      for (const pt of [headTopLocal, headBottomLocal, headLeftLocal, headRightLocal]) {
        sceneGeometry.expandByPoint(pt.applyMatrix4(human.capsuleBody.mesh.matrixWorld));
      }

      const shaderMouth = human.capsuleBody.getMouthWorldBounds();
      const worldBounds = sceneGeometry.clone().union(shaderMouth);

      return {
        id: targetId,
        label: 'Human Head, Hair, Headgear & Face',
        boundsKind: 'composite',
        worldBounds,
        forwardNormal: getActorWorldForward(human.torsoGroup),
        defaultPadding: 0.22,
        subBounds: { sceneGeometry, shaderMouth },
        limitations: [
          'Includes top capsule dome, modular hair kit, headgear/helmet/eyewear, and synthetic shader mouth bounds.',
        ],
      };
    }

    case 'human-hand-prop': {
      const human = actors.humanActor;
      if (!human) {
        return createFallbackFocusTarget(targetId, 'Human Hand & Held Prop');
      }
      human.root.updateMatrixWorld(true);
      const sceneGeometry = new Box3();
      expandBoxByObject(sceneGeometry, human.capsuleSpaceGear.handPropGroup);
      expandBoxByObject(sceneGeometry, human.leftHand.root);
      if (sceneGeometry.isEmpty()) {
        expandBoxByObject(sceneGeometry, human.rightHand.root);
      }
      return {
        id: targetId,
        label: 'Human Hand & Held Accessory',
        boundsKind: 'scene-object',
        worldBounds: sceneGeometry.clone(),
        forwardNormal: getActorWorldForward(human.torsoGroup),
        defaultPadding: 0.35,
        subBounds: { sceneGeometry },
        limitations: [],
      };
    }

    case 'human-full-body': {
      const human = actors.humanActor;
      if (!human) {
        return createFallbackFocusTarget(targetId, 'Human Full Body');
      }
      human.root.updateMatrixWorld(true);
      const sceneGeometry = new Box3().setFromObject(human.root);
      const shaderMouth = human.capsuleBody.getMouthWorldBounds();
      const worldBounds = sceneGeometry.clone().union(shaderMouth);
      return {
        id: targetId,
        label: 'Human Full Body',
        boundsKind: 'composite',
        worldBounds,
        forwardNormal: getActorWorldForward(human.root),
        defaultPadding: 0.18,
        subBounds: { sceneGeometry, shaderMouth },
        limitations: [],
      };
    }

    case 'cat-mouth': {
      const cat = actors.catActor;
      if (!cat) {
        return createFallbackFocusTarget(targetId, 'Cat 2D SDF :3 Mouth');
      }
      cat.root.updateMatrixWorld(true);
      const shaderMouth = cat.catBody.getMouthWorldBounds();
      return {
        id: targetId,
        label: 'Cat 2D SDF :3 Mouth (shader-derived)',
        boundsKind: 'synthetic-shader',
        worldBounds: shaderMouth.clone(),
        forwardNormal: getActorWorldForward(cat.torsoGroup),
        defaultPadding: 0.45,
        subBounds: { shaderMouth },
        limitations: [
          'Cat :3 omega mouth is rendered in fragment shader on the front hemisphere cap; bounds are synthesized from cat body shader uniforms.',
        ],
      };
    }

    case 'cat-face': {
      const cat = actors.catActor;
      if (!cat) {
        return createFallbackFocusTarget(targetId, 'Cat Face (Ears, Eyes, Whiskers & :3 Mouth)');
      }
      cat.root.updateMatrixWorld(true);
      const sceneGeometry = new Box3();
      expandBoxByObject(sceneGeometry, cat.catFaceRig.root);
      const shaderMouth = cat.catBody.getMouthWorldBounds();
      const worldBounds = sceneGeometry.clone().union(shaderMouth);

      return {
        id: targetId,
        label: 'Cat Face (Ears, Eyes, Whiskers & :3 Mouth)',
        boundsKind: 'composite',
        worldBounds,
        forwardNormal: getActorWorldForward(cat.torsoGroup),
        defaultPadding: 0.28,
        subBounds: { sceneGeometry, shaderMouth },
        limitations: [
          'Frames along the cat torso world forward vector so rotated cat poses remain centered on the muzzle, eyes, and ears.',
        ],
      };
    }

    case 'cat-full-body': {
      const cat = actors.catActor;
      if (!cat) {
        return createFallbackFocusTarget(targetId, 'Cat Full Body');
      }
      cat.root.updateMatrixWorld(true);
      const sceneGeometry = new Box3().setFromObject(cat.root);
      const shaderMouth = cat.catBody.getMouthWorldBounds();
      const worldBounds = sceneGeometry.clone().union(shaderMouth);
      return {
        id: targetId,
        label: 'Cat Full Body',
        boundsKind: 'composite',
        worldBounds,
        forwardNormal: getActorWorldForward(cat.root),
        defaultPadding: 0.2,
        subBounds: { sceneGeometry, shaderMouth },
        limitations: [],
      };
    }
  }
}

function createFallbackFocusTarget(
  id: VisualFocusTargetId,
  label: string,
): VisualFocusTargetDescription {
  const worldBounds = new Box3(new Vector3(-0.35, 1.1, -0.35), new Vector3(0.35, 1.85, 0.35));
  return {
    id,
    label,
    boundsKind: 'scene-object',
    worldBounds,
    forwardNormal: new Vector3(0, 0, 1),
    defaultPadding: 0.25,
    subBounds: { sceneGeometry: worldBounds.clone() },
    limitations: ['Actor was not initialized when resolving focus target; using fallback bounds.'],
  };
}

function getBoxCorners(box: Box3): Vector3[] {
  const { min, max } = box;
  return [
    new Vector3(min.x, min.y, min.z),
    new Vector3(max.x, min.y, min.z),
    new Vector3(min.x, max.y, min.z),
    new Vector3(max.x, max.y, min.z),
    new Vector3(min.x, min.y, max.z),
    new Vector3(max.x, min.y, max.z),
    new Vector3(min.x, max.y, max.z),
    new Vector3(max.x, max.y, max.z),
  ];
}

/**
 * Projects a world-space `Box3` through a perspective camera into a normalized
 * `[x, y, width, height]` viewport rectangle (`0..1`, top-left origin).
 */
export function projectWorldBoxToViewportRect(
  box: Box3,
  camera: PerspectiveCamera,
): { rect: NormalizedViewportRect; inFrame: boolean } {
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  let minNdcX = Infinity;
  let maxNdcX = -Infinity;
  let minNdcY = Infinity;
  let maxNdcY = -Infinity;

  for (const corner of getBoxCorners(box)) {
    const projected = corner.project(camera);
    minNdcX = Math.min(minNdcX, projected.x);
    maxNdcX = Math.max(maxNdcX, projected.x);
    minNdcY = Math.min(minNdcY, projected.y);
    maxNdcY = Math.max(maxNdcY, projected.y);
  }

  const rawLeft = (minNdcX + 1) * 0.5;
  const rawRight = (maxNdcX + 1) * 0.5;
  const rawTop = (1 - maxNdcY) * 0.5;
  const rawBottom = (1 - minNdcY) * 0.5;

  const eps = 0.005;
  const inFrame =
    rawLeft >= -eps &&
    rawRight <= 1 + eps &&
    rawTop >= -eps &&
    rawBottom <= 1 + eps &&
    rawRight > rawLeft &&
    rawBottom > rawTop;

  const left = Math.max(0, Math.min(1, rawLeft));
  const right = Math.max(left, Math.min(1, rawRight));
  const top = Math.max(0, Math.min(1, rawTop));
  const bottom = Math.max(top, Math.min(1, rawBottom));

  const round4 = (n: number) => Math.round(n * 10000) / 10000;
  return {
    rect: [round4(left), round4(top), round4(right - left), round4(bottom - top)],
    inFrame,
  };
}

/**
 * Fits a perspective camera to a `VisualFocusTargetDescription` using its 3D world bounds,
 * camera vertical FOV, viewport aspect ratio, and padding margin.
 *
 * Accounts for perspective foreshortening of the front-most vertices of the bounding box
 * so protruding features (googly eyes, snout, shader mouth on the front surface) are
 * never clipped at the viewport borders.
 */
export function fitCameraToFocusTarget(
  target: VisualFocusTargetDescription,
  options: CameraFocusFitOptions = {},
): ResolvedFocusFraming {
  const fovDegrees = options.fovDegrees ?? 42;
  const aspect = options.aspect ?? 16 / 9;
  const padding = options.padding ?? target.defaultPadding;
  const elevationRadians = options.elevationRadians ?? 0.04;

  const center = new Vector3();
  target.worldBounds.getCenter(center);

  // Build camera view direction from target's forward normal + slight elevation
  const viewDir = target.forwardNormal.clone().normalize();
  viewDir.y += Math.sin(elevationRadians);
  viewDir.normalize();

  const right = new Vector3().crossVectors(WORLD_UP, viewDir).normalize();
  if (right.lengthSq() < 1e-6) {
    right.set(1, 0, 0);
  }
  const up = new Vector3().crossVectors(viewDir, right).normalize();

  const halfFovV = (fovDegrees * Math.PI) / 360;
  const tanHalfV = Math.max(0.1, Math.tan(halfFovV));
  const tanHalfH = Math.max(0.1, tanHalfV * aspect);
  const padMultiplier = 1 + Math.max(0.05, padding);

  // For every corner of the 3D bounding box, solve the required camera distance along `viewDir`
  // from `center` so that `(u, v)` stays inside the padded frustum at depth `(d - w)`:
  //   |u| * padMultiplier <= (d - w) * tanHalfH  =>  d >= w + |u| * padMultiplier / tanHalfH
  //   |v| * padMultiplier <= (d - w) * tanHalfV  =>  d >= w + |v| * padMultiplier / tanHalfV
  let requiredDistance = 0.25;
  for (const corner of getBoxCorners(target.worldBounds)) {
    const rel = corner.sub(center);
    const u = Math.abs(rel.dot(right));
    const v = Math.abs(rel.dot(up));
    const w = rel.dot(viewDir);

    const distH = w + (u * padMultiplier) / tanHalfH;
    const distV = w + (v * padMultiplier) / tanHalfV;
    requiredDistance = Math.max(requiredDistance, distH, distV);
  }

  const cameraPos = center.clone().addScaledVector(viewDir, requiredDistance);

  // Build a virtual PerspectiveCamera at the solved pose to compute exact projected rectangles
  const virtualCamera = new PerspectiveCamera(fovDegrees, aspect, 0.02, 100);
  virtualCamera.position.copy(cameraPos);
  virtualCamera.up.copy(WORLD_UP);
  virtualCamera.lookAt(center);
  virtualCamera.updateMatrixWorld(true);
  virtualCamera.updateProjectionMatrix();

  const { rect: projectedRect, inFrame } = projectWorldBoxToViewportRect(
    target.worldBounds,
    virtualCamera,
  );

  let shaderMouthRect: NormalizedViewportRect | undefined;
  if (target.subBounds.shaderMouth) {
    shaderMouthRect = projectWorldBoxToViewportRect(
      target.subBounds.shaderMouth,
      virtualCamera,
    ).rect;
  }

  const occupancy = Math.max(projectedRect[2], projectedRect[3]);
  const round3 = (n: number) => Math.round(n * 1000) / 1000;

  return {
    targetId: target.id,
    label: target.label,
    boundsKind: target.boundsKind,
    cameraPosition: [round3(cameraPos.x), round3(cameraPos.y), round3(cameraPos.z)],
    cameraTarget: [round3(center.x), round3(center.y), round3(center.z)],
    cameraDistance: round3(requiredDistance),
    worldMin: [
      round3(target.worldBounds.min.x),
      round3(target.worldBounds.min.y),
      round3(target.worldBounds.min.z),
    ],
    worldMax: [
      round3(target.worldBounds.max.x),
      round3(target.worldBounds.max.y),
      round3(target.worldBounds.max.z),
    ],
    projectedRect,
    shaderMouthRect,
    inFrame,
    occupancy: Math.round(occupancy * 1000) / 1000,
    limitations: target.limitations,
  };
}
