/**
 * Headless agreement test between the framework-free face probes and an ID-colour render of
 * the current Capsule Doodle actor (plan 088, model-probes).
 *
 * The orange-pigtails benchmark head is framed like the studio's `human-head-hair` focus with a
 * 25° lens at the benchmark capture size (640 × 360), from the front, three-quarter and profile
 * azimuths. For every visible probe outline sample, each nearby pixel whose rendered part ID
 * disagrees with the probe's analytic inside/outside test counts its distance to the projected
 * outline. A pixel is drawn when its centre is covered, so exact geometry disagrees nowhere.
 */

import {
  Box3,
  type Mesh,
  type Object3D,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import {
  ALL_CAPSULE_CHARACTER_PRESETS,
  characterCapsuleSideContour,
  characterEllipsoidContour,
  characterProjectedEllipseDistance,
  characterSegmentCapsuleEntry,
  characterSegmentEllipsoidEntry,
  computeCapsuleFaceProbes,
  projectCharacterEllipsoid,
  projectCharacterPoint,
  transformCharacterCapsule,
  transformCharacterEllipsoid,
  type CharacterCapsule,
  type CharacterEllipsoid,
  type CharacterPinholeCamera,
  type CharacterVector3,
} from 'triangular-engine/characters';
import { CapsuleCharacterActor } from './capsule-character-actor';
import { decodeCapsuleIdPixel, type CapsuleIdPixel } from './capsule-id-colours';

const WIDTH = 640;
const HEIGHT = 360;
const FOV_DEGREES = 25;
/** Studio `human-head-hair` focus: padding 0.22, elevation 0.04 rad. */
const PAD_MULTIPLIER = 1.22;
const ELEVATION = 0.04;
const VIEWS = [
  { name: 'front', azimuth: 0 },
  { name: 'three-quarter', azimuth: -0.55 },
  { name: 'profile', azimuth: -1.18 },
] as const;
/** Inside and outside test pixels sit this far from an outline sample, so larger errors still get measured. */
const PROBE_OFFSET_PX = 3;
/** Pixels within this radius of an outline sample are compared. */
const WINDOW_PX = 3.5;
/** Contour samples next to a hidden or unreadable sample are not measured. */
const NEIGHBOUR_TRIM = 3;

type Occluder = (from: CharacterVector3, to: CharacterVector3) => number | null;

interface ProbeResiduals {
  readonly label: string;
  readonly residuals: number[];
}

function benchmarkActor(): CapsuleCharacterActor {
  const preset = ALL_CAPSULE_CHARACTER_PRESETS.find((p) => p.id === 'curly-pigtails');
  if (!preset) {
    throw new Error('curly-pigtails preset is missing');
  }
  const actor = new CapsuleCharacterActor({
    dna: { ...preset, helmet: false, jetpack: false, hairStyleId: 'pigtails', hairColor: '#e06829' },
  });
  actor.setLocomotion('idle');
  actor.facialController.setExpression('happy', 1, 0.2);
  for (let i = 0; i < 10; i++) {
    actor.update(0.1);
  }
  actor.setIdColourMode(true);
  actor.root.updateMatrixWorld(true);
  return actor;
}

function expandByVisible(box: Box3, root: Object3D): void {
  root.traverseVisible((object) => {
    const mesh = object as Mesh;
    if (mesh.isMesh) {
      mesh.geometry.computeBoundingBox();
      box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld));
    }
  });
}

/** Mirrors the studio's `fitCameraToFocusTarget` for the `human-head-hair` target. */
function frameHead(actor: CapsuleCharacterActor, azimuth: number): { position: Vector3; target: Vector3 } {
  const box = new Box3();
  expandByVisible(box, actor.capsuleFaceRig.root);
  expandByVisible(box, actor.capsuleHairKit.root);
  expandByVisible(box, actor.capsuleSpaceGear.headGearGroup);
  const { bodyHeight: h, bodyRadius: r } = actor.dna;
  for (const [x, y, z] of [
    [0, h * 0.5 + r * 1.04, r],
    [0, -h * 0.04, r],
    [-r * 1.08, h * 0.25, 0],
    [r * 1.08, h * 0.25, 0],
    [0, h * 0.25, -r * 1.08],
  ]) {
    box.expandByPoint(new Vector3(x, y, z).applyMatrix4(actor.torsoGroup.matrixWorld));
  }
  const center = box.getCenter(new Vector3());
  const worldUp = new Vector3(0, 1, 0);
  const viewDir = new Vector3(0, 0, 1)
    .applyQuaternion(actor.torsoGroup.getWorldQuaternion(new Quaternion()))
    .applyAxisAngle(worldUp, azimuth);
  viewDir.y += Math.sin(ELEVATION);
  viewDir.normalize();
  const right = new Vector3().crossVectors(worldUp, viewDir).normalize();
  const up = new Vector3().crossVectors(viewDir, right).normalize();
  const tanV = Math.tan((FOV_DEGREES * Math.PI) / 360);
  const tanH = tanV * (WIDTH / HEIGHT);
  let distance = 0.25;
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        const rel = new Vector3(x, y, z).sub(center);
        const w = rel.dot(viewDir);
        distance = Math.max(
          distance,
          w + (Math.abs(rel.dot(right)) * PAD_MULTIPLIER) / tanH,
          w + (Math.abs(rel.dot(up)) * PAD_MULTIPLIER) / tanV,
        );
      }
    }
  }
  return { position: center.clone().addScaledVector(viewDir, distance), target: center };
}

