import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EngineModule, EngineService } from 'triangular-engine';
import { IJoltSoftBodyCreatedEvent, JoltPhysicsModule, JoltSoftBodyComponent } from 'triangular-engine/jolt';
import type { Vector3Tuple } from 'three';

interface SoftMesh {
  readonly vertices: ReadonlyArray<readonly [number, number, number]>;
  readonly faces: ReadonlyArray<readonly [number, number, number]>;
}

function cubeMesh(offsetX: number, width: number): SoftMesh {
  const vertices: Array<readonly [number, number, number]> = [];
  const faces: Array<readonly [number, number, number]> = [];
  const n = 3;
  const index = (x: number, y: number, z: number) => {
    const id = vertices.length;
    vertices.push([offsetX + (x / n - 0.5) * width, (y / n - 0.5) * 3.2, (z / n - 0.5) * 3.2]);
    return id;
  };
  const addFace = (points: Array<readonly [number, number, number]>): void => {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const at = (u: number, v: number) => points.push([u, v, 0]) && 0;
      void at;
      const a = index(x, y, 0), b = index(x + 1, y, 0), c = index(x + 1, y + 1, 0), d = index(x, y + 1, 0);
      faces.push([a, c, b], [a, d, c]);
    }
  };
  void addFace;
  // A compact closed two-sided shell; each fragment is intentionally independent for this first split test.
  const corners = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] as const;
  for (const [x, y, z] of corners) vertices.push([offsetX + x * width * 0.5, y * 1.6, z * 1.6]);
  faces.push([0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [3, 7, 6], [3, 6, 2], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5]);
  return { vertices, faces };
}

const WHOLE = cubeMesh(0, 3.2);
const LEFT = cubeMesh(0, 1.9);
const RIGHT = cubeMesh(0, 1.9);
const WHOLE_COLOR = 0x4fd6a8;
const LEFT_COLOR = 0xff9f68;
const RIGHT_COLOR = 0x70b7ff;

/** Controlled split experiment for the soft-body destruction path. */
@Component({
  selector: 'app-soft-body-tear-lab-page',
  imports: [RouterLink, EngineModule, JoltPhysicsModule, JoltSoftBodyComponent],
  templateUrl: './soft-body-tear-lab-page.component.html',
  styleUrl: './soft-body-tear-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class SoftBodyTearLabPageComponent {
  readonly whole = WHOLE;
  readonly left = LEFT;
  readonly right = RIGHT;
  readonly wholeColor = WHOLE_COLOR;
  readonly leftColor = LEFT_COLOR;
  readonly rightColor = RIGHT_COLOR;
  readonly split = signal(false);
  readonly intactPosition = signal<Vector3Tuple>([0, 5, 0]);
  readonly intactVelocity = signal<Vector3Tuple>([0, 0, 0]);
  private intactOwner?: IJoltSoftBodyCreatedEvent['owner'];
  private intactBody?: IJoltSoftBodyCreatedEvent['body'];

  captureIntactBody(event: IJoltSoftBodyCreatedEvent): void {
    this.intactOwner = event.owner;
    this.intactBody = event.body;
  }
  detonate(): void {
    const body = this.intactBody;
    if (body) {
      const position = body.GetPosition();
      this.intactPosition.set([position.GetX(), position.GetY(), position.GetZ()]);
      const velocity = body.GetLinearVelocity();
      this.intactVelocity.set([velocity.GetX(), velocity.GetY(), velocity.GetZ()]);
    }
    this.intactOwner?.dispose();
    this.split.set(true);
  }
  reset(): void { this.split.set(false); }
  fragmentPosition(offsetX: number): Vector3Tuple {
    const [x, y, z] = this.intactPosition();
    return [x + offsetX, y, z];
  }
  fragmentVelocity(offsetX: number): Vector3Tuple {
    const [x, y, z] = this.intactVelocity();
    return [x + offsetX * 3, y, z];
  }
}
