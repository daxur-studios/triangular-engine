import { encodeTestRecordingUploads, keepTestRecording, MAX_RUN_TEST_RECORDING_BYTES, MAX_TEST_RECORDING_BYTES, MAX_TEST_RECORDING_DURATION_MS } from './test-recordings';
import type { TestRecordingArtifact } from './test-contracts';

const recording = (bytes: number, overrides: Partial<TestRecordingArtifact> = {}): TestRecordingArtifact => ({
  blob: new Blob([new Uint8Array(bytes)], { type: 'video/webm' }),
  mimeType: 'video/webm;codecs=vp8,opus',
  durationMs: 1000,
  width: 640,
  height: 360,
  audio: true,
  ...overrides,
});

describe('test recordings', () => {
  it('keeps valid clips with metadata and drops invalid, overlong and oversized clips with a reason', () => {
    const kept = keepTestRecording(recording(16));
    expect(kept.bytes).toBe(16);
    expect(kept.reference).toEqual({ mimeType: 'video/webm;codecs=vp8,opus', bytes: 16, durationMs: 1000, width: 640, height: 360, audio: true });
    expect(keepTestRecording(recording(MAX_TEST_RECORDING_BYTES + 1)).notes.join()).toContain('over 1024 KB');
    expect(keepTestRecording(recording(16, { durationMs: MAX_TEST_RECORDING_DURATION_MS + 1 })).notes.join()).toContain('over 15 s');
    expect(keepTestRecording(recording(16, { mimeType: 'video/quicktime' })).notes.join()).toContain('unsupported type');
    expect(keepTestRecording(recording(16), MAX_RUN_TEST_RECORDING_BYTES - 10).notes.join()).toContain('budget is used up');
  });

  it('encodes sidecars as base64 with case metadata, leaving them out of the result JSON', async () => {
    const clip = recording(4);
    const [upload] = await encodeTestRecordingUploads([{ scenarioId: 'approach', repetition: 2, recording: clip }]);
    expect(upload).toEqual({ case: 'approach', repetition: 2, index: 0, mimeType: clip.mimeType, durationMs: 1000,
      width: 640, height: 360, audio: true, data: 'AAAAAA==' });
  });

  it('keeps a clip with its frame sidecar, reports only the row count in the reference and sends the sidecar with the upload', async () => {
    const frames = { schemaVersion: 1 as const, shot: 'shoreline', fps: 24, truncated: false,
      frames: [{ frame: 0, clipTimeMs: 0, camera: { position: [1, 2, 3] as const, target: [0, 0, 0] as const } }, { frame: 1, clipTimeMs: 42 }] };
    const kept = keepTestRecording(recording(16, { frames }));
    expect(kept.notes).toEqual([]);
    expect(kept.recording?.frames).toBe(frames);
    expect(kept.reference?.frames).toBe(2);
    expect(kept.reference?.sidecar).toBeUndefined();
    const [upload] = await encodeTestRecordingUploads([{ scenarioId: 'shoreline', repetition: 1, recording: kept.recording! }]);
    expect(upload.sidecar).toBe(frames);
  });

  it('drops an oversized or over-long sidecar with a visible note and keeps the clip', () => {
    const big = { schemaVersion: 1 as const, shot: 'a', fps: 24, truncated: false,
      frames: [{ frame: 0, clipTimeMs: 0, state: { note: 'x'.repeat(60) } }] };
    const padded = { ...big, frames: Array.from({ length: 1200 }, (_, i) => ({ frame: i, clipTimeMs: i })) };
    const tooMany = keepTestRecording(recording(16, { frames: padded }));
    expect(tooMany.reference).toBeDefined();
    expect(tooMany.reference?.frames).toBeUndefined();
    expect(tooMany.recording?.frames).toBeUndefined();
    expect(tooMany.notes.join()).toContain('Frame sidecar dropped: 1200 rows is over 600');
    const wide = Object.fromEntries(Array.from({ length: 16 }, (_, k) => [`k${k}`, 'y'.repeat(60)]));
    const heavy = { ...big, frames: Array.from({ length: 80 }, (_, i) => ({ frame: i, clipTimeMs: i, state: wide })) };
    const tooBig = keepTestRecording(recording(16, { frames: heavy }));
    expect(tooBig.reference).toBeDefined();
    expect(tooBig.notes.join()).toMatch(/Frame sidecar dropped: \d+ KB is over 64 KB/);
  });
});
