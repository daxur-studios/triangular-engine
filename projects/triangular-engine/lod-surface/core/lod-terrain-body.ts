import { Group, type PerspectiveCamera } from 'three';
import type { NodeMaterial } from 'three/webgpu';
import { detailTexelMetres, withDetailNoise } from './lod-detail-noise';
import type { LodDomain, Vec3 } from './lod-domain';
import { createGroundSample, groundAt, type GroundSample } from './lod-ground-query';
import { DEFAULT_BAKE_K } from './lod-height-bake';
import type { HeightSource } from './lod-height';
import type { TextureHeightSource } from './lod-height-texture';
import { CAP_SLACK, LodSelector, PIXEL_FLOOR, type PatchCells, type SelectorStats, type SelectorView } from './lod-selector';
import { createLodSurfaceMesh, type LodSurfaceMesh, type LodView } from './lod-surface-mesh';
import { frustumNormals, type CameraAxes } from './lod-view';

/**
 * Defaults of `<planetTerrain>` and `<flatTerrain>`, which are the lab's defaults of 2026-10-29: 16 cells per patch,
 * 4 px cells, a 4,096-leaf cap (selection ignores the view direction, so the budget is spent partly off-screen),
 * 0.15 hysteresis and detail noise at 4 % of the texel size.
 */
export const TERRAIN_DEFAULTS = {
  /** Grid cells per leaf side. */
  patchCells: 16 as PatchCells,
  /** Target cell size on screen, pixels (never below `PIXEL_FLOOR`). */
  cellPixels: 4,
  /** Leaves selected at most (about 0.7 ms selection p95 at this size, no level changes on a pure turn). */
  leafCap: 4096,
  /** Split/merge hysteresis ratio (`SelectorSettings.hysteresis`). */
  hysteresis: 0.15,
  /** Detail noise below the texel size, amplitude of its first octave as a share of the texel (0 is off). */
  detailNoise: 0.04,
} as const;

/** Everything {@link LodTerrainBody} is configured by; the two components fill it from their inputs. */
export interface LodTerrainSettings {
  /** Plane or cube-sphere, its size in metres (side or radius) and the cube warp. The body sits at the scene origin. */
  readonly domain: LodDomain;
  /**
   * Heights in metres along the base normal. A baked source (`createTextureHeightSource`) must have been baked for this
   * domain's kind, size and warp; an analytic source (`createHeightSource`) for its kind.
   */
  readonly heights: HeightSource;
  /** Detail noise amplitude as a share of the texel size; 0 adds none. */
  readonly detailNoise: number;
  /** Texels per face side the detail noise is sized by; default the heights' baked texture, else 2^{@link DEFAULT_BAKE_K}. */
  readonly detailCells?: number;
  /** Most leaves selected (the budget); the draw capacity follows from it. */
  readonly leafCap: number;
  /** Target cell size on screen, pixels; clamped to at least `PIXEL_FLOOR`. */
  readonly cellPixels: number;
  /** Grid cells per leaf side. */
  readonly patchCells: PatchCells;
  /** Split/merge hysteresis ratio. */
  readonly hysteresis: number;
  /** Draw only leaves inside the view frustum (selection itself does not depend on it). */
  readonly cull: boolean;
  /** Material to draw with instead of the built-in debug material; see `LodSurfaceMeshOptions.material`. */
  readonly material?: NodeMaterial;
}

/** The camera's world position and axes, which {@link LodTerrainBody.update} reads from a `PerspectiveCamera`. */
const AXES: { right: Vec3; up: Vec3; forward: Vec3 } = { right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, -1] };

/**
 * The LOD terrain of one body, framework-free: a selector, the one-draw-call surface mesh and the per-frame step that joins
 * them to a camera. `<planetTerrain>` and `<flatTerrain>` are thin wrappers; use it directly for a custom setup.
 *
 * Add {@link object} to the scene. It follows the camera position each {@link update} (the vertices are camera-relative, so
 * float32 precision holds at planet scale), so do not move it yourself. The terrain lies in the scene's own frame: the
 * sphere's centre, or the plane's centre, at the origin. Selection is view-independent: only the leaves drawn depend on the
 * frustum. The camera's near and far planes are the game's to set; a reversed depth buffer keeps both 2 cm and orbit views
 * in one range.
 */
