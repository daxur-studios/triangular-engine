import { Color, Euler, Matrix3, Matrix4, MeshStandardMaterial, Vector2 } from 'three';
import type { CapsuleEyeRigPose } from 'triangular-engine/characters';

/** One continuous surface for the whites, pupil and the lids that occlude it. */
export function createPigtailEyeMaterial(skinTone: string, side: number) {
  const material = new MeshStandardMaterial({ color: 0xfff9f0, roughness: .49 });
  const uniforms = {
    uEyeSkin: { value: new Color(skinTone) },
    uPupilInk: { value: new Color(0x2b211b) },
    uEyeGaze: { value: new Matrix3() },
    uPupilRadius: { value: .30 },
    uLidAngles: { value: new Vector2() },
    uLidTilt: { value: 0 },
    uEyeWrap: { value: 0 },
  };
  const gazeEuler = new Euler(0, 0, 0, 'YXZ');
  const gazeMatrix = new Matrix4();

  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEyePosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEyePosition = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vEyePosition;
        uniform vec3 uEyeSkin;
        uniform vec3 uPupilInk;
        uniform mat3 uEyeGaze;
        uniform float uPupilRadius;
        uniform vec2 uLidAngles;
        uniform float uLidTilt;
        uniform float uEyeWrap;

        float softEdge(float distanceToEdge) {
          float edgeWidth = max(fwidth(distanceToEdge) * 0.65, 0.0001);
          return smoothstep(-edgeWidth, edgeWidth, distanceToEdge);
        }
      `)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 surface = normalize(vEyePosition);
        vec3 pupilSpace = uEyeGaze * surface;
        float pupil = softEdge(pupilSpace.z - sqrt(1.0 - uPupilRadius * uPupilRadius));
        vec2 shine = pupilSpace.xy / uPupilRadius;
        float glint = softEdge(0.15 - length(shine - vec2(-0.31, 0.37)));
        glint += 0.55 * softEdge(0.066 - length(shine - vec2(0.25, 0.15)));
        vec3 pupilColor = mix(uPupilInk, vec3(0.92, 0.82, 0.67), glint * 0.85);
        diffuseColor.rgb = mix(diffuseColor.rgb, pupilColor, pupil);

        // Each edge is the intersection of a tilted plane with the eye sphere.
        // Round the join at the corners, where the two lid edges meet in profile.
        float lidY = surface.y * cos(uLidTilt) - surface.x * sin(uLidTilt);
        float upperLid = lidY * cos(uLidAngles.x) + surface.z * sin(uLidAngles.x);
        float lowerLid = -lidY * cos(uLidAngles.y) + surface.z * sin(uLidAngles.y);
        float cornerBlend = max(1.0 - abs(upperLid - lowerLid) / 0.36, 0.0);
        float lid = softEdge(max(upperLid, lowerLid) + 0.09 * cornerBlend * cornerBlend + 0.012 - uEyeWrap);
        diffuseColor.rgb = mix(diffuseColor.rgb, uEyeSkin, lid);
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.76, lid);
      `);
  };

  return {
    material,
    update(pose: CapsuleEyeRigPose, blink: number, awe: number, roundedSclera: boolean): void {
      gazeEuler.set(pose.gazePitch - .056 - .32 * awe, pose.gazeYaw - .035 * side, 0);
      gazeMatrix.makeRotationFromEuler(gazeEuler);
      uniforms.uEyeGaze.value.setFromMatrix4(gazeMatrix).transpose();
      uniforms.uPupilRadius.value = pose.pupilScale + .32 * awe;
      uniforms.uLidAngles.value.set(-1.39 + pose.upperLidAngle, -1.40 + 1.75 * pose.lowerLidAngle + .85 * blink);
      uniforms.uLidTilt.value = pose.lidTiltZ;
      // The Shaggy sclera extends around the sphere. Let the lid cover it normally in a blink or squint.
      uniforms.uEyeWrap.value = roundedSclera ? .30 * Math.max(0, 1 - Math.max(blink, 1.8 * pose.upperLidAngle)) : 0;
    },
  };
}
