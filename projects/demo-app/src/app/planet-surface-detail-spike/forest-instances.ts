import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { float, instancedBufferAttribute, normalWorld, normalize, positionView, positionWorld, smoothstep, uniform, vec3 } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PlanetAtmosphereBinding } from 'triangular-engine/atmosphere';
import { FOREST_CROWN_WIDTH_M, FOREST_TREE_HEIGHT_M, TREE_SEED, TREE_TONE_SALT, cellHash } from './forest-field';
import { BUILDING_SINK_M } from './building-field';
import { CROWN_NORMAL_LEAN, treeTone } from './forest-shading';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A placeholder conifer: a cone crown on a short trunk, `FOREST_TREE_HEIGHT_M` tall and `FOREST_CROWN_WIDTH_M` wide. */
export function treeGeometry(): BufferGeometry {
  const trunkHeight = FOREST_TREE_HEIGHT_M * 0.2;
  const crownHeight = FOREST_TREE_HEIGHT_M - trunkHeight * 0.6;
  const trunk = new CylinderGeometry(0.35, 0.5, trunkHeight, 4, 1, true);
  trunk.translate(0, trunkHeight / 2, 0);
  const crown = new ConeGeometry(FOREST_CROWN_WIDTH_M / 2, crownHeight, 6, 1, true);
  crown.translate(0, trunkHeight * 0.6 + crownHeight / 2, 0);
  const parts = [trunk.toNonIndexed(), crown.toNonIndexed()];
  // Positions and normals only: the colour is one flat albedo lit by the planet stages.
  for (const part of parts) part.deleteAttribute('uv');
  return mergeGeometries(parts);
}

/** A placeholder boulder: a faceted lump one metre across, sunk a little into the ground. Scaled 1 to 3 per instance (the rock layer's size range). */
export function rockGeometry(): BufferGeometry {
  const lump = new IcosahedronGeometry(0.5, 1).toNonIndexed();
  lump.scale(1, 0.62, 0.85);
  lump.translate(0, 0.12, 0);
  lump.deleteAttribute('uv');
  return lump;
}

/** A placeholder building: a unit box standing on its base, scaled per instance to its footprint and height. */
export function buildingGeometry(): BufferGeometry {
  const box = new BoxGeometry(1, 1, 1).toNonIndexed();
  box.translate(0, 0.5, 0);
  box.deleteAttribute('uv');
  return box;
}

/**
 * What {@link SurfaceInstances.setInstances} places: the library's `IScatterPlanetLatticeResult` (trees and rocks) or a
 * list built the same way (the buildings, see `buildingBatch`). Offsets are from `originM`; yaw and scale are the
 * lattice's draws.
 */
export interface IInstanceBatch {
  readonly originM: readonly [number, number, number];
  readonly offsetsM: Float32Array;
  readonly yaw01: Float32Array;
  readonly scale: Float32Array;
  /** Lattice cell (ix, iy, iz) of each instance, for per-instance draws such as the tree tone. */
  readonly cells?: Int32Array;
  /** Non-uniform size (x, y, z metres) per instance, overriding `scale`. */
  readonly sizesM?: Float32Array;
  /** Colour multiplier (r, g, b) per instance, overriding the shape's {@link IInstanceShape.tone}. */
  readonly tones?: Float32Array;
}

/** How a class sits on the ground and is toned; its yaw and size come from the batch. */
export interface IInstanceShape {
  /** Ground lift, metres along the local up (negative sinks it). */
  readonly liftM: number;
  /** Colour multiplier of instance `i` of a batch; default 1. */
  tone?(batch: IInstanceBatch, i: number): readonly [number, number, number];
}

/** Trees: the per-tree tone the forest layer also draws (`treeTone` of the cell's tone draw). */
export const TREE_SHAPE: IInstanceShape = {
  liftM: 0,
  tone: (batch, i) => {
    const c = batch.cells;
    return c ? treeTone(cellHash(c[i * 3], c[i * 3 + 1], c[i * 3 + 2], TREE_SEED * 8 + TREE_TONE_SALT)) : [1, 1, 1];
  },
};
export const ROCK_SHAPE: IInstanceShape = { liftM: -0.1 };
/** Buildings: sunk `BUILDING_SINK_M` into the ground; size, tone and the runway-aligned yaw come from `buildingBatch`. */
export const BUILDING_SHAPE: IInstanceShape = { liftM: -BUILDING_SINK_M };

export interface ISurfaceInstancesConfig {
  readonly geometry: BufferGeometry;
  readonly shape: IInstanceShape;
  readonly capacity: number;
  /** Colour of one instance, a node shared with the far form so both read the same albedo. */
  readonly albedo: any;
  /** Opacity at a camera distance (node): 1 near, 0 once the far form has taken over. */
  opacity(distance: any): any;
  /** How far from the window centre (metres) an instance can be before it is dissolved out: the window's own edge. */
  readonly windowRadiusM: number;
  /** Width of the dissolve inside that edge, metres. */
  readonly windowFadeM: number;
  /**
   * Share of the face normal in the lighting normal, the rest the radial up: `CROWN_NORMAL_LEAN` by default (a crown
   * lit like the forest layer's dome), 1 for flat faces such as walls.
   */
  readonly normalLean?: number;
  /**
   * Turns the instance's local x axis to this tangent (the runway's `along`) instead of a free yaw, so boxes line up
   * with the frame their far form is drawn in.
   */
  alignTo?(): readonly number[] | undefined;
}

