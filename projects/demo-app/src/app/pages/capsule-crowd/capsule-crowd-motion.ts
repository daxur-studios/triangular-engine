import { NavAgentState, NavCrowd, NavGrid, NavSectorGraph } from 'triangular-engine/crowd-navigation';

export const CROWD_COUNT = 256;
export const PLAZA_SIZE = 48;
export const PLANTERS = [
  { x: 17, y: 17, width: 5, height: 5 },
  { x: 26, y: 26, width: 5, height: 5 },
] as const;

/** One simulation feeds both render modes. Its coordinates are metres on a flat plaza. */
export class CapsuleCrowdMotion {
  readonly x = new Float32Array(CROWD_COUNT);
  readonly z = new Float32Array(CROWD_COUNT);
  readonly yaw = new Float32Array(CROWD_COUNT);
  readonly phase = new Float32Array(CROWD_COUNT);
  private readonly nav: NavCrowd;
  private readonly goals: number[];
  private readonly lastX = new Float32Array(CROWD_COUNT);
  private readonly lastZ = new Float32Array(CROWD_COUNT);
  private remainder = 0;

  constructor() {
    const grid = NavGrid.fromHeightfield({
      width: PLAZA_SIZE, height: PLAZA_SIZE, cellSize: 1,
      heights: new Float32Array(PLAZA_SIZE * PLAZA_SIZE),
    });
    for (const planter of PLANTERS) grid.stampStructure(planter);
    this.nav = new NavCrowd(NavSectorGraph.build(grid, { sectorSize: 16 }), {
      capacity: CROWD_COUNT, seed: 73, maxSpeed: 1.7, separationRadius: .8, arrivalRadius: 2.4,
    });
    const corners = [[7, 7], [40, 7], [40, 40], [7, 40]];
    this.goals = corners.map(([x, y]) => this.nav.addGoal(x, y));
    for (const [index, [x, y]] of corners.entries()) {
      this.nav.spawnRandom(CROWD_COUNT / corners.length, {
        x: x - 5, y: y - 5, width: 16, height: 16,
      }, this.goals[(index + 2) % corners.length]);
    }
    if (this.nav.count !== CROWD_COUNT) throw new Error('Could not place all capsule humans.');
    this.lastX.set(this.nav.posX);
    this.lastZ.set(this.nav.posY);
    for (let i = 0; i < CROWD_COUNT; i++) this.phase[i] = (i * .618034) % 1;
    this.advance(0);
  }

  get moving(): number {
    return this.nav.stats.moving;
  }

  advance(dt: number): void {
    const elapsed = Math.min(.1, dt);
    const { fixedDt, posX, posY, velX, velY, state, goalId } = this.nav;
    this.remainder += elapsed;
    while (this.remainder >= fixedDt) {
      this.lastX.set(posX);
      this.lastZ.set(posY);
      this.nav.step();
      for (let i = 0; i < CROWD_COUNT; i++) {
        if (state[i] === NavAgentState.Arrived) {
          this.nav.retargetAgent(i, this.goals[(goalId[i] + 1 + i % 2) % this.goals.length]);
        }
      }
      this.remainder -= fixedDt;
    }

    const blend = this.remainder / fixedDt;
    for (let i = 0; i < CROWD_COUNT; i++) {
      this.x[i] = this.lastX[i] + (posX[i] - this.lastX[i]) * blend - PLAZA_SIZE / 2;
      this.z[i] = this.lastZ[i] + (posY[i] - this.lastZ[i]) * blend - PLAZA_SIZE / 2;
      const speed = Math.hypot(velX[i], velY[i]);
      this.phase[i] = (this.phase[i] + elapsed * speed / 1.3) % 1;
      if (speed < .08) continue;
      const turn = Math.atan2(velX[i], velY[i]) - this.yaw[i];
      this.yaw[i] += Math.atan2(Math.sin(turn), Math.cos(turn)) * Math.min(1, 9 * elapsed);
    }
  }
}
