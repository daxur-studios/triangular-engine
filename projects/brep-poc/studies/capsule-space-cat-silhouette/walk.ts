/**
 * Two identical Concept Fit cats, side by side: the left one on the baked,
 * bone-driven leg and the right one on the stock rubber hose. Same body, same
 * gait, same time step, so the leg change is the only difference. The rear
 * hip page instead compares one fused hip with the separate baked leg.
 *
 * The page is driven by `window.__walk`, which the capture recipe uses to
 * switch gaits and camera angle while recording.
 */

import {
  AmbientLight, CanvasTexture, Clock, Color, DirectionalLight, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  OrthographicCamera, PlaneGeometry, Scene, Vector3, WebGLRenderer,
} from 'three';
import { buildCat, hideGear, loadBody, loadLegGeometry, type LegPreset, type Preset } from './cat-scene';
import { buildRearHip, type RearHipRestPose } from './rear-hip';
import { buildJoinedCatRig } from './joined-cat-rig';
import { conceptRearExtension } from './joined-cat-rest';
import { dressForConcept, fitGentlerFace } from './concept-fit';

type Gait = 'idle' | 'goofy_walk' | 'bound_run' | 'float';

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const tagLeft = document.querySelector<HTMLElement>('#tag-baked')!;
const tagRight = document.querySelector<HTMLElement>('#tag-hose')!;
const search = new URLSearchParams(location.search);
const hipData = document.querySelector('#rear-hip');
const joinedData = document.querySelector('#joined-cat');
const conceptData = document.querySelector('#concept-cat');
const compareHip = hipData !== null;

const background = '#ede1d6';
const cameraTarget = new Vector3(0, .5, 0);
const radius = 6;
const sideAngle = 18 * Math.PI / 180;
const leftZ = .88;
const rightZ = -.88;

const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);

const scene = new Scene();
scene.background = new Color(background);
const key = new DirectionalLight(0xfff3e8, 2.6);
key.position.set(-3, 6, 5);
const rim = new DirectionalLight(0xffe6e4, 2.1);
rim.position.set(4, 6, -5);
scene.add(new AmbientLight(0xffeee1, 1.25), key, rim);

const camera = new OrthographicCamera();
let viewAngle = conceptData ? 136 * Math.PI / 180 : compareHip && !joinedData ? 0 : sideAngle;

function applyView(): void {
  camera.position.set(
    cameraTarget.x + Math.cos(viewAngle) * radius,
    cameraTarget.y + 1.6,
    cameraTarget.z + Math.sin(viewAngle) * radius,
  );
  camera.lookAt(cameraTarget);
}

function resize(): void {
  const { innerWidth: width, innerHeight: height } = window;
  const aspect = Math.max(.2, width / height);
  const halfHeight = conceptData ? Math.max(1.02, 1.90 / aspect) : 1.02;
  renderer.setSize(width, height, false);
  camera.left = -halfHeight * aspect;
  camera.right = halfHeight * aspect;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.updateProjectionMatrix();
  applyView();
}

