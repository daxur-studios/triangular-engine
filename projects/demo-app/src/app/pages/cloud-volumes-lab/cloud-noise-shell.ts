/* eslint-disable @typescript-eslint/no-explicit-any */
import { BackSide, Data3DTexture, FrontSide, LinearFilter, Mesh, RedFormat, RepeatWrapping, SphereGeometry, Vector3 } from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Break, Fn, If, Loop, cameraPosition, ceil, clamp, dot, exp, float, fract, int, length, max, min, mix,
  normalize, positionWorld, pow, screenCoordinate, select, smoothstep, sqrt, step, texture3D, uniform, vec2, vec3, vec4,
} from 'three/tsl';
import { AtmosphereGpuModel, type PhysicalAtmosphereProfile } from 'triangular-engine/atmosphere';
import {
  CLOUD_SHELL_DETAIL_SCALE, CLOUD_SHELL_DETAIL_WEIGHT, CLOUD_SHELL_LOOK, CLOUD_SHELL_MAX_STEPS, CLOUD_SHELL_NOISE_OFFSET,
  CLOUD_SHELL_NOISE_SPREAD, CLOUD_SHELL_STEP, CLOUD_SHELL_TEXTURE_RANGE, CLOUD_SHELL_TEXTURE_SIZE, CLOUD_SHELL_TILE_CELLS, bakeShellNoise,
} from './cloud-noise-shell-density';

/** Cosine range below a point's horizon over which its sun colour fades out, as in `CloudVolumeAtmosphereLighting`. */
const TERMINATOR_FADE = 0.07;

/** Options for {@link CloudNoiseShell}. */
export interface CloudNoiseShellOptions {
  /** Planet radius in metres; the planet is centred on the origin. */
  readonly planetRadius: number;
  /** Height of the shell's floor above the surface, in metres. */
  readonly baseAltitude: number;
  /** Thickness of the shell, in metres. */
  readonly thickness: number;
  /** The atmosphere that lights the clouds, as it lights the volumes. Its tables are baked for this shell. */
  readonly atmosphere: PhysicalAtmosphereProfile;
}

/**
 * Planet-wide 3D noise clouds (Plan 051 Phase 6). One sphere mesh, one fragment-shader march through a thin spherical
 * shell. The density is a tiling noise cube baked once and read by the march; wind is a coordinate offset. The light is
 * the atmosphere's, shaded like `CloudVolume`, read per cloud sample because the shell crosses the terminator.
 * The cost is per pixel, not per cloud; the `cloud-shell-cost` suite measures it against Plan 051's G6.
 *
 * The density and transmittance rules have a plain-TypeScript twin in `cloud-noise-shell-density.ts` (and the ray
 * intervals in `cloud-noise-shell-interval.ts`); the specs check what a ray sees through them, so keep all three in step.
 */
export class CloudNoiseShell {
  readonly mesh: Mesh;
  readonly coverage = uniform(CLOUD_SHELL_LOOK.coverage);
  readonly extinction = uniform(CLOUD_SHELL_LOOK.extinction);
  readonly softness = uniform(CLOUD_SHELL_LOOK.softness);
  readonly steps = uniform(CLOUD_SHELL_MAX_STEPS);
  readonly frequency = uniform(CLOUD_SHELL_LOOK.frequency);
  readonly drift = uniform(0.4);
  readonly time = uniform(0);
  readonly phaseFloor = uniform(0.3);
  /** Diagnostics: 0 = clouds, 1 = opacity from the near (red) and far (green) shell crossing, 2 = crossing lengths. */
  readonly debugView = uniform(0);
  /** 1 = light from the atmosphere, 0 = the white sun and flat ambient the lab uses with atmosphere lighting off. */
  readonly atmosphereLighting = uniform(1);
  private readonly model: AtmosphereGpuModel;
  private readonly noise: Data3DTexture;
  private readonly sun = uniform(new Vector3(0, 1, 0));
  private readonly planetRadius: number;
  private readonly inner: number;
  private readonly outer: number;
  private readonly material: NodeMaterial;

