import { createTestFrameLog, MAX_TEST_FRAME_SIDECAR_ROWS, TEST_FRAME_SIDECAR_SCHEMA, type TestFrameVector } from './test-frame-sidecar';

describe('per-frame sidecar log', () => {
  it('numbers frames from 0 in drawing order and keeps only the fields the host supplied', () => {
    const log = createTestFrameLog({ shot: 'shoreline', fps: 24 });
    const first = log.record(0, { frameTimeMs: 1000, camera: { position: [1, 2, 3], target: [0, 0, 0] }, state: { quality: 'High', lod: 2, foam: true } });
    const second = log.record(41.5);
    expect(first).toEqual({ frame: 0, clipTimeMs: 0, frameTimeMs: 1000, camera: { position: [1, 2, 3], target: [0, 0, 0] }, state: { quality: 'High', lod: 2, foam: true } });
    expect(second).toEqual({ frame: 1, clipTimeMs: 41.5 });
    expect(log.sidecar()).toEqual({ schemaVersion: TEST_FRAME_SIDECAR_SCHEMA, shot: 'shoreline', fps: 24, truncated: false, frames: [first!, second!] });
  });

  it('returns a copy, so rows recorded later do not change an earlier sidecar', () => {
    const log = createTestFrameLog({ shot: 'a', fps: 24 });
    log.record(0);
    const earlier = log.sidecar();
    log.record(10);
    expect(earlier.frames.length).toBe(1);
    expect(log.sidecar().frames.length).toBe(2);
  });

  it('refuses clip times that are not finite or go back, so a row always resolves to a later or equal time', () => {
    const log = createTestFrameLog({ shot: 'a', fps: 24 });
    log.record(20);
    expect(() => log.record(Number.NaN)).toThrowError(RangeError);
    expect(() => log.record(19)).toThrowError(RangeError);
    expect(log.sidecar().frames.length).toBe(1);
  });

  it('refuses camera vectors that are not three finite numbers, and frame times that are not finite', () => {
    const log = createTestFrameLog({ shot: 'a', fps: 24 });
    // A two-element vector is outside the type; the runtime guard still has to refuse it when a host gets it wrong.
    expect(() => log.record(0, { camera: { position: [1, 2] as unknown as TestFrameVector, target: [0, 0, 0] } })).toThrowError(RangeError);
    expect(() => log.record(0, { camera: { position: [1, Number.POSITIVE_INFINITY, 3], target: [0, 0, 0] } })).toThrowError(RangeError);
    expect(() => log.record(0, { frameTimeMs: Number.NaN })).toThrowError(RangeError);
  });

  it('keeps host state to short names and short values, with at most sixteen values per row', () => {
    const log = createTestFrameLog({ shot: 'a', fps: 24 });
    expect(() => log.record(0, { state: { 'bad name': 1 } })).toThrowError(RangeError);
    expect(() => log.record(0, { state: { quality: 'x'.repeat(65) } })).toThrowError(RangeError);
    expect(() => log.record(0, { state: { value: Number.NaN } })).toThrowError(RangeError);
    const many: Record<string, number> = {};
    for (let i = 0; i < 17; i++) many[`k${i}`] = i;
    expect(() => log.record(0, { state: many })).toThrowError(RangeError);
    expect(log.sidecar().frames.length).toBe(0);
  });

  it('checks the shot name and fps when the log starts', () => {
    expect(() => createTestFrameLog({ shot: '', fps: 24 })).toThrowError(RangeError);
    expect(() => createTestFrameLog({ shot: 'x'.repeat(65), fps: 24 })).toThrowError(RangeError);
    expect(() => createTestFrameLog({ shot: 'a', fps: 0 })).toThrowError(RangeError);
    expect(() => createTestFrameLog({ shot: 'a', fps: 121 })).toThrowError(RangeError);
  });

  it('stops at the row limit and says so, instead of growing without bound', () => {
    const log = createTestFrameLog({ shot: 'long', fps: 24 });
    for (let i = 0; i < MAX_TEST_FRAME_SIDECAR_ROWS; i++) expect(log.record(i)).toBeDefined();
    expect(log.record(MAX_TEST_FRAME_SIDECAR_ROWS)).toBeUndefined();
    const sidecar = log.sidecar();
    expect(sidecar.frames.length).toBe(MAX_TEST_FRAME_SIDECAR_ROWS);
    expect(sidecar.truncated).toBeTrue();
  });
});
