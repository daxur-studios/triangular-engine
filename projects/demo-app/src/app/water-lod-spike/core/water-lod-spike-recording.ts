import { createTestMediaRecorderCapture, type TestRecordingCapture } from 'triangular-engine/testing';

const RECORDING_WIDTH = 640;
const RECORDING_HEIGHT = 360;
const RECORDING_FPS = 24;
/** Water is busy texture, so the clip needs more than the testing entry's default to stay readable under the 1 MiB clip limit. */
const RECORDING_VIDEO_BITRATE = 900_000;

/**
 * A bounded recording of the spike's canvas for a case's `recording` hook: the canvas is copied into a fixed-size 2D canvas (aspect
 * preserved) on every animation frame and that canvas's stream is recorded, so the clip's size does not depend on the window.
 * The copy happens in an animation-frame callback, after the engine's own render for the frame. `label`, when given, is read on every
 * copy and written in the top-left corner, so a clip that changes the quality says which tier each part shows.
 */
export function createWaterLodSpikeRecording(source: HTMLCanvasElement, label?: () => string): TestRecordingCapture {
  if (!source.width || !source.height) throw new Error('The water canvas has no rendered frames');
  const scaled = document.createElement('canvas');
  scaled.width = RECORDING_WIDTH;
  scaled.height = RECORDING_HEIGHT;
  const paint = scaled.getContext('2d');
  if (!paint) throw new Error('Could not create the bounded recording canvas');

  let released = false;
  let animationFrame = 0;
  let lastFrameAt = -Infinity;
  const draw = (now: number) => {
    if (now - lastFrameAt < 1000 / RECORDING_FPS) return;
    const scale = Math.min(RECORDING_WIDTH / source.width, RECORDING_HEIGHT / source.height);
    const width = source.width * scale;
    const height = source.height * scale;
    paint.fillStyle = '#05080c';
    paint.fillRect(0, 0, RECORDING_WIDTH, RECORDING_HEIGHT);
    paint.drawImage(source, (RECORDING_WIDTH - width) / 2, (RECORDING_HEIGHT - height) / 2, width, height);
    const text = label?.();
    if (text) {
      paint.font = 'bold 16px sans-serif';
      paint.fillStyle = 'rgba(0, 0, 0, 0.55)';
      paint.fillRect(6, 6, paint.measureText(text).width + 12, 24);
      paint.fillStyle = '#ffffff';
      paint.fillText(text, 12, 24);
    }
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
    stop: () => recorder.stop(),
    dispose: () => {
      if (released) return;
      released = true;
      cancelAnimationFrame(animationFrame);
      recorder.dispose();
      scaled.width = 0;
      scaled.height = 0;
    },
  };
}