/** A soft elliptical contact shadow, so the paws read against the floor. */
function contactShadow(): Mesh {
  const size = 256;
  const surface = document.createElement('canvas');
  surface.width = size;
  surface.height = size;
  const context = surface.getContext('2d')!;
  const gradient = context.createRadialGradient(size / 2, size / 2, 8, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(60, 38, 30, 0.30)');
  gradient.addColorStop(.55, 'rgba(60, 38, 30, 0.13)');
  gradient.addColorStop(1, 'rgba(60, 38, 30, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const mesh = new Mesh(
    new PlaneGeometry(1, 1),
    new MeshBasicMaterial({ map: new CanvasTexture(surface), transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = .002;
  mesh.scale.set(.95, 1.5, 1);
  return mesh;
}

function placeTag(tag: HTMLElement, world: Vector3): void {
  const projected = world.clone().project(camera);
  tag.style.left = `${(projected.x * .5 + .5) * 100}%`;
  tag.style.top = `${(-projected.y * .5 + .5) * 100}%`;
}

async function main(): Promise<void> {
  const bodyPreset: Preset = JSON.parse(document.querySelector('#body')!.textContent!);
  const legPreset: LegPreset = JSON.parse(document.querySelector('#leg')!.textContent!);
  document.querySelector('#body')!.remove();
  document.querySelector('#leg')!.remove();

  const [legGeometry, rightBody] = await Promise.all([loadLegGeometry(legPreset), loadBody(bodyPreset)]);
  let rearHip: ReturnType<typeof buildRearHip> | undefined;
  if (hipData) {
    const preset: RearHipRestPose & { encoded: string } = JSON.parse(hipData.textContent!);
    hipData.remove();
    rearHip = buildRearHip(await loadLegGeometry(preset), new MeshStandardMaterial(), preset);
    tagLeft.textContent = 'Fused rear hip';
    tagRight.textContent = 'Separate baked leg';
    canvas.setAttribute('aria-label', 'Space cats walking with a fused rear hip on the left and a separate baked leg on the right');
  }
  let joined: ReturnType<typeof buildJoinedCatRig> | undefined;
  if (joinedData) {
    joined = buildJoinedCatRig(await loadLegGeometry(JSON.parse(joinedData.textContent!)));
    joinedData.remove();
    tagLeft.textContent = 'Joined legs and tail';
    tagRight.textContent = 'Earlier hip study';
    canvas.setAttribute('aria-label', 'Space cats walking with joined legs and tail on the left and the earlier rear hip bake on the right');
  }
  const concept = conceptData
    ? buildJoinedCatRig(await loadLegGeometry(JSON.parse(conceptData.textContent!)), true)
    : undefined;
  conceptData?.remove();
  const leftRig = concept ?? joined ?? rearHip;
  const rightRig = concept ? joined : joined ? rearHip : undefined;
  const leftBody = leftRig?.body ?? await loadBody(bodyPreset);
  const left = buildCat(leftBody, bodyPreset.anchor, concept ? conceptRearExtension : bodyPreset.rearExtension,
    legPreset, legGeometry, leftRig);
  const right = buildCat(
    rightRig?.body ?? rightBody, bodyPreset.anchor, bodyPreset.rearExtension,
    compareHip ? legPreset : undefined, compareHip ? legGeometry : undefined,
    rightRig,
  );
  if (compareHip) {
    // Use the same fur on the body and all legs so the join is easy to compare.
    left.setDna({ furAccentColor: left.actor.dna.furColor });
    right.setDna({ furAccentColor: right.actor.dna.furColor });
    hideGear(left.actor.root);
    hideGear(right.actor.root);
  }
  // The small tips sit closer to the ankle, so lower the joined cat to the
  // same ground plane as the old bulb paws.
  if (joined) left.actor.root.position.y = -.04;
  let softenFace: (() => void) | undefined;
  if (concept) {
    left.actor.root.position.y = -.125;
    right.actor.root.position.y = -.04;
    tagLeft.textContent = 'Compact concept fit';
    tagRight.textContent = 'Previous proportions';
    canvas.setAttribute('aria-label', 'Both Space Cats in their suits, with the compact proportions on the left');
    dressForConcept(left);
    dressForConcept(right);
    softenFace = fitGentlerFace(left);
  }
  left.actor.root.position.z = leftZ;
  right.actor.root.position.z = rightZ;

  const leftShadow = contactShadow();
  leftShadow.position.z = leftZ;
  const rightShadow = contactShadow();
  rightShadow.position.z = rightZ;
  const ground = new Group();
  ground.add(leftShadow, rightShadow);
  scene.add(left.actor.root, right.actor.root, ground);

  resize();
  new ResizeObserver(resize).observe(canvas);

  const clock = new Clock();
  const tagPoint = new Vector3();
  function render(delta: number): void {
    left.update(delta);
    right.update(delta);
    softenFace?.();
    if (concept) {
      // Offset the pair across the camera plane so both use the same framing.
      const x = -Math.sin(viewAngle) * 1.04;
      const z = Math.cos(viewAngle) * 1.04;
      left.actor.root.position.x = leftShadow.position.x = x;
      left.actor.root.position.z = leftShadow.position.z = z;
      right.actor.root.position.x = rightShadow.position.x = -x;
      right.actor.root.position.z = rightShadow.position.z = -z;
    }
    renderer.render(scene, camera);
    tagPoint.copy(left.actor.root.position);
    tagPoint.y = 1.03;
    placeTag(tagLeft, tagPoint);
    tagPoint.copy(right.actor.root.position);
    tagPoint.y = 1.03;
    placeTag(tagRight, tagPoint);
  }
  const paused = search.has('paused');
  function tick(): void {
    // A tab that was hidden can hand back a huge delta; the gait should not jump.
    const delta = Math.min(clock.getDelta(), .05);
    if (!paused) render(delta);
    requestAnimationFrame(tick);
  }

  const api = {
    setGait(gait: Gait, speed = 1): void {
      left.actor.setLocomotion(gait, speed);
      right.actor.setLocomotion(gait, speed);
    },
    setView(degrees: number): void {
      viewAngle = degrees * Math.PI / 180;
      applyView();
    },
    step(delta: number): void {
      render(delta);
    },
  };
  if (compareHip) api.setGait('goofy_walk');
  render(0);
  requestAnimationFrame(tick);
  (window as unknown as { __walk: typeof api }).__walk = api;
  document.documentElement.dataset['ready'] = 'true';
}

main().catch(error => {
  console.error(error);
  document.documentElement.dataset['error'] = String(error);
});
