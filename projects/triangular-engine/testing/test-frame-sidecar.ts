/** Version of the per-frame sidecar written beside a recording. */
export const TEST_FRAME_SIDECAR_SCHEMA = 1;
/** A sidecar keeps at most this many rows (one per drawn frame). Further frames are not logged and the sidecar says so. */
export const MAX_TEST_FRAME_SIDECAR_ROWS = 600;
/** A sidecar travels as bounded JSON with its clip and is stored beside it; over this size it is dropped with a reason. */
export const MAX_TEST_FRAME_SIDECAR_BYTES = 64 * 1024;
/** Host state keys per row, and the length of each key and string value. Enforced by the producer and by the receiver. */
export const MAX_TEST_FRAME_STATE_KEYS = 16;
export const MAX_TEST_FRAME_STATE_KEY_LENGTH = 32;
export const MAX_TEST_FRAME_STATE_STRING_LENGTH = 64;
/** Shot names are short identifiers printed on every frame. */
export const MAX_TEST_FRAME_SHOT_LENGTH = 64;

/** A position or target in the scene's own units. */
export type TestFrameVector = readonly [number, number, number];

/** The camera a frame was drawn with. */
export interface TestFrameCamera {
  readonly position: TestFrameVector;
  readonly target: TestFrameVector;
}

/** A host-supplied value such as a quality tier, LOD level or toggle. */
export type TestFrameStateValue = string | number | boolean;

/** One row of the sidecar: what the frame with this number shows, and when it was drawn. */
export interface TestFrameRow {
  /** The burned-in frame number. Rows are numbered from 0 in drawing order, so `frames[n].frame === n`. */
  readonly frame: number;
  /** Milliseconds from the start of the recording to the copy of this frame into the clip canvas. */
  readonly clipTimeMs: number;
  /** The host's clock (the engine's elapsed time, in milliseconds) when the frame was drawn, when the host supplied it. */
  readonly frameTimeMs?: number;
  readonly camera?: TestFrameCamera;
  readonly state?: Readonly<Record<string, TestFrameStateValue>>;
}

/** The per-frame sidecar of one clip. `truncated` is true when frames were drawn after the row limit was reached. */
export interface TestFrameSidecar {
  readonly schemaVersion: typeof TEST_FRAME_SIDECAR_SCHEMA;
  readonly shot: string;
  /** The nominal copy rate the clip was drawn at. Clip times are the measured ones, not `frame / fps`. */
  readonly fps: number;
  readonly truncated: boolean;
  readonly frames: readonly TestFrameRow[];
}

/** What the host supplies for one drawn frame. Every field is optional; missing values are left out of the row. */
export interface TestFrameSample {
  readonly frameTimeMs?: number;
  readonly camera?: TestFrameCamera;
  readonly state?: Readonly<Record<string, TestFrameStateValue>>;
}

/** Records drawn frames in order and returns the sidecar. Create one per clip with {@link createTestFrameLog}. */
export interface TestFrameLog {
  /**
   * Records the next drawn frame at `clipTimeMs` (non-decreasing) and returns its row, numbered in order. Returns `undefined`
   * once the row limit is reached; the sidecar then reports `truncated`.
   */
  record(clipTimeMs: number, sample?: TestFrameSample): TestFrameRow | undefined;
  /** A copy of the rows so far. Later records do not change it. */
  sidecar(): TestFrameSidecar;
}

/**
 * Starts a per-frame sidecar for one clip. `shot` names the shot the clip shows (printed on each burned-in frame) and
 * `fps` is the nominal copy rate. Throws a `RangeError` for values outside the contract.
 */
export function createTestFrameLog(options: { readonly shot: string; readonly fps: number }): TestFrameLog {
  const shot = options.shot;
  if (typeof shot !== 'string' || shot.length < 1 || shot.length > MAX_TEST_FRAME_SHOT_LENGTH) throw new RangeError('A shot name is 1 to 64 characters');
  if (!Number.isFinite(options.fps) || options.fps <= 0 || options.fps > 120) throw new RangeError('The sidecar fps must be above 0 and at most 120');
  const rows: TestFrameRow[] = [];
  let lastClipTime = 0;
  let truncated = false;
  return {
    record(clipTimeMs, sample = {}) {
      if (!Number.isFinite(clipTimeMs) || clipTimeMs < lastClipTime) throw new RangeError('A frame clip time must be finite and not earlier than the previous frame');
      if (rows.length >= MAX_TEST_FRAME_SIDECAR_ROWS) { truncated = true; return undefined; }
      const row = normalizeRow(rows.length, clipTimeMs, sample);
      lastClipTime = clipTimeMs;
      rows.push(row);
      return row;
    },
    sidecar: () => ({ schemaVersion: TEST_FRAME_SIDECAR_SCHEMA, shot, fps: options.fps, truncated, frames: rows.slice() }),
  };
}

function normalizeRow(frame: number, clipTimeMs: number, sample: TestFrameSample): TestFrameRow {
  if (sample.frameTimeMs !== undefined && !Number.isFinite(sample.frameTimeMs)) throw new RangeError('A frame time must be finite');
  return {
    frame,
    clipTimeMs,
    ...(sample.frameTimeMs !== undefined ? { frameTimeMs: sample.frameTimeMs } : {}),
    ...(sample.camera ? { camera: normalizeCamera(sample.camera) } : {}),
    ...(sample.state ? { state: normalizeState(sample.state) } : {}),
  };
}

function normalizeCamera(camera: TestFrameCamera): TestFrameCamera {
  return { position: normalizeVector(camera.position, 'camera position'), target: normalizeVector(camera.target, 'camera target') };
}

function normalizeVector(value: TestFrameVector, name: string): TestFrameVector {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((n) => Number.isFinite(n))) throw new RangeError(`The ${name} must be three finite numbers`);
  return [value[0], value[1], value[2]];
}

function normalizeState(state: Readonly<Record<string, TestFrameStateValue>>): Record<string, TestFrameStateValue> {
  const keys = Object.keys(state);
  if (keys.length > MAX_TEST_FRAME_STATE_KEYS) throw new RangeError(`A frame keeps at most ${MAX_TEST_FRAME_STATE_KEYS} state values`);
  const out: Record<string, TestFrameStateValue> = {};
  for (const key of keys) {
    const value = state[key];
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,31}$/.test(key) || key.length > MAX_TEST_FRAME_STATE_KEY_LENGTH) throw new RangeError(`Invalid state name: ${key}`);
    if (typeof value === 'string') {
      if (value.length > MAX_TEST_FRAME_STATE_STRING_LENGTH) throw new RangeError(`State ${key} is longer than ${MAX_TEST_FRAME_STATE_STRING_LENGTH} characters`);
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new RangeError(`State ${key} must be finite`);
    } else if (typeof value !== 'boolean') {
      throw new RangeError(`State ${key} must be a string, number or boolean`);
    }
    out[key] = value;
  }
  return out;
}