  constructor(options: CloudNoiseShellOptions) {
    this.planetRadius = options.planetRadius;
    this.inner = options.planetRadius + options.baseAltitude;
    this.outer = this.inner + options.thickness;
    this.model = new AtmosphereGpuModel(options.atmosphere);
    const size = CLOUD_SHELL_TEXTURE_SIZE;
    this.noise = new Data3DTexture(bakeShellNoise(size), size, size, size);
    this.noise.format = RedFormat;
    this.noise.minFilter = this.noise.magFilter = LinearFilter;
    this.noise.wrapS = this.noise.wrapT = this.noise.wrapR = RepeatWrapping;
    this.noise.unpackAlignment = 1;
    this.noise.needsUpdate = true;
    this.material = new NodeMaterial();
    this.material.transparent = true;
    this.material.depthWrite = false;
    // The ray is analytic and stops at the planet itself, so the proxy sphere must not be depth-tested.
    this.material.depthTest = false;
    // Straight (not premultiplied) output. NodeMaterial.premultipliedAlpha = true multiplies the shader's colour by alpha
    // itself, so returning the march's already-weighted colour with it on darkened every cloud by alpha twice: thin,
    // partly transparent cloud over the planet disc turned into a dark see-through veil and only opaque cloud showed.
    this.material.premultipliedAlpha = false;
    this.material.side = FrontSide;
    this.material.fragmentNode = this.buildMarch();
    // Slightly oversize so the faceted proxy always covers the analytic shell's silhouette.
    this.mesh = new Mesh(new SphereGeometry(this.outer * 1.03, 96, 48), this.material);
    this.mesh.renderOrder = 20;
    this.mesh.frustumCulled = false;
  }

  /** Per frame: sun direction, drift clock, and which face of the proxy sphere to draw. */
  update(cameraPosition: Vector3, sunDirection: Vector3, seconds: number): void {
    this.sun.value.copy(sunDirection).normalize();
    this.time.value = seconds;
    this.material.side = cameraPosition.length() < this.outer * 1.03 ? BackSide : FrontSide;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.noise.dispose();
    this.model.dispose();
  }

