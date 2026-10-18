import { ClampToEdgeWrapping, DataTexture, FloatType, Matrix3, NearestFilter, RGBAFormat, Vector3 } from 'three';
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
  floor,
  int,
  max,
  min,
  mix,
  pow,
  select,
  sin,
  smoothstep,
  sqrt,
  texture,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import { AtmosphereGpuModel, type AtmosphereMarchInput } from './atmosphere-gpu-model';
import { sunDirectionFromAngles } from './atmosphere-backdrop';
import {
  MASK_GAP_RAMP,
  bendCurvature,
  bendFrame,
  blendedExtents,
  projectionRowAt,
  projectionRows,
  type BentFrame,
  type ProjectionRows,
  type Vec3,
} from './bent-planet';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type DayNightMode = 'real' | 'alwaysDay';
export type BentProjection = 'equirect' | 'equalEarth';

/** Rows of the outline table (the blended map's latitude and half-width per row). */
const ROW_COUNT = 256;

export interface BentShape {
  /** 0 is the globe, 1 the flat map. */
  morph: number;
  /** The planet's radius at morph 0, metres; the map is `2 pi R` by `pi R` (equirect). */
  planetRadiusM: number;
  /** The map point (metres from the map centre) the camera hangs above. Default the map centre. */
  anchorX?: number;
  anchorY?: number;
  /** The map projection at morph 1. `equalEarth` blends from the globe's equirect with `p = morph`. Default `equirect`. */
  projection?: BentProjection;
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
  /** A guard on the length of any march (the map's diagonal), for rays that skim a flat map with the mask off. */
  readonly uMaxSpan = uniform(1e9);
  /** How far past the map's rectangle a masked march runs: the edge falloff plus the air's own height. */
  readonly uClampMargin = uniform(8000);
  /** The projection blend `p`: 0 is the equirect globe projection, 1 Equal Earth (rows come from the outline table). */
  readonly uProjBlend = uniform(0);
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

  /** Increments when anything a baked sky-view table depends on changes (curvature, day/night mode, radius). */
  revision = 0;

  private readonly rowData = new Float32Array(ROW_COUNT * 4);
  private readonly rowTexture: DataTexture;
  private rows: ProjectionRows | null = null;
  private rowKey = '';
  private radius = 1;
  private anchorXM = 0;
  private anchorYM = 0;
  private mode: DayNightMode = 'real';
  private alwaysDayElevationDeg = 50;
  private alwaysDayAzimuthDeg = 135;
  private sunElevationDeg = 60;
  private sunAzimuthDeg = 90;
  private curvature = 0;
  private frame: BentFrame = bendFrame(0, 0, 0);

  constructor(readonly model: AtmosphereGpuModel) {
    this.rowTexture = new DataTexture(this.rowData, ROW_COUNT, 1, RGBAFormat, FloatType);
    this.rowTexture.minFilter = NearestFilter;
    this.rowTexture.magFilter = NearestFilter;
    this.rowTexture.wrapS = ClampToEdgeWrapping;
    this.rowTexture.wrapT = ClampToEdgeWrapping;
    this.rowTexture.generateMipmaps = false;
    this.rowTexture.needsUpdate = true;
  }

  /** The current curvature, 1 / metre. */
  get k(): number {
    return this.curvature;
  }

  /** The anchor's frame in the map frame (CPU twin of the uniforms). */
  get anchorFrame(): BentFrame {
    return this.frame;
  }

  /** The blended map's rows (latitude and half-width by height), or null while the projection is plain equirect. */
  get projectionTable(): ProjectionRows | null {
    return this.rows;
  }

