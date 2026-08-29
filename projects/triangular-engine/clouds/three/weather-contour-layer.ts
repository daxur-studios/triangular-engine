import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';

import { createCloudRandom01 } from '../core/cloud-puff-shape';
import type { CloudPuffWindInput } from './domains/cloud-puff-domain';

export interface IWeatherParticle {
  position: Vector3;
  velocity: Vector3;
  age: number;
  life: number;
}

export interface IWeatherCluster {
  center: Vector3;
  velocity: Vector3;
  radius: number;
  particleCount: number;
  innerOffset: Vector3;
}

export interface IWeatherContourLayerOptions {
  readonly radiusM?: number;
  readonly particleCount?: number;
  readonly clusterCount?: number;
  readonly layerCount?: number; // 1 to 3 layers
  readonly baseOpacity?: number;
  readonly color?: Color | string;
  readonly seed?: number;
  readonly flowSpeed?: number;
  readonly minClusterRadiusM?: number;
  readonly maxClusterRadiusM?: number;
}

export interface IWeatherContourLayer {
  readonly group: Group;
  update(deltaSeconds: number, timeS: number): void;
  setSunDirection(direction: Vector3): void;
  setOpacity(opacity: number): void;
  setLayerCount(count: number): void;
  setFlowSpeed(speed: number): void;
  dispose(): void;
}

const WEATHER_CONTOUR_VERTEX_SHADER = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying vec2 vUv;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const WEATHER_CONTOUR_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform vec3 uSunDirection;
  uniform float uLayerIndex; // 0 = base, 1 = mid, 2 = core

  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying vec2 vUv;

  void main() {
    vec3 N = normalize(vNormal);
    vec3 L = normalize(uSunDirection);
    float NdotL = max(dot(N, L), 0.0);

    // Soft daylighting + ambient term
    vec3 litColor = uColor * (0.55 + 0.45 * NdotL);

    // Layered thickness: inner layers are denser and slightly brighter
    float layerMultiplier = 1.0 + uLayerIndex * 0.35;
    float layerAlpha = uOpacity * (0.45 + uLayerIndex * 0.28);

    // Soft edge falloff based on UV radius
    float distFromCenter = length(vUv - vec2(0.5)) * 2.0;
    float edgeFade = smoothstep(1.0, 0.4, distFromCenter);

    gl_FragColor = vec4(litColor * layerMultiplier, layerAlpha * edgeFade);
  }
