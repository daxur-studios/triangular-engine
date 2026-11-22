import { isValidSolid, getSolids, mesh, OcctWasmAdapter, registerKernel, toBufferGeometryData } from 'brepjs';
import { OcctKernel } from 'occt-wasm';
import {
  AmbientLight, BufferAttribute, BufferGeometry, Color, DirectionalLight, Mesh, MeshStandardMaterial,
  OrthographicCamera, Scene, Vector3, WebGLRenderer,
} from 'three';
import { FacialAnimationController } from 'triangular-engine/characters';
import { buildExperimentalPigtailHead } from '../../../demo-app/src/app/pages/character-studio/experimental-pigtail-head';
import buildBob, { params, type BobValues } from '../../src/app/part/capsule-bob.brep';
import { linkPreviewOrbit } from '../preview-orbit';

const status = document.querySelector<HTMLElement>('[role=status]')!;
const reset = document.querySelector<HTMLButtonElement>('#reset')!;
const hairColor = 0x302825;
const headLocalMm = 100;
const cameraTarget = new Vector3(0, 2.32, 0);

function createView(id: string) {
  const canvas = document.querySelector<HTMLCanvasElement>(id)!;
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new Scene();
  scene.background = new Color('#ede1d2');
  const face = buildExperimentalPigtailHead(new FacialAnimationController());
  face.setHair('bob', 0, undefined, false, false, hairColor);
  face.head.scale.setScalar(1);
  face.update(0);
  const hair = face.head.getObjectByName('capsule-hair-bob')!;
  scene.add(face.head);
  const camera = new OrthographicCamera();
  camera.position.copy(cameraTarget).z += 10;
  camera.lookAt(cameraTarget);
  scene.add(new AmbientLight(0xffeee1, 1.45));
  const key = new DirectionalLight(0xfff6ee, 2.5);
  key.position.set(-3, 7, 6);
  const rim = new DirectionalLight(0xe9eaff, 1.8);
  rim.position.set(5, 5, -5);
  scene.add(key, rim);

  const draw = () => renderer.render(scene, camera);
  function resize() {
    const { width, height } = canvas.getBoundingClientRect();
    renderer.setSize(width, height, false);
    const aspect = width / height;
    const halfHeight = Math.max(2.65, 2.45 / aspect);
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    draw();
  }

  new ResizeObserver(resize).observe(canvas);
  return { face, hair, canvas, camera, draw };
}

function createHairMaterial() {
  const material = new MeshStandardMaterial({ color: hairColor, roughness: .82 });
  const grooves = { value: 1 };
  material.onBeforeCompile = shader => {
    shader.uniforms['grooveStrength'] = grooves;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 hairLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nhairLocal = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 hairLocal;\nuniform float grooveStrength;')
      .replace('#include <color_fragment>', `
        #include <color_fragment>
        float angle = atan(hairLocal.x, hairLocal.z);
        float groove = pow(.5 - .5 * cos(16.0 * angle), 8.0);
        float crownFade = smoothstep(.14, 1.1, length(hairLocal.xz));
        float frontEmphasis = mix(.26, 1.0, smoothstep(-.45, .85, cos(angle)));
        float channel = grooveStrength * groove * crownFade * frontEmphasis;
        diffuseColor.rgb *= 1.0 - .27 * channel;
      `)
      .replace('#include <normal_fragment_maps>', `
        #include <normal_fragment_maps>
        vec3 dx = dFdx(-vViewPosition);
        vec3 dy = dFdy(-vViewPosition);
        vec3 right = cross(dy, normal);
        vec3 up = cross(normal, dx);
        float det = dot(dx, right);
        vec3 gradient = sign(det) * (right * dFdx(channel) + up * dFdy(channel));
        normal = normalize(max(abs(det), 1e-12) * normal + .020 * gradient);
      `);
  };
  return { material, grooves };
}

async function main() {
  const current = createView('#current');
  const brep = createView('#brep');
  brep.hair.visible = false;
  const { material, grooves } = createHairMaterial();
  const cap = new Mesh(new BufferGeometry(), material);
  const detail = document.querySelector<HTMLInputElement>('#grooves')!;
  detail.addEventListener('change', () => {
    grooves.value = Number(detail.checked);
    brep.draw();
  });
  brep.face.head.add(cap);
  const angles = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-angle]'));
  linkPreviewOrbit([current, brep], cameraTarget, angles);

  const controls = document.querySelector('.controls')!;
  const values = { ...params.values };
  const inputs = new Map<keyof BobValues, HTMLInputElement>();
  let timer = 0;
  for (const key of Object.keys(params.values) as (keyof BobValues)[]) {
    const definition = params.defs[key];
    const label = document.createElement('label');
    const output = document.createElement('output');
    output.textContent = `${values[key]} mm`;
    const input = document.createElement('input');
    input.id = key;
    input.type = 'range';
    input.min = String(definition.min);
    input.max = String(definition.max);
    input.step = String(definition.step);
    input.value = String(values[key]);
    input.disabled = true;
    output.htmlFor.add(key);
    label.append(definition.label ?? key, output, input);
    controls.append(label);
    inputs.set(key, input);
    input.addEventListener('input', () => {
      values[key] = input.valueAsNumber;
      output.textContent = `${values[key]} mm`;
      window.clearTimeout(timer);
      status.textContent = 'Rebuilding…';
      timer = window.setTimeout(rebuild, 120);
    });
  }

  function rebuild() {
    try {
      const start = performance.now();
      const solid = buildBob(values);
      try {
        const bodies = getSolids(solid);
        try {
          if (bodies.length !== 1 || !isValidSolid(bodies[0])) throw new Error('The CAD shape is invalid.');
        } finally {
          bodies.forEach(body => body.delete());
        }
        const data = toBufferGeometryData(mesh(solid, { tolerance: .3, angularTolerance: .15 }));
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(data.position, 3));
        geometry.setAttribute('normal', new BufferAttribute(data.normal, 3));
        geometry.setIndex(new BufferAttribute(data.index, 1));
        // CAD millimetres, Z-up, into the workshop's unscaled, Y-up head coordinates.
        geometry.rotateX(-Math.PI / 2);
        geometry.scale(1 / headLocalMm, 1 / headLocalMm, 1 / headLocalMm);
        cap.geometry.dispose();
        cap.geometry = geometry;
        brep.draw();
        status.textContent = `Valid solid · ${Math.round(performance.now() - start)} ms`;
      } finally {
        solid.delete();
      }
    } catch (error) {
      status.textContent = `Could not build this shape. ${String(error)}`;
    }
  }

  const encoded = document.querySelector('#kernel')!;
  const binary = Uint8Array.from(atob(encoded.textContent!), character => character.charCodeAt(0));
  encoded.remove();
  const kernel = await OcctKernel.init({ wasm: binary });
  registerKernel('occt-wasm', OcctWasmAdapter.fromKernel(kernel));
  for (const input of inputs.values()) input.disabled = false;
  reset.disabled = false;
  reset.addEventListener('click', () => {
    for (const [key, input] of inputs) {
      input.value = String(params.values[key]);
      input.dispatchEvent(new Event('input'));
    }
  });
  rebuild();
}

main().catch(error => {
  console.error(error);
  status.textContent = String(error);
});
