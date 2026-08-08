import {
  BufferGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  Material,
  Matrix4,
  MeshStandardMaterial,
  Mesh,
  Object3D,
  Quaternion,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { LifeSimulation } from 'triangular-engine/life';

export type AnimalRenderStyle = 'primitive' | 'cutout' | 'relief';

interface Rig {
  readonly group: Group;
  readonly meshes: readonly InstancedMesh[];
  setCount(count: number): void;
}

interface InsectModel {
  readonly group: Group;
  readonly leftWing: Mesh;
  readonly rightWing: Mesh;
  readonly rearLeftWing: Mesh;
  readonly rearRightWing: Mesh;
}

const LOCAL_FORWARD = new Vector3(0, 1, 0);
const INSECT_FORWARD = new Vector3(0, 0, 1);
const WORLD_UP = new Vector3(0, 1, 0);
const INSECT_SHOWCASE_COUNT = 12;

/**
 * Demo-local comparison of agent presentation techniques. It deliberately
 * stays out of triangular-engine/life until the visual approach proves useful.
 */
export class ProceduralAnimalPresentation {
  readonly group = new Group();
  private insectStartIndex = Number.POSITIVE_INFINITY;

  private readonly birdRigs: Record<'cutout' | 'relief', Rig>;
  private readonly fishRigs: Record<'cutout' | 'relief', Rig>;
  private readonly herdRigs: Record<'cutout' | 'relief', Rig>;
  private readonly insectModels: InsectModel[] = [];
  private readonly geometries = new Set<BufferGeometry>();
  private readonly materials = new Set<Material>();
  private readonly base = new Object3D();
  private readonly part = new Object3D();
  private readonly direction = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly basis = new Matrix4();
  private readonly composed = new Matrix4();
  private readonly baseQuaternion = new Quaternion();

  constructor(
    private readonly birdCount: number,
    private readonly fishCount: number,
    private readonly herdCount: number,
  ) {
    this.birdRigs = {
      cutout: this.createBirdRig(false),
      relief: this.createBirdRig(true),
    };
    this.fishRigs = {
      cutout: this.createFishRig(false),
      relief: this.createFishRig(true),
    };
    this.herdRigs = {
      cutout: this.createHerdRig(false),
      relief: this.createHerdRig(true),
    };
    // A focused insect stage needs a few readable individuals, not a cloud of
    // bird-count-derived meshes. Four insects form each of three local swarms.
    for (let index = 0; index < INSECT_SHOWCASE_COUNT; index++) {
      const insect = this.createInsectModel(index % 3);
      this.insectModels.push(insect);
      this.group.add(insect.group);
    }

    for (const rig of [
      ...Object.values(this.birdRigs),
      ...Object.values(this.fishRigs),
      ...Object.values(this.herdRigs),
    ]) {
      rig.group.visible = false;
      this.group.add(rig.group);
    }
  }

  setVisibility(
    mode: 'birds' | 'fish' | 'herd' | 'insects',
    style: AnimalRenderStyle,
  ): void {
    for (const rig of Object.values(this.birdRigs)) rig.group.visible = false;
    for (const rig of Object.values(this.fishRigs)) rig.group.visible = false;
    for (const rig of Object.values(this.herdRigs)) rig.group.visible = false;
    for (const insect of this.insectModels) insect.group.visible = false;
    if (style === 'primitive') {
      if (mode === 'insects') {
        for (const insect of this.insectModels) insect.group.visible = true;
      }
      return;
    }
    if (mode === 'insects') {
      for (const insect of this.insectModels) insect.group.visible = true;
      return;
    }
    const rigs =
      mode === 'birds'
        ? this.birdRigs
        : mode === 'fish'
          ? this.fishRigs
          : this.herdRigs;
    rigs[style].group.visible = true;
  }

  /** Show the reusable silhouettes for a mixed-species scene. */
  setAllVisibility(style: Exclude<AnimalRenderStyle, 'primitive'>): void {
    for (const rig of Object.values(this.birdRigs)) rig.group.visible = false;
    for (const rig of Object.values(this.fishRigs)) rig.group.visible = false;
    for (const rig of Object.values(this.herdRigs)) rig.group.visible = false;
    for (const insect of this.insectModels) insect.group.visible = false;
    this.birdRigs[style].group.visible = true;
    this.fishRigs[style].group.visible = true;
    this.herdRigs[style].group.visible = true;
    for (const insect of this.insectModels) insect.group.visible = true;
  }

  /** Treat agents from this index onward as tiny fast-winged insects. */
  setInsectStartIndex(index: number | null): void {
    this.insectStartIndex = index ?? Number.POSITIVE_INFINITY;
  }

  setBirdCount(count: number): void {
    for (const rig of Object.values(this.birdRigs)) rig.setCount(count);
  }

  setHerdCount(count: number): void {
    for (const rig of Object.values(this.herdRigs)) rig.setCount(count);
  }

  setFishCount(count: number): void {
    for (const rig of Object.values(this.fishRigs)) rig.setCount(count);
  }

  updateBirds(simulation: LifeSimulation, time: number): void {
    for (const rig of Object.values(this.birdRigs)) {
      const [body, leftWing, rightWing] = rig.meshes;
      for (let index = 0; index < body.count; index++) {
        const agent = simulation.agents[index];
        this.setFlyingBase(agent.position, agent.velocity);
        // The integrated world reserves the latter half of the air agents for
        // insects: same cheap instanced wing rig, smaller silhouette and a
        // much faster wing beat instead of a second expensive mesh family.
        const isInsect = index >= this.insectStartIndex;
        // Keep insects visibly smaller than birds, but large enough to read
        // in the wide integrated-world camera.
        this.base.scale.setScalar(isInsect ? 0.72 : 0.82);
        this.base.updateMatrix();
        body.setMatrixAt(index, this.base.matrix);

        const speed = Math.hypot(
          agent.velocity.x,
          agent.velocity.y,
          agent.velocity.z,
        );
        const phase = time * (isInsect ? 18 + speed * 0.3 : 5.5 + speed * 0.18) + index * 2.399;
        const flap = Math.sin(phase) * 0.72;
        this.setPartMatrix(0, 0, 0, 0, flap, 0);
        if (isInsect) {
          // A broad, high-contrast wing span makes the tiny agents readable
          // in the wide scene and separates them from the bird silhouette.
          this.part.scale.set(1.65, 1.65, 1.65);
          this.part.updateMatrix();
        }
        this.composed.multiplyMatrices(this.base.matrix, this.part.matrix);
        leftWing.setMatrixAt(index, this.composed);
        this.setPartMatrix(0, 0, 0, 0, -flap, 0);
        if (isInsect) {
          this.part.scale.set(1.65, 1.65, 1.65);
          this.part.updateMatrix();
        }
        this.composed.multiplyMatrices(this.base.matrix, this.part.matrix);
        rightWing.setMatrixAt(index, this.composed);
      }
      for (const mesh of rig.meshes) {
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
    this.updateInsectModels(time);
  }

  private updateInsectModels(time: number): void {
    for (let index = 0; index < this.insectModels.length; index++) {
      const insect = this.insectModels[index];
      // Three small swarms: each pair usually hovers and wanders locally, then
      // briefly loops around its partner. The motion never uses a world-sized
      // patrol path, so an insect cannot shoot across the whole scene.
      const swarm = Math.floor(index / 4);
      const member = index % 4;
      const pair = Math.floor(member / 2);
      const side = member % 2 === 0 ? -1 : 1;
      const swarmPhase = time * 0.16 + swarm * 2.3;
      const pairPhase = time * 0.42 + pair * 2.1 + swarm * 0.7;
      const interaction = 0.5 - 0.5 * Math.cos(time * 0.34 + swarm * 1.9 + pair);
      const orbitPhase = time * 2.1 + swarm * 1.7 + pair * 2.8;
      const centerX = [-3.3, 0.2, 3.5][swarm] + Math.sin(swarmPhase) * 0.38;
      const centerZ = [0.8, -0.65, 0.45][swarm] + Math.cos(swarmPhase * 1.2) * 0.3;
      const pairX = pair === 0 ? -0.48 : 0.52;
      const pairZ = pair === 0 ? -0.18 : 0.25;
      const hoverX = Math.sin(pairPhase + member * 0.8) * 0.24;
      const hoverZ = Math.cos(pairPhase * 1.15 + member) * 0.2;
      const orbitRadius = 0.28 + interaction * 0.22;
      const x = centerX + pairX + hoverX + Math.cos(orbitPhase) * orbitRadius * interaction * side;
      const z = centerZ + pairZ + hoverZ + Math.sin(orbitPhase) * orbitRadius * interaction * side;
      const y = 4.2 + swarm * 0.14 + Math.sin(pairPhase * 1.6 + member) * 0.22
        + Math.cos(orbitPhase) * 0.1 * interaction;
      this.direction.set(x, y, z).sub(insect.group.position);
      insect.group.position.set(x, y, z);
      // Turn around the vertical axis only: the +Z body heading follows
      // travel direction while the wings remain level.
      this.direction.y = 0;
      if (this.direction.lengthSq() > 0.0001) {
        // The insect body is elongated along local +Z, unlike the bird rig.
        insect.group.quaternion.setFromUnitVectors(INSECT_FORWARD, this.direction.normalize());
      }
      const flap = Math.sin(time * 26 + index * 2.1) * 0.62;
      insect.leftWing.rotation.z = flap;
      insect.rightWing.rotation.z = -flap;
      // Front and rear pairs counter-rotate, giving the dragonfly-like
      // four-wing rhythm instead of making all wings mirror one another.
      insect.rearLeftWing.rotation.z = -flap * 0.82;
      insect.rearRightWing.rotation.z = flap * 0.82;
    }
  }

  updateHerd(simulation: LifeSimulation, time: number): void {
    for (const rig of Object.values(this.herdRigs)) {
      const [body, head, legs, tail] = rig.meshes;
      for (let index = 0; index < body.count; index++) {
        const agent = simulation.agents[index];
        const speed = Math.hypot(agent.velocity.x, agent.velocity.z);
        const gaitAmount = Math.min(1, speed / 0.75);
        const phase = time * (2.2 + speed * 2.1) + index * 1.73;
        const bounce = Math.abs(Math.sin(phase * 2)) * 0.035 * gaitAmount;
        this.setGroundBase(agent.position, agent.velocity, bounce);
        body.setMatrixAt(index, this.base.matrix);

        this.setPartMatrix(
          0,
          0.92,
          0.28,
          -0.04 + Math.sin(phase) * 0.025 * gaitAmount,
          0,
          0,
        );
        this.composed.multiplyMatrices(this.base.matrix, this.part.matrix);
        head.setMatrixAt(index, this.composed);

        const hips = [
          [-0.2, 0.55, -0.18, 0],
          [0.2, 0.55, -0.18, Math.PI],
          [-0.2, -0.55, -0.18, Math.PI],
          [0.2, -0.55, -0.18, 0],
        ] as const;
        for (let leg = 0; leg < hips.length; leg++) {
          const [x, y, z, phaseOffset] = hips[leg];
          const swing = Math.sin(phase + phaseOffset) * 0.25 * gaitAmount;
          this.setPartMatrix(x, y, z, 0, swing, 0);
          this.composed.multiplyMatrices(this.base.matrix, this.part.matrix);
          legs.setMatrixAt(index * 4 + leg, this.composed);
        }

        this.setPartMatrix(
          0,
          -0.82,
          0.2,
          -0.38,
          Math.sin(phase * 0.5) * 0.16,
          0,
        );
        this.composed.multiplyMatrices(this.base.matrix, this.part.matrix);
        tail.setMatrixAt(index, this.composed);
      }
      for (const mesh of rig.meshes) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  updateFish(simulation: LifeSimulation, time: number): void {
    for (const rig of Object.values(this.fishRigs)) {
      const [body, tail, leftFin, rightFin] = rig.meshes;
      for (let index = 0; index < body.count; index++) {
        const agent = simulation.agents[index];
        this.setFlyingBase(agent.position, agent.velocity);
        this.base.scale.setScalar(0.9);
        this.base.updateMatrix();
        body.setMatrixAt(index, this.base.matrix);

        const speed = Math.hypot(
          agent.velocity.x,
          agent.velocity.y,
          agent.velocity.z,
        );
        const phase = time * (5 + speed * 0.45) + index * 1.91;
        this.setPartMatrix(0, -0.72, 0, 0, 0, Math.sin(phase) * 0.42);
        this.composed.multiplyMatrices(this.base.matrix, this.part.matrix);
        tail.setMatrixAt(index, this.composed);

        const fin = Math.sin(phase * 0.55) * 0.18;
        this.setPartMatrix(0, 0.05, 0, 0, fin, 0);
        this.composed.multiplyMatrices(this.base.matrix, this.part.matrix);
        leftFin.setMatrixAt(index, this.composed);
        this.setPartMatrix(0, 0.05, 0, 0, -fin, 0);
        this.composed.multiplyMatrices(this.base.matrix, this.part.matrix);
        rightFin.setMatrixAt(index, this.composed);
      }
      for (const mesh of rig.meshes) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
  }

  private createBirdRig(relief: boolean): Rig {
    const material = this.trackMaterial(
      new MeshStandardMaterial({
        color: relief ? '#e9a94e' : '#f4c26b',
        roughness: 0.82,
        metalness: 0,
        side: DoubleSide,
        flatShading: relief,
      }),
    );
    const bodyGeometry = this.makeShape(
      [
        [-0.12, -0.72],
        [-0.2, -0.35],
        [-0.17, 0.28],
        [-0.08, 0.72],
        [0, 0.94],
        [0.11, 0.64],
        [0.2, 0.2],
        [0.16, -0.42],
      ],
      'side',
      relief,
    );
    const leftWingGeometry = this.makeShape(
      [
        [0, -0.3],
        [0.5, -0.18],
        [1.18, 0.08],
        [0.72, 0.31],
        [0.2, 0.22],
      ],
      'top',
      relief,
    );
    const rightWingGeometry = this.makeShape(
      [
        [0, -0.3],
        [-0.5, -0.18],
        [-1.18, 0.08],
        [-0.72, 0.31],
        [-0.2, 0.22],
      ],
      'top',
      relief,
    );
    return this.makeRig(
      [
        new InstancedMesh(bodyGeometry, material, this.birdCount),
        new InstancedMesh(leftWingGeometry, material, this.birdCount),
        new InstancedMesh(rightWingGeometry, material, this.birdCount),
      ],
      (meshes, count) => meshes.forEach((mesh) => (mesh.count = count)),
    );
  }

  private createInsectModel(variant: number): InsectModel {
    const material = this.trackMaterial(new MeshStandardMaterial({
      color: variant === 0 ? '#e0b83e' : variant === 1 ? '#383b42' : '#a9c6d9',
      roughness: 0.78,
      side: DoubleSide,
    }));
    const group = new Group();
    // Keep insects clearly smaller than the other showcase creatures.
    group.scale.setScalar(variant === 2 ? 0.28 : 0.34);
    const bodyGeometry = new SphereGeometry(0.38, 6, 4);
    this.geometries.add(bodyGeometry);
    const body = new Mesh(bodyGeometry, material);
    body.scale.set(variant === 0 ? 0.72 : 0.58, variant === 0 ? 0.72 : 0.5, variant === 2 ? 1.25 : 1.8);
    body.position.z = 0.15;
    const head = new Mesh(bodyGeometry, material);
    head.scale.setScalar(0.52);
    head.position.z = 0.72;
    const wingGeometry = (side: 1 | -1) => {
      // ShapeGeometry starts in XY. Rotate it into local XZ: X is the
      // lateral span and Z follows the insect's body, making the surface
      // horizontal and visible from above.
      const geometry = this.makeShape(
        [[0, -0.14], [side * 0.52, -0.04], [side * 1.42, 0.16], [side * 0.8, 0.36], [side * 0.18, 0.24]],
        'top',
        false,
      );
      geometry.rotateX(Math.PI / 2);
      return geometry;
    };
    const leftWing = new Mesh(wingGeometry(1), material);
    const rightWing = new Mesh(wingGeometry(-1), material);
    const rearLeftWing = new Mesh(wingGeometry(1), material);
    const rearRightWing = new Mesh(wingGeometry(-1), material);
    leftWing.scale.setScalar(variant === 2 ? 0.58 : 0.66);
    rightWing.scale.setScalar(variant === 2 ? 0.58 : 0.66);
    rearLeftWing.scale.setScalar(variant === 2 ? 0.46 : 0.54);
    rearRightWing.scale.setScalar(variant === 2 ? 0.46 : 0.54);
    leftWing.position.z = 0.32;
    rightWing.position.z = 0.32;
    rearLeftWing.position.z = -0.08;
    rearRightWing.position.z = -0.08;
    const abdomen = new Mesh(bodyGeometry, material);
    abdomen.scale.set(0.46, 0.46, variant === 2 ? 1.15 : 1.45);
    abdomen.position.z = -0.82;
    group.add(head, body, abdomen, leftWing, rightWing, rearLeftWing, rearRightWing);
    return { group, leftWing, rightWing, rearLeftWing, rearRightWing };
  }

  private createHerdRig(relief: boolean): Rig {
    const material = this.trackMaterial(
      new MeshStandardMaterial({
        color: relief ? '#b97748' : '#d09261',
        roughness: 0.9,
        side: DoubleSide,
        flatShading: relief,
      }),
    );
    const bodyGeometry = this.makeShape(
      [
        [-0.78, -0.22],
        [-0.62, 0.22],
        [-0.25, 0.4],
        [0.48, 0.36],
        [0.78, 0.12],
        [0.68, -0.25],
        [0.18, -0.38],
        [-0.48, -0.34],
      ],
      'verticalSide',
      relief,
    );
    const headGeometry = this.makeShape(
      [
        [-0.32, -0.18],
        [-0.18, 0.2],
        [0.08, 0.34],
        [0.38, 0.18],
        [0.5, -0.02],
        [0.24, -0.2],
      ],
      'verticalSide',
      relief,
    );
    const legGeometry = this.makeShape(
      [
        [-0.13, 0],
        [-0.1, 0.08],
        [0.03, 0.08],
        [0.1, -0.86],
        [0.02, -1.02],
        [-0.11, -0.96],
        [-0.07, -0.42],
      ],
      'verticalSide',
      relief,
    );
    const tailGeometry = this.makeShape(
      [
        [-0.04, 0.04],
        [0.06, 0.02],
        [0.02, -0.28],
        [-0.12, -0.58],
        [-0.25, -0.72],
        [-0.18, -0.48],
        [-0.07, -0.22],
      ],
      'verticalSide',
      relief,
    );
    return this.makeRig(
      [
        new InstancedMesh(bodyGeometry, material, this.herdCount),
        new InstancedMesh(headGeometry, material, this.herdCount),
        new InstancedMesh(legGeometry, material, this.herdCount * 4),
        new InstancedMesh(tailGeometry, material, this.herdCount),
      ],
      (meshes, count) => {
        meshes[0].count = count;
        meshes[1].count = count;
        meshes[2].count = count * 4;
        meshes[3].count = count;
      },
    );
  }

  private createFishRig(relief: boolean): Rig {
    const material = this.trackMaterial(
      new MeshStandardMaterial({
        color: relief ? '#5fb6ca' : '#84d5df',
        roughness: 0.72,
        side: DoubleSide,
        flatShading: relief,
      }),
    );
    const body = this.makeShape(
      [
        [-0.68, 0],
        [-0.42, 0.3],
        [0.18, 0.38],
        [0.68, 0.1],
        [0.78, 0],
        [0.58, -0.18],
        [0.1, -0.34],
        [-0.42, -0.26],
      ],
      'verticalSide',
      relief,
    );
    const tail = this.makeShape(
      [
        [0, 0],
        [-0.48, 0.4],
        [-0.42, 0],
        [-0.48, -0.4],
      ],
      'verticalSide',
      relief,
    );
    const leftFin = this.makeShape(
      [
        [0, 0],
        [0.62, -0.18],
        [0.35, 0.22],
      ],
      'top',
      relief,
    );
    const rightFin = this.makeShape(
      [
        [0, 0],
        [-0.62, -0.18],
        [-0.35, 0.22],
      ],
      'top',
      relief,
    );
    return this.makeRig(
      [
        new InstancedMesh(body, material, this.fishCount),
        new InstancedMesh(tail, material, this.fishCount),
        new InstancedMesh(leftFin, material, this.fishCount),
        new InstancedMesh(rightFin, material, this.fishCount),
      ],
      (meshes, count) => meshes.forEach((mesh) => (mesh.count = count)),
    );
  }

  private makeRig(
    meshes: InstancedMesh[],
    countSetter: (meshes: InstancedMesh[], count: number) => void,
  ): Rig {
    const group = new Group();
    for (const mesh of meshes) {
      mesh.frustumCulled = false;
      group.add(mesh);
    }
    return { group, meshes, setCount: (count) => countSetter(meshes, count) };
  }

  private makeShape(
    points: readonly (readonly [number, number])[],
    plane: 'side' | 'verticalSide' | 'top',
    relief: boolean,
  ): BufferGeometry {
    const shape = new Shape(points.map(([x, y]) => new Vector2(x, y)));
    const geometry = relief
      ? new ExtrudeGeometry(shape, {
          depth: 0.1,
          bevelEnabled: true,
          bevelSize: 0.025,
          bevelThickness: 0.025,
          bevelSegments: 1,
        })
      : new ShapeGeometry(shape);
    geometry.translate(0, 0, relief ? -0.05 : 0);
    if (plane === 'side') geometry.rotateY(Math.PI / 2);
    if (plane === 'verticalSide') {
      geometry.rotateX(Math.PI / 2);
      geometry.rotateZ(Math.PI / 2);
    }
    this.geometries.add(geometry);
    return geometry;
  }

  private trackMaterial<T extends Material>(material: T): T {
    this.materials.add(material);
    return material;
  }

  private setFlyingBase(
    position: { x: number; y: number; z: number },
    velocity: { x: number; y: number; z: number },
  ): void {
    this.direction.set(velocity.x, velocity.y, velocity.z);
    if (this.direction.lengthSq() < 1e-6) this.direction.copy(LOCAL_FORWARD);
    this.base.position.set(position.x, position.y, position.z);
    this.base.quaternion.setFromUnitVectors(
      LOCAL_FORWARD,
      this.direction.normalize(),
    );
    this.base.scale.setScalar(0.82);
    this.base.updateMatrix();
  }

  private setGroundBase(
    position: { x: number; y: number; z: number },
    velocity: { x: number; z: number },
    bounce: number,
  ): void {
    this.direction.set(velocity.x, 0, velocity.z);
    if (this.direction.lengthSq() < 1e-6) this.direction.set(0, 0, 1);
    this.direction.normalize();
    this.right.crossVectors(this.direction, WORLD_UP).normalize();
    this.up.crossVectors(this.right, this.direction).normalize();
    this.basis.makeBasis(this.right, this.direction, this.up);
    this.baseQuaternion.setFromRotationMatrix(this.basis);
    this.base.position.set(position.x, position.y + 0.82 + bounce, position.z);
    this.base.quaternion.copy(this.baseQuaternion);
    this.base.scale.setScalar(1.15);
    this.base.updateMatrix();
  }

  private setPartMatrix(
    x: number,
    y: number,
    z: number,
    rx: number,
    ry: number,
    rz: number,
  ): void {
    this.part.position.set(x, y, z);
    this.part.rotation.set(rx, ry, rz);
    this.part.scale.setScalar(1);
    this.part.updateMatrix();
  }
}
