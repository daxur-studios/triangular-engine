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
});
