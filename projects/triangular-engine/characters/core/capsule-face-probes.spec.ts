import { DEFAULT_CAPSULE_DNA, type CapsuleCharacterDNA } from './capsule-dna';
import {
  CAPSULE_NEUTRAL_MOUTH,
  computeCapsuleEyePlacement,
  computeCapsuleEyeProbes,
  computeCapsuleFaceProbes,
  computeCapsuleMouthCenterY,
  computeCapsuleMouthProbes,
  computeCapsuleMouthShape,
} from './capsule-face-probes';
import { characterEllipsoidLevel } from './character-camera-projection';

/** The body shader's rounded-box distance, ported from GLSL. */
function sdRoundedBox(px: number, py: number, bx: number, by: number, r: [number, number, number, number]): number {
  let [r0, r1] = px > 0 ? [r[0], r[1]] : [r[2], r[3]];
  r0 = py > 0 ? r0 : r1;
  const qx = Math.abs(px) - bx + r0;
  const qy = Math.abs(py) - by + r0;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r0;
}

/** The body shader's mouth distance at torso-frame (x, y). */
function shaderMouthDistance(dna: CapsuleCharacterDNA, mouth: typeof CAPSULE_NEUTRAL_MOUTH, x: number, y: number): number {
  const r = Math.max(0.15, dna.bodyRadius);
  const mx = x / r;
  const my = (y - computeCapsuleMouthCenterY(dna)) / r;
  const s = computeCapsuleMouthShape(mouth);
  const xNorm = Math.max(-1.5, Math.min(1.5, mx / Math.max(0.05, s.halfWidth)));
  const parabola = (xNorm * xNorm - 0.35) * mouth.mouthCurve * 0.085;
  const wave = Math.sin(mx * 28) * mouth.mouthWave * 0.024;
  const t = s.topCornerRadius;
  const b = s.bottomCornerRadius;
  return sdRoundedBox(mx, my - parabola - wave, s.halfWidth, s.halfHeight, [t, b, t, b]);
}

describe('capsule-face-probes', () => {
  it('places the default eyes where the face rig always put them', () => {
    const dna = DEFAULT_CAPSULE_DNA;
    const right = computeCapsuleEyePlacement(dna, 'right');
    const angle = Math.max(0.45, dna.eyeSpacing * 1.72);
    expect(right.angle).toBeCloseTo(angle, 12);
    expect(right.radius).toBeCloseTo(dna.bodyRadius * 0.385 * dna.eyeScale, 12);
    expect(right.position.x).toBeCloseTo(Math.sin(angle) * dna.bodyRadius * 1.04, 12);
    expect(right.position.y).toBeCloseTo(dna.suitSplitY + dna.bodyHeight * 0.365 + dna.bodyRadius * 0.04, 12);
    expect(right.position.z).toBeCloseTo(Math.cos(angle) * dna.bodyRadius * 1.08, 12);
    expect(right.yaw).toBeCloseTo(angle * 0.38, 12);

    const left = computeCapsuleEyePlacement(dna, 'left');
    expect(left.position.x).toBeCloseTo(-right.position.x, 12);
    expect(left.position.y).toBeCloseTo(right.position.y, 12);
    expect(left.yaw).toBeCloseTo(-right.yaw, 12);
  });

  it('applies eye size and height asymmetry with opposite signs per side', () => {
    const dna = { ...DEFAULT_CAPSULE_DNA, eyeSizeAsymmetry: 0.2, eyeHeightAsymmetry: 0.05 };
    const left = computeCapsuleEyePlacement(dna, 'left');
    const right = computeCapsuleEyePlacement(dna, 'right');
    expect(right.radius / left.radius).toBeCloseTo(1.1 / 0.9, 12);
    expect(right.position.y - left.position.y).toBeCloseTo(0.1 * dna.bodyRadius, 12);
  });

  it('turns the pupil with the gaze and keeps it in front of the eye centre', () => {
    const dna = DEFAULT_CAPSULE_DNA;
    const neutral = computeCapsuleEyeProbes(dna, 'right');
    const placement = neutral.placement;
    const offset = {
      x: neutral.pupilCenter.x - placement.position.x,
      z: neutral.pupilCenter.z - placement.position.z,
    };
    expect(Math.hypot(offset.x, offset.z)).toBeCloseTo(placement.radius * 0.9, 12);
    expect(Math.atan2(offset.x, offset.z)).toBeCloseTo(placement.yaw, 12);
    expect(neutral.pupil.axes[0].x ** 2 + neutral.pupil.axes[0].z ** 2).toBeCloseTo((dna.pupilScale * placement.radius) ** 2, 12);

    const looking = computeCapsuleEyeProbes(dna, 'right', { gazeYaw: 0.4, gazePitch: -0.2, pupilScale: 0.3 });
    expect(looking.pupilCenter.x).toBeGreaterThan(neutral.pupilCenter.x);
    expect(looking.pupilCenter.y).toBeGreaterThan(neutral.pupilCenter.y);
    expect(characterEllipsoidLevel(looking.sclera, looking.pupilCenter)).toBeLessThan(1);
  });

  it('puts the mouth corners on the shader outline at its widest point', () => {
    const dna = DEFAULT_CAPSULE_DNA;
    const poses = [
      CAPSULE_NEUTRAL_MOUTH,
      { mouthOpen: 0.6, mouthWidth: 0.9, mouthCurve: 0.9, mouthWave: 0 },
      { mouthOpen: 0.3, mouthWidth: 0.5, mouthCurve: -0.7, mouthWave: 0.5 },
    ];
    for (const mouth of poses) {
      const probes = computeCapsuleMouthProbes(dna, mouth);
      for (const [corner, outward] of [[probes.right, 1], [probes.left, -1]] as const) {
        expect(Math.abs(shaderMouthDistance(dna, mouth, corner.x, corner.y))).toBeLessThan(1e-9);
        expect(shaderMouthDistance(dna, mouth, corner.x - outward * 1e-4, corner.y)).toBeLessThan(0);
        // Nothing of the mouth lies further out than the corner.
        for (let dy = -0.1; dy <= 0.1; dy += 0.002) {
          expect(shaderMouthDistance(dna, mouth, corner.x + outward * 1e-6, corner.y + dy)).toBeGreaterThan(0);
        }
        expect(corner.x ** 2 + corner.z ** 2).toBeCloseTo(dna.bodyRadius ** 2, 12);
        expect(corner.z).toBeGreaterThan(dna.bodyRadius * 0.25);
      }
    }
  });

  it('gathers every probe in one call', () => {
    const probes = computeCapsuleFaceProbes(DEFAULT_CAPSULE_DNA);
    expect(probes.head.capsule.radius).toBe(DEFAULT_CAPSULE_DNA.bodyRadius);
    expect(probes.head.topY).toBeCloseTo(DEFAULT_CAPSULE_DNA.bodyHeight / 2 + DEFAULT_CAPSULE_DNA.bodyRadius, 12);
    expect(probes.leftEye.placement.side).toBe('left');
    expect(probes.mouth.center.y).toBeCloseTo(computeCapsuleMouthCenterY(DEFAULT_CAPSULE_DNA), 12);
    expect(probes.leftBrow.position.y).toBeGreaterThan(probes.leftEye.placement.position.y);
    expect(probes.nose.visible).toBe(false);
  });
});
