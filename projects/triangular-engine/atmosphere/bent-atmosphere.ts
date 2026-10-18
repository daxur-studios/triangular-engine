import { Matrix3, Vector3 } from 'three';
import {
  If,
  Loop,
  abs,
  atan,
  clamp,
  cos,
  dot,
  exp,
  float,
  int,
  max,
  min,
  pow,
  select,
  sin,
  smoothstep,
  sqrt,
  uniform,
  vec3,
} from 'three/tsl';
import { AtmosphereGpuModel, type AtmosphereMarchInput } from './atmosphere-gpu-model';
import { sunDirectionFromAngles } from './atmosphere-backdrop';
import { MASK_GAP_RAMP, bendCurvature, bendFrame, type BentFrame, type Vec3 } from './bent-planet';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type DayNightMode = 'real' | 'alwaysDay';

export interface BentShape {
  /** 0 is the globe, 1 the flat map. */
  morph: number;
  /** The planet's radius at morph 0, metres; the map is `2 pi R` by `pi R` (equirect). */
  planetRadiusM: number;
  /** The map point (metres from the map centre) the camera hangs above. Default the map centre. */
  anchorX?: number;
  anchorY?: number;
}

/**
 * The atmosphere of the bent planet (Plan 049, Morph, Phase 3a): the globe's ray march with the sphere's radius `1/k`
 * instead of the baked `R`, written in the curvature form so `k = 0` is exact, plus the map mask and the day/night mode.
 *
 * The geometry runs in the camera's local frame (y up, camera at `(0, altitude, 0)` above the anchor's ground point), as
 * the globe's does. Only two things need the map: the mask, which needs a sample's map coordinates (an affine map of
 * the local position, then angles about the sphere's centre), and the day/night sun angle. The tables (transmittance,
 * multi-scatter, irradiance) are still baked for one radius; they are read by altitude and sun angle, so on a larger
 * sphere they are slightly off near the horizon.
 *
 * Call {@link setShape} when the morph or the anchor changes. {@link traceRay} and {@link march} are builders to call
 * inside an `Fn` body.
 */
export class BentAtmosphere {
  /** Curvature `k = (1 - morph) / R`, 1 / metre. 0 is the flat map. */
  readonly uK = uniform(0);
  /** Local frame (east, up, -north) to the map frame, as columns. */
  readonly uMapFromLocal = uniform(new Matrix3());
  /** The anchor's ground point in the map frame. */
  readonly uMapOrigin = uniform(new Vector3());
  readonly uHalfWidth = uniform(1);
  readonly uHalfHeight = uniform(1);
  /** The planet's radius at morph 0: map coordinates are `R (lon, lat)`. */
  readonly uRefRadius = uniform(1);
  /** A march never goes further than this (the map's diagonal), which bounds rays that skim a flat map. */
  readonly uMaxSpan = uniform(1e9);
  /** Falloff of the map mask at the map's edge, metres. Default about one Rayleigh scale height. */
  readonly uSoftness = uniform(8000);
  /** 1 applies the map mask, 0 leaves the air everywhere. */
  readonly uMaskEnabled = uniform(1);
  /** 0 = real day and night (the sun angle comes from each point's globe direction), 1 = always day. */
  readonly uDayNight = uniform(0);
  readonly uAlwaysDayMu = uniform(Math.sin((50 * Math.PI) / 180));
  /** Sun direction in the body (map) frame at morph 0, for the real day and night. */
  readonly uSunMap = uniform(new Vector3(0, 0, 1));
  /** Sun direction in the camera's local frame, for the phase function. */
  readonly uSunLocal = uniform(new Vector3(0, 1, 0));

  private mode: DayNightMode = 'real';
  private alwaysDayElevationDeg = 50;
  private alwaysDayAzimuthDeg = 135;
  private sunElevationDeg = 60;
  private sunAzimuthDeg = 90;
  private curvature = 0;
  private frame: BentFrame = bendFrame(0, 0, 0);

  constructor(readonly model: AtmosphereGpuModel) {}

  /** The current curvature, 1 / metre. */
  get k(): number {
    return this.curvature;
  }

  /** The anchor's frame in the map frame (CPU twin of the uniforms). */
  get anchorFrame(): BentFrame {
    return this.frame;
  }

