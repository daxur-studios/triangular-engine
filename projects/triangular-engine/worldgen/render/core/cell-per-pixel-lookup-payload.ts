/** Worker-to-renderer payload for the cell-per-pixel colour lookup. */
export interface ICellPerPixelLookupPayload {
  /** One RGBA float texel per cell; RGB is the linear display colour. */
  readonly cellData: Float32Array;
  readonly cellTextureWidth: number;
  /** RG encodes the cell id as low/high bytes; one texel per atlas pixel. */
  readonly cellIdData: Uint8Array;
  readonly cellIdWidth: number;
  readonly cellIdHeight: number;
}
