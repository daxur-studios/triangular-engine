import { ArrowHelper, Color, PerspectiveCamera, Vector3, type Camera, type Material, type Object3D, type Vector3Tuple } from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { computeDemoCameraView, type DemoCameraMode, type IDemoCameraView } from './demo-camera';
import { DemoOverlay } from './demo-overlay';
import { DemoTrail, speedColor } from './demo-trail';

/** What the host reports about the thing being filmed, every frame. All positions are world metres. */
export interface IDemoSubject {
  readonly positionM: Vector3Tuple;
  readonly velocityMps: Vector3Tuple;
  readonly timeS: number;
  readonly label: string;
  /** Rough size, for the focus box. */
  readonly sizeM: number;
  /** Named direction vectors (world frame). Only the direction is drawn; length is a fixed share of the view. */
  readonly vectors?: Readonly<Record<string, Vector3Tuple | undefined>>;
  /** Shown in the telemetry strip, in order. */
  readonly telemetry?: Readonly<Record<string, string | number>>;
}

export interface IDemoKitHost {
  /** Object the helper geometry is added to (the render-frame scene). */
  readonly scene: Object3D;
  readonly camera: () => Camera;
  readonly canvas: () => HTMLElement;
  readonly subject: () => IDemoSubject | undefined;
  /** Converts a world point to the scene's local frame (floating origin). Identity when omitted. */
  readonly toLocal?: (worldM: Vector3Tuple) => Vector3;
  /** Moves the camera. Without it, the camera director only reports the view. */
  readonly applyCameraView?: (view: IDemoCameraView) => void;
  /** Where the pad or target is; the default spot of a `static` camera. */
  readonly targetM?: () => Vector3Tuple | undefined;
  /** Up direction at the subject (surface normal). Defaults to +Y. */
  readonly up?: () => Vector3Tuple;
}

export interface IDemoKitState {
  readonly camera: DemoCameraMode;
  readonly trail: boolean;
  readonly vectors: readonly string[];
  readonly focusBox: boolean;
  readonly telemetry: boolean;
  /** Metres of scene the camera frames around the subject (sets the field of view). 0 leaves the field of view alone. */
  readonly framingM: number;
}

export type IDemoKitPatch = Partial<IDemoKitState> & { staticPositionM?: Vector3Tuple; clearTrail?: boolean };

const VECTOR_COLORS: Readonly<Record<string, string>> = { velocity: '#ffd400', thrust: '#ff6a00', lift: '#00e5ff', target: '#39ff14', gravity: '#b388ff' };
const VECTOR_LENGTH_SHARE = 0.07;
const TRAIL_WIDTH_PX = 3;
const TRAIL_MAX_SPEED_MPS = 800;
const TRAIL_REBUILD_EVERY_FRAMES = 6;

/**
 * One switchboard that makes a recorded video show motion and steering. The host reports the subject each frame;
 * a recipe flips features with `kit.set({...})` or, in a page, `window.demoKit.set({...})`.
 */
export class DemoKit {
  readonly #host: IDemoKitHost;
  readonly #trail = new DemoTrail();
  readonly #arrows = new Map<string, ArrowHelper>();
  #overlay: DemoOverlay | undefined;
  #line: Line2 | undefined;
  #state: IDemoKitState = { camera: 'free', trail: false, vectors: [], focusBox: false, telemetry: false, framingM: 0 };
  #staticPositionM: Vector3Tuple | undefined;
  #frame = 0;

