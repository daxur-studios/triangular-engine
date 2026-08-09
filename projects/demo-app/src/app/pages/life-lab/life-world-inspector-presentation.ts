import {
  CircleGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  type Material,
} from 'three';

export type InspectorActivity =
  | 'grazing'
  | 'travelling-to-water'
  | 'drinking'
  | 'travelling-to-rest'
  | 'resting'
  | 'travelling-to-meadow';

export interface LifeWorldInspectorState {
  readonly activity: InspectorActivity;
  readonly herdX: number;
  readonly herdZ: number;
  readonly targetX: number;
  readonly targetZ: number;
}

/**
 * A deliberately top-down world diagnostic. It is not a terrain renderer or
 * population simulator: it makes deterministic habitat and high-level herd
 * state inspectable before we depend on 3D presentation.
 */
export class LifeWorldInspectorPresentation {
  readonly group = new Group();

  private readonly materials: Material[] = [];
  private readonly tileMaterials: MeshBasicMaterial[] = [];
  private readonly geometries: PlaneGeometry[] = [];
  private readonly dummy = new Object3D();
  private readonly herdMarker: Mesh;
  private readonly targetMarker: Mesh;
  private readonly herdAnimals: InstancedMesh;
  private readonly state: LifeWorldInspectorState = {
    activity: 'grazing',
    herdX: -58,
    herdZ: -28,
    targetX: -58,
    targetZ: -28,
  };

  constructor(seed = 909) {
    this.group.name = 'life-world-inspector';
    this.herdMarker = new Mesh(
      new RingGeometry(11.5, 12.6, 28),
      this.trackMaterial(new MeshBasicMaterial({ color: '#f2c35d', transparent: true, opacity: 0.98 })),
    );
    this.herdMarker.rotation.x = -Math.PI / 2;
    this.herdMarker.position.y = 0.5;
    this.targetMarker = new Mesh(
      new RingGeometry(4.8, 6.4, 20),
      this.trackMaterial(new MeshBasicMaterial({ color: '#f6e6a1', transparent: true, opacity: 0.9 })),
    );
    this.targetMarker.rotation.x = -Math.PI / 2;
    this.targetMarker.position.y = 0.55;
    this.herdAnimals = new InstancedMesh(
      new CircleGeometry(2.7, 3),
      this.trackMaterial(new MeshBasicMaterial({ color: '#2d1610', transparent: true, opacity: 1 })),
      20,
    );
    this.herdAnimals.name = 'life-world-inspector-herd-agents';
    this.herdAnimals.position.y = 0.6;
    this.group.add(this.herdMarker, this.targetMarker, this.herdAnimals);
    this.setSeed(seed);
  }

  get currentState(): LifeWorldInspectorState {
    return this.state;
  }

  setSeed(seed: number): void {
    this.clearTiles();
    const cellSize = 10;
    const halfCells = 18;
    const capacity = (halfCells * 2 + 1) ** 2;
    const tileGeometry = this.trackGeometry(new PlaneGeometry(cellSize - 0.35, cellSize - 0.35));
    const land = this.createTileMesh(tileGeometry, '#6b8f57', capacity);
    const meadow = this.createTileMesh(tileGeometry, '#9fbd64', capacity);
    const forest = this.createTileMesh(tileGeometry, '#3e6548', capacity);
    const water = this.createTileMesh(tileGeometry, '#397da0', capacity);
    const meshes = { land, meadow, forest, water };
    const counts = { land: 0, meadow: 0, forest: 0, water: 0 };

    for (let z = -halfCells; z <= halfCells; z++) {
      for (let x = -halfCells; x <= halfCells; x++) {
        const worldX = x * cellSize;
        const worldZ = z * cellSize;
        const habitat = this.habitatAt(worldX, worldZ, seed);
        const mesh = meshes[habitat];
        this.dummy.position.set(worldX, 0, worldZ);
        this.dummy.rotation.set(-Math.PI / 2, 0, 0);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(counts[habitat]++, this.dummy.matrix);
      }
    }
    for (const habitat of ['land', 'meadow', 'forest', 'water'] as const) {
      meshes[habitat].count = counts[habitat];
      meshes[habitat].instanceMatrix.needsUpdate = true;
    }
  }