  setShape(shape: BentShape): void {
    const R = shape.planetRadiusM;
    const k = bendCurvature(shape.morph, R);
    this.curvature = k;
    this.uK.value = k;
    this.uRefRadius.value = R;
    this.uHalfWidth.value = Math.PI * R;
    this.uHalfHeight.value = 0.5 * Math.PI * R;
    this.uMaxSpan.value = 2 * Math.hypot(Math.PI * R, 0.5 * Math.PI * R);
    const frame = bendFrame(shape.anchorX ?? 0, shape.anchorY ?? 0, k);
    this.frame = frame;
    // Rows of the matrix are the map-frame components of (east, up, -north).
    const e = frame.east;
    const u = frame.up;
    const n = frame.north;
    this.uMapFromLocal.value.set(e[0], u[0], -n[0], e[1], u[1], -n[1], e[2], u[2], -n[2]);
    this.uMapOrigin.value.set(...frame.origin);
    this.updateSun();
  }

  /** The real sun: elevation and azimuth in the local frame at the map centre (the frame the lab's sliders use). */
  setSun(elevationDeg: number, azimuthDeg: number): void {
    this.sunElevationDeg = elevationDeg;
    this.sunAzimuthDeg = azimuthDeg;
    this.updateSun();
  }

  setDayNight(mode: DayNightMode, alwaysDayElevationDeg = 50, alwaysDayAzimuthDeg = 135): void {
    this.mode = mode;
    this.alwaysDayElevationDeg = alwaysDayElevationDeg;
    this.alwaysDayAzimuthDeg = alwaysDayAzimuthDeg;
    this.uDayNight.value = mode === 'alwaysDay' ? 1 : 0;
    this.uAlwaysDayMu.value = Math.sin((alwaysDayElevationDeg * Math.PI) / 180);
    this.updateSun();
  }

  get dayNight(): DayNightMode {
    return this.mode;
  }

  private updateSun(): void {
    // The real sun is fixed in the body frame: the map centre's local frame is (x, z, -y) of the map frame.
    const centre = sunDirectionFromAngles(this.sunElevationDeg, this.sunAzimuthDeg);
    this.uSunMap.value.set(centre.x, -centre.z, centre.y);
    if (this.mode === 'alwaysDay') {
      const local = sunDirectionFromAngles(this.alwaysDayElevationDeg, this.alwaysDayAzimuthDeg);
      this.uSunLocal.value.copy(local);
      return;
    }
    // The same sun seen from the anchor's local frame (the phase function only; the sun angle comes per sample).
    const s = this.uSunMap.value;
    const toLocal = (v: Vec3): number => v[0] * s.x + v[1] * s.y + v[2] * s.z;
    const f = this.frame;
    this.uSunLocal.value.set(toLocal(f.east), toLocal(f.up), -toLocal(f.north));
  }

  // -- shader pieces ---------------------------------------------------------------------------------

  /** Map coordinates `{ mx, my }` (metres) of a local position `p`, in the curvature form (no `1/k`). Inside an `Fn`. */
  mapCoords(p: any): { mx: any; my: any } {
    const k = this.uK;
    const kk = max(k, 1e-12);
    const pm: any = (this.uMapFromLocal as any).mul(p).add(this.uMapOrigin);
    const nx = pm.x.mul(k);
    const ny = pm.y.mul(k);
    const nz = pm.z.mul(k).add(1);
    const len = sqrt(nx.mul(nx).add(ny.mul(ny)).add(nz.mul(nz)));
    const nzSafe = select(nz.abs().lessThan(1e-6), float(1e-6), nz);
    const u = nx.div(nzSafe);
    const u2 = u.mul(u);
    const atanc = select(u2.lessThan(1e-6), float(1).sub(u2.div(3)), atan(u).div(select(u.abs().lessThan(1e-9), float(1), u)));
    const mxNear = pm.x.div(nzSafe).mul(atanc);
    const mxFar = atan(nx, nz).div(kk);
    const mx = select(nz.greaterThan(0.1), mxNear, mxFar);
    const a = clamp(ny.div(len), -1, 1);
    const a2 = a.mul(a);
    // asin(a) as atan(a / sqrt(1 - a^2)): the GPU's own asin is a polynomial that is 2% off for a ~ 0.003.
    const asinOverA = atan(a.div(sqrt(max(float(1).sub(a2), 1e-12)))).div(select(a.abs().lessThan(1e-9), float(1), a));
    const asinc = select(a2.lessThan(1e-6), float(1).add(a2.div(6)), asinOverA);
    const my = pm.y.div(len).mul(asinc);
    return { mx, my };
  }

