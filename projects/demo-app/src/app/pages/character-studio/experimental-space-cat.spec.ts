import type { BufferGeometry, Mesh, MeshStandardMaterial, WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three';
import { createCharacterStudioContributions } from './character-studio-contributions';
import { buildExperimentalSpaceCat, EXPERIMENTAL_SPACE_CAT } from './experimental-space-cat';

describe('Character Studio concept-fit cat', () => {
  it('places the helmet collar at the head and torso intersection in profile', () => {
    const fit = buildExperimentalSpaceCat(false);
    try {
      const collar = fit.actor.root.getObjectByName('concept-cat-helmet')!;
      const radius = fit.actor.dna.bodyRadius;
      const headZ = 0.176 + fit.actor.dna.bodyLength / 2 * 1.04;
      // Remove the raised collar allowance to recover the two intersection points.
      const geometry = (fit.actor.root.getObjectByName('concept-cat-collar') as Mesh).geometry;
      geometry.computeBoundingBox();
      const halfJoin = geometry.boundingBox!.max.x * 0.318 / 0.335 - 0.035;
      for (const sign of [-1, 1]) {
        const y = collar.position.y + sign * halfJoin * Math.cos(collar.rotation.x);
        const z = collar.position.z - sign * halfJoin * Math.sin(collar.rotation.x);
        const head = ((y - 0.195) / (radius * 1.17 * 0.96)) ** 2 + ((z - headZ) / (radius * 1.04)) ** 2;
        const body = ((y + 0.062) / (0.266 * 1.04)) ** 2 + ((z - (0.012 + 0.355 / 2)) / 0.266) ** 2;
        expect(head).toBeCloseTo(1, 4);
        expect(body).toBeCloseTo(1, 4);
      }
    } finally {
      fit.dispose();
    }
  });

  it('selects the study independently and restores the standard cat when switching presets', () => {
    const { cat, human } = createCharacterStudioContributions();
    try {
      const standard = cat.root.children[0];
      expect(cat.root.getObjectByName('concept-cat-head')).toBeUndefined();

      cat.selectPreset(EXPERIMENTAL_SPACE_CAT.id);
      expect(cat.root.getObjectByName('concept-cat-head')).toBeDefined();
      cat.setControl('helmet', 'false');
      expect(cat.root.getObjectByName('concept-cat-helmet-dome')!.visible).toBeFalse();

      cat.selectPreset(cat.defaultPresetId);
      expect(cat.root.children).toEqual([standard]);
      const helmet = cat.controlGroups().flatMap(group => group.controls).find(control => control.id === 'helmet');
      expect(helmet?.value).toBe('true');

      cat.selectPreset(EXPERIMENTAL_SPACE_CAT.id);
      expect(cat.root.getObjectByName('concept-cat-helmet-dome')!.visible).toBeTrue();
    } finally {
      cat.dispose();
      human.dispose();
    }
  });

  it('keeps gait, facial projection, selectable gear and the fitted shape on appearance changes', () => {
    const fit = buildExperimentalSpaceCat(false);
    const { actor } = fit;
    try {
      actor.setLocomotion('goofy_walk');
      const headGeometry = actor.catBody.mesh.geometry;
      const pawBefore = actor.frontLeftPaw.root.position.clone();
      const tail = actor.root.getObjectByName('concept-cat-tail')!.getObjectByName('capsule-cat-tail-tube') as Mesh;
      const tailPositions = tail.geometry.getAttribute('position').array;
      const tailBefore = [...tailPositions];
      actor.facialController.setExpression('surprised', 1, 0);
      fit.update(0.12);
      expect(actor.frontLeftPaw.root.position.distanceTo(pawBefore)).toBeGreaterThan(0.01);
      expect(actor.latestFaceProjection?.mouth.mouthOpen).toBeGreaterThan(0.3);
      expect([...tailPositions]).not.toEqual(tailBefore);

      fit.setDna({ helmet: false, pack: 'jetpack', harness: true, suitBooties: false, furColor: '#b86e3a' });
      expect(actor.root.getObjectByName('capsule-cat-pet-jetpack')).toBeDefined();
      expect(actor.root.getObjectByName('capsule-cat-harness')).toBeDefined();
      expect(actor.root.getObjectByName('concept-cat-helmet')!.visible).toBeTrue();
      expect(actor.root.getObjectByName('concept-cat-helmet-dome')!.visible).toBeFalse();
      expect(actor.frontLeftPaw.root.children.at(-1)!.visible).toBeFalse();
      expect(actor.catBody.mesh.geometry).toBe(headGeometry);
      expect(tail.geometry.getAttribute('position').array).toBe(tailPositions);
    } finally {
      fit.dispose();
    }
  });

  it('uses a recessed pink ear surface with a shared edge at the fur rim', () => {
    const fit = buildExperimentalSpaceCat(false);
    try {
      for (const ear of [fit.actor.catFaceRig.leftEar, fit.actor.catFaceRig.rightEar]) {
        expect(ear.children.length).toBe(1);
        const { geometry } = ear.children[0] as Mesh;
        const [fur, pink] = geometry.groups;
        const indices = geometry.getIndex()!.array;
        const positions = geometry.getAttribute('position');
        const furVertices = new Set(indices.slice(fur.start, fur.start + fur.count));
        const pinkVertices = new Set(indices.slice(pink.start, pink.start + pink.count));
        const sharedRim = [...pinkVertices].filter(index => furVertices.has(index));
        expect(sharedRim.length).toBeGreaterThan(3);
        const rimDepth = Math.min(...sharedRim.map(index => positions.getZ(index)));
        const floorDepth = Math.min(...[...pinkVertices].map(index => positions.getZ(index)));
        expect(rimDepth - floorDepth).toBeGreaterThan(0.03);
      }
    } finally {
      fit.dispose();
    }
  });

  it('slides the hind legs and tail with the visible rear extension', () => {
    const stock = buildExperimentalSpaceCat(false);
    const extended = buildExperimentalSpaceCat(false, undefined, { rearExtension: 0.2 });
    const tailBox = (fit: typeof stock) => {
      const mesh = fit.actor.root.getObjectByName('concept-cat-tail')!
        .getObjectByName('capsule-cat-tail-tube') as Mesh;
      mesh.geometry.computeBoundingBox();
      return mesh.geometry.boundingBox!;
    };
    try {
      stock.update(0.3);
      extended.update(0.3);
      const frontShift = extended.actor.frontLeftPaw.root.position.z - stock.actor.frontLeftPaw.root.position.z;
      const backShift = extended.actor.backLeftPaw.root.position.z - stock.actor.backLeftPaw.root.position.z;
      expect(Math.abs(frontShift)).toBeLessThan(1e-9);
      expect(backShift).toBeCloseTo(-0.2, 9);
      expect(tailBox(extended).min.z - tailBox(stock).min.z).toBeCloseTo(-0.2, 3);
    } finally {
      stock.dispose();
      extended.dispose();
    }
  });

  it('updates the rump material in place as the suit covers or exposes the rear', () => {
    const fit = buildExperimentalSpaceCat(false);
    try {
      const torso = fit.actor.root.getObjectByName('concept-cat-torso') as Mesh<BufferGeometry, MeshStandardMaterial>;
      const shader = {
        uniforms: {}, vertexShader: '', fragmentShader: '#include <common>\n#include <color_fragment>',
      } as WebGLProgramParametersWithUniforms;
      torso.material.onBeforeCompile(shader, {} as WebGLRenderer);
      const pattern = shader.uniforms['catPattern'];
      expect(pattern.value).toBe(0);

      fit.setDna({ bodyPattern: 'full_suit' });
      expect(pattern.value).toBe(1);
      fit.setDna({ bodyPattern: 'natural_two_tone' });
      expect(pattern.value).toBe(2);
      expect(fit.actor.root.getObjectByName('concept-cat-torso')).toBe(torso);
    } finally {
      fit.dispose();
    }
  });
});
