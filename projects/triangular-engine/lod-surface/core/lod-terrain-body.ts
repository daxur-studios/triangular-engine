import { Group, type PerspectiveCamera } from 'three';
import type { NodeMaterial } from 'three/webgpu';
import { detailTexelMetres, withDetailNoise } from './lod-detail-noise';
import { bakeDetailProfile, type DetailProfile, type DetailWeightField } from './lod-detail-profile';
import type { LodDomain, Vec3 } from './lod-domain';
import { createGroundSample, groundAt, type GroundSample } from './lod-ground-query';
import { DEFAULT_BAKE_K } from './lod-height-bake';
import type { HeightSource } from './lod-height';
import type { TextureHeightSource } from './lod-height-texture';
import { MorphMapResolver, projectionBasis, type LodMorphSettings, type MorphUniformsLike } from './lod-morph-frame';
import { StretchMetric, type StretchBasis, type StretchProjection, type StretchState } from './lod-morph-metric';
import { CAP_SLACK, LodSelector, PIXEL_FLOOR, type NodeCoverHook, type NodeGeometryHook, type PatchCells, type SelectorStats, type SelectorView } from './lod-selector';
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
  /**
   * Where the detail noise is strong or absent (`lod-detail-profile.ts`): a per-point weight on its amplitude, baked once per
   * profile object. Absent: weight 1 everywhere. Needs `detailNoise` above 0. Pass the same object while it is unchanged;
   * a new object is a new bake and rebuilds the mesh.
   */
  readonly detailProfile?: DetailProfile;
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
  /**
   * Preview (Plan 059 G6b, sphere only): builds the globe-to-map morph into the surface mesh (`LodSurfaceMeshOptions.morph`). Changing it
   * rebuilds the mesh. Drive it with {@link LodTerrainBody.setMorph}. `<planetTerrain>` sets it for a sphere (G6e).
   */
  readonly morph?: boolean;
  /**
   * Preview (Plan 059 G6d, needs ` morph `): draws the pole leaves as a fan beside the surface (` LodSurfaceMeshOptions.poleFan `). The body
   * adds {@link LodSurfaceMesh.poleFanMesh} to {@link object} only while the morph is above 0. Changing it rebuilds the mesh.
   */
  readonly poleFan?: boolean;
}

/**
 * How {@link LodTerrainBody.update} treats frustum culling above morph 0. The selector's own bounds describe the globe, not the bent
 * ground, so a frustum test with them would drop leaves that are on screen.
 *
 * - `'off'` (default, temporary): nothing is culled, and the selector is given the camera's position on the unbent globe, so a
 *   view of the whole map draws every leaf the budget allows.
 * - `'bent-bounds'`: the frustum test is kept and the selector gets the bent camera as it is. Only correct while a
 *   {@link NodeGeometryHook} that bounds the nodes in the bent frame is installed ({@link LodTerrainBody.setGeometryHook}, `StretchMetric`
 *   of `lod-morph-metric.ts`).
 */
export type LodMorphCulling = 'off' | 'bent-bounds';

