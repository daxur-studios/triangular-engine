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
const DEFAULT_DAMPING = 0.82;
const WARM_START_TICKS = 30;
const COLLISION_PASSES = 2;
const MAX_STEP_DISPLACEMENT = 24;
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

/** Directional half-extent of an axis-aligned pill along unit vector `(ux, uy)`. */
function directionalExtent(width: number, height: number, ux: number, uy: number): number {
  const hw = width * 0.5;
  const hh = height * 0.5;
  return Math.abs(ux) * hw + Math.abs(uy) * hh;
}

/**
 * Deterministic 2D spring-and-pill-collision force layout.
 * Retains existing node coordinates across timeline scrubs and prevents text overlap via AABB projection.
 */
export class ForceGraphSimulation {
  private readonly simNodes = new Map<string, SimNodeState>();
  private links: readonly ForceGraphLink[] = [];
  private readonly manuallyPinned = new Set<string>();
  private config: Required<Pick<ForceGraphConfig, 'nodePadding' | 'linkGap' | 'repulsion' | 'gravity' | 'damping'>>;
  private spawnCounter = 0;

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

  /** Synchronize graph topology while keeping existing node positions intact. */
  syncGraph(nodes: readonly ForceGraphNode[], links: readonly ForceGraphLink[]): void {
    const incomingIds = new Set(nodes.map((n) => n.id));
    for (const existingId of [...this.simNodes.keys()]) {
      if (!incomingIds.has(existingId)) {
        this.simNodes.delete(existingId);
        this.manuallyPinned.delete(existingId);
      }
    }

    this.links = links;
    const neighborMap = new Map<string, string[]>();
    for (const link of links) {
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

    const pendingNew: ForceGraphNode[] = [];
    for (const node of nodes) {
      const size = estimatePillSize(node);
      const existing = this.simNodes.get(node.id);
      if (existing) {
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

    const clampedDt = Math.max(0.25, Math.min(2.0, dtScale));
    const { nodePadding, linkGap, repulsion, gravity, damping } = this.config;

    // 1. Centering gravity + pairwise repulsion
    for (let i = 0; i < count; i += 1) {
      const a = list[i]!;
      if (!a.pinned) {
        a.vx -= a.x * gravity * clampedDt;
        a.vy -= a.y * gravity * clampedDt;
      }

      for (let j = i + 1; j < count; j += 1) {
        const b = list[j]!;
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
        const force = (repulsion / (effDist * effDist)) * clampedDt;
        const fx = ux * force;
        const fy = uy * force;

        if (!a.pinned) {
          a.vx -= fx;
          a.vy -= fy;
        }
        if (!b.pinned) {
          b.vx += fx;
          b.vy += fy;
        }
      }
    }

    // 2. Link springs pulling connected sessions and repositories together
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
      const stiffness = 0.055 * (1 + Math.min(2, link.weight * 0.08)) * clampedDt;
      const fx = ux * stretch * stiffness;
      const fy = uy * stretch * stiffness;

      if (!a.pinned) {
        a.vx += fx;
        a.vy += fy;
      }
      if (!b.pinned) {
        b.vx -= fx;
        b.vy -= fy;
      }
    }

    // 3. Integrate velocity with damping & max step displacement clamp
    for (const node of list) {
      if (node.pinned) {
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      node.vx *= damping;
      node.vy *= damping;
      const speed = Math.hypot(node.vx, node.vy);
      if (speed > MAX_STEP_DISPLACEMENT) {
        const scale = MAX_STEP_DISPLACEMENT / speed;
        node.vx *= scale;
        node.vy *= scale;
      }
      node.x += node.vx;
      node.y += node.vy;
    }

    // 4. Width/height-aware pill AABB separation passes so text labels never collide
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

          if (overlapX > 0 && overlapY > 0) {
            if (overlapX < overlapY) {
              const sign = dx >= 0 ? 1 : -1;
              const push = overlapX * 0.52 * sign;
              if (!a.pinned && !b.pinned) {
                a.x -= push;
                b.x += push;
              } else if (!a.pinned) {
                a.x -= push * 2;
              } else if (!b.pinned) {
                b.x += push * 2;
              }
            } else {
              const sign = dy >= 0 ? 1 : -1;
              const push = overlapY * 0.52 * sign;
              if (!a.pinned && !b.pinned) {
                a.y -= push;
                b.y += push;
              } else if (!a.pinned) {
                a.y -= push * 2;
              } else if (!b.pinned) {
                b.y += push * 2;
              }
            }
          }
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
    this.manuallyPinned.add(id);
    node.pinned = true;
    node.x = x;
    node.y = y;
    node.vx = 0;
    node.vy = 0;
  }

  unpinNode(id: string): void {
    this.manuallyPinned.delete(id);
    const node = this.simNodes.get(id);
    if (node) {
      node.pinned = false;
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
