import {
  AmbientLight, Color, DirectionalLight, Group, Mesh, MeshStandardMaterial,
  OrthographicCamera, Scene, Vector3, WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildExperimentalSpaceCat } from '../../../demo-app/src/app/pages/character-studio/experimental-space-cat';
import { linkPreviewOrbit } from '../preview-orbit';

interface Preset {
  label: string;
  slug: string;
  encoded: string;
  values: { headRise: number; cheekFullness: number; blendLength: number };
  anchor: { y: number; z: number };
  triangles: number;
}

const status = document.querySelector<HTMLElement>('[role=status]')!;
const silhouettes = document.querySelector('.stages.silhouettes')!;
const assembled = document.querySelector('.stages.assembled')!;
const angleButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-angle]'));
const loader = new GLTFLoader();
const background = '#ede1d6';
const silhouetteMaterial = new MeshStandardMaterial({ color: '#c9a48a', roughness: .88, metalness: 0 });
const cameraTarget = new Vector3(0, .24, 0);

function makeStage(parent: Element, title: string, caption: string) {
  const section = document.createElement('section');
  const heading = document.createElement('h2');
  const canvas = document.createElement('canvas');
  const note = document.createElement('p');
  heading.textContent = title;
  note.className = 'caption';
  note.textContent = caption;
  canvas.setAttribute('aria-label', title);
  section.append(heading, canvas, note);
  parent.append(section);

  const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new Scene();
  scene.background = new Color(background);
  const pivot = new Group();
  scene.add(pivot);
  const key = new DirectionalLight(0xfff3e8, 2.6);
  key.position.set(-3, 6, 5);
  const rim = new DirectionalLight(0xffe6e4, 2.1);
  rim.position.set(4, 6, -5);
  scene.add(new AmbientLight(0xffeee1, 1.25), key, rim);

  const camera = new OrthographicCamera();
  camera.position.copy(cameraTarget).x += 6;
  camera.lookAt(cameraTarget);

  const draw = () => renderer.render(scene, camera);
  function resize() {
    const { width, height } = canvas.getBoundingClientRect();
    const aspect = Math.max(.2, width / height);
    const halfHeight = Math.max(.62, .8 / aspect);
    renderer.setSize(width, height, false);
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    draw();
  }

  new ResizeObserver(resize).observe(canvas);
  return { pivot, canvas, camera, draw };
}

async function loadBody(preset: Preset): Promise<Group> {
  const bytes = Uint8Array.from(atob(preset.encoded), character => character.charCodeAt(0));
  const gltf = await loader.parseAsync(bytes.buffer, '');
  // The exporter puts the Z-up to Y-up rotation on a parent node. Flatten it so
  // the body's own local coordinates match the cat body shader's frame.
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
    holder.add(mesh);
  });
  return holder;
}

function setMaterial(root: Group, material: MeshStandardMaterial): void {
  root.traverse(object => {
    if ((object as Mesh).isMesh) (object as Mesh).material = material;
  });
}

function hideGear(root: Group): void {
  for (const name of ['concept-cat-helmet', 'capsule-cat-pet-jetpack', 'capsule-cat-harness']) {
    const part = root.getObjectByName(name);
    if (part) part.visible = false;
  }
}

/** An assembled cat posed on the idle gait, with the Concept Fit's face and limbs. */
function buildCat(body: Group | null, anchor?: { y: number; z: number }) {
  const fit = buildExperimentalSpaceCat(false);
  fit.actor.setLocomotion('idle');
  fit.setDna({ bodyPattern: 'natural_two_tone' });
  fit.update(.3);
  hideGear(fit.actor.root);

  if (body && anchor) {
    const head = fit.actor.root.getObjectByName('concept-cat-head')!;
    head.position.set(0, anchor.y, anchor.z - fit.actor.dna.bodyLength / 2);
    (fit.actor.catBody.mesh as Mesh).visible = false;
    const suit = fit.actor.root.getObjectByName('concept-cat-torso');
    if (suit) suit.visible = false;

    const uniforms = fit.actor.catBody.uniforms;
    // The shader's collar coordinate also gates its painted mouth: keep it on
    // the new muzzle instead of the chest, and place the mouth under the nose.
    uniforms.uNeckZ.value = .5;
    uniforms.uMouthCenterY.value = anchor.y - .087;
    body.traverse(object => {
      if ((object as Mesh).isMesh) (object as Mesh).material = fit.actor.catBody.mesh.material;
    });
    fit.actor.torsoGroup.add(body);
  }
  return fit;
}

function caption(preset: Preset): string {
  const { headRise, cheekFullness, blendLength } = preset.values;
  return `Head rise ${headRise} mm · cheek ${cheekFullness}% · blend ${blendLength} mm · ${preset.triangles.toLocaleString()} tris`;
}

async function main() {
  const embedded = document.querySelector('#presets')!;
  const presets: Preset[] = JSON.parse(embedded.textContent!);
  embedded.remove();

  const bodies = await Promise.all(presets.map(loadBody));
  const [reference, subtle] = presets;

  const silhouetteStages = [
    makeStage(silhouettes, reference.label, `${caption(reference)} · plain silhouette`),
    makeStage(silhouettes, subtle.label, `${caption(subtle)} · plain silhouette`),
  ];
  bodies.forEach((body, index) => {
    setMaterial(body, silhouetteMaterial);
    silhouetteStages[index].pivot.add(body);
    silhouetteStages[index].draw();
  });

  const currentStage = makeStage(assembled, 'Space Cat (Concept Fit)', 'Separate rounded head and torso, at the same scale');
  currentStage.pivot.add(buildCat(null).actor.root);
  currentStage.draw();

  const assembledStages = presets.map(preset =>
    makeStage(assembled, preset.label, `${caption(preset)} · existing face, legs and tail`));

  const loaded = await Promise.all(presets.map(loadBody));
  const fits = loaded.map((body, index) => {
    const fit = buildCat(body, presets[index].anchor);
    assembledStages[index].pivot.add(fit.actor.root);
    assembledStages[index].draw();
    return fit;
  });

  linkPreviewOrbit([...silhouetteStages, currentStage, ...assembledStages], cameraTarget, angleButtons, -1);
  status.textContent = `Loaded ${fits.length} baked GLB bodies (${presets.map(p => p.triangles.toLocaleString()).join(' and ')} triangles), the current cat, and the reference sheet.`;
}

main().catch(error => {
  console.error(error);
  status.textContent = `Could not load the study: ${String(error)}`;
});
