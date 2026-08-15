import {
  GLSL3,
  LinearFilter,
  LinearMipmapLinearFilter,
  LinearSRGBColorSpace,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  NearestMipMapNearestFilter,
  ObjectSpaceNormalMap,
  OrthographicCamera,
  ShaderMaterial,
  Sphere,
  TangentSpaceNormalMap,
  Texture,
  UnsignedByteType,
  Vector2,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget,
  type IUniform,
  type Object3D,
} from 'three';

import { computeObjectBoundingSphere } from '../core/compute-object-bounding-sphere';
import { hemiOctahedronGridToDirection } from '../core/octahedron-directions';
import {
  IMPOSTOR_ATLAS_BAKE_FRAGMENT_GLSL,
  IMPOSTOR_ATLAS_BAKE_VERTEX_GLSL,
} from './impostor-atlas-bake-glsl';

export interface ICreateOctahedralImpostorAtlasOptions {
  /** Renders the bake views; left in its caller-set state afterward (viewport/scissor/pixel-ratio/clear-alpha/render-target are all saved and restored). */
  readonly renderer: WebGLRenderer;
  /** The object baked from multiple directions. Its materials are temporarily swapped for the bake pass and restored afterward. */
  readonly target: Object3D;
  /** Full size (px) of the square atlas. @default 2048 */
  readonly textureSize?: number;
  /** Grid cells per side; `spritesPerSide ** 2` unique baked views. @default 16 */
  readonly spritesPerSide?: number;
  /** Multiplier on the bake camera's distance from the target's bounding sphere. @default 1 */
  readonly cameraFactor?: number;
}

export interface IOctahedralImpostorAtlas {
  /** Owns both textures below — dispose this, not the textures individually, when the atlas is no longer needed. */
  readonly renderTarget: WebGLRenderTarget;
  /** Baked albedo, one view per grid cell. */
  readonly albedo: Texture;
  /** Baked view-space normal (RGB, `packNormalToRGB`) + linear depth (A). */
  readonly normalDepth: Texture;
}

interface IRendererSnapshot {
  readonly renderTarget: WebGLRenderTarget;
  readonly pixelRatio: number;
  readonly scissorTest: boolean;
  readonly clearAlpha: number;
}

const USERDATA_ORIGINAL_MATERIAL_KEY = 'impostorOriginalMaterial';

// Reused across bake calls to avoid per-view allocation — createOctahedralImpostorAtlas
// runs its render loop up to spritesPerSide^2 times per call (256 for the
// default 16x16 grid), so these would otherwise churn the GC every frame a
// bake runs. Not reentrant: do not call this function concurrently with itself.
const bakeCamera = new OrthographicCamera();
const boundingSphere = new Sphere();
const savedScissor = new Vector4();
const savedViewport = new Vector4();
const gridCoord = new Vector2();

/**
 * Renders `target` from a grid of camera directions covering the upper
 * hemisphere (see `hemiOctahedronGridToDirection`) into a single square
 * atlas, arranged `spritesPerSide x spritesPerSide`. Two render targets are
 * produced via MRT: albedo and packed normal+depth, both consumed by
 * `octahedral-impostor-material.ts` at render time.
 *
 * Direct port of the reference octahedral-impostor library's
 * `createTextureAtlas`, scoped to the hemispherical projection (the only
 * one that library finished) and without the ORM-map bake path (never
 * implemented there either).
 */
export function createOctahedralImpostorAtlas(
  options: ICreateOctahedralImpostorAtlasOptions,
): IOctahedralImpostorAtlas {
  const { renderer, target } = options;
  const atlasSize = options.textureSize ?? 2048;
  const spritesPerSide = options.spritesPerSide ?? 16;
  const spritesPerSideMinusOne = spritesPerSide - 1;
  const spriteSize = atlasSize / spritesPerSide;
  const cameraFactor = options.cameraFactor ?? 1;

  // Some target hierarchies ship an inaccurate/stale geometry.boundingSphere
  // (e.g. procedurally generated meshes that never called
  // computeBoundingSphere themselves) — force a recompute so the bake
  // cameras are sized correctly regardless.
  computeObjectBoundingSphere(target, boundingSphere, true);
  updateBakeCamera(boundingSphere, cameraFactor);

  const snapshot = setupRenderer(renderer, atlasSize);
  overrideTargetMaterials(target);

  for (let row = 0; row < spritesPerSide; row++) {
    for (let col = 0; col < spritesPerSide; col++) {
      renderBakeView(renderer, target, col, row, spritesPerSide, spriteSize, atlasSize, cameraFactor);
    }
  }

  restoreRenderer(renderer, snapshot);
  restoreTargetMaterials(target);

  return {
    renderTarget: snapshot.renderTarget,
    albedo: snapshot.renderTarget.textures[0],
    normalDepth: snapshot.renderTarget.textures[1],
  };
}

