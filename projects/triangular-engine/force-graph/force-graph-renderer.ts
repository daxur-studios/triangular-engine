import * as THREE from 'three';
import { ForceGraphSimulation } from './force-graph-simulation';
import type {
  ForceGraphConfig,
  ForceGraphLink,
  ForceGraphNode,
  ForceGraphPulse,
} from './force-graph.types';

const DEFAULT_BG = '#0e141d';
const DEFAULT_GRID = '#192332';
const GRID_SPACING = 64;
const GRID_EXTENT = 3200;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.8;
const ZOOM_WHEEL_STEP = 0.0011;
const DRAG_THRESHOLD_PX = 5;
const CURVE_SEGMENTS = 18;
const DEFAULT_TRAVEL_DURATION_MS = 900;
const DEFAULT_RING_DURATION_MS = 650;
const MAX_ACTIVE_PULSES = 140;
const TEXTURE_DPR = 2;

interface ActivePulse {
  readonly pulse: ForceGraphPulse;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly sprite: THREE.Sprite | null;
  readonly trailSprite: THREE.Sprite | null;
  readonly ringLine: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial> | null;
}

interface NodeVisualRecord {
  node: ForceGraphNode;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  signature: string;
}

interface LinkVisualRecord {
  link: ForceGraphLink;
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  curvature: number;
}

function linkCurvature(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  const bucket = (h % 5) - 2;
  return bucket * 11;
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function createGlowTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.28, 'rgba(255, 255, 255, 0.85)');
  grad.addColorStop(0.6, 'rgba(255, 255, 255, 0.25)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 3 && ctx.measureText(`${text.slice(0, end)}…`).width > maxWidth) {
    end -= 1;
  }
  return `${text.slice(0, end).trimEnd()}…`;
}

