import {
  Box3,
  Camera,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import {
  SceneInspectionOptions,
  SceneInspectionSource,
  SceneInspectionWarning,
  SceneCameraSnapshot,
  SceneObjectSnapshot,
  SceneRendererSnapshot,
  SceneSnapshot,
  SceneVectorSnapshot,
} from './scene-inspection.model';

const DEFAULT_MAX_OBJECTS = 24;
const STANDARD_MAX_OBJECTS = 80;
const DEEP_MAX_OBJECTS = 200;
const DEFAULT_MAX_DEPTH = 6;
const DEEP_MAX_DEPTH = 12;
const VECTOR_DECIMAL_PLACES = 3;

/**
 * Creates a bounded, deterministic projection of a Three.js scene.
 *
 * PURPOSE: Gives agents exact scene facts without serializing the live object graph.
 * VALUE: Agents can identify objects, camera state, and basic scene problems with a small context payload.
 */
export function inspectScene(
  source: SceneInspectionSource,
  options: SceneInspectionOptions = {},
): SceneSnapshot {
  const detail = options.detail ?? 'brief';
  const maxObjects = resolveMaxObjects(detail, options.maxObjects);
  const maxDepth = resolveMaxDepth(detail, options.maxDepth);
  const nameFilter = options.nameIncludes?.trim().toLowerCase();

  source.scene.updateMatrixWorld(true);

  const allObjects: Object3D[] = [];
  const warnings: SceneInspectionWarning[] = [];
  const names = new Map<string, number>();
  let visibleObjectCount = 0;
  let meshCount = 0;
  let lightCount = 0;
  let cameraCount = 0;

  source.scene.traverse((object) => {
    if (object === source.scene) return;

    allObjects.push(object);
    if (isEffectivelyVisible(object)) visibleObjectCount++;
    if ((object as { isMesh?: boolean }).isMesh) meshCount++;
    if ((object as { isLight?: boolean }).isLight) lightCount++;
    if ((object as { isCamera?: boolean }).isCamera) cameraCount++;

    const name = object.name.trim();
    if (name) names.set(name, (names.get(name) ?? 0) + 1);

    collectObjectWarnings(object, warnings);
  });

  for (const [name, count] of names) {
    if (count > 1) {
      warnings.push({
        code: 'duplicate-name',
        message: `Object name "${name}" is used ${count} times.`,
      });
    }
  }

  warnings.push(...inspectCameraWarnings(source.camera));

  const candidates = allObjects.filter((object) => {
    if (!options.includeHelpers && isHelper(object)) return false;
    if (options.visibleOnly && !isEffectivelyVisible(object)) return false;
    if (options.objectId && object.uuid !== options.objectId) return false;
    if (nameFilter && !object.name.toLowerCase().includes(nameFilter)) return false;
    return getDepth(object) <= maxDepth;
  });

  candidates.sort((a, b) => compareObjectsByRelevance(a, b, source.scene));
  const objects = candidates
    .slice(0, maxObjects)
    .map((object) => toObjectSnapshot(object, source.scene, options.includeBounds ?? detail !== 'brief'));

  const truncated = candidates.length > objects.length;
  if (truncated) {
    warnings.push({
      code: 'truncated',
      message: `Returned ${objects.length} of ${candidates.length} matching objects.`,
    });
  }

  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    scene: {
      totalObjectCount: allObjects.length,
      returnedObjectCount: objects.length,
      visibleObjectCount,
      meshCount,
      lightCount,
      cameraCount,
      truncated,
    },
    camera: toCameraSnapshot(source.camera),
    renderer: source.renderer ? toRendererSnapshot(source.renderer) : undefined,
    objects,
    warnings: sortWarnings(warnings),
  };
}

function resolveMaxObjects(detail: SceneInspectionOptions['detail'], requested?: number): number {
  const fallback = detail === 'deep' ? DEEP_MAX_OBJECTS : detail === 'standard' ? STANDARD_MAX_OBJECTS : DEFAULT_MAX_OBJECTS;
  return requested === undefined ? fallback : Math.max(1, Math.floor(requested));
}

function resolveMaxDepth(detail: SceneInspectionOptions['detail'], requested?: number): number {
  const fallback = detail === 'deep' ? DEEP_MAX_DEPTH : DEFAULT_MAX_DEPTH;
  return requested === undefined ? fallback : Math.max(0, Math.floor(requested));
}

function getDepth(object: Object3D): number {
  let depth = 0;
  let parent = object.parent;
  while (parent && !(parent instanceof Scene)) {
    depth++;
    parent = parent.parent;
  }
  return depth;
}

function getPath(object: Object3D, scene: Scene): string {
  const parts: string[] = [];
  let current: Object3D | null = object;
  while (current && current !== scene) {
    parts.unshift(current.name.trim() || current.type);
    current = current.parent;
  }
  return parts.join('/');
}

