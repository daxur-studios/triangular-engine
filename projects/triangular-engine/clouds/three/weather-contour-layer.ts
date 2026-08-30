import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  DoubleSide,
  Group,
  Mesh,
  OneMinusSrcAlphaFactor,
  Quaternion,
  ShaderMaterial,
  SrcAlphaFactor,
  Vector3,
} from 'three';

import { createCloudRandom01 } from '../core/cloud-puff-shape';
import {
  windFieldSphere3D,
  type ISphereWindFieldParams,
} from '../core/cloud-wind-field';

export interface IWeatherParticle {
  position: Vector3;
  velocity: Vector3;
  clusterId: number;
}

export interface IParticleCluster {
  id: number;
  center: Vector3;
  meanVelocity: Vector3;
  particleIndices: number[];
  radius: number;
  layer0Mesh: Mesh;
  layer1Mesh: Mesh;
  layer2Mesh: Mesh;
}

export interface IWeatherContourLayerOptions {
  readonly radiusM?: number;
  readonly particleCount?: number;
  readonly maxClusters?: number;
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

const CONTOUR_VERTEX_SHADER = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying vec2 vUv;

  void main() {
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const CONTOUR_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform vec3 uSunDirection;
  uniform float uLayerIndex; // 0 = base large layer, 1 = mid layer, 2 = core dense layer

  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying vec2 vUv;

  void main() {
    vec3 N = normalize(vNormal);
    vec3 L = normalize(uSunDirection);
    float NdotL = max(dot(N, L), 0.0);

    // Daylight term with soft wrap
    float dayFactor = smoothstep(-0.2, 0.4, NdotL);
    vec3 litColor = uColor * (0.45 + 0.55 * dayFactor);

    // Layered stepping: inner layers are denser and slightly brighter
    float layerBrightness = 1.0 + uLayerIndex * 0.22;
    float layerAlpha = uOpacity * (0.35 + uLayerIndex * 0.25);

    // Soft organic edge falloff based on UV radius
    float distFromCenter = length(vUv - vec2(0.5)) * 2.0;
    float edgeFade = 1.0 - smoothstep(0.4, 1.0, distFromCenter);

    gl_FragColor = vec4(litColor * layerBrightness, layerAlpha * edgeFade * (0.3 + 0.7 * dayFactor));
  }
`;

/**
 * Builds an organic multi-lobed curved disc geometry draped on a spherical patch.
 */
function buildCurvedContourPatchGeometry(
  segments = 36,
  noiseScale = 0.25,
  seed = 1,
): BufferGeometry {
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
    const angle = (i / segments) * Math.PI * 2;
    const harmonic1 = Math.sin(angle * 3.0 + seed * 1.7) * 0.22;
    const harmonic2 = Math.cos(angle * 5.0 + seed * 3.1) * 0.12;
    const harmonic3 = Math.sin(angle * 7.0 + seed * 0.8) * 0.06;
    radiusJitter[i] = 1.0 + harmonic1 + harmonic2 + harmonic3 + (rand() - 0.5) * noiseScale;
  }

  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const r = Math.max(0.2, radiusJitter[i]);
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    // Slight dome curvature
    const z = (1.0 - (x * x + y * y) * 0.3) * 0.12;

    positions.push(x, y, z);
    normals.push(0, 0, 1);
    uvs.push(0.5 + x * 0.45, 0.5 + y * 0.45);
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

/**
 * Builds an upper atmosphere weather layer whose 2D/3D layered shapes are dynamically
 * synthesized from groups/clusters of advecting wind particles.
 */
export function buildWeatherContourLayer(
  options: IWeatherContourLayerOptions = {},
): IWeatherContourLayer {
  const radiusM = options.radiusM ?? 72;
  const particleCount = options.particleCount ?? 320;
  const maxClusters = options.maxClusters ?? options.clusterCount ?? 8;
  const layerCount = Math.max(1, Math.min(3, options.layerCount ?? 2));
  const seed = options.seed ?? 42;
  const baseColor = new Color(options.color ?? '#dbeefe');
  const minClusterRadius = options.minClusterRadiusM ?? 16;
  const maxClusterRadius = options.maxClusterRadiusM ?? 36;

  const group = new Group();
  group.name = 'weather-contour-layer';

  const rand = createCloudRandom01(seed);

  // Initialize wind particles distributed across the sphere
  const particles: IWeatherParticle[] = [];
  for (let i = 0; i < particleCount; i++) {
    const u = rand() * 2 - 1;
    const theta = rand() * Math.PI * 2;
    const rXz = Math.sqrt(Math.max(0, 1 - u * u));
    const pos = new Vector3(
      rXz * Math.cos(theta),
      u,
      rXz * Math.sin(theta),
    ).normalize().multiplyScalar(radiusM);

    particles.push({
      position: pos,
      velocity: new Vector3(),
      clusterId: -1,
    });
  }

  // 3 nested layer materials (Layer 0 = Outer Base, Layer 1 = Mid Density, Layer 2 = Dense Core)
  const materials = [0, 1, 2].map((layerIdx) => {
    return new ShaderMaterial({
      vertexShader: CONTOUR_VERTEX_SHADER,
      fragmentShader: CONTOUR_FRAGMENT_SHADER,
      uniforms: {
        uColor: { value: baseColor.clone() },
        uOpacity: { value: options.baseOpacity ?? 0.55 },
        uSunDirection: { value: new Vector3(0.5, 0.8, 0.3).normalize() },
        uLayerIndex: { value: layerIdx },
      },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: CustomBlending,
      blendSrc: SrcAlphaFactor,
      blendDst: OneMinusSrcAlphaFactor,
    });
  });

  // Base patch geometries with varied harmonic contours
  const patchGeometries = [
    buildCurvedContourPatchGeometry(40, 0.18, seed),
    buildCurvedContourPatchGeometry(36, 0.24, seed + 101),
    buildCurvedContourPatchGeometry(32, 0.30, seed + 202),
  ];

  // Create Cluster Mesh Sets
  const clusters: IParticleCluster[] = [];
  for (let c = 0; c < maxClusters; c++) {
    const layer0Mesh = new Mesh(patchGeometries[0], materials[0]);
    const layer1Mesh = new Mesh(patchGeometries[1], materials[1]);
    const layer2Mesh = new Mesh(patchGeometries[2], materials[2]);

    layer0Mesh.renderOrder = 10;
    layer1Mesh.renderOrder = 11;
    layer2Mesh.renderOrder = 12;

    layer0Mesh.frustumCulled = false;
    layer1Mesh.frustumCulled = false;
    layer2Mesh.frustumCulled = false;

    group.add(layer0Mesh);
    group.add(layer1Mesh);
    group.add(layer2Mesh);

    // Initial seed center
    const theta = (c / maxClusters) * Math.PI * 2 + (rand() - 0.5) * 0.4;
    const lat = ((c % 2 === 0 ? 0.32 : -0.32) + (rand() - 0.5) * 0.25) * Math.PI;
    const center = new Vector3(
      Math.cos(lat) * Math.cos(theta),
      Math.sin(lat),
      Math.cos(lat) * Math.sin(theta),
    ).normalize().multiplyScalar(radiusM);

    clusters.push({
      id: c,
      center,
      meanVelocity: new Vector3(),
      particleIndices: [],
      radius: minClusterRadius + rand() * (maxClusterRadius - minClusterRadius),
      layer0Mesh,
      layer1Mesh,
      layer2Mesh,
    });
  }

  let activeFlowSpeed = options.flowSpeed ?? 1.0;
  let activeLayerCount = layerCount;

  const windParams: ISphereWindFieldParams = {
    zonalSpeed: 0.04,
    zonalFrequency: 3.5,
    curlFrequency: 2.2,
    curlStrength: 0.08,
  };

  const tempNorm = new Vector3();
  const tempFlow = new Vector3();
  const tempQ = new Quaternion();
  const upVec = new Vector3(0, 0, 1);

  return {
    group,
    update(deltaSeconds: number, timeS: number) {
      const dt = deltaSeconds * activeFlowSpeed;

      // 1. Advect all underlying wind particles with spherical RK2 wind field
      for (let i = 0; i < particleCount; i++) {
        const p = particles[i];
        tempNorm.copy(p.position).normalize();
        windFieldSphere3D(tempNorm, timeS * activeFlowSpeed, windParams, tempFlow);
        p.velocity.copy(tempFlow).multiplyScalar(radiusM * 1.5);
        p.position.addScaledVector(p.velocity, dt);
        p.position.normalize().multiplyScalar(radiusM);
      }

      // 2. Clear previous cluster assignments and associate particles to nearest clusters
      for (const cl of clusters) {
        cl.particleIndices.length = 0;
      }

      for (let i = 0; i < particleCount; i++) {
        const p = particles[i];
        let closestDistSq = Infinity;
        let closestCluster: IParticleCluster | null = null;

        for (const cl of clusters) {
          const dSq = p.position.distanceToSquared(cl.center);
          if (dSq < closestDistSq) {
            closestDistSq = dSq;
            closestCluster = cl;
          }
        }

        if (closestCluster && closestDistSq < (closestCluster.radius * 2.2) ** 2) {
          closestCluster.particleIndices.push(i);
        }
      }

      // 3. For each cluster with enough particles, calculate centroid, flow velocity & stream offset
      for (let c = 0; c < maxClusters; c++) {
        const cl = clusters[c];
        const count = cl.particleIndices.length;

        // If not enough particles nearby, fade out this cluster smoothly
        if (count < 3) {
          cl.layer0Mesh.visible = false;
          cl.layer1Mesh.visible = false;
          cl.layer2Mesh.visible = false;
          continue;
        }

        // Calculate particle centroid and mean velocity
        const centroid = new Vector3();
        const meanVel = new Vector3();

        for (const idx of cl.particleIndices) {
          centroid.add(particles[idx].position);
          meanVel.add(particles[idx].velocity);
        }
        centroid.divideScalar(count).normalize().multiplyScalar(radiusM);
        meanVel.divideScalar(count);

        cl.center.lerp(centroid, 0.08);
        cl.meanVelocity.lerp(meanVel, 0.08);

        const normal = cl.center.clone().normalize();
        tempQ.setFromUnitVectors(upVec, normal);

        // Alignment stream vector along the particle cluster's actual wind direction
        const streamTangent = cl.meanVelocity.clone().projectOnPlane(normal).normalize();
        const streamOffset = streamTangent.clone().multiplyScalar(cl.radius * 0.28);

        // Layer 0: Base Large Outer Layer (Defines overall cluster footprint)
        cl.layer0Mesh.position.copy(cl.center);
        cl.layer0Mesh.quaternion.copy(tempQ);
        cl.layer0Mesh.scale.set(cl.radius, cl.radius * 0.8, 1);
        cl.layer0Mesh.visible = activeLayerCount >= 1;

        // Layer 1: Mid Layer (Aligned and shifted along the stream direction)
        if (activeLayerCount >= 2) {
          const midPos = cl.center.clone().add(streamOffset).normalize().multiplyScalar(radiusM + 0.35);
          const midNormal = midPos.clone().normalize();
          const midQ = new Quaternion().setFromUnitVectors(upVec, midNormal);

          cl.layer1Mesh.position.copy(midPos);
          cl.layer1Mesh.quaternion.copy(midQ);
          cl.layer1Mesh.scale.set(cl.radius * 0.68, cl.radius * 0.52, 1);
          cl.layer1Mesh.visible = true;
        } else {
          cl.layer1Mesh.visible = false;
        }

        // Layer 2: Core Dense Layer (Shifted further along wind flow to show internal particle motion)
        if (activeLayerCount >= 3) {
          const corePos = cl.center.clone().addScaledVector(streamOffset, 1.8).normalize().multiplyScalar(radiusM + 0.7);
          const coreNormal = corePos.clone().normalize();
          const coreQ = new Quaternion().setFromUnitVectors(upVec, coreNormal);

          cl.layer2Mesh.position.copy(corePos);
          cl.layer2Mesh.quaternion.copy(coreQ);
          cl.layer2Mesh.scale.set(cl.radius * 0.42, cl.radius * 0.32, 1);
          cl.layer2Mesh.visible = true;
        } else {
          cl.layer2Mesh.visible = false;
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
