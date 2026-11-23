import {
  AmbientLight, Color, DirectionalLight, Group, Mesh, MeshStandardMaterial,
  OrthographicCamera, Scene, WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

interface Variant {
  label: string;
  caption: string;
  encoded: string;
}

const root = document.querySelector('.legs')!;
const status = document.querySelector('[role=status]')!;
const loader = new GLTFLoader();
const fur = new MeshStandardMaterial({ color: '#f2c7a0', roughness: .72, metalness: 0 });

function makeStage(variant: Variant) {
  const section = document.createElement('section');
  const heading = document.createElement('h2');
  const canvas = document.createElement('canvas');
  const note = document.createElement('p');
  heading.textContent = variant.label;
  note.className = 'caption';
  note.textContent = variant.caption;
  canvas.setAttribute('aria-label', variant.label);
  section.append(heading, canvas, note);
  root.append(section);

  const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new Scene();
  scene.background = new Color('#ede1d6');
  const pivot = new Group();
  scene.add(pivot);
  const key = new DirectionalLight(0xfff3e8, 2.6);
  key.position.set(-3, 6, 5);
  const rim = new DirectionalLight(0xffe6e4, 2.1);
  rim.position.set(4, 6, -5);
  scene.add(new AmbientLight(0xffeee1, 1.25), key, rim);

  const camera = new OrthographicCamera();
  camera.position.set(6, -0.12, 0);
  camera.lookAt(0, -0.12, 0);

  const draw = () => renderer.render(scene, camera);
  function resize() {
    const { width, height } = canvas.getBoundingClientRect();
    const aspect = Math.max(.2, width / height);
    const halfHeight = .2;
    renderer.setSize(width, height, false);
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    draw();
  }
  new ResizeObserver(resize).observe(canvas);
  return { pivot, draw };
}

async function load(encoded: string): Promise<Group> {
  const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  const gltf = await loader.parseAsync(bytes.buffer, '');
  gltf.scene.updateMatrixWorld(true);
  const holder = new Group();
  gltf.scene.traverse(object => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.applyMatrix4(mesh.matrixWorld);
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.set(1, 1, 1);
    mesh.updateMatrix();
    mesh.material = fur;
    holder.add(mesh);
  });
  return holder;
}

async function main() {
  const variants: Variant[] = JSON.parse(document.querySelector('#variants')!.textContent!);
  document.querySelector('#variants')!.remove();
  const stages = variants.map(makeStage);
  const models = await Promise.all(variants.map(variant => load(variant.encoded)));
  models.forEach((model, index) => {
    stages[index].pivot.add(model);
    stages[index].draw();
  });
  status.textContent = `Loaded ${models.length} baked legs`;
}

main().catch(error => {
  console.error(error);
  status.textContent = `Could not load: ${String(error)}`;
});