function updateBakeCamera(sphere: Sphere, cameraFactor: number): void {
  bakeCamera.left = -sphere.radius;
  bakeCamera.right = sphere.radius;
  bakeCamera.top = sphere.radius;
  bakeCamera.bottom = -sphere.radius;
  bakeCamera.zoom = cameraFactor;
  bakeCamera.near = 0.001;
  bakeCamera.far = sphere.radius * 2 + 0.001;
  bakeCamera.updateProjectionMatrix();
}

function renderBakeView(
  renderer: WebGLRenderer,
  target: Object3D,
  col: number,
  row: number,
  spritesPerSide: number,
  spriteSize: number,
  atlasSize: number,
  cameraFactor: number,
): void {
  gridCoord.set(col / (spritesPerSide - 1), row / (spritesPerSide - 1));
  hemiOctahedronGridToDirection(gridCoord, bakeCamera.position);
  bakeCamera.position.setLength(boundingSphere.radius * cameraFactor).add(boundingSphere.center);
  bakeCamera.lookAt(boundingSphere.center);

  const xOffset = (col / spritesPerSide) * atlasSize;
  const yOffset = (row / spritesPerSide) * atlasSize;
  renderer.setViewport(xOffset, yOffset, spriteSize, spriteSize);
  renderer.setScissor(xOffset, yOffset, spriteSize, spriteSize);
  renderer.render(target, bakeCamera);
}

function setupRenderer(renderer: WebGLRenderer, atlasSize: number): IRendererSnapshot {
  const pixelRatio = renderer.getPixelRatio();
  const scissorTest = renderer.getScissorTest();
  const clearAlpha = renderer.getClearAlpha();
  renderer.getScissor(savedScissor);
  renderer.getViewport(savedViewport);

  const renderTarget = new WebGLRenderTarget(atlasSize, atlasSize, {
    count: 2,
    generateMipmaps: true,
  });

  const albedo = renderTarget.textures[0];
  albedo.minFilter = LinearMipmapLinearFilter;
  albedo.magFilter = LinearFilter;
  albedo.type = UnsignedByteType;
  albedo.colorSpace = LinearSRGBColorSpace;

  const normalDepth = renderTarget.textures[1];
  normalDepth.minFilter = NearestMipMapNearestFilter;
  normalDepth.magFilter = NearestFilter;
  normalDepth.type = UnsignedByteType; // packed, not a linear color value
  normalDepth.colorSpace = LinearSRGBColorSpace;

  renderer.setRenderTarget(renderTarget);
  renderer.setScissorTest(true);
  renderer.setPixelRatio(1);
  renderer.setClearAlpha(0);

  return { renderTarget, pixelRatio, scissorTest, clearAlpha };
}

function restoreRenderer(renderer: WebGLRenderer, snapshot: IRendererSnapshot): void {
  renderer.setRenderTarget(null);
  renderer.setScissorTest(snapshot.scissorTest);
  renderer.setViewport(savedViewport.x, savedViewport.y, savedViewport.z, savedViewport.w);
  renderer.setScissor(savedScissor.x, savedScissor.y, savedScissor.z, savedScissor.w);
  renderer.setPixelRatio(snapshot.pixelRatio);
  renderer.setClearAlpha(snapshot.clearAlpha);
}

function overrideTargetMaterials(target: Object3D): void {
  target.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.material) return;

    mesh.userData[USERDATA_ORIGINAL_MATERIAL_KEY] = mesh.material;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((material) => createBakeMaterial(material as MeshStandardMaterial))
      : createBakeMaterial(mesh.material as MeshStandardMaterial);
  });
}

