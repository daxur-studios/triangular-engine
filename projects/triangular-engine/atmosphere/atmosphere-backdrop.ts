import { Mesh, PlaneGeometry, Vector3 } from 'three';
import { NodeMaterial, type WebGPURenderer } from 'three/webgpu';
import {
  Fn,
  If,
  atan,
  cameraProjectionMatrixInverse,
  cameraWorldMatrix,
  cos,
  dot,
  float,
  floor,
  length,
  max,
  mod,
  normalize,
  positionLocal,
  smoothstep,
  uniform,
  varying,
  vec3,
  vec4,
} from 'three/tsl';
import { AtmosphereGpuModel } from './atmosphere-gpu-model';
import { AtmosphereSkyViewLut } from './atmosphere-sky-view';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface AtmosphereBackdropOptions {
  /** Samples along each view ray. Default {@link AtmosphereGpuModel.defaultSteps}. */
  steps?: number;
  /** A sky-view table to read the sky from (Plan 049, Phase 2c). Call {@link AtmosphereBackdrop.update} each frame. */
  skyView?: AtmosphereSkyViewLut;
}

/**
 * A full-screen sky plus an analytic ground sphere, drawn from the atmosphere model (Plan 049, Phase 2a).
 *
 * It does not use scene depth or any planet geometry: every pixel casts a ray from a camera that sits
 * `altitude` metres above the ground at the origin (the scene camera supplies only orientation and field
 * of view), then
 *
 * - marches the atmosphere (`AtmosphereGpuModel.march`),
 * - if the ray reaches the ground, shades an exact-sphere ground (a distance-faded checker, so haze with
 *   distance is easy to read) lit by the sun's transmittance and the sky irradiance, seen through the
 *   air in between,
 * - otherwise draws the sun disc, attenuated by the whole atmosphere.
 *
 * Going analytic avoids the two things a mesh cannot do at planet scale: a polyhedron sags hundreds of
 * metres below a true sphere at Earth size, and float32 vertex transforms jitter at 6,000 km.
 */
export class AtmosphereBackdrop {
  readonly mesh: Mesh;
  readonly material: NodeMaterial;
  /** Camera altitude above the ground, metres. */
  readonly altitude = uniform(2);
  /** Linear scale applied before tone mapping. Radiance is relative to the sun irradiance, so this is large. */
  readonly exposure = uniform(8);
  /** 1 draws the ground sphere, 0 draws sky only (rays that would hit the ground just show the air). */
  readonly groundEnabled = uniform(1);
  /** 0..1, how strongly the ground checker shows. */
  readonly checkerStrength = uniform(1);
  /** Multiplies the sun disc brightness; 0 hides it. */
  readonly sunDiscStrength = uniform(1);

  /** 1 reads the sky from the sky-view table (when one was given and the camera is inside the air), 0 marches every pixel. */
  readonly skyViewEnabled = uniform(1);
  readonly skyView?: AtmosphereSkyViewLut;

