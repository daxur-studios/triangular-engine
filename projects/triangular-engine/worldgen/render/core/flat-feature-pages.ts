import { DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three';
import { flatFeaturePageBounds, type FlatFeatureSet, type FlatFeatureVec3 } from './flat-features';

/** Options for {@link FlatFeaturePageWindow}. */
export interface IFlatFeaturePageWindowOptions {
  /** Pages per side of the resident window around the camera. Default 32. */
  readonly windowPages?: number;
  /** Feature slots per page, a multiple of 4; the material walks this many per pixel. Default 8. */
  readonly maxPerPage?: number;
  /** Feature table rows: the most features one set may hold. Default 256. */
  readonly capacity?: number;
  /** Smallest page height in metres, whatever the altitude. Default 400. */
  readonly minPageM?: number;
  /** Target page height as a multiple of camera altitude. Default 1.5. */
  readonly pageAltitudeRatio?: number;
  /** Coarsest level (2 columns × 1 row is level 0). Default 2. */
  readonly minLevel?: number;
  /** Finest level. Default 22. */
  readonly maxLevel?: number;
}

/** Counters for diagnostics and tests. */
export interface IFlatFeaturePageStats {
  /** Current page level. */
  readonly level: number;
  /** Pages in the window that list at least one feature. */
  readonly pagesWithFeatures: number;
  /** Page lists selected since construction (a page streaming in, or every page after `setFeatures`). */
  readonly pagesSelected: number;
  /** Resident pages whose list was full, so lower-priority features were left out. */
  readonly pagesOverflowing: number;
  /** Longest list in the window. */
  readonly longestList: number;
}

/** Feature table texels per feature (rows of the feature texture). */
export const FLAT_FEATURE_TABLE_ROWS = 3;

/**
 * The per-page feature lists for the `planet-material` flat-feature layer, as two float textures:
 *
 * - `featureTexture`: `capacity × 3` RGBA texels. Column `i` is feature `i`: row 0 `along.xyz, halfLengthM`,
 *   row 1 `across.xyz, halfWidthM`, row 2 `shape, markings, priority, surface`.
 * - `pageTexture`: `windowPages² × maxPerPage/4` RGBA texels. Column `wy * windowPages + wx` is the window page
 *   `(wx, wy)`; its `maxPerPage` slots hold `featureIndex + 1`, or 0 when empty.
 *
 * Pages are cells of an equirectangular grid (see `flatFeaturePageBounds`). A window of `windowPages²` pages follows
 * the camera at a level picked from altitude; when a page streams into the window it selects the features that
 * overlap it, at most `maxPerPage`, highest priority first. Pass the window to `flatFeatureLayer` and call
 * {@link update} each frame (cheap when the camera has not moved pages).
 */
export class FlatFeaturePageWindow {
  readonly windowPages: number;
  readonly maxPerPage: number;
  readonly capacity: number;
  readonly featureTexture: DataTexture;
  readonly pageTexture: DataTexture;
  /** Current page level, columns (`2^(level+1)`) and rows (`2^level`). */
  level = -1;
  columns = 1;
  rows = 1;
  /** Grid column and row of window page (0, 0). Columns wrap at the antimeridian. */
  originX = 0;
  originY = 0;
  /** Datum radius of the current set, metres. */
  radiusM = 1;
  /** 1 while a set with features is attached and the window has been placed; the layer draws nothing at 0. */
  enabled = 0;

  private set: FlatFeatureSet | null = null;
  private readonly lists = new Map<string, { indices: readonly number[]; dropped: number }>();
  private selected = 0;
  private readonly options: Required<Omit<IFlatFeaturePageWindowOptions, 'windowPages' | 'maxPerPage' | 'capacity'>>;

  constructor(set: FlatFeatureSet | null = null, options: IFlatFeaturePageWindowOptions = {}) {
    this.windowPages = options.windowPages ?? 32;
    this.maxPerPage = options.maxPerPage ?? 8;
    this.capacity = options.capacity ?? 256;
    if (this.maxPerPage <= 0 || this.maxPerPage % 4 !== 0) throw new Error('FlatFeaturePageWindow: maxPerPage must be a positive multiple of 4');
    this.options = {
      minPageM: options.minPageM ?? 400,
      pageAltitudeRatio: options.pageAltitudeRatio ?? 1.5,
      minLevel: Math.max(options.minLevel ?? 2, 0),
      maxLevel: options.maxLevel ?? 22,
    };
    this.featureTexture = floatTexture(this.capacity, FLAT_FEATURE_TABLE_ROWS);
    this.pageTexture = floatTexture(this.windowPages * this.windowPages, this.maxPerPage / 4);
    this.setFeatures(set);
  }

  /** Replaces the feature set (or clears it with `null`); every resident page selects again on the next update. */
  setFeatures(set: FlatFeatureSet | null): void {
    if (set && set.features.length > this.capacity) {
      throw new Error(`FlatFeaturePageWindow: ${set.features.length} features exceed the capacity of ${this.capacity}`);
    }
    this.set = set;
    this.lists.clear();
    const data = this.featureTexture.image.data as Float32Array;
    data.fill(0);
    if (set) {
      this.radiusM = set.radiusM;
      const stride = this.capacity * 4;
      for (const f of set.features) {
        const o = f.index * 4;
        data.set([f.along[0], f.along[1], f.along[2], f.halfLengthM], o);
        data.set([f.across[0], f.across[1], f.across[2], f.halfWidthM], stride + o);
        data.set([f.shape, f.markings, f.priority, f.surface], 2 * stride + o);
      }
    }
    this.featureTexture.needsUpdate = true;
    if (this.level >= 0) this.fill();
    this.enabled = set && set.features.length > 0 && this.level >= 0 ? 1 : 0;
  }

  /**
   * Places the window for a camera. `cameraDirection` is the unit direction from the planet centre under the camera,
   * `altitudeM` its height above the datum. Returns true when the page texture changed.
   */
  update(cameraDirection: FlatFeatureVec3, altitudeM: number): boolean {
    const level = this.pickLevel(Math.max(altitudeM, 0));
    const columns = 2 ** (level + 1);
    const rows = 2 ** level;
    const lon = Math.atan2(cameraDirection[0], cameraDirection[2]);
    const lat = Math.asin(Math.max(-1, Math.min(1, cameraDirection[1] / Math.hypot(...cameraDirection))));
    const cx = Math.min(Math.floor(((lon + Math.PI) / (2 * Math.PI)) * columns), columns - 1);
    const cy = Math.min(Math.floor(((lat + Math.PI / 2) / Math.PI) * rows), rows - 1);
    const half = this.windowPages / 2;
    const wrapped = (((cx - (this.originX + half)) % columns) + columns + columns / 2) % columns - columns / 2;
    const recentre =
      level !== this.level ||
      Math.abs(wrapped) > this.windowPages / 8 ||
      Math.abs(cy - (this.originY + half)) > this.windowPages / 8 && this.rows > this.windowPages;
    if (!recentre) return false;
    this.level = level;
    this.columns = columns;
    this.rows = rows;
    this.originX = (((cx - half) % columns) + columns) % columns;
    this.originY = Math.max(0, Math.min(cy - half, rows - this.windowPages));
    this.fill();
    this.enabled = this.set && this.set.features.length > 0 ? 1 : 0;
    return true;
  }

  /** Feature indices listed for grid page `(x, y)` at the current level, or empty outside the window. */
  pageList(x: number, y: number): readonly number[] {
    return this.lists.get(`${this.level}/${x}/${y}`)?.indices ?? [];
  }

  /** Counters for the current window. */
  get stats(): IFlatFeaturePageStats {
    let pagesWithFeatures = 0;
    let pagesOverflowing = 0;
    let longestList = 0;
    for (const list of this.lists.values()) {
      if (list.indices.length > 0) pagesWithFeatures += 1;
      if (list.dropped > 0) pagesOverflowing += 1;
      longestList = Math.max(longestList, list.indices.length);
    }
    return { level: this.level, pagesWithFeatures, pagesSelected: this.selected, pagesOverflowing, longestList };
  }

  dispose(): void {
    this.featureTexture.dispose();
    this.pageTexture.dispose();
  }

  /** Smallest page whose height is at least the target, held while it stays within a factor of the target. */
  private pickLevel(altitudeM: number): number {
    const { minPageM, pageAltitudeRatio, minLevel, maxLevel } = this.options;
    const target = Math.max(minPageM, altitudeM * pageAltitudeRatio);
    const span = Math.PI * this.radiusM;
    const clamp = (l: number) => Math.max(minLevel, Math.min(maxLevel, l));
    if (this.level >= 0) {
      const current = span / 2 ** this.level;
      if (current >= target * 0.75 && current <= target * 2.5 && clamp(this.level) === this.level) return this.level;
    }
    return clamp(Math.floor(Math.log2(span / target)));
  }

  /** Selects lists for pages new to the window, drops the rest, and repacks the page texture. */
  private fill(): void {
    const data = this.pageTexture.image.data as Float32Array;
    data.fill(0);
    const next = new Map<string, { indices: readonly number[]; dropped: number }>();
    const width = this.windowPages * this.windowPages;
    const spanX = Math.min(this.windowPages, this.columns);
    const spanY = Math.min(this.windowPages, this.rows);
    for (let wy = 0; wy < spanY; wy += 1) {
      for (let wx = 0; wx < spanX; wx += 1) {
        const x = (this.originX + wx) % this.columns;
        const y = this.originY + wy;
        const key = `${this.level}/${x}/${y}`;
        let list = this.lists.get(key);
        if (!list) {
          list = this.set ? this.set.selectForPage(flatFeaturePageBounds(this.level, x, y), this.maxPerPage) : { indices: [], dropped: 0 };
          this.selected += 1;
        }
        next.set(key, list);
        const column = wy * this.windowPages + wx;
        list.indices.forEach((index, slot) => {
          data[(Math.floor(slot / 4) * width + column) * 4 + (slot % 4)] = index + 1;
        });
      }
    }
    this.lists.clear();
    for (const [key, list] of next) this.lists.set(key, list);
    this.pageTexture.needsUpdate = true;
  }
}

function floatTexture(width: number, height: number): DataTexture {
  const texture = new DataTexture(new Float32Array(width * height * 4), width, height, RGBAFormat, FloatType);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