export class LodTerrainBody {
  /** Add this to the scene. Holds the surface mesh, which is replaced when a setting changes its shader. */
  readonly object = new Group();
  /** The current selector; replaced by {@link configure}. Its `stats` are the telemetry of the last frame. */
  selector!: LodSelector;
  /** The current surface mesh; replaced by {@link configure} when a setting changes its shader. */
  surface!: LodSurfaceMesh;
  /** The heights the selector and camera clearance see: the given source with detail noise wrapped around it. */
  source!: HeightSource;
  /** The settings in force. */
  settings!: LodTerrainSettings;
  /** Wall time of the last selection plus upload, ms. */
  selectionMs = 0;

  private groundStepM = 1;
  private builtKey = '';
  private builtHeights: HeightSource | undefined;
  private builtMaterial: NodeMaterial | undefined;
  private readonly frustum = new Float64Array(12);
  private readonly selectorView: { -readonly [K in keyof SelectorView]: SelectorView[K] } = { camera: [0, 0, 0], pixelAngle: 0, frustum: this.frustum };
  private lighting = true;
  private view: LodView = 'lod';
  private wireframe = false;
  private bounds = true;
  private sun: Vec3 = [0.4, 0.8, 0.45];

  constructor(settings: LodTerrainSettings) {
    this.object.name = 'LOD terrain';
    this.configure(settings);
  }

  /** Triangles drawn by the last selection: drawn leaves times two per cell. */
  get triangles(): number {
    return this.selector.stats.drawn * 2 * this.settings.patchCells ** 2;
  }

  /** Statistics of the last selection (leaves, drawn leaves, splits, level changes, whether the cap was hit). */
  get stats(): Readonly<SelectorStats> {
    return this.selector.stats;
  }

  /**
   * Applies settings. The selector is always remade (its bounds depend on the heights and the noise); the mesh only when
   * a setting changes its shader (domain, heights, patch cells, capacity, noise on or off, material), otherwise the noise
   * amplitude is just updated. Throws when baked heights were made for another domain.
   */
  configure(settings: LodTerrainSettings): void {
    const { domain, heights } = settings;
    const baked = (heights as Partial<TextureHeightSource>).baked;
    if (heights.id === 'cell-planet' && domain.kind === 'plane') {
      throw new Error('Cell-planet heights are a sphere source: use <planetTerrain>, not <flatTerrain>');
    }
    if (baked && (baked.layout.kind !== domain.kind || baked.layout.sizeM !== domain.sizeM || baked.layout.warp !== domain.warp)) {
      const { kind, sizeM, warp } = baked.layout;
      throw new Error(`Heights were baked for a ${kind} of ${sizeM} m (${warp} warp), not a ${domain.kind} of ${domain.sizeM} m (${domain.warp} warp)`);
    }
    this.settings = settings;
    const detailCells = settings.detailCells ?? 2 ** (baked?.layout.k ?? DEFAULT_BAKE_K);
    // The selector and the camera see the noise through the source (heights, bound and node ranges); the mesh adds it in the vertex stage.
    this.groundStepM = detailTexelMetres(domain, detailCells) / 2;
    this.source = withDetailNoise(heights, { domain, cells: detailCells, share: settings.detailNoise });
    this.selector = new LodSelector({
      domain, patchCells: settings.patchCells, mode: 'distance', fixedLevel: 5, cellPixels: Math.max(PIXEL_FLOOR, settings.cellPixels),
      leafCap: settings.leafCap, heightBoundM: this.source.boundM, cull: settings.cull, hysteresis: settings.hysteresis,
      ...(this.source.nodeRange ? { heightRanges: { nodeRange: this.source.nodeRange.bind(this.source) } } : {}),
    });
    const capacity = settings.leafCap + CAP_SLACK + 6;
    const key = [domain.kind, domain.sizeM, domain.warp, settings.patchCells, capacity, settings.detailNoise > 0, detailCells].join('|');
    if (this.surface && key === this.builtKey && heights === this.builtHeights && settings.material === this.builtMaterial) {
      this.surface.setDetailNoise(settings.detailNoise);
      return;
    }
    this.surface?.mesh.removeFromParent();
    this.surface?.dispose();
    this.surface = createLodSurfaceMesh({
      domain, patchCells: settings.patchCells, source: this.source, capacity,
      ...(settings.detailNoise > 0 ? { detail: { cells: detailCells } } : {}),
      ...(settings.material ? { material: settings.material } : {}),
    });
    this.surface.setView(this.view);
    this.surface.setLighting(this.lighting);
    this.surface.setBounds(this.bounds);
    this.surface.setWireframe(this.wireframe);
    this.surface.setSun(this.sun);
    this.surface.setDetailNoise(settings.detailNoise);
    this.object.add(this.surface.mesh);
    this.builtKey = key;
    this.builtHeights = heights;
    this.builtMaterial = settings.material;
  }