/** The camera's world position and axes, which {@link LodTerrainBody.update} reads from a `PerspectiveCamera`. */
/** The camera may move this share of its height above the surface before a body reselects: a far body is not rebuilt every frame. */
const CAMERA_SLACK = 0.005;
/** Pixels the frustum may turn before a body reselects; only leaves at the screen edge can show it. */
const FRUSTUM_SLACK_PX = 2;

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
  /** Center of the planet in scene space in metres. Default [0, 0, 0]. */
  center: Vec3 = [0, 0, 0];
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
  private weightField: DetailWeightField | undefined;
  private builtWeightField: DetailWeightField | undefined;
  private builtMaterial: NodeMaterial | undefined;
  private readonly frustum = new Float64Array(12);
  private readonly selectorView: { -readonly [K in keyof SelectorView]: SelectorView[K] } = { camera: [0, 0, 0], pixelAngle: 0, frustum: this.frustum };
  private lighting = true;
  private view: LodView = 'lod';
  private wireframe = false;
  private bounds = true;
  private sun: Vec3 = [0.4, 0.8, 0.45];
  private morphSource: LodMorphSettings | MorphUniformsLike | undefined;
  private morphCulling: LodMorphCulling = 'off';
  /** The culling mode the consumer last set with {@link setMorphCulling}; {@link setMorphMetric} `(false)` restores it. */
  private savedMorphCulling: LodMorphCulling = 'off';
  private geometryHook: NodeGeometryHook | undefined;
  private coverHook: NodeCoverHook | undefined;
  private readonly unbent: Vec3 = [0, 0, 0];
  private stretchOn = false;
  /** The stretch metric of the current selector (see {@link setMorphMetric}); remade with each selector. */
  private stretch: StretchMetric | undefined;
  private stretchSelector: LodSelector | undefined;
  private readonly bentCamera: Vec3 = [0, 0, 0];
  /** The live map of the stretch camera (`placeStretchCamera`): one object, re-filled in place as the morph moves. */
  private readonly morphResolver = new MorphMapResolver();
  /** The state the stretch metric is updated with each frame: one object, written in place. */
  private readonly stretchState: { morph: number; projection: StretchProjection; radiusM: number; basis: StretchBasis } = {
    morph: 0, projection: 'equal-earth', radiusM: 1, basis: projectionBasis(0, 0),
  };
  private readonly globeState: StretchState = { morph: 0 };

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
    const profile = settings.detailNoise > 0 ? settings.detailProfile : undefined;
    if (profile !== this.weightField?.profile) {
      this.weightField?.source.dispose();
      this.weightField = profile ? bakeDetailProfile(domain, profile) : undefined;
    }
    this.source = withDetailNoise(heights, { domain, cells: detailCells, share: settings.detailNoise, ...(this.weightField ? { weights: this.weightField.weights } : {}) });
    this.selector = new LodSelector({
      domain, patchCells: settings.patchCells, mode: 'distance', fixedLevel: 5, cellPixels: Math.max(PIXEL_FLOOR, settings.cellPixels),
      leafCap: settings.leafCap, heightBoundM: this.source.boundM, cull: settings.cull, hysteresis: settings.hysteresis,
      cameraSlack: CAMERA_SLACK, frustumSlackPx: FRUSTUM_SLACK_PX,
      ...(this.source.nodeRange ? { heightRanges: { nodeRange: this.source.nodeRange.bind(this.source) } } : {}),
    });
    if (this.geometryHook) this.selector.setGeometryHook(this.geometryHook);
    if (this.coverHook) this.selector.setCoverHook(this.coverHook);
    this.syncStretch();
    const capacity = settings.leafCap + CAP_SLACK + 6;
    const morph = settings.morph === true && domain.kind === 'sphere';
    const poleFan = morph && settings.poleFan === true;
    const key = [domain.kind, domain.sizeM, domain.warp, settings.patchCells, capacity, settings.detailNoise > 0, detailCells, morph, poleFan].join('|');
    if (this.surface && key === this.builtKey && heights === this.builtHeights && this.weightField === this.builtWeightField && settings.material === this.builtMaterial) {
      this.surface.setDetailNoise(settings.detailNoise);
      return;
    }
    this.surface?.mesh.removeFromParent();
    this.surface?.poleFanMesh?.removeFromParent();
    this.surface?.dispose();
    this.surface = createLodSurfaceMesh({
      domain, patchCells: settings.patchCells, source: this.source, capacity,
      ...(settings.detailNoise > 0 ? { detail: { cells: detailCells, ...(this.weightField ? { weights: this.weightField.source.lattice } : {}) } } : {}),
      ...(settings.material ? { material: settings.material } : {}),
      ...(morph ? { morph } : {}),
      ...(poleFan ? { poleFan } : {}),
    });
    if (morph) this.surface.setMorph(this.morphSource);
    this.surface.setView(this.view);
    this.surface.setLighting(this.lighting);
    this.surface.setBounds(this.bounds);
    this.surface.setWireframe(this.wireframe);
    this.surface.setSun(this.sun);
    this.surface.setDetailNoise(settings.detailNoise);
    this.object.add(this.surface.mesh);
    this.syncPoleFan();
    this.builtKey = key;
    this.builtHeights = heights;
    this.builtWeightField = this.weightField;
    this.builtMaterial = settings.material;
  }

  /**
   * The ground under `position` (a point in the scene frame, e.g. a character's feet): height, ground point, normal and the
   * point's altitude above it, from the CPU twin with detail noise included. Pass `out` (see `createGroundSample`) to
   * allocate nothing per call. The normal's difference step is half a texel of this body's height texture. See
   * {@link groundAt} for the details and limits.
   */
  groundAt(position: Vec3, out: GroundSample = createGroundSample()): GroundSample {
    const hasCenter = this.center[0] !== 0 || this.center[1] !== 0 || this.center[2] !== 0;
    const local: Vec3 = hasCenter ? [position[0] - this.center[0], position[1] - this.center[1], position[2] - this.center[2]] : position;
    const result = groundAt(this.source, this.settings.domain, local, out, this.groundStepM);
    if (hasCenter) {
      result.point[0] += this.center[0];
      result.point[1] += this.center[1];
      result.point[2] += this.center[2];
    }
    return result;
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
  /** Center of the planet in scene space. Kept across mesh rebuilds. */
  setCenter(center: Vec3 | readonly [number, number, number]): void {
    this.center[0] = center[0];
    this.center[1] = center[1];
    this.center[2] = center[2];
  }

  setSun(direction: Vec3): void {
    this.sun = direction;
    this.surface.setSun(direction);
  }

  /**
   * Preview (needs `LodTerrainSettings.morph`; ignored without it): the globe-to-map morph state, as `LodSurfaceMesh.setMorph`: a
   * {@link LodMorphSettings} object, or `<planet>`'s `morphUniforms`, which are read again each {@link update}. Kept across mesh rebuilds.
   */
  setMorph(source: LodMorphSettings | MorphUniformsLike | undefined): void {
    this.morphSource = source;
    if (this.settings.morph && this.settings.domain.kind === 'sphere') this.surface.setMorph(source);
  }

  /**
   * How frustum culling is treated above morph 0 (see {@link LodMorphCulling}). Default `'off'`. While {@link setMorphMetric} is on it
   * has no effect: the culling is `'bent-bounds'`. The requested mode is still remembered, and turning the metric off with
   * `setMorphMetric(false)` restores it.
   */
  setMorphCulling(mode: LodMorphCulling): void {
    this.savedMorphCulling = mode;
    if (!this.stretchOn) this.morphCulling = mode;
  }

  /**
   * Installs the selector's {@link NodeGeometryHook} (the bent bounds of G6c). Kept across {@link configure}, which remakes the selector.
   * Together with {@link setMorphCulling} `'bent-bounds'` the selector then works in the bent frame.
   *
   * The hook and the stretch metric are exclusive. While {@link setMorphMetric} is on the metric owns the selector's hook, so a
   * defined hook throws an `Error`; `setGeometryHook(undefined)` is allowed then and does nothing. Remove a hook before turning the
   * metric on.
   *
   * @throws if {@link setMorphMetric} is on and `hook` is defined.
   */
  setGeometryHook(hook: NodeGeometryHook | undefined): void {
    if (this.stretchOn) {
      if (hook) throw new Error('setGeometryHook cannot be used while setMorphMetric(true) is on: the metric owns the geometry hook');
      return;
    }
    this.geometryHook = hook;
    this.selector.setGeometryHook(hook);
  }

  /**
   * Installs the selector's {@link NodeCoverHook}: nodes it reports as entirely hidden (land over a water body, say) are not drawn
   * and take none of the leaf budget. Kept across {@link configure}, which remakes the selector; call {@link invalidateCover}
   * when what the hook tests against changes.
   */
  setCoverHook(hook: NodeCoverHook | undefined): void {
    this.coverHook = hook;
    this.selector.setCoverHook(hook);
  }

  /** Makes the selector ask the cover hook again for every node (the cover changed); the next {@link update} reselects. */
  invalidateCover(): void {
    this.selector.invalidateCover();
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
    position[0] = e[12] - this.center[0];
    position[1] = e[13] - this.center[1];
    position[2] = e[14] - this.center[2];
    setAxis(AXES.right, e[0], e[1], e[2], 1);
    setAxis(AXES.up, e[4], e[5], e[6], 1);
    setAxis(AXES.forward, e[8], e[9], e[10], -1);
    const fov = (camera.fov * Math.PI) / 180;
    const tanHalf = Math.tan(fov / 2) / Math.max(camera.zoom, 1e-6);
    const view = this.selectorView;
    view.pixelAngle = (2 * tanHalf) / Math.max(1, viewportHeightPx);
    frustumNormals(AXES as CameraAxes, 2 * Math.atan(tanHalf), camera.aspect, this.frustum);
    // Above morph 0 the surface is bent while the selector's bounds describe the globe: by default nothing is culled (a zero frustum
    // never rejects a node) and the selector sees the camera over the unbent globe. With bent bounds it sees the bent camera.
    const morphing = this.settings.morph === true && this.surface.morphState.morph > 0;
    if (this.stretch) this.placeStretchCamera(position, view);
    else if (morphing && this.morphCulling === 'off') {
      this.frustum.fill(0);
      this.surface.unbend(position, this.unbent);
      view.camera = this.unbent;
    }
    this.selector.select(view);
    view.camera = position;
    this.surface.setDetailFade(Math.max(this.settings.cellPixels, PIXEL_FLOOR) * view.pixelAngle);
    this.surface.upload(this.selector, position);
    this.syncPoleFan();
    this.object.position.set(e[12], e[13], e[14]);
    this.selectionMs = performance.now() - began;
  }

  /**
   * Preview (G6e, sphere only, needs the morph setting): selects above morph 0 in the bent frame, with a {@link StretchMetric} on each
   * selector this body makes. Above morph 0 the selector's camera is the metric's bent camera (`selectionPoint`) for the camera's unbent
   * direction and altitude, and the frustum is the camera's own. The morph is read from the source given to {@link setMorph} each frame.
   * It sets the culling to `'bent-bounds'`, and while it is on {@link setMorphCulling} has no effect (the mode is remembered). Turning it
   * off (`setMorphMetric(false)`) restores the remembered mode, which is `'off'` unless {@link setMorphCulling} was called.
   *
   * While it is on the metric owns the selector's geometry hook. Turning it on throws an `Error` when a hook is installed: remove the
   * hook first with `setGeometryHook(undefined)`. While it is on, {@link setGeometryHook} throws for a defined hook. Kept across
   * {@link configure}. Off by default.
   *
   * @throws if `on` is true and a geometry hook is installed.
   */
  setMorphMetric(on: boolean): void {
    if (on && this.geometryHook) {
      throw new Error('setMorphMetric(true) cannot be used while a geometry hook is installed: remove it first with setGeometryHook(undefined)');
    }
    this.stretchOn = on;
    this.morphCulling = on ? 'bent-bounds' : this.savedMorphCulling;
    this.syncStretch();
  }

  /** Makes, keeps or drops the stretch metric so that it belongs to the current selector (a configure remakes the selector). */
  private syncStretch(): void {
    const want = this.stretchOn && this.settings.morph === true && this.settings.domain.kind === 'sphere';
    if (want && this.stretch && this.stretchSelector === this.selector) return;
    this.stretch?.dispose();
    this.stretch = undefined;
    this.stretchSelector = undefined;
    if (!want) return;
    this.stretch = new StretchMetric(this.selector, { radiusM: this.settings.domain.sizeM });
    this.stretchSelector = this.selector;
  }

  /**
   * The metric takes the live morph each frame, and above morph 0 the selector's camera is the bent camera of the metric's frame: the
   * camera's unbent point under the map the node geometry was measured at ({@link StretchMetric.placeCamera}), not the live one. The
   * selector's view then changes only when the camera moves or the geometry is refreshed, so a morph animation between refreshes
   * reuses the tree, while the mesh still draws with the live morph. At morph 0 the camera is left as it is.
   */
  private placeStretchCamera(position: Vec3, view: { camera: Vec3 }): void {
    const stretch = this.stretch;
    if (!stretch) return;
    const source = this.morphSource;
    const map = source && this.settings.morph === true ? this.morphResolver.resolve(source, this.settings.domain.sizeM) : undefined;
    if (!map) {
      stretch.update(this.globeState);
      return;
    }
    const state = this.stretchState;
    state.morph = map.morph;
    state.projection = map.projection;
    state.radiusM = map.radius;
    state.basis = map.basis;
    stretch.update(state);
    if (map.morph <= 0) return;
    stretch.placeCamera(position, this.bentCamera);
    view.camera = this.bentCamera;
  }

  /** The pole fan is in the scene only above morph 0 (it draws nothing at the globe): added and removed as the morph crosses 0. */
  private syncPoleFan(): void {
    const fan = this.surface.poleFanMesh;
    if (!fan) return;
    const shown = this.surface.morphState.morph > 0;
    if (shown && fan.parent !== this.object) this.object.add(fan);
    else if (!shown && fan.parent === this.object) fan.removeFromParent();
  }

  /** Removes the object from its parent and releases the mesh (not a supplied material). The body is unusable afterwards. */
  dispose(): void {
    this.stretch?.dispose();
    this.stretch = undefined;
    this.stretchSelector = undefined;
    this.surface.mesh.removeFromParent();
    this.surface.poleFanMesh?.removeFromParent();
    this.surface.dispose();
    this.weightField?.source.dispose();
    this.weightField = undefined;
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
