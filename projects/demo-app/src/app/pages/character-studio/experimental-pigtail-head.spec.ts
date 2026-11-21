import { Box3, Matrix3, Mesh, MeshStandardMaterial, Raycaster, Vector2, Vector3, type Object3D, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from 'three';
import { FacialAnimationController } from 'triangular-engine/characters';
import type { ExtendedEmotionName } from 'triangular-engine/characters';
import type { CapsuleBodyUniformMap } from 'triangular-engine/procedural';
import { createCharacterStudioContributions } from './character-studio-contributions';
import { boundStacheOffset, DEFAULT_STACHE_SHAPE, stacheTip, type StacheShape } from './classic-stache-shapes';
import {
  buildExperimentalHairPreview, buildExperimentalPigtailHead, EXPERIMENTAL_PIGTAIL_HEAD_ID, EXPERIMENTAL_PIGTAIL_PRESETS,
} from './experimental-pigtail-head';

describe('Character Studio experimental pigtail preset', () => {
  let studio: ReturnType<typeof createCharacterStudioContributions>;

  beforeEach(() => { studio = createCharacterStudioContributions(); });
  afterEach(() => { Object.values(studio).forEach(contribution => contribution.dispose()); });

  function captureUniforms(root: Object3D, meshName: string) {
    const mesh = root.getObjectByName(meshName) as Mesh;
    const shader = { uniforms: {}, vertexShader: '', fragmentShader: '' } as WebGLProgramParametersWithUniforms;
    (mesh.material as MeshStandardMaterial).onBeforeCompile(shader, {} as WebGLRenderer);
    return shader.uniforms;
  }

  function captureMouthUniforms(): CapsuleBodyUniformMap {
    return captureUniforms(studio.human.root, 'pigtail-skin') as unknown as CapsuleBodyUniformMap;
  }

  it('swaps the same hair recipe in the swatch and character without replacing the speaking face', () => {
    const human = studio.human;
    human.selectPreset(EXPERIMENTAL_PIGTAIL_HEAD_ID);
    const body = human.root.getObjectByName('pigtail-standing-body');
    const skin = human.root.getObjectByName('pigtail-skin');
    const ears = human.root.getObjectByName('shaggy-ears')!;
    const mouth = captureMouthUniforms();
    const swatch = buildExperimentalHairPreview();

    try {
      expect(ears.visible).toBeFalse();
      human.setExpression('neutral');
      human.update(.3);
      const restingOpen = mouth.uMouthOpen.value;
      human.speechPreview!.play([{ time: 0, viseme: 'A', duration: .4 }]);
      human.setExperimentalHair('shaggy', 1.12);
      expect(ears.visible).toBeTrue();
      swatch.setHair('shaggy', 1.12);
      for (let frame = 0; frame < 12; frame++) human.update(1 / 60);

      const style = human.root.getObjectByName('capsule-hair-shaggy')!;
      const swatchStyle = swatch.root.getObjectByName('capsule-hair-shaggy')!;
      expect(style.children.map(part => part.scale.toArray())).toEqual(swatchStyle.children.map(part => part.scale.toArray()));
      expect(style.children.at(-1)?.scale.x).toBeCloseTo(1.12, 6);
      expect(human.root.getObjectByName('pigtail-tuft-left')).toBeUndefined();
      expect(human.root.getObjectByName('pigtail-skin')).toBe(skin);
      expect(human.root.getObjectByName('pigtail-standing-body')).toBe(body);
      expect(mouth.uMouthOpen.value).toBeGreaterThan(restingOpen);

      human.setExperimentalHair('pigtails', 1);
      expect(ears.visible).toBeFalse();
      expect(human.root.getObjectByName('capsule-hair-shaggy')).toBeUndefined();
      expect(human.root.getObjectByName('pigtail-tuft-left')).toBeDefined();
    } finally {
      swatch.dispose();
    }
  });

  it('shares the edited Classic Stache fringe and mirrors only the mustache tips', () => {
    const human = studio.human;
    human.selectPreset(EXPERIMENTAL_PIGTAIL_HEAD_ID);
    const swatch = buildExperimentalHairPreview();
    const edit: StacheShape = {
      fringe: boundStacheOffset('fringe', -.25, .3),
      mustache: boundStacheOffset('mustache', 1, .25),
    };
    const tip = (mesh: Mesh) => {
      const vertices = mesh.geometry.getAttribute('position');
      return new Vector3().fromBufferAttribute(vertices, vertices.count - 1).multiply(mesh.scale).add(mesh.position);
    };
    const fringe = (root: Object3D) => root.getObjectByName('classic-stache-fringe') as Mesh;
    try {
      human.setExperimentalHair('classic-stache', 1);
      const haircut = human.root.getObjectByName('capsule-hair-classic-stache')!;
      const staticGeometry = (haircut.children[2] as Mesh).geometry;
      const face = human.root.getObjectByName('pigtail-skin');
      const oldFringe = tip(fringe(human.root));
      const mouth = captureMouthUniforms();
      human.update(.3);
      const restingOpen = mouth.uMouthOpen.value;
      human.speechPreview!.play([{ time: 0, viseme: 'A', duration: .4 }]);
      human.setExperimentalHair('classic-stache', 1, edit);
      swatch.setHair('classic-stache', 1, edit.fringe);
      human.update(.1);

      const editedFringe = tip(fringe(human.root));
      expect(editedFringe).toEqual(tip(fringe(swatch.root)));
      expect(editedFringe.distanceTo(oldFringe)).toBeGreaterThan(.25);
      expect((haircut.children[2] as Mesh).geometry).toBe(staticGeometry);
      expect(human.root.getObjectByName('pigtail-skin')).toBe(face);
      expect(mouth.uMouthOpen.value).toBeGreaterThan(restingOpen);

      const accessory = human.root.getObjectByName('classic-mustache')!;
      const [left, right] = accessory.children as Mesh[];
      const rightTip = tip(right);
      expect(edit.mustache[0]).toBe(.30);
      expect(rightTip.distanceTo(new Vector3(...stacheTip('mustache', edit.mustache)))).toBeLessThan(1e-6);
      expect(tip(left)).toEqual(rightTip.clone().multiply(new Vector3(-1, 1, 1)));

      human.setExperimentalHair('classic-stache', 1, edit, false);
      expect(accessory.visible).toBeFalse();
      expect(tip(fringe(human.root))).toEqual(editedFringe);
      human.setExperimentalHair('classic-stache', 1, DEFAULT_STACHE_SHAPE);
      expect(accessory.visible).toBeTrue();
      expect(tip(fringe(human.root))).toEqual(oldFringe);
    } finally {
      swatch.dispose();
    }
  });

  it('sets each Shaggy ear flush against the temple with its bowl above the skin', () => {
    const character = buildExperimentalPigtailHead(new FacialAnimationController());
    const ray = new Raycaster();
    try {
      character.setHair('shaggy', 1);
      character.head.updateMatrixWorld(true);
      const ears = character.head.getObjectByName('shaggy-ears')!.children;
      const skin = character.head.getObjectByName('pigtail-skin')!;
      expect(ears.length).toBe(2);
      for (const ear of ears) {
        const side = Math.sign(ear.position.x);
        expect(Math.abs(ear.position.z)).toBeLessThan(.20);
        const direction = new Vector3(0, 0, -1).transformDirection(ear.matrixWorld);
        expect(direction.x).toBeCloseTo(-side, 6);
        expect(direction.z).toBeCloseTo(0, 6);

        ray.set(ear.localToWorld(new Vector3(.01, .05, 1)), direction);
        const templeX = ray.intersectObject(skin, false)[0]!.point.x;
        const bounds = new Box3().setFromObject(ear, true);
        const outerX = side > 0 ? bounds.max.x : bounds.min.x;
        const innerX = side > 0 ? bounds.min.x : bounds.max.x;
        const exposedDepth = side * (outerX - templeX);
        expect(exposedDepth).toBeGreaterThan(.025);
        expect(exposedDepth).toBeLessThan(.045);
        expect(side * (templeX - innerX)).toBeGreaterThan(exposedDepth);

        const depthAt = (x: number) => {
          ray.set(ear.localToWorld(new Vector3(x, .05, 1)), direction);
          const [hit] = ray.intersectObjects([ear, skin], false);
          expect(hit?.object).toBe(ear);
          return hit ? ear.worldToLocal(hit.point).z : NaN;
        };
        const bowl = depthAt(.01);
        expect(depthAt(.16) - bowl).toBeGreaterThan(.05);
      }
    } finally {
      character.dispose();
    }
  });

  it('covers the scalp behind the Shaggy fringe when viewed from above', () => {
    const swatch = buildExperimentalHairPreview();
    const [scalp, hair] = swatch.root.children;
    const ray = new Raycaster();
    try {
      for (const length of [.86, 1, 1.14]) {
        swatch.setHair('shaggy', length);
        swatch.root.updateMatrixWorld(true);
        for (const azimuth of [-55, 0, 55]) {
          const yaw = azimuth * Math.PI / 180;
          const direction = new Vector3(-.6 * Math.sin(yaw), -.8, -.6 * Math.cos(yaw));
          for (const x of [0, .15]) {
            const origin = new Vector3(x, 3.8, 1.25).addScaledVector(direction, -4);
            ray.set(swatch.root.localToWorld(origin), direction);
            const [visible] = ray.intersectObjects([scalp, hair], true);
            expect(visible?.object.parent).withContext(`length=${length}, yaw=${azimuth}, x=${x}`).toBe(hair.children[0]);
          }
        }
      }
    } finally {
      swatch.dispose();
    }
  });

  it('keeps the Shaggy scalp covered from crown to nape at either lock length limit', () => {
    const swatch = buildExperimentalHairPreview();
    const [scalp, hair] = swatch.root.children;
    const ray = new Raycaster();
    const rear = new Vector3(0, 0, 1);
    try {
      for (const length of [.86, 1.14]) {
        swatch.setHair('shaggy', length);
        swatch.root.updateMatrixWorld(true);
        for (const height of [1.15, 1.80, 2.50, 3.30]) {
          for (const x of [-.65, 0, .65]) {
            ray.set(swatch.root.localToWorld(new Vector3(x, height, -4)), rear);
            const [visible] = ray.intersectObjects([scalp, hair], true);
            expect(visible?.object.parent).withContext(`length=${length}, height=${height}, x=${x}`).toBe(hair.children[0]);
          }
        }
      }
    } finally {
      swatch.dispose();
    }
  });

  it('uses the Studio expression controller to widen the smile and open the surprised mouth', () => {
    const human = studio.human;
    human.selectPreset(EXPERIMENTAL_PIGTAIL_HEAD_ID);
    const uniforms = captureMouthUniforms();
    const setExpression = (expression: ExtendedEmotionName) => {
      human.setExpression(expression);
      for (let frame = 0; frame < 30; frame++) human.update(1 / 60);
      return {
        width: uniforms.uMouthWidth.value,
        open: uniforms.uMouthOpen.value,
        curve: uniforms.uMouthCurve.value,
      };
    };

    const neutral = setExpression('neutral');
    const happy = setExpression('happy');
    const surprised = setExpression('surprised');

    expect(happy.width).toBeGreaterThan(neutral.width);
    expect(happy.curve).toBeGreaterThan(neutral.curve);
    expect(surprised.width).toBeLessThan(neutral.width);
    expect(surprised.open).toBeGreaterThan(happy.open);
  });

  it('shows the tongue on an open speech shape and releases back to the chosen expression', () => {
    const human = studio.human;
    human.selectPreset(EXPERIMENTAL_PIGTAIL_HEAD_ID);
    const uniforms = captureMouthUniforms();
    const advance = (frames: number) => {
      for (let frame = 0; frame < frames; frame++) human.update(1 / 60);
    };

    human.setExpression('happy');
    advance(30);
    const restingOpen = uniforms.uMouthOpen.value;
    const restingTongue = uniforms.uTongueVisible.value;
    const restingCurve = uniforms.uMouthCurve.value;

    human.speechPreview!.play([
      { time: 0, viseme: 'A', duration: .4 },
      { time: .4, viseme: 'M', duration: .4 },
    ]);
    advance(19);
    expect(uniforms.uMouthOpen.value).toBeGreaterThan(restingOpen);
    expect(uniforms.uTongueVisible.value).toBeGreaterThan(restingTongue);

    advance(23);
    expect(uniforms.uMouthOpen.value).toBeLessThan(restingOpen);
    expect(uniforms.uTongueVisible.value).toBeLessThan(restingTongue);

    advance(40);
    expect(uniforms.uMouthOpen.value).toBeCloseTo(restingOpen, 2);
    expect(uniforms.uMouthCurve.value).toBeCloseTo(restingCurve, 2);
  });

  it('dilates and raises both pupils in Awe, then returns them to neutral', () => {
    const human = studio.human;
    human.selectPreset(EXPERIMENTAL_PIGTAIL_HEAD_ID);
    const mouth = captureMouthUniforms();
    const eyes = ['left', 'right'].map(side => captureUniforms(human.root, `pigtail-eye-${side}`));
    const measure = () => eyes.map(eye => ({
      size: eye['uPupilRadius'].value as number,
      vertical: new Vector3(0, 0, 1).applyMatrix3((eye['uEyeGaze'].value as Matrix3).clone().transpose()).y,
    }));
    const settle = () => { for (let frame = 0; frame < 40; frame++) human.update(1 / 60); };

    human.setExpression('neutral');
    settle();
    const neutral = measure();
    human.setExpression('awe');
    settle();
    measure().forEach((eye, index) => {
      expect(eye.size).toBeGreaterThan(neutral[index].size * 1.8);
      expect(eye.vertical).toBeGreaterThan(neutral[index].vertical + .2);
    });
    expect(mouth.uMouthOpen.value).toBeCloseTo(.31, 2);

    human.setExpression('neutral');
    settle();
    measure().forEach((eye, index) => {
      expect(eye.size).toBeCloseTo(neutral[index].size, 3);
      expect(eye.vertical).toBeCloseTo(neutral[index].vertical, 3);
    });
    expect(mouth.uMouthOpen.value).toBeCloseTo(0, 3);
  });

  for (const { label, seed } of EXPERIMENTAL_PIGTAIL_PRESETS) {
    it(`closes the eye surface across the enlarged pupil during a blink on ${label}`, () => {
      const face = new FacialAnimationController();
      const model = buildExperimentalPigtailHead(face, seed);
      try {
        const eye = captureUniforms(model.head, 'pigtail-eye-left');
        const angles = eye['uLidAngles'].value as Vector2;
        model.setAwe(true);
        model.update(.5);
        expect(eye['uPupilRadius'].value).toBeGreaterThan(.60);
        expect(angles.x + angles.y).toBeLessThan(0);

        face.blink('both', .2);
        model.update(.1);
        // At full closure the two spherical edges meet, covering the whole front surface.
        expect(angles.x + angles.y).toBeGreaterThan(0);
        model.update(.1);
        expect(angles.x + angles.y).toBeLessThan(0);
      } finally {
        model.dispose();
      }
    });
  }

  it('recreates seeded shapes, palettes and freckles when switching between heads', () => {
    const human = studio.human;
    const variants = EXPERIMENTAL_PIGTAIL_PRESETS.filter(preset => preset.seed !== undefined);
    function snapshot(presetId: string) {
      human.selectPreset(presetId);
      const head = human.root.getObjectByName(EXPERIMENTAL_PIGTAIL_HEAD_ID)!;
      const tuft = head.getObjectByName('pigtail-tuft-left')!;
      const hair = (tuft.children[0] as Mesh).material as MeshStandardMaterial;
      const freckles = head.children.filter(part => part.name === 'pigtail-freckle');
      expect(human.root.children.length).toBe(2);
      return {
        silhouette: head.scale.toArray(),
        tuft: tuft.scale.toArray(),
        hairColor: hair.color.getHex(),
        freckles: freckles.map(spot => [...spot.position.toArray(), ...spot.scale.toArray()]),
      };
    }

    const appearances = variants.map(({ value }) => snapshot(value));
    expect(new Set(appearances.map(appearance => appearance.silhouette.join())).size).toBe(3);
    expect(new Set(appearances.map(appearance => appearance.tuft.join())).size).toBe(3);
    expect(new Set(appearances.map(appearance => appearance.hairColor)).size).toBe(3);
    expect(appearances.map(appearance => appearance.freckles.length).sort((a, b) => a - b)).toEqual([0, 6, 10]);
    variants.forEach(({ value }, index) => expect(snapshot(value)).toEqual(appearances[index]));
    expect(snapshot(EXPERIMENTAL_PIGTAIL_HEAD_ID).silhouette).toEqual([.35, .35, .35]);
  });

  it('uses the same grounded cream spacesuit body and collar join for all heads', () => {
    const human = studio.human;
    human.selectPreset(EXPERIMENTAL_PIGTAIL_HEAD_ID);
    const standingBody = human.root.getObjectByName('pigtail-standing-body')!;
    const torso = standingBody.getObjectByName('pigtail-torso') as Mesh;
    const collar = standingBody.getObjectByName('pigtail-collar') as Mesh;
    const backpack = standingBody.getObjectByName('pigtail-backpack') as Mesh;

    expect((torso.material as MeshStandardMaterial).color.getHex()).toBe(0xe6d5bd);
    expect((collar.material as MeshStandardMaterial).color.getHex()).toBe(0x3c393a);
    expect((backpack.material as MeshStandardMaterial).color.getHex()).toBe(0xc45e25);

    for (const { value } of EXPERIMENTAL_PIGTAIL_PRESETS) {
      human.selectPreset(value);
      expect(human.root.getObjectByName('pigtail-standing-body')).toBe(standingBody);
      const head = standingBody.getObjectByName(EXPERIMENTAL_PIGTAIL_HEAD_ID)!;
      expect(new Box3().setFromObject(collar, true).intersectsBox(new Box3().setFromObject(head, true))).toBeTrue();
      for (const side of ['left', 'right']) {
        const boot = standingBody.getObjectByName(`pigtail-boot-${side}`)!;
        expect(new Box3().setFromObject(boot, true).min.y).toBeCloseTo(0, 6);
      }
    }
  });

  it('frames the whole character or the head and restores the existing actor and controls', () => {
    const human = studio.human;
    const original = human.root.children[0];
    human.selectPreset(EXPERIMENTAL_PIGTAIL_HEAD_ID);

    expect(original.visible).toBeFalse();
    expect(human.controlGroups()).toEqual([]);
    expect(human.motions).toEqual([]);
    for (const azimuthRadians of [0, -Math.PI / 4, -Math.PI / 2]) {
      const options = { azimuthRadians, aspect: .8 };
      const whole = human.resolveFocusFraming('human-full-body', options);
      const head = human.resolveFocusFraming('human-head-hair', options);
      expect(whole.inFrame).toBeTrue();
      expect(whole.worldMin[1]).toBeCloseTo(0, 3);
      expect(head.inFrame).toBeTrue();
      expect(head.worldMin[1]).toBeGreaterThan(.8);
      expect(head.worldMax[1]).toEqual(whole.worldMax[1]);
      expect(head.cameraDistance).toBeLessThan(whole.cameraDistance);
    }

    human.selectPreset(human.defaultPresetId);
    expect(original.visible).toBeTrue();
    expect(human.root.getObjectByName('pigtail-standing-body')?.visible).toBeFalse();
    expect(human.controlGroups().length).toBeGreaterThan(0);
    expect(human.motions.length).toBeGreaterThan(0);
  });
});
