/* eslint-disable @typescript-eslint/no-explicit-any */
import { BackSide, Vector3 } from 'three';
import { MeshBasicNodeMaterial, type RenderTarget } from 'three/webgpu';
import {
  Break, Discard, Fn, If, Loop, cameraFar, ceil, int, log2, cameraNear, cameraViewMatrix, clamp, color, cross, dot, float, max, mix,
  mx_noise_float, normalize, positionWorld, select, smoothstep, sqrt, uniform, vec3, vec4, viewZToPerspectiveDepth,
} from 'three/tsl';

/**
 * Plan 055 Phase 1: the first raymarched terrain (contender C, minimal). No ops, no morph, no shadows yet.
 *
 * A shell at radius `R + H` is drawn with its back faces, camera-relative like the plain sphere, so it covers every pixel
 * whose ray can meet the terrain (from outside, the planet's disc; from inside the shell, the whole screen). Each of its
 * pixels sphere-traces one fixed height field from where the ray enters the shell, and writes its own depth.
 *
 * Precision: the body is up to 6,371 km across, and float32 cannot hold the ray point's distance from the centre to
 * better than about half a metre. So the altitude along the ray is not `|p| - R`. With `o` the camera relative to the
 * centre and `d` the unit ray, `|p|^2 - R^2 = (|o|^2 - R^2) + t (2 d.o + t)`; the first term is computed on the CPU in
 * doubles, so near the camera, where `t` is small, the altitude is accurate to millimetres. `|p| + R` only divides.
 */

/** Highest terrain over the sphere, as a share of the radius, capped like Earth's highest peaks. */
export function terrainHeightM(radiusM: number): number {
  return Math.min(radiusM * 0.01, 8000);
}

/**
 * Angular radius of the flat pad under the camera poses (they all stand over longitude 0, latitude 0, +Z), so no pose
 * starts inside a hill. It also is the first stand-in for a flatten op.
 */
const PAD_INNER_RAD = 0.0015;
const PAD_OUTER_RAD = 0.004;

/** Base frequency of the noise in unit-direction space: the largest hills are about `R / 4` across. */
const NOISE_FREQUENCY = 4;
/**
 * Octaves are added only while their wavelength is over four times the pixel footprint at that distance (the last one
 * fades in, so nothing pops). The cap puts the finest at `R / 65,536`: about 100 m on Earth, 1 m at 64 km.
 */
const MAX_OCTAVES = 14;

/** A ray that runs out of steps within this many pixels of the ground counts as a hit. */
const GRAZING_PIXELS = 8;

/** Default steps per ray; the `raySteps` setting changes it. */
export const DEFAULT_RAY_STEPS = 128;

export interface RaymarchTerrain {
  readonly material: MeshBasicNodeMaterial;
  /** Shell radius for `createCameraRelativeSphereGeometry`: `R + H`, pushed out so the coarse chords still enclose it. */
  shellRadiusM(radiusM: number, heightSegments: number): number;
  /** Body radius, in doubles; sets `H`. */
  setBody(radiusM: number): void;
  /** Camera position in the body frame (the planet centre is the origin), in doubles. */
  setCamera(x: number, y: number, z: number): void;
  /** Unit sun direction in the body frame (also the render frame). */
  setSun(x: number, y: number, z: number): void;
  /** Pixel angle (radians per pixel at the screen centre): sets the hit tolerance, a cone of half a pixel. */
  setPixelAngle(radians: number): void;
  setSteps(steps: number): void;
  /** Soft shadow march on or off, for terrains that have one. */
  setShadows?(on: boolean): void;
  /** Low-resolution pre-pass, for terrains that have one: the page draws the shell with `material` into `target` first. */
  readonly prepass?: { readonly material: MeshBasicNodeMaterial; readonly target: RenderTarget };
  /** Pre-pass at the drawing buffer (`width` x `height`) divided by `scale`; 0 turns it off. */
  setPrepass?(scale: number, width: number, height: number): void;
}

