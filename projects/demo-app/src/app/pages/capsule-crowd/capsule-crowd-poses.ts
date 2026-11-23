import { BoxGeometry, CapsuleGeometry, Color, Float32BufferAttribute, SphereGeometry, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const WALK_FRAMES = 8;

/** Foot-origin mesh poses shared by the 3D crowd and the impostor bake. The character faces +Z. */
export function buildCrowdWalkPoses(): BufferGeometry[] {
  const skin = '#db9c71';
  const suit = '#5b9798';
  const trim = '#e5d0a5';
  const hair = '#583d32';
  const boots = '#3a4552';
  const ink = '#342c2b';

  return Array.from({ length: WALK_FRAMES }, (_, frame) => {
    const angle = frame / WALK_FRAMES * Math.PI * 2;
    const bob = .037 * (1 - Math.cos(2 * angle));
    const parts: BufferGeometry[] = [];

    function paint(geometry: BufferGeometry, color: string, x: number, y: number, z: number) {
      geometry.translate(x, y, z);
      const rgb = new Color(color);
      const colors = new Float32BufferAttribute(new Float32Array(geometry.attributes['position'].count * 3), 3);
      for (let i = 0; i < colors.count; i++) colors.setXYZ(i, rgb.r, rgb.g, rgb.b);
      geometry.setAttribute('color', colors);
      parts.push(geometry);
    }

    function oval(color: string, x: number, y: number, z: number, w: number, h: number, d: number) {
      paint(new SphereGeometry(1, 10, 6).scale(w, h, d), color, x, y, z);
    }

    paint(new CapsuleGeometry(.30, .22, 4, 10).scale(1, 1, .84), suit, 0, .88 + bob, 0);
    paint(new BoxGeometry(.17, .10, .04), trim, 0, .92 + bob, .25);
    paint(new CapsuleGeometry(.31, .15, 4, 12).scale(1, 1, .90), skin, 0, 1.51 + bob, 0);
    oval(hair, -.025, 1.77 + bob, -.046, .325, .21, .27);
    oval(hair, -.126, 1.93 + bob, -.01, .20, .109, .21);
    oval(ink, 0, 1.36 + bob, .27, .053, .018, .019);
    oval(skin, 0, 1.48 + bob, .27, .05, .048, .067);

    for (const side of [-1, 1]) {
      const swing = Math.sin(angle) * side;
      const hip = .62 + bob * .45;
      const lift = .15 * Math.max(0, Math.cos(angle) * side);
      const stride = .26 * swing;
      paint(new CapsuleGeometry(.093, .24, 3, 8).rotateX(-.61 * swing), suit,
        side * .164, (hip + .17 + lift) / 2, stride * .50);
      oval(boots, side * .164, .115 + lift, stride + .042, .12, .115, .184);
      const armAngle = .58 * swing;
      paint(new CapsuleGeometry(.079, .28, 3, 8).rotateX(-armAngle), suit,
        side * .358, .91 + bob, .18 * swing);
      oval(trim, side * .365, 1.10 + bob - .405 * Math.cos(armAngle), .39 * Math.sin(armAngle),
        .091, .104, .089);
      oval(skin, side * .30, 1.50 + bob, .005, .072, .095, .057);
      oval('#fff5df', side * .121, 1.56 + bob, .25, .111, .11, .079);
      oval(ink, side * .122, 1.55 + bob, .319, .041, .041, .023);
    }

    const pose = mergeGeometries(parts);
    for (const part of parts) part.dispose();
    return pose;
  });
}