  constructor(host: IDemoKitHost) { this.#host = host; }

  get state(): IDemoKitState { return this.#state; }
  get trail(): DemoTrail { return this.#trail; }

  /** Merges a partial state. `static` pins the camera at `staticPositionM`, else at the host's target. */
  set(patch: IDemoKitPatch): IDemoKitState {
    const { staticPositionM, clearTrail, ...rest } = patch;
    this.#state = { ...this.#state, ...rest };
    if (staticPositionM) this.#staticPositionM = staticPositionM;
    if (clearTrail) this.#trail.clear();
    return this.#state;
  }

  /** Call once per frame, after the subject's pose is settled (engine `beforeRender$`). */
  update(): void {
    const subject = this.#host.subject();
    if (!subject) return;
    const speed = Math.hypot(...subject.velocityMps);
    if (this.#state.trail) this.#trail.record(subject.positionM, speed, subject.timeS);

    const view = computeDemoCameraView({
      mode: this.#state.camera, subjectM: subject.positionM, velocityMps: subject.velocityMps, up: this.#host.up?.() ?? [0, 1, 0],
      staticPositionM: this.#staticPositionM ?? this.#host.targetM?.(),
    }, this.#state.framingM || undefined);
    const camera = this.#host.camera();
    if (view) {
      this.#host.applyCameraView?.(view);
      if (view.fovDeg && camera instanceof PerspectiveCamera && Math.abs(camera.fov - view.fovDeg) > 1e-3) {
        camera.fov = view.fovDeg;
        camera.updateProjectionMatrix();
      }
    }

    const toLocal = this.#host.toLocal ?? ((m: Vector3Tuple) => new Vector3(...m));
    this.#syncTrail(toLocal);
    this.#syncArrows(subject, toLocal, camera);
    this.#syncOverlay(subject, toLocal, camera);
    this.#frame++;
  }

  dispose(): void {
    this.#overlay?.dispose();
    this.#line?.removeFromParent();
    for (const arrow of this.#arrows.values()) arrow.removeFromParent();
    this.#arrows.clear();
  }

  #syncTrail(toLocal: (m: Vector3Tuple) => Vector3): void {
    const points = this.#trail.points;
    if (!this.#state.trail || points.length < 2) { if (this.#line) this.#line.visible = false; return; }
    if (this.#line && this.#frame % TRAIL_REBUILD_EVERY_FRAMES !== 0) { this.#line.visible = true; return; }
    const positions: number[] = [];
    const colors: number[] = [];
    for (const p of points) {
      const local = toLocal(p.positionM);
      positions.push(local.x, local.y, local.z);
      colors.push(...speedColor(p.speedMps, TRAIL_MAX_SPEED_MPS));
    }
    this.#line?.removeFromParent();
    this.#line?.geometry.dispose();
    const geometry = new LineGeometry();
    geometry.setPositions(positions);
    geometry.setColors(colors);
    const canvas = this.#host.canvas();
    const material = new LineMaterial({ linewidth: TRAIL_WIDTH_PX, vertexColors: true, depthTest: false, transparent: true });
    material.resolution.set(canvas.clientWidth || 1280, canvas.clientHeight || 720);
    this.#line = new Line2(geometry, material);
    this.#line.renderOrder = 999;
    this.#line.frustumCulled = false;
    this.#host.scene.add(this.#line);
  }

  #syncArrows(subject: IDemoSubject, toLocal: (m: Vector3Tuple) => Vector3, camera: Camera): void {
    const origin = toLocal(subject.positionM);
    const length = Math.max(1, origin.distanceTo(camera.position)) * VECTOR_LENGTH_SHARE;
    for (const [name, arrow] of this.#arrows) arrow.visible = this.#state.vectors.includes(name) && !!subject.vectors?.[name];
    for (const name of this.#state.vectors) {
      const dir = subject.vectors?.[name];
      if (!dir || Math.hypot(...dir) < 1e-6) continue;
      let arrow = this.#arrows.get(name);
      if (!arrow) {
        arrow = new ArrowHelper(new Vector3(0, 1, 0), new Vector3(), 1, new Color(VECTOR_COLORS[name] ?? '#ffffff'), 0.25, 0.15);
        arrow.renderOrder = 1000;
        (arrow.line.material as Material).depthTest = false;
        (arrow.cone.material as Material).depthTest = false;
        arrow.line.frustumCulled = false;
        arrow.cone.frustumCulled = false;
        this.#arrows.set(name, arrow);
        this.#host.scene.add(arrow);
      }
      arrow.visible = true;
      arrow.position.copy(origin);
      arrow.setDirection(new Vector3(...dir).normalize());
      arrow.setLength(length, length * 0.25, length * 0.15);
    }
  }

  #syncOverlay(subject: IDemoSubject, toLocal: (m: Vector3Tuple) => Vector3, camera: Camera): void {
    if (!this.#state.focusBox && !this.#state.telemetry && !this.#overlay) return;
    this.#overlay ??= new DemoOverlay({ anchor: this.#host.canvas() });
    this.#overlay.update({
      camera, subjectLocal: toLocal(subject.positionM), subjectSizeM: subject.sizeM, label: subject.label,
      telemetry: subject.telemetry ?? {}, focusBox: this.#state.focusBox, telemetryStrip: this.#state.telemetry,
    });
  }
}

/** The agent-facing page API. Recipes call `window.demoKit.set({ camera: 'static', trail: true, vectors: ['velocity', 'lift'], focusBox: true })`. */
export interface IDemoKitPageApi {
  set(patch: IDemoKitPatch): IDemoKitState;
  read(): IDemoKitState & { trailPoints: number };
  ready(): boolean;
}

/** Installs `window.demoKit` and returns a remover. */
export function installDemoKitPageApi(kit: DemoKit, target: { demoKit?: IDemoKitPageApi } = window as unknown as { demoKit?: IDemoKitPageApi }): () => void {
  target.demoKit = { set: patch => kit.set(patch), read: () => ({ ...kit.state, trailPoints: kit.trail.points.length }), ready: () => true };
  return () => { delete target.demoKit; };
}