  constructor(
    readonly model: AtmosphereGpuModel,
    options: AtmosphereBackdropOptions = {},
  ) {
    const skyView = options.skyView;
    this.skyView = skyView;
    const material = new NodeMaterial();
    material.depthTest = false;
    material.depthWrite = false;
    material.transparent = false;

    // Clip-space quad; each corner's view-space ray is interpolated (linear in screen space, so exact).
    material.vertexNode = vec4(positionLocal.xy, 0, 1);
    const farPoint = cameraProjectionMatrixInverse.mul(vec4(positionLocal.xy, 1, 1));
    const rayWorld = cameraWorldMatrix.mul(vec4(farPoint.xyz.div(farPoint.w), 0)).xyz;
    const rayVarying = varying(rayWorld, 'vAtmosphereRay');

    material.fragmentNode = Fn(() => {
      const dir = normalize(rayVarying);
      const sunDir = model.sunDirection;
      const maxDistance = float(1e30);
      const trace = model.traceRay({ altitude: this.altitude, dir, maxDistance });

      // Scattering along the ray: one filtered fetch from the sky-view table when the camera is inside the
      // air and the table is on, otherwise the reference per-pixel march.
      const radiance = vec3(0).toVar();
      const transmittance = vec3(1).toVar();
      const marchInto = () => {
        const m = model.march({ altitude: this.altitude, dir, sunDir, maxDistance, steps: options.steps });
        radiance.assign(m.radiance);
        transmittance.assign(m.transmittance);
      };
      if (skyView) {
        const useTable: any = (this.skyViewEnabled.greaterThan(0.5) as any).and(
          this.altitude.lessThan(model.uTopAltitude),
        );
        If(useTable, () => {
          const s = skyView.lookup(dir);
          radiance.assign(s.radiance);
          transmittance.assign(s.transmittance);
        }).Else(marchInto);
      } else {
        marchInto();
      }
      const march = { transmittance, groundDistance: trace.groundDistance };
      const colour = radiance.toVar();

      const hitGround = trace.hitsGround.and(this.groundEnabled.greaterThan(0.5));
      If(hitGround, () => {
        const R = model.uRadius;
        const point = vec3(0, this.altitude, 0).add(dir.mul(march.groundDistance));
        const up = normalize(vec3(point.x, point.y.add(R), point.z));
        const albedo = this.groundAlbedo(up, march.groundDistance);
        const light = model.groundIrradiance(up);
        const ground = albedo.mul(light).mul(model.uSunIrradiance).div(Math.PI);
        colour.addAssign(march.transmittance.mul(ground));
      }).Else(() => {
        // Sun disc: radiance = irradiance / solid angle, seen through the whole atmosphere.
        const angle = model.uSunAngularRadius;
        const cosEdge = cos(angle);
        const cosInner = cos(angle.mul(0.97));
        const mask = smoothstep(cosEdge, cosInner, dot(dir, sunDir));
        const radiance = model.uSunIrradiance.div(angle.mul(angle).mul(Math.PI));
        colour.addAssign(march.transmittance.mul(radiance).mul(mask).mul(this.sunDiscStrength));
      });

      const exposed: any = max(colour.mul(this.exposure), 0);
      return vec4(exposed, 1);
    })();

    this.material = material;
    const mesh = new Mesh(new PlaneGeometry(2, 2), material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1000;
    mesh.name = 'AtmosphereBackdrop';
    this.mesh = mesh;
  }

  /**
   * Ground albedo at a unit direction `up` from the planet centre, and distance `dist` from the camera.
   * Azimuthal-equidistant coordinates around the spawn point keep checker cells roughly square out to
   * the horizon; each of three scales fades in and out with distance so none of them aliases.
   */
  private groundAlbedo(up: any, dist: any): any {
    const R = this.model.uRadius;
    const sinTheta = length(up.xz);
    const colatitude = atan(sinTheta, up.y);
    const flat = up.xz.mul(colatitude.div(max(sinTheta, 1e-9))).mul(R);
    const checker = (cell: any, near: any, far: any): any => {
      const q = flat.div(cell);
      const parity = mod(floor(q.x).add(floor(q.y)), 2);
      const fade = float(1).sub(smoothstep(cell.mul(near), cell.mul(far), dist));
      return parity.sub(0.5).mul(fade);
    };
    // Two cell sizes in absolute metres (near props, creatures), three relative to the planet.
    const c0 = checker(float(1), 40, 200);
    const c1 = checker(float(25), 40, 200);
    const c2 = checker(R.mul(2e-4), 40, 200);
    const c3 = checker(R.mul(1e-2), 40, 200);
    const c4 = checker(R.mul(1e-1), 40, 200);
    const pattern = c0
      .mul(0.2)
      .add(c1.mul(0.25))
      .add(c2.mul(0.25))
      .add(c3.mul(0.25))
      .add(c4.mul(0.2))
      .mul(this.checkerStrength);
    return this.model.uGroundAlbedo.mul(float(1).add(pattern));
  }

  setAltitude(metres: number): void {
    this.altitude.value = Math.max(0, metres);
  }

  /**
   * Per-frame work that must happen outside a render pass: refreshes the sky-view table if the altitude or
   * the sun moved past its tolerance. Call from the frame tick, before the scene renders. Returns true when
   * the table was re-rendered.
   */
  update(renderer: WebGPURenderer): boolean {
    if (!this.skyView || this.skyViewEnabled.value < 0.5) return false;
    return this.skyView.update(renderer, this.altitude.value);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/** Unit vector for a sun placed by elevation and azimuth (degrees) in the backdrop's local frame (y up). */
export function sunDirectionFromAngles(elevationDeg: number, azimuthDeg: number, out = new Vector3()): Vector3 {
  const e = (elevationDeg * Math.PI) / 180;
  const a = (azimuthDeg * Math.PI) / 180;
  return out.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
}
