import { box, cylinder, extrude, polygon, rotate, translate, unwrap, type Shape3D, type Vec3 } from 'brepjs';

export type Surface = 'steel' | 'steelDark' | 'edge' | 'rail' | 'concrete' | 'hardware';
export type Register = <T extends Shape3D>(shape: T) => T;
export interface Body {
  shape: Shape3D;
  surface: Surface;
}

export function buildBodies(register: Register) {
  const bodies: Body[] = [];
  const add = (surface: Surface, shape: Shape3D) => bodies.push({ surface, shape: register(shape) });

  return {
    bodies,
    add,
    block(surface: Surface, at: Vec3, [x, y, z]: Vec3) {
      add(surface, box(x, y, z, { at }));
    },
    round(surface: Surface, at: Vec3, radius: number, height: number) {
      add(surface, cylinder(radius, height, { at }));
    },
    plate(surface: Surface, points: Vec3[], direction: Vec3) {
      const face = unwrap(polygon(points));
      try {
        add(surface, unwrap(extrude(face, direction)));
      } finally {
        face.delete();
      }
    },
    beam(surface: Surface, a: Vec3, b: Vec3, width: number, depth = width) {
      const [dx, dy, dz] = b.map((value, axis) => value - a[axis]);
      const length = Math.hypot(dx, dy, dz);
      const base = register(box(length, width, depth, { centered: true }));
      const cross = Math.hypot(dy, dz);
      const axis: Vec3 = cross ? [0, -dz / cross, dy / cross] : [0, 0, 1];
      const tilted = register(rotate(base, Math.acos(dx / length) * 180 / Math.PI, { axis }));
      add(surface, translate(tilted, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]));
    },
  };
}
