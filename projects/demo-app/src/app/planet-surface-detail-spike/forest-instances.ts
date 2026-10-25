import { BufferGeometry, ConeGeometry, CylinderGeometry, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { float, normalWorld, normalize, positionView, positionWorld, select, smoothstep } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PlanetAtmosphereBinding } from 'triangular-engine/atmosphere';
import { FOREST_CROWN_WIDTH_M, FOREST_TREE_HEIGHT_M, SCATTER_STRIDE } from './forest-field';
import type { IForestLayer } from './forest-layer';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A placeholder conifer: a cone crown on a short trunk, `FOREST_TREE_HEIGHT_M` tall and `FOREST_CROWN_WIDTH_M` wide. */
function treeGeometry(): BufferGeometry {
  const trunkHeight = FOREST_TREE_HEIGHT_M * 0.2;
  const crownHeight = FOREST_TREE_HEIGHT_M - trunkHeight * 0.6;
  const trunk = new CylinderGeometry(0.35, 0.5, trunkHeight, 5);
  trunk.translate(0, trunkHeight / 2, 0);
  const crown = new ConeGeometry(FOREST_CROWN_WIDTH_M / 2, crownHeight, 7);
  crown.translate(0, trunkHeight * 0.6 + crownHeight / 2, 0);
  const parts = [trunk.toNonIndexed(), crown.toNonIndexed()];
  // Positions and normals only: the colour is one flat albedo lit by the planet stages.
  for (const part of parts) part.deleteAttribute('uv');
  return mergeGeometries(parts);
}

/**
 * The forest's near form: one `InstancedMesh` of placeholder trees placed from `scatterForest`. The material runs the
 * planet's own lighting and aerial perspective (`binding.lighting()` and `binding.perspective()`, the stages the
 * surface material gets) on the same tree albedo the layer uses, and dissolves out over the fade band with an alpha
 * hash as the layer dissolves in.
 */
export class ForestInstances {
  readonly mesh: InstancedMesh;
  private readonly material: MeshBasicNodeMaterial;
  private readonly ground = new Vector3();
  private count = 0;

  /** `bodyCentreScene` is the surface material's `morph.uBodyCentreScene` uniform node: the planet's centre in scene space. */
  constructor(forest: IForestLayer, binding: PlanetAtmosphereBinding, private readonly bodyCentreScene: any, capacity: number) {
    this.material = new MeshBasicNodeMaterial();
    const radial: any = normalize(positionWorld.sub(bodyCentreScene));
    // A pure up-vector would light every tree like the ground; lean 30 % on the face normal so a crown has a sunny side.
    const shading: any = normalize(radial.mul(0.7).add(normalize(normalWorld).mul(0.3)));
    const context = { sphereNormal: shading, radialDirection: radial, cameraDistance: positionView.length() };
    const albedo: any = forest.treeAlbedo;
    const lit = binding.lighting()(context, { color: albedo, sunVisibility: float(1), surface: { albedo }, emissive: null });
    this.material.colorNode = binding.perspective()(context, lit);
    // 1 - layer weight: opaque near, gone far. `mode` 1 (instances only) keeps them opaque everywhere.
    this.material.alphaHash = true;
    this.material.opacityNode = select(
      forest.uniforms.mode.equal(1),
      float(1),
      float(1).sub(smoothstep(forest.uniforms.fadeStartM, forest.uniforms.fadeEndM, positionView.length())),
    );

    this.mesh = new InstancedMesh(treeGeometry(), this.material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  get treeCount(): number {
    return this.count;
  }

  /**
   * Places the scatter. `ground` is the body-fixed point under the scatter's centre at height 0 (metres): the
   * instances are offsets from it, so they stay small in float32.
   */
  setTrees(ground: Vector3, trees: Float32Array): void {
    this.ground.copy(ground);
    const n = Math.min(trees.length / SCATTER_STRIDE, this.mesh.instanceMatrix.count);
    const matrix = new Matrix4();
    const quaternion = new Quaternion();
    const yaw = new Quaternion();
    const up = new Vector3();
    const position = new Vector3();
    const scale = new Vector3();
    const y = new Vector3(0, 1, 0);
    for (let i = 0; i < n; i += 1) {
      const o = i * SCATTER_STRIDE;
      position.set(trees[o], trees[o + 1], trees[o + 2]);
      up.copy(position).add(ground).normalize();
      quaternion.setFromUnitVectors(y, up);
      yaw.setFromAxisAngle(y, trees[o + 3] * Math.PI * 2);
      quaternion.multiply(yaw);
      const s = 0.75 + trees[o + 3] * 0.5;
      scale.set(s, s, s);
      matrix.compose(position, quaternion, scale);
      this.mesh.setMatrixAt(i, matrix);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.count = n;
  }

  /** Follows the floating origin: the mesh sits at the body centre plus the scatter's ground point. Call every frame. */
  update(): void {
    this.mesh.position.copy(this.ground).add(this.bodyCentreScene.value);
    this.mesh.updateMatrixWorld();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
