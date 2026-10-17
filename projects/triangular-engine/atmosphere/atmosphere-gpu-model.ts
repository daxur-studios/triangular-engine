import {
  ClampToEdgeWrapping,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  RGBAFormat,
  Vector3,
} from 'three';
import {
  Fn,
  If,
  Loop,
  clamp,
  dot,
  exp,
  float,
  int,
  max,
  min,
  mix,
  pow,
  select,
  smoothstep,
  sqrt,
  texture,
  uniform,
  vec2,
  vec3,
  abs,
} from 'three/tsl';
import {
  AtmosphereLutImage,
  AtmosphereLutOptions,
  AtmosphereLuts,
  bakeAtmosphereLuts,
} from './atmosphere-luts';
import { PhysicalAtmosphereProfile } from './atmosphere-profile';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The atmosphere as TSL (Plan 049, Phase 2a): the baked tables as half-float textures, the profile as
 * uniforms, and {@link AtmosphereGpuModel.march} to integrate a view ray.
 *
 * The march mirrors `integrateRadiance` in `atmosphere-reference-integrator.ts` step for step (midpoint
 * rule, Hillaire's multiple-scattering source, sun transmittance read from the baked table); the spec
 * evaluates both and compares them. It is a fixed-count per-pixel march, which is the reference path:
 * the cached sky-view table of the plan (Phase 2c) replaces it for the sky without changing its output.
 *
 * Geometry runs in a frame local to the camera's ground point: `x`/`z` horizontal, `y` up, the planet
 * centre at `(0, -R, 0)`. Altitude is `(|p|^2 - R^2) / (|p| + R)` evaluated as
 * `(x^2 + y^2 + z^2 + 2 R y) / (|p| + R)`, which keeps full float32 precision at Earth scale (Plan 049,
 * "Precision"). Callers pass the camera altitude as a number rather than a position for the same reason.
 *
 * Limits of this version: one absorber layer (ozone-like), either tent or exponential. Profiles with more
 * throw.
 */

export interface AtmosphereMarchInput {
  /** Camera altitude above the ground, metres (node or number). Clamped to >= 0. */
  altitude: any;
  /** Unit view direction in the local frame (y up). */
  dir: any;
  /** Unit direction to the sun in the same frame. */
  sunDir: any;
  /** The ray stops at this distance (use a huge number for the sky). */
  maxDistance: any;
  /** Samples along the ray. Default {@link AtmosphereGpuModel.defaultSteps}. */
  steps?: number;
  /**
   * Do not stop at the ground: the ray goes on to `maxDistance` (or the top of the air), and below the ground the air
   * is taken as its ground-level density. The aerial-perspective table uses it so a texel whose ray dips under the
   * planet's sphere still stands for the distance it is asked about (terrain rises above the sphere).
   */
  ignoreGround?: boolean;
  /**
   * Light every point as if the planet did not shadow it: the sun's transmittance is read at no lower than the horizon
   * direction. `radianceSun` is then the single-scattered sunlight accumulated over the whole ray, which a consumer can
   * cut the planet's shadow out of afterwards (the aerial-perspective table does, per pixel, so the terminator is not
   * limited to its texel size).
   */
  unshadowed?: boolean;
}

export interface AtmosphereMarchResult {
  /** In-scattered radiance, already multiplied by the sun irradiance. */
  radiance: any;
  /** The single-scattered sunlight part of `radiance` (sun irradiance applied): the part the planet's shadow switches off. */
  radianceSun: any;
  /** The multiple-scattering part of `radiance` (sun irradiance applied), which the planet's shadow leaves alone. */
  radianceMulti: any;
  /** Transmittance along the part of the ray inside the atmosphere. */
  transmittance: any;
  /** True when the ray reaches the ground inside `maxDistance`. */
  hitsGround: any;
  /** Distance to the ground along the ray (meaningful when `hitsGround`). */
  groundDistance: any;
}

function toHalfTexture(
  image: AtmosphereLutImage,
  existing?: DataTexture,
): DataTexture {
  const half =
    existing &&
    existing.image.width === image.width &&
    existing.image.height === image.height
      ? (existing.image.data as Uint16Array)
      : new Uint16Array(image.width * image.height * 4);
  for (let i = 0; i < half.length; i++)
    half[i] = DataUtils.toHalfFloat(image.data[i]);
  if (existing && existing.image.data === half) {
    existing.needsUpdate = true;
    return existing;
  }
  existing?.dispose();
  const tex = new DataTexture(
    half,
    image.width,
    image.height,
    RGBAFormat,
    HalfFloatType,
  );
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** (1 - exp(-x)) / x, with a series near 0 so thin air does not lose its scattering in float32. */
const stepIntegral = Fn(([x]: any[]) =>
  select(
    x.lessThan(1e-3),
    float(1).sub(x.mul(0.5)).add(x.mul(x).div(6)),
    float(1).sub(exp(x.negate())).div(max(x, 1e-9)),
  ),
);

export class AtmosphereGpuModel {
  /** Default samples along a view ray. */
  static readonly defaultSteps = 32;

  readonly sunDirection = uniform(new Vector3(0, 1, 0));

  // Profile uniforms (updated in place by setProfile).
  readonly uRadius = uniform(1);
  readonly uRadiusSq = uniform(1);
  readonly uTopAltitude = uniform(1);
  readonly uTopRadius = uniform(1);
  readonly uHorizon = uniform(1);
  readonly uRayleigh = uniform(new Vector3());
  readonly uRayleighH = uniform(1);
  readonly uMieScattering = uniform(new Vector3());
  readonly uMieAbsorption = uniform(new Vector3());
  readonly uMieH = uniform(1);
  readonly uMieG = uniform(new Vector3());
  readonly uAbsorberKind = uniform(0);
  readonly uAbsorberExt = uniform(new Vector3());
  readonly uAbsorberCenter = uniform(0);
  readonly uAbsorberWidth = uniform(1);
  readonly uSunIrradiance = uniform(new Vector3(1, 1, 1));
  readonly uSunAngularRadius = uniform(0.00465);
  readonly uGroundAlbedo = uniform(new Vector3(0.3, 0.3, 0.3));

  private transmittanceTexture!: DataTexture;
  private multiScatterTexture!: DataTexture;
  private irradianceTexture!: DataTexture;
  private lutSizes = { t: [1, 1], m: [1, 1], i: [1, 1] };
  private currentLuts!: AtmosphereLuts;
  /** Increments on every {@link setProfile}; caches built from the tables compare it to know when to redo. */
  profileVersion = 0;

  constructor(
    profile: PhysicalAtmosphereProfile,
    private readonly lutOptions: AtmosphereLutOptions = {},
  ) {
    this.setProfile(profile);
  }

  get luts(): AtmosphereLuts {
    return this.currentLuts;
  }

  get profile(): PhysicalAtmosphereProfile {
    return this.currentLuts.profile;
  }

  /**
   * Rebakes the tables and rewrites the uniforms. The table sizes cannot change after the first call (the
   * shader has them baked in); material graphs stay valid across calls.
   */
  setProfile(profile: PhysicalAtmosphereProfile): void {
    if (profile.absorbers.length > 1) {
      throw new Error('AtmosphereGpuModel supports at most one absorber layer');
    }
    const luts = bakeAtmosphereLuts(profile, this.lutOptions);
    this.profileVersion++;
    this.currentLuts = luts;
    this.transmittanceTexture = toHalfTexture(
      luts.transmittance,
      this.transmittanceTexture,
    );
    this.multiScatterTexture = toHalfTexture(
      luts.multiScatter,
      this.multiScatterTexture,
    );
    this.irradianceTexture = toHalfTexture(
      luts.irradiance,
      this.irradianceTexture,
    );
    this.lutSizes = {
      t: [luts.transmittance.width, luts.transmittance.height],
      m: [luts.multiScatter.width, luts.multiScatter.height],
      i: [luts.irradiance.width, luts.irradiance.height],
    };

    const R = profile.planetRadiusM;
    const top = R + profile.topAltitudeM;
    this.uRadius.value = R;
    this.uRadiusSq.value = R * R;
    this.uTopAltitude.value = profile.topAltitudeM;
    this.uTopRadius.value = top;
    this.uHorizon.value = Math.sqrt(top * top - R * R);
    this.uRayleigh.value.set(...profile.rayleigh.scatteringPerM);
    this.uRayleighH.value = profile.rayleigh.scaleHeightM;
    this.uMieScattering.value.set(...profile.mie.scatteringPerM);
    this.uMieAbsorption.value.set(...profile.mie.absorptionPerM);
    this.uMieH.value = profile.mie.scaleHeightM;
    const g = profile.mie.phaseG;
    if (typeof g === 'number') this.uMieG.value.set(g, g, g);
    else this.uMieG.value.set(...g);
    const absorber = profile.absorbers[0];
    if (!absorber) {
      this.uAbsorberKind.value = 0;
      this.uAbsorberExt.value.set(0, 0, 0);
    } else {
      this.uAbsorberExt.value.set(...absorber.extinctionPerM);
      if (absorber.density.kind === 'tent') {
        this.uAbsorberKind.value = 1;
        this.uAbsorberCenter.value = absorber.density.centerAltitudeM;
        this.uAbsorberWidth.value = absorber.density.halfWidthM;
      } else {
        this.uAbsorberKind.value = 2;
        this.uAbsorberWidth.value = absorber.density.scaleHeightM;
      }
    }
    this.uSunIrradiance.value.set(...profile.sun.irradiance);
    this.uSunAngularRadius.value = profile.sun.angularRadiusRad;
    this.uGroundAlbedo.value.set(...profile.groundAlbedo);
  }

  setSunDirection(x: number, y: number, z: number): void {
    this.sunDirection.value.set(x, y, z).normalize();
  }

  // -- table lookups -----------------------------------------------------------------------------

  /**
   * Sunlight transmittance at a point from the table, with a soft planet shadow. `s` is
   * `r^2 - R^2` (precise), `r` the radius and `muSun` the sun-zenith cosine at the point.
   */
  sunTransmittance(s: any, r: any, muSun: any): any {
    const alt = max(s.div(r.add(this.uRadius)), 0);
    const rho = sqrt(max(s, 0));
    const dMin = this.uTopAltitude.sub(alt);
    const dMax = rho.add(this.uHorizon);
    // (top - r)(top + r) + r^2 mu^2: no cancellation.
    const disc = dMin
      .mul(this.uTopRadius.add(r))
      .add(r.mul(r).mul(muSun).mul(muSun));
    const d = max(
      r
        .mul(muSun)
        .negate()
        .add(sqrt(max(disc, 0))),
      0,
    );
    const xMu = clamp(d.sub(dMin).div(max(dMax.sub(dMin), 1e-3)), 0, 1);
    const xR = clamp(rho.div(this.uHorizon), 0, 1);
    const [tw, th] = this.lutSizes.t;
    const uv = vec2(
      xMu
        .mul(tw - 1)
        .add(0.5)
        .div(tw),
      xR
        .mul(th - 1)
        .add(0.5)
        .div(th),
    );
    const t = texture(this.transmittanceTexture, uv, 0).rgb;
    // The sun sits above the horizon of the point when muSun > -rho / r; blend over its angular size.
    const horizon = rho.div(r).negate();
    const lit = smoothstep(
      horizon.sub(this.uSunAngularRadius),
      horizon.add(this.uSunAngularRadius),
      muSun,
    );
    return t.mul(lit);
  }

  /**
   * Texture coordinates into an irradiance or multi-scatter table (x = 0.5 + 0.5 muSun, y = altitude / top). The tables are
   * baked on their ends (first row = altitude 0), so the unit range maps through `(0.5 + x (size - 1)) / size`.
   */
  private edgeAlignedUv(muSun: any, alt: any, size: readonly number[]): any {
    const [w, h] = size;
    const x = clamp(muSun.mul(0.5).add(0.5), 0, 1);
    const y = clamp(alt.div(this.uTopAltitude), 0, 1);
    return vec2(x.mul(w - 1).add(0.5).div(w), y.mul(h - 1).add(0.5).div(h));
  }

  /** The multi-scatter term `psi` at altitude `alt` and sun-zenith cosine `muSun`, read from its table. */
  multiScatterAt(alt: any, muSun: any): any {
    return texture(this.multiScatterTexture, this.edgeAlignedUv(muSun, alt, this.lutSizes.m), 0).rgb;
  }

  /** Sky irradiance on an upward-facing surface at altitude `alt`, relative to the sun irradiance. */
  skyIrradiance(alt: any, muSun: any): any {
    return texture(this.irradianceTexture, this.edgeAlignedUv(muSun, alt, this.lutSizes.i), 0).rgb;
  }

  /**
   * Light arriving at a point on the ground, relative to the sun irradiance, per channel:
   * `sunTransmittance * max(n.l, 0) + skyIrradiance`. Multiply by `albedo / pi` and the sun irradiance
   * for outgoing radiance. `up` is the unit normal (the local vertical at the point).
   */
  groundIrradiance(up: any, sunDir: any = this.sunDirection): any {
    const muSun = dot(up, sunDir);
    const sunT = this.sunTransmittance(float(0), this.uRadius, muSun);
    return sunT.mul(max(muSun, 0)).add(this.skyIrradiance(float(0), muSun));
  }

  // -- the march ---------------------------------------------------------------------------------

  /**
   * Where a view ray meets the atmosphere and the ground: the part of the ray inside the air
   * (`tStart` to `tEnd`, `span` long, 0 when it misses) and the ground hit. Pure geometry, no scattering.
   * Call inside an `Fn` body.
   */
  traceRay(
    input: Pick<AtmosphereMarchInput, 'altitude' | 'dir' | 'maxDistance' | 'ignoreGround'>,
  ) {
    const R = this.uRadius;
    const h = max(float(input.altitude), 0);
    const dir = input.dir;

    // Ray / sphere with the camera at (0, h, 0) and centre (0, -R, 0): b = (R + h) dir.y, and the
    // constants c = |oc|^2 - radius^2 are written as products so they do not cancel.
    const b = R.add(h).mul(dir.y);
    const cGround = h.mul(R.mul(2).add(h));
    const cTop = h
      .sub(this.uTopAltitude)
      .mul(h.add(this.uTopAltitude).add(R.mul(2)));
    const discTop = b.mul(b).sub(cTop);
    const sTop = sqrt(max(discTop, 0));
    const t0 = b.negate().sub(sTop);
    const t1 = b.negate().add(sTop);
    const discGround = b.mul(b).sub(cGround);
    const sGround = sqrt(max(discGround, 0));
    // For b < 0, (-b - s) = c / (-b + s): stable when the camera is near the ground.
    const tGround = cGround.div(max(b.negate().add(sGround), 1e-6));
    const reachesGround: any = input.ignoreGround
      ? float(0).greaterThan(1)
      : (discGround.greaterThan(0) as any).and(b.lessThan(0));

    const tStart = max(t0, 0);
    const tEndFull = select(reachesGround, tGround, t1);
    const tEnd = min(tEndFull, float(input.maxDistance));
    const valid: any = (discTop.greaterThan(0) as any).and(t1.greaterThan(0));
    const span = select(valid, max(tEnd.sub(tStart), 0), float(0));
    const hitsGround = reachesGround
      .and(tGround.lessThan(float(input.maxDistance)))
      .and(valid);
    // Variables, so the values are computed here at the top of the shader and not inside whichever branch
    // happens to use them first (callers read these from inside `If` blocks).
    return {
      h: h.toVar(),
      tStart: tStart.toVar(),
      tEnd: tEnd.toVar(),
      span: span.toVar(),
      valid: valid.toVar(),
      hitsGround: hitsGround.toVar(),
      groundDistance: tGround.toVar(),
    };
  }

  /** Builds the nodes for one view ray. Call inside an `Fn` body. */
  march(input: AtmosphereMarchInput): AtmosphereMarchResult {
    const steps = input.steps ?? AtmosphereGpuModel.defaultSteps;
    const R = this.uRadius;
    const dir = input.dir;
    const sunDir = input.sunDir;
    const { h, tStart, span, hitsGround, groundDistance } =
      this.traceRay(input);
    const dt = span.div(steps);

    const cosNu = dot(dir, sunDir);
    const phaseR = float(3 / (16 * Math.PI)).mul(
      float(1).add(cosNu.mul(cosNu)),
    );
    const g = this.uMieG;
    const g2 = g.mul(g);
    const phaseM = float(3 / (8 * Math.PI))
      .mul(float(1).sub(g2).div(float(2).add(g2)))
      .mul(float(1).add(cosNu.mul(cosNu)))
      .div(pow(float(1).add(g2).sub(g.mul(cosNu).mul(2)), 1.5));

    const L = vec3(0).toVar();
    const Lmulti = vec3(0).toVar();
    const throughput = vec3(1).toVar();

    // Rays that miss the air (most of the screen seen from space) skip the loop entirely.
    If(span.greaterThan(0), () => {
      Loop(
        { start: int(0), end: int(steps), type: 'int', condition: '<' },
        ({ i }: any) => {
          const t = tStart.add(float(i).add(0.5).mul(dt));
          const p = vec3(0, h, 0).add(dir.mul(t));
          const s = max(dot(p, p).add(R.mul(2).mul(p.y)), 0);
          const r = sqrt(this.uRadiusSq.add(s));
          const alt = max(s.div(r.add(R)), 0);
          const up = vec3(p.x, p.y.add(R), p.z).div(r);
          const muSun = dot(up, sunDir);

          const dR = exp(alt.negate().div(this.uRayleighH));
          const dM = exp(alt.negate().div(this.uMieH));
          const tent = max(
            float(1).sub(
              abs(alt.sub(this.uAbsorberCenter)).div(this.uAbsorberWidth),
            ),
            0,
          );
          const expo = exp(alt.negate().div(this.uAbsorberWidth));
          const dA = select(
            this.uAbsorberKind.equal(1),
            tent,
            select(this.uAbsorberKind.equal(2), expo, float(0)),
          );
          const scatR = this.uRayleigh.mul(dR);
          const scatM = this.uMieScattering.mul(dM);
          const scat = scatR.add(scatM);
          const ext = scat
            .add(this.uMieAbsorption.mul(dM))
            .add(this.uAbsorberExt.mul(dA));

          // The horizon direction: -rho / r (rho = sqrt(r^2 - R^2)), the lowest sun the planet does not block.
          const muSunLit = input.unshadowed ? max(muSun, sqrt(max(s, 0)).div(r).negate()) : muSun;
          const sunT = this.sunTransmittance(s, r, muSunLit);
          const psi = this.multiScatterAt(alt, muSun);
          const sourceSun = sunT.mul(scatR.mul(phaseR).add(scatM.mul(phaseM)));
          const sourceMulti = scat.mul(psi);

          const x = ext.mul(dt);
          const integral = vec3(
            stepIntegral(x.x),
            stepIntegral(x.y),
            stepIntegral(x.z),
          ).mul(dt);
          L.addAssign(throughput.mul(sourceSun).mul(integral));
          Lmulti.addAssign(throughput.mul(sourceMulti).mul(integral));
          throughput.mulAssign(exp(x.negate()));
        },
      );
    });

    return {
      radiance: L.add(Lmulti).mul(this.uSunIrradiance),
      radianceSun: L.mul(this.uSunIrradiance),
      radianceMulti: Lmulti.mul(this.uSunIrradiance),
      transmittance: throughput,
      hitsGround,
      groundDistance,
    };
  }

  /**
   * The air between a surface point and the camera when the planet is flat: a slab whose density falls off with
   * the height above the point's own plane. Closed form (no march): the column of each species is the path length
   * times its mean density along the straight line, `(1 - e^-x) / x` with `x = cameraHeight / H`; the sun and the
   * sky are read once, at the surface point's own sun angle. Call inside an `Fn` body.
   *
   * `distance` is the length of the ray and `cameraHeight` the camera's height above the point's plane, both in
   * metres; `cosNu` is the cosine between the view ray and the sun and `muSun` the sun's cosine against the point's
   * up. The ozone-like absorber is not modelled (no column for it on a slab), so twilight is a little less blue.
   * Matches {@link march} within a few percent where the sphere's curvature is negligible.
   */
  slab(input: { distance: any; cameraHeight: any; cosNu: any; muSun: any }): { radiance: any; transmittance: any } {
    const { distance, cosNu, muSun } = input;
    const height = max(input.cameraHeight, 0);
    const column = (scale: any): any => {
      const x = height.div(scale);
      const mean = mix(float(1).sub(x.mul(0.5)), float(1).sub(exp(x.negate())).div(max(x, 1e-6)), clamp(x.mul(1000), 0, 1));
      return mean.mul(distance);
    };
    const cR = this.uRayleigh.mul(column(this.uRayleighH));
    const mieColumn = column(this.uMieH);
    const cM = this.uMieScattering.mul(mieColumn);
    const opticalDepth = cR.add(cM).add(this.uMieAbsorption.mul(mieColumn));
    const transmittance = exp(opticalDepth.negate());

    const phaseR = float(3 / (16 * Math.PI)).mul(float(1).add(cosNu.mul(cosNu)));
    const g = this.uMieG;
    const g2 = g.mul(g);
    const phaseM = float(3 / (8 * Math.PI))
      .mul(float(1).sub(g2).div(float(2).add(g2)))
      .mul(float(1).add(cosNu.mul(cosNu)))
      .div(pow(float(1).add(g2).sub(g.mul(cosNu).mul(2)), 1.5));
    const sunT = this.sunTransmittance(float(0), this.uRadius, muSun);
    const psi = this.multiScatterAt(float(0), muSun);
    const source = sunT.mul(cR.mul(phaseR).add(cM.mul(phaseM))).add(cR.add(cM).mul(psi));
    // (1 - e^-tau) / tau per channel, by its series where tau is small.
    const series = float(1).sub(opticalDepth.mul(0.5)).add(opticalDepth.mul(opticalDepth).div(6));
    const exact = float(1).sub(transmittance).div(max(opticalDepth, 1e-6));
    const gain = mix(series, exact, clamp(opticalDepth.sub(1e-3).div(0.099), 0, 1));
    return { radiance: source.mul(gain).mul(this.uSunIrradiance), transmittance };
  }

  dispose(): void {
    this.transmittanceTexture.dispose();
    this.multiScatterTexture.dispose();
    this.irradianceTexture.dispose();
  }
}