function compareObjectsByRelevance(a: Object3D, b: Object3D, scene: Scene): number {
  const aNamed = a.name.trim() ? 0 : 1;
  const bNamed = b.name.trim() ? 0 : 1;
  return aNamed - bNamed || getPath(a, scene).localeCompare(getPath(b, scene));
}

function toObjectSnapshot(object: Object3D, scene: Scene, includeBounds: boolean): SceneObjectSnapshot {
  const position = new Vector3();
  const scale = new Vector3();
  object.getWorldPosition(position);
  object.getWorldScale(scale);

  const snapshot: SceneObjectSnapshot = {
    id: object.uuid,
    name: object.name.trim(),
    type: object.type,
    path: getPath(object, scene),
    depth: getDepth(object),
    visible: isEffectivelyVisible(object),
    worldPosition: toVectorSnapshot(position),
    worldScale: toVectorSnapshot(scale),
    childCount: object.children.length,
  };

  if (includeBounds) {
    const bounds = new Box3().setFromObject(object);
    if (!bounds.isEmpty()) {
      snapshot.bounds = {
        min: toVectorSnapshot(bounds.min),
        max: toVectorSnapshot(bounds.max),
      };
    }
  }

  return snapshot;
}

function toCameraSnapshot(camera: Camera): SceneCameraSnapshot {
  const position = new Vector3();
  camera.getWorldPosition(position);
  const snapshot: SceneCameraSnapshot = {
    type: camera.type,
    name: camera.name.trim(),
    position: toVectorSnapshot(position),
  };

  if (camera instanceof PerspectiveCamera) {
    snapshot.near = round(camera.near);
    snapshot.far = round(camera.far);
    snapshot.aspect = round(camera.aspect);
    snapshot.fov = round(camera.fov);
  } else if (camera instanceof OrthographicCamera) {
    snapshot.near = round(camera.near);
    snapshot.far = round(camera.far);
    snapshot.zoom = round(camera.zoom);
  }

  return snapshot;
}

function toRendererSnapshot(renderer: WebGLRenderer | WebGPURenderer): SceneRendererSnapshot {
  const render = renderer.info?.render;
  return {
    calls: render?.calls,
    triangles: render?.triangles,
    points: render?.points,
    lines: render?.lines,
  };
}

function collectObjectWarnings(object: Object3D, warnings: SceneInspectionWarning[]): void {
  const values = [object.position.x, object.position.y, object.position.z, object.scale.x, object.scale.y, object.scale.z];
  if (values.some((value) => !Number.isFinite(value))) {
    warnings.push({ code: 'invalid-transform', message: `${object.type} has a non-finite transform.`, objectId: object.uuid });
  }
  if (isEffectivelyVisible(object) && [object.scale.x, object.scale.y, object.scale.z].some((value) => Math.abs(value) < Number.EPSILON)) {
    warnings.push({ code: 'zero-scale', message: `${object.type} has a near-zero scale while visible.`, objectId: object.uuid });
  }
  if ((object as { isMesh?: boolean }).isMesh) {
    const mesh = object as { geometry?: unknown; material?: unknown };
    if (!mesh.geometry) warnings.push({ code: 'missing-geometry', message: `Mesh "${object.name || object.uuid}" has no geometry.`, objectId: object.uuid });
    if (!mesh.material) warnings.push({ code: 'missing-material', message: `Mesh "${object.name || object.uuid}" has no material.`, objectId: object.uuid });
  }
}

function inspectCameraWarnings(camera: Camera): SceneInspectionWarning[] {
  const values = camera instanceof PerspectiveCamera
    ? [camera.near, camera.far, camera.aspect, camera.fov]
    : camera instanceof OrthographicCamera
      ? [camera.near, camera.far, camera.zoom]
      : [];
  return values.some((value) => !Number.isFinite(value) || value <= 0)
    ? [{ code: 'invalid-camera', message: `${camera.type} has invalid projection values.` }]
    : [];
}

function isEffectivelyVisible(object: Object3D): boolean {
  let current: Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

function isHelper(object: Object3D): boolean {
  return object.userData['isHelper'] === true || object.type.endsWith('Helper');
}

function toVectorSnapshot(vector: Vector3): SceneVectorSnapshot {
  return { x: round(vector.x), y: round(vector.y), z: round(vector.z) };
}

function round(value: number): number {
  const factor = 10 ** VECTOR_DECIMAL_PLACES;
  return Math.round(value * factor) / factor;
}

function sortWarnings(warnings: SceneInspectionWarning[]): SceneInspectionWarning[] {
  return warnings.sort((a, b) => a.code.localeCompare(b.code) || (a.objectId ?? '').localeCompare(b.objectId ?? '') || a.message.localeCompare(b.message));
}
