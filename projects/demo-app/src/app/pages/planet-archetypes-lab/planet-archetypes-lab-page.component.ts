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
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  buildPlanetEcology,
  buildPlanetGraphCore,
  buildPlanetTectonics,
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
  elevationColor,
  lavaOceanColor,
} from 'triangular-engine/worldgen/render';

export type ArchetypeColorMode = 'biome' | 'elevation' | 'craters';

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
  readonly colorMode = signal<ArchetypeColorMode>('biome');
  readonly terrainExaggeration = signal<number>(0.07);
  readonly showBorders = signal<boolean>(true);

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
  private borderMesh: LineSegments | null = null;
  private currentGraph: IPlanetGraphCore | null = null;
  private currentTectonics: IPlanetTectonics | null = null;
  private currentEcology: IPlanetEcology | null = null;
  private currentCraters: IImpactCraterResult | null = null;

  constructor() {
    this.engine.scene.add(this.planetGroup);

    // Initial build
    this.rebuildPlanet();

    this.destroyRef.onDestroy(() => {
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
    this.rebuildMesh();
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

  private rebuildMesh(): void {
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

      // Cell polygon triangle fan: center -> corner[k] -> corner[k+1]
      const corners = cell.corners;
      const numCorners = corners.length;
      for (let k = 0; k < numCorners; k++) {
        const nextK = (k + 1) % numCorners;
        const cornerA = corners[k]!;
        const cornerB = corners[nextK]!;

        // Center
        positions.push(cell.center.x * rCenter, cell.center.y * rCenter, cell.center.z * rCenter);
        colors.push(cColor.r, cColor.g, cColor.b);

        // Corner A
        positions.push(cornerA.x * rCenter, cornerA.y * rCenter, cornerA.z * rCenter);
        colors.push(cColor.r, cColor.g, cColor.b);

        // Corner B
        positions.push(cornerB.x * rCenter, cornerB.y * rCenter, cornerB.z * rCenter);
        colors.push(cColor.r, cColor.g, cColor.b);

        // Cell border line segment
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
    this.borderMesh.visible = this.showBorders();
    this.planetGroup.add(this.borderMesh);
  }

  private updateMeshColors(): void {
    if (!this.terrainMesh || !this.currentGraph) return;
    const geometry = this.terrainMesh.geometry;
    const colorAttr = geometry.getAttribute('color') as BufferAttribute;
    const array = colorAttr.array as Float32Array;

    let index = 0;
    const cellCount = this.currentGraph.cells.length;
    for (let i = 0; i < cellCount; i++) {
      const cell = this.currentGraph.cells[i]!;
      const cColor = this.resolveCellColor(i);
      const verticesPerCell = cell.corners.length * 3;
      for (let v = 0; v < verticesPerCell; v++) {
        array[index++] = cColor.r;
        array[index++] = cColor.g;
        array[index++] = cColor.b;
      }
    }
    colorAttr.needsUpdate = true;
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

  private disposeScene(): void {
    if (this.terrainMesh) {
      this.planetGroup.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
      (this.terrainMesh.material as MeshStandardMaterial).dispose();
    }
    if (this.borderMesh) {
      this.planetGroup.remove(this.borderMesh);
      this.borderMesh.geometry.dispose();
      (this.borderMesh.material as LineBasicMaterial).dispose();
    }
    this.engine.scene.remove(this.planetGroup);
  }
}
