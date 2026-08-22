import type {
  Camera,
  Scene,
  WebGLRenderer,
} from 'three';
import type { WebGPURenderer } from 'three/webgpu';

export type SceneInspectionDetail = 'brief' | 'standard' | 'deep';

export interface SceneInspectionSource {
  scene: Scene;
  camera: Camera;
  renderer?: WebGLRenderer | WebGPURenderer;
}

export interface SceneInspectionOptions {
  detail?: SceneInspectionDetail;
  maxObjects?: number;
  maxDepth?: number;
  nameIncludes?: string;
  objectId?: string;
  visibleOnly?: boolean;
  includeBounds?: boolean;
  includeHelpers?: boolean;
}

export interface SceneVectorSnapshot {
  x: number;
  y: number;
  z: number;
}

export interface SceneBoundsSnapshot {
  min: SceneVectorSnapshot;
  max: SceneVectorSnapshot;
}

export interface SceneCameraSnapshot {
  type: string;
  name: string;
  position: SceneVectorSnapshot;
  near?: number;
  far?: number;
  aspect?: number;
  fov?: number;
  zoom?: number;
}

export interface SceneRendererSnapshot {
  calls?: number;
  triangles?: number;
  points?: number;
  lines?: number;
}

export interface SceneObjectSnapshot {
  id: string;
  name: string;
  type: string;
  path: string;
  depth: number;
  visible: boolean;
  worldPosition: SceneVectorSnapshot;
  worldScale: SceneVectorSnapshot;
  childCount: number;
  bounds?: SceneBoundsSnapshot;
}

export type SceneInspectionWarningCode =
  | 'duplicate-name'
  | 'invalid-transform'
  | 'zero-scale'
  | 'missing-geometry'
  | 'missing-material'
  | 'invalid-camera'
  | 'truncated';

export interface SceneInspectionWarning {
  code: SceneInspectionWarningCode;
  message: string;
  objectId?: string;
}

export interface SceneSnapshot {
  version: 1;
  capturedAt: string;
  scene: {
    totalObjectCount: number;
    returnedObjectCount: number;
    visibleObjectCount: number;
    meshCount: number;
    lightCount: number;
    cameraCount: number;
    truncated: boolean;
  };
  camera: SceneCameraSnapshot;
  renderer?: SceneRendererSnapshot;
  objects: SceneObjectSnapshot[];
  warnings: SceneInspectionWarning[];
}
