import type { ICellPerPixelPaletteEdit } from './cell-per-pixel-material';

export type CellDataLayerKind = 'categorical' | 'continuous' | 'overlay';

export interface ICellDataLayerLegendEntry {
  readonly label: string;
  readonly colour: string;
}

export interface ICellDataLayerPalette {
  readonly cellCount: number;
  readonly cellData: Float32Array;
  subscribe(listener: (edits: readonly ICellPerPixelPaletteEdit[]) => void): () => void;
}

export interface ICellDataLayer {
  readonly id: string;
  readonly label: string;
  readonly kind: CellDataLayerKind;
  readonly palette: ICellDataLayerPalette;
  readonly editable?: boolean;
  readonly legend?: readonly ICellDataLayerLegendEntry[];
}

/**
 * Owns mutable linear RGBA colours for one cell data layer.
 *
 * Consumers can update a few cells without rebuilding geometry; renderers receive the
 * compact edit batch and decide how to upload it.
 */
export class CellDataLayerPalette implements ICellDataLayerPalette {
  readonly cellData: Float32Array;

  private readonly listeners = new Set<
    (edits: readonly ICellPerPixelPaletteEdit[]) => void
  >();

  constructor(readonly cellCount: number, initialData?: Float32Array) {
    const expectedLength = cellCount * 4;
    if (initialData && initialData.length !== expectedLength) {
      throw new RangeError('Cell layer palette length does not match cellCount.');
    }
    this.cellData = initialData ? new Float32Array(initialData) : new Float32Array(expectedLength);
    if (!initialData) {
      for (let cellId = 0; cellId < cellCount; cellId += 1) {
        this.cellData[cellId * 4 + 3] = 1;
      }
    }
  }

  subscribe(listener: (edits: readonly ICellPerPixelPaletteEdit[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Applies a batch and emits one notification so the renderer invalidates once. */
  setCellColours(edits: readonly ICellPerPixelPaletteEdit[]): void {
    const changed: ICellPerPixelPaletteEdit[] = [];
    for (const edit of edits) {
      this.assertCellId(edit.cellId);
      const offset = edit.cellId * 4;
      const colour: ICellPerPixelPaletteEdit['colour'] = [
        clamp(edit.colour[0]),
        clamp(edit.colour[1]),
        clamp(edit.colour[2]),
        edit.colour[3] === undefined ? 1 : clamp(edit.colour[3]),
      ];
      if (
        this.cellData[offset] === colour[0] &&
        this.cellData[offset + 1] === colour[1] &&
        this.cellData[offset + 2] === colour[2] &&
        this.cellData[offset + 3] === colour[3]
      ) {
        continue;
      }
      this.cellData[offset] = colour[0];
      this.cellData[offset + 1] = colour[1];
      this.cellData[offset + 2] = colour[2];
      this.cellData[offset + 3] = colour[3] ?? 1;
      changed.push({ cellId: edit.cellId, colour });
    }
    if (changed.length === 0) return;
    for (const listener of this.listeners) listener(changed);
  }

  setCellColour(cellId: number, colour: readonly [number, number, number, number?]): void {
    this.setCellColours([{ cellId, colour }]);
  }

  private assertCellId(cellId: number): void {
    if (!Number.isInteger(cellId) || cellId < 0 || cellId >= this.cellCount) {
      throw new RangeError(`Cell layer palette edit ${cellId} is out of range.`);
    }
  }
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
