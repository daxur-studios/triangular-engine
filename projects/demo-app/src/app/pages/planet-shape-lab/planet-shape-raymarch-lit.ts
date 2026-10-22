/* eslint-disable @typescript-eslint/no-explicit-any */
import { BackSide, FloatType, Vector2, Vector3 } from 'three';
import { MeshBasicNodeMaterial, RenderTarget } from 'three/webgpu';
import {
  Break, Discard, Fn, If, Loop, cameraFar, cameraNear, cameraViewMatrix, clamp, cross, dot, float, floor, int, ivec2, max,
  min, mix, normalize, positionWorld, pow, reflect, screenCoordinate, select, smoothstep, sqrt, textureLoad, uniform, vec2,
  vec3, vec4, viewZToPerspectiveDepth,
} from 'three/tsl';
import {
  BIOME_OFFSET, CANYON_DEPTH, MASK_OFFSETS, ROCK_OCTAVES, bottomAltitudeM, densityAt, fieldFrameMatrices,
  fieldBiomeAt, noiseFrame, noiseOrigin, padEdit, sampleFrame, topAltitudeM, unitM, valueNoise, type FieldNodes,
} from './planet-shape-field';
import { createNoiseTexture } from './planet-shape-noise';
import type { RaymarchTerrain } from './planet-shape-raymarch';
import { shapeOpFromTerrainEdit, type ShapeOp } from './shape-ops/shape-op';
import { createShapeOpTextures } from './shape-ops/shape-ops-gpu';

/**
 * Plan 055 Phase 1, second try: a raymarched density field (defined in `planet-shape-field.ts`, with a CPU twin) on the recipe of the well-known Shadertoy canyon terrains
 * (ideas only, no code copied). Same shell, precise altitude and depth as `planet-shape-raymarch.ts`; what changes:
 *
 * - The ground is a 3D field, not a height map: `altitude + canyons(position) + 3D noise`, the noise stretched four
 *   times along the vertical. That gives horizontal strata, ledges and overhangs; large winding channels carve canyons.
 * - Noise is value noise from one 256 x 256 texture. Every noise is sampled camera-relative: the camera's place in it
 *   is worked out in doubles on the CPU, modulo the noise period, so metre-scale noise holds on an Earth-size body.
 * - Close up, bump and colour detail come from a cascade of finer camera-relative noises, each faded out once a pixel
 *   is wider than its features.
 * - Light as in those shaders: a sun with an optional soft shadow (the `shadows` feature), five-direction sky light and a
 *   bounce, rough (Oren-Nayar) diffuse, a cheap occlusion, then a tone curve and a muted grade. No fog (owner's call).
 *
 * - An optional pre-pass marches the same field at a fraction of the resolution and keeps, per coarse pixel, the last
 *   distance still in the air. The full-resolution march starts at the nearest of those around its pixel, so it needs a
 *   few steps instead of the whole band.
 *
 * The flat pad under the poses sits at the sphere; the plateau rises a little above it and the canyons cut far below.
 */

/** The air band the shell encloses: rays inside it that miss the ground show sky. */
function airHeightM(radiusM: number): number {
  return radiusM * 0.04;
}

/** Field values are scaled by this before stepping: the stretched noise is much steeper than 1. */
const STEP_SCALE = 0.25;
/**
 * Each step goes at least this share of the distance travelled, so grazing rays cannot stall; the share grows over the
 * second half of the steps, so rays skimming flat ground still reach the horizon.
 */
const RELATIVE_STEP = 0.008;
const LATE_RELATIVE_STEP = 0.06;
const SHADOW_STEPS = 32;
/** Bump and colour detail: the coarsest scale in units, and the ratio between scales. */
const DETAIL_LEVELS = 6;
const DETAIL_COARSEST = 2.5;
const DETAIL_RATIO = 0.2;

