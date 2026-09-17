import { Color, DataTexture, NearestFilter, RGBAFormat, UnsignedByteType } from 'three';

export interface ICellHighlightStyle {
  color: Color | string;
  opacity?: number;
}

/**
 * High-performance GPU tactical mask manager for Voronoi cell planets.
 *
 * Backed by a 2D DataTexture storing [R, G, B, A] bytes per cell. Updating selection,
 * reachable movement ranges, or territory fills mutates the CPU byte array in O(changedCells)
 * and flags `texture.needsUpdate = true`, entirely bypassing any geometry re-allocation.
 */
export class CellTacticalOverlay {
  readonly cellCount: number;
  readonly texWidth: number;
  readonly texHeight: number;
  readonly texture: DataTexture;

  private readonly data: Uint8Array;
  private readonly colorScratch = new Color();
  private selectedCellId: number | null = null;

  get rawBuffer(): Uint8Array {
    return this.data;
  }

  constructor(cellCount: number) {
    this.cellCount = cellCount;

    // Sizing: pick power-of-two width, derive minimum required height
    const width = Math.min(256, Math.max(16, 1 << Math.ceil(Math.log2(Math.sqrt(cellCount) * 1.5))));
    const height = Math.max(1, Math.ceil(cellCount / width));

    this.texWidth = width;
    this.texHeight = height;

    this.data = new Uint8Array(width * height * 4);
    this.texture = new DataTexture(
      this.data,
      width,
      height,
      RGBAFormat,
      UnsignedByteType,
    );
    this.texture.minFilter = NearestFilter;
    this.texture.magFilter = NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
  }

  /**
   * Sets or clears a highlight for a specific cell.
   */
  setCellHighlight(cellId: number, color: Color | string | null, opacity = 0.5): void {
    if (cellId < 0 || cellId >= this.cellCount) return;
    const offset = cellId * 4;

    if (!color) {
      this.data[offset] = 0;
      this.data[offset + 1] = 0;
      this.data[offset + 2] = 0;
      this.data[offset + 3] = 0;
    } else {
      if (color instanceof Color) {
        this.colorScratch.copy(color);
      } else {
        this.colorScratch.setStyle(color);
      }
      this.data[offset] = Math.round(this.colorScratch.r * 255);
      this.data[offset + 1] = Math.round(this.colorScratch.g * 255);
      this.data[offset + 2] = Math.round(this.colorScratch.b * 255);
      this.data[offset + 3] = Math.round(Math.max(0, Math.min(1, opacity)) * 255);
    }
  }

  /**
   * Highlights a collection of reachable/active cells (e.g. unit movement range).
   */
  setReachableRange(cellIds: Iterable<number>, color: Color | string = '#22c55e', opacity = 0.45): void {
    if (color instanceof Color) {
      this.colorScratch.copy(color);
    } else {
      this.colorScratch.setStyle(color);
    }
    const r = Math.round(this.colorScratch.r * 255);
    const g = Math.round(this.colorScratch.g * 255);
    const b = Math.round(this.colorScratch.b * 255);
    const a = Math.round(Math.max(0, Math.min(1, opacity)) * 255);

    for (const id of cellIds) {
      if (id >= 0 && id < this.cellCount) {
        const offset = id * 4;
        this.data[offset] = r;
        this.data[offset + 1] = g;
        this.data[offset + 2] = b;
        this.data[offset + 3] = a;
      }
    }
  }

  /**
   * Sets national/faction territory color fills across all cells.
   */
  setFactionTerritories(
    factionByCell: ArrayLike<number>,
    factionColors: Record<number, Color | string>,
    opacity = 0.35,
  ): void {
    const defaultAlpha = Math.round(Math.max(0, Math.min(1, opacity)) * 255);
    const colorCache = new Map<number, [number, number, number]>();

    for (const [key, val] of Object.entries(factionColors)) {
      const fId = Number(key);
      const c = val instanceof Color ? val : new Color(val);
      colorCache.set(fId, [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)]);
    }

    const n = Math.min(this.cellCount, factionByCell.length);
    for (let i = 0; i < n; i++) {
      const fId = factionByCell[i];
      const rgb = colorCache.get(fId);
      const offset = i * 4;
      if (rgb) {
        this.data[offset] = rgb[0];
        this.data[offset + 1] = rgb[1];
        this.data[offset + 2] = rgb[2];
        this.data[offset + 3] = defaultAlpha;
      } else {
        this.data[offset + 3] = 0;
      }
    }
  }

  /**
   * Highlights the selected cell with distinct visual styling.
   */
  setSelectedCell(cellId: number | null, color: Color | string = '#38bdf8', opacity = 0.85): void {
    if (this.selectedCellId !== null && this.selectedCellId >= 0 && this.selectedCellId < this.cellCount) {
      // Clear previous selection if not overwritten
      const offset = this.selectedCellId * 4;
      this.data[offset + 3] = 0;
    }
    this.selectedCellId = cellId;
    if (cellId !== null) {
      this.setCellHighlight(cellId, color, opacity);
    }
  }

  /**
   * Clears all tactical cell highlights to transparent.
   */
  clearAll(): void {
    this.data.fill(0);
    this.selectedCellId = null;
    this.texture.needsUpdate = true;
  }

  /**
   * Commits all texture buffer modifications to GPU memory.
   */
  update(): void {
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
