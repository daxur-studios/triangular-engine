import type {
  ForceGraphConfig,
  ForceGraphLink,
  ForceGraphNode,
  SimNodeState,
} from './force-graph.types';

const DEFAULT_NODE_PADDING = 20;
const DEFAULT_LINK_GAP = 68;
const DEFAULT_REPULSION = 4200;
const DEFAULT_GRAVITY = 0.014;
const DEFAULT_DAMPING = 0.78;
const ALPHA_INITIAL = 1;
const ALPHA_MIN = 0.005;
const ALPHA_DECAY = 0.985;
const REHEAT_TOPOLOGY_MAJOR = 0.85;
const REHEAT_TOPOLOGY_MINOR = 0.45;
const REHEAT_RESIZE = 0.18;
const REHEAT_DRAG = 0.35;
const REHEAT_UNPIN = 0.25;
const WARM_START_TICKS = 30;
const COLLISION_PASSES = 3;
const COLLISION_SPLIT = 0.5;
const COLLISION_TANGENT_FRICTION = 0.82;
const OVERLAP_EPSILON = 0.25;
const MAX_COLLISION_PUSH_PER_PASS = 28;
const SLEEP_VELOCITY = 0.06;
const MAX_STEP_DISPLACEMENT = 20;
const MAX_REPULSION_FORCE = 12;
const BASE_SPRING_STIFFNESS = 0.14;
const MAX_LINK_WEIGHT_MULT = 2.0;
const HUB_MASS_PER_DEGREE = 0.35;
const GOLDEN_ANGLE_RAD = 2.399963229728653;
const INITIAL_RING_STEP = 38;
const MIN_DISTANCE = 1;
const REPO_BASE_WIDTH = 176;
const REPO_CHAR_WIDTH = 8.4;
const REPO_CHROME_WIDTH = 78;
const REPO_HEIGHT = 54;
const PILL_BASE_WIDTH = 154;
const PILL_CHAR_WIDTH = 7.4;
const PILL_CHROME_WIDTH = 52;
const PILL_TWO_LINE_HEIGHT = 48;
const PILL_SINGLE_LINE_HEIGHT = 36;
const POINT_DIAMETER = 26;
const MAX_NODE_WIDTH = 340;

/** Deterministic hash in `[0, 2π)` so node spawning is repeatable across runs. */
function hashIdToAngle(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const normalized = ((hash >>> 0) % 3600) / 3600;
  return normalized * Math.PI * 2;
}

/** Estimate rendered capsule/card dimensions from text content so pills never overlap. */
export function estimatePillSize(node: ForceGraphNode): { width: number; height: number } {
  if (typeof node.width === 'number' && typeof node.height === 'number') {
    return {
      width: Math.max(POINT_DIAMETER, node.width),
      height: Math.max(POINT_DIAMETER, node.height),
    };
  }
  if (node.variant === 'point') {
    return { width: node.width ?? POINT_DIAMETER, height: node.height ?? POINT_DIAMETER };
  }
  if (node.variant === 'repo') {
    const metricChars = node.metric ? node.metric.length + 2 : 0;
    const rawW = REPO_CHROME_WIDTH + (node.label.length + metricChars) * REPO_CHAR_WIDTH;
    return {
      width: node.width ?? Math.min(MAX_NODE_WIDTH, Math.max(REPO_BASE_WIDTH, Math.round(rawW))),
      height: node.height ?? REPO_HEIGHT,
    };
  }
  const topLen = node.label.length + (node.badge ? node.badge.length + 2 : 0);
  const subLen = node.subtitle ? node.subtitle.length : 0;
  const maxChars = Math.max(topLen, subLen);
  const rawW = PILL_CHROME_WIDTH + maxChars * PILL_CHAR_WIDTH;
  const height = node.subtitle ? PILL_TWO_LINE_HEIGHT : PILL_SINGLE_LINE_HEIGHT;
  return {
    width: node.width ?? Math.min(MAX_NODE_WIDTH, Math.max(PILL_BASE_WIDTH, Math.round(rawW))),
    height: node.height ?? height,
  };
}

/** Smooth elliptical half-extent along unit vector `(ux, uy)` to prevent sharp axis-aligned corners from oscillating. */
function directionalExtent(width: number, height: number, ux: number, uy: number): number {
  const hw = width * 0.5;
  const hh = height * 0.5;
  return Math.hypot(ux * hw, uy * hh);
}