/**
 * One class of the near form: an `InstancedMesh` placed from the library's `scatterPlanetLattice`. The material runs the planet's own
 * lighting and aerial perspective (`binding.lighting()` and `binding.perspective()`, the stages the surface material
 * gets) on the albedo the far form uses, and dissolves with an alpha hash as the far form dissolves in.
 *
 * Two dissolves multiply: the class's distance band, and the window's edge. A window is only ever as big as the band
 * needs, but it recentres in steps and a camera can outrun a request; the edge dissolve makes the shortfall a fade
 * instead of a cut.
 */
export class SurfaceInstances {
  readonly mesh: InstancedMesh;
  private readonly material: MeshBasicNodeMaterial;
  private readonly ground = new Vector3();
  private readonly windowCentreScene: any = uniform(new Vector3());
  private readonly windowRadius: any;
  private readonly tones: InstancedBufferAttribute;
  private count = 0;

  /** `bodyCentreScene` is the surface material's `morph.uBodyCentreScene` uniform node: the planet's centre in scene space. */
  constructor(
    private readonly config: ISurfaceInstancesConfig,
    binding: PlanetAtmosphereBinding,
    private readonly bodyCentreScene: any,
  ) {
    this.windowRadius = uniform(config.windowRadiusM);
    this.material = new MeshBasicNodeMaterial();
    const radial: any = normalize(positionWorld.sub(bodyCentreScene));
    // A pure up-vector would light every instance like the ground; lean on the face normal so a crown has a sunny side.
    const lean = config.normalLean ?? CROWN_NORMAL_LEAN;
    const shading: any = normalize(radial.mul(1 - lean).add(normalize(normalWorld).mul(lean)));
    const context = { sphereNormal: shading, radialDirection: radial, cameraDistance: positionView.length() };
    // Per-instance tone, the same draw the far form reads, times the class albedo.
    this.tones = new InstancedBufferAttribute(new Float32Array(config.capacity * 3).fill(1), 3);
    const albedo: any = vec3(config.albedo).mul(instancedBufferAttribute(this.tones, 'vec3'));
    const lit = binding.lighting()(context, { color: albedo, sunVisibility: float(1), surface: { albedo }, emissive: null });
    this.material.colorNode = binding.perspective()(context, lit);
    this.material.alphaHash = true;
    const edge: any = float(1).sub(smoothstep(this.windowRadius.sub(config.windowFadeM), this.windowRadius, positionWorld.sub(this.windowCentreScene).length()));
    this.material.opacityNode = config.opacity(positionView.length()).mul(edge);

    this.mesh = new InstancedMesh(config.geometry, this.material, config.capacity);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  get instanceCount(): number {
    return this.count;
  }

  /** Radius of the window the dissolve is measured against; set it to the radius that was requested. */
  setWindowRadius(radiusM: number): void {
    this.windowRadius.value = radiusM;
  }

  /**
   * Places the scatter. The instances are offsets from the result's `originM`, the body-fixed point under the
   * scatter's centre at height 0 (metres), so they stay small in float32.
   */
  setInstances(scatter: IInstanceBatch): void {
    this.ground.set(scatter.originM[0], scatter.originM[1], scatter.originM[2]);
    const shape = this.config.shape;
    const n = Math.min(scatter.scale.length, this.mesh.instanceMatrix.count);
    const align = this.config.alignTo?.();
    const tangent = new Vector3();
    const side = new Vector3();
    const matrix = new Matrix4();
    const quaternion = new Quaternion();
    const yaw = new Quaternion();
    const up = new Vector3();
    const position = new Vector3();
    const scale = new Vector3();
    const y = new Vector3(0, 1, 0);
    for (let i = 0; i < n; i += 1) {
      position.set(scatter.offsetsM[i * 3], scatter.offsetsM[i * 3 + 1], scatter.offsetsM[i * 3 + 2]);
      up.copy(position).add(this.ground).normalize();
      // Lift along the local up, so a rock sinks into the slope instead of the datum.
      position.addScaledVector(up, shape.liftM);
      if (align) {
        tangent.set(align[0], align[1], align[2]);
        tangent.addScaledVector(up, -up.dot(tangent)).normalize();
        side.crossVectors(tangent, up);
        quaternion.setFromRotationMatrix(matrix.makeBasis(tangent, up, side));
      } else quaternion.setFromUnitVectors(y, up);
      yaw.setFromAxisAngle(y, scatter.yaw01[i] * Math.PI * 2);
      quaternion.multiply(yaw);
      if (scatter.sizesM) scale.set(scatter.sizesM[i * 3], scatter.sizesM[i * 3 + 1], scatter.sizesM[i * 3 + 2]);
      else {
        const s = scatter.scale[i];
        scale.set(s, s, s);
      }
      matrix.compose(position, quaternion, scale);
      this.mesh.setMatrixAt(i, matrix);
      const tone = scatter.tones ? ([scatter.tones[i * 3], scatter.tones[i * 3 + 1], scatter.tones[i * 3 + 2]] as const) : (shape.tone?.(scatter, i) ?? [1, 1, 1]);
      this.tones.setXYZ(i, tone[0], tone[1], tone[2]);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.tones.needsUpdate = true;
    this.count = n;
  }

  /** Follows the floating origin: the mesh sits at the body centre plus the scatter's ground point. Call every frame. */
  update(): void {
    this.mesh.position.copy(this.ground).add(this.bodyCentreScene.value);
    this.mesh.updateMatrixWorld();
    this.windowCentreScene.value.copy(this.mesh.position);
  }

  dispose(): void {
    this.config.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
