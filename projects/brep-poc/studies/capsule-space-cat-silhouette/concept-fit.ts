import { Mesh, QuadraticBezierCurve3, TubeGeometry, Vector3 } from 'three';
import type { buildCat } from './cat-scene';

type StudyCat = ReturnType<typeof buildCat>;

/** The front suit band follows the fused surface through animation. */
export function dressForConcept(cat: StudyCat): void {
  cat.setDna({ helmet: true, pack: 'none', harness: false, furAccentColor: cat.actor.dna.furColor });
  const helmet = cat.actor.root.getObjectByName('concept-cat-helmet')!;
  helmet.visible = true;
  const { material } = cat.actor.catBody.mesh;
  const shadeCat = material.onBeforeCompile.bind(material);
  const cacheKey = material.customProgramCacheKey();
  material.customProgramCacheKey = () => `${cacheKey}-concept-suit`;
  material.onBeforeCompile = (shader, renderer) => {
    shadeCat(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      'baseCol *= (1.0 - naturalSeam * 0.06);',
      `float collar = z + vCatLocalPos.y * 0.26;
       float suit = smoothstep(-0.06, -0.035, collar) * (1.0 - smoothstep(0.29, 0.335, collar));
       baseCol = mix(baseCol, uSuitColor, suit);`,
    );
  };
  material.needsUpdate = true;
  const uniform = cat.actor.catBody.uniforms;
  uniform.uMouthCenterY.value = .073;
}

/** Seat the eye assemblies in the cheeks and point the gaze toward the muzzle. */
export function fitGentlerFace(cat: StudyCat): () => void {
  const face = cat.actor.catFaceRig;
  const headZ = cat.actor.dna.bodyLength / 2;
  const forward = new Vector3();
  const eyeAxis = new Vector3(0, 0, 1);
  for (const [side, eye] of [[-1, face.leftEye], [1, face.rightEye]] as const) {
    eye.root.position.set(side * .120, .077, headZ + .216);
    forward.set(side * .12, .04, 1).normalize();
    eye.root.quaternion.setFromUnitVectors(eyeAxis, forward);
    eye.root.scale.set(.79, .81, .68);
  }
  for (const [side, ear] of [[-1, face.leftEar], [1, face.rightEar]] as const) {
    ear.position.set(side * .168, .244, headZ + .115);
    ear.scale.set(.94, 1.02, .84);
    ear.userData['baseY'] = side * .15;
    ear.userData['baseZ'] = -side * .22;
  }
  const nose = face.root.getObjectByName('capsule-cat-nose')!;
  nose.scale.setScalar(.82);
  const cheekPoint = (x: number, y: number) =>
    new Vector3(x, y, headZ + .276 * Math.sqrt(1 - (x / .32) ** 2 - (y / .30) ** 2));
  for (const [side, whiskers] of [[-1, face.leftWhiskers], [1, face.rightWhiskers]] as const) {
    whiskers.position.copy(cheekPoint(side * .12, -.057));
    for (const [index, whisker] of (whiskers.children as Mesh[]).entries()) {
      const y = -.052 - index * .023;
      const start = cheekPoint(side * .12, y);
      const end = cheekPoint(side * .216, y - .007);
      end.z += .026;
      const middle = start.clone().lerp(end, .5);
      middle.z += .012;
      const stroke = new QuadraticBezierCurve3(
        start.sub(whiskers.position), middle.sub(whiskers.position), end.sub(whiskers.position),
      );
      whisker.geometry.dispose();
      whisker.geometry = new TubeGeometry(stroke, 12, .0057, 8, false);
    }
  }
  const mouth = cat.actor.catBody.uniforms;
  return () => {
    for (const eye of [face.leftEye, face.rightEye]) {
      eye.upperLidPivot.rotation.x = Math.max(-1.12, eye.upperLidPivot.rotation.x);
    }
    mouth.uMouthCenterY.value = .093;
    mouth.uMouthWidth.value *= .62;
  };
}
