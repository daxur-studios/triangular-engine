import { Color, type Mesh, MeshBasicMaterial, MeshStandardMaterial, ShaderMaterial, Vector3 } from 'three';
import {
  computeCapsuleFaceProbes,
  characterEllipsoidLevel,
  DEFAULT_CAPSULE_DNA,
  normalizeCapsuleCharacterDNA,
  type CapsuleCharacterDNA,
  type CapsuleEyeRigPose,
  type CapsuleFaceProjection,
} from 'triangular-engine/characters';
import { CapsuleCharacterActor } from './capsule-character-actor';
import { buildCapsuleFaceRig } from './capsule-face-rig';
import {
  CAPSULE_ID_COLOURS,
  decodeCapsuleIdPixel,
  resolveCapsulePart,
  type CapsuleIdPixel,
} from './capsule-id-colours';

function eyePose(gazeYaw: number, gazePitch: number, pupilScale: number): CapsuleEyeRigPose {
  return { gazeYaw, gazePitch, pupilScale, upperLidAngle: 0, lowerLidAngle: 0, lidTiltZ: 0 } as CapsuleEyeRigPose;
}

function worldPosition(mesh: { getWorldPosition(v: Vector3): Vector3 }): Vector3 {
  return mesh.getWorldPosition(new Vector3());
}

/** World-space points on a sphere mesh of the given geometry radius. */
function surfacePoints(mesh: Mesh, radius: number): Vector3[] {
  const points: Vector3[] = [];
  for (let k = 0; k < 40; k++) {
    const theta = Math.acos(1 - (2 * (k + 0.5)) / 40);
    const phi = k * 2.399963;
    points.push(
      new Vector3(Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), Math.cos(theta))
        .multiplyScalar(radius)
        .applyMatrix4(mesh.matrixWorld),
    );
  }
  return points;
}

const dnas: CapsuleCharacterDNA[] = [
  DEFAULT_CAPSULE_DNA,
  normalizeCapsuleCharacterDNA({
    ...DEFAULT_CAPSULE_DNA,
    eyeSizeAsymmetry: 0.2,
    eyeHeightAsymmetry: -0.06,
    eyeSpacing: 0.4,
    noseScale: 1.3,
    bodyRadius: 0.4,
  }),
];

describe('capsule face rig and probes', () => {
  for (const [index, dna] of dnas.entries()) {
    it(`places rig meshes exactly on the face probes (DNA ${index})`, () => {
      const rig = buildCapsuleFaceRig(dna);
      const left = eyePose(-0.3, 0.2, 0.42);
      const right = eyePose(0.25, -0.15, 0.5);
      rig.updateFromProjection({
        leftEye: left,
        rightEye: right,
        leftBrow: { heightOffset: 0, zRotation: 0 },
        rightBrow: { heightOffset: 0, zRotation: 0 },
      } as unknown as CapsuleFaceProjection);
      rig.root.updateMatrixWorld(true);

      const probes = computeCapsuleFaceProbes(dna, { leftEye: left, rightEye: right });
      for (const [eye, probe] of [
        [rig.leftEye, probes.leftEye],
        [rig.rightEye, probes.rightEye],
      ] as const) {
        const er = probe.placement.radius;
        expect(worldPosition(eye.root).distanceTo(new Vector3().copy(probe.placement.position))).toBeLessThan(1e-9);
        const sclera = eye.root.children.find((c) => resolveCapsulePart(c) === 'eyeWhite') as Mesh;
        for (const p of surfacePoints(sclera, er)) {
          expect(characterEllipsoidLevel(probe.sclera, p)).toBeCloseTo(1, 9);
        }
        expect(worldPosition(eye.pupilMesh).distanceTo(new Vector3().copy(probe.pupilCenter))).toBeLessThan(1e-9);
        for (const p of surfacePoints(eye.pupilMesh, er)) {
          expect(characterEllipsoidLevel(probe.pupil, p)).toBeCloseTo(1, 9);
        }
      }
      expect(worldPosition(rig.leftBrow).distanceTo(new Vector3().copy(probes.leftBrow.position))).toBeLessThan(1e-9);
      expect(worldPosition(rig.rightBrow).distanceTo(new Vector3().copy(probes.rightBrow.position))).toBeLessThan(1e-9);
      expect(worldPosition(rig.noseMesh).distanceTo(new Vector3().copy(probes.nose.position))).toBeLessThan(1e-9);
      expect(rig.noseMesh.visible).toBe(probes.nose.visible);
      rig.dispose();
    });
  }
});

describe('capsule ID colours', () => {
  it('decodes every palette colour, with read-back rounding, to its own ID', () => {
    for (const [id, [r, g, b]] of Object.entries(CAPSULE_ID_COLOURS) as [CapsuleIdPixel, readonly number[]][]) {
      expect(decodeCapsuleIdPixel(r * 255, g * 255, b * 255)).toBe(id);
      expect(decodeCapsuleIdPixel(Math.round(r * 255) - (r ? 1 : 0), Math.round(g * 254), Math.round(b * 255))).toBe(id);
    }
  });

  it('swaps the actor to flat ID materials, keeps them across setDna and restores them', () => {
    const actor = new CapsuleCharacterActor({ dna: { helmet: true, hairStyleId: 'pigtails' } });
    const body = actor.capsuleBody.mesh;
    const pupil = actor.capsuleFaceRig.rightEye.pupilMesh;
    const shadedBody = body.material;
    const shadedPupil = pupil.material;

    actor.setIdColourMode(true);
    expect(actor.idColourModeEnabled).toBeTrue();
    expect(body.material as unknown).toEqual(jasmine.any(ShaderMaterial));
    const pupilId = pupil.material as MeshBasicMaterial;
    expect(pupilId).toEqual(jasmine.any(MeshBasicMaterial));
    expect(pupilId.color.equals(new Color(...CAPSULE_ID_COLOURS.pupil))).toBeTrue();
    expect(pupilId.toneMapped).toBeFalse();

    let hairMeshes = 0;
    actor.capsuleHairKit.root.traverse((o) => {
      if ((o as Mesh).isMesh) {
        hairMeshes++;
        expect(((o as Mesh).material as MeshBasicMaterial).color.equals(new Color(...CAPSULE_ID_COLOURS.hair))).toBeTrue();
      }
    });
    expect(hairMeshes).toBeGreaterThan(0);

    let hiddenGlass = 0;
    actor.root.traverse((o) => {
      const material = (o as Mesh).material as MeshBasicMaterial | undefined;
      if ((o as Mesh).isMesh && material && material.colorWrite === false) {
        hiddenGlass++;
      }
    });
    expect(hiddenGlass).toBeGreaterThan(0);

    // A rebuilt face rig comes back in ID colours.
    actor.setDna({ eyeScale: actor.dna.eyeScale * 1.1 });
    const rebuiltSclera = actor.capsuleFaceRig.leftEye.root.children.find(
      (c) => resolveCapsulePart(c) === 'eyeWhite',
    ) as Mesh;
    expect((rebuiltSclera.material as MeshBasicMaterial).color.equals(new Color(...CAPSULE_ID_COLOURS.eyeWhite))).toBeTrue();

    actor.setIdColourMode(false);
    expect(body.material).toBe(shadedBody);
    expect(actor.capsuleFaceRig.rightEye.pupilMesh.material).toEqual(jasmine.any(MeshStandardMaterial));
    expect(shadedPupil).toEqual(jasmine.any(MeshStandardMaterial));
    actor.dispose();
  });
});
