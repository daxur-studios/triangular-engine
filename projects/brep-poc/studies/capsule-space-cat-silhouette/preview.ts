import {
  AmbientLight, Color, DirectionalLight, Group, Mesh, MeshStandardMaterial,
  OrthographicCamera, Scene, Vector3, WebGLRenderer,
} from 'three';
import { linkPreviewOrbit } from '../preview-orbit';
import { buildCat, loadBody, loadLegGeometry, type LegPreset, type Preset } from './cat-scene';

const status = document.querySelector<HTMLElement>('[role=status]')!;
const silhouettes = document.querySelector('.stages.silhouettes')!;
const assembled = document.querySelector('.stages.assembled')!;
const angleButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-angle]'));
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

function setMaterial(root: Group, material: MeshStandardMaterial): void {
  root.traverse(object => {
    if ((object as Mesh).isMesh) (object as Mesh).material = material;
  });
}

function caption(preset: Preset): string {
  return `${preset.caption} · ${preset.triangles.toLocaleString()} tris`;
}

async function main() {
  const embedded = document.querySelector('#presets')!;
  const presets: Preset[] = JSON.parse(embedded.textContent!);
  embedded.remove();

  const bodies = await Promise.all(presets.map(loadBody));

  const silhouetteStages = presets.map(preset =>
    makeStage(silhouettes, preset.label, `${caption(preset)} · plain silhouette`));
  bodies.forEach((body, index) => {
    setMaterial(body, silhouetteMaterial);
    silhouetteStages[index].pivot.add(body);
    silhouetteStages[index].draw();
  });

  const currentStage = makeStage(assembled, 'Space Cat (Concept Fit)', 'Separate rounded head and torso, at the same scale');
  currentStage.pivot.add(buildCat(null).actor.root);
  currentStage.draw();

  const legPreset: LegPreset | undefined = document.querySelector('#leg')
    ? JSON.parse(document.querySelector('#leg')!.textContent!)
    : undefined;
  document.querySelector('#leg')?.remove();
  const legGeometry = legPreset ? await loadLegGeometry(legPreset) : undefined;

  const assembledStages = presets.map(preset =>
    makeStage(
      assembled,
      preset.label,
      `${caption(preset)} · ${preset.slug === 'fat' ? 'stock hose legs' : 'baked legs'}`,
    ));

  const loaded = await Promise.all(presets.map(loadBody));
  const fits = loaded.map((body, index) => {
    // The fat cat stays on the stock legs so its own silhouette stays the subject.
    const baked = presets[index].slug === 'fat' ? undefined : legPreset;
    const fit = buildCat(body, presets[index].anchor, presets[index].rearExtension, baked, legGeometry);
    assembledStages[index].pivot.add(fit.actor.root);
    assembledStages[index].draw();
    return fit;
  });

  // The default body twice: once with the baked, bone-driven legs and once with
  // the stock rubber-hose legs, so the leg change can be judged on its own.
  const extraStages = [];
  if (legPreset && legGeometry) {
    const hoseBody = await loadBody(presets[2]);
    const hoseStage = makeStage(assembled, 'Tube · default (hose legs)', `${caption(presets[2])} · stock hose legs`);
    hoseStage.pivot.add(buildCat(hoseBody, presets[2].anchor, presets[2].rearExtension).actor.root);
    hoseStage.draw();
    extraStages.push(hoseStage);
  }

  linkPreviewOrbit(
    [...silhouetteStages, currentStage, ...assembledStages, ...extraStages],
    cameraTarget,
    angleButtons,
    -1,
  );
  status.textContent = `Loaded ${fits.length} baked GLB bodies (${presets.map(p => p.triangles.toLocaleString()).join(' and ')} triangles), the current cat, and the reference sheet.`;
}

main().catch(error => {
  console.error(error);
  status.textContent = `Could not load the study: ${String(error)}`;
});
