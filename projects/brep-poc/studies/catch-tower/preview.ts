import {
  Box3, Color, DirectionalLight, GridHelper, Group, HemisphereLight, OrthographicCamera,
  Scene, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { armPose, armSides, booster, metres, tower } from './dimensions.ts';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const mode = element<HTMLSelectElement>('motion');
const variant = element<HTMLSelectElement>('variant');
const height = element<HTMLInputElement>('height');
const heightValue = element<HTMLOutputElement>('height-value');
const sweep = element<HTMLButtonElement>('sweep');
const status = element<HTMLParagraphElement>('status');
const cameraButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-view]')];
const nominal = metres(tower.nominalRailHeight);
const minimum = metres(tower.minSocketHeight - tower.socketAboveRail);
const maximum = metres(tower.maxSocketHeight - tower.socketAboveRail);
const format = (m: number) => `${m.toFixed(2)} m`;

const views = {
  fit: { offset: new Vector3(35, 30, 43), width: 27, height: 16 },
  top: { offset: new Vector3(0, 70, .35), width: 28, height: 20 },
  side: { offset: new Vector3(0, 8, 75), width: 25, height: 13 },
  pins: { offset: new Vector3(60, 32, 8), width: 7.5, height: 5.2 },
  tower: { offset: new Vector3(72, 31, 101), width: 44, height: 90 },
};
type ViewName = keyof typeof views;
interface Fit {
  contactWidthM: number;
  openPinClearancePerSideM: number;
  openHingedPinClearancePerSideM: number;
}

function createPanel(id: string, models: Map<string, Group>) {
  const canvas = element<HTMLCanvasElement>(id);
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
  const scene = new Scene();
  scene.background = new Color('#253440');
  scene.add(new HemisphereLight('#d6edff', '#65717c', 2.35));
  for (const [position, color, intensity] of [
    [[28, 72, 42], '#ffe6c5', 2.75], [[-14, 35, -44], '#b2d8ff', 1.85],
  ] as const) {
    const light = new DirectionalLight(color, intensity);
    light.position.set(position[0], position[1], position[2]);
    scene.add(light);
  }
  const grid = new GridHelper(160, 32, '#577081', '#384b58');
  grid.position.y = -.01;
  scene.add(grid, models.get('tower')!.clone());

  const carriage = models.get('carriage')!.clone();
  const proxy = models.get('booster-proxy')!.clone();
  const arms = Object.entries(armSides).map(([hand, side]) => {
    const mount = new Group();
    carriage.add(mount);
    return { hand, side, mount };
  });
  scene.add(carriage, proxy);
  const camera = new OrthographicCamera(-15, 15, 10, -10, .1, 350);
  camera.position.copy(views.fit.offset);
  const orbit = new OrbitControls(camera, canvas);
  orbit.enablePan = false;
  orbit.minZoom = .55;
  orbit.maxZoom = 7;
  orbit.minPolarAngle = .002;
  orbit.maxPolarAngle = Math.PI - .06;

  return {
    canvas, camera, orbit, grid,
    draw() { renderer.render(scene, camera); },
    resize(view: ViewName) {
      const { width, height } = canvas.getBoundingClientRect();
      const aspect = width / height;
      const frame = views[view];
      const halfHeight = Math.max(frame.height, frame.width / aspect) / 2;
      camera.left = -halfHeight * aspect;
      camera.right = halfHeight * aspect;
      camera.top = halfHeight;
      camera.bottom = -halfHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    },
    profile(name: string) {
      arms.forEach(({ hand, mount }) => {
        mount.clear();
        mount.add(models.get(`${name}-arm-${hand}`)!.clone());
      });
    },
    pose(railHeight: number, openness: number, motion: 'hinge' | 'slide') {
      carriage.position.set(metres(tower.carriageX), railHeight - metres(tower.padTop), 0);
      proxy.position.set(metres(booster.centerX), railHeight, 0);
      arms.forEach(({ side, mount }) => {
        const { y, yaw } = armPose(side, openness, motion);
        mount.position.set(metres(tower.armRootX - tower.carriageX), 0, metres(-y));
        mount.rotation.y = yaw;
      });
    },
  };
}

function moveToward(value: number, target: number, step: number) {
  const remaining = target - value;
  return Math.abs(remaining) <= step ? target : value + Math.sign(remaining) * step;
}