  update(universalTimeSeconds: number): LifeWorldInspectorState {
    // Five calm, deterministic phases. The anchor is an activity area, rather
    // than a lead animal; individual markers move independently around it.
    const period = 320;
    const localTime = ((universalTimeSeconds % period) + period) % period;
    const meadow = { x: -58, z: -28 };
    // Water is the shore-side drinking point, not the lake centre. A later
    // local navigator will choose this edge from the habitat query.
    const water = { x: 13, z: 22 };
    const shelter = { x: -82, z: 74 };
    const travel = (from: typeof meadow, to: typeof meadow, blend: number) => {
      // Zero velocity at each activity boundary prevents sharp direction snaps.
      const eased = blend * blend * (3 - 2 * blend);
      return {
        x: from.x + (to.x - from.x) * eased,
        z: from.z + (to.z - from.z) * eased,
      };
    };

    let activity: InspectorActivity;
    let herd = meadow;
    let target = meadow;
    if (localTime < 105) {
      activity = 'grazing';
      target = meadow;
    } else if (localTime < 145) {
      activity = 'travelling-to-water';
      herd = travel(meadow, water, (localTime - 105) / 40);
      target = water;
    } else if (localTime < 175) {
      activity = 'drinking';
      herd = water;
      target = water;
    } else if (localTime < 235) {
      activity = 'travelling-to-rest';
      herd = travel(water, shelter, (localTime - 175) / 60);
      target = shelter;
    } else if (localTime < 270) {
      activity = 'resting';
      herd = shelter;
      target = shelter;
    } else {
      activity = 'travelling-to-meadow';
      herd = travel(shelter, meadow, (localTime - 270) / 50);
      target = meadow;
    }
    Object.assign(this.state, { activity, herdX: herd.x, herdZ: herd.z, targetX: target.x, targetZ: target.z });
    this.herdMarker.position.set(herd.x, 0.5, herd.z);
    this.targetMarker.position.set(target.x, 0.55, target.z);
    this.updateHerdAnimals(universalTimeSeconds, herd);
    return this.state;
  }

  dispose(): void {
    this.clearTiles();
    this.herdMarker.geometry.dispose();
    this.targetMarker.geometry.dispose();
    this.herdAnimals.geometry.dispose();
    for (const material of this.materials) material.dispose();
  }

  private habitatAt(x: number, z: number, seed: number): 'land' | 'meadow' | 'forest' | 'water' {
    const offset = (seed % 997) * 0.009;
    const lake = Math.pow((x - 54) / 39, 2) + Math.pow((z - 22) / 27, 2) < 1;
    if (lake) return 'water';
    const meadow = Math.pow((x + 58) / 56, 2) + Math.pow((z + 28) / 42, 2) < 1;
    if (meadow) return 'meadow';
    const forest = Math.sin(x * 0.035 + offset) + Math.cos(z * 0.029 - offset) > 1.18;
    return forest ? 'forest' : 'land';
  }

  private updateHerdAnimals(
    universalTimeSeconds: number,
    herd: { x: number; z: number },
  ): void {
    for (let index = 0; index < this.herdAnimals.count; index++) {
      const phase = index * 2.399 + 0.73;
      const personalSpeed = 0.38 + this.unitNoise(index, 11) * 0.34;
      const personalPhase = phase + universalTimeSeconds * personalSpeed;
      const desiredX = Math.cos(phase * 1.73) * (3.5 + this.unitNoise(index, 23) * 7.5);
      const desiredZ = Math.sin(phase * 1.31) * (3.5 + this.unitNoise(index, 37) * 5.5);
      // Kept state-independent so a change of activity cannot reposition an
      // individual marker; grazing spread comes from its personal patch.
      const wander = 1.25;
      const scatterX = desiredX + Math.sin(personalPhase * 1.19) * wander;
      const scatterZ = desiredZ + Math.cos(personalPhase * 0.91) * wander;
      const heading = Math.atan2(
        Math.cos(personalPhase * 0.91) * wander * 0.91,
        -Math.sin(personalPhase * 1.19) * wander * 1.19,
      );
      this.dummy.position.set(herd.x + scatterX, 0, herd.z + scatterZ);
      this.dummy.rotation.set(-Math.PI / 2, 0, heading);
      this.dummy.updateMatrix();
      this.herdAnimals.setMatrixAt(index, this.dummy.matrix);
    }
    this.herdAnimals.instanceMatrix.needsUpdate = true;
  }

  private unitNoise(index: number, salt: number): number {
    const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
    return value - Math.floor(value);
  }

  private createTileMesh(geometry: PlaneGeometry, color: string, capacity: number): InstancedMesh {
    const material = new MeshBasicMaterial({ color });
    this.tileMaterials.push(material);
    const mesh = new InstancedMesh(geometry, material, capacity);
    mesh.name = `life-world-inspector-${color}`;
    this.group.add(mesh);
    return mesh;
  }

  private clearTiles(): void {
    const tiles = this.group.children.filter((child) => child instanceof InstancedMesh && child !== this.herdAnimals);
    for (const tile of tiles) this.group.remove(tile);
    for (const geometry of this.geometries.splice(0)) geometry.dispose();
    for (const material of this.tileMaterials.splice(0)) material.dispose();
  }

  private trackGeometry(geometry: PlaneGeometry): PlaneGeometry {
    this.geometries.push(geometry);
    return geometry;
  }

  private trackMaterial(material: MeshBasicMaterial): MeshBasicMaterial {
    this.materials.push(material);
    return material;
  }
}