function drawNodeTexture(
  node: ForceGraphNode,
  width: number,
  height: number,
  selected: boolean,
  hovered: boolean,
  dimmed: boolean,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(width * TEXTURE_DPR));
  canvas.height = Math.max(2, Math.round(height * TEXTURE_DPR));
  const ctx = canvas.getContext('2d')!;
  ctx.scale(TEXTURE_DPR, TEXTURE_DPR);

  const lingering = node.state === 'lingering';
  const alpha = dimmed ? 0.24 : lingering ? 0.5 : 1;
  ctx.globalAlpha = alpha;

  const pad = 3;
  const cardW = width - pad * 2;
  const cardH = height - pad * 2;

  if (node.variant === 'point') {
    const cx = width * 0.5;
    const cy = height * 0.5;
    const r = Math.min(cardW, cardH) * 0.42;
    ctx.fillStyle = node.accentColor;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    if (selected || hovered) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }

  if (node.variant === 'repo') {
    const radius = 10;
    roundedRectPath(ctx, pad, pad, cardW, cardH, radius);
    ctx.fillStyle = selected ? '#1e2b3d' : '#161f2c';
    ctx.fill();

    ctx.lineWidth = selected || hovered ? 2 : 1.3;
    ctx.strokeStyle = selected
      ? '#6ec1ff'
      : hovered
        ? '#8cb4d8'
        : lingering
          ? '#2a3749'
          : '#3d4f66';
    ctx.stroke();

    // Subtle left git-branch glyph
    const iconX = pad + 16;
    const iconY = height * 0.5;
    ctx.strokeStyle = node.accentColor || '#8ab4e8';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(iconX, iconY - 6, 2.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(iconX, iconY + 6, 2.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(iconX, iconY - 3.5);
    ctx.lineTo(iconX, iconY + 3.5);
    ctx.stroke();

    // Metric pill on right
    let metricReserve = 12;
    if (node.metric) {
      ctx.font = '600 11px system-ui, -apple-system, sans-serif';
      const mw = Math.max(24, ctx.measureText(node.metric).width + 12);
      const mh = 20;
      const mx = width - pad - mw - 10;
      const my = (height - mh) * 0.5;
      roundedRectPath(ctx, mx, my, mw, mh, 6);
      ctx.fillStyle = '#233144';
      ctx.fill();
      ctx.fillStyle = '#cdd9e8';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(node.metric, mx + mw * 0.5, my + mh * 0.5 + 0.5);
      metricReserve = mw + 20;
    }

    // Repo label
    ctx.font = '600 13.5px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#edf3fb';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const textX = pad + 30;
    const maxTextW = Math.max(40, width - textX - metricReserve);
    ctx.fillText(truncateText(ctx, node.label, maxTextW), textX, height * 0.5 + 0.5);
  } else {
    // Session / generic rounded pill
    const radius = cardH * 0.5;
    roundedRectPath(ctx, pad, pad, cardW, cardH, radius);
    ctx.fillStyle = selected ? '#1b2636' : '#121923';
    ctx.fill();

    ctx.lineWidth = selected || hovered ? 2.2 : 1.6;
    ctx.strokeStyle = selected
      ? '#ffffff'
      : lingering
        ? '#394657'
        : node.accentColor;
    ctx.stroke();

    // Provider dot
    const dotX = pad + 15;
    const dotY = node.subtitle ? height * 0.38 : height * 0.5;
    ctx.fillStyle = lingering ? '#6c7c92' : node.accentColor;
    ctx.beginPath();
    ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
    ctx.fill();

    // Title
    ctx.font = '600 12.5px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = lingering ? '#b2c0d2' : '#eef4fc';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const textX = dotX + 10;
    const maxTextW = Math.max(40, width - textX - pad - 14);
    ctx.fillText(truncateText(ctx, node.label, maxTextW), textX, dotY + 0.5);

    if (node.subtitle) {
      ctx.font = '500 11px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = lingering ? '#8091a7' : '#9fb3c9';
      ctx.fillText(truncateText(ctx, node.subtitle, maxTextW), textX, height * 0.69);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/**
 * Three.js orthographic 2D/2.5D force-graph renderer supporting text-pill nodes,
 * curved links, glowing directional edge pulses, pan/zoom, and node dragging.
 */
export class ForceGraphRenderer {
  private readonly simulation: ForceGraphSimulation;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-400, 400, 300, -300, -100, 100);
  private readonly nodeVisuals = new Map<string, NodeVisualRecord>();
  private readonly linkVisuals = new Map<string, LinkVisualRecord>();
  private readonly activePulses: ActivePulse[] = [];
  private readonly seenPulseIds = new Set<string>();
  private readonly nodeGeom = new THREE.PlaneGeometry(1, 1);
  private readonly glowTexture = createGlowTexture();

  private renderer: THREE.WebGLRenderer | null = null;
  private gridLines: THREE.LineSegments | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private rafId: number | null = null;
  private disposed = false;

  private viewportW = 800;
  private viewportH = 600;
  private panX = 0;
  private panY = 0;
  private zoom = 1;

  private selectedNodeId: string | null = null;
  private hoveredNodeId: string | null = null;
  private config: ForceGraphConfig = {};

  private draggingNodeId: string | null = null;
  private panning = false;
  private pointerDownClientX = 0;
  private pointerDownClientY = 0;
  private lastClientX = 0;
  private lastClientY = 0;
  private movedBeyondClick = false;
  private hasAutoFitted = false;

  onNodeSelected?: (nodeId: string | null) => void;
  onNodeHovered?: (nodeId: string | null) => void;

  private readonly handlePointerDown = (ev: PointerEvent) => this.onPointerDown(ev);
  private readonly handlePointerMove = (ev: PointerEvent) => this.onPointerMove(ev);
  private readonly handlePointerUp = (ev: PointerEvent) => this.onPointerUp(ev);
  private readonly handleWheel = (ev: WheelEvent) => this.onWheel(ev);

  constructor(private readonly canvas: HTMLCanvasElement, config: ForceGraphConfig = {}) {
    this.config = config;
    this.simulation = new ForceGraphSimulation(config);
  }

  /** Initialize WebGL context, background grid, listeners, and render loop. Returns false if WebGL is unavailable. */
  init(): boolean {
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      });
    } catch {
      return false;
    }

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, TEXTURE_DPR));
    this.renderer.setClearColor(new THREE.Color(this.config.backgroundColor ?? DEFAULT_BG), 1);

    this.buildGrid();
    this.resize();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);

    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });

    let lastTickMs = performance.now();
    const tick = (now: number) => {
      if (this.disposed) return;
      const dtScale = Math.max(0.25, Math.min(1.5, (now - lastTickMs) / 16.667));
      lastTickMs = now;
      this.simulation.step(dtScale);
      this.syncTransforms();
      this.updatePulses(now);
      this.renderer?.render(this.scene, this.camera);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
    return true;
  }

  updateConfig(config: ForceGraphConfig): void {
    this.config = config;
    this.simulation.updateConfig(config);
    if (this.renderer) {
      this.renderer.setClearColor(new THREE.Color(config.backgroundColor ?? DEFAULT_BG), 1);
    }
    if (this.gridLines) {
      this.gridLines.visible = config.showGrid !== false;
    }
  }

  setGraph(
    nodes: readonly ForceGraphNode[],
    links: readonly ForceGraphLink[],
    selectedNodeId: string | null,
  ): void {
    this.selectedNodeId = selectedNodeId;
    this.simulation.syncGraph(nodes, links);

    const linkedToSelected = new Set<string>();
    if (selectedNodeId) {
      linkedToSelected.add(selectedNodeId);
      for (const link of links) {
        if (link.source === selectedNodeId) linkedToSelected.add(link.target);
        if (link.target === selectedNodeId) linkedToSelected.add(link.source);
      }
    }

    const nextNodeIds = new Set(nodes.map((n) => n.id));
    for (const [id, rec] of this.nodeVisuals.entries()) {
      if (!nextNodeIds.has(id)) {
        this.scene.remove(rec.mesh);
        rec.mesh.material.map?.dispose();
        rec.mesh.material.dispose();
        this.nodeVisuals.delete(id);
      }
    }

    for (const node of nodes) {
      const simNode = this.simulation.getNode(node.id);
      if (!simNode) continue;
      const isSelected = selectedNodeId === node.id;
      const isHovered = this.hoveredNodeId === node.id;
      const dimmed = Boolean(selectedNodeId && !linkedToSelected.has(node.id));
      const signature = [
        node.label,
        node.subtitle ?? '',
        node.badge ?? '',
        node.metric ?? '',
        node.variant,
        node.state,
        node.accentColor,
        simNode.width,
        simNode.height,
        isSelected ? 'S' : '',
        isHovered ? 'H' : '',
        dimmed ? 'D' : '',
      ].join('|');

      let rec = this.nodeVisuals.get(node.id);
      if (!rec) {
        const tex = drawNodeTexture(node, simNode.width, simNode.height, isSelected, isHovered, dimmed);
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
        const mesh = new THREE.Mesh(this.nodeGeom, mat);
        mesh.scale.set(simNode.width, simNode.height, 1);
        mesh.position.set(simNode.x, simNode.y, node.variant === 'repo' ? 2 : 3);
        this.scene.add(mesh);
        rec = { node, mesh, signature };
        this.nodeVisuals.set(node.id, rec);
      } else {
        rec.node = node;
        if (rec.signature !== signature) {
          const oldMap = rec.mesh.material.map;
          rec.mesh.material.map = drawNodeTexture(node, simNode.width, simNode.height, isSelected, isHovered, dimmed);
          rec.mesh.material.needsUpdate = true;
          oldMap?.dispose();
          rec.mesh.scale.set(simNode.width, simNode.height, 1);
          rec.signature = signature;
        }
      }
    }

    const nextLinkIds = new Set(links.map((l) => l.id));
    for (const [id, rec] of this.linkVisuals.entries()) {
      if (!nextLinkIds.has(id)) {
        this.scene.remove(rec.line);
        rec.line.geometry.dispose();
        rec.line.material.dispose();
        this.linkVisuals.delete(id);
      }
    }

    for (const link of links) {
      const touchesSelected = selectedNodeId
        ? link.source === selectedNodeId || link.target === selectedNodeId
        : false;
      const dimmed = Boolean(selectedNodeId && !touchesSelected);
      const reads = link.readCount ?? 0;
      const writes = link.writeCount ?? 0;
      const baseColor = link.accentColor
        ?? (writes > 0 && writes >= reads ? '#43c586' : reads > 0 ? '#4ca8df' : '#4a5c73');
      const opacity = dimmed
        ? 0.08
        : touchesSelected
          ? 0.9
          : link.state === 'lingering'
            ? 0.2
            : Math.min(0.72, 0.34 + link.weight * 0.04);

      let rec = this.linkVisuals.get(link.id);
      if (!rec) {
        const positions = new Float32Array((CURVE_SEGMENTS + 1) * 3);
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const mat = new THREE.LineBasicMaterial({
          color: new THREE.Color(baseColor),
          transparent: true,
          opacity,
          depthWrite: false,
        });
        const line = new THREE.Line(geom, mat);
        line.position.z = 0;
        this.scene.add(line);
        rec = { link, line, curvature: linkCurvature(link.id) };
        this.linkVisuals.set(link.id, rec);
      } else {
        rec.link = link;
        rec.line.material.color.set(baseColor);
        rec.line.material.opacity = opacity;
      }
    }

    if (!this.hasAutoFitted && nodes.length > 0) {
      this.hasAutoFitted = true;
      this.fitToView(72);
    }
    this.syncTransforms();
  }

  enqueuePulses(pulses: readonly ForceGraphPulse[]): void {
    const now = performance.now();
    for (const pulse of pulses) {
      if (this.seenPulseIds.has(pulse.id)) continue;
      this.seenPulseIds.add(pulse.id);
      if (this.seenPulseIds.size > 4000) {
        const first = this.seenPulseIds.values().next().value;
        if (first) this.seenPulseIds.delete(first);
      }
      if (this.activePulses.length >= MAX_ACTIVE_PULSES) {
        const dropped = this.activePulses.shift();
        if (dropped) this.disposePulseVisual(dropped);
      }

      if (pulse.kind === 'ring') {
        const segments = 28;
        const arr = new Float32Array(segments * 3);
        for (let i = 0; i < segments; i += 1) {
          const theta = (i / segments) * Math.PI * 2;
          arr[i * 3] = Math.cos(theta);
          arr[i * 3 + 1] = Math.sin(theta);
          arr[i * 3 + 2] = 0;
        }
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        const mat = new THREE.LineBasicMaterial({
          color: new THREE.Color(pulse.color),
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
        });
        const ringLine = new THREE.LineLoop(geom, mat);
        ringLine.position.z = 4;
        this.scene.add(ringLine);
        this.activePulses.push({
          pulse,
          startedAt: now,
          durationMs: pulse.durationMs ?? DEFAULT_RING_DURATION_MS,
          sprite: null,
          trailSprite: null,
          ringLine,
        });
      } else {
        const baseSize = (pulse.size ?? 1) * 16;
        const mat = new THREE.SpriteMaterial({
          map: this.glowTexture,
          color: new THREE.Color(pulse.color),
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(baseSize, baseSize, 1);
        sprite.position.z = 5;
        this.scene.add(sprite);

        const trailMat = new THREE.SpriteMaterial({
          map: this.glowTexture,
          color: new THREE.Color(pulse.color),
          transparent: true,
          opacity: 0.45,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const trailSprite = new THREE.Sprite(trailMat);
        trailSprite.scale.set(baseSize * 0.65, baseSize * 0.65, 1);
        trailSprite.position.z = 4.5;
        this.scene.add(trailSprite);

        this.activePulses.push({
          pulse,
          startedAt: now,
          durationMs: pulse.durationMs ?? DEFAULT_TRAVEL_DURATION_MS,
          sprite,
          trailSprite,
          ringLine: null,
        });
      }
    }
  }

  fitToView(padding = 64): void {
    const bounds = this.simulation.getBounds();
    if (!bounds) {
      this.panX = 0;
      this.panY = 0;
      this.zoom = 1;
      this.updateCamera();
      return;
    }
    const spanW = Math.max(120, bounds.maxX - bounds.minX + padding * 2);
    const spanH = Math.max(120, bounds.maxY - bounds.minY + padding * 2);
    const scaleX = this.viewportW / spanW;
    const scaleY = this.viewportH / spanH;
    this.zoom = Math.max(MIN_ZOOM, Math.min(1.25, Math.min(scaleX, scaleY)));
    this.panX = (bounds.minX + bounds.maxX) * 0.5;
    this.panY = (bounds.minY + bounds.maxY) * 0.5;
    this.updateCamera();
  }

  dispose(): void {
    this.disposed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.resizeObserver?.disconnect();
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('wheel', this.handleWheel);

    for (const rec of this.nodeVisuals.values()) {
      this.scene.remove(rec.mesh);
      rec.mesh.material.map?.dispose();
      rec.mesh.material.dispose();
    }
    this.nodeVisuals.clear();

    for (const rec of this.linkVisuals.values()) {
      this.scene.remove(rec.line);
      rec.line.geometry.dispose();
      rec.line.material.dispose();
    }
    this.linkVisuals.clear();

    for (const ap of this.activePulses) {
      this.disposePulseVisual(ap);
    }
    this.activePulses.length = 0;

    if (this.gridLines) {
      this.gridLines.geometry.dispose();
      (this.gridLines.material as THREE.Material).dispose();
    }
    this.nodeGeom.dispose();
    this.glowTexture.dispose();
    this.renderer?.dispose();
    this.renderer = null;
  }

  private buildGrid(): void {
    const verts: number[] = [];
    for (let x = -GRID_EXTENT; x <= GRID_EXTENT; x += GRID_SPACING) {
      verts.push(x, -GRID_EXTENT, -10, x, GRID_EXTENT, -10);
    }
    for (let y = -GRID_EXTENT; y <= GRID_EXTENT; y += GRID_SPACING) {
      verts.push(-GRID_EXTENT, y, -10, GRID_EXTENT, y, -10);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(this.config.gridColor ?? DEFAULT_GRID),
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    this.gridLines = new THREE.LineSegments(geom, mat);
    this.gridLines.visible = this.config.showGrid !== false;
    this.scene.add(this.gridLines);
  }

  private resize(): void {
    if (!this.renderer) return;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(100, Math.round(rect.width));
    const h = Math.max(100, Math.round(rect.height));
    this.viewportW = w;
    this.viewportH = h;
    this.renderer.setSize(w, h, false);
    this.updateCamera();
  }

  private updateCamera(): void {
    const halfW = (this.viewportW * 0.5) / this.zoom;
    const halfH = (this.viewportH * 0.5) / this.zoom;
    this.camera.left = this.panX - halfW;
    this.camera.right = this.panX + halfW;
    this.camera.top = this.panY + halfH;
    this.camera.bottom = this.panY - halfH;
    this.camera.updateProjectionMatrix();
  }

  private screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const nx = (clientX - rect.left) / Math.max(1, rect.width) - 0.5;
    const ny = 0.5 - (clientY - rect.top) / Math.max(1, rect.height);
    return {
      x: this.panX + (nx * this.viewportW) / this.zoom,
      y: this.panY + (ny * this.viewportH) / this.zoom,
    };
  }

  private computeCurvePoint(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    curvature: number,
    t: number,
  ): { x: number; y: number } {
    const dx = bx - ax;
    const dy = by - ay;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const cx = (ax + bx) * 0.5 + (-dy / dist) * curvature;
    const cy = (ay + by) * 0.5 + (dx / dist) * curvature;
    const inv = 1 - t;
    return {
      x: inv * inv * ax + 2 * inv * t * cx + t * t * bx,
      y: inv * inv * ay + 2 * inv * t * cy + t * t * by,
    };
  }

  private syncTransforms(): void {
    for (const [id, rec] of this.nodeVisuals.entries()) {
      const sim = this.simulation.getNode(id);
      if (!sim) continue;
      rec.mesh.position.x = sim.x;
      rec.mesh.position.y = sim.y;
    }

    for (const rec of this.linkVisuals.values()) {
      const src = this.simulation.getNode(rec.link.source);
      const dst = this.simulation.getNode(rec.link.target);
      if (!src || !dst) continue;
      const attr = rec.line.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i <= CURVE_SEGMENTS; i += 1) {
        const pt = this.computeCurvePoint(src.x, src.y, dst.x, dst.y, rec.curvature, i / CURVE_SEGMENTS);
        attr.setXYZ(i, pt.x, pt.y, 0);
      }
      attr.needsUpdate = true;
    }
  }

  private updatePulses(now: number): void {
    for (let i = this.activePulses.length - 1; i >= 0; i -= 1) {
      const ap = this.activePulses[i]!;
      const elapsed = now - ap.startedAt;
      const progress = elapsed / ap.durationMs;
      if (progress >= 1) {
        this.disposePulseVisual(ap);
        this.activePulses.splice(i, 1);
        continue;
      }

      const src = this.simulation.getNode(ap.pulse.source);
      if (!src) continue;

      if (ap.ringLine) {
        const radius = src.height * 0.5 + progress * 26;
        ap.ringLine.position.set(src.x, src.y, 4);
        ap.ringLine.scale.set(radius, radius * 0.72, 1);
        (ap.ringLine.material as THREE.LineBasicMaterial).opacity = (1 - progress) * 0.75;
      } else if (ap.sprite && ap.trailSprite) {
        const dst = this.simulation.getNode(ap.pulse.target);
        if (!dst) continue;
        const linkIdA = `${ap.pulse.source}->${ap.pulse.target}`;
        const linkIdB = `${ap.pulse.target}->${ap.pulse.source}`;
        const rec = this.linkVisuals.get(linkIdA) ?? this.linkVisuals.get(linkIdB);
        const rawCurvature = rec?.curvature ?? 0;
        const curvature = rec && rec.link.source === ap.pulse.target ? -rawCurvature : rawCurvature;
        const pt = this.computeCurvePoint(src.x, src.y, dst.x, dst.y, curvature, progress);
        const trailPt = this.computeCurvePoint(src.x, src.y, dst.x, dst.y, curvature, Math.max(0, progress - 0.08));
        ap.sprite.position.set(pt.x, pt.y, 5);
        ap.trailSprite.position.set(trailPt.x, trailPt.y, 4.5);
        const fade = progress > 0.8 ? (1 - progress) / 0.2 : 1;
        (ap.sprite.material as THREE.SpriteMaterial).opacity = fade * 0.95;
        (ap.trailSprite.material as THREE.SpriteMaterial).opacity = fade * 0.45;
      }
    }
  }

  private disposePulseVisual(ap: ActivePulse): void {
    if (ap.sprite) {
      this.scene.remove(ap.sprite);
      ap.sprite.material.dispose();
    }
    if (ap.trailSprite) {
      this.scene.remove(ap.trailSprite);
      ap.trailSprite.material.dispose();
    }
    if (ap.ringLine) {
      this.scene.remove(ap.ringLine);
      ap.ringLine.geometry.dispose();
      ap.ringLine.material.dispose();
    }
  }

  private refreshHoveredTexture(prevId: string | null, nextId: string | null): void {
    for (const id of [prevId, nextId]) {
      if (!id) continue;
      const rec = this.nodeVisuals.get(id);
      const sim = this.simulation.getNode(id);
      if (!rec || !sim) continue;
      const isSelected = this.selectedNodeId === id;
      const isHovered = this.hoveredNodeId === id;
      const oldMap = rec.mesh.material.map;
      rec.mesh.material.map = drawNodeTexture(rec.node, sim.width, sim.height, isSelected, isHovered, false);
      rec.mesh.material.needsUpdate = true;
      oldMap?.dispose();
    }
  }

  private onPointerDown(ev: PointerEvent): void {
    if (ev.button !== 0) return;
    this.pointerDownClientX = ev.clientX;
    this.pointerDownClientY = ev.clientY;
    this.lastClientX = ev.clientX;
    this.lastClientY = ev.clientY;
    this.movedBeyondClick = false;

    const world = this.screenToWorld(ev.clientX, ev.clientY);
    const hit = this.simulation.getNodeAt(world.x, world.y);
    if (hit) {
      this.draggingNodeId = hit.id;
      this.simulation.pinNode(hit.id, hit.x, hit.y);
      this.canvas.style.cursor = 'grabbing';
    } else {
      this.panning = true;
      this.canvas.style.cursor = 'grabbing';
    }
  }

  private onPointerMove(ev: PointerEvent): void {
    if (this.draggingNodeId) {
      if (Math.hypot(ev.clientX - this.pointerDownClientX, ev.clientY - this.pointerDownClientY) > DRAG_THRESHOLD_PX) {
        this.movedBeyondClick = true;
      }
      const world = this.screenToWorld(ev.clientX, ev.clientY);
      this.simulation.pinNode(this.draggingNodeId, world.x, world.y);
      return;
    }

    if (this.panning) {
      const dx = ev.clientX - this.lastClientX;
      const dy = ev.clientY - this.lastClientY;
      if (Math.hypot(ev.clientX - this.pointerDownClientX, ev.clientY - this.pointerDownClientY) > DRAG_THRESHOLD_PX) {
        this.movedBeyondClick = true;
      }
      this.panX -= dx / this.zoom;
      this.panY += dy / this.zoom;
      this.lastClientX = ev.clientX;
      this.lastClientY = ev.clientY;
      this.updateCamera();
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const inside = ev.clientX >= rect.left && ev.clientX <= rect.right && ev.clientY >= rect.top && ev.clientY <= rect.bottom;
    if (!inside) return;

    const world = this.screenToWorld(ev.clientX, ev.clientY);
    const hit = this.simulation.getNodeAt(world.x, world.y);
    const nextHover = hit?.id ?? null;
    if (nextHover !== this.hoveredNodeId) {
      const prevHover = this.hoveredNodeId;
      this.hoveredNodeId = nextHover;
      this.canvas.style.cursor = nextHover ? 'pointer' : 'grab';
      this.refreshHoveredTexture(prevHover, nextHover);
      this.onNodeHovered?.(nextHover);
    }
  }

  private onPointerUp(ev: PointerEvent): void {
    if (this.draggingNodeId) {
      const id = this.draggingNodeId;
      this.draggingNodeId = null;
      this.simulation.unpinNode(id);
      this.canvas.style.cursor = this.hoveredNodeId ? 'pointer' : 'grab';
      if (!this.movedBeyondClick) {
        this.onNodeSelected?.(this.selectedNodeId === id ? null : id);
      }
      return;
    }
    if (this.panning) {
      this.panning = false;
      this.canvas.style.cursor = this.hoveredNodeId ? 'pointer' : 'grab';
      if (!this.movedBeyondClick && ev.target === this.canvas) {
        this.onNodeSelected?.(null);
      }
    }
  }

  private onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    const before = this.screenToWorld(ev.clientX, ev.clientY);
    const factor = Math.exp(-ev.deltaY * ZOOM_WHEEL_STEP);
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
    if (nextZoom === this.zoom) return;
    this.zoom = nextZoom;
    this.updateCamera();
    const after = this.screenToWorld(ev.clientX, ev.clientY);
    this.panX += before.x - after.x;
    this.panY += before.y - after.y;
    this.updateCamera();
  }
}