  private buildMarch(): any {
    const rPlanet = this.planetRadius;
    const rInner = this.inner;
    const rOuter = this.outer;
    const thickness = rOuter - rInner;
    const offset = vec3(...CLOUD_SHELL_NOISE_OFFSET);
    // Keep in step with shellDensity() in cloud-noise-shell-density.ts.
    // Explicit level: textureSample is not allowed inside the march's loop and branches.
    const read = (q: any) => texture3D(this.noise, q.div(CLOUD_SHELL_TILE_CELLS)).level(float(0)).r.mul(2).sub(1).mul(CLOUD_SHELL_TEXTURE_RANGE);
    const density = (p: any, h: any, detail: boolean) => {
      const q = p.mul(this.frequency).add(offset).add(vec3(this.time.mul(this.drift).mul(this.frequency), 0, 0));
      const n = detail ? read(q).add(read(q.mul(CLOUD_SHELL_DETAIL_SCALE)).mul(CLOUD_SHELL_DETAIL_WEIGHT)) : read(q);
      // Height shapes the threshold (domes), not the result (slabs with a flat lid).
      const top = smoothstep(0.4, 1, h);
      const dome = float(1).sub(smoothstep(0, 0.3, h)).mul(0.9).add(top.mul(top));
      const threshold = float(0.5).sub(this.coverage).mul(2.6 * CLOUD_SHELL_NOISE_SPREAD).add(dome);
      const inside = step(0, h).mul(step(h, 1));
      return smoothstep(threshold, threshold.add(this.softness), n).mul(inside);
    };
    return Fn(() => {
      const o = cameraPosition;
      const d = normalize(positionWorld.sub(cameraPosition));
      const b = dot(o, d);
      const oo = dot(o, o);
      const color = vec3(0).toVar();
      const transmittance = float(1).toVar();
      const nearAlpha = float(0).toVar();
      const lengths = vec3(0).toVar();
      const discOuter = b.mul(b).sub(oo.sub(rOuter * rOuter));
      If(discOuter.greaterThan(0), () => {
        // Keep in step with shellIntervals() in cloud-noise-shell-interval.ts (that file is unit-tested).
        const root = sqrt(discOuter);
        const tOuterNear = b.negate().sub(root);
        const tOuterFar = b.negate().add(root);
        const discInner = b.mul(b).sub(oo.sub(rInner * rInner));
        const innerRoot = sqrt(max(discInner, 0));
        const tInnerNear = b.negate().sub(innerRoot);
        const tInnerFar = b.negate().add(innerRoot);
        const belowFloor = oo.lessThanEqual(rInner * rInner);
        // The planet hides everything beyond its surface (the proxy is not depth-tested).
        const discPlanet = b.mul(b).sub(oo.sub(rPlanet * rPlanet));
        const tPlanet = b.negate().sub(sqrt(max(discPlanet, 0)));
        const planetHit = discPlanet.greaterThan(0).and(tPlanet.greaterThan(0));
        const clipEnd = (e: any) => select(planetHit, min(e, tPlanet), e);

        const nearStart = select(belowFloor, max(tInnerFar, 0), max(tOuterNear, 0));
        const dips = belowFloor.not().and(discInner.greaterThan(0)).and(tInnerNear.greaterThan(nearStart));
        const nearEnd = clipEnd(select(belowFloor, tOuterFar, select(dips, tInnerNear, tOuterFar)));
        // Dipping under the floor without hitting the planet: the ray climbs back into the shell further on.
        const farStart = tInnerFar;
        const farEnd = select(dips.and(planetHit.not()), tOuterFar, tInnerFar);
        lengths.assign(vec3(clamp(nearEnd.sub(nearStart), 0, 3000), clamp(farEnd.sub(farStart), 0, 3000), 0).div(3000));

        const jitter = fract(float(52.9829189).mul(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715)))));
        const cosine = dot(d, this.sun);
        const hg = (g: number) => {
          const g2 = g * g;
          return float(1 - g2).div(pow(float(1 + g2).sub(cosine.mul(2 * g)), 1.5).mul(4 * Math.PI));
        };
        const phase = max(hg(0.5).mul(0.6).add(hg(-0.3).mul(0.4)), this.phaseFloor);
        const marchSegment = (tStart: any, tEnd: any) => {
          // The whole crossing is marched: no length cap (a cap cut grazing rays off mid-shell and left a hard edge).
          // Long grazing crossings get longer steps once they hit the step budget.
          const segment = max(tEnd.sub(tStart), 0);
          const count = clamp(ceil(segment.div(CLOUD_SHELL_STEP)), 8, this.steps);
          const dt = segment.div(count);
          If(segment.greaterThan(0).and(transmittance.greaterThanEqual(0.02)), () => {
            Loop(int(count), ({ i }: { i: any }) => {
              const t = tStart.add(float(i).add(jitter).mul(dt));
              const p = o.add(d.mul(t));
              const h = length(p).sub(rInner).div(thickness);
              const dens = density(p, h, true);
              If(dens.greaterThan(0.005), () => {
                // The atmosphere's light at this sample, with the same terminator fade as CloudVolumeAtmosphereLighting. Per
                // sample, not per ray: a grazing ray can cross from day into night, and a single read lights the night
                // side with the colour of the day side.
                const r = max(length(p), rPlanet + 1);
                const s = r.mul(r).sub(rPlanet * rPlanet);
                const muSun = dot(p.div(r), this.sun);
                const muHorizon = sqrt(s).div(r).negate();
                const edge = smoothstep(muHorizon.sub(TERMINATOR_FADE), muHorizon, muSun);
                const sunColor = mix(
                  vec3(1),
                  this.model.sunTransmittance(s, r, max(muSun, muHorizon.add(1e-3))).mul(edge),
                  this.atmosphereLighting,
                );
                const skyLight = mix(vec3(0.12, 0.16, 0.24), this.model.skyIrradiance(r.sub(rPlanet), muSun), this.atmosphereLighting);
                const stepT = exp(dens.mul(this.extinction).mul(dt).negate());
                // Two taps toward the sun for self-shadowing.
                const p1 = p.add(this.sun.mul(70));
                const p2 = p.add(this.sun.mul(210));
                const h1 = length(p1).sub(rInner).div(thickness);
                const h2 = length(p2).sub(rInner).div(thickness);
                const od = density(p1, h1, false).mul(70).add(density(p2, h2, false).mul(140)).mul(this.extinction);
                // The same shading as CloudVolume's march.
                const sunLight = sunColor.mul(exp(od.negate())).mul(phase.mul(Math.PI));
                const ambient = skyLight.mul(h.mul(0.5).add(0.5));
                const lit = sunLight.add(ambient);
                color.addAssign(transmittance.mul(float(1).sub(stepT)).mul(lit));
                transmittance.mulAssign(stepT);
                If(transmittance.lessThan(0.02), () => {
                  Break();
                });
              });
            });
          });
        };
        marchSegment(nearStart, nearEnd);
        nearAlpha.assign(float(1).sub(transmittance));
        marchSegment(farStart, farEnd);
      });
      const alpha = float(1).sub(transmittance).toVar();
      If(this.debugView.equal(1), () => {
        color.assign(vec3(nearAlpha, alpha.sub(nearAlpha), 0));
        alpha.assign(1);
      });
      If(this.debugView.equal(2), () => {
        color.assign(lengths);
        alpha.assign(1);
      });
      // The march sums colour already weighted by opacity; the material blends straight alpha, so undo the weight here.
      return vec4(color.div(max(alpha, 1e-4)), alpha);
    })();
  }
}