export function createRaymarchTerrain(): RaymarchTerrain {
  // The camera relative to the planet centre (float32, for the ray direction terms only).
  const uCamera = uniform(new Vector3()) as any;
  // |o|^2 - R^2 and |o|^2 - (R + H)^2, in doubles before the float cast.
  const uCamQ = uniform(0) as any;
  const uCamQOuter = uniform(0) as any;
  const uRadius = uniform(1) as any;
  const uHeight = uniform(1) as any;
  const uSun = uniform(new Vector3(0, 1, 0)) as any;
  const uPixelAngle = uniform(0.001) as any;
  const uSteps = uniform(DEFAULT_RAY_STEPS, 'int') as any;
  let radius = 1;
  let camera: [number, number, number] = [0, 0, 1];

  /** Noise sum (about -2..2) to metres over the sphere, flattened by the pad. */
  const toHeight = (n: any, pad: any): any => clamp(n.mul(0.5).add(0.5), 0, 1).mul(uHeight).mul(pad);
  const padAt = (dir: any): any => smoothstep(PAD_INNER_RAD, PAD_OUTER_RAD, sqrt(max(float(0), float(2).sub(dir.z.mul(2)))));

  /** Height over the sphere, 0..H, of a unit body-frame direction, with detail down to `footprintM` metres. */
  const heightAt = (dir: any, footprintM: any): any => {
    const octaves = clamp(log2(uRadius.div(max(footprintM, float(1e-3)).mul(4 * NOISE_FREQUENCY))), 1, MAX_OCTAVES).toVar();
    const n = float(0).toVar();
    const amplitude = float(1).toVar();
    const frequency = float(NOISE_FREQUENCY).toVar();
    Loop(int(ceil(octaves)), ({ i }: { i: any }) => {
      const weight = clamp(octaves.sub(float(i)), 0, 1);
      n.addAssign(mx_noise_float(dir.mul(frequency)).mul(amplitude).mul(weight));
      amplitude.mulAssign(0.5);
      frequency.mulAssign(2);
    });
    return toHeight(n, padAt(dir));
  };

  /**
   * The march's distance to the surface below `altitude`, made cheap: octaves are added one at a time, and as soon as
   * even the most the rest could add (`2 x` the next amplitude, since each halves) leaves the surface well below the
   * ray, that bound is the step. High rays and the sky take one or two octaves; only rays near the ground take them all.
   */
  const gapAt = (dir: any, altitude: any, footprintM: any): any => {
    const octaves = clamp(log2(uRadius.div(max(footprintM, float(1e-3)).mul(4 * NOISE_FREQUENCY))), 1, MAX_OCTAVES).toVar();
    const pad = padAt(dir).toVar();
    const n = float(0).toVar();
    const amplitude = float(1).toVar();
    const frequency = float(NOISE_FREQUENCY).toVar();
    const gap = float(0).toVar();
    const bounded = float(0).toVar();
    Loop(int(ceil(octaves)), ({ i }: { i: any }) => {
      const highest = toHeight(n.add(amplitude.mul(2)), pad);
      If(altitude.sub(highest).greaterThan(footprintM.mul(4)), () => {
        gap.assign(altitude.sub(highest));
        bounded.assign(1);
        Break();
      });
      const weight = clamp(octaves.sub(float(i)), 0, 1);
      n.addAssign(mx_noise_float(dir.mul(frequency)).mul(amplitude).mul(weight));
      amplitude.mulAssign(0.5);
      frequency.mulAssign(2);
    });
    If(bounded.lessThan(0.5), () => { gap.assign(altitude.sub(toHeight(n, pad))); });
    return gap;
  };

  // One trace per pixel. Returns (t, hit, 0, 0); colour and depth both read it, so the loop is generated once.
  const trace = Fn(() => {
    // The camera is the render origin, so the interpolated shell point is a point on this pixel's ray.
    const d = (normalize(positionWorld) as any).toVar();
    const b = dot(d, uCamera).toVar();
    const disc = b.mul(b).sub(uCamQOuter);
    If(disc.lessThan(0), () => { Discard(); });
    const root = sqrt(disc);
    // Inside the shell the march starts at the camera; outside, where the ray enters it.
    const tStart = select(uCamQOuter.lessThan(0), float(0), max(float(0), b.negate().sub(root)));
    const tEnd = b.negate().add(root).toVar();
    const t = tStart.toVar();
    const hit = float(0).toVar();
    const lastGap = float(1e30).toVar();
    Loop(uSteps, () => {
      const q = uCamQ.add(t.mul(b.mul(2).add(t)));
      const p = uCamera.add(d.mul(t));
      const r = p.length();
      const altitude = q.div(r.add(uRadius)).toVar();
      // Above the highest terrain the height is not needed: H bounds it.
      const gap = altitude.sub(uHeight).toVar();
      If(altitude.lessThan(uHeight), () => {
        gap.assign(gapAt(p.div(r), altitude, t.mul(uPixelAngle)));
      });
      lastGap.assign(gap);
      If(gap.lessThan(t.mul(uPixelAngle).mul(0.5)), () => {
        hit.assign(1);
        Break();
      });
      // The field is not an exact distance (noise slopes exceed 1), so step short of it.
      t.addAssign(max(gap.mul(0.6), t.mul(uPixelAngle).mul(0.25)));
      If(t.greaterThan(tEnd), () => { Break(); });
    });
    // A ray that ran out of steps within a few pixels of the ground is grazing it: its last point stands in for the hit
    // (discarding it would leave holes along the horizon). Rays that left the shell or were still far up show the sky.
    const farUp = (lastGap as any).greaterThan((t as any).mul(uPixelAngle).mul(GRAZING_PIXELS));
    If(hit.lessThan(0.5).and((t as any).greaterThan(tEnd).or(farUp)), () => { Discard(); });
    return vec4(t, hit, 0, 0);
  })().toVar();

  const shade = Fn(() => {
    const d = normalize(positionWorld) as any;
    const t = (trace as any).x;
    const p = uCamera.add(d.mul(t));
    const up = (normalize(p) as any).toVar();
    // Normal from the height's slope along two tangents, a pixel's footprint (and at least 1e-6 rad) apart.
    const east = (normalize((cross(vec3(0, 1, 0), up) as any).add(vec3(1e-6, 0, 0))) as any).toVar();
    const north = (cross(up, east) as any).toVar();
    const step = (max(t.mul(uPixelAngle).div(uRadius), float(1e-6)) as any).toVar();
    const footprint = t.mul(uPixelAngle);
    const h0 = heightAt(up, footprint).toVar();
    const he = heightAt(normalize(up.add(east.mul(step))), footprint);
    const hn = heightAt(normalize(up.add(north.mul(step))), footprint);
    const metres = step.mul(uRadius);
    const normal = normalize(up.sub(east.mul(he.sub(h0).div(metres))).sub(north.mul(hn.sub(h0).div(metres))));
    const steep = float(1).sub(dot(normal, up));
    const share = h0.div(uHeight);
    const ground = mix(color(0x4f7a3a), color(0x8a7f6a), smoothstep(0.25, 0.6, share));
    const rock = mix(ground, color(0x6b625a), smoothstep(0.08, 0.25, steep));
    const albedo = mix(rock, color(0xf2f4f7), smoothstep(0.78, 0.9, share).mul(float(1).sub(smoothstep(0.2, 0.4, steep))));
    const sun = max(dot(normal, uSun), float(0));
    const night = smoothstep(-0.1, 0.1, dot(up, uSun));
    return vec4(albedo.mul(sun.mul(night).mul(1.0).add(0.08)), 1);
  });

  const material = new MeshBasicNodeMaterial({ side: BackSide });
  material.colorNode = shade();
  // The shell's own depth would be the far wall; the surface writes where the ray stopped.
  const hitView = cameraViewMatrix.mul(vec4(normalize(positionWorld).mul(trace.x), 1)) as any;
  material.depthNode = viewZToPerspectiveDepth(hitView.z, cameraNear, cameraFar);

  const updateCamera = () => {
    const [x, y, z] = camera;
    const h = terrainHeightM(radius);
    const r2 = x * x + y * y + z * z;
    uCamera.value.set(x, y, z);
    uCamQ.value = r2 - radius * radius;
    uCamQOuter.value = r2 - (radius + h) * (radius + h);
  };

  return {
    material,
    shellRadiusM(radiusM, heightSegments) {
      return (radiusM + terrainHeightM(radiusM)) / Math.cos(Math.PI / heightSegments);
    },
    setBody(radiusM) {
      radius = radiusM;
      uRadius.value = radiusM;
      uHeight.value = terrainHeightM(radiusM);
      updateCamera();
    },
    setCamera(x, y, z) {
      camera = [x, y, z];
      updateCamera();
    },
    setSun(x, y, z) { uSun.value.set(x, y, z); },
    setPixelAngle(radians) { uPixelAngle.value = radians; },
    setSteps(steps) { uSteps.value = Math.max(1, Math.round(steps)); },
  };
}