/**
 * Deterministic 2D spring-and-pill-collision force layout.
 * Retains existing node coordinates across timeline scrubs and prevents text overlap via AABB projection.
 */
export class ForceGraphSimulation {
  private readonly simNodes = new Map<string, SimNodeState>();
  private links: readonly ForceGraphLink[] = [];
  private linkKeySet = new Set<string>();
  private degrees = new Map<string, number>();
  private readonly manuallyPinned = new Set<string>();
  private config: Required<Pick<ForceGraphConfig, 'nodePadding' | 'linkGap' | 'repulsion' | 'gravity' | 'damping'>>;
  private spawnCounter = 0;
  private alpha = ALPHA_INITIAL;

  constructor(config: ForceGraphConfig = {}) {
    this.config = {
      nodePadding: config.nodePadding ?? DEFAULT_NODE_PADDING,
      linkGap: config.linkGap ?? DEFAULT_LINK_GAP,
      repulsion: config.repulsion ?? DEFAULT_REPULSION,
      gravity: config.gravity ?? DEFAULT_GRAVITY,
      damping: config.damping ?? DEFAULT_DAMPING,
    };
  }

  updateConfig(config: ForceGraphConfig): void {
    this.config = {
      nodePadding: config.nodePadding ?? DEFAULT_NODE_PADDING,
      linkGap: config.linkGap ?? DEFAULT_LINK_GAP,
      repulsion: config.repulsion ?? DEFAULT_REPULSION,
      gravity: config.gravity ?? DEFAULT_GRAVITY,
      damping: config.damping ?? DEFAULT_DAMPING,
    };
  }

  /** Re-energize simulation cooling so layout adjustments can settle smoothly. */
  reheat(targetAlpha = REHEAT_TOPOLOGY_MINOR): void {
    this.alpha = Math.min(ALPHA_INITIAL, Math.max(this.alpha, targetAlpha));
  }

  /** Current simulation cooling temperature in `[0, 1]`. */
  getAlpha(): number {
    return this.alpha;
  }

  /** Whether the simulation has cooled below the minimum energy threshold and unpinned velocities have decayed. */
  isSettled(): boolean {
    if (this.alpha >= ALPHA_MIN) return false;
    for (const node of this.simNodes.values()) {
      if (!node.pinned && Math.hypot(node.vx, node.vy) > SLEEP_VELOCITY) {
        return false;
      }
    }
    return true;
  }

