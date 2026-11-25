import { PerspectiveCamera, Vector3, type Camera } from 'three';

export interface IDemoOverlayOptions {
  /** Element the overlay is positioned over (normally the render canvas). */
  readonly anchor: HTMLElement;
}

export interface IDemoOverlayFrame {
  readonly camera: Camera;
  /** Subject position in the camera's local (render) frame. */
  readonly subjectLocal: Vector3;
  readonly subjectSizeM: number;
  readonly label: string;
  readonly telemetry: Readonly<Record<string, string | number>>;
  readonly focusBox: boolean;
  readonly telemetryStrip: boolean;
}

const MIN_BOX_PX = 44;
const BOX_PADDING_PX = 10;

/** Projects a local point to pixels inside a viewport. Returns undefined when behind the camera. */
export function projectToViewportPx(point: Vector3, camera: Camera, widthPx: number, heightPx: number): { x: number; y: number } | undefined {
  const ndc = point.clone().project(camera);
  if (ndc.z > 1 || ndc.z < -1) return undefined;
  return { x: (ndc.x * 0.5 + 0.5) * widthPx, y: (-ndc.y * 0.5 + 0.5) * heightPx };
}

/** Pixel height of an object `sizeM` tall at `distanceM` from a perspective camera. */
export function screenHeightPx(sizeM: number, distanceM: number, camera: Camera, viewportHeightPx: number): number {
  if (!(camera instanceof PerspectiveCamera) || !(distanceM > 0)) return MIN_BOX_PX;
  return (sizeM / (2 * distanceM * Math.tan((camera.fov * Math.PI) / 360))) * viewportHeightPx;
}

/** DOM overlay: a bright focus box around the subject (the "green rectangle") and a one-line telemetry strip. */
export class DemoOverlay {
  readonly #root: HTMLDivElement;
  readonly #box: HTMLDivElement;
  readonly #boxLabel: HTMLSpanElement;
  readonly #strip: HTMLDivElement;
  readonly #anchor: HTMLElement;

  constructor(options: IDemoOverlayOptions) {
    this.#anchor = options.anchor;
    this.#root = document.createElement('div');
    this.#root.setAttribute('data-demo-kit', 'overlay');
    this.#root.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483000;font:600 14px ui-monospace,Consolas,monospace;';
    this.#box = document.createElement('div');
    this.#box.setAttribute('data-demo-kit', 'focus-box');
    this.#box.style.cssText = 'position:absolute;border:3px solid #39ff14;border-radius:4px;box-shadow:0 0 12px #39ff14;display:none;';
    this.#boxLabel = document.createElement('span');
    this.#boxLabel.style.cssText = 'position:absolute;left:0;top:-22px;color:#39ff14;white-space:nowrap;text-shadow:0 0 4px #000;';
    this.#box.appendChild(this.#boxLabel);
    this.#strip = document.createElement('div');
    this.#strip.setAttribute('data-demo-kit', 'telemetry');
    this.#strip.style.cssText = 'position:absolute;left:8px;right:8px;bottom:8px;padding:6px 10px;background:rgba(0,0,0,0.6);color:#fff;border-radius:6px;display:none;white-space:nowrap;overflow:hidden;';
    this.#root.append(this.#box, this.#strip);
    document.body.appendChild(this.#root);
  }

  update(frame: IDemoOverlayFrame): void {
    const rect = this.#anchor.getBoundingClientRect();
    Object.assign(this.#root.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    this.#strip.style.display = frame.telemetryStrip ? 'block' : 'none';
    if (frame.telemetryStrip) {
      this.#strip.textContent = Object.entries(frame.telemetry).map(([key, value]) => `${key} ${value}`).join('   ');
    }
    const px = frame.focusBox ? projectToViewportPx(frame.subjectLocal, frame.camera, rect.width, rect.height) : undefined;
    if (!px) { this.#box.style.display = 'none'; return; }
    const distance = frame.subjectLocal.distanceTo(frame.camera.position);
    const size = Math.max(MIN_BOX_PX, screenHeightPx(frame.subjectSizeM, distance, frame.camera, rect.height) + BOX_PADDING_PX * 2);
    Object.assign(this.#box.style, { display: 'block', width: `${size}px`, height: `${size}px`, left: `${px.x - size / 2}px`, top: `${px.y - size / 2}px` });
    this.#boxLabel.textContent = frame.label;
  }

  dispose(): void { this.#root.remove(); }
}
