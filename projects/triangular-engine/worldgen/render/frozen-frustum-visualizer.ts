import {
  BufferGeometry,
  Camera,
  CameraHelper,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  SphereGeometry,
  Vector3,
} from 'three';

export interface IFrozenFrustumVisualizerOptions {
  /** Base planet radius in meters (defaults to 600,000 m). */
  readonly radiusM?: number;
  /** Max expected terrain relief above the base sphere in meters (defaults to 4,000 m). */
  readonly reliefMarginM?: number;
  /** Primary color for the camera standpoint pin / marker. Defaults to '#ff3366'. */
  readonly markerColor?: number | string;
  /** Color for the translucent frustum volume (pizza cone beam). Defaults to '#00d4ff'. */
  readonly volumeColor?: number | string;
  /** Opacity for the translucent frustum volume (defaults to 0.15). */
  readonly volumeOpacity?: number;
  /** Color for the pizza cone edge lines. Defaults to '#00ffff'. */
  readonly edgeColor?: number | string;
}

export interface IFrozenFrustumVisualizer {
  readonly group: Group;
  readonly dispose: () => void;
}

/**
 * Creates an interactive 3D visualizer showing the camera standpoint and visible frustum ("pizza cone")
 * at the moment LOD is frozen.
 *
 * When flying high above the terrain, it displays:
 * 1. A camera standpoint marker (eye pin) at the frozen viewpoint.
 * 2. A CameraHelper wireframe with near/far frames and center gaze vector.
 * 3. Bright edge rays connecting the eye to the far boundary.
 * 4. A translucent, double-sided "pizza cone" volume projecting across the terrain.
 *
 * `depthTest` is disabled so the frustum remains visible from orbit even through mountains.
 */
export function createFrozenFrustumVisualizer(
  camera: Camera,
  options: IFrozenFrustumVisualizerOptions = {},
): IFrozenFrustumVisualizer {
  const group = new Group();
  group.name = 'frozen-frustum-visualizer';

  const radius = options.radiusM ?? 600_000;
  const relief = options.reliefMarginM ?? 4_000;
  const markerColor = options.markerColor ?? 0xff3366;
  const volumeColor = options.volumeColor ?? 0x00d4ff;
  const volumeOpacity = options.volumeOpacity ?? 0.15;
  const edgeColor = options.edgeColor ?? 0x00ffff;

  camera.updateMatrixWorld(true);
  const camPos = camera.position.clone();
  const camDist = camPos.length();

  const isPerspective = camera instanceof PerspectiveCamera;
  const camNear = isPerspective ? camera.near : 1;
  const camFar = isPerspective ? camera.far : 100_000;

  let helperFar = camFar;
  if (isPerspective) {
    const alt = Math.max(10, camDist - radius);
    const horizonDist = Math.sqrt(2 * radius * alt + alt * alt);
    const reliefHorizon = Math.sqrt(2 * radius * relief);
    const maxVisibleDist = horizonDist + reliefHorizon;
    helperFar = Math.min(camFar, Math.max(5_000, maxVisibleDist * 1.35));
  }

  const helperCam = camera.clone();
  if (helperCam instanceof PerspectiveCamera) {
    helperCam.far = helperFar;
    helperCam.near = Math.max(1, camNear);
    helperCam.updateProjectionMatrix();
  }
  helperCam.updateMatrixWorld(true);

  // 1. Standard Three.js CameraHelper wireframe
  const camHelper = new CameraHelper(helperCam);
  if (camHelper.material instanceof LineBasicMaterial) {
    camHelper.material.depthTest = false;
    camHelper.material.transparent = true;
    camHelper.material.opacity = 0.85;
  }
  camHelper.renderOrder = 998;
  group.add(camHelper);

  // 2. Camera Standpoint Eye Pin / Marker
  const markerRadius = Math.max(300, helperFar * 0.015);
  const markerGeo = new SphereGeometry(markerRadius, 16, 16);
  const markerMat = new MeshBasicMaterial({
    color: markerColor,
    depthTest: false,
    transparent: true,
    opacity: 0.9,
  });
  const markerMesh = new Mesh(markerGeo, markerMat);
  markerMesh.position.copy(camPos);
  markerMesh.renderOrder = 1000;
  group.add(markerMesh);

  // 3. Far plane corners in world space
  const ndcFar = [
    new Vector3(-1, -1, 1),
    new Vector3(1, -1, 1),
    new Vector3(1, 1, 1),
    new Vector3(-1, 1, 1),
  ];
  const worldFar = ndcFar.map((pt) => pt.unproject(helperCam));

  // 4. Translucent Frustum Volume (Pizza Cone beam)
  const volumeGeo = new BufferGeometry();
  const triPos: number[] = [];
  const pushTri = (a: Vector3, b: Vector3, c: Vector3) => {
    triPos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  pushTri(camPos, worldFar[0], worldFar[1]);
  pushTri(camPos, worldFar[1], worldFar[2]);
  pushTri(camPos, worldFar[2], worldFar[3]);
  pushTri(camPos, worldFar[3], worldFar[0]);
  pushTri(worldFar[0], worldFar[2], worldFar[1]);
  pushTri(worldFar[0], worldFar[3], worldFar[2]);
  volumeGeo.setAttribute('position', new Float32BufferAttribute(triPos, 3));

  const volumeMat = new MeshBasicMaterial({
    color: volumeColor,
    transparent: true,
    opacity: volumeOpacity,
    depthTest: false,
    side: DoubleSide,
  });
  const volumeMesh = new Mesh(volumeGeo, volumeMat);
  volumeMesh.renderOrder = 997;
  group.add(volumeMesh);

  // 5. Bright Edge Outline Lines
  const edgeGeo = new BufferGeometry();
  const linePos: number[] = [];
  const pushLine = (a: Vector3, b: Vector3) => {
    linePos.push(a.x, a.y, a.z, b.x, b.y, b.z);
  };
  // 4 corner rays from eye
  pushLine(camPos, worldFar[0]);
  pushLine(camPos, worldFar[1]);
  pushLine(camPos, worldFar[2]);
  pushLine(camPos, worldFar[3]);
  // Far plane border
  pushLine(worldFar[0], worldFar[1]);
  pushLine(worldFar[1], worldFar[2]);
  pushLine(worldFar[2], worldFar[3]);
  pushLine(worldFar[3], worldFar[0]);
  // Forward gaze ray
  const gazeCenter = new Vector3()
    .add(worldFar[0])
    .add(worldFar[1])
    .add(worldFar[2])
    .add(worldFar[3])
    .multiplyScalar(0.25);
  pushLine(camPos, gazeCenter);

  edgeGeo.setAttribute('position', new Float32BufferAttribute(linePos, 3));
  const edgeMat = new LineBasicMaterial({
    color: edgeColor,
    depthTest: false,
    transparent: true,
    opacity: 0.9,
  });
  const edgeLines = new LineSegments(edgeGeo, edgeMat);
  edgeLines.renderOrder = 999;
  group.add(edgeLines);

  const dispose = () => {
    group.removeFromParent();
    camHelper.dispose();
    markerGeo.dispose();
    markerMat.dispose();
    volumeGeo.dispose();
    volumeMat.dispose();
    edgeGeo.dispose();
    edgeMat.dispose();
  };

  return { group, dispose };
}
