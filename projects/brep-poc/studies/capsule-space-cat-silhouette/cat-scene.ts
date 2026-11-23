/**
 * Shared assembly for the space cat study pages: load a baked body, load the
 * baked leg, and build the Concept Fit cat around them.
 */

import { BufferGeometry, Group, Mesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CapsuleCatLegMesh } from 'triangular-engine/procedural';
import { buildExperimentalSpaceCat, type SpaceCatLeg, type SpaceCatTail } from '../../../demo-app/src/app/pages/character-studio/experimental-space-cat';

interface BodyRig {
  legs: ReadonlyMap<string, SpaceCatLeg>;
  tail?: SpaceCatTail;
}

export interface Preset {
  label: string;
  slug: string;
  encoded: string;
  caption: string;
  anchor: { y: number; z: number };
  rearExtension: number;
  triangles: number;
}

export interface LegPreset {
  encoded: string;
  triangles: number;
  hipHeight: number;
  pawRadius: number;
}

const loader = new GLTFLoader();

export async function loadBody(preset: Preset): Promise<Group> {
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

export function hideGear(root: Group): void {
  for (const name of ['concept-cat-helmet', 'capsule-cat-pet-jetpack', 'capsule-cat-harness']) {
    const part = root.getObjectByName(name);
    if (part) part.visible = false;
  }
}

/** The baked leg's geometry in metres, with the ankle joint at the origin. */
export async function loadLegGeometry(preset: Pick<LegPreset, 'encoded'>): Promise<BufferGeometry> {
  const bytes = Uint8Array.from(atob(preset.encoded), character => character.charCodeAt(0));
  const gltf = await loader.parseAsync(bytes.buffer, '');
  gltf.scene.updateMatrixWorld(true);
  let geometry: BufferGeometry | null = null;
  gltf.scene.traverse(object => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || geometry) return;
    geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
  });
  if (!geometry) throw new Error('The baked leg has no mesh');
  return geometry;
}

/** An assembled cat, with the Concept Fit's face, tail and either set of legs. */
export function buildCat(
  body: Group | null,
  anchor?: { y: number; z: number },
  rearExtension = 0,
  leg?: LegPreset,
  legGeometry?: BufferGeometry,
  rig?: BodyRig,
) {
  const tail = rig?.tail;
  const fit = buildExperimentalSpaceCat(false, undefined, {
    rearExtension,
    legFactory: ({ name, material }) => {
      const fused = rig?.legs.get(name);
      if (fused) return fused;
      if (!leg || !legGeometry) return null;
      return new CapsuleCatLegMesh({ geometry: legGeometry.clone(), material, rest: { hipHeight: leg.hipHeight }, name });
    },
    tailFactory: tail ? () => tail : undefined,
  });
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