  /**
   * The ground under `position` (a point in the scene frame, e.g. a character's feet): height, ground point, normal and the
   * point's altitude above it, from the CPU twin with detail noise included. Pass `out` (see `createGroundSample`) to
   * allocate nothing per call. The normal's difference step is half a texel of this body's height texture. See
   * {@link groundAt} for the details and limits.
   */
  groundAt(position: Vec3, out: GroundSample = createGroundSample()): GroundSample {
    return groundAt(this.source, this.settings.domain, position, out, this.groundStepM);
  }

  /** Debug colouring of the built-in material (one colour per level, or grey). Kept across mesh rebuilds. */
  setView(view: LodView): void {
    this.view = view;
    this.surface.setView(view);
  }

  /** Sun lighting on the built-in material. Kept across mesh rebuilds. */
  setLighting(on: boolean): void {
    this.lighting = on;
    this.surface.setLighting(on);
  }

  /** Patch outlines on the built-in material. Kept across mesh rebuilds. */
  setBounds(on: boolean): void {
    this.bounds = on;
    this.surface.setBounds(on);
  }

  /** Wireframe drawing. Kept across mesh rebuilds. */
  setWireframe(on: boolean): void {
    this.wireframe = on;
    this.surface.setWireframe(on);
  }

  /** Direction to the sun in the scene frame, for the built-in material's lighting. Kept across mesh rebuilds. */
  setSun(direction: Vec3): void {
    this.sun = direction;
    this.surface.setSun(direction);
  }

  /**
   * One frame: reads the camera's world position, axes and field of view, selects leaves for them, uploads the drawn ones and
   * moves {@link object} to the camera. Call it after the camera has settled for the frame (the engine's `beforeRender$`).
   *
   * @param camera A perspective camera (an orthographic view has no pixel angle, so it is not supported).
   * @param viewportHeightPx Height of the drawing buffer in pixels; sets how many pixels a cell covers.
   */
  update(camera: PerspectiveCamera, viewportHeightPx: number): void {
    const began = performance.now();
    camera.updateWorldMatrix(true, false);
    const e = camera.matrixWorld.elements;
    const position = this.selectorView.camera as Vec3;
    position[0] = e[12];
    position[1] = e[13];
    position[2] = e[14];
    setAxis(AXES.right, e[0], e[1], e[2], 1);
    setAxis(AXES.up, e[4], e[5], e[6], 1);
    setAxis(AXES.forward, e[8], e[9], e[10], -1);
    const fov = (camera.fov * Math.PI) / 180;
    const tanHalf = Math.tan(fov / 2) / Math.max(camera.zoom, 1e-6);
    const view = this.selectorView;
    view.pixelAngle = (2 * tanHalf) / Math.max(1, viewportHeightPx);
    frustumNormals(AXES as CameraAxes, 2 * Math.atan(tanHalf), camera.aspect, this.frustum);
    this.selector.select(view);
    this.surface.setDetailFade(Math.max(this.settings.cellPixels, PIXEL_FLOOR) * view.pixelAngle);
    this.surface.upload(this.selector, position);
    this.object.position.set(position[0], position[1], position[2]);
    this.selectionMs = performance.now() - began;
  }

  /** Removes the object from its parent and releases the mesh (not a supplied material). The body is unusable afterwards. */
  dispose(): void {
    this.surface.mesh.removeFromParent();
    this.surface.dispose();
    this.object.removeFromParent();
  }
}

/** Writes the unit vector of (x, y, z) times `sign` into `out`. */
function setAxis(out: Vec3, x: number, y: number, z: number, sign: 1 | -1): void {
  const scale = sign / (Math.hypot(x, y, z) || 1);
  out[0] = x * scale;
  out[1] = y * scale;
  out[2] = z * scale;
}