  /** Synchronize graph topology while keeping existing node positions intact. */
  syncGraph(nodes: readonly ForceGraphNode[], links: readonly ForceGraphLink[]): void {
    const incomingIds = new Set(nodes.map((n) => n.id));
    let removedCount = 0;
    for (const existingId of [...this.simNodes.keys()]) {
      if (!incomingIds.has(existingId)) {
        this.simNodes.delete(existingId);
        this.manuallyPinned.delete(existingId);
        removedCount += 1;
      }
    }

    this.links = links;
    const neighborMap = new Map<string, string[]>();
    const nextDegrees = new Map<string, number>();
    const nextLinkKeySet = new Set<string>();
    let linksChanged = links.length !== this.linkKeySet.size;

    for (const link of links) {
      nextLinkKeySet.add(link.id);
      if (!this.linkKeySet.has(link.id)) {
        linksChanged = true;
      }
      nextDegrees.set(link.source, (nextDegrees.get(link.source) ?? 0) + 1);
      nextDegrees.set(link.target, (nextDegrees.get(link.target) ?? 0) + 1);

      let srcList = neighborMap.get(link.source);
      if (!srcList) {
        srcList = [];
        neighborMap.set(link.source, srcList);
      }
      srcList.push(link.target);

      let dstList = neighborMap.get(link.target);
      if (!dstList) {
        dstList = [];
        neighborMap.set(link.target, dstList);
      }
      dstList.push(link.source);
    }
    this.linkKeySet = nextLinkKeySet;
    this.degrees = nextDegrees;

    const pendingNew: ForceGraphNode[] = [];
    let resizedSignificantly = false;
    for (const node of nodes) {
      const size = estimatePillSize(node);
      const existing = this.simNodes.get(node.id);
      if (existing) {
        if (Math.abs(size.width - existing.width) >= 2 || Math.abs(size.height - existing.height) >= 2) {
          resizedSignificantly = true;
        }
        existing.width = size.width;
        existing.height = size.height;
        existing.variant = node.variant;
        existing.pinned = Boolean(node.pinned) || this.manuallyPinned.has(node.id);
      } else {
        pendingNew.push(node);
      }
    }

    // Two passes: seed nodes with existing neighbours first, then remaining nodes.
    let addedCount = 0;
    for (const node of pendingNew) {
      const size = estimatePillSize(node);
      let x = node.x;
      let y = node.y;

      if (x === undefined || y === undefined) {
        const neighbors = neighborMap.get(node.id) ?? [];
        let anchorX = 0;
        let anchorY = 0;
        let anchorCount = 0;
        for (const nId of neighbors) {
          const nState = this.simNodes.get(nId);
          if (nState) {
            anchorX += nState.x;
            anchorY += nState.y;
            anchorCount += 1;
          }
        }
        const angle = hashIdToAngle(node.id);
        if (anchorCount > 0) {
          const radius = this.config.linkGap + size.width * 0.45;
          x = anchorX / anchorCount + Math.cos(angle) * radius;
          y = anchorY / anchorCount + Math.sin(angle) * radius;
        } else {
          this.spawnCounter += 1;
          const ringRadius = INITIAL_RING_STEP * Math.sqrt(this.spawnCounter);
          const ringAngle = this.spawnCounter * GOLDEN_ANGLE_RAD + angle * 0.15;
          x = Math.cos(ringAngle) * ringRadius;
          y = Math.sin(ringAngle) * ringRadius;
        }
      }

      this.simNodes.set(node.id, {
        id: node.id,
        x,
        y,
        vx: 0,
        vy: 0,
        width: size.width,
        height: size.height,
        variant: node.variant,
        pinned: Boolean(node.pinned) || this.manuallyPinned.has(node.id),
      });
      addedCount += 1;
    }

    if (addedCount >= 3 || removedCount >= 3) {
      this.reheat(REHEAT_TOPOLOGY_MAJOR);
    } else if (addedCount > 0 || removedCount > 0 || linksChanged) {
      this.reheat(REHEAT_TOPOLOGY_MINOR);
    } else if (resizedSignificantly) {
      this.reheat(REHEAT_RESIZE);
    }

    if (addedCount >= 3) {
      for (let i = 0; i < WARM_START_TICKS; i += 1) {
        this.step(1);
      }
    }
  }

