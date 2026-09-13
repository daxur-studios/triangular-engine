import {
  Color,
  PerspectiveCamera,
  Raycaster,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import { EngineService } from 'triangular-engine';

export interface IProbeStationConfig {
  readonly name?: string;
  readonly distanceM: number;
  readonly azimuthDeg: number;
  readonly pitchDeg: number;
  readonly target?: [number, number, number];
}

export interface ISeamProbeOptions {
  readonly renderTargetResolution?: number;
  readonly sweepStations?: readonly IProbeStationConfig[];
  readonly levelCount?: number;
  readonly baseTileSizeM?: number;
  readonly blockRadiusTiles?: number;
  readonly finestSwitchDistanceM?: number;
  readonly outerRadiusM?: number;
}

export interface ILeakCluster {
  readonly pixelCount: number;
  readonly screenUV: [number, number];
  readonly groundWorldXZ: [number, number];
  readonly approxDistanceM: number;
  readonly approxLevel: number;
  readonly boundaryDescription: string;
}

export interface IStationLeakReport {
  readonly stationIndex: number;
  readonly name: string;
  readonly cameraPosition: [number, number, number];
  readonly pitchDeg: number;
  readonly distanceM: number;
  readonly leakPixelCount: number;
  readonly clusters: readonly ILeakCluster[];
}

export interface ISeamProbeResult {
  readonly passed: boolean;
  readonly totalLeakPixels: number;
  readonly stationsChecked: number;
  readonly stationsFailed: number;
  readonly stationReports: readonly IStationLeakReport[];
  readonly textReport: string;
}

/**
 * Standard diagnostic sweep stations designed to catch LOD boundary cracks,
 * T-junction leaks, and missing tiles across near, mid, and horizon distances.
 */
export const DEFAULT_PROBE_STATIONS: readonly IProbeStationConfig[] = [
  // High-angle downward views directly onto near-field ring boundaries (Levels 0-2)
  { name: 'Near-field Downward (North)', distanceM: 65, azimuthDeg: 0, pitchDeg: -60 },
  { name: 'Near-field Downward (East)', distanceM: 65, azimuthDeg: 90, pitchDeg: -60 },
  { name: 'Near-field Downward (South)', distanceM: 65, azimuthDeg: 180, pitchDeg: -60 },
  { name: 'Near-field Downward (West)', distanceM: 65, azimuthDeg: 270, pitchDeg: -60 },

  // Oblique views crossing intermediate ring transitions (Levels 1-4)
  { name: 'Mid-range Oblique (NE)', distanceM: 180, azimuthDeg: 45, pitchDeg: -35 },
  { name: 'Mid-range Oblique (SW)', distanceM: 180, azimuthDeg: 225, pitchDeg: -35 },

  // Far oblique views looking across outer rings
  { name: 'Far-range Oblique (NW)', distanceM: 800, azimuthDeg: 315, pitchDeg: -25 },
  { name: 'Far-range Oblique (SE)', distanceM: 800, azimuthDeg: 135, pitchDeg: -25 },

  // Horizon-scale views
  { name: 'Horizon Overview (High)', distanceM: 3500, azimuthDeg: 45, pitchDeg: -30 },
  { name: 'Horizon Overview (Low)', distanceM: 3500, azimuthDeg: 200, pitchDeg: -18 },
];

/**
 * Programmatically inspects the rendered clipmap for cracks, holes, or missing tiles
 * by rendering offscreen with a sentinel background color and unprojecting any leaking
 * pixels back into world space. Produces a token-efficient plain text report suitable
 * for AI coding agents and automated CI verifications.
 */
export async function probeSeamsAndGaps(
  engine: EngineService,
  options?: ISeamProbeOptions,
): Promise<ISeamProbeResult> {
  const camera = engine.camera$.value as PerspectiveCamera | null;
  if (!camera) {
    throw new Error('probeSeamsAndGaps: EngineService has no active camera.');
  }

  const renderer = engine.renderer as WebGLRenderer;
  const resolution = options?.renderTargetResolution ?? 256;
  const stations = options?.sweepStations ?? DEFAULT_PROBE_STATIONS;
  const baseTileSizeM = options?.baseTileSizeM ?? 16;
  const blockRadiusTiles = options?.blockRadiusTiles ?? 4;
  const levelCount = options?.levelCount ?? 12;
  const finestSwitchDistanceM = options?.finestSwitchDistanceM ?? baseTileSizeM * blockRadiusTiles;
  const outerRadiusM = options?.outerRadiusM ?? baseTileSizeM * 2 ** (levelCount - 1) * blockRadiusTiles;

  // Save current renderer state
  const prevRenderTarget = renderer.getRenderTarget();
  const prevClearColor = new Color();
  (renderer as any).getClearColor(prevClearColor);
  const prevClearAlpha = renderer.getClearAlpha();
  const prevCamPos = camera.position.clone();
  const prevCamRot = camera.rotation.clone();

  // Create offscreen render target for sentinel rendering
  const renderTarget = new WebGLRenderTarget(resolution, resolution, {
    depthBuffer: true,
    stencilBuffer: false,
  });

  const sentinelColor = new Color('#ff00ff');
  const pixelBuffer = new Uint8Array(resolution * resolution * 4);
  const stationReports: IStationLeakReport[] = [];
  let totalLeakPixels = 0;

  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const groundHit = new Vector3();

  try {
    for (let stationIdx = 0; stationIdx < stations.length; stationIdx++) {
      const config = stations[stationIdx]!;
      const name = config.name ?? `Station #${stationIdx + 1}`;
      const target = config.target ? new Vector3(...config.target) : new Vector3(0, 0, 0);

      // Compute camera position from spherical distance, azimuth, pitch
      const pitchRad = (config.pitchDeg * Math.PI) / 180;
      const azRad = (config.azimuthDeg * Math.PI) / 180;
      const horizDist = config.distanceM * Math.cos(pitchRad);
      const camY = target.y - config.distanceM * Math.sin(pitchRad);
      const camX = target.x + horizDist * Math.sin(azRad);
      const camZ = target.z + horizDist * Math.cos(azRad);

      camera.position.set(camX, Math.max(camY, 5), camZ);
      camera.lookAt(target);
      camera.updateMatrixWorld();

      // Render offscreen with sentinel clear color (magenta, alpha 0)
      renderer.setRenderTarget(renderTarget);
      renderer.setClearColor(sentinelColor, 0);
      renderer.clear();
      renderer.render(engine.scene, camera);

      // Read back pixels
      renderer.readRenderTargetPixels(
        renderTarget,
        0,
        0,
        resolution,
        resolution,
        pixelBuffer,
      );

      // Scan for leak pixels (alpha === 0 or magenta sentinel)
      const rawLeaks: { px: number; py: number; worldX: number; worldZ: number; dist: number }[] = [];

      for (let py = 0; py < resolution; py++) {
        for (let px = 0; px < resolution; px++) {
          const idx = (py * resolution + px) * 4;
          const a = pixelBuffer[idx + 3]!;
          const r = pixelBuffer[idx]!;
          const g = pixelBuffer[idx + 1]!;
          const b = pixelBuffer[idx + 2]!;

          // Opaque terrain fragments always write alpha = 1.0 (255)
          const isBackground = a === 0 || (r === 255 && g === 0 && b === 255);
          if (!isBackground) continue;

          // Convert to NDC (-1 to +1)
          ndc.x = (px / resolution) * 2 - 1;
          ndc.y = (py / resolution) * 2 - 1;

          raycaster.setFromCamera(ndc, camera);
          const dir = raycaster.ray.direction;

          // Intersect ray with ground plane Y = 0
          if (dir.y >= -0.01) continue; // Heading upwards towards sky, expected background
          const t = -camera.position.y / dir.y;
          if (t <= 0) continue;

          groundHit.copy(raycaster.ray.origin).addScaledVector(dir, t);
          const distToCam = Math.hypot(
            groundHit.x - camera.position.x,
            groundHit.z - camera.position.z,
          );

          // Only flag as a leak if the hit is well within the active terrain radius
          if (distToCam < outerRadiusM * 0.85) {
            rawLeaks.push({
              px,
              py,
              worldX: groundHit.x,
              worldZ: groundHit.z,
              dist: distToCam,
            });
          }
        }
      }

      totalLeakPixels += rawLeaks.length;

      // Cluster leaks within 6 pixels of each other
      const clusters: ILeakCluster[] = [];
      const visited = new Set<number>();

      for (let i = 0; i < rawLeaks.length; i++) {
        if (visited.has(i)) continue;
        visited.add(i);

        let count = 1;
        let sumPx = rawLeaks[i]!.px;
        let sumPy = rawLeaks[i]!.py;
        let sumWx = rawLeaks[i]!.worldX;
        let sumWz = rawLeaks[i]!.worldZ;
        let sumDist = rawLeaks[i]!.dist;

        for (let j = i + 1; j < rawLeaks.length; j++) {
          if (visited.has(j)) continue;
          const dx = rawLeaks[i]!.px - rawLeaks[j]!.px;
          const dy = rawLeaks[i]!.py - rawLeaks[j]!.py;
          if (dx * dx + dy * dy <= 36) {
            visited.add(j);
            count++;
            sumPx += rawLeaks[j]!.px;
            sumPy += rawLeaks[j]!.py;
            sumWx += rawLeaks[j]!.worldX;
            sumWz += rawLeaks[j]!.worldZ;
            sumDist += rawLeaks[j]!.dist;
          }
        }

        const avgPx = sumPx / count;
        const avgPy = sumPy / count;
        const avgWx = sumWx / count;
        const avgWz = sumWz / count;
        const avgDist = sumDist / count;

        const approxLevel = Math.min(
          levelCount - 1,
          Math.max(0, Math.floor(Math.log2(Math.max(1, avgDist / finestSwitchDistanceM)))),
        );
        const tileSizeAtL = baseTileSizeM * 2 ** approxLevel;

        clusters.push({
          pixelCount: count,
          screenUV: [
            Math.round((avgPx / resolution) * 100) / 100,
            Math.round((avgPy / resolution) * 100) / 100,
          ],
          groundWorldXZ: [
            Math.round(avgWx * 10) / 10,
            Math.round(avgWz * 10) / 10,
          ],
          approxDistanceM: Math.round(avgDist),
          approxLevel,
          boundaryDescription: `Level ${approxLevel} ring (tile size ${tileSizeAtL}m, ~${Math.round(avgDist)}m from cam)`,
        });
      }

      stationReports.push({
        stationIndex: stationIdx + 1,
        name,
        cameraPosition: [
          Math.round(camX * 10) / 10,
          Math.round(camY * 10) / 10,
          Math.round(camZ * 10) / 10,
        ],
        pitchDeg: config.pitchDeg,
        distanceM: config.distanceM,
        leakPixelCount: rawLeaks.length,
        clusters,
      });
    }
  } finally {
    // Restore renderer and camera state
    renderTarget.dispose();
    renderer.setRenderTarget(prevRenderTarget as any);
    renderer.setClearColor(prevClearColor, prevClearAlpha);
    camera.position.copy(prevCamPos);
    camera.rotation.copy(prevCamRot);
    camera.updateMatrixWorld();
  }

  const failedStations = stationReports.filter((s) => s.leakPixelCount > 0);
  const passed = totalLeakPixels === 0;

  // Format compact, token-efficient plain text report
  const lines: string[] = [
    `=== TERRAIN SEAM & GAP SENTINEL REPORT ===`,
    `Status: ${passed ? 'PASS (Zero seams/gaps detected)' : `FAIL (${totalLeakPixels} leaking pixels across ${failedStations.length} stations)`}`,
    `Stations probed: ${stations.length} | Resolution: ${resolution}x${resolution}`,
    `Levels: ${levelCount} | Base tile: ${baseTileSizeM}m | Max tested radius: ${Math.round(outerRadiusM * 0.85)}m`,
  ];

  if (!passed) {
    lines.push(`Defect Details:`);
    for (const st of failedStations) {
      lines.push(
        `  Station #${st.stationIndex} [${st.name}] cam=[${st.cameraPosition.join(', ')}] pitch=${st.pitchDeg}° -> ${st.leakPixelCount} leak px`,
      );
      for (const cl of st.clusters.slice(0, 5)) {
        lines.push(
          `    - Leak cluster (${cl.pixelCount}px) @ UV=(${cl.screenUV[0]}, ${cl.screenUV[1]}) -> World=(${cl.groundWorldXZ[0]}, ${cl.groundWorldXZ[1]}) in ${cl.boundaryDescription}`,
        );
      }
      if (st.clusters.length > 5) {
        lines.push(`    - ... and ${st.clusters.length - 5} more clusters`);
      }
    }
  } else {
    lines.push(`All ${stations.length} camera angles verified: 100% solid watertight coverage, zero background leakage.`);
  }
  lines.push(`==========================================`);

  return {
    passed,
    totalLeakPixels,
    stationsChecked: stations.length,
    stationsFailed: failedStations.length,
    stationReports,
    textReport: lines.join('\n'),
  };
}
