import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  GridHelper,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';

interface ICharacterAttempt {
  readonly id: string;
  readonly label: string;
  readonly x: number;
}

interface IAttemptDefinition extends ICharacterAttempt {
  readonly build: (group: Group) => void;
}

const ATTEMPT_SPACING = 2.5;

@Component({
  selector: 'app-character-lab-page',
  imports: [RouterLink, EngineModule],
  templateUrl: './character-lab-page.component.html',
  styleUrl: './character-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class CharacterLabPageComponent {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);

  readonly attempts = signal<readonly ICharacterAttempt[]>([]);
  readonly selectedAttemptId = signal('capsule-person');

  readonly activeTarget = computed<[number, number, number]>(() => {
    const selected = this.attempts().find((a) => a.id === this.selectedAttemptId());
    return selected ? [selected.x, 1.1, 0] : [0, 1.1, 0];
  });

  private readonly rootGroup = new Group();

  constructor() {
    const grid = new GridHelper(24, 24, 0x445566, 0x223344);
    grid.position.y = 0.001;
    this.rootGroup.add(grid);
    this.engine.scene.add(this.rootGroup);

    this.registerAttempts();

    this.destroyRef.onDestroy(() => this.rootGroup.clear());
  }

  selectAttempt(id: string): void {
    this.selectedAttemptId.set(id);
  }

  private registerAttempts(): void {
    const defs: readonly IAttemptDefinition[] = [
      {
        id: 'capsule-person',
        label: 'Capsule person',
        x: -ATTEMPT_SPACING,
        build: (group) => this.buildCapsulePerson(group),
      },
      {
        id: 'box-robot',
        label: 'Box robot',
        x: ATTEMPT_SPACING,
        build: (group) => this.buildBoxRobot(group),
      },
    ];

    const items: ICharacterAttempt[] = [];
    for (const def of defs) {
      const group = new Group();
      group.position.x = def.x;
      def.build(group);
      this.rootGroup.add(group);
      items.push({ id: def.id, label: def.label, x: def.x });
    }

    this.attempts.set(items);
  }

  private buildCapsulePerson(group: Group): void {
    const bodyMat = new MeshStandardMaterial({ color: '#4f8fbf', roughness: 0.75 });
    const headMat = new MeshStandardMaterial({ color: '#e6c39a', roughness: 0.85 });

    const body = new Mesh(new CapsuleGeometry(0.34, 0.68, 4, 12), bodyMat);
    body.position.y = 0.85;
    body.castShadow = true;
    group.add(body);

    const head = new Mesh(new SphereGeometry(0.24, 24, 18), headMat);
    head.position.y = 1.58;
    head.castShadow = true;
    group.add(head);

    this.addPedestal(group);
  }

  private buildBoxRobot(group: Group): void {
    const mat = new MeshStandardMaterial({ color: '#9aa5b1', roughness: 0.4, metalness: 0.55 });

    const torso = new Mesh(new BoxGeometry(0.7, 0.8, 0.5), mat);
    torso.position.y = 1.0;
    torso.castShadow = true;
    group.add(torso);

    const head = new Mesh(new BoxGeometry(0.4, 0.35, 0.4), mat);
    head.position.y = 1.62;
    head.castShadow = true;
    group.add(head);

    this.addPedestal(group);
  }

  private addPedestal(group: Group): void {
    const mat = new MeshStandardMaterial({ color: '#2a2f3a', roughness: 0.9 });
    const pedestal = new Mesh(new CylinderGeometry(0.5, 0.55, 0.08, 32), mat);
    pedestal.position.y = 0.04;
    pedestal.receiveShadow = true;
    group.add(pedestal);
  }
}
