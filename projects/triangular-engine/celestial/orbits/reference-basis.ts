import { Vec3d } from '../math/vec3';

/**
 * The PCI reference-plane basis (map-view-mvp.md §3): `K` is the polar/
 * angular-momentum reference axis (+Y), `I` is the reference direction
 * (+X, 0-longitude), and `J` completes a right-handed triad (`I x J = K`)
 * so a prograde equatorial orbit travels from `I` toward `J` — i.e. from
 * +X toward -Z, matching the documented Y-up convention.
 */
export const REFERENCE_I: Vec3d = [1, 0, 0];
export const REFERENCE_J: Vec3d = [0, 0, -1];
export const REFERENCE_K: Vec3d = [0, 1, 0];