`;

/**
 * Creates a circular/elliptical triangulated disc draped on a sphere or plane.
 */
function createContourPatchGeometry(segments = 32, noiseScale = 0.18, seed = 1): BufferGeometry {
  const geometry = new BufferGeometry();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const rand = createCloudRandom01(seed);

  // Center vertex
  positions.push(0, 0, 0);
  normals.push(0, 0, 1);
  uvs.push(0.5, 0.5);

  const radiusJitter = new Float32Array(segments);
  for (let i = 0; i < segments; i++) {
    // Smooth harmonic deformation for organic cloud shape
    const angle = (i / segments) * Math.PI * 2;
    const harmonic1 = Math.sin(angle * 3 + seed) * 0.18;
    const harmonic2 = Math.cos(angle * 5 + seed * 2) * 0.09;
    radiusJitter[i] = 1.0 + harmonic1 + harmonic2 + (rand() - 0.5) * noiseScale;
  }

  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const r = radiusJitter[i];
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    positions.push(x, y, 0);
    normals.push(0, 0, 1);
    uvs.push(0.5 + (x / 2.5), 0.5 + (y / 2.5));
  }

  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    indices.push(0, i + 1, next + 1);
  }

  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}

export function buildWeatherContourLayer(options: IWeatherContourLayerOptions = {}): IWeatherContourLayer {
  const radiusM = options.radiusM ?? 72;
  const particleCount = options.particleCount ?? 150;
  const clusterCount = options.clusterCount ?? 6;
  const layerCount = Math.max(1, Math.min(3, options.layerCount ?? 2));
  const seed = options.seed ?? 42;
  const baseColor = new Color(options.color ?? '#d6e9f8');

  const group = new Group();
  group.name = 'weather-contour-layer';

  const rand = createCloudRandom01(seed);

  // Initialize wind particles across the sphere
  const particles: IWeatherParticle[] = [];
  for (let i = 0; i < particleCount; i++) {
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);
    const pos = new Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.sin(phi) * Math.sin(theta),
      Math.cos(phi),
    ).multiplyScalar(radiusM);

    // Initial zonal eastward wind + curl perturbation
    const up = pos.clone().normalize();
    const north = new Vector3(0, 1, 0);
    const east = new Vector3().crossVectors(north, up).normalize();
    if (east.lengthSq() < 0.001) east.set(1, 0, 0);

    const speed = 2.0 + rand() * 3.5;
    particles.push({
      position: pos,
      velocity: east.multiplyScalar(speed),
      age: rand() * 20,
      life: 15 + rand() * 15,
    });
  }

  // Materials for the 3 nested layers
  const materials = [0, 1, 2].map((layerIdx) => {
    return new ShaderMaterial({
      vertexShader: WEATHER_CONTOUR_VERTEX_SHADER,
      fragmentShader: WEATHER_CONTOUR_FRAGMENT_SHADER,
      uniforms: {
        uColor: { value: baseColor.clone() },
        uOpacity: { value: options.baseOpacity ?? 0.55 },
        uSunDirection: { value: new Vector3(0.5, 0.8, 0.3).normalize() },
        uLayerIndex: { value: layerIdx },
      },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
  });

  // Base geometries for each layer with varied harmonic silhouettes
  const patchGeometries = [
    createContourPatchGeometry(36, 0.15, seed),
    createContourPatchGeometry(32, 0.22, seed + 101),
    createContourPatchGeometry(28, 0.28, seed + 202),
  ];

  // Meshes for each cluster and each layer
  interface IClusterMeshSet {
    baseMesh: Mesh;
    midMesh: Mesh;
    coreMesh: Mesh;
    clusterIndex: number;
  }

  const clusterMeshSets: IClusterMeshSet[] = [];

  for (let c = 0; c < clusterCount; c++) {
    const baseMesh = new Mesh(patchGeometries[0], materials[0]);
    const midMesh = new Mesh(patchGeometries[1], materials[1]);
    const coreMesh = new Mesh(patchGeometries[2], materials[2]);

    baseMesh.renderOrder = 10;
    midMesh.renderOrder = 11;
    coreMesh.renderOrder = 12;

    group.add(baseMesh);
    group.add(midMesh);
    group.add(coreMesh);

    clusterMeshSets.push({
      baseMesh,
      midMesh,
      coreMesh,
      clusterIndex: c,
    });
  }

  // Pre-seed cluster centers across planet
  const clusters: IWeatherCluster[] = [];
  for (let c = 0; c < clusterCount; c++) {
    const theta = (c / clusterCount) * Math.PI * 2 + (rand() - 0.5) * 0.5;
    const lat = ((c % 2 === 0 ? 0.35 : -0.35) + (rand() - 0.5) * 0.3) * Math.PI;
    const center = new Vector3(
      Math.cos(lat) * Math.cos(theta),
      Math.sin(lat),
      Math.cos(lat) * Math.sin(theta),
    ).multiplyScalar(radiusM);

    const normal = center.clone().normalize();
    const east = new Vector3().crossVectors(new Vector3(0, 1, 0), normal).normalize();
    if (east.lengthSq() < 0.001) east.set(1, 0, 0);

    clusters.push({
      center,
      velocity: east.multiplyScalar(4.0),
      radius: (options.minClusterRadiusM ?? 14) + rand() * ((options.maxClusterRadiusM ?? 30) - (options.minClusterRadiusM ?? 14)),
      particleCount: Math.floor(particleCount / clusterCount),
      innerOffset: new Vector3(),
    });
  }

  let activeFlowSpeed = options.flowSpeed ?? 1.0;
  let activeLayerCount = layerCount;

  return {
    group,
    update(deltaSeconds: number, timeS: number) {
      const dt = deltaSeconds * activeFlowSpeed;

      // Advect clusters and update particles
      for (let c = 0; c < clusterCount; c++) {
        const cluster = clusters[c];
        const meshSet = clusterMeshSets[c];

        // Advect cluster center on the sphere
        const normal = cluster.center.clone().normalize();
        const north = new Vector3(0, 1, 0);
        let east = new Vector3().crossVectors(north, normal).normalize();
        if (east.lengthSq() < 0.001) east.set(1, 0, 0);

        // Zonal drift + slight latitude curl wave
        const lat = Math.asin(Math.max(-1, Math.min(1, normal.y)));
        const curl = Math.sin(lat * 4 + timeS * 0.2) * 1.5;
        const advectionDir = east.clone().addScaledVector(north, curl * 0.15).normalize();

        cluster.velocity.copy(advectionDir).multiplyScalar(3.0 * activeFlowSpeed);
        cluster.center.addScaledVector(cluster.velocity, dt);
        cluster.center.normalize().multiplyScalar(radiusM);

        // Inner layers offset dynamically in the direction of velocity (wind flow)
        // creating the visual effect of the thicker core leading / streaming in the wind
        const streamFlow = advectionDir.clone().multiplyScalar(cluster.radius * 0.28);
        cluster.innerOffset.lerp(streamFlow, 0.05);

        // Orient and scale Base Mesh (Layer 0)
        const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), normal);
        meshSet.baseMesh.position.copy(cluster.center);
        meshSet.baseMesh.quaternion.copy(q);
        meshSet.baseMesh.scale.set(cluster.radius, cluster.radius * 0.75, 1);
        meshSet.baseMesh.visible = activeLayerCount >= 1;

        // Orient and scale Mid Mesh (Layer 1 - nested, shifted along wind stream)
        if (activeLayerCount >= 2) {
          const midPos = cluster.center.clone().add(cluster.innerOffset).normalize().multiplyScalar(radiusM + 0.3);
          const midNormal = midPos.clone().normalize();
          const midQ = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), midNormal);
          meshSet.midMesh.position.copy(midPos);
          meshSet.midMesh.quaternion.copy(midQ);
          meshSet.midMesh.scale.set(cluster.radius * 0.65, cluster.radius * 0.5, 1);
          meshSet.midMesh.visible = true;
        } else {
          meshSet.midMesh.visible = false;
        }

        // Orient and scale Core Mesh (Layer 2 - dense inner core, shifted further along wind stream)
        if (activeLayerCount >= 3) {
          const corePos = cluster.center.clone().addScaledVector(cluster.innerOffset, 1.6).normalize().multiplyScalar(radiusM + 0.6);
          const coreNormal = corePos.clone().normalize();
          const coreQ = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), coreNormal);
          meshSet.coreMesh.position.copy(corePos);
          meshSet.coreMesh.quaternion.copy(coreQ);
          meshSet.coreMesh.scale.set(cluster.radius * 0.38, cluster.radius * 0.3, 1);
          meshSet.coreMesh.visible = true;
        } else {
          meshSet.coreMesh.visible = false;
        }
      }
    },
    setSunDirection(direction: Vector3) {
      for (const mat of materials) {
        mat.uniforms['uSunDirection'].value.copy(direction);
      }
    },
    setOpacity(opacity: number) {
      for (const mat of materials) {
        mat.uniforms['uOpacity'].value = opacity;
      }
    },
    setLayerCount(count: number) {
      activeLayerCount = Math.max(1, Math.min(3, count));
    },
    setFlowSpeed(speed: number) {
      activeFlowSpeed = Math.max(0.1, speed);
    },
    dispose() {
      for (const geom of patchGeometries) geom.dispose();
      for (const mat of materials) mat.dispose();
      group.clear();
    },
  };
}
