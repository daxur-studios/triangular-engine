import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, PerspectiveCamera, PlaneGeometry, type Camera } from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Fn,
  If,
  attribute,
  cameraProjectionMatrixInverse,
  cameraWorldMatrix,
  cos,
  dot,
  floor,
  float,
  fract,
  length,
  max,
  mix,
  mod,
  normalize,
  positionLocal,
  positionWorld,
  smoothstep,
  uniform,
  varying,
  vec3,
  vec4,
} from 'three/tsl';
import { AtmosphereGpuModel, BentAtmosphere, bend, type DayNightMode } from 'triangular-engine/atmosphere';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Plan 049 Phase 3a: the bent planet in `/atmosphere-lab`. No planet material, no terrain.
 *
 * - A longitude/latitude grid mesh, rebuilt on the CPU with `bend()` whenever the morph (or the camera's anchor) changes.
 *   Its fragments are coloured by checker and graticule from their map coordinates, lit from the tables, and hazed by a
 *   short march from the camera to the fragment.
 * - A full-screen pass that marches the bent atmosphere (radius 1 / k, map mask, day/night) for every pixel.
 *
 * The world is the camera's local frame (y up, camera at the origin, the anchor's ground point `altitude` below it),
 * in units of `planetRadius / 1000` metres so the planet is 1000 units across at every size.
 */
export class BentPlanetLab {
  readonly bent: BentAtmosphere;
  readonly pass: Mesh;
  readonly grid: Mesh;
  readonly exposure = uniform(8);
  readonly altitude = uniform(1000);
  private readonly unitM = uniform(1);
  private readonly passMaterial: NodeMaterial;
  private readonly gridMaterial: NodeMaterial;
  private readonly lonSegments = 360;
  private readonly latSegments = 180;
  private readonly positions: Float32Array;
  private readonly mapXY: Float32Array;
  private readonly positionAttribute: BufferAttribute;

  private radiusM = 6_371_000;
  private morphValue = 0;
  private anchorX = 0;
  private anchorY = 0;
  private altitudeM = 1000;
  private lastKey = '';