export function createLitRaymarchTerrain(): RaymarchTerrain {
  const noiseTexture = createNoiseTexture();
  const uCamera = uniform(new Vector3()) as any;
  const uCamQ = uniform(0) as any;
  const uCamQTop = uniform(0) as any;
  const uCamQBottom = uniform(0) as any;
  const uCamQOuter = uniform(0) as any;
  const uRadius = uniform(1) as any;
  /** A tenth of the relief, in metres. */
  const uUnit = uniform(1) as any;
  const uSun = uniform(new Vector3(0, 1, 0)) as any;
  const uPixelAngle = uniform(0.001) as any;
  const uSteps = uniform(128, 'int') as any;
  const uShadowSteps = uniform(0, 'int') as any;
  /** 1 while the camera is deep in the air band (sky drawn), 0 at its top and above (space). */
  const uSkyAmount = uniform(0) as any;
  /** Pre-pass: the drawing buffer divided by this (0 = off), and the coarse target's size in pixels. */
  const uPrepassScale = uniform(0) as any;
  const uPrepassSize = uniform(new Vector2(1, 1)) as any;
  const prepassTarget = new RenderTarget(1, 1, { type: FloatType, depthBuffer: false });
  const rockFrames = Array.from({ length: ROCK_OCTAVES }, () => noiseFrame());
  const maskFrames = MASK_OFFSETS.map((offset) => noiseFrame(new Vector3(...offset)));
  const biomeFrame = noiseFrame(new Vector3(...BIOME_OFFSET));
  /** A single biome everywhere (0 canyons .. 1 hills), or -1 for the mask. */
  const uBiomeOverride = uniform(-1) as any;
  /** Rock mode everywhere (0 wild, 1 grounded), or -1 for each biome's own. */
  const uRockOverride = uniform(-1) as any;
  const detailFrames = Array.from({ length: DETAIL_LEVELS }, (_, i) => noiseFrame(new Vector3(i * 31.7, i * 7.3, i * 19.1)));
  const uDetailScales = Array.from({ length: DETAIL_LEVELS }, () => uniform(1) as any);
  const shapeOps = createShapeOpTextures();
  /** Shadow rays stop above this altitude (metres): the top of the band, raised by the shape ops. */
  const uShadowTop = uniform(0) as any;
  let radius = 1;
  let camera: [number, number, number] = [0, 0, 1];
  /** The shape ops; `undefined` is the default, the pad under the poses. */
  let ops: readonly ShapeOp[] | undefined;

  const field: FieldNodes = {
    noiseTexture, camera: uCamera, unit: uUnit, rockFrames, maskFrames, biome: { frame: biomeFrame, override: uBiomeOverride }, rockOverride: uRockOverride,
    shapeOps,
  };
  const density = (x: any, altitude: any, footprint: any, smooth: boolean): any => densityAt(field, x, altitude, footprint, smooth);
  const sample = (frame: (typeof detailFrames)[number], x: any, smooth: boolean): any => sampleFrame(noiseTexture, frame, x, smooth);

  /** Altitude of the camera-relative point `x`, precise near the camera (see `planet-shape-raymarch.ts`). */
  const altitudeOf = (x: any): any => {
    const q = uCamQ.add(dot(uCamera, x).mul(2)).add(dot(x, x));
    return q.div(uCamera.add(x).length().add(uRadius));
  };

  /** First root of the ray with the sphere whose `|camera|² - r²` is `camQ`, or -1 if the ray misses it ahead. */
  const sphereEntry = (b: any, camQ: any): any => {
    const disc = b.mul(b).sub(camQ);
    const t = b.negate().sub(sqrt(max(disc, float(0))));
    return select(disc.lessThan(0).or(camQ.lessThan(0)).or(t.lessThan(0)), float(-1), t);
  };

  /**
   * Where the full march may start, from the pre-pass: the nearest safe distance over the 3 x 3 coarse pixels around
   * this one, a little short of it; -1 if none of them reached the ground (sky here too, bar features thinner than a
   * coarse pixel).
   */
  const prepassStart = (): any => {
    const centre = floor(screenCoordinate.div(uPrepassScale)).toVar();
    const nearest = float(1e30).toVar();
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const coord = clamp(centre.add(vec2(dx, dy)), vec2(0), uPrepassSize.sub(1));
        const texel = textureLoad(prepassTarget.texture, ivec2(coord), int(0));
        nearest.assign(select(texel.y.greaterThan(0.5), min(nearest, texel.x), nearest));
      }
    }
    const margin = float(1).sub(uPixelAngle.mul(uPrepassScale).mul(4));
    return select(nearest.greaterThan(1e29), float(-1), nearest.mul(margin));
  };

  /**
   * The march of one pixel, from the plateau-top sphere to the ground, the solid floor or out of the band. `coarse` is
   * the pre-pass: wider pixels, nothing discarded. The full march starts from the pre-pass when it is on.
   * Returns (t, surface: 1 ground / 0 sky, the last t still in the air, 0).
   */
  const buildTrace = (coarse: boolean) => Fn(() => {
    const d = (normalize(positionWorld) as any).toVar();
    const b = dot(d, uCamera).toVar();
    const discOuter = b.mul(b).sub(uCamQOuter).toVar();
    if (!coarse) If(discOuter.lessThan(0), () => { Discard(); });
    const tOuter = b.negate().add(sqrt(max(discOuter, float(0)))).toVar();
    const result = vec4(tOuter, 0, 0, 0).toVar();
    const pixelAngle = coarse ? uPixelAngle.mul(uPrepassScale) : uPixelAngle;
    // The march runs between the plateau-top sphere and the solid-floor sphere.
    const discTop = b.mul(b).sub(uCamQTop).toVar();
    If(discTop.greaterThan(0).and(discOuter.greaterThanEqual(0)), () => {
      const root = sqrt(discTop);
      const t = select(uCamQTop.lessThan(0), float(0), max(float(0), b.negate().sub(root))).toVar();
      const tFloor = sphereEntry(b, uCamQBottom).toVar();
      const tEnd = select(tFloor.greaterThan(0), tFloor, b.negate().add(root)).toVar();
      if (!coarse) {
        If(uPrepassScale.greaterThan(0), () => {
          const start = prepassStart().toVar();
          t.assign(select(start.lessThan(0), tEnd, max(t, start)));
        });
      }
      If(tEnd.greaterThan(t), () => {
        const tPrevious = t.toVar();
        const fieldPrevious = float(1e30).toVar();
        const tSafe = t.toVar();
        const hit = float(0).toVar();
        const steps = uSteps.mul(2).toVar();
        Loop(steps, ({ i }: { i: any }) => {
          const x = d.mul(t);
          const altitude = uCamQ.add(t.mul(b.mul(2).add(t))).div(uCamera.add(x).length().add(uRadius)).toVar();
          const footprint = t.mul(pixelAngle).toVar();
          const field = density(x, altitude, footprint, false).mul(STEP_SCALE).toVar();
          If(field.lessThan(footprint.mul(0.5)), () => {
            tSafe.assign(tPrevious);
            // Crossed (or touched) the rock: one secant step between the last two samples.
            If(field.lessThan(0).and(fieldPrevious.lessThan(1e29)), () => {
              t.assign(tPrevious.add(t.sub(tPrevious).mul(fieldPrevious.div(fieldPrevious.sub(field)))));
            });
            hit.assign(1);
            Break();
          });
          tPrevious.assign(t);
          fieldPrevious.assign(field);
          const late = clamp(float(i).div(float(steps)).mul(2).sub(1), 0, 1);
          const stride = max(max(field, t.mul(mix(float(RELATIVE_STEP), float(LATE_RELATIVE_STEP), late.mul(late)))), float(0.01));
          // Never past the nearest union shape (an arch leg, a ledge): beyond its fade the field does not see it.
          t.addAssign(min(stride, max(shapeOps.reach(x, footprint), footprint)));
          If(t.greaterThan(tEnd), () => { Break(); });
        });
        // Reaching the solid floor is ground; a ray that ran out of steps inside the band stops where it is.
        If(hit.lessThan(0.5), () => { tSafe.assign(tPrevious); });
        If(hit.lessThan(0.5).and(tFloor.greaterThan(0)), () => { t.assign(min(t, tFloor)); hit.assign(1); });
        If(hit.greaterThan(0.5).or(t.lessThan(tEnd)), () => { result.assign(vec4(t, 1, tSafe, 0)); });
      });
    });
    if (!coarse) If(result.y.lessThan(0.5).and(uSkyAmount.lessThan(0.001)), () => { Discard(); });
    return result;
  });
  const trace = buildTrace(false)().toVar() as any;

  /** Rough diffuse (Oren-Nayar, roughness 1) for light `l`, normal `n`, toward-viewer `v`. */
  const roughDiffuse = (l: any, n: any, v: any): any => {
    const nl = dot(n, l);
    const nv = dot(n, v);
    const along = dot(v.sub(n.mul(nv)), n.sub(n.mul(nl)));
    const sines = sqrt(max(float(1).sub(nv.mul(nv)).mul(float(1).sub(nl.mul(nl))), float(0)));
    return max(nl, float(0)).mul(float(0.818).add(max(along, float(0)).mul(0.413).mul(sines).div(max(max(nl, nv), float(1e-3)))));
  };

  const sky = (d: any, up: any): any => {
    const toward = clamp(dot(d, uSun), 0, 1);
    const horizon = mix(vec3(0.84, 1.2, 1.2), vec3(1.5, 0.5, 0.2), toward.mul(0.75).add(0.25));
    const height = max(dot(d, up).sub(0.02), float(0));
    let colour: any = mix(vec3(0.2, 0.6, 0.9), horizon, pow(float(2.718), height.mul(toward.negate().mul(2).add(6)).negate())).mul(0.5);
    colour = colour.add(vec3(1, 0.8, 0.7).mul(pow(toward, float(512)).mul(0.8)))
      .add(vec3(1, 0.4, 0.2).mul(pow(toward, float(32)).mul(0.2)))
      .add(vec3(1, 0.4, 0.2).mul(pow(toward, float(4)).mul(0.1)));
    const day = max(smoothstep(-0.18, 0.15, dot(up, uSun)), float(0.015));
    return colour.mul(day);
  };

  const shade = Fn(() => {
    const d = (normalize(positionWorld) as any).toVar();
    const t = trace.x;
    const cameraUp = normalize(uCamera);
    const colour = sky(d, cameraUp).mul(uSkyAmount).toVar();
    If(trace.y.greaterThan(0.5), () => {
      const x = d.mul(t).toVar();
      const up = (normalize(uCamera.add(x)) as any).toVar();
      const altitude = altitudeOf(x).toVar();
      const footprint = max(t.mul(uPixelAngle), float(1e-3)).toVar();

      // Normal from the smooth field (four-point tetrahedron), with an offset no finer than the pixel.
      const e = clamp(footprint, uUnit.mul(0.002), uUnit.mul(0.05)).toVar();
      const at = (k: any): any => {
        const s = x.add(k.mul(e));
        return k.mul(density(s, altitudeOf(s), footprint, true));
      };
      const normal = (normalize(at(vec3(1, -1, -1)).add(at(vec3(-1, -1, 1))).add(at(vec3(-1, 1, -1))).add(at(vec3(1, 1, 1)))) as any).toVar();

      // Bump and colour detail: a cascade of camera-relative noises, each faded once a pixel is wider than its features.
      const bump = vec3(0).toVar();
      const detail = float(1).toVar();
      const fine = float(0.5).toVar();
      detailFrames.forEach((frame, i) => {
        const scale = uDetailScales[i];
        const fade = float(1).sub(smoothstep(scale.mul(0.15), scale.mul(0.6), footprint)).toVar();
        const n0 = sample(frame, x, true).toVar();
        const gradient = vec3(
          sample(frame, x.add(vec3(scale.mul(0.05), 0, 0)), true).sub(n0),
          sample(frame, x.add(vec3(0, scale.mul(0.05), 0)), true).sub(n0),
          sample(frame, x.add(vec3(0, 0, scale.mul(0.05))), true).sub(n0),
        ).mul(20);
        bump.addAssign(gradient.mul(fade).mul(0.75 ** i));
        detail.mulAssign(mix(float(1), n0.add(0.55), fade.mul(0.7)));
        if (i === 1) fine.assign(mix(float(0.5), n0, fade));
      });
      const steep = float(1).sub(smoothstep(0.6, 0.7, dot(normal, up)));
      const bumpAmount = steep.mul(0.25).add(0.2);
      normal.assign(normalize(normal.add(bump.sub(normal.mul(dot(bump, normal))).mul(bumpAmount.mul(0.5)))));
      const facing = dot(normal, up).toVar();

      // Material: rock, banded by height (strata), grass on up-facing ground, pale dust on flat tops. The hills biome is
      // greener (grass on gentler slopes too, and more of it) and less dusty.
      const biome = fieldBiomeAt(field, x, true).toVar();
      const band = valueNoise(noiseTexture, vec3(altitude.div(uUnit.mul(0.35)), fine.mul(2), 0.5), true);
      const rock = mix(vec3(0.3, 0.27, 0.24), vec3(0.42, 0.3, 0.22), band).mul(detail).toVar();
      const lush = sample(maskFrames[1], x, true).add(biome.mul(0.25));
      const grass = mix(vec3(0.2, 0.3, 0), vec3(0.26, 0.16, 0.08), smoothstep(0.3, 0.7, lush.sub(biome.mul(0.3)))).mul(detail);
      const grassy = smoothstep(mix(float(0.55), float(0.35), biome), mix(float(0.9), float(0.7), biome), facing);
      const withGrass = mix(rock, grass, grassy.mul(smoothstep(0.35, 0.55, lush.add(fine.mul(0.3)))));
      const dusty = smoothstep(0.95, 0.99, facing).mul(smoothstep(0.45, 0.7, fine)).mul(float(0.6).sub(biome.mul(0.5)));
      const albedo = mix(withGrass, vec3(0.46, 0.43, 0.39).mul(detail), dusty).toVar();

      // Soft shadow toward the sun over the march field (penumbra from the closest pass).
      const shadow = float(1).toVar();
      const sunUp = dot(up, uSun).toVar();
      If(sunUp.greaterThan(-0.05).and(dot(normal, uSun).greaterThan(0)), () => {
        const u = max(footprint.mul(2), uUnit.mul(0.02)).toVar();
        Loop(uShadowSteps, () => {
          const s = x.add(uSun.mul(u));
          const sAltitude = altitudeOf(s).toVar();
          If(sAltitude.greaterThan(uShadowTop), () => { Break(); });
          const field = density(s, sAltitude, max(footprint, u.mul(0.01)), false).mul(STEP_SCALE);
          shadow.assign(min(shadow, clamp(field.mul(16).div(u), 0, 1)));
          If(shadow.lessThan(0.01), () => { Break(); });
          u.addAssign(clamp(min(field, shapeOps.reach(s, footprint)), uUnit.mul(0.1), uUnit.mul(2)));
        });
      });

      // Light: low sun warm, high sun white; sky from five directions; a bounce opposite the sun.
      const view = d.negate();
      const day = smoothstep(-0.12, 0.12, sunUp);
      const east = (normalize((cross(vec3(0, 1, 0), up) as any).add(vec3(1e-6, 0, 0))) as any).toVar();
      const north = (cross(up, east) as any).toVar();
      const skyLight = roughDiffuse(up, normal, view)
        .add(roughDiffuse(normalize(up.add(east.mul(3))), normal, view))
        .add(roughDiffuse(normalize(up.sub(east.mul(3))), normal, view))
        .add(roughDiffuse(normalize(up.add(north.mul(3))), normal, view))
        .add(roughDiffuse(normalize(up.sub(north.mul(3))), normal, view))
        .mul(0.2);
      const away = (normalize(uSun.sub(up.mul(sunUp)).negate().add(vec3(1e-6, 0, 0))) as any);
      // A low sun is strong and orange (as in those shaders), a high one weaker and white, so noon is not blown out.
      const sunColour = mix(vec3(1.2, 0.5, 0.25).mul(7), vec3(1.1, 0.95, 0.8).mul(2.2), smoothstep(0.15, 0.6, sunUp));
      const occlusion = smoothstep(uUnit.mul(-CANYON_DEPTH - 2), uUnit.mul(-CANYON_DEPTH + 1), altitude).mul(0.6).add(0.4);
      const specular = pow(clamp(dot(reflect(d, normal), uSun), 0, 1), float(2)).mul(clamp(dot(normal, uSun), 0, 1)).mul(0.3);
      const light = sunColour.mul(roughDiffuse(uSun, normal, view).mul(shadow).mul(day))
        .mul(vec3(1, shadow.mul(0.5).add(0.5), shadow))
        .add(vec3(0.1, 0.5, 0.7).mul(skyLight.mul(occlusion).mul(max(day, float(0.05)))))
        .add(vec3(0.3, 0.15, 0.15).mul(roughDiffuse(away, normal, view).mul(2).mul(occlusion).mul(day)))
        .add(vec3(specular.mul(shadow).mul(occlusion).mul(day)));
      const lit = albedo.mul(0.4).mul(light).toVar();
      colour.assign(lit.mul(float(1.4).div(lit.add(1))));
    });
    // Grade in display space (a little warm, more contrast, less saturation), then back to linear for the renderer.
    const display = pow(clamp(colour, 0, 1), vec3(0.4545)).mul(vec3(1.1, 1, 1)).toVar();
    display.assign(clamp(display, 0, 1));
    display.assign(display.mul(display).mul(float(3).sub(display.mul(2))));
    display.assign(mix(display, vec3(dot(display, vec3(0.333))), 0.4));
    display.assign(display.mul(0.5).add(display.mul(display).mul(float(3).sub(display.mul(2))).mul(0.5)));
    return vec4(pow(display, vec3(2.2)) as any, 1);
  });

  const material = new MeshBasicNodeMaterial({ side: BackSide });
  material.colorNode = shade();
  const hitView = cameraViewMatrix.mul(vec4(normalize(positionWorld).mul(trace.x), 1)) as any;
  material.depthNode = viewZToPerspectiveDepth(hitView.z, cameraNear, cameraFar);
  // The pre-pass writes raw distances (red: last t in the air, green: 1 where the coarse ray reached the ground).
  const coarse = buildTrace(true)() as any;
  const prepassMaterial = new MeshBasicNodeMaterial({ side: BackSide });
  prepassMaterial.outputNode = vec4(coarse.z, coarse.y, 0, 1);

  const origin = new Vector3();
  const allFrames = [...rockFrames, ...maskFrames, biomeFrame, ...detailFrames];
  const updateFrames = (unit: number) => {
    const matrices = fieldFrameMatrices(unit);
    rockFrames.forEach((frame, i) => frame.matrix.copy(matrices.rock[i]));
    maskFrames.forEach((frame, i) => frame.matrix.copy(matrices.mask[i]));
    biomeFrame.matrix.copy(matrices.biome);
    detailFrames.forEach((frame, i) => {
      const scale = DETAIL_COARSEST * unit * DETAIL_RATIO ** i;
      frame.matrix.identity().multiplyScalar(1 / scale);
      uDetailScales[i].value = scale;
    });
    for (const frame of allFrames) frame.uMatrix.value.copy(frame.matrix);
  };
  const updateOps = () => {
    shapeOps.setOps(ops ?? [shapeOpFromTerrainEdit(padEdit(radius), 'pad')], radius, { bottomM: bottomAltitudeM(radius), topM: topAltitudeM(radius) });
    uShadowTop.value = shapeOps.band.topM;
  };
  const updateCamera = () => {
    const [x, y, z] = camera;
    const top = radius + shapeOps.band.topM;
    const bottom = radius + shapeOps.band.bottomM;
    const air = airHeightM(radius);
    const r2 = x * x + y * y + z * z;
    uCamera.value.set(x, y, z);
    uCamQ.value = r2 - radius * radius;
    uCamQTop.value = r2 - top * top;
    uCamQBottom.value = r2 - bottom * bottom;
    uCamQOuter.value = r2 - (radius + air) * (radius + air);
    const altitude = Math.sqrt(r2) - radius;
    const t = Math.min(1, Math.max(0, (air - altitude) / (air * 0.5)));
    uSkyAmount.value = t * t * (3 - 2 * t);
    for (const frame of allFrames) frame.uOrigin.value.copy(noiseOrigin(frame.matrix, frame.offset, x, y, z, origin));
    shapeOps.setCamera(camera);
  };

  const setShapeOps = (next: readonly ShapeOp[] | undefined) => {
    ops = next;
    updateOps();
    updateCamera();
  };

  return {
    material,
    prepass: { material: prepassMaterial, target: prepassTarget },
    shellRadiusM(radiusM, heightSegments) {
      return (radiusM + airHeightM(radiusM)) / Math.cos(Math.PI / heightSegments);
    },
    setBody(radiusM) {
      radius = radiusM;
      uRadius.value = radiusM;
      uUnit.value = unitM(radiusM);
      updateFrames(unitM(radiusM));
      updateOps();
      updateCamera();
    },
    setCamera(x, y, z) {
      camera = [x, y, z];
      updateCamera();
    },
    setSun(x, y, z) { uSun.value.set(x, y, z); },
    setPixelAngle(radians) { uPixelAngle.value = radians; },
    setSteps(steps) { uSteps.value = Math.max(1, Math.round(steps)); },
    setShadows(on) { uShadowSteps.value = on ? SHADOW_STEPS : 0; },
    setBiome(biome) { uBiomeOverride.value = biome ?? -1; },
    setRock(grounded) { uRockOverride.value = grounded ?? -1; },
    setEdits(next) {
      setShapeOps(next?.map((edit, i) => shapeOpFromTerrainEdit(edit, `edit-${i}`)));
    },
    setShapeOps,
    setPrepass(scale, width, height) {
      uPrepassScale.value = scale;
      if (scale <= 0) return;
      const coarseWidth = Math.max(1, Math.ceil(width / scale));
      const coarseHeight = Math.max(1, Math.ceil(height / scale));
      if (prepassTarget.width !== coarseWidth || prepassTarget.height !== coarseHeight) prepassTarget.setSize(coarseWidth, coarseHeight);
      uPrepassSize.value.set(coarseWidth, coarseHeight);
    },
  };
}
