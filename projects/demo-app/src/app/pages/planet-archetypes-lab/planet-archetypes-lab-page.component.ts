import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  buildPlanetEcology,
  buildPlanetGraphCore,
  buildPlanetTectonics,
  createPlanetSurfaceSampler,
  findCellAt,
  generateImpactCraters,
  IImpactCraterResult,
  IPlanetEcology,
  IPlanetGraphCore,
  IPlanetTectonics,
  WORLD_PROFILES,
  WorldProfileKind,
} from 'triangular-engine/worldgen';
import {
  biomeColor,
  buildPlanetGlobeGeometry,
  elevationColor,
  IPlanetGlobeGeometry,
  lavaOceanColor,
} from 'triangular-engine/worldgen/render';

export type ArchetypeColorMode = 'biome' | 'elevation' | 'craters';
export type SurfaceRenderMode = 'cells' | 'continuous';

interface ICellInspectInfo {
  id: number;
  biome: string;
  elevation: number;
  craterLandform: string;
}

@Component({
  selector: 'app-planet-archetypes-lab-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, EngineModule],
  templateUrl: './planet-archetypes-lab-page.component.html',
  styleUrls: ['./planet-archetypes-lab-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class PlanetArchetypesLabPageComponent {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);

  readonly archetypeKinds: { id: WorldProfileKind; label: string; icon: string; desc: string }[] = [
    {
      id: 'moon',
      label: 'Moon (Luna)',
      icon: '🌑',
      desc: 'Airless stagnant single-plate crust dominated by multi-scale impact craters, massive multi-cell impact basins (Maria) infilled with flat basalt lava, and bright anorthositic highlands.',
    },
    {
      id: 'mars',
      label: 'Mars (Ares)',
      icon: '🔴',
      desc: 'Stagnant desert world featuring a massive global crustal dichotomy (low northern plains vs high cratered southern uplands), mega-shield volcanoes, and colossal rift canyons.',
    },
    {
      id: 'venus',
      label: 'Venus (Aphrodite)',
      icon: '🟡',
      desc: 'Hyper-volcanic hothouse world with circular coronae depressions, folded tessera highland plateaus, and sparse craters shielded by an ultra-dense atmosphere.',
    },
    {
      id: 'terran',
      label: 'Earth (Terran)',
      icon: '🌍',
      desc: 'Active mobile plate tectonics, continental shields, deep ocean basins, collision fold mountains, and hydrological climate biomes.',
    },
    {
      id: 'protoplanet',
      label: 'Protoplanet',
      icon: '🔥',
      desc: 'Young primordial world dominated by a global molten magma ocean, active volcanic rift fractures, and cooled basalt crust.',
    },
  ];

  readonly selectedArchetype = signal<WorldProfileKind>('moon');
  readonly cellCount = signal<number>(800);
  readonly seed = signal<number>(42);
  readonly relaxationIterations = signal<number>(2);

  // Crater parameters
  readonly basinCount = signal<number>(3);
  readonly complexCraterCount = signal<number>(14);
  readonly simpleCraterCount = signal<number>(45);
  readonly craterDepthScale = signal<number>(1.0);
  readonly craterRimScale = signal<number>(1.0);
  readonly mariaBasaltFlooding = signal<boolean>(true);

  // Visualization settings
  readonly renderMode = signal<SurfaceRenderMode>('continuous');
  readonly colorMode = signal<ArchetypeColorMode>('biome');
  readonly terrainExaggeration = signal<number>(0.07);
  readonly showBorders = signal<boolean>(false);

  // Inspection
  readonly inspectedCell = signal<ICellInspectInfo | null>(null);

  // Stats signals
  readonly mariaCoverage = signal<string>('0%');
  readonly highlandsCoverage = signal<string>('0%');
  readonly minElevation = signal<number>(0);
  readonly maxElevation = signal<number>(0);
  readonly totalCraters = signal<number>(0);

  private planetGroup = new Group();
  private terrainMesh: Mesh | null = null;
  private continuousMesh: Mesh | null = null;
  private oceanMesh: Mesh | null = null;
  private borderMesh: LineSegments | null = null;
  private currentGlobeGeom: IPlanetGlobeGeometry | null = null;
  private currentGraph: IPlanetGraphCore | null = null;
  private currentTectonics: IPlanetTectonics | null = null;
  private currentEcology: IPlanetEcology | null = null;
  private currentCraters: IImpactCraterResult | null = null;

  constructor() {
    this.engine.scene.add(this.planetGroup);

    // Initial build
    this.rebuildPlanet();

    const canvas = this.engine.canvas;
    const onClick = (e: MouseEvent) => this.onPointerClick(e);
    canvas.addEventListener('click', onClick);

    this.destroyRef.onDestroy(() => {
      canvas.removeEventListener('click', onClick);
      this.disposeScene();
    });
  }

  selectArchetype(kind: WorldProfileKind): void {
    this.selectedArchetype.set(kind);
    const profile = WORLD_PROFILES[kind];
    if (profile.impactCraters) {
      this.basinCount.set(profile.impactCraters.basinCount ?? 3);
      this.complexCraterCount.set(profile.impactCraters.complexCraterCount ?? 14);
      this.simpleCraterCount.set(profile.impactCraters.simpleCraterCount ?? 45);
      this.craterDepthScale.set(profile.impactCraters.depthScale ?? 1.0);
      this.craterRimScale.set(profile.impactCraters.rimScale ?? 1.0);
      this.mariaBasaltFlooding.set(profile.impactCraters.mariaBasaltFlooding ?? true);
    } else {
      this.basinCount.set(0);
      this.complexCraterCount.set(0);
      this.simpleCraterCount.set(0);
    }
    this.rebuildPlanet();
  }

  shuffleSeed(): void {
    this.seed.set(Math.floor(Math.random() * 1_000_000));
    this.rebuildPlanet();
  }

  onParamChange(): void {
    this.rebuildPlanet();
  }

  setColorMode(mode: ArchetypeColorMode): void {
    this.colorMode.set(mode);
    this.updateMeshColors();
  }

  toggleBorders(): void {
    this.showBorders.update((v) => !v);
    if (this.borderMesh) {
      this.borderMesh.visible = this.showBorders();
    }
  }

  rebuildPlanet(): void {
    const profile = WORLD_PROFILES[this.selectedArchetype()];
    const count = this.cellCount();
    const seed = this.seed();

    const graph = buildPlanetGraphCore({
      cellCount: count,
      seed,
      relaxationIterations: this.relaxationIterations(),
      jitter: 0.25,
    });
    this.currentGraph = graph;

    const tectonics = buildPlanetTectonics(graph, {
      plateCount: 5,
      seed,
      ...profile.tectonics,
    });
    this.currentTectonics = tectonics;

    // Apply multi-cell impact craters
    let cratersResult: IImpactCraterResult | undefined;
    if (this.basinCount() > 0 || this.complexCraterCount() > 0 || this.simpleCraterCount() > 0) {
      cratersResult = generateImpactCraters(graph, tectonics.elevation, {
        seed,
        basinCount: this.basinCount(),
        complexCraterCount: this.complexCraterCount(),
        simpleCraterCount: this.simpleCraterCount(),
        depthScale: this.craterDepthScale(),
        rimScale: this.craterRimScale(),
        mariaBasaltFlooding: this.mariaBasaltFlooding(),
      });
      tectonics.elevation = cratersResult.elevation;
    }
    this.currentCraters = cratersResult ?? null;

    const ecology = buildPlanetEcology(graph, tectonics, {
      climate: profile.climate,
      biomes: {
        ...profile.biomes,
        archetype: profile.archetype,
        craterLandform: cratersResult?.craterLandform,
      },
    });
    this.currentEcology = ecology;

    this.updateStats();
    this.rebuildCellMesh();
    this.rebuildContinuousMesh();
    this.syncMeshVisibility();
  }

  setRenderMode(mode: SurfaceRenderMode): void {
    this.renderMode.set(mode);
    this.syncMeshVisibility();
  }

  private syncMeshVisibility(): void {
    const isCells = this.renderMode() === 'cells';
    if (this.terrainMesh) {
      this.terrainMesh.visible = isCells;
    }
    if (this.borderMesh) {
      this.borderMesh.visible = isCells && this.showBorders();
    }
    if (this.continuousMesh) {
      this.continuousMesh.visible = !isCells;
    }
    if (this.oceanMesh) {
      this.oceanMesh.visible = !isCells && this.selectedArchetype() === 'terran';
    }
  }

  private updateStats(): void {
    if (!this.currentTectonics || !this.currentGraph) return;
    const elevations = this.currentTectonics.elevation;
    let minE = Number.POSITIVE_INFINITY;
    let maxE = Number.NEGATIVE_INFINITY;
    for (const e of elevations) {
      if (e < minE) minE = e;
      if (e > maxE) maxE = e;
    }
    this.minElevation.set(Number(minE.toFixed(3)));
    this.maxElevation.set(Number(maxE.toFixed(3)));

    if (this.currentCraters) {
      this.totalCraters.set(this.currentCraters.craters.length);
      const mariaCount = this.currentCraters.mariaCellIds.size;
      const total = this.currentGraph.cells.length;
      this.mariaCoverage.set(`${((mariaCount / total) * 100).toFixed(1)}%`);

      let highlandsCount = 0;
      if (this.currentEcology) {
        for (const b of this.currentEcology.biome) {
          if (
            b === 'lunar_highlands' ||
            b === 'martian_highlands' ||
            b === 'tessera_highlands' ||
            b === 'cinder_plateau'
          ) {
            highlandsCount++;
          }
        }
      }
      this.highlandsCoverage.set(`${((highlandsCount / total) * 100).toFixed(1)}%`);
    } else {
      this.totalCraters.set(0);
      this.mariaCoverage.set('0%');
      this.highlandsCoverage.set('0%');
    }
  }

  private rebuildCellMesh(): void {
    if (!this.currentGraph || !this.currentTectonics || !this.currentEcology) return;

    if (this.terrainMesh) {
      this.planetGroup.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
      (this.terrainMesh.material as MeshStandardMaterial).dispose();
      this.terrainMesh = null;
    }
    if (this.borderMesh) {
      this.planetGroup.remove(this.borderMesh);
      this.borderMesh.geometry.dispose();
      (this.borderMesh.material as LineBasicMaterial).dispose();
      this.borderMesh = null;
    }

    const graph = this.currentGraph;
    const elevation = this.currentTectonics.elevation;
    const exaggeration = this.terrainExaggeration();

    // Build triangle fans per cell with elevation displacement
    const positions: number[] = [];
    const colors: number[] = [];
    const borderPositions: number[] = [];

    const cellCount = graph.cells.length;
    for (let i = 0; i < cellCount; i++) {
      const cell = graph.cells[i]!;
      const e = elevation[i]!;
      const rCenter = 1.0 + e * exaggeration;

      const cColor = this.resolveCellColor(i);

      const corners = cell.corners;
      const numCorners = corners.length;
      for (let k = 0; k < numCorners; k++) {
        const nextK = (k + 1) % numCorners;
        const cornerA = corners[k]!;
        const cornerB = corners[nextK]!;

        positions.push(cell.center.x * rCenter, cell.center.y * rCenter, cell.center.z * rCenter);
        colors.push(cColor.r, cColor.g, cColor.b);

        positions.push(cornerA.x * rCenter, cornerA.y * rCenter, cornerA.z * rCenter);
        colors.push(cColor.r, cColor.g, cColor.b);

        positions.push(cornerB.x * rCenter, cornerB.y * rCenter, cornerB.z * rCenter);
        colors.push(cColor.r, cColor.g, cColor.b);

        borderPositions.push(
          cornerA.x * (rCenter + 0.001),
          cornerA.y * (rCenter + 0.001),
          cornerA.z * (rCenter + 0.001),
          cornerB.x * (rCenter + 0.001),
          cornerB.y * (rCenter + 0.001),
          cornerB.z * (rCenter + 0.001),
        );
      }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
    geometry.computeVertexNormals();

    const material = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.82,
      metalness: 0.08,
      side: DoubleSide,
    });

    this.terrainMesh = new Mesh(geometry, material);
    this.planetGroup.add(this.terrainMesh);

    // Border line overlay
    const borderGeom = new BufferGeometry();
    borderGeom.setAttribute('position', new BufferAttribute(new Float32Array(borderPositions), 3));
    const borderMat = new LineBasicMaterial({
      color: 0x111620,
      transparent: true,
      opacity: 0.35,
    });
    this.borderMesh = new LineSegments(borderGeom, borderMat);
    this.planetGroup.add(this.borderMesh);
  }

  private rebuildContinuousMesh(): void {
    if (!this.currentGraph || !this.currentTectonics || !this.currentEcology) return;

    if (this.continuousMesh) {
      this.planetGroup.remove(this.continuousMesh);
      this.continuousMesh.geometry.dispose();
      (this.continuousMesh.material as MeshStandardMaterial).dispose();
      this.continuousMesh = null;
    }
    if (this.oceanMesh) {
      this.planetGroup.remove(this.oceanMesh);
      this.oceanMesh.geometry.dispose();
      (this.oceanMesh.material as MeshStandardMaterial).dispose();
      this.oceanMesh = null;
    }

    const graph = this.currentGraph;
    const tectonics = this.currentTectonics;
    const ecology = this.currentEcology;
    const profile = WORLD_PROFILES[this.selectedArchetype()];

    const sampler = createPlanetSurfaceSampler(graph, tectonics, ecology, {
      featureComposition: 'cell',
    });

    const globeGeom = buildPlanetGlobeGeometry({
      sampler,
      radius: 1.0,
      heightScale: this.terrainExaggeration(),
      longitudeSegments: 144,
      latitudeRings: 72,
      cellIdAt: (dir) => findCellAt(graph, dir).id,
    });
    this.currentGlobeGeom = globeGeom;

    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(new Float32Array(globeGeom.positions), 3));
    geom.setAttribute('normal', new BufferAttribute(new Float32Array(globeGeom.normals), 3));
    geom.setIndex(new BufferAttribute(new Uint32Array(globeGeom.indices), 1));

    const colors = this.buildContinuousColors(globeGeom);
    geom.setAttribute('color', new BufferAttribute(colors, 3));

    const material = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.82,
      metalness: 0.08,
      side: FrontSide,
    });

    this.continuousMesh = new Mesh(geom, material);
    this.planetGroup.add(this.continuousMesh);

    // Add translucent ocean shell for water worlds
    if (profile.oceanSubstance === 'water') {
      const oceanGeom = new SphereGeometry(1.0, 64, 32);
      const oceanMat = new MeshStandardMaterial({
        color: new Color('#1c5f8a'),
        transparent: true,
        opacity: 0.6,
        roughness: 0.15,
        metalness: 0.1,
      });
      this.oceanMesh = new Mesh(oceanGeom, oceanMat);
      this.planetGroup.add(this.oceanMesh);
    }
  }

  private buildContinuousColors(globeGeom: IPlanetGlobeGeometry): Float32Array {
    const vertexCount = globeGeom.vertexCount;
    const colors = new Float32Array(vertexCount * 3);
    const cellIds = globeGeom.cellIds;
    const elevations = globeGeom.elevations;
    const minE = this.minElevation();
    const maxE = this.maxElevation();
    const tectonics = this.currentTectonics;
    const mode = this.colorMode();

    for (let v = 0; v < vertexCount; v++) {
      const cellId = cellIds[v];
      const e = elevations[v];
      const o = v * 3;
      let col: Color;

      if (mode === 'elevation' && tectonics) {
        col = new Color(elevationColor(e, tectonics.seaLevelElevation, minE, maxE));
      } else if (mode === 'craters' && cellId >= 0) {
        col = this.resolveCellColor(cellId);
      } else {
        // Biome mode
        if (this.selectedArchetype() === 'protoplanet' && tectonics && e < tectonics.seaLevelElevation) {
          col = new Color(lavaOceanColor());
        } else if (cellId >= 0) {
          col = this.resolveCellColor(cellId);
        } else {
          col = new Color(0x666666);
        }
      }

      colors[o] = col.r;
      colors[o + 1] = col.g;
      colors[o + 2] = col.b;
    }
    return colors;
  }

  private updateMeshColors(): void {
    // Update cell mesh
    if (this.terrainMesh && this.currentGraph) {
      const geometry = this.terrainMesh.geometry;
      const colorAttr = geometry.getAttribute('color') as BufferAttribute;
      const array = colorAttr.array as Float32Array;

      let index = 0;
      const cellCount = this.currentGraph.cells.length;
      for (let i = 0; i < cellCount; i++) {
        const cColor = this.resolveCellColor(i);
        const verticesPerCell = this.currentGraph.cells[i]!.corners.length * 3;
        for (let v = 0; v < verticesPerCell; v++) {
          array[index++] = cColor.r;
          array[index++] = cColor.g;
          array[index++] = cColor.b;
        }
      }
      colorAttr.needsUpdate = true;
    }

    // Update continuous mesh
    if (this.continuousMesh && this.currentGlobeGeom) {
      const geometry = this.continuousMesh.geometry;
      const colorAttr = geometry.getAttribute('color') as BufferAttribute;
      const colors = this.buildContinuousColors(this.currentGlobeGeom);
      (colorAttr.array as Float32Array).set(colors);
      colorAttr.needsUpdate = true;
    }
  }

  private resolveCellColor(cellId: number): Color {
    const mode = this.colorMode();
    const ecology = this.currentEcology;
    const tectonics = this.currentTectonics;
    const craters = this.currentCraters;

    if (mode === 'craters' && craters) {
      const tag = craters.craterLandform[cellId];
      if (tag === 'lunar_maria') return new Color('hsl(220, 20%, 15%)');
      if (tag === 'crater_rim') return new Color('hsl(45, 90%, 65%)');
      if (tag === 'crater_floor') return new Color('hsl(215, 30%, 40%)');
      if (tag === 'crater_peak') return new Color('hsl(180, 80%, 75%)');
      if (tag === 'ejecta') return new Color('hsl(35, 40%, 55%)');
      return new Color('hsl(210, 5%, 50%)');
    }

    if (mode === 'elevation' && tectonics) {
      const e = tectonics.elevation[cellId]!;
      const min = this.minElevation();
      const max = this.maxElevation();
      const colorStr = elevationColor(e, tectonics.seaLevelElevation, min, max);
      return new Color(colorStr);
    }

    if (ecology) {
      const biome = ecology.biome[cellId]!;
      if (this.selectedArchetype() === 'protoplanet' && !tectonics?.isLand[cellId]) {
        return new Color(lavaOceanColor());
      }
      return new Color(biomeColor(biome));
    }

    return new Color(0x888888);
  }

  inspectAt(cellId: number): void {
    if (!this.currentGraph || !this.currentTectonics || !this.currentEcology) return;
    const b = this.currentEcology.biome[cellId] ?? 'unknown';
    const e = this.currentTectonics.elevation[cellId] ?? 0;
    const l = this.currentCraters?.craterLandform[cellId] ?? 'none';
    this.inspectedCell.set({
      id: cellId,
      biome: b,
      elevation: Number(e.toFixed(3)),
      craterLandform: l,
    });
  }

  private onPointerClick(event: MouseEvent): void {
    if (!this.currentGraph || !this.currentTectonics || !this.currentEcology) return;
    const canvas = this.engine.canvas;
    const rect = canvas.getBoundingClientRect();
    const mouse = new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new Raycaster();
    raycaster.setFromCamera(mouse, this.engine.camera);
    const activeTarget = this.renderMode() === 'cells' ? this.terrainMesh : this.continuousMesh;
    if (!activeTarget) return;
    const hits = raycaster.intersectObject(activeTarget, false);
    if (hits.length > 0 && hits[0]) {
      const p = hits[0].point.clone().normalize();
      const hitCell = findCellAt(this.currentGraph, { x: p.x, y: p.y, z: p.z });
      this.inspectAt(hitCell.id);
    }
  }

  private disposeScene(): void {
    if (this.terrainMesh) {
      this.planetGroup.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
      (this.terrainMesh.material as MeshStandardMaterial).dispose();
      this.terrainMesh = null;
    }
    if (this.borderMesh) {
      this.planetGroup.remove(this.borderMesh);
      this.borderMesh.geometry.dispose();
      (this.borderMesh.material as LineBasicMaterial).dispose();
      this.borderMesh = null;
    }
    if (this.continuousMesh) {
      this.planetGroup.remove(this.continuousMesh);
      this.continuousMesh.geometry.dispose();
      (this.continuousMesh.material as MeshStandardMaterial).dispose();
      this.continuousMesh = null;
    }
    if (this.oceanMesh) {
      this.planetGroup.remove(this.oceanMesh);
      this.oceanMesh.geometry.dispose();
      (this.oceanMesh.material as MeshStandardMaterial).dispose();
      this.oceanMesh = null;
    }
    this.engine.scene.remove(this.planetGroup);
  }
}