/** Renders the scene and decodes it to part IDs, row 0 at the top. */
function renderIds(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera): CapsuleIdPixel[] {
  const target = new WebGLRenderTarget(WIDTH, HEIGHT);
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  renderer.render(scene, camera);
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
  renderer.readRenderTargetPixels(target, 0, 0, WIDTH, HEIGHT, pixels);
  renderer.setRenderTarget(null);
  target.dispose();
  const ids: CapsuleIdPixel[] = new Array(WIDTH * HEIGHT);
  for (let row = 0; row < HEIGHT; row++) {
    const source = (HEIGHT - 1 - row) * WIDTH * 4;
    for (let col = 0; col < WIDTH; col++) {
      const i = source + col * 4;
      ids[row * WIDTH + col] = decodeCapsuleIdPixel(pixels[i], pixels[i + 1], pixels[i + 2]);
    }
  }
  return ids;
}

function quantile(sorted: readonly number[], q: number): number {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : NaN;
}

describe('capsule face probes against the ID-colour render', () => {
  let renderer: WebGLRenderer | undefined;
  let actor: CapsuleCharacterActor;
  let scene: Scene;

  beforeAll(() => {
    try {
      renderer = new WebGLRenderer({ antialias: false });
    } catch {
      renderer = undefined;
    }
    actor = benchmarkActor();
    scene = new Scene();
    scene.add(actor.root);
  });

  afterAll(() => {
    actor.dispose();
    renderer?.dispose();
    renderer?.forceContextLoss();
  });

  for (const view of VIEWS) {
    it(`agrees within one pixel at ${WIDTH}x${HEIGHT}, ${view.name} view`, () => {
      if (!renderer) {
        fail('WebGL is unavailable in this browser, so the ID-colour render cannot run.');
        return;
      }
      const { position, target } = frameHead(actor, view.azimuth);
      const threeCamera = new PerspectiveCamera(FOV_DEGREES, WIDTH / HEIGHT, 0.02, 100);
      threeCamera.position.copy(position);
      threeCamera.up.set(0, 1, 0);
      threeCamera.lookAt(target);
      threeCamera.updateMatrixWorld(true);
      const camera: CharacterPinholeCamera = { position, target, fovYDegrees: FOV_DEGREES, width: WIDTH, height: HEIGHT };
      const ids = renderIds(renderer, scene, threeCamera);
      const idAt = (x: number, y: number): CapsuleIdPixel | undefined => {
        const col = Math.floor(x);
        const row = Math.floor(y);
        return col >= 0 && row >= 0 && col < WIDTH && row < HEIGHT ? ids[row * WIDTH + col] : undefined;
      };

      const torso = actor.torsoGroup.matrixWorld;
      const m = torso.elements;
      const projection = actor.latestFaceProjection!;
      const probes = computeCapsuleFaceProbes(actor.dna, {
        mouth: projection.mouth,
        leftEye: projection.leftEye,
        rightEye: projection.rightEye,
      });
      const head: CharacterCapsule = transformCharacterCapsule(m, probes.head.capsule);
      const scleras = {
        left: transformCharacterEllipsoid(m, probes.leftEye.sclera),
        right: transformCharacterEllipsoid(m, probes.rightEye.sclera),
      };
      const pupils = {
        left: transformCharacterEllipsoid(m, probes.leftEye.pupil),
        right: transformCharacterEllipsoid(m, probes.rightEye.pupil),
      };
      const capsuleOccluder: Occluder = (from, to) => characterSegmentCapsuleEntry(from, to, head);
      const ellipsoidOccluder = (e: CharacterEllipsoid): Occluder => (from, to) => characterSegmentEllipsoidEntry(from, to, e);

      /** True when nothing in `occluders` lies in front of `p` by more than `slack` metres. */
      const visible = (p: CharacterVector3, occluders: readonly Occluder[], slack = 1e-5): boolean => {
        const length = Math.hypot(p.x - position.x, p.y - position.y, p.z - position.z);
        return occluders.every((o) => {
          const t = o(position, p);
          return t === null || t >= 1 - slack / length;
        });
      };

      /**
       * Worst distance, in pixels, from the outline to a pixel near `p` whose rendered ID
       * disagrees with `signedDistance` (negative inside). Only `own` and `outside` pixels count.
       */
      const windowResidual = (
        p: { x: number; y: number },
        own: CapsuleIdPixel,
        outside: CapsuleIdPixel,
        signedDistance: (c: { x: number; y: number }) => number,
      ): number => {
        let worst = 0;
        for (let row = Math.floor(p.y - WINDOW_PX); row <= Math.ceil(p.y + WINDOW_PX); row++) {
          for (let col = Math.floor(p.x - WINDOW_PX); col <= Math.ceil(p.x + WINDOW_PX); col++) {
            const c = { x: col + 0.5, y: row + 0.5 };
            if (Math.hypot(c.x - p.x, c.y - p.y) > WINDOW_PX) continue;
            const id = idAt(c.x, c.y);
            if (id !== own && id !== outside) continue;
            const d = signedDistance(c);
            if (d < 0 !== (id === own)) worst = Math.max(worst, Math.abs(d));
          }
        }
        return worst;
      };

      /**
       * Measures a closed or open run of outline samples. A sample counts when it is visible,
       * its inside pixel is `own`, its outside pixel is allowed, and so are its neighbours.
       */
      const measureRun = (
        samples: readonly {
          p: { x: number; y: number };
          normal: { x: number; y: number };
          visible: boolean;
        }[],
        closed: boolean,
        own: CapsuleIdPixel,
        allowedOutside: readonly CapsuleIdPixel[],
        signedDistance: (c: { x: number; y: number }) => number,
      ): number[] => {
        const outsideIds = samples.map(({ p, normal, visible: v }) => {
          if (!v || idAt(p.x - PROBE_OFFSET_PX * normal.x, p.y - PROBE_OFFSET_PX * normal.y) !== own) return undefined;
          const outside = idAt(p.x + PROBE_OFFSET_PX * normal.x, p.y + PROBE_OFFSET_PX * normal.y);
          return outside && allowedOutside.includes(outside) ? outside : undefined;
        });
        const n = samples.length;
        const residuals: number[] = [];
        for (let i = 0; i < n; i++) {
          let accepted = true;
          for (let k = -NEIGHBOUR_TRIM; k <= NEIGHBOUR_TRIM && accepted; k++) {
            const j = closed ? (i + k + n) % n : i + k;
            accepted = j >= 0 && j < n && outsideIds[j] !== undefined;
          }
          if (accepted) {
            residuals.push(windowResidual(samples[i].p, own, outsideIds[i]!, signedDistance));
          }
        }
        return residuals;
      };

      const measureEllipsoid = (
        e: CharacterEllipsoid,
        own: CapsuleIdPixel,
        allowedOutside: readonly CapsuleIdPixel[],
        isVisible: (p: CharacterVector3) => boolean,
      ): number[] => {
        const ellipse = projectCharacterEllipsoid(camera, e);
        if (!ellipse) return [];
        const samples = characterEllipsoidContour(e, position, 360).map((point) => {
          const p = projectCharacterPoint(camera, point)!;
          return { p, normal: characterProjectedEllipseDistance(ellipse, p).normal, visible: isVisible(point) };
        });
        return measureRun(samples, true, own, allowedOutside, (c) => characterProjectedEllipseDistance(ellipse, c).distance);
      };

      const results: ProbeResiduals[] = [];
      for (const side of ['left', 'right'] as const) {
        const other = side === 'left' ? 'right' : 'left';
        const eyeRadius = (side === 'left' ? probes.leftEye : probes.rightEye).placement.radius;
        results.push({
          label: `${side} eye white`,
          residuals: measureEllipsoid(scleras[side], 'eyeWhite', ['headSkin', 'background'], (p) =>
            visible(p, [capsuleOccluder, ellipsoidOccluder(scleras[other])]),
          ),
        });
        results.push({
          label: `${side} pupil`,
          residuals: measureEllipsoid(
            pupils[side],
            'pupil',
            // From the side a pupil can stand out past its eye white.
            ['eyeWhite', 'headSkin', 'background'],
            (p) =>
              visible(p, [capsuleOccluder, ellipsoidOccluder(scleras[other])]) &&
              visible(p, [ellipsoidOccluder(scleras[side])], 0.02 * eyeRadius),
          ),
        });
      }

      // Head edges: the capsule side contour where the head skin covers it.
      const toTorso = torso.clone().invert();
      const viewpointInTorso = position.clone().applyMatrix4(toTorso);
      const headResiduals: number[] = [];
      for (const line of characterCapsuleSideContour(probes.head.capsule, viewpointInTorso, 160)) {
        if (line.length < 2) continue;
        const world = line.map((q) => new Vector3(q.x, q.y, q.z).applyMatrix4(torso));
        const a = projectCharacterPoint(camera, world[0])!;
        const b = projectCharacterPoint(camera, world[world.length - 1])!;
        const axisMid = projectCharacterPoint(
          camera,
          new Vector3().addVectors(head.start as Vector3, head.end as Vector3).multiplyScalar(0.5),
        )!;
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        let normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
        if ((a.x - axisMid.x) * normal.x + (a.y - axisMid.y) * normal.y < 0) {
          normal = { x: -normal.x, y: -normal.y };
        }
        const signedDistance = (c: { x: number; y: number }) => (c.x - a.x) * normal.x + (c.y - a.y) * normal.y;
        const samples = line
          .map((q, i) => ({ q, w: world[i] }))
          .filter(({ q }) => q.y > probes.head.skinBottomY + 0.02)
          .map(({ w }) => ({
            p: projectCharacterPoint(camera, w)!,
            normal,
            visible: visible(w, [ellipsoidOccluder(scleras.left), ellipsoidOccluder(scleras.right)]),
          }));
        headResiduals.push(...measureRun(samples, false, 'headSkin', ['background'], signedDistance));
      }
      results.push({ label: 'head edges', residuals: headResiduals });

      // Mouth corners: the render's furthest mouth pixel along the projected surface tangent.
      if (Math.abs(view.azimuth) < 1) {
        for (const [label, corner, sign] of [
          ['right mouth corner', probes.mouth.right, 1],
          ['left mouth corner', probes.mouth.left, -1],
        ] as const) {
          const r = Math.hypot(corner.x, corner.z);
          const local = new Vector3(corner.x, corner.y, corner.z);
          const outward = new Vector3((sign * corner.z) / r, 0, (-sign * corner.x) / r);
          const world = local.clone().applyMatrix4(torso);
          const ahead = local.clone().addScaledVector(outward, 0.005).applyMatrix4(torso);
          if (!visible(world, [capsuleOccluder])) continue;
          const p = projectCharacterPoint(camera, world)!;
          const q = projectCharacterPoint(camera, ahead)!;
          const ul = Math.hypot(q.x - p.x, q.y - p.y);
          const u = { x: (q.x - p.x) / ul, y: (q.y - p.y) / ul };
          if (idAt(p.x + 2 * u.x, p.y + 2 * u.y) !== 'headSkin') continue;
          let extreme = -Infinity;
          for (let row = Math.floor(p.y - 8); row <= Math.ceil(p.y + 8); row++) {
            for (let col = Math.floor(p.x - 8); col <= Math.ceil(p.x + 8); col++) {
              const c = { x: col + 0.5, y: row + 0.5 };
              if (Math.hypot(c.x - p.x, c.y - p.y) <= 8 && idAt(c.x, c.y) === 'mouth') {
                extreme = Math.max(extreme, (c.x - p.x) * u.x + (c.y - p.y) * u.y);
              }
            }
          }
          results.push({ label, residuals: [Math.abs(extreme)] });
        }
      }

      const report = results.map(({ label, residuals }) => {
        const sorted = [...residuals].sort((x, y) => x - y);
        return {
          label,
          samples: sorted.length,
          median: quantile(sorted, 0.5),
          p95: quantile(sorted, 0.95),
          max: sorted.length ? sorted[sorted.length - 1] : NaN,
        };
      });
      console.log(
        `[probe-agreement] ${view.name} ${WIDTH}x${HEIGHT}\n` +
          report
            .map((r) => `  ${r.label.padEnd(20)} n=${String(r.samples).padStart(4)} median=${r.median.toFixed(3)} p95=${r.p95.toFixed(3)} max=${r.max.toFixed(3)}`)
            .join('\n'),
      );

      // Every view must measure at least one eye white, one pupil and the head edges. In profile
      // the near eye's lids and the far eye white behind it hide most of the near outline.
      const required: readonly (readonly string[])[] =
        view.name === 'profile'
          ? [['left eye white', 'right eye white'], ['left pupil', 'right pupil'], ['head edges']]
          : [
              ['left eye white'], ['right eye white'], ['left pupil'], ['right pupil'], ['head edges'],
              ['left mouth corner'], ['right mouth corner'],
            ];
      for (const group of required) {
        const samples = report.filter((x) => group.includes(x.label)).reduce((sum, x) => sum + x.samples, 0);
        expect(samples).withContext(`${view.name}: ${group.join(' or ')} samples`).toBeGreaterThan(0);
      }
      for (const r of report) {
        if (r.samples > 0) {
          expect(r.max).withContext(`${view.name}: ${r.label} max residual (px)`).toBeLessThanOrEqual(1);
        }
      }
    });
  }
});
