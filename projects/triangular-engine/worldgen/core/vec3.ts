/** Minimal framework-free 3D vector math — plain `{x,y,z}` tuples, no Three.js. */
export interface IVec3 {
  x: number;
  y: number;
  z: number;
}

export function vec3(x: number, y: number, z: number): IVec3 {
  return { x, y, z };
}

export function add(a: IVec3, b: IVec3): IVec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: IVec3, b: IVec3): IVec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(a: IVec3, s: number): IVec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function dot(a: IVec3, b: IVec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: IVec3, b: IVec3): IVec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function length(a: IVec3): number {
  return Math.sqrt(dot(a, a));
}

export function normalize(a: IVec3): IVec3 {
  const len = length(a);
  if (len === 0) return { x: 0, y: 0, z: 0 };
  return scale(a, 1 / len);
}