function restoreTargetMaterials(target: Object3D): void {
  target.traverse((node) => {
    if (node.userData[USERDATA_ORIGINAL_MATERIAL_KEY]) {
      (node as Mesh).material = node.userData[USERDATA_ORIGINAL_MATERIAL_KEY];
      delete node.userData[USERDATA_ORIGINAL_MATERIAL_KEY];
    }
  });
}

function createBakeMaterial(material: MeshStandardMaterial): ShaderMaterial {
  const hasMap = !!material.map;
  const hasAlphaMap = !!material.alphaMap;
  const hasNormalMap = !!material.normalMap;
  const hasBumpMap = !!material.bumpMap;
  const hasDisplacementMap = !!material.displacementMap;
  const hasAlphaTest = material.alphaTest > 0;

  const uniforms: { [uniform: string]: IUniform } = {
    diffuse: { value: material.color },
    opacity: { value: material.opacity },
  };

  if (hasAlphaTest) uniforms['alphaTest'] = { value: material.alphaTest };

  if (hasMap) {
    uniforms['map'] = { value: material.map };
    uniforms['mapTransform'] = { value: material.map!.matrix };
  }
  if (hasAlphaMap) {
    uniforms['alphaMap'] = { value: material.alphaMap };
    uniforms['alphaMapTransform'] = { value: material.alphaMap!.matrix };
  }
  if (hasNormalMap) {
    uniforms['normalMap'] = { value: material.normalMap };
    uniforms['normalScale'] = { value: material.normalScale };
    uniforms['normalMapTransform'] = { value: material.normalMap!.matrix };
  }
  if (hasBumpMap) {
    uniforms['bumpMap'] = { value: material.bumpMap };
    uniforms['bumpScale'] = { value: material.bumpScale };
    uniforms['bumpMapTransform'] = { value: material.bumpMap!.matrix };
  }
  if (hasDisplacementMap) {
    uniforms['displacementMap'] = { value: material.displacementMap };
    uniforms['displacementScale'] = { value: material.displacementScale };
    uniforms['displacementBias'] = { value: material.displacementBias };
    uniforms['displacementMapTransform'] = { value: material.displacementMap!.matrix };
  }

  const defines: { [key: string]: string } = {};
  if (hasMap || hasAlphaMap || hasNormalMap || hasBumpMap || hasDisplacementMap) {
    defines['USE_UV'] = '';
  }

  const bakeMaterial = new ShaderMaterial({
    uniforms,
    defines,
    vertexShader: IMPOSTOR_ATLAS_BAKE_VERTEX_GLSL,
    fragmentShader: IMPOSTOR_ATLAS_BAKE_FRAGMENT_GLSL,
    glslVersion: GLSL3,
    transparent: material.transparent,
    side: material.side,
    alphaHash: material.alphaHash,
    depthFunc: material.depthFunc,
    depthWrite: material.depthWrite,
    depthTest: material.depthTest,
    blending: material.blending,
    blendSrc: material.blendSrc,
    blendDst: material.blendDst,
    blendEquation: material.blendEquation,
    blendSrcAlpha: material.blendSrcAlpha,
    blendDstAlpha: material.blendDstAlpha,
    blendEquationAlpha: material.blendEquationAlpha,
    premultipliedAlpha: material.premultipliedAlpha,
    alphaToCoverage: material.alphaToCoverage,
    vertexColors: material.vertexColors,
    precision: material.precision,
    visible: material.visible,
  });

  bakeMaterial.onBeforeCompile = (shader) => {
    if (hasMap) {
      shader.map = true;
      shader.mapUv = 'uv';
    }
    if (hasAlphaMap) {
      shader.alphaMap = true;
      shader.alphaMapUv = 'uv';
    }
    if (hasNormalMap) {
      shader.normalMap = true;
      shader.normalMapUv = 'uv';
      shader.normalMapTangentSpace = material.normalMapType === TangentSpaceNormalMap;
      shader.normalMapObjectSpace = material.normalMapType === ObjectSpaceNormalMap;
    }
    if (hasBumpMap) {
      shader.bumpMap = true;
      shader.bumpMapUv = 'uv';
    }
    if (hasDisplacementMap) {
      shader.displacementMap = true;
      shader.displacementMapUv = 'uv';
    }
    shader.flatShading = material.flatShading;
    shader.alphaTest = hasAlphaTest;
  };

  return bakeMaterial;
}
