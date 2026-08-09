import { ChangeDetectionStrategy, Component, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Vector3Tuple } from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import { JoltPhysicsModule, JoltRigidBodyComponent, type IContactAddedEvent } from 'triangular-engine/jolt';

type Fragment = {
  readonly id: number;
  readonly position: Vector3Tuple;
  readonly velocity: Vector3Tuple;
  readonly rotation: Vector3Tuple;
  readonly size: Vector3Tuple;
  readonly color: string;
};

const CRATE_SIZE: Vector3Tuple = [3, 3, 3];
const CRATE_START: Vector3Tuple = [0, 8, 0];

/**
 * Game-style destruction experiment. Jolt continues to simulate rigid bodies;
 * deformation is an authored damage state, and explosion replaces the source
 * body with a fixed small set of debris bodies.
 */
@Component({
  selector: 'app-destruction-poc-page',
  imports: [RouterLink, EngineModule, JoltPhysicsModule],
  templateUrl: './destruction-poc-page.component.html',
  styleUrl: './destruction-poc-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class DestructionPocPageComponent {
  readonly crate = viewChild<JoltRigidBodyComponent>('crate');
  readonly run = signal(0);
  readonly squash = signal(0);
  readonly exploded = signal(false);
  readonly fragments = signal<readonly Fragment[]>([]);
  readonly status = signal('Drop the crate. A hard floor impact permanently squashes it.');

  crateSize(): Vector3Tuple {
    const damage = this.squash();
    return [CRATE_SIZE[0] * (1 + damage * 0.18), CRATE_SIZE[1] * (1 - damage * 0.42), CRATE_SIZE[2] * (1 + damage * 0.1)];
  }

  reset(): void {
    this.run.update((value) => value + 1);
    this.squash.set(0);
    this.exploded.set(false);
    this.fragments.set([]);
    this.status.set('Drop the crate. A hard floor impact permanently squashes it.');
  }

  explode(): void {
    const body = this.crate()?.body();
    const position = body?.GetPosition();
    const velocity = body?.GetLinearVelocity();
    const origin: Vector3Tuple = position ? [position.GetX(), position.GetY(), position.GetZ()] : CRATE_START;
    const inherited: Vector3Tuple = velocity ? [velocity.GetX(), velocity.GetY(), velocity.GetZ()] : [0, 0, 0];
    const directions: ReadonlyArray<Vector3Tuple> = [[1, 0.4, 0], [-1, 0.35, 0], [0, 0.45, 1], [0, 0.3, -1], [0.5, 0.8, 0.5], [-0.45, 0.75, -0.55]];
    this.fragments.set(directions.map((direction, id) => ({
      id,
      position: [origin[0] + direction[0] * 0.7, origin[1] + direction[1] * 0.7, origin[2] + direction[2] * 0.7],
      velocity: [inherited[0] + direction[0] * 8, inherited[1] + direction[1] * 8, inherited[2] + direction[2] * 8],
      rotation: [id * 0.31, id * 0.57, id * 0.19],
      size: id < 4 ? [2.65, 0.18, 1.35] : [1.2, 1.1, 1.1],
      color: id < 4 ? '#d46d43' : '#ef9a5c',
    })));
    this.exploded.set(true);
    this.status.set('Fractured: six deterministic rigid debris pieces are now simulated.');
  }

  onCrateContact(_event: IContactAddedEvent): void {
    if (this.exploded() || this.squash() > 0) return;
    const verticalVelocity = this.crate()?.body()?.GetLinearVelocity().GetY();
    if (verticalVelocity === undefined || verticalVelocity > -6) return;
    // Contact callbacks happen during the physics step. Mutate Angular/Jolt state after it returns.
    queueMicrotask(() => {
      if (this.exploded() || this.squash() > 0) return;
      this.squash.set(Math.min(1, Math.abs(verticalVelocity) / 14));
      this.status.set('Impact damage applied: the crate is permanently squashed, with matching collision bounds.');
    });
  }
}
