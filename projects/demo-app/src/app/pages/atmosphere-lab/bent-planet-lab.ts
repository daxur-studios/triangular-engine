import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  DoubleSide,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  RGBAFormat,
  RenderTarget,
  Vector2,
  type Camera,
} from 'three';
import { NodeMaterial, QuadMesh, type WebGPURenderer } from 'three/webgpu';
import {
  Fn,
  If,
  attribute,
  cameraProjectionMatrixInverse,
  cameraWorldMatrix,
  clamp,
  cos,
  dot,
  float,
  fract,
  fwidth,
  mat3,
  max,
  mix,
  normalize,
  outputStruct,
  positionLocal,
  select,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  varying,
  vec3,
  vec4,
} from 'three/tsl';
import {
  AtmosphereGpuModel,
  AtmosphereSkyViewLut,
  BentAtmosphere,
  blendedProjection,
  bend,
  type BentProjection,
  type DayNightMode,
} from 'triangular-engine/atmosphere';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * How the sky is drawn on the bent planet.
 * - `auto`: the sky-view table inside the air; a half-resolution masked march, per ray, where a ray leaves the map's
 *   outline before the air in front of it turns opaque, and for everything seen from above the air. Blended per pixel.
 * - `table`: the table only (inside the air); the edges are not masked in the sky.
 * - `march`: the masked march for every pixel at full resolution (the 3a spike's path, kept for timings).
 */
export type BentSkyPath = 'auto' | 'table' | 'march';

/**
 * Plan 049 Phase 3a: the bent planet in `/atmosphere-lab`. No planet material, no terrain.
 *
 * - A longitude/latitude grid mesh, rebuilt on the CPU with `bend()` whenever the morph, the projection or the camera's
 *   anchor changes. Its fragments are a filtered checker and graticule, lit from the tables, with no haze (the haze
 *   on surfaces comes from the froxel table in the planet, not from a march here).
 * - A full-screen sky pass. By default it is one fetch from the sky-view table (baked for the bent sphere, radius `1 / k`),
 *   and a half-resolution masked march is blended in where the map's edge is within the clear-air distance of the
 *   camera, and used outright when the camera is above the air.
 *
 * The world is the camera's local frame (y up, camera at the origin, the anchor's ground point `altitude` below it),
 * in units of `planetRadius / 1000` metres so the planet is 1000 units across at every size.
 */
export class BentPlanetLab {
  readonly bent: BentAtmosphere;
  readonly skyView: AtmosphereSkyViewLut;
  readonly pass: Mesh;
  readonly grid: Mesh;
  readonly exposure = uniform(8);
  readonly altitude = uniform(1000);
  /** Size in pixels of the half-resolution masked pass (0 x 0 until it has rendered). */
  readonly maskedSize = new Vector2();
  /** How many frames rendered the masked pass, and how many wrote only the table path. */
  maskedRenders = 0;
  private readonly passMaterial: NodeMaterial;
  private readonly marchMaterial: NodeMaterial;
  private readonly gridMaterial: NodeMaterial;
  private coverageMaterial?: NodeMaterial;
  private probing = false;
  private readonly lonSegments = 360;
  private readonly latSegments = 180;
  private readonly positions: Float32Array;
  private readonly mapXY: Float32Array;
  private readonly lonLat: Float32Array;
  private readonly positionAttribute: BufferAttribute;

  /** 0 = auto, 1 = table only, 2 = full-resolution masked march per pixel. */
  private readonly pathMode = uniform(0);
  /** 1 when this frame renders the half-resolution masked pass and the sky pass reads it (per ray, by the gate). */
  private readonly maskedActive = uniform(1);
  private readonly maskedInvProjection = uniform(new Matrix4());
  private readonly maskedCameraWorld = uniform(new Matrix4());
  private maskedTarget?: RenderTarget;
  private maskedQuad?: QuadMesh;
  private maskedMaterial?: NodeMaterial;
  private readonly drawingSize = new Vector2();

  private radiusM = 6_371_000;
  private morphValue = 0;
  private anchorX = 0;
  private anchorY = 0;
  private altitudeM = 1000;
  private projection: BentProjection = 'equirect';
  private path: BentSkyPath = 'auto';
  private lastKey = '';
  private active = true;

  constructor(
    readonly model: AtmosphereGpuModel,
    private readonly steps = 32,
  ) {
    this.bent = new BentAtmosphere(model);
    this.skyView = new AtmosphereSkyViewLut(model, { bent: this.bent });
    this.passMaterial = this.buildPass();
    this.marchMaterial = this.buildMarchPass();
    this.pass = new Mesh(new PlaneGeometry(2, 2), this.passMaterial);
    this.pass.frustumCulled = false;
    this.pass.renderOrder = -1000;
    this.pass.name = 'BentAtmospherePass';

    const vertexCount = (this.lonSegments + 1) * (this.latSegments + 1);
    this.positions = new Float32Array(vertexCount * 3);
    this.mapXY = new Float32Array(vertexCount * 2);
    this.lonLat = new Float32Array(vertexCount * 2);
    const geometry = new BufferGeometry();
    this.positionAttribute = new BufferAttribute(this.positions, 3);
    geometry.setAttribute('position', this.positionAttribute);
    geometry.setAttribute('aMapXY', new BufferAttribute(this.mapXY, 2));
    geometry.setAttribute('aLonLat', new BufferAttribute(this.lonLat, 2));
    const index = new Uint32Array(this.lonSegments * this.latSegments * 6);
    let n = 0;
    const row = this.lonSegments + 1;
    for (let iy = 0; iy < this.latSegments; iy++) {
      for (let ix = 0; ix < this.lonSegments; ix++) {
        const a = iy * row + ix;
        index.set([a, a + 1, a + row, a + 1, a + row + 1, a + row], n);
        n += 6;
      }
    }
    geometry.setIndex(new BufferAttribute(index, 1));
    this.gridMaterial = this.buildGrid();
    this.grid = new Mesh(geometry, this.gridMaterial);
    this.grid.frustumCulled = false;
    this.grid.name = 'BentPlanetGrid';
    this.apply(true);
  }

  // -- state -------------------------------------------------------------------------------------

  get morph(): number {
    return this.morphValue;
  }

  /** 1 when the masked pass is rendered and read this frame, 0 when the table alone draws the sky. */
  get maskedShare(): number {
    return this.active ? 1 : 0;
  }

  get skyPath(): BentSkyPath {
    return this.path;
  }

  setSkyPath(path: BentSkyPath): void {
    this.path = path;
    this.pathMode.value = path === 'auto' ? 0 : path === 'table' ? 1 : 2;
    if (!this.probing) this.pass.material = path === 'march' ? this.marchMaterial : this.passMaterial;
  }

  /**
   * Check-only (the lab's image tests): swaps the sky pass for a probe that paints magenta wherever the sky pass's analytic
   * ground sphere is hit inside the map, and black elsewhere, so what is left magenta after the grid mesh has drawn is ground
   * the atmosphere expects and the mesh does not cover. A separate material, so the normal passes are untouched.
   */
  setCoverageProbe(on: boolean): void {
    this.probing = on;
    if (on) this.coverageMaterial ??= this.buildCoverageProbe();
    this.pass.material = on && this.coverageMaterial ? this.coverageMaterial : this.path === 'march' ? this.marchMaterial : this.passMaterial;
  }

  setProjection(projection: BentProjection): void {
    this.projection = projection;
    this.apply();
  }

  setPlanetRadius(metres: number): void {
    this.radiusM = metres;
    this.apply();
  }

  setMorph(morph: number): void {
    this.morphValue = Math.min(1, Math.max(0, morph));
    this.apply();
  }

  /** The camera's ground point, as fractions (-1..1) of the map's half-width and half-height. */
  setAnchor(fx: number, fy: number): void {
    this.anchorX = fx * Math.PI * this.radiusM;
    this.anchorY = fy * 0.5 * Math.PI * this.radiusM;
    this.apply();
  }

  setAltitude(metres: number): void {
    this.altitudeM = metres;
    this.altitude.value = metres;
  }

  setDayNight(mode: DayNightMode): void {
    this.bent.setDayNight(mode, 50, 135);
  }

  setSun(elevationDeg: number, azimuthDeg: number): void {
    this.bent.setSun(elevationDeg, azimuthDeg);
  }

  setMaskEnabled(on: boolean): void {
    this.bent.uMaskEnabled.value = on ? 1 : 0;
  }

  setVisible(on: boolean): void {
    this.pass.visible = on;
    this.grid.visible = on;
  }

  /**
   * Per-frame, outside any render pass: moves the clip planes with the altitude, refreshes the sky-view table when its
   * inputs changed, and renders the half-resolution masked pass when this frame's sky takes any of it.
   */
  update(renderer: WebGPURenderer | undefined, camera: Camera): void {
    const unit = this.radiusM / 1000;
    this.grid.position.set(0, -this.altitudeM / unit, 0);
    this.grid.updateMatrixWorld();
    if (camera instanceof PerspectiveCamera) {
      const altUnits = this.altitudeM / unit;
      const near = Math.min(1, Math.max(1e-4, altUnits * 0.05));
      if (Math.abs(camera.near - near) > near * 0.01 || camera.far !== 1e5) {
        camera.near = near;
        camera.far = 1e5;
        camera.updateProjectionMatrix();
      }
    }
    this.active = this.computeMaskedActive();
    this.maskedActive.value = this.active ? 1 : 0;
    if (!renderer?.initialized || this.path === 'march') return;
    if (this.altitudeM < this.model.uTopAltitude.value) this.skyView.update(renderer, this.altitudeM);
    if (this.active) this.renderMasked(renderer, camera);
  }

  /**
   * Whether this frame needs the masked pass. Above the air there is no table, so always. Inside it, only when a map edge
   * is within reach: farther from every open edge than `1.5 D` (`D`, the clear-air distance of a horizontal ray, where its
   * transmittance is about 1%) the air in between hides the edge, and the table is right. The per-ray gate in the shader
   * (`BentAtmosphere.skyGate`) then picks, ray by ray, how much of the pass is used, so nothing pops at this switch.
   */
  private computeMaskedActive(): boolean {
    if (this.path === 'march') return false;
    if (this.altitudeM >= this.model.uTopAltitude.value) return true;
    if (this.path === 'table') return false;
    const d = this.bent.mapEdgeDistance();
    if (!Number.isFinite(d)) return false;
    return d < 1.5 * this.bent.clearAirDistance(this.altitudeM);
  }

  // -- the grid mesh -------------------------------------------------------------------------------

  /** Rebuilds the grid when the shape changed (the key covers what the positions depend on). */
  private apply(force = false): void {
    this.bent.setShape({
      morph: this.morphValue,
      planetRadiusM: this.radiusM,
      anchorX: this.anchorX,
      anchorY: this.anchorY,
      projection: this.projection,
    });
    const key = `${this.morphValue}|${this.radiusM}|${this.anchorX}|${this.anchorY}|${this.projection}`;
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    const k = this.bent.k;
    const f = this.bent.anchorFrame;
    const unit = this.radiusM / 1000;
    const R = this.radiusM;
    const p = this.bent.uProjBlend.value;
    const row = this.lonSegments + 1;
    for (let iy = 0; iy <= this.latSegments; iy++) {
      const lat = -Math.PI / 2 + (Math.PI * iy) / this.latSegments;
      for (let ix = 0; ix <= this.lonSegments; ix++) {
        const lon = -Math.PI + (2 * Math.PI * ix) / this.lonSegments;
        const [x, y] = blendedProjection(lon, lat, p, R);
        const pos = bend(x, y, k).position;
        const dx = pos[0] - f.origin[0];
        const dy = pos[1] - f.origin[1];
        const dz = pos[2] - f.origin[2];
        const v = iy * row + ix;
        // The anchor's local frame: east, up, and south (-north).
        this.positions[v * 3] = (f.east[0] * dx + f.east[1] * dy + f.east[2] * dz) / unit;
        this.positions[v * 3 + 1] = (f.up[0] * dx + f.up[1] * dy + f.up[2] * dz) / unit;
        this.positions[v * 3 + 2] = -(f.north[0] * dx + f.north[1] * dy + f.north[2] * dz) / unit;
        this.mapXY[v * 2] = x;
        this.mapXY[v * 2 + 1] = y;
        this.lonLat[v * 2] = (lon * 180) / Math.PI;
        this.lonLat[v * 2 + 1] = (lat * 180) / Math.PI;
      }
    }
    this.positionAttribute.needsUpdate = true;
    (this.grid.geometry.getAttribute('aMapXY') as BufferAttribute).needsUpdate = true;
    (this.grid.geometry.getAttribute('aLonLat') as BufferAttribute).needsUpdate = true;
  }

  // -- the half-resolution masked pass ---------------------------------------------------------------

  private ensureMasked(): RenderTarget {
    if (this.maskedTarget) return this.maskedTarget;
    const target = new RenderTarget(1, 1, {
      count: 2,
      type: HalfFloatType,
      format: RGBAFormat,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
      depthBuffer: false,
      generateMipmaps: false,
    } as any);
    const bent = this.bent;
    const material = new NodeMaterial();
    const marched: any = Fn(() => {
      const radiance: any = vec3(0).toVar();
      const transmittance: any = vec3(1).toVar();
      const ndc: any = uv().mul(2).sub(1);
      const far: any = this.maskedInvProjection.mul(vec4(ndc, 1, 1));
      const dir = normalize(this.maskedCameraWorld.mul(vec4(far.xyz.div(far.w), 0)).xyz);
      const trace = bent.traceRay({ altitude: this.altitude, dir, maxDistance: float(1e30) });
      const gate = bent.skyGate(trace, dir);
      // Only the rays the sky pass will read: the rest keep the empty value and cost nothing.
      If(gate.weight.greaterThan(0.001), () => {
        const m = bent.march({ altitude: this.altitude, dir, sunDir: bent.uSunLocal, maxDistance: float(1e30), steps: this.steps });
        radiance.assign(m.radiance);
        transmittance.assign(m.transmittance);
      });
      return (mat3 as any)(radiance, transmittance, vec3(0));
    })().toVar();
    material.fragmentNode = (outputStruct as any)(vec4(marched[0], 1), vec4(marched[1], 1));
    this.maskedTarget = target;
    this.maskedMaterial = material;
    this.maskedQuad = new QuadMesh(material);
    return target;
  }

  private renderMasked(renderer: WebGPURenderer, camera: Camera): void {
    const target = this.ensureMasked();
    renderer.getDrawingBufferSize(this.drawingSize);
    const w = Math.max(8, Math.round(this.drawingSize.x * 0.5));
    const h = Math.max(8, Math.round(this.drawingSize.y * 0.5));
    if (target.width !== w || target.height !== h) {
      target.setSize(w, h);
      this.maskedSize.set(w, h);
    }
    camera.updateMatrixWorld();
    this.maskedInvProjection.value.copy((camera as PerspectiveCamera).projectionMatrixInverse);
    this.maskedCameraWorld.value.copy(camera.matrixWorld);
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    this.maskedQuad?.render(renderer);
    renderer.setRenderTarget(previous);
    this.maskedRenders++;
  }

  // -- shaders -------------------------------------------------------------------------------------

  private buildPass(): NodeMaterial {
    const bent = this.bent;
    const model = this.model;
    const material = new NodeMaterial();
    material.depthTest = false;
    material.depthWrite = false;
    material.transparent = false;
    material.vertexNode = vec4(positionLocal.xy, 0, 1);
    const farPoint = cameraProjectionMatrixInverse.mul(vec4(positionLocal.xy, 1, 1));
    const rayWorld = cameraWorldMatrix.mul(vec4(farPoint.xyz.div(farPoint.w), 0)).xyz;
    const rayVarying = varying(rayWorld, 'vBentRay');
    const screenVarying = varying(positionLocal.xy.mul(0.5).add(0.5), 'vBentUv');
    material.fragmentNode = Fn(() => {
      const dir = normalize(rayVarying);
      const radiance = vec3(0).toVar();
      const transmittance = vec3(1).toVar();
      const readTable = () => {
        const s = this.skyView.lookup(dir);
        radiance.assign(s.radiance);
        transmittance.assign(s.transmittance);
      };
      // The table alone while the masked pass is off (the camera is far from every open edge): no gate, no map maths.
      (If(this.maskedActive.lessThan(0.5), readTable) as any).Else(() => {
        const trace = bent.traceRay({ altitude: this.altitude, dir, maxDistance: float(1e30) });
        const gate = bent.skyGate(trace, dir);
        // A ray the ground mesh covers is not shaded here. Otherwise the table, and the masked pass by the gate's weight.
        If(gate.skip.not(), () => {
          const weight = gate.weight;
          (If(weight.lessThan(0.001), readTable) as any)
            .ElseIf(weight.greaterThan(0.999), () => {
              const target = this.ensureMasked();
              radiance.assign(texture(target.textures[0], screenVarying, 0).rgb);
              transmittance.assign(texture(target.textures[1], screenVarying, 0).rgb);
            })
            .Else(() => {
              const a = texture(this.ensureMasked().textures[0], screenVarying, 0).rgb;
              const b = texture(this.ensureMasked().textures[1], screenVarying, 0).rgb;
              const t = this.skyView.lookup(dir);
              radiance.assign(mix(t.radiance, a, weight));
              transmittance.assign(mix(t.transmittance, b, weight));
            });
        });
      });
      const colour = radiance.toVar();
      // The sun disc, seen through the air, unless the planet's sphere is in the way (only where the disc is).
      const angle = model.uSunAngularRadius;
      const disc = smoothstep(cos(angle), cos(angle.mul(0.97)), dot(dir, bent.uSunLocal));
      If(disc.greaterThan(0), () => {
        const hit = bent.traceRay({ altitude: this.altitude, dir, maxDistance: float(1e30) });
        If(hit.hitsGround.not(), () => {
          const sun = model.uSunIrradiance.div(angle.mul(angle).mul(Math.PI));
          colour.addAssign(transmittance.mul(sun).mul(disc));
        });
      });
      return vec4(max(colour.mul(this.exposure), 0), 1);
    })();
    return material;
  }

  /** The spike's pass: the masked march for every pixel at full resolution. Kept for the timings. */
  private buildMarchPass(): NodeMaterial {
    const bent = this.bent;
    const model = this.model;
    const material = new NodeMaterial();
    material.depthTest = false;
    material.depthWrite = false;
    material.transparent = false;
    material.vertexNode = vec4(positionLocal.xy, 0, 1);
    const farPoint = cameraProjectionMatrixInverse.mul(vec4(positionLocal.xy, 1, 1));
    const rayWorld = cameraWorldMatrix.mul(vec4(farPoint.xyz.div(farPoint.w), 0)).xyz;
    const rayVarying = varying(rayWorld, 'vBentMarchRay');
    material.fragmentNode = Fn(() => {
      const dir = normalize(rayVarying);
      const m = bent.march({ altitude: this.altitude, dir, sunDir: bent.uSunLocal, maxDistance: float(1e30), steps: this.steps });
      const colour = m.radiance.toVar();
      If((m.hitsGround as any).not(), () => {
        const angle = model.uSunAngularRadius;
        const mask = smoothstep(cos(angle), cos(angle.mul(0.97)), dot(dir, bent.uSunLocal));
        const sun = model.uSunIrradiance.div(angle.mul(angle).mul(Math.PI));
        colour.addAssign(m.transmittance.mul(sun).mul(mask));
      });
      return vec4(max(colour.mul(this.exposure), 0), 1);
    })();
    return material;
  }

  /**
   * The coverage probe: the sky pass's ground test (`BentAtmosphere.skyGate`) without the steepness limit, so every ray the
   * analytic sphere would end on inside the map is marked, grazing ones too. Sentinel magenta; everything else black.
   */
  private buildCoverageProbe(): NodeMaterial {
    const bent = this.bent;
    const material = new NodeMaterial();
    material.depthTest = false;
    material.depthWrite = false;
    material.transparent = false;
    material.vertexNode = vec4(positionLocal.xy, 0, 1);
    const farPoint = cameraProjectionMatrixInverse.mul(vec4(positionLocal.xy, 1, 1));
    const rayWorld = cameraWorldMatrix.mul(vec4(farPoint.xyz.div(farPoint.w), 0)).xyz;
    const rayVarying = varying(rayWorld, 'vBentProbeRay');
    material.fragmentNode = Fn(() => {
      const dir = normalize(rayVarying);
      const colour: any = vec3(0).toVar();
      const trace = bent.traceRay({ altitude: this.altitude, dir, maxDistance: float(1e30) });
      // Copies made at the top of this scope, as in `skyGate`: the first use below is inside an `If`.
      const h: any = max(trace.h, 0).toVar();
      const groundDistance: any = max(trace.groundDistance, -1e30).toVar();
      const hitsGround: any = select(trace.hitsGround, float(1), float(0)).toVar().greaterThan(0.5);
      If(hitsGround, () => {
        const ground: any = (vec3 as any)(0, h, 0).add(dir.mul(groundDistance));
        const { mx, my } = bent.mapCoords(ground);
        If(bent.mapMask(mx, my).greaterThan(0.5), () => colour.assign(vec3(1, 0, 1)));
      });
      return vec4(colour, 1);
    })();
    return material;
  }

  private buildGrid(): NodeMaterial {
    const bent = this.bent;
    const model = this.model;
    const material = new NodeMaterial();
    material.side = DoubleSide;
    material.fragmentNode = Fn(() => {
      const xy: any = attribute('aMapXY', 'vec2');
      const ll: any = attribute('aLonLat', 'vec2');
      const lonDeg = ll.x;
      const latDeg = ll.y;
      // A 10 degree checker (a filtered square wave per axis, so it fades to grey instead of aliasing), east and west
      // tinted differently, and a graticule line every 30 degrees, a pixel wide.
      const square = (cells: any): any => {
        const w = max(fwidth(cells), 1e-4);
        return clamp(sin(cells.mul(Math.PI)).div(w.mul(Math.PI)), -1, 1);
      };
      const parity = float(0.5).sub(square(lonDeg.div(10)).mul(square(latDeg.div(10))).mul(0.5));
      const tint = mix(vec3(0.55, 0.7, 1.0), vec3(1.0, 0.75, 0.55), smoothstep(float(-1), float(1), lonDeg));
      const base = mix(float(0.16), float(0.4), parity);
      const line = (deg: any): any => {
        const cells = deg.div(30);
        const distance = fract(cells.add(0.5)).sub(0.5).abs();
        const pixels = distance.div(max(fwidth(cells), 1e-6));
        return float(1).sub(smoothstep(float(0.5), float(1.5), pixels));
      };
      const albedo = base.mul(tint).mul(float(1).sub(max(line(lonDeg), line(latDeg)).mul(0.7)));

      const light = bent.groundLight(xy.x, xy.y);
      const ground = albedo.mul(light).mul(model.uSunIrradiance).div(Math.PI);
      return vec4(max(ground.mul(this.exposure), 0), 1);
    })();
    return material;
  }

  dispose(): void {
    this.pass.geometry.dispose();
    this.passMaterial.dispose();
    this.marchMaterial.dispose();
    this.coverageMaterial?.dispose();
    this.grid.geometry.dispose();
    this.gridMaterial.dispose();
    this.skyView.dispose();
    this.maskedTarget?.dispose();
    this.maskedMaterial?.dispose();
  }
}