  /** 1 inside the map's outline, 0 outside, soft at the edge; 1 everywhere when the mask is off. The node form of `mapMaskFactor`. */
  mapMask(mx: any, my: any): any {
    const k = this.uK;
    const kk = max(k, 1e-12);
    const W = this.uHalfWidth;
    const H = this.uHalfHeight;
    const big = float(1e30);
    const gapX = select(k.greaterThan(0), float(2 * Math.PI).div(kk).sub(W.mul(2)), big);
    const gapY = select(k.greaterThan(0), float(Math.PI).div(kk).sub(H.mul(2)), big);
    const softX = max(min(this.uSoftness, gapX.mul(0.5)), W.mul(1e-9));
    const softY = max(min(this.uSoftness, gapY.mul(0.5)), H.mul(1e-9));
    const openX = smoothstep(float(0), W.mul(MASK_GAP_RAMP), gapX);
    const openY = smoothstep(float(0), H.mul(MASK_GAP_RAMP), gapY);
    const maskX = smoothstep(float(0), softX, W.sub(abs(mx)));
    const maskY = smoothstep(float(0), softY, H.sub(abs(my)));
    const factor = float(1).add(openX.mul(maskX.sub(1))).mul(float(1).add(openY.mul(maskY.sub(1))));
    return select(this.uMaskEnabled.greaterThan(0.5), factor, float(1));
  }

  /** The sun-zenith cosine at a point with map coordinates `(mx, my)`: from its globe direction, or the fixed always-day one. */
  muSunAt(mx: any, my: any): any {
    const lon = mx.div(this.uRefRadius);
    const lat = my.div(this.uRefRadius);
    const cl = cos(lat);
    const globe = vec3(cl.mul(sin(lon)), sin(lat), cl.mul(cos(lon)));
    return select(this.uDayNight.greaterThan(0.5), this.uAlwaysDayMu, dot(globe, this.uSunMap));
  }

  /**
   * Light on the ground at map coordinates, relative to the sun irradiance: the sun's transmittance times the cosine
   * plus the sky irradiance, from the tables at altitude 0.
   */
  groundLight(mx: any, my: any): any {
    const model = this.model;
    const mu = this.muSunAt(mx, my);
    const sunT = model.sunTransmittance(float(0), model.uRadius, mu);
    return sunT.mul(max(mu, 0)).add(model.skyIrradiance(float(0), mu));
  }

