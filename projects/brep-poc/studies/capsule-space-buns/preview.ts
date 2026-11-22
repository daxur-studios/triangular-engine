import { AmbientLight, Color, DirectionalLight, OrthographicCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FacialAnimationController } from 'triangular-engine/characters';
import { buildExperimentalPigtailHead } from '../../../demo-app/src/app/pages/character-studio/experimental-pigtail-head';
import type { SpaceBunValues } from '../../src/app/part/capsule-space-buns.brep';
import { linkPreviewOrbit } from '../preview-orbit';

interface Preset {
  label: string;
  encoded: string;
  values: SpaceBunValues;
}

const status = document.querySelector<HTMLElement>('[role=status]')!;
const stages = document.querySelector('.stages')!;
const angles = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-angle]'));
const loader = new GLTFLoader();
const cameraTarget = new Vector3(0, 2.58, 0);

async function createView(preset: Preset) {
  const section = document.createElement('section');
  const title = document.createElement('h2');
  const canvas = document.createElement('canvas');
  title.textContent = preset.label;
  canvas.setAttribute('aria-label', `${preset.label} on the capsule head`);
  section.append(title, canvas);
  stages.append(section);

  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new Scene();
  scene.background = new Color('#ede1d6');
  const controller = new FacialAnimationController();
  controller.setExpression('happy', .8, 0);
  const face = buildExperimentalPigtailHead(controller, undefined, false);
  face.head.scale.setScalar(1);
  face.update(0);
  scene.add(face.head);
  scene.add(new AmbientLight(0xffeee1, 1.25));
  const key = new DirectionalLight(0xfff3e8, 2.6);
  key.position.set(-3, 6, 5);
  const rim = new DirectionalLight(0xffe6e4, 2.1);
  rim.position.set(4, 6, -5);
  scene.add(key, rim);

  const bytes = Uint8Array.from(atob(preset.encoded), character => character.charCodeAt(0));
  const gltf = await loader.parseAsync(bytes.buffer, '');
  face.head.add(gltf.scene);

  const camera = new OrthographicCamera();
  camera.position.copy(cameraTarget).z += 10;
  camera.lookAt(cameraTarget);
  const draw = () => renderer.render(scene, camera);
  function resize() {
    const { width, height } = canvas.getBoundingClientRect();
    const aspect = width / height;
    const halfHeight = Math.max(2.76, 2.4 / aspect);
    renderer.setSize(width, height, false);
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    draw();
  }
  new ResizeObserver(resize).observe(canvas);
  const { bunSize, rightLift, leftLift, lockLength } = preset.values;
  const settings = document.createElement('p');
  const lift = rightLift === leftLift ? String(rightLift) : `${leftLift} / ${rightLift}`;
  settings.textContent = `Buns ${bunSize}% · Lift ${lift} mm · Locks ${lockLength} mm`;
  section.append(settings);
  return { canvas, camera, draw };
}

async function main() {
  const embedded = document.querySelector('#presets')!;
  const presets: Preset[] = JSON.parse(embedded.textContent!);
  embedded.remove();
  const views = await Promise.all(presets.map(createView));
  linkPreviewOrbit(views, cameraTarget, angles);
  status.textContent = 'Both GLB presets loaded.';
}

main().catch(error => {
  console.error(error);
  status.textContent = 'Could not load the hair presets.';
});