  /** Advance one physics step including spring attraction, repulsion, gravity, and pill AABB collision. */
  step(dtScale = 1): void {
    const list = [...this.simNodes.values()];
    const count = list.length;
    if (count === 0) return;

    if (this.alpha < ALPHA_MIN) {
      let moving = false;
      for (const node of list) {
        if (!node.pinned && Math.hypot(node.vx, node.vy) > SLEEP_VELOCITY) {
          moving = true;
          break;
        }
      }
      if (!moving) {
        for (const node of list) {
          node.vx = 0;
          node.vy = 0;
        }
        return;
      }
    }

    const clampedDt = Math.max(0.25, Math.min(2.0, dtScale));
    const energy = Math.max(0, this.alpha);
    const { nodePadding, linkGap, repulsion, gravity, damping } = this.config;

    // 1. Centering gravity + clamped pairwise repulsion (scaled by cooling energy & effective hub mass)
    for (let i = 0; i < count; i += 1) {
      const a = list[i]!;
      const massA = 1 + (this.degrees.get(a.id) ?? 0) * HUB_MASS_PER_DEGREE;
      if (!a.pinned) {
        a.vx -= (a.x * gravity * energy * clampedDt) / massA;
        a.vy -= (a.y * gravity * energy * clampedDt) / massA;
      }

      for (let j = i + 1; j < count; j += 1) {
        const b = list[j]!;
        const massB = 1 + (this.degrees.get(b.id) ?? 0) * HUB_MASS_PER_DEGREE;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const distSq = dx * dx + dy * dy;
        let dist = Math.sqrt(distSq);
        if (dist < MIN_DISTANCE) {
          const angle = hashIdToAngle(`${a.id}:${b.id}`);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          dist = MIN_DISTANCE;
        }
        const ux = dx / dist;
        const uy = dy / dist;

        const extentSum = directionalExtent(a.width, a.height, ux, uy) + directionalExtent(b.width, b.height, ux, uy);
        const effDist = Math.max(32, dist - extentSum * 0.45);
        const rawForce = (repulsion / (effDist * effDist)) * energy * clampedDt;
        const force = Math.min(MAX_REPULSION_FORCE * energy * clampedDt, rawForce);
        const fx = ux * force;
        const fy = uy * force;

        if (!a.pinned) {
          a.vx -= fx / massA;
          a.vy -= fy / massA;
        }
        if (!b.pinned) {
          b.vx += fx / massB;
          b.vy += fy / massB;
        }
      }
    }

    // 2. Degree-normalized link springs so high-degree hubs never exceed Euler stability
    for (const link of this.links) {
      const a = this.simNodes.get(link.source);
      const b = this.simNodes.get(link.target);
      if (!a || !b) continue;

      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.hypot(dx, dy);
      if (dist < MIN_DISTANCE) {
        const angle = hashIdToAngle(link.id);
        dx = Math.cos(angle);
        dy = Math.sin(angle);
        dist = MIN_DISTANCE;
      }
      const ux = dx / dist;
      const uy = dy / dist;
      const targetDist =
        directionalExtent(a.width, a.height, ux, uy)
        + directionalExtent(b.width, b.height, ux, uy)
        + linkGap;
      const stretch = dist - targetDist;
      const degA = Math.max(1, this.degrees.get(a.id) ?? 1);
      const degB = Math.max(1, this.degrees.get(b.id) ?? 1);
      const weightMult = Math.min(MAX_LINK_WEIGHT_MULT, 1 + Math.log1p(Math.max(0, link.weight)) * 0.25);
      const stiffness = (BASE_SPRING_STIFFNESS * weightMult * clampedDt * energy) / Math.min(degA, degB);
      const shareA = degB / (degA + degB);
      const shareB = degA / (degA + degB);
      const fx = ux * stretch * stiffness;
      const fy = uy * stretch * stiffness;

      if (!a.pinned) {
        a.vx += fx * shareA;
        a.vy += fy * shareA;
      }
      if (!b.pinned) {
        b.vx -= fx * shareB;
        b.vy -= fy * shareB;
      }
    }

    // 3. Integrate velocity with frame-rate-independent damping & max step displacement clamp
    const prevX = new Float64Array(count);
    const prevY = new Float64Array(count);
    const collided = new Uint8Array(count);
    const damp = Math.pow(damping, clampedDt);
    for (let i = 0; i < count; i += 1) {
      const node = list[i]!;
      prevX[i] = node.x;
      prevY[i] = node.y;
      if (node.pinned) {
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      node.vx *= damp;
      node.vy *= damp;
      const speed = Math.hypot(node.vx, node.vy);
      if (speed > MAX_STEP_DISPLACEMENT) {
        const scale = MAX_STEP_DISPLACEMENT / speed;
        node.vx *= scale;
        node.vy *= scale;
      }
      node.x += node.vx;
      node.y += node.vy;
    }

    // 4. Width/height-aware pill AABB separation passes with normal velocity cancellation & tangential friction
    for (let pass = 0; pass < COLLISION_PASSES; pass += 1) {
      for (let i = 0; i < count; i += 1) {
        const a = list[i]!;
        for (let j = i + 1; j < count; j += 1) {
          const b = list[j]!;
          const minSepX = (a.width + b.width) * 0.5 + nodePadding;
          const minSepY = (a.height + b.height) * 0.5 + nodePadding;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const overlapX = minSepX - Math.abs(dx);
          const overlapY = minSepY - Math.abs(dy);

          if (overlapX > OVERLAP_EPSILON && overlapY > OVERLAP_EPSILON) {
            if (overlapX < overlapY) {
              const sign = dx >= 0 ? 1 : -1;
              const halfPush = Math.min(MAX_COLLISION_PUSH_PER_PASS, overlapX * COLLISION_SPLIT);
              const push = halfPush * sign;
              if (!a.pinned && !b.pinned) {
                a.x -= push;
                b.x += push;
              } else if (!a.pinned) {
                a.x -= push * 2;
              } else if (!b.pinned) {
                b.x += push * 2;
              }
              if (!a.pinned) {
                if (a.vx * sign > 0) a.vx = 0;
                a.vy *= COLLISION_TANGENT_FRICTION;
                collided[i] = 1;
              }
              if (!b.pinned) {
                if (b.vx * sign < 0) b.vx = 0;
                b.vy *= COLLISION_TANGENT_FRICTION;
                collided[j] = 1;
              }
            } else {
              const sign = dy >= 0 ? 1 : -1;
              const halfPush = Math.min(MAX_COLLISION_PUSH_PER_PASS, overlapY * COLLISION_SPLIT);
              const push = halfPush * sign;
              if (!a.pinned && !b.pinned) {
                a.y -= push;
                b.y += push;
              } else if (!a.pinned) {
                a.y -= push * 2;
              } else if (!b.pinned) {
                b.y += push * 2;
              }
              if (!a.pinned) {
                if (a.vy * sign > 0) a.vy = 0;
                a.vx *= COLLISION_TANGENT_FRICTION;
                collided[i] = 1;
              }
              if (!b.pinned) {
                if (b.vy * sign < 0) b.vy = 0;
                b.vx *= COLLISION_TANGENT_FRICTION;
                collided[j] = 1;
              }
            }
          }
        }
      }
    }

    // 5. Post-collision velocity reconciliation to eliminate stacked-wall phantom momentum
    for (let i = 0; i < count; i += 1) {
      if (!collided[i]) continue;
      const node = list[i]!;
      if (node.pinned) continue;
      const actualDx = node.x - prevX[i]!;
      const actualDy = node.y - prevY[i]!;
      if (node.vx * actualDx <= 0) {
        node.vx = 0;
      } else if (Math.abs(node.vx) > Math.abs(actualDx)) {
        node.vx = Math.sign(node.vx) * Math.abs(actualDx);
      }
      if (node.vy * actualDy <= 0) {
        node.vy = 0;
      } else if (Math.abs(node.vy) > Math.abs(actualDy)) {
        node.vy = Math.sign(node.vy) * Math.abs(actualDy);
      }
    }

    this.alpha *= Math.pow(ALPHA_DECAY, clampedDt);
    if (this.alpha < ALPHA_MIN) {
      this.alpha = 0;
      for (const node of list) {
        if (Math.hypot(node.vx, node.vy) <= SLEEP_VELOCITY) {
          node.vx = 0;
          node.vy = 0;
        }
      }
    }
  }

  getNode(id: string): SimNodeState | undefined {
    return this.simNodes.get(id);
  }

  getNodes(): readonly SimNodeState[] {
    return [...this.simNodes.values()];
  }

  pinNode(id: string, x: number, y: number): void {
    const node = this.simNodes.get(id);
    if (!node) return;
    const wasPinned = node.pinned;
    const moved = node.x !== x || node.y !== y;
    this.manuallyPinned.add(id);
    node.pinned = true;
    node.x = x;
    node.y = y;
    node.vx = 0;
    node.vy = 0;
    if (!wasPinned || moved) {
      this.reheat(REHEAT_DRAG);
    }
  }

  unpinNode(id: string): void {
    const wasPinned = this.manuallyPinned.delete(id);
    const node = this.simNodes.get(id);
    if (node) {
      const hadPin = wasPinned || node.pinned;
      node.pinned = false;
      if (hadPin) {
        this.reheat(REHEAT_UNPIN);
      }
    }
  }

  /** Hit-test against each pill's actual width and height in world coordinates. */
  getNodeAt(worldX: number, worldY: number): SimNodeState | null {
    const nodes = [...this.simNodes.values()];
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      const n = nodes[i]!;
      if (
        Math.abs(worldX - n.x) <= n.width * 0.5
        && Math.abs(worldY - n.y) <= n.height * 0.5
      ) {
        return n;
      }
    }
    return null;
  }

  /** Bounding box covering all active nodes for fit-to-view camera framing. */
  getBounds(): { minX: number; maxX: number; minY: number; maxY: number } | null {
    if (this.simNodes.size === 0) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const node of this.simNodes.values()) {
      minX = Math.min(minX, node.x - node.width * 0.5);
      maxX = Math.max(maxX, node.x + node.width * 0.5);
      minY = Math.min(minY, node.y - node.height * 0.5);
      maxY = Math.max(maxY, node.y + node.height * 0.5);
    }
    return { minX, maxX, minY, maxY };
  }
}