async function main() {
  const data = element<HTMLScriptElement>('assets');
  const { embedded, fit } = JSON.parse(data.textContent!) as {
    embedded: Record<string, string>;
    fit: Record<string, Fit[]>;
  };
  data.remove();
  const loader = new GLTFLoader();
  const models = new Map(await Promise.all(Object.entries(embedded).map(async ([name, encoded]) => {
    const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    const { scene } = await loader.parseAsync(bytes.buffer, '');
    return [name, scene] as const;
  })));
  const towerHeight = new Box3().setFromObject(models.get('tower')!).max.y;
  if (Math.abs(towerHeight - metres(tower.height)) > .005) throw new Error('Tower GLB height or axis differs from the CAD model');

  const moving = createPanel('moving', models);
  const seated = createPanel('seated', models);
  const panels = [moving, seated];
  const clearance = element<HTMLDivElement>('clearance');
  const support = element<HTMLDivElement>('support');
  const armState = element<HTMLSpanElement>('arm-state');
  const title = element<HTMLHeadingElement>('moving-title');
  let activeView: ViewName = 'fit';
  let railHeight = nominal;
  let targetHeight = nominal;
  let openness = 1;
  let targetOpen = 1;
  let previousFrame = 0;
  let framePending = false;
  let syncing = false;
  height.min = String(minimum);
  height.max = String(maximum);

  function draw() {
    const hinged = mode.value === 'hinge';
    moving.pose(railHeight, openness, hinged ? 'hinge' : 'slide');
    seated.pose(railHeight, 0, 'slide');
    panels.forEach(panel => panel.draw());
    heightValue.value = format(railHeight);
    armState.textContent = `${Math.round(openness * 100)}% open`;
    title.textContent = openness === 1 ? 'Arms open' : openness === 0 ? 'Arms closed' : 'Arms moving';
    const measurement = fit[variant.value][0];
    const openGap = hinged ? measurement.openHingedPinClearancePerSideM : measurement.openPinClearancePerSideM;
    clearance.textContent = openness === 1 ? `${format(openGap)} clear beyond each pin` : openness === 0
      ? 'Both pads under the pins' : 'Moving between open and closed';
    support.textContent = `${format(measurement.contactWidthM)} support under each pin`;
  }

  function focus() {
    const focusX = activeView === 'pins' ? metres(booster.centerX) : 4;
    const target = activeView === 'tower' ? new Vector3(-3, 40, 0) : new Vector3(focusX, railHeight - .2, 0);
    syncing = true;
    for (const panel of panels) {
      panel.grid.visible = activeView === 'tower';
      panel.orbit.target.copy(target);
      panel.camera.position.copy(views[activeView].offset).add(target);
      panel.camera.zoom = 1;
      panel.resize(activeView);
      panel.orbit.update();
    }
    syncing = false;
    draw();
  }

  function updateHeight(next: number) {
    if (activeView !== 'tower') {
      const delta = next - railHeight;
      for (const panel of panels) {
        panel.camera.position.y += delta;
        panel.orbit.target.y += delta;
      }
    }
    railHeight = next;
  }

  function animate(now: number) {
    framePending = false;
    const elapsed = previousFrame ? Math.min((now - previousFrame) / 1000, .05) : 0;
    previousFrame = now;
    updateHeight(moveToward(railHeight, targetHeight, metres(tower.liftSpeed) * elapsed));
    const speed = mode.value === 'slide' ? tower.slideSpeed / (tower.openPadCenter - tower.closedPadCenter) : .85;
    openness = moveToward(openness, targetOpen, speed * elapsed);
    draw();
    if (railHeight !== targetHeight || openness !== targetOpen) schedule();
    else previousFrame = 0;
  }

  function schedule() {
    if (framePending) return;
    framePending = true;
    requestAnimationFrame(animate);
  }

  for (const panel of panels) {
    panel.orbit.addEventListener('change', () => {
      if (syncing) return;
      syncing = true;
      for (const other of panels) {
        if (other === panel) continue;
        other.camera.position.copy(panel.camera.position);
        other.camera.zoom = panel.camera.zoom;
        other.camera.updateProjectionMatrix();
        other.orbit.target.copy(panel.orbit.target);
        other.orbit.update();
      }
      syncing = false;
      cameraButtons.forEach(button => button.setAttribute('aria-pressed', 'false'));
      draw();
    });
    new ResizeObserver(() => { panel.resize(activeView); panel.draw(); }).observe(panel.canvas);
  }
  for (const button of cameraButtons) button.addEventListener('click', () => {
    activeView = button.dataset['view'] as ViewName;
    cameraButtons.forEach(other => other.setAttribute('aria-pressed', String(other === button)));
    focus();
  });
  function setHeight(next: number) {
    targetHeight = Math.max(minimum, Math.min(maximum, next));
    height.value = String(targetHeight);
    schedule();
  }
  element('lower').addEventListener('click', () => setHeight(targetHeight - 5));
  element('raise').addEventListener('click', () => setHeight(targetHeight + 5));
  element('reset-height').addEventListener('click', () => setHeight(nominal));
  height.addEventListener('input', () => {
    targetHeight = Number(height.value);
    updateHeight(targetHeight);
    draw();
  });
  sweep.addEventListener('click', () => {
    targetOpen = 1 - targetOpen;
    sweep.textContent = targetOpen ? 'Close arms' : 'Open arms';
    schedule();
  });
  mode.addEventListener('change', draw);
  function applyProfile() {
    panels.forEach(panel => panel.profile(variant.value));
    draw();
  }
  variant.addEventListener('change', applyProfile);
  applyProfile();
  focus();
  element<HTMLFieldSetElement>('controls').disabled = false;
  status.textContent = 'Both views use the same stock booster proxy and rail height.';
}

main().catch(error => {
  console.error(error);
  status.textContent = 'Unable to load the baked catch tower.';
});
