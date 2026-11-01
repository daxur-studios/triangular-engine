import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  BoxGeometry,
  Color,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Raycaster,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import { ALL_CAPSULE_CHARACTER_PRESETS } from 'triangular-engine/characters';
import { CapsuleCharacterActor } from 'triangular-engine/procedural';

interface SandboxHuman {
  readonly id: string;
  readonly actor: CapsuleCharacterActor;
  readonly selectionRing: Mesh;
  target?: Vector3;
  sitting: boolean;
}

type InteractionKind = 'pickup' | 'sit';
type SandboxHumanState =
  | 'Ready'
  | 'Walking'
  | 'Reaching'
  | 'Sitting'
  | 'Holding rock';

interface PendingInteraction {
  readonly kind: InteractionKind;
  readonly humanId: string;
  phase: 'approach' | 'reach';
  elapsedSeconds: number;
}

const POPULATION_OPTIONS = [1, 16, 48] as const;
const WALK_SPEED_MPS = 1.65;
const INTERACTION_REACH_SECONDS = 0.7;

@Component({
  selector: 'app-capsule-human-sandbox-page',
  imports: [EngineModule, RouterLink, DecimalPipe],
  templateUrl: './capsule-human-sandbox-page.component.html',
  styleUrl: './capsule-human-sandbox-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class CapsuleHumanSandboxPageComponent {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly raycaster = new Raycaster();
  private readonly pointerNdc = new Vector2();
  private readonly pointerDown = new Vector2();
  private pointerWasDown = false;
  private readonly humans: SandboxHuman[] = [];
  private pendingInteraction?: PendingInteraction;
  private readonly heldByHumanId = signal<string | undefined>(undefined);
  private renderFrameCount = 0;

  readonly populationOptions = POPULATION_OPTIONS;
  readonly population = signal(1);
  readonly selectedHumanId = signal('human-1');
  readonly selectedHumanState = signal<SandboxHumanState>('Ready');
  readonly status = signal(
    'Click the ground to walk. Select a human by clicking them.',
  );
  readonly selectedHumanNumber = computed(() => {
    const id = this.selectedHumanId();
    return Number(id.slice('human-'.length)) || 1;
  });
  readonly rockIsHeld = computed(() => this.heldByHumanId() !== undefined);
  readonly cameraPosition = signal<[number, number, number]>([5, 4.5, 7]);
  readonly cameraTarget = signal<[number, number, number]>([0, 0.8, 0]);
  readonly renderStats = signal({ drawCalls: 0, triangles: 0 });

  private readonly ground = new Mesh(
    new PlaneGeometry(24, 24),
    new MeshStandardMaterial({
      color: '#25313a',
      roughness: 0.88,
      metalness: 0.03,
    }),
  );
  private readonly rock = this.createRock();
  private readonly chair = this.createChair();
  private readonly ringGeometry = new TorusGeometry(0.37, 0.026, 8, 32);
  private readonly activeRingMaterial = new MeshStandardMaterial({
    color: '#ffd48c',
    emissive: '#7a431c',
    roughness: 0.5,
  });
  private readonly inactiveRingMaterial = new MeshStandardMaterial({
    color: '#7f8b93',
    roughness: 0.7,
  });

  constructor() {
    this.engine.scene.background = new Color('#141a22');
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.035;
    this.ground.receiveShadow = true;
    this.ground.name = 'sandbox-ground';
    this.rock.position.set(-2.0, 0.13, 1.1);
    this.chair.position.set(2.0, 0, 0.35);
    this.engine.scene.add(this.ground, this.rock, this.chair);

    this.createPopulation(1);

    this.engine.mousedown$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        if (!event || event.button !== 0) return;
        this.pointerDown.set(event.clientX, event.clientY);
        this.pointerWasDown = true;
      });
    this.engine.mouseup$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        if (!event || event.button !== 0 || !this.pointerWasDown) return;
        this.pointerWasDown = false;
        const distance = Math.hypot(
          event.clientX - this.pointerDown.x,
          event.clientY - this.pointerDown.y,
        );
        if (distance > 5) return;
        this.handleSceneClick(event);
      });
    this.engine.tick$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((deltaSeconds) => this.update(deltaSeconds));
    this.engine.renderComplete$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (++this.renderFrameCount % 12 !== 0) return;
        const render = this.engine.renderer.info.render;
        this.renderStats.set({
          drawCalls: render.calls,
          triangles: render.triangles,
        });
      });

    this.destroyRef.onDestroy(() => this.disposeScene());
  }

  setPopulation(count: number): void {
    if (
      !POPULATION_OPTIONS.includes(count as (typeof POPULATION_OPTIONS)[number])
    )
      return;
    if (count === this.population()) return;
    this.dropRock();
    this.cancelPendingInteraction();
    this.createPopulation(count);
    this.population.set(count);
    this.selectedHumanId.set('human-1');
    this.selectedHumanState.set('Ready');
    const viewScale = count === 1 ? 1 : count === 16 ? 1.75 : 2.45;
    this.cameraPosition.set([5 * viewScale, 4.5 * viewScale, 7 * viewScale]);
    this.cameraTarget.set([0, 0.8, 0]);
    this.status.set(
      `${count} procedural humans. Select one, then click the ground to move them.`,
    );
  }

  pickUpRock(): void {
    const human = this.getSelectedHuman();
    if (!human) return;
    if (this.heldByHumanId()) {
      this.status.set(
        'The rock is already being carried. Drop it before picking it up again.',
      );
      return;
    }
    this.cancelPendingInteraction();
    this.stand(human);
    const destination = this.approachPoint(
      human.actor.root.position,
      this.rock.position,
      0.44,
    );
    human.target = destination;
    human.actor.setLocomotion('walk');
    this.syncSelectedHumanState(human);
    this.pendingInteraction = {
      kind: 'pickup',
      humanId: human.id,
      phase: 'approach',
      elapsedSeconds: 0,
    };
    this.status.set(`${this.humanLabel(human)} is walking over to the rock.`);
  }

  useChair(): void {
    const human = this.getSelectedHuman();
    if (!human) return;
    if (human.sitting) {
      this.stand(human);
      this.status.set(`${this.humanLabel(human)} stood up.`);
      return;
    }
    this.cancelPendingInteraction();
    const seatPosition = this.chair.position
      .clone()
      .add(new Vector3(0, 0, 0.27));
    human.target = seatPosition;
    human.actor.setLocomotion('walk');
    this.syncSelectedHumanState(human);
    this.pendingInteraction = {
      kind: 'sit',
      humanId: human.id,
      phase: 'approach',
      elapsedSeconds: 0,
    };
    this.status.set(`${this.humanLabel(human)} is walking to the chair.`);
  }

  dropRock(): void {
    const heldByHumanId = this.heldByHumanId();
    if (!heldByHumanId) return;
    const holder = this.humans.find((human) => human.id === heldByHumanId);
    if (!holder) {
      this.heldByHumanId.set(undefined);
      return;
    }
    const worldPosition = this.rock.getWorldPosition(new Vector3());
    const worldQuaternion = this.rock.getWorldQuaternion(
      this.rock.quaternion.clone(),
    );
    this.rock.removeFromParent();
    this.engine.scene.add(this.rock);
    this.rock.position.copy(worldPosition);
    this.rock.quaternion.copy(worldQuaternion);
    this.rock.scale.setScalar(1);
    holder.actor.setHandAction('right', 'none');
    this.heldByHumanId.set(undefined);
    this.syncSelectedHumanState(holder);
    this.status.set(
      'Rock dropped. Click the rock or use Pick up rock to collect it again.',
    );
  }

  private createPopulation(count: number): void {
    for (const human of this.humans.splice(0)) {
      human.actor.root.removeFromParent();
      human.actor.dispose();
    }

    const placements = this.gridPlacements();
    for (let index = 0; index < count; index++) {
      const id = `human-${index + 1}`;
      const preset =
        ALL_CAPSULE_CHARACTER_PRESETS[
          (index * 5) % ALL_CAPSULE_CHARACTER_PRESETS.length
        ];
      const actor = new CapsuleCharacterActor({ dna: preset, autoBlink: true });
      actor.root.name = id;
      actor.root.userData['sandboxHumanId'] = id;
      actor.root.position.set(placements[index][0], 0, placements[index][1]);
      const ring = new Mesh(
        this.ringGeometry,
        index === 0 ? this.activeRingMaterial : this.inactiveRingMaterial,
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.025;
      ring.name = `${id}-selection-ring`;
      ring.userData['sandboxHumanId'] = id;
      actor.root.add(ring);
      this.humans.push({ id, actor, selectionRing: ring, sitting: false });
      this.engine.scene.add(actor.root);
    }
  }

  private gridPlacements(): [number, number][] {
    const positions: [number, number][] = [[0, 0]];
    for (let row = -3; row <= 3; row++) {
      for (let column = -3; column <= 3; column++) {
        if (row === 0 && column === 0) continue;
        positions.push([column * 1.35, row * 1.35]);
      }
    }
    return positions;
  }

  private createRock(): Group {
    const group = new Group();
    group.name = 'pickup-rock';
    const mesh = new Mesh(
      new IcosahedronGeometry(0.14, 1),
      new MeshStandardMaterial({
        color: '#a6a69a',
        roughness: 0.94,
        flatShading: true,
      }),
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'pickup-rock-mesh';
    group.add(mesh);
    return group;
  }

  private createChair(): Group {
    const group = new Group();
    group.name = 'sit-chair';
    const wood = new MeshStandardMaterial({
      color: '#a66c45',
      roughness: 0.76,
    });
    const seat = new Mesh(new BoxGeometry(0.82, 0.13, 0.78), wood);
    seat.position.set(0, 0.63, 0);
    seat.castShadow = true;
    seat.receiveShadow = true;
    const back = new Mesh(new BoxGeometry(0.82, 0.82, 0.13), wood);
    back.position.set(0, 1.06, -0.33);
    back.castShadow = true;
    back.receiveShadow = true;
    group.add(seat, back);
    for (const x of [-0.31, 0.31]) {
      for (const z of [-0.28, 0.28]) {
        const leg = new Mesh(new BoxGeometry(0.11, 0.62, 0.11), wood);
        leg.position.set(x, 0.31, z);
        leg.castShadow = true;
        group.add(leg);
      }
    }
    return group;
  }

  private handleSceneClick(event: MouseEvent): void {
    const resolution = this.engine.resolution$.value;
    this.pointerNdc.set(
      (event.offsetX / resolution.width) * 2 - 1,
      -(event.offsetY / resolution.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointerNdc, this.engine.camera);

    const rockHit = this.raycaster.intersectObject(this.rock, true)[0];
    if (rockHit) {
      this.pickUpRock();
      return;
    }
    const chairHit = this.raycaster.intersectObject(this.chair, true)[0];
    if (chairHit) {
      this.useChair();
      return;
    }
    for (const human of this.humans) {
      const hit = this.raycaster.intersectObject(human.actor.root, true)[0];
      if (hit) {
        this.selectHuman(human);
        return;
      }
    }
    const groundHit = this.raycaster.intersectObject(this.ground, false)[0];
    if (!groundHit) return;
    const human = this.getSelectedHuman();
    if (!human) return;
    this.cancelPendingInteraction();
    this.stand(human);
    human.target = new Vector3(groundHit.point.x, 0, groundHit.point.z);
    human.actor.setLocomotion('walk');
    this.syncSelectedHumanState(human);
    this.status.set(`${this.humanLabel(human)} is walking to the marked spot.`);
  }

  private selectHuman(human: SandboxHuman): void {
    this.selectedHumanId.set(human.id);
    this.syncSelectedHumanState(human);
    for (const candidate of this.humans) {
      candidate.selectionRing.material =
        candidate === human
          ? this.activeRingMaterial
          : this.inactiveRingMaterial;
    }
    this.status.set(
      `${this.humanLabel(human)} selected. Click the ground to send them somewhere.`,
    );
  }

  private update(deltaSeconds: number): void {
    // EngineService already caps large frame deltas; retain its full bounded
    // delta so navigation does not become half speed after a slow frame.
    const delta = Math.max(deltaSeconds, 0);
    for (const human of this.humans) {
      if (human.target) this.moveHuman(human, delta);
      human.actor.update(delta);
      if (human.sitting) this.applySeatedPose(human.actor);
    }
    this.advanceInteraction(delta);
  }

  private moveHuman(human: SandboxHuman, delta: number): void {
    const target = human.target;
    if (!target) return;
    const dx = target.x - human.actor.root.position.x;
    const dz = target.z - human.actor.root.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 0.035) {
      human.actor.root.position.set(target.x, 0, target.z);
      human.target = undefined;
      human.actor.setLocomotion('idle');
      this.syncSelectedHumanState(human);
      this.onHumanArrived(human);
      return;
    }
    human.actor.root.rotation.y = Math.atan2(dx, dz);
    const step = Math.min(distance, WALK_SPEED_MPS * delta);
    human.actor.root.position.x += (dx / distance) * step;
    human.actor.root.position.z += (dz / distance) * step;
    human.actor.setLocomotion('walk');
  }

  private onHumanArrived(human: SandboxHuman): void {
    const interaction = this.pendingInteraction;
    if (
      !interaction ||
      interaction.humanId !== human.id ||
      interaction.phase !== 'approach'
    )
      return;
    if (interaction.kind === 'sit') {
      human.sitting = true;
      this.pendingInteraction = undefined;
      this.syncSelectedHumanState(human);
      this.status.set(
        `${this.humanLabel(human)} is sitting. Select them and use Stand up to continue.`,
      );
      return;
    }
    this.rock.updateMatrixWorld(true);
    human.actor.root.updateMatrixWorld(true);
    const reachPoint = this.rock
      .getWorldPosition(new Vector3())
      .add(new Vector3(0, 0.56, 0));
    const target = human.actor.root.worldToLocal(reachPoint);
    human.actor.setHandAction('right', 'reach', {
      x: target.x,
      y: target.y,
      z: target.z,
    });
    interaction.phase = 'reach';
    interaction.elapsedSeconds = 0;
    if (human.id === this.selectedHumanId()) {
      this.selectedHumanState.set('Reaching');
    }
    this.status.set(
      `${this.humanLabel(human)} is reaching down to pick it up.`,
    );
  }

  private advanceInteraction(delta: number): void {
    const interaction = this.pendingInteraction;
    if (!interaction || interaction.phase !== 'reach') return;
    interaction.elapsedSeconds += delta;
    if (interaction.elapsedSeconds < INTERACTION_REACH_SECONDS) return;
    const human = this.humans.find(
      (candidate) => candidate.id === interaction.humanId,
    );
    if (!human) return;
    this.rock.removeFromParent();
    human.actor.rightHand.propSocket.add(this.rock);
    this.rock.position.set(0, -0.11, 0.03);
    this.rock.rotation.set(0.2, 0.25, 0.15);
    this.rock.scale.setScalar(0.82);
    human.actor.setHandAction('right', 'hold_gadget');
    this.heldByHumanId.set(human.id);
    this.syncSelectedHumanState(human);
    this.pendingInteraction = undefined;
    this.status.set(
      `${this.humanLabel(human)} picked up the rock. Drop it or keep exploring.`,
    );
  }

  private applySeatedPose(actor: CapsuleCharacterActor): void {
    const dna = actor.dna;
    const hipY = 0.13 + 0.56 * 0.92;
    const hipOffsetX = dna.bodyRadius * 0.44;
    const hips = [
      {
        x: -hipOffsetX,
        sign: -1 as const,
        leg: actor.leftLegMesh,
        boot: actor.leftBoot,
      },
      {
        x: hipOffsetX,
        sign: 1 as const,
        leg: actor.rightLegMesh,
        boot: actor.rightBoot,
      },
    ];
    for (const { x, sign, leg, boot } of hips) {
      const end = { x: sign * 0.16, y: 0.14, z: 0.78 };
      const control = { x: sign * 0.16, y: 0.36, z: 0.72 };
      leg.updateCurve({ x, y: hipY, z: 0 }, control, end);
      boot.root.position.set(end.x, end.y, end.z);
      boot.root.rotation.set(0, 0, 0);
    }

    const centerY = hipY + dna.bodyRadius * 0.65 + dna.bodyHeight * 0.5;
    const shoulderY = centerY - dna.bodyHeight * 0.08;
    const shoulderX = dna.bodyRadius * 0.94;
    const lapY = hipY + 0.09;
    actor.leftArmMesh.updateCurve(
      { x: -shoulderX, y: shoulderY, z: 0 },
      { x: -0.27, y: shoulderY - 0.26, z: 0.27 },
      { x: -0.08, y: lapY, z: 0.32 },
    );
    actor.rightArmMesh.updateCurve(
      { x: shoulderX, y: shoulderY, z: 0 },
      { x: 0.27, y: shoulderY - 0.26, z: 0.27 },
      { x: 0.08, y: lapY, z: 0.32 },
    );
    actor.leftHand.root.position.set(-0.08, lapY, 0.32);
    actor.rightHand.root.position.set(0.08, lapY, 0.32);
    actor.leftHand.root.rotation.set(-0.15, 0, 0.1);
    actor.rightHand.root.rotation.set(-0.15, 0, -0.1);
    actor.leftHand.setPose('open');
    actor.rightHand.setPose('open');
  }

  private stand(human: SandboxHuman): void {
    human.sitting = false;
    human.actor.setHandAction('right', 'none');
    this.syncSelectedHumanState(human);
  }

  private syncSelectedHumanState(human: SandboxHuman): void {
    if (human.id !== this.selectedHumanId()) return;
    if (human.sitting) this.selectedHumanState.set('Sitting');
    else if (this.heldByHumanId() === human.id) {
      this.selectedHumanState.set('Holding rock');
    } else if (human.target) this.selectedHumanState.set('Walking');
    else this.selectedHumanState.set('Ready');
  }

  private cancelPendingInteraction(): void {
    if (this.pendingInteraction) {
      const human = this.humans.find(
        (candidate) => candidate.id === this.pendingInteraction?.humanId,
      );
      human?.actor.setHandAction('right', 'none');
    }
    this.pendingInteraction = undefined;
  }

  private approachPoint(from: Vector3, target: Vector3, gap: number): Vector3 {
    const direction = from.clone().sub(target);
    direction.y = 0;
    if (direction.lengthSq() < 1e-6) direction.set(0, 0, 1);
    direction.normalize().multiplyScalar(gap);
    return new Vector3(target.x + direction.x, 0, target.z + direction.z);
  }

  private getSelectedHuman(): SandboxHuman | undefined {
    return this.humans.find((human) => human.id === this.selectedHumanId());
  }

  private humanLabel(human: SandboxHuman): string {
    return `Human ${human.id.slice('human-'.length).padStart(2, '0')}`;
  }

  private disposeScene(): void {
    this.cancelPendingInteraction();
    for (const human of this.humans.splice(0)) {
      human.actor.root.removeFromParent();
      human.actor.dispose();
    }
    this.engine.scene.remove(this.ground, this.rock, this.chair);
    this.ground.geometry.dispose();
    (this.ground.material as MeshStandardMaterial).dispose();
    this.rock.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
        (object.material as MeshStandardMaterial).dispose();
      }
    });
    this.chair.traverse((object) => {
      if (object instanceof Mesh) object.geometry.dispose();
    });
    (this.chair.children[0] as Mesh).material &&
      (
        (this.chair.children[0] as Mesh).material as MeshStandardMaterial
      ).dispose();
    this.ringGeometry.dispose();
    this.activeRingMaterial.dispose();
    this.inactiveRingMaterial.dispose();
  }
}
