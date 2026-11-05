import {
  createTestFrameLog, createTestMediaRecorderCapture, drawFrameBurnIn, type TestFrameSample, type TestRecordingCapture,
} from 'triangular-engine/testing';

const RECORDING_WIDTH = 640;
const RECORDING_HEIGHT = 360;
const RECORDING_FPS = 24;
/** Water is busy texture, so the clip needs more than the testing entry's default to stay readable under the 1 MiB clip limit. */
const RECORDING_VIDEO_BITRATE = 900_000;

/** What a clip shows and what its per-frame sidecar records. Every function is read on each copied frame. */
export interface WaterLodSpikeRecordingOptions {
  /** The shot (the test case) this clip shows. Printed on every frame and stored in the sidecar. */
  readonly shot: string;
  /** Printed in the top-left corner, for example the quality tier, so a clip that changes quality says which tier each part shows. */
  readonly label?: () => string;
  /** The engine clock, camera and host state for the frame's sidecar row. */
  readonly sample?: () => TestFrameSample | undefined;
}

/**
 * A bounded recording of the spike's canvas for a case's `recording` hook: the canvas is copied into a fixed-size 2D canvas (aspect
 * preserved) on every animation frame and that canvas's stream is recorded, so the clip's size does not depend on the window.
 * The copy happens in an animation-frame callback, after the engine's own render for the frame. Each copied frame carries a
 * burned-in frame number (see `drawFrameBurnIn`) and a row in the sidecar that `stop()` returns with the clip.
 */
export function createWaterLodSpikeRecording(source: HTMLCanvasElement, options: WaterLodSpikeRecordingOptions): TestRecordingCapture {
  if (!source.width || !source.height) throw new Error('The water canvas has no rendered frames');
  const scaled = document.createElement('canvas');
  scaled.width = RECORDING_WIDTH;
  scaled.height = RECORDING_HEIGHT;
  const paint = scaled.getContext('2d');
  if (!paint) throw new Error('Could not create the bounded recording canvas');

  const log = createTestFrameLog({ shot: options.shot, fps: RECORDING_FPS });
  const startedAt = performance.now();
  let released = false;
  let frozen = false;
  let animationFrame = 0;
  let lastFrameAt = -Infinity;
  const sampleFrame = (): TestFrameSample | undefined => {
    try { return options.sample?.(); } catch { return undefined; }
  };
  const draw = (now: number) => {
    if (frozen || now - lastFrameAt < 1000 / RECORDING_FPS) return;
    const scale = Math.min(RECORDING_WIDTH / source.width, RECORDING_HEIGHT / source.height);
    const width = source.width * scale;
    const height = source.height * scale;
    paint.fillStyle = '#05080c';
    paint.fillRect(0, 0, RECORDING_WIDTH, RECORDING_HEIGHT);
    paint.drawImage(source, (RECORDING_WIDTH - width) / 2, (RECORDING_HEIGHT - height) / 2, width, height);
    const text = options.label?.();
    if (text) {
      paint.font = 'bold 16px sans-serif';
      paint.fillStyle = 'rgba(0, 0, 0, 0.55)';
      paint.fillRect(6, 6, paint.measureText(text).width + 12, 24);
      paint.fillStyle = '#ffffff';
      paint.fillText(text, 12, 24);
    }
    // performance.now() is monotonic; the animation-frame timestamp can lag it, which the frame log would reject.
    const row = log.record(performance.now() - startedAt, sampleFrame());
    if (row) drawFrameBurnIn(paint, row.frame, { shot: options.shot, width: RECORDING_WIDTH, height: RECORDING_HEIGHT });
    lastFrameAt = now;
  };

  draw(performance.now());
  const stream = scaled.captureStream(RECORDING_FPS);
  let recorder: TestRecordingCapture;
  try {
    recorder = createTestMediaRecorderCapture(stream, { width: RECORDING_WIDTH, height: RECORDING_HEIGHT, videoBitsPerSecond: RECORDING_VIDEO_BITRATE });
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    throw error;
  }
  const tick = (now: number) => {
    if (released) return;
    draw(now);
    animationFrame = requestAnimationFrame(tick);
  };
  animationFrame = requestAnimationFrame(tick);
  return {
    stop: async () => {
      // The sidecar is frozen with the clip: frames copied after this point are not in the clip and must not be listed.
      frozen = true;
      cancelAnimationFrame(animationFrame);
      const frames = log.sidecar();
      const artifact = await recorder.stop();
      return { ...artifact, frames };
    },
    dispose: () => {
      if (released) return;
      released = true;
      frozen = true;
      cancelAnimationFrame(animationFrame);
      recorder.dispose();
      scaled.width = 0;
      scaled.height = 0;
    },
  };
}
