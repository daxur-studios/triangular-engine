import type { TestCaseRecording, TestRecordingArtifact, TestRecordingCapture, TestRecordingReference } from './test-contracts';

/** A single diagnostic clip is capped at 1 MiB. */
export const MAX_TEST_RECORDING_BYTES = 1024 * 1024;
/** Clips from one run together are capped at 5 MiB. */
export const MAX_RUN_TEST_RECORDING_BYTES = 5 * 1024 * 1024;
/** A test case cannot keep a clip longer than 15 seconds. */
export const MAX_TEST_RECORDING_DURATION_MS = 15_000;
/** Recorder finalization is bounded separately from the case's measurement timeout. */
export const TEST_RECORDING_STOP_TIMEOUT_MS = 5_000;

export interface TestMediaRecorderOptions {
  readonly width: number;
  readonly height: number;
  readonly videoBitsPerSecond?: number;
  readonly audioBitsPerSecond?: number;
  readonly mimeTypes?: readonly string[];
}

/**
 * Starts a browser MediaRecorder for a host-composed stream. The returned handle finalizes one playable Blob and stops
 * every supplied track when disposed; the adapter remains responsible for releasing any canvas/audio nodes it created.
 */
export function createTestMediaRecorderCapture(stream: MediaStream, options: TestMediaRecorderOptions): TestRecordingCapture {
  if (typeof MediaRecorder === 'undefined') throw new Error('MediaRecorder is unavailable in this browser');
  const hasAudio = stream.getAudioTracks().length > 0;
  const settings = {
    videoBitsPerSecond: options.videoBitsPerSecond ?? 450_000,
    ...(hasAudio ? { audioBitsPerSecond: options.audioBitsPerSecond ?? 32_000 } : {}),
  };
  const candidates = options.mimeTypes ?? [
    'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4',
  ];
  let recorder: MediaRecorder | undefined;
  let lastError: unknown;
  for (const mimeType of candidates) {
    try {
      if (!MediaRecorder.isTypeSupported(mimeType)) continue;
      recorder = new MediaRecorder(stream, { ...settings, mimeType });
      break;
    } catch (error) { lastError = error; }
  }
  if (!recorder) {
    try { recorder = new MediaRecorder(stream, settings); }
    catch (error) { throw new Error(`Could not start MediaRecorder: ${error instanceof Error ? error.message : String(lastError ?? error)}`); }
  }

  const chunks: Blob[] = [];
  recorder.addEventListener('dataavailable', (event) => { if (event.data.size) chunks.push(event.data); });
  const startedAt = performance.now();
  recorder.start();
  let stopped: Promise<TestRecordingArtifact> | undefined;
  let disposed = false;
  return {
    stop: () => {
      if (stopped) return stopped;
      stopped = new Promise((resolve, reject) => {
        if (recorder!.state === 'inactive') { reject(new Error('MediaRecorder stopped before it could produce a clip')); return; }
        const onError = (event: Event) => {
          cleanup();
          reject((event as Event & { error?: DOMException }).error ?? new Error('MediaRecorder failed'));
        };
        const onStop = () => {
          cleanup();
          const mimeType = recorder!.mimeType || chunks[0]?.type || 'video/webm';
          resolve({ blob: new Blob(chunks, { type: mimeType }), mimeType, durationMs: performance.now() - startedAt,
            width: options.width, height: options.height, audio: hasAudio });
        };
        const cleanup = () => {
          recorder!.removeEventListener('error', onError);
          recorder!.removeEventListener('stop', onStop);
        };
        recorder!.addEventListener('error', onError, { once: true });
        recorder!.addEventListener('stop', onStop, { once: true });
        try { recorder!.stop(); } catch (error) { cleanup(); reject(error); }
      });
      return stopped;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (recorder!.state !== 'inactive') {
        try { recorder!.stop(); } catch { /* tracks still stop below */ }
      }
      for (const track of stream.getTracks()) track.stop();
    },
  };
}

const VIDEO_TYPES = new Set(['video/webm', 'video/mp4']);

export interface KeptTestRecording {
  readonly recording?: TestRecordingArtifact;
  readonly reference?: TestRecordingReference;
  readonly bytes: number;
  readonly notes: readonly string[];
}

/** Applies case/run budgets and metadata checks without failing the functional test. */
export function keepTestRecording(recording: TestRecordingArtifact, usedBytes = 0): KeptTestRecording {
  const notes: string[] = [];
  const mediaType = recording.mimeType.split(';', 1)[0].trim().toLowerCase();
  if (!(recording.blob instanceof Blob) || recording.blob.size === 0) notes.push('Recording dropped: empty or invalid video');
  else if (!VIDEO_TYPES.has(mediaType)) notes.push(`Recording dropped: unsupported type ${mediaType || 'unknown'}`);
  else if (!Number.isInteger(recording.width) || recording.width < 1 || recording.width > 4096 ||
      !Number.isInteger(recording.height) || recording.height < 1 || recording.height > 4096) notes.push('Recording dropped: invalid dimensions');
  else if (!Number.isFinite(recording.durationMs) || recording.durationMs <= 0 || recording.durationMs > MAX_TEST_RECORDING_DURATION_MS) {
    notes.push(`Recording dropped: duration is over ${MAX_TEST_RECORDING_DURATION_MS / 1000} s or invalid`);
  } else if (recording.blob.size > MAX_TEST_RECORDING_BYTES) {
    notes.push(`Recording dropped: ${Math.round(recording.blob.size / 1024)} KB is over ${MAX_TEST_RECORDING_BYTES / 1024} KB`);
  } else if (usedBytes + recording.blob.size > MAX_RUN_TEST_RECORDING_BYTES) {
    notes.push(`Recording dropped: the run's ${MAX_RUN_TEST_RECORDING_BYTES / 1024 / 1024} MB video budget is used up`);
  } else {
    const reference: TestRecordingReference = {
      mimeType: recording.mimeType,
      bytes: recording.blob.size,
      durationMs: recording.durationMs,
      width: recording.width,
      height: recording.height,
      audio: recording.audio,
    };
    return { recording, reference, bytes: recording.blob.size, notes };
  }
  return { bytes: 0, notes };
}

export interface TestRecordingUpload {
  readonly case: string;
  readonly repetition: number;
  readonly index: number;
  readonly mimeType: string;
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
  readonly audio: boolean;
  readonly data: string;
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

/** Video sidecars travel in the bounded dev-only result POST, separate from the JSON retained on disk. */
export async function encodeTestRecordingUploads(entries: readonly TestCaseRecording[]): Promise<TestRecordingUpload[]> {
  const out: TestRecordingUpload[] = [];
  for (const entry of entries) {
    const recording = entry.recording;
    out.push({
      case: entry.scenarioId,
      repetition: entry.repetition,
      index: 0,
      mimeType: recording.mimeType,
      durationMs: recording.durationMs,
      width: recording.width,
      height: recording.height,
      audio: recording.audio,
      data: await toBase64(recording.blob),
    });
  }
  return out;
}