  /**
   * Where a view ray from `(0, altitude, 0)` meets the air's top and the ground of the sphere of curvature `k`. The same
   * quantities as `AtmosphereGpuModel.traceRay`, in the stable form: the root that stays finite as `k -> 0` is
   * `-c / (b + sign(b) sqrt(b^2 - k c))` and the other is `-(b + sign(b) sqrt(...)) / k`.
   */
  traceRay(input: Pick<AtmosphereMarchInput, 'altitude' | 'dir' | 'maxDistance' | 'ignoreGround'>) {
    const k = this.uK;
    const kk = max(k, 1e-14);
    const h: any = max(float(input.altitude), 0);
    const dir: any = input.dir;
    const top: any = this.model.uTopAltitude;

    const b: any = float(1).add(k.mul(h)).mul(dir.y);
    const cGround = h.mul(float(2).add(k.mul(h)));
    const cTop = h.sub(top).mul(float(2).add(k.mul(h.add(top))));
    const roots = (c: any): any => {
      const disc: any = b.mul(b).sub(k.mul(c));
      const s: any = sqrt(max(disc, 0));
      const qq: any = b.add(select(b.lessThan(0), s.negate(), s));
      const qSafe: any = select(qq.abs().lessThan(1e-20), float(1e-20), qq);
      const small = c.negate().div(qSafe);
      const bigRoot = qq.negate().div(kk);
      return { disc, lo: min(small, bigRoot), hi: max(small, bigRoot), small };
    };
    const top_ = roots(cTop);
    const ground = roots(cGround);

    const reachesGround: any = input.ignoreGround
      ? float(0).greaterThan(1)
      : (ground.disc.greaterThan(0) as any).and(b.lessThan(0));
    const tGround = ground.small;
    const tStart = max(top_.lo, 0);
    const tEndFull = select(reachesGround, tGround, top_.hi);
    const tEnd = min(min(tEndFull, float(input.maxDistance)), tStart.add(this.uMaxSpan));
    const valid: any = (top_.disc.greaterThan(0) as any).and(top_.hi.greaterThan(0));
    const span = select(valid, max(tEnd.sub(tStart), 0), float(0));
    const hitsGround = reachesGround.and(tGround.lessThan(float(input.maxDistance))).and(valid);
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

  /** The view-ray march on the bent planet; the result has the shape of `AtmosphereGpuModel.march`. Inside an `Fn`. */
  march(input: AtmosphereMarchInput) {
    const model = this.model;
    const steps = input.steps ?? AtmosphereGpuModel.defaultSteps;
    const dir = input.dir;
    const k = this.uK;
    const Rb = model.uRadius;
    const { h, tStart, span, hitsGround, groundDistance } = this.traceRay(input);
    const dt = span.div(steps);

    const cosNu = dot(dir, this.uSunLocal);
    const phaseR = float(3 / (16 * Math.PI)).mul(float(1).add(cosNu.mul(cosNu)));
    const g = model.uMieG;
    const g2 = g.mul(g);
    const phaseM = float(3 / (8 * Math.PI))
      .mul(float(1).sub(g2).div(float(2).add(g2)))
      .mul(float(1).add(cosNu.mul(cosNu)))
      .div(pow(float(1).add(g2).sub(g.mul(cosNu).mul(2)), 1.5));

    const L = vec3(0).toVar();
    const Lmulti = vec3(0).toVar();
    const throughput = vec3(1).toVar();

    If(span.greaterThan(0), () => {
      Loop({ start: int(0), end: int(steps), type: 'int', condition: '<' }, ({ i }: any) => {
        const t = tStart.add(float(i).add(0.5).mul(dt));
        const p = vec3(0, h, 0).add(dir.mul(t));
        const q = k.mul(dot(p, p)).add(p.y.mul(2));
        const root = sqrt(max(float(1).add(k.mul(q)), 1e-6));
        const alt = max(q.div(float(1).add(root)), 0);
        const { mx, my } = this.mapCoords(p);
        const muSun = this.muSunAt(mx, my);
        const mask = this.mapMask(mx, my);

        const dR = exp(alt.negate().div(model.uRayleighH));
        const dM = exp(alt.negate().div(model.uMieH));
        const tent = max(float(1).sub(abs(alt.sub(model.uAbsorberCenter)).div(model.uAbsorberWidth)), 0);
        const expo = exp(alt.negate().div(model.uAbsorberWidth));
        const dA = select(model.uAbsorberKind.equal(1), tent, select(model.uAbsorberKind.equal(2), expo, float(0)));
        const scatR = model.uRayleigh.mul(dR).mul(mask);
        const scatM = model.uMieScattering.mul(dM).mul(mask);
        const scat = scatR.add(scatM);
        const ext = scat.add(model.uMieAbsorption.mul(dM).mul(mask)).add(model.uAbsorberExt.mul(dA).mul(mask));

        // The tables are baked for the profile's radius: read them by altitude and sun angle on that radius.
        const sBaked = alt.mul(Rb.mul(2).add(alt));
        const rBaked = Rb.add(alt);
        const sunT = model.sunTransmittance(sBaked, rBaked, muSun);
        const psi = model.multiScatterAt(alt, muSun);
        const sourceSun = sunT.mul(scatR.mul(phaseR).add(scatM.mul(phaseM)));
        const sourceMulti = scat.mul(psi);

        const x = ext.mul(dt);
        const stepIntegral = (c: any): any =>
          select(c.lessThan(1e-3), float(1).sub(c.mul(0.5)).add(c.mul(c).div(6)), float(1).sub(exp(c.negate())).div(max(c, 1e-9)));
        const integral = vec3(stepIntegral(x.x), stepIntegral(x.y), stepIntegral(x.z)).mul(dt);
        L.addAssign(throughput.mul(sourceSun).mul(integral));
        Lmulti.addAssign(throughput.mul(sourceMulti).mul(integral));
        throughput.mulAssign(exp(x.negate()));
      });
    });

    return {
      radiance: L.add(Lmulti).mul(model.uSunIrradiance),
      radianceSun: L.mul(model.uSunIrradiance),
      radianceMulti: Lmulti.mul(model.uSunIrradiance),
      transmittance: throughput,
      hitsGround,
      groundDistance,
    };
  }
}