  setShape(shape: BentShape): void {
    const R = shape.planetRadiusM;
    const k = bendCurvature(shape.morph, R);
    const p = shape.projection === 'equalEarth' ? Math.min(1, Math.max(0, shape.morph)) : 0;
    if (k !== this.curvature || R !== this.radius || p !== this.uProjBlend.value) this.revision++;
    this.curvature = k;
    this.radius = R;
    this.uK.value = k;
    this.uRefRadius.value = R;
    this.uProjBlend.value = p;
    const extents = blendedExtents(p, R);
    this.uHalfWidth.value = extents.halfWidth;
    this.uHalfHeight.value = extents.halfHeight;
    this.uMaxSpan.value = 2 * Math.hypot(extents.halfWidth, extents.halfHeight);
    const top = this.model.uTopAltitude.value;
    this.uClampMargin.value = this.uSoftness.value + 1.5 * k * top * Math.max(extents.halfWidth, extents.halfHeight);
    const rowKey = `${p}|${R}`;
    if (rowKey !== this.rowKey) {
      this.rowKey = rowKey;
      if (p > 0) {
        this.rows = projectionRows(p, R, ROW_COUNT);
        for (let i = 0; i < ROW_COUNT; i++) {
          this.rowData[i * 4] = this.rows.lat[i];
          this.rowData[i * 4 + 1] = this.rows.halfWidth[i];
        }
        this.rowTexture.needsUpdate = true;
      } else {
        this.rows = null;
      }
    }
    this.anchorXM = shape.anchorX ?? 0;
    this.anchorYM = shape.anchorY ?? 0;
    const frame = bendFrame(this.anchorXM, this.anchorYM, k);
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
    if (mode !== this.mode) this.revision++;
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

  // -- where the camera is relative to the map's edges (CPU) ----------------------------------------

  /**
   * Distance from the camera's ground point to the nearest map edge that is open (the wrap-around edges of a still
   * closed globe do not count), metres; `Infinity` with the mask off or no open edge. Measured along the map's axes, so
   * it overestimates next to the slanted sides of an Equal Earth outline.
   */
  mapEdgeDistance(): number {
    if (this.uMaskEnabled.value < 0.5) return Infinity;
    const k = this.curvature;
    const H = this.uHalfHeight.value;
    const W = this.rows ? projectionRowAt(this.rows, this.anchorYM).halfWidth : this.uHalfWidth.value;
    const openX = k > 0 ? (2 * Math.PI) / k - 2 * W > MASK_GAP_RAMP * W : true;
    const openY = k > 0 ? Math.PI / k - 2 * H > MASK_GAP_RAMP * H : true;
    return Math.min(openX ? W - Math.abs(this.anchorXM) : Infinity, openY ? H - Math.abs(this.anchorYM) : Infinity);
  }

  /**
   * How far a horizontal ray at `altitude` runs before the air in between hides what is beyond (transmittance about 1%
   * in the clearest channel). The sky-view table is right for an edge further away than this.
   */
  clearAirDistance(altitude: number): number {
    const m = this.model;
    const h = Math.max(altitude, 0);
    const dR = Math.exp(-h / m.uRayleighH.value);
    const dM = Math.exp(-h / m.uMieH.value);
    let clearest = Infinity;
    for (const c of ['x', 'y', 'z'] as const) {
      const ext = m.uRayleigh.value[c] * dR + (m.uMieScattering.value[c] + m.uMieAbsorption.value[c]) * dM;
      clearest = Math.min(clearest, ext);
    }
    return clearest > 0 ? Math.log(100) / clearest : Infinity;
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

  /** The map's outline row at map height `my`: the latitude and half-width there. Plain equirect rows need no table. */
  mapRow(my: any): { lat: any; halfWidth: any } {
    const lat: any = my.div(this.uRefRadius).toVar();
    const halfWidth: any = this.uHalfWidth.toVar();
    If(this.uProjBlend.greaterThan(0), () => {
      const t: any = clamp(my.div(this.uHalfHeight).mul(0.5).add(0.5), 0, 1).mul(ROW_COUNT - 1);
      const i0: any = floor(t);
      const f: any = t.sub(i0);
      const i1: any = min(i0.add(1), float(ROW_COUNT - 1));
      const a: any = texture(this.rowTexture, vec2(i0.add(0.5).div(ROW_COUNT), 0.5), 0);
      const b: any = texture(this.rowTexture, vec2(i1.add(0.5).div(ROW_COUNT), 0.5), 0);
      lat.assign(mix(a.x, b.x, f));
      halfWidth.assign(mix(a.y, b.y, f));
    });
    return { lat, halfWidth };
  }

  /** 1 inside the map's outline, 0 outside, soft at the edge; 1 everywhere when the mask is off. The node form of `mapMaskFactor`. */
  mapMask(mx: any, my: any, row: { lat: any; halfWidth: any } = this.mapRow(my)): any {
    const k = this.uK;
    const kk = max(k, 1e-12);
    const W: any = row.halfWidth;
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

  /**
   * The sun-zenith cosine at a point with map coordinates `(mx, my)`: from its globe direction (longitude from its
   * position along the row, `pi mx / halfWidth(row)`, latitude from the row), or the fixed always-day one.
   */
  muSunAt(mx: any, my: any, row: { lat: any; halfWidth: any } = this.mapRow(my)): any {
    const lon = float(Math.PI).mul(mx).div(row.halfWidth);
    const cl = cos(row.lat);
    const globe = (vec3 as any)(cl.mul(sin(lon)), sin(row.lat), cl.mul(cos(lon)));
    return select(this.uDayNight.greaterThan(0.5), this.uAlwaysDayMu, dot(globe, this.uSunMap));
  }

  /**
   * The sun's transmittance at altitude `alt` for sun-zenith cosine `muSun`, with the horizon cut where the current
   * curvature puts it (`sin(dip / 2) = sqrt(k h / (2 (1 + k h)))`: 0 on the flat map, the globe's at morph 0). The tables
   * are baked for one radius and cut the sun at that radius's horizon, so the angle is shifted by the difference; the
   * transmittance of the rest of the sun's path is read as the baked sphere gives it.
   */
  sunLight(alt: any, muSun: any): any {
    const model = this.model;
    const Rb = model.uRadius;
    const sBaked = alt.mul(Rb.mul(2).add(alt));
    const rBaked = Rb.add(alt);
    const bakedHorizon = sqrt(sBaked).div(rBaked).negate();
    const kh = max(this.uK.mul(alt), 0);
    const horizon = sqrt(kh.mul(kh.add(2))).div(kh.add(1)).negate();
    return model.sunTransmittance(sBaked, rBaked, muSun.add(bakedHorizon.sub(horizon)));
  }

  /**
   * Light on the ground at map coordinates, relative to the sun irradiance: the sun's transmittance times the cosine
   * plus the sky irradiance, from the tables at altitude 0.
   */
  groundLight(mx: any, my: any): any {
    const model = this.model;
    const mu = this.muSunAt(mx, my);
    return this.sunLight(float(0), mu).mul(max(mu, 0)).add(model.skyIrradiance(float(0), mu));
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
    // Past the map's outline (plus the falloff) there is no air: stop the march there. In the map frame the ray is
    // straight, so this is the slab test; at k = 0 it is exact, and it keeps the steps on the air that counts.
    const mapFromLocal: any = this.uMapFromLocal;
    const originLocal: any = (vec3 as any)(0, h, 0);
    const po: any = mapFromLocal.mul(originLocal).add(this.uMapOrigin);
    const pd: any = mapFromLocal.mul(dir);
    const exitAxis = (o: any, d: any, half: any): any => {
      const reach = half.add(this.uClampMargin);
      const along = select(d.greaterThan(0), reach.sub(o), reach.add(o));
      return select(d.abs().lessThan(1e-12), float(1e30), along.div(max(d.abs(), 1e-12)));
    };
    const tExit = select(
      this.uMaskEnabled.greaterThan(0.5),
      min(exitAxis(po.x, pd.x, this.uHalfWidth), exitAxis(po.y, pd.y, this.uHalfHeight)),
      float(1e30),
    );
    const tEnd = min(min(min(tEndFull, float(input.maxDistance)), tExit), tStart.add(this.uMaxSpan));
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
  march(input: AtmosphereMarchInput & { local?: boolean }) {
    const model = this.model;
    const steps = input.steps ?? AtmosphereGpuModel.defaultSteps;
    const dir = input.dir;
    const k = this.uK;
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
        // `local`: no map. The sky-view table has none; its sun angle is the local up's (or the always-day one) and no mask.
        let muSun: any;
        let mask: any;
        if (input.local) {
          const up: any = vec3(k.mul(p.x), k.mul(p.y).add(1), k.mul(p.z)).div(root);
          muSun = select(this.uDayNight.greaterThan(0.5), this.uAlwaysDayMu, dot(up, this.uSunLocal));
          mask = float(1);
        } else {
          const { mx, my } = this.mapCoords(p);
          const row = this.mapRow(my);
          muSun = this.muSunAt(mx, my, row);
          mask = this.mapMask(mx, my, row);
        }

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
        const sunT = this.sunLight(alt, muSun);
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
