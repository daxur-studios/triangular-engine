import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  GridHelper,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  adaptTransitGraphToTerrain,
  buildCityBuildingsInstancedMesh,
  buildRoadSpanMesh,
  CityTransitGraphBuilder,
  deriveRoadSpanColliders,
  evaluateCorridorGrading,
  generateGridCityBuildings,
  generateVoronoiCity,
  ICityBuildingInstance,
  ICityCrossSection,
  ICityTransitGraph,
} from 'triangular-engine/procedural';

export type CityLayoutMode =
  | 'organic-voronoi'
  | 'grid-metropolis'
  | 'valley-bridge'
  | 'mountain-tunnel';

export type TerrainPreset = 'rolling-hills' | 'flat' | 'deep-valley' | 'mountain-ridge';

@Component({
  selector: 'app-cities-lab-page',
  standalone: true,
  imports: [RouterLink, EngineModule],
  templateUrl: './cities-lab-page.component.html',
  styleUrls: ['./cities-lab-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class CitiesLabPageComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly engine = inject(EngineService);

  // Layout & Terrain
  public readonly layoutMode = signal<CityLayoutMode>('organic-voronoi');
  public readonly terrainPreset = signal<TerrainPreset>('rolling-hills');
  public readonly seed = signal<number>(555);

  // Voronoi / Organic Old Town Parameters
  public readonly voronoiCellCount = signal<number>(28);
  public readonly lloydPasses = signal<number>(2);

  // Grid Parameters
  public readonly gridBlockSize = signal<number>(5);

  // Shared Building Parameters
  public readonly showBuildings = signal<boolean>(true);
  public readonly maxBuildingHeightM = signal<number>(42.0);
  public readonly buildingDensity = signal<number>(0.85);

  // Road & Bridge Dimensions
  public readonly roadwayWidthM = signal<number>(8.0);
  public readonly sidewalkWidthM = signal<number>(1.5);
  public readonly curbHeightM = signal<number>(0.15);
  public readonly greenVergeWidthM = signal<number>(0.0);
  public readonly bridgeDeckThicknessM = signal<number>(1.4);
  public readonly bridgePierRadiusM = signal<number>(1.0);
  public readonly bridgeThresholdM = signal<number>(3.5);
  public readonly tunnelThresholdM = signal<number>(6.0);

  // Visualization Toggles
  public readonly showColliders = signal<boolean>(false);
  public readonly showTerrainGrading = signal<boolean>(true);
  public readonly wireframe = signal<boolean>(false);
  public readonly logarithmicDepthBuffer = signal<boolean>(true);

  // Real-time Metrics
  public readonly cityMetrics = signal<{
    buildingCount: number;
    drawCalls: number;
    cellCount: number;
    totalSpans: number;
    surfaceSpans: number;
    bridgeSpans: number;
    tunnelSpans: number;
    pierCount: number;
  }>({
    buildingCount: 0,
    drawCalls: 0,
    cellCount: 0,
    totalSpans: 0,
    surfaceSpans: 0,
    bridgeSpans: 0,
    tunnelSpans: 0,
    pierCount: 0,
  });

  private readonly rootGroup = new Group();
  private readonly terrainGroup = new Group();
  private readonly roadGroup = new Group();
  private readonly buildingsGroup = new Group();
  private readonly colliderGroup = new Group();

  constructor() {
    const previousBackground = this.engine.scene.background;
    this.engine.scene.background = new Color('#0f172a');

    this.engine.scene.add(this.rootGroup);
    this.rootGroup.add(this.terrainGroup);
    this.rootGroup.add(this.roadGroup);
    this.rootGroup.add(this.buildingsGroup);
    this.rootGroup.add(this.colliderGroup);

    const grid = new GridHelper(320, 64, 0x475569, 0x1e293b);
    grid.position.y = -0.05;
    this.rootGroup.add(grid);

    this.rebuildScene();

    this.destroyRef.onDestroy(() => {
      this.clearAll();
      this.engine.scene.remove(this.rootGroup);
      this.engine.scene.background = previousBackground;
    });
  }

  public setLayoutMode(mode: CityLayoutMode): void {
    this.layoutMode.set(mode);
    if (mode === 'organic-voronoi') {
      this.roadwayWidthM.set(8.0);
      this.sidewalkWidthM.set(1.5);
      this.maxBuildingHeightM.set(42.0);
      this.terrainPreset.set('rolling-hills');
    } else if (mode === 'grid-metropolis') {
      this.roadwayWidthM.set(14.0);
      this.sidewalkWidthM.set(3.0);
      this.maxBuildingHeightM.set(90.0);
    } else if (mode === 'valley-bridge') {
      this.terrainPreset.set('deep-valley');
    } else if (mode === 'mountain-tunnel') {
      this.terrainPreset.set('mountain-ridge');
    }
    this.rebuildScene();
  }

  public setTerrainPreset(preset: TerrainPreset): void {
    this.terrainPreset.set(preset);
    this.rebuildScene();
  }

  public randomizeSeed(): void {
    this.seed.set(Math.floor(Math.random() * 90000) + 1000);
    this.rebuildScene();
  }

  public updateVoronoiCells(val: number): void {
    this.voronoiCellCount.set(val);
    this.rebuildScene();
  }

  public updateLloydPasses(val: number): void {
    this.lloydPasses.set(val);
    this.rebuildScene();
  }

  public updateGridSize(size: number): void {
    this.gridBlockSize.set(size);
    this.rebuildScene();
  }

  public updateMaxHeight(val: number): void {
    this.maxBuildingHeightM.set(val);
    this.rebuildScene();
  }

  public updateBuildingDensity(val: number): void {
    this.buildingDensity.set(val);
    this.rebuildScene();
  }

  public updateRoadwayWidth(val: number): void {
    this.roadwayWidthM.set(val);
    this.rebuildScene();
  }

  public updateBridgeThreshold(val: number): void {
    this.bridgeThresholdM.set(val);
    this.rebuildScene();
  }

  public toggleBuildings(): void {
    this.showBuildings.update((v) => !v);
    this.buildingsGroup.visible = this.showBuildings();
  }

  public toggleColliders(): void {
    this.showColliders.update((v) => !v);
    this.colliderGroup.visible = this.showColliders();
  }

  public toggleTerrainGrading(): void {
    this.showTerrainGrading.update((v) => !v);
    this.rebuildScene();
  }

  public toggleWireframe(): void {
    this.wireframe.update((v) => !v);
    this.rebuildScene();
  }

  public toggleLogarithmicDepthBuffer(): void {
    this.logarithmicDepthBuffer.update((v) => !v);
  }

  public rebuildScene(): void {
    this.clearAll();

    const crossSection: ICityCrossSection = {
      roadwayWidthM: this.roadwayWidthM(),
      sidewalkWidthM: this.sidewalkWidthM(),
      curbHeightM: this.curbHeightM(),
      greenVergeWidthM: this.greenVergeWidthM(),
      medianWidthM: 2.0,
    };

    const nativeElevationFn = this.getNativeTerrainSampler(this.terrainPreset());

    let graph: ICityTransitGraph;
    let voronoiBuildingGeom: BufferGeometry | null = null;
    let vResultRoadGeom: BufferGeometry | null = null;
    let gridBuildings: readonly ICityBuildingInstance[] = [];
    let buildingCount = 0;
    let voronoiCellCount = 0;

    if (this.layoutMode() === 'organic-voronoi') {
      const vResult = generateVoronoiCity(nativeElevationFn, crossSection, {
        radiusM: 110.0,
        seedCount: this.voronoiCellCount(),
        lloydIterations: this.lloydPasses(),
        streetWidthM: this.roadwayWidthM() + 2 * this.sidewalkWidthM(),
        density: this.buildingDensity(),
        seed: this.seed(),
      });
      graph = vResult.graph;
      voronoiBuildingGeom = vResult.buildingsMeshGeometry;
      vResultRoadGeom = vResult.roadMeshGeometry;
      buildingCount = vResult.buildingCount;
      voronoiCellCount = vResult.cells.length;
    } else {
      graph = this.buildTransitGraph(this.layoutMode(), crossSection);
    }

    // 1. Road-Terrain Adaptation
    const adaptation = adaptTransitGraphToTerrain(graph, nativeElevationFn, {
      bridgeElevationThresholdM: this.bridgeThresholdM(),
      tunnelDepthThresholdM: this.tunnelThresholdM(),
      bridgePierSpacingM: 18.0,
      samples: 28,
    });

    // 2. Graded Terrain Sampler
    const gradedElevationFn = (x: number, z: number) => {
      let h = nativeElevationFn(x, z);
      if (!this.showTerrainGrading()) return h;
      for (const intent of adaptation.modificationIntents) {
        h = evaluateCorridorGrading(h, intent, x, z);
      }
      return h;
    };

    // 3. Build Terrain Mesh (1 Draw Call)
    this.buildTerrainMesh(gradedElevationFn);

    // 4. Build Buildings
    if (this.layoutMode() === 'organic-voronoi' && voronoiBuildingGeom) {
      const bldgMat = new MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.8,
        metalness: 0.15,
        wireframe: this.wireframe(),
        side: DoubleSide,
      });
      const bldgMesh = new Mesh(voronoiBuildingGeom, bldgMat);
      this.buildingsGroup.add(bldgMesh);
    } else if (this.layoutMode() === 'grid-metropolis') {
      gridBuildings = generateGridCityBuildings(gradedElevationFn, {
        blockCountX: this.gridBlockSize(),
        blockCountZ: this.gridBlockSize(),
        blockSizeM: 36.0,
        streetWidthM: this.roadwayWidthM() + 2 * this.sidewalkWidthM(),
        maxFloorsHeightM: this.maxBuildingHeightM(),
        densityFactor: this.buildingDensity(),
        seed: this.seed(),
      });
      buildingCount = gridBuildings.length;

      if (gridBuildings.length > 0) {
        const instancedMesh = buildCityBuildingsInstancedMesh(gridBuildings, {
          wireframe: this.wireframe(),
          foundationDepthM: 3.0,
        });
        this.buildingsGroup.add(instancedMesh);
      }
    }
    this.buildingsGroup.visible = this.showBuildings();

    // 5. Merged Road & Pier Geometries (Ultra-fast batching: 1-2 Draw Calls!)
    const roadGeometries: BufferGeometry[] = [];
    const pierGeometries: BufferGeometry[] = [];
    const colliderGeometries: BufferGeometry[] = [];

    let totalPiers = 0;
    let surfaceCount = 0;
    let bridgeCount = 0;
    let tunnelCount = 0;

    for (const span of adaptation.spans) {
      if (span.type === 'surface') surfaceCount++;
      if (span.type === 'bridge') bridgeCount++;
      if (span.type === 'tunnel') tunnelCount++;

      const meshResult = buildRoadSpanMesh(span, crossSection, {
        bridgeDeckThicknessM: this.bridgeDeckThicknessM(),
        pierRadiusM: this.bridgePierRadiusM(),
      });

      if (meshResult.roadGeometry && meshResult.roadGeometry.getAttribute('position')) {
        roadGeometries.push(meshResult.roadGeometry);
      }

      if (meshResult.bridgePiersGeometry && meshResult.bridgePiersGeometry.getAttribute('position')) {
        pierGeometries.push(meshResult.bridgePiersGeometry);
      }

      if (span.pierPositions) {
        totalPiers += span.pierPositions.length;
      }

      // Physics Colliders
      const colliders = deriveRoadSpanColliders(span, crossSection, {
        bridgeDeckThicknessM: this.bridgeDeckThicknessM(),
        pierRadiusM: this.bridgePierRadiusM(),
      });

      for (const col of colliders) {
        let colGeom: BufferGeometry;
        if (col.shape === 'box') {
          colGeom = new BoxGeometry(col.params[0], col.params[1], col.params[2]);
          const quat = new Quaternion(
            col.rotation[0],
            col.rotation[1],
            col.rotation[2],
            col.rotation[3],
          );
          colGeom.applyQuaternion(quat);
          colGeom.translate(col.position[0], col.position[1], col.position[2]);
        } else {
          const radius = col.params[1];
          const height = col.params[0] * 2;
          colGeom = new CylinderGeometry(radius, radius, height, 10);
          colGeom.translate(col.position[0], col.position[1], col.position[2]);
        }
        colliderGeometries.push(colGeom);
      }
    }

    let roadDrawCalls = 0;
    let roadMeshToRender: BufferGeometry | null = null;

    if (this.layoutMode() === 'organic-voronoi' && vResultRoadGeom && vResultRoadGeom.getAttribute('position')) {
      roadMeshToRender = vResultRoadGeom;
    } else if (roadGeometries.length > 0) {
      roadMeshToRender = mergeGeometries(roadGeometries, false);
    }

    if (roadMeshToRender) {
      const roadMat = new MeshStandardMaterial({
        color: this.layoutMode() === 'organic-voronoi' ? 0x47423d : 0x22252a, // Venetian cobblestone vs asphalt
        roughness: 0.92,
        metalness: 0.05,
        wireframe: this.wireframe(),
        side: DoubleSide,
      });
      const mergedRoadMesh = new Mesh(roadMeshToRender, roadMat);
      this.roadGroup.add(mergedRoadMesh);
      roadDrawCalls++;
    }

    // Single merged bridge pier mesh
    if (pierGeometries.length > 0) {
      const mergedPierGeom = mergeGeometries(pierGeometries, false);
      if (mergedPierGeom) {
        const bridgePierMat = new MeshStandardMaterial({
          color: 0x7c8590,
          roughness: 0.6,
          metalness: 0.2,
          wireframe: this.wireframe(),
        });
        const mergedPierMesh = new Mesh(mergedPierGeom, bridgePierMat);
        this.roadGroup.add(mergedPierMesh);
        roadDrawCalls++;
      }
    }

    // Single merged collider debug mesh
    if (colliderGeometries.length > 0) {
      const mergedColliderGeom = mergeGeometries(colliderGeometries, false);
      if (mergedColliderGeom) {
        const colliderMat = new MeshBasicMaterial({
          color: 0x00e5ff,
          wireframe: true,
        });
        const mergedColliderMesh = new Mesh(mergedColliderGeom, colliderMat);
        this.colliderGroup.add(mergedColliderMesh);
      }
    }

    this.colliderGroup.visible = this.showColliders();

    const totalDrawCalls =
      1 + // Terrain
      (buildingCount > 0 ? 1 : 0) + // Buildings
      roadDrawCalls + // Merged roads & piers
      (this.showColliders() && colliderGeometries.length > 0 ? 1 : 0);

    this.cityMetrics.set({
      buildingCount,
      drawCalls: totalDrawCalls,
      cellCount: voronoiCellCount,
      totalSpans: adaptation.spans.length,
      surfaceSpans: surfaceCount,
      bridgeSpans: bridgeCount,
      tunnelSpans: tunnelCount,
      pierCount: totalPiers,
    });
  }

  private buildTerrainMesh(elevationFn: (x: number, z: number) => number): void {
    const size = 260;
    const segments = 110;
    const geom = new PlaneGeometry(size, size, segments, segments);
    geom.rotateX(-Math.PI / 2);

    const posAttr = geom.getAttribute('position') as BufferAttribute;
    const colors: number[] = [];

    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      const y = elevationFn(x, z);
      posAttr.setY(i, y);

      const altNorm = Math.max(0, Math.min(1, y / 30.0));
      const col = new Color().lerpColors(
        new Color(0x2f5233), // meadow green
        new Color(0x6b6354), // hillside earth
        altNorm,
      );
      colors.push(col.r, col.g, col.b);
    }

    geom.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
    geom.computeVertexNormals();

    const terrainMat = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.05,
      wireframe: this.wireframe(),
      side: DoubleSide,
    });

    const terrainMesh = new Mesh(geom, terrainMat);
    this.terrainGroup.add(terrainMesh);
  }

  private getNativeTerrainSampler(preset: TerrainPreset): (x: number, z: number) => number {
    switch (preset) {
      case 'deep-valley':
        return (x: number, z: number) => {
          const distFromCenter = Math.abs(x);
          if (distFromCenter < 35) {
            const canyonShape = Math.sin((distFromCenter / 35) * (Math.PI / 2));
            return canyonShape * 22;
          }
          return 22;
        };

      case 'mountain-ridge':
        return (x: number, z: number) => {
          const distFromCenter = Math.abs(x);
          if (distFromCenter < 35) {
            const ridge = Math.cos((distFromCenter / 35) * (Math.PI / 2));
            return ridge * 28;
          }
          return 0;
        };

      case 'rolling-hills':
        return (x: number, z: number) => {
          return (
            Math.sin(x * 0.04) * 5 +
            Math.cos(z * 0.035) * 4 +
            Math.sin(x * 0.015 + z * 0.015) * 3 +
            6
          );
        };

      case 'flat':
      default:
        return () => 0;
    }
  }

  private buildTransitGraph(
    mode: CityLayoutMode,
    crossSection: ICityCrossSection,
  ): ICityTransitGraph {
    const builder = new CityTransitGraphBuilder();

    if (mode === 'grid-metropolis') {
      const blocks = this.gridBlockSize();
      const blockSize = 36.0;
      const streetW = crossSection.roadwayWidthM + 2 * crossSection.sidewalkWidthM;
      const totalSpan = blocks * (blockSize + streetW);
      const halfSpan = totalSpan * 0.5;

      for (let i = 0; i <= blocks; i++) {
        const z = -halfSpan + i * (blockSize + streetW);
        const nodeA = `gh_${i}_a`;
        const nodeB = `gh_${i}_b`;
        builder
          .addNode({ id: nodeA, position: [-halfSpan, 8, z], layer: 0, junctionType: 'endpoint' })
          .addNode({ id: nodeB, position: [halfSpan, 8, z], layer: 0, junctionType: 'endpoint' })
          .addEdge({
            id: `edge_h_${i}`,
            fromNodeId: nodeA,
            toNodeId: nodeB,
            layer: 0,
            allowedTransitTypes: ['car', 'pedestrian'],
            speedLimitKmh: 50,
            crossSection,
          });
      }

      for (let j = 0; j <= blocks; j++) {
        const x = -halfSpan + j * (blockSize + streetW);
        const nodeA = `gv_${j}_a`;
        const nodeB = `gv_${j}_b`;
        builder
          .addNode({ id: nodeA, position: [x, 8, -halfSpan], layer: 0, junctionType: 'endpoint' })
          .addNode({ id: nodeB, position: [x, 8, halfSpan], layer: 0, junctionType: 'endpoint' })
          .addEdge({
            id: `edge_v_${j}`,
            fromNodeId: nodeA,
            toNodeId: nodeB,
            layer: 0,
            allowedTransitTypes: ['car', 'pedestrian'],
            speedLimitKmh: 50,
            crossSection,
          });
      }
    } else if (mode === 'valley-bridge') {
      builder
        .addNode({ id: 'w_end', position: [-85, 22, 0], layer: 0, junctionType: 'endpoint' })
        .addNode({ id: 'e_end', position: [85, 22, 0], layer: 0, junctionType: 'endpoint' })
        .addEdge({
          id: 'e_highway_bridge',
          fromNodeId: 'w_end',
          toNodeId: 'e_end',
          layer: 0,
          allowedTransitTypes: ['car', 'truck'],
          speedLimitKmh: 100,
          crossSection,
        });
    } else if (mode === 'mountain-tunnel') {
      builder
        .addNode({ id: 'w_entry', position: [-85, 2, 0], layer: 0, junctionType: 'endpoint' })
        .addNode({ id: 'e_exit', position: [85, 2, 0], layer: 0, junctionType: 'endpoint' })
        .addEdge({
          id: 'e_ridge_tunnel',
          fromNodeId: 'w_entry',
          toNodeId: 'e_exit',
          layer: 0,
          allowedTransitTypes: ['car'],
          speedLimitKmh: 60,
          crossSection,
        });
    }

    return builder.build();
  }

  private clearAll(): void {
    this.clearGroup(this.terrainGroup);
    this.clearGroup(this.roadGroup);
    this.clearGroup(this.buildingsGroup);
    this.clearGroup(this.colliderGroup);
  }

  private clearGroup(group: Group): void {
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      if (child instanceof Mesh || child instanceof InstancedMesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material?.dispose();
        }
      }
    }
  }
}
