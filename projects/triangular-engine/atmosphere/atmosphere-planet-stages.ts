import { Matrix3, Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { Fn, If, abs, cameraProjectionMatrix, cross, dot, float, max, min, mix, normalize, positionView, select, uniform, vec3, vec4 } from 'three/tsl';
import { AtmosphereAerialPerspectiveLut, type AtmosphereAerialPerspectiveOptions } from './atmosphere-aerial-perspective';
import type { AtmosphereBackdrop } from './atmosphere-backdrop';
import type { AtmosphereGpuModel } from './atmosphere-gpu-model';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The part of the planet material's context the stages read. Structural, so this entry point does not import
 * `triangular-engine/planet-material`; its `IPlanetContext` satisfies it.
 */
export interface IAtmospherePlanetContext {
  /** Sphere-space unit direction of the surface point (the planet's body frame). */
  readonly sphereNormal: any;
  /** Distance from the camera to the fragment, in world units. */
  readonly cameraDistance: any;
}

/** Same shape as the planet material's `LightingStage` input. */
export interface IAtmosphereLightingInput {
  readonly color: any;
  readonly sunVisibility: any;
  readonly surface: { readonly albedo: any };
  readonly emissive?: any;
}

export interface PlanetAtmosphereBindingOptions {
  /** The planet's radius in the units of its mesh (the globe's `SphereGeometry` radius). */
  radiusUnits: number;
  /** Samples along each camera-to-surface ray in {@link PlanetAtmosphereBinding.perspective}. Default the model's. */
  steps?: number;
  /**
   * Read the haze on the surface from a froxel table instead of marching a ray per fragment (Plan 049, Phase 3).
   * `true` for the defaults. Needs {@link PlanetAtmosphereBinding.update} called every frame after `sync`.
   */
  aerialPerspective?: boolean | AtmosphereAerialPerspectiveOptions;
}

/**
 * Everything the planet material's atmosphere stages need that changes per frame, and the one place that
 * turns the planet's world transform and the camera into the atmosphere's inputs (Plan 049, Phase 2b).
 *
 * The planet sits anywhere, rotated any way; the stages work in its body frame. Call {@link sync} once per frame
 * before rendering. The atmosphere's lengths are metres (the profile's radius), the mesh's are world units:
 * `metersPerUnit = profile radius / radiusUnits`. The camera altitude is computed here in float64 and uploaded as a
 * number (see the model's "Precision" note); the camera's body-frame position is a float32 uniform, which is exact
 * to about a metre at Earth scale.
 */
export class PlanetAtmosphereBinding {
  /** Linear scale applied to radiance before tone mapping. Shared with the backdrop by {@link sync}. */
  readonly exposure = uniform(8);
  /** Unit direction to the sun in the planet's body frame. */
  readonly sunBody = uniform(new Vector3(0, 0, 1));
  /** Camera position in the body frame, metres. */
  readonly cameraBody = uniform(new Vector3(0, 0, 0));
  /** Camera altitude above the ground, metres. */
  readonly cameraAltitude = uniform(0);
  /**
   * How far the planet has unrolled into its flat map, 0 (globe) to 1 (map). The page sets it with the morph. The
   * haze of a surface point blends from the spherical model to a flat slab by it ({@link perspective}).
   */
  readonly morph = uniform(0);
  /**
   * 0..1, how much of the sun reaches the planet (an eclipse, a cloud deck). It scales the air's in-scattering, the sky
   * light on surfaces and, via `sync` with a backdrop, the sky and sun disc. Surfaces also multiply their own
   * `sunVisibility` into the direct light.
   */
  readonly sunVisibility = uniform(1);
  /** Body frame to view space (the planet's rotation, then the camera's inverse), for the slab's up and sun. */
  readonly bodyToView = uniform(new Matrix3());
  /** Metres per world unit of the planet mesh. */
  readonly metersPerUnit = uniform(1);

  /** The froxel table behind {@link perspective}, when the binding was made with `aerialPerspective`. */
  readonly aerialPerspective?: AtmosphereAerialPerspectiveLut;

  private readonly steps?: number;
  private radiusUnits: number;

  private readonly camWorld = new Vector3();
  private readonly camBody = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly sunWorld = new Vector3();
  private readonly ex = new Vector3();
  private readonly ey = new Vector3();
  private readonly ez = new Vector3();
  private readonly ref = new Vector3();
  private readonly frameMatrix = new Matrix3();
  private readonly cameraRotation = new Matrix3();
  private readonly viewToLocal = new Matrix3();
  private readonly worldToView = new Matrix3();
  private readonly bodyRotation = new Matrix4();
  private readonly bodyRotation3 = new Matrix3();
  private readonly sunLocal = new Vector3();
  private readonly projectionInverse = new Matrix4();

  constructor(
    readonly model: AtmosphereGpuModel,
    options: PlanetAtmosphereBindingOptions,
  ) {
    this.radiusUnits = options.radiusUnits;
    this.steps = options.steps;
    this.metersPerUnit.value = model.profile.planetRadiusM / options.radiusUnits;
    if (options.aerialPerspective) {
      this.aerialPerspective = new AtmosphereAerialPerspectiveLut(
        model,
        { steps: options.steps, ...(options.aerialPerspective === true ? {} : options.aerialPerspective) },
      );
    }
  }

  /** The sun's direction in the body frame; normalised. */
  setSunBody(x: number, y: number, z: number): void {
    this.sunBody.value.set(x, y, z).normalize();
  }

  /** Call after the profile changes size (the planet's radius in metres). */
  refreshScale(): void {
    this.metersPerUnit.value = this.model.profile.planetRadiusM / this.radiusUnits;
  }

  /**
   * Reads the camera and the planet's transform. With a `backdrop`, also points its local frame at the camera's
   * radial direction and gives the model the sun in that frame, so the sky behind the planet matches.
   */
  sync(camera: Object3D, planet: Object3D, backdrop?: AtmosphereBackdrop): void {
    camera.updateMatrixWorld();
    planet.updateMatrixWorld();
    this.camWorld.setFromMatrixPosition(camera.matrixWorld);
    this.camBody.copy(this.camWorld);
    planet.worldToLocal(this.camBody);

    const mpu = this.metersPerUnit.value;
    this.camBody.multiplyScalar(mpu);
    this.cameraBody.value.copy(this.camBody);
    const altitude = Math.max(0, this.camBody.length() - this.model.profile.planetRadiusM);
    this.cameraAltitude.value = altitude;

    // Local frame in world axes: y = the camera's radial direction, x and z any orthonormal pair.
    planet.getWorldQuaternion(this.quaternion);
    this.ey.copy(this.camBody).normalize().applyQuaternion(this.quaternion);
    if (this.ey.lengthSq() < 0.5) this.ey.set(0, 1, 0);
    this.ref.set(0, 1, 0);
    if (Math.abs(this.ey.y) > 0.99) this.ref.set(1, 0, 0);
    this.ex.crossVectors(this.ref, this.ey).normalize();
    this.ez.crossVectors(this.ex, this.ey);
    this.frameMatrix.set(
      this.ex.x, this.ex.y, this.ex.z,
      this.ey.x, this.ey.y, this.ey.z,
      this.ez.x, this.ez.y, this.ez.z,
    );
    this.sunWorld.copy(this.sunBody.value).applyQuaternion(this.quaternion);
    this.sunLocal.set(this.sunWorld.dot(this.ex), this.sunWorld.dot(this.ey), this.sunWorld.dot(this.ez));

    // View space to the local frame, for the froxel table.
    this.cameraRotation.setFromMatrix4(camera.matrixWorld);
    this.worldToView.copy(this.cameraRotation).transpose();
    this.bodyRotation.makeRotationFromQuaternion(this.quaternion);
    this.bodyRotation3.setFromMatrix4(this.bodyRotation);
    this.bodyToView.value.copy(this.worldToView).multiply(this.bodyRotation3);
    this.viewToLocal.copy(this.frameMatrix).multiply(this.cameraRotation);
    const projectionInverse = (camera as { projectionMatrixInverse?: Matrix4 }).projectionMatrixInverse;
    if (projectionInverse) this.projectionInverse.copy(projectionInverse);

    if (!backdrop) return;
    backdrop.exposure.value = this.exposure.value;
    backdrop.sunVisibility.value = this.sunVisibility.value as number;
    backdrop.setAltitude(altitude);
    backdrop.frame.value.copy(this.frameMatrix);
    this.model.setSunDirection(this.sunLocal.x, this.sunLocal.y, this.sunLocal.z);
  }

  /**
   * Renders the froxel table if the camera, the sun or the profile moved. Call once per frame after {@link sync},
   * outside a render pass (the same place as the backdrop's `update`). Returns true when it rendered; does nothing
   * without `aerialPerspective`.
   */
  update(renderer: WebGPURenderer): boolean {
    return (
      this.aerialPerspective?.update(renderer, {
        altitude: this.cameraAltitude.value as number,
        projectionInverse: this.projectionInverse,
        viewToLocal: this.viewToLocal,
        sunLocal: this.sunLocal,
      }) ?? false
    );
  }

  dispose(): void {
    this.aerialPerspective?.dispose();
  }

  /**
   * Stage 4 of the planet material: the surface relit from the atmosphere. `albedo x (sunT x N.L x sunVisibility +
   * skyIrradiance) x sunIrradiance / pi x exposure`, with the sun and the sky read at the ground for the point's own
   * sun angle (so it varies across the terminator and across a flat map). Replaces the PBR result, so the
   * scene's other lights and normal maps do not reach it; the emissive stack is added back.
   */
  lighting(): (context: IAtmospherePlanetContext, input: IAtmosphereLightingInput) => any {
    const { model } = this;
    return (context, { sunVisibility, surface, emissive }) => {
      const up = normalize(context.sphereNormal);
      const muSun = dot(up, this.sunBody);
      const sunT = model.sunTransmittance(float(0), model.uRadius, muSun);
      const direct = sunT.mul(max(muSun, 0)).mul(sunVisibility);
      const sky = model.skyIrradiance(float(0), muSun);
      const lit = surface.albedo.mul(direct.add(sky.mul(this.sunVisibility))).mul(model.uSunIrradiance).div(Math.PI).mul(this.exposure);
      return emissive ? lit.add(emissive) : lit;
    };
  }

  /**
   * Stage 6 of the planet material: aerial perspective. The colour is attenuated along the ray from the camera to
   * the surface point and the air's in-scattering on that ray is added (`colour x T + L x exposure`). With
   * `aerialPerspective` it is one lookup in the froxel table at the fragment's screen position and distance, so
   * terrain height is included. Without it, one march per fragment on the sphere of the planet's radius (terrain
   * height and the mid-morph flat map are not modelled).
   */
  perspective(): (context: IAtmospherePlanetContext, color: any) => any {
    const spherical = this.sphericalPerspective();
    return (context, color) =>
      Fn(() => {
        const out: any = spherical(context, color).toVar();
        // The flat slab only costs anything while the planet is unrolling.
        If(this.morph.greaterThan(0.001), () => {
          out.assign(mix(out, this.slabPerspective(context, color), this.morph));
        });
        return out;
      })();
  }

  /**
   * The haze on a flat map (and, blended by {@link morph}, between globe and map): the surface point's own plane is
   * the ground, the camera's height above it and the distance to it give the slab's columns, and the sun is read at
   * the point's own sun angle. See {@link AtmosphereGpuModel.slab}.
   */
  private slabPerspective(context: IAtmospherePlanetContext, color: any): any {
    const up = normalize((mix as any)(normalize(context.sphereNormal), vec3(0, 0, 1), this.morph));
    const upView = normalize((this.bodyToView as any).mul(up));
    const toCamera = positionView.negate();
    const mpu = this.metersPerUnit;
    const dirView = normalize(positionView);
    const sunView = normalize((this.bodyToView as any).mul(this.sunBody));
    const distance = context.cameraDistance.mul(mpu);
    // Half-way through the unroll the surface is neither a sphere nor a plane, and a ray that grazes the blended plane would
    // count thousands of kilometres of dense air (everything goes white). Floor the ray's elevation (0.15, an airmass of about 7),
    // ramped in over the first third of the morph; on the flat map the same floor stops a low view from counting the
    // whole map as air. The globe (morph 0) is untouched.
    const elevationFloor = min(this.morph.mul(3), 1).mul(0.15);
    const haze = this.model.slab({
      distance,
      cameraHeight: max(dot(toCamera, upView).mul(mpu), distance.mul(elevationFloor)),
      cosNu: dot(dirView, sunView),
      muSun: dot(normalize(context.sphereNormal), this.sunBody),
    });
    return color.mul(haze.transmittance).add(haze.radiance.mul(this.exposure).mul(this.sunVisibility));
  }

  private sphericalPerspective(): (context: IAtmospherePlanetContext, color: any) => any {
    const { model } = this;
    const table = this.aerialPerspective;
    if (table) {
      return (context, color) =>
        Fn(() => {
          const clip = cameraProjectionMatrix.mul(vec4(positionView, 1));
          const ndc = clip.xy.div(clip.w);
          const haze = table.lookup(ndc, context.cameraDistance.mul(this.metersPerUnit), normalize(positionView));
          return color.mul(haze.transmittance).add(haze.radiance.mul(this.exposure).mul(this.sunVisibility));
        })();
    }
    return (context, color) =>
      Fn(() => {
        // Frame with y along the camera's radial direction; any orthonormal x and z do.
        const up = normalize(this.cameraBody);
        const ref = select(abs(up.y).lessThan(0.99), vec3(0, 1, 0), vec3(1, 0, 0));
        const ex = normalize(cross(ref, up));
        const ez = cross(ex, up);
        const toLocal = (v: any) => vec3(dot(v, ex), dot(v, up), dot(v, ez));

        const surfacePoint = context.sphereNormal.mul(model.uRadius);
        const dirBody = normalize(surfacePoint.sub(this.cameraBody));
        const distance = context.cameraDistance.mul(this.metersPerUnit);
        const m = model.march({
          altitude: this.cameraAltitude,
          dir: toLocal(dirBody),
          sunDir: toLocal(this.sunBody),
          maxDistance: distance,
          steps: this.steps,
        });
        return color.mul(m.transmittance).add(m.radiance.mul(this.exposure).mul(this.sunVisibility));
      })();
  }
}
