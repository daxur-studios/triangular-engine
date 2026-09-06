import {
  Color,
  DirectionalLight,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildClipmapTiles, groupTilesByLevel } from './clipmap-layout';
import {
  BASE_TILE_SIZE_M,
  BLOCK_RADIUS_TILES,
  FINEST_SWITCH_DISTANCE_M,
  GRID_RESOLUTION,
  LEVEL_COUNT,
  MAX_INSTANCES_PER_LEVEL,
  TERRAIN_HEIGHT_SCALE_M,
} from './constants';
import { buildSharedGridBuffers } from './shared-grid-geometry';
import { createGpuMorphLodMaterial } from './shader';

export interface IGpuMorphLodDiagnostics {
  readonly fps: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly instanceCountsByLevel: readonly number[];
  readonly frozen: boolean;
}

export interface IGpuMorphLodSceneHandle {
  setWireframe(enabled: boolean): void;
  setShowLevelTint(enabled: boolean): void;
  setMorphEnabled(enabled: boolean): void;
  setFrozen(enabled: boolean): void;
  dispose(): void;
}

export function createGpuMorphLodScene(
  canvas: HTMLCanvasElement,
  onDiagnostics: (diagnostics: IGpuMorphLodDiagnostics) => void,
): IGpuMorphLodSceneHandle {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(1);

  const scene = new Scene();
  scene.background = new Color('#12181f');

  const camera = new PerspectiveCamera(60, 1, 0.5, 4_000);
  camera.position.set(60, 45, 60);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.update();

  scene.add(new HemisphereLight('#cfe8ff', '#2b2318', 1.1));
  const sun = new DirectionalLight('#fff2d6', 1.4);
  sun.position.set(200, 300, 120);
  scene.add(sun);

  const { levelGeometries } = buildSharedGridBuffers(
    GRID_RESOLUTION,
    LEVEL_COUNT,
  );
  const material = createGpuMorphLodMaterial();
  material.uniforms['uBaseTileSizeM']!.value = BASE_TILE_SIZE_M;
  material.uniforms['uGridResolution']!.value = GRID_RESOLUTION;
  material.uniforms['uMaxLevel']!.value = LEVEL_COUNT - 1;
  material.uniforms['uFinestSwitchDistanceM']!.value = FINEST_SWITCH_DISTANCE_M;
  material.uniforms['uHeightScale']!.value = TERRAIN_HEIGHT_SCALE_M;

  const levelMeshes: InstancedMesh[] = [];
  const levelOffsetAttributes: InstancedBufferAttribute[] = [];
  const levelScaleAttributes: InstancedBufferAttribute[] = [];

  for (let level = 0; level < LEVEL_COUNT; level++) {
    const geometry = levelGeometries[level]!;
    const offsetArray = new Float32Array(MAX_INSTANCES_PER_LEVEL * 3);
    const scaleArray = new Float32Array(MAX_INSTANCES_PER_LEVEL);
    const offsetAttribute = new InstancedBufferAttribute(offsetArray, 3);
    const scaleAttribute = new InstancedBufferAttribute(scaleArray, 1);
    geometry.setAttribute('instanceOffset', offsetAttribute);
    geometry.setAttribute('instanceScale', scaleAttribute);

    const mesh = new InstancedMesh(geometry, material, MAX_INSTANCES_PER_LEVEL);
    mesh.count = 0;
    mesh.frustumCulled = false;
    scene.add(mesh);

    levelMeshes.push(mesh);
    levelOffsetAttributes.push(offsetAttribute);
    levelScaleAttributes.push(scaleAttribute);
  }

  let frozen = false;

  function updateClipmap(): void {
    if (frozen) return;
    const tiles = buildClipmapTiles(
      camera.position.x,
      camera.position.z,
      BASE_TILE_SIZE_M,
      LEVEL_COUNT,
      BLOCK_RADIUS_TILES,
    );
    const groups = groupTilesByLevel(tiles, LEVEL_COUNT);

    for (let level = 0; level < LEVEL_COUNT; level++) {
      const group = groups[level]!;
      const mesh = levelMeshes[level]!;
      const offsets = levelOffsetAttributes[level]!;
      const scales = levelScaleAttributes[level]!;
      const count = Math.min(group.length, MAX_INSTANCES_PER_LEVEL);

      for (let i = 0; i < count; i++) {
        const tile = group[i]!;
        offsets.setXYZ(i, tile.centerXM, 0, tile.centerZM);
        scales.setX(i, tile.sizeM);
      }
      mesh.count = count;
      offsets.needsUpdate = true;
      scales.needsUpdate = true;
    }
  }

  function resize(): void {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  resize();

  let animationFrame = 0;
  let sampleTimeMs = performance.now();
  let frames = 0;

  function animate(): void {
    animationFrame = requestAnimationFrame(animate);
    if (!frozen) {
      controls.update();
      material.uniforms['uCameraWorldPos']!.value.copy(camera.position);
      updateClipmap();
    }
    renderer.render(scene, camera);
    frames++;

    const nowMs = performance.now();
    if (nowMs - sampleTimeMs >= 500) {
      const fps = Math.round((frames * 1_000) / (nowMs - sampleTimeMs));
      onDiagnostics({
        fps,
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        instanceCountsByLevel: levelMeshes.map((mesh) => mesh.count),
        frozen,
      });
      frames = 0;
      sampleTimeMs = nowMs;
    }
  }

  // Prime the first frame before freezing/toggling can be requested.
  material.uniforms['uCameraWorldPos']!.value.copy(camera.position);
  updateClipmap();
  animate();

  return {
    setWireframe(enabled: boolean): void {
      material.wireframe = enabled;
    },
    setShowLevelTint(enabled: boolean): void {
      material.uniforms['uShowLevelTint']!.value = enabled;
    },
    setMorphEnabled(enabled: boolean): void {
      material.uniforms['uMorphEnabled']!.value = enabled;
    },
    setFrozen(enabled: boolean): void {
      frozen = enabled;
    },
    dispose(): void {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      controls.dispose();
      for (const geometry of levelGeometries) geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}
