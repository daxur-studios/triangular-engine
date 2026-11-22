import { AmbientLight, Color, DirectionalLight, OrthographicCamera, Scene, Vector3, WebGLRenderer, type Group } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FacialAnimationController } from 'triangular-engine/characters';
import { buildExperimentalPigtailHead } from '../../../demo-app/src/app/pages/character-studio/experimental-pigtail-head';
import { linkPreviewOrbit } from '../preview-orbit';

interface Preset {
  label: string;
  encoded: string;
  values: { crownSweep: number; backLength: number };
}

const status = document.querySelector<HTMLElement>('[role=status]')!;
const stages = document.querySelector('.stages')!;
const angles = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-angle]'));
const expression = document.querySelector<HTMLSelectElement>('#expression')!;
const showMustache = document.querySelector<HTMLInputElement>('#mustache')!;
const loader = new GLTFLoader();
const cameraTarget = new Vector3(0, 2.59, 0);

async function load(encoded: string) {
  const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  const { scene } = await loader.parseAsync(bytes.buffer, '');
  return scene;
}

async function createView(preset: Preset, mustache: Group) {
  const section = document.createElement('section');
  const title = document.createElement('h2');
  const canvas = document.createElement('canvas');
  const settings = document.createElement('p');
  title.textContent = preset.label;
  canvas.setAttribute('aria-label', `${preset.label} on the capsule head`);
  settings.textContent = `Crown sweep ${preset.values.crownSweep} mm · Side and rear extension ${preset.values.backLength} mm`;
  section.append(title, canvas, settings);
  stages.append(section);

  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new Scene();
  scene.background = new Color('#eee1d4');
  const controller = new FacialAnimationController();
  const face = buildExperimentalPigtailHead(controller);
  face.head.scale.setScalar(1);
  const workshopHair = face.head.getObjectByName('capsule-hair')!;
  const hair = await load(preset.encoded);
  face.head.add(hair, mustache);
  scene.add(face.head, new AmbientLight(0xffeee1, 1.4));
  const key = new DirectionalLight(0xfff3e8, 2.7);
  key.position.set(-3, 6, 5);
  const rim = new DirectionalLight(0xffe5d6, 2.1);
  rim.position.set(4, 6, -5);
  scene.add(key, rim);

  const camera = new OrthographicCamera();
  camera.position.copy(cameraTarget).z += 10;
  camera.lookAt(cameraTarget);
  const draw = () => renderer.render(scene, camera);
  function resize() {
    const { width, height } = canvas.getBoundingClientRect();
    const aspect = width / height;
    const halfHeight = Math.max(2.72, 2.17 / aspect);
    renderer.setSize(width, height, false);
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    draw();
  }
  new ResizeObserver(resize).observe(canvas);

  function update() {
    controller.setExpression(expression.value === 'surprised' ? 'surprised' : 'happy', 1, 0);
    face.setHair('classic-stache', 1, undefined, showMustache.checked, false, 0x75523b);
    workshopHair.visible = false;
    const workshopMustache = face.head.getObjectByName('classic-mustache');
    if (workshopMustache) workshopMustache.visible = false;
    mustache.visible = showMustache.checked;
    face.update(0);
    draw();
  }
  return { canvas, camera, draw, update };
}

async function main() {
  const embedded = document.querySelector('#assets')!;
  const assets: { presets: Preset[]; mustache: string } = JSON.parse(embedded.textContent!);
  embedded.remove();
  const mustache = await load(assets.mustache);
  const views = await Promise.all(assets.presets.map(preset => createView(preset, mustache.clone())));
  linkPreviewOrbit(views, cameraTarget, angles);
  const update = () => views.forEach(view => view.update());
  expression.disabled = showMustache.disabled = false;
  expression.addEventListener('change', update);
  showMustache.addEventListener('change', update);
  update();
  status.textContent = 'Both hairstyles and the mustache loaded.';
}

main().catch(error => {
  console.error(error);
  status.textContent = 'Could not load the baked assets.';
});