  constructor(
    readonly model: AtmosphereGpuModel,
    private readonly steps = 32,
  ) {
    this.bent = new BentAtmosphere(model);
    this.passMaterial = this.buildPass();
    this.pass = new Mesh(new PlaneGeometry(2, 2), this.passMaterial);
    this.pass.frustumCulled = false;
    this.pass.renderOrder = -1000;
    this.pass.name = 'BentAtmospherePass';

    const vertexCount = (this.lonSegments + 1) * (this.latSegments + 1);
    this.positions = new Float32Array(vertexCount * 3);
    this.mapXY = new Float32Array(vertexCount * 2);
    const geometry = new BufferGeometry();
    this.positionAttribute = new BufferAttribute(this.positions, 3);
    geometry.setAttribute('position', this.positionAttribute);
    geometry.setAttribute('aMapXY', new BufferAttribute(this.mapXY, 2));
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

  /** Per-frame: the grid hangs `altitude` below the camera, and the clip planes follow the altitude. */
  update(camera: Camera): void {
    const unit = this.radiusM / 1000;
    this.unitM.value = unit;
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
  }

  // -- the grid mesh -------------------------------------------------------------------------------

  /** Rebuilds the grid when the shape changed (the key covers what the positions depend on). */
  private apply(force = false): void {
    this.bent.setShape({ morph: this.morphValue, planetRadiusM: this.radiusM, anchorX: this.anchorX, anchorY: this.anchorY });
    const key = `${this.morphValue}|${this.radiusM}|${this.anchorX}|${this.anchorY}`;
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    const k = this.bent.k;
    const f = this.bent.anchorFrame;
    const unit = this.radiusM / 1000;
    const R = this.radiusM;
    const row = this.lonSegments + 1;
    for (let iy = 0; iy <= this.latSegments; iy++) {
      const lat = -Math.PI / 2 + (Math.PI * iy) / this.latSegments;
      for (let ix = 0; ix <= this.lonSegments; ix++) {
        const lon = -Math.PI + (2 * Math.PI * ix) / this.lonSegments;
        const x = R * lon;
        const y = R * lat;
        const p = bend(x, y, k).position;
        const dx = p[0] - f.origin[0];
        const dy = p[1] - f.origin[1];
        const dz = p[2] - f.origin[2];
        const v = iy * row + ix;
        // The anchor's local frame: east, up, and south (-north).
        this.positions[v * 3] = (f.east[0] * dx + f.east[1] * dy + f.east[2] * dz) / unit;
        this.positions[v * 3 + 1] = (f.up[0] * dx + f.up[1] * dy + f.up[2] * dz) / unit;
        this.positions[v * 3 + 2] = -(f.north[0] * dx + f.north[1] * dy + f.north[2] * dz) / unit;
        this.mapXY[v * 2] = x;
        this.mapXY[v * 2 + 1] = y;
      }
    }
    this.positionAttribute.needsUpdate = true;
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
    material.fragmentNode = Fn(() => {
      const dir = normalize(rayVarying);
      const m = bent.march({
        altitude: this.altitude,
        dir,
        sunDir: bent.uSunLocal,
        maxDistance: float(1e30),
        steps: this.steps,
      });
      const colour = m.radiance.toVar();
      // The sun disc, seen through the whole air, unless the planet's sphere is in the way.
      If((m.hitsGround as any).not(), () => {
        const angle = model.uSunAngularRadius;
        const mask = smoothstep(cos(angle), cos(angle.mul(0.97)), dot(dir, bent.uSunLocal));
        const radiance = model.uSunIrradiance.div(angle.mul(angle).mul(Math.PI));
        colour.addAssign(m.transmittance.mul(radiance).mul(mask));
      });
      return vec4(max(colour.mul(this.exposure), 0), 1);
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
      const lonDeg = xy.x.div(bent.uRefRadius).mul(180 / Math.PI);
      const latDeg = xy.y.div(bent.uRefRadius).mul(180 / Math.PI);
      // 10 degree checker, east and west tinted differently, a graticule line every 30 degrees.
      const parity = mod(floor(lonDeg.div(10)).add(floor(latDeg.div(10))), 2);
      const tint = mix(vec3(0.55, 0.7, 1.0), vec3(1.0, 0.75, 0.55), smoothstep(float(-1), float(1), lonDeg));
      const base = mix(float(0.16), float(0.4), parity);
      const lineLon = float(1).sub(smoothstep(float(0), float(0.35), fract(lonDeg.div(30).add(0.5)).sub(0.5).abs().mul(30)));
      const lineLat = float(1).sub(smoothstep(float(0), float(0.35), fract(latDeg.div(30).add(0.5)).sub(0.5).abs().mul(30)));
      const albedo = base.mul(tint).mul(float(1).sub(max(lineLon, lineLat).mul(0.7)));

      const light = bent.groundLight(xy.x, xy.y);
      const ground = albedo.mul(light).mul(model.uSunIrradiance).div(Math.PI);

      // The air between the camera and this fragment.
      const toFragment = positionWorld;
      const distanceM = length(toFragment).mul(this.unitM);
      const m = bent.march({
        altitude: this.altitude,
        dir: normalize(toFragment),
        sunDir: bent.uSunLocal,
        maxDistance: distanceM,
        steps: Math.max(8, Math.floor(this.steps / 2)),
      });
      const colour = ground.mul(m.transmittance).add(m.radiance);
      return vec4(max(colour.mul(this.exposure), 0), 1);
    })();
    return material;
  }

  dispose(): void {
    this.pass.geometry.dispose();
    this.passMaterial.dispose();
    this.grid.geometry.dispose();
    this.gridMaterial.dispose();
  }
}
