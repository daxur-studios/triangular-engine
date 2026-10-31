import type { AudioService, EngineService, OrbitControlsComponent } from 'triangular-engine';
import { createTestMediaRecorderCapture, type TestContext, type TestObservation, type TestRecordingCapture, type TestRunAdapter } from 'triangular-engine/testing';
import type { AudioLabTestSettings } from './audio-lab-tests';

const VIDEO_WIDTH = 960;
const VIDEO_HEIGHT = 540;
const CAPTURE_FPS = 20;

interface AudioBusSnapshot { readonly volume: number; readonly muted: boolean }
export interface AudioLabSnapshot {
  readonly cameraPosition: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly buses: Readonly<Record<'master' | 'ambient' | 'music' | 'sfx', AudioBusSnapshot>>;
}

export interface AudioLabTestPorts {
  readonly engine: EngineService;
  readonly audio: AudioService;
  controls(): OrbitControlsComponent | undefined;
  contextRunning(): boolean;
}

function renderedFrame(engine: EngineService, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    let done = false;
    const subscription = engine.postTick$.subscribe(() => {
      if (done) return;
      done = true;
      signal.removeEventListener('abort', abort);
      subscription.unsubscribe();
      resolve();
    });
    const abort = () => {
      if (done) return;
      done = true;
      subscription.unsubscribe();
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function controlsFor(ports: AudioLabTestPorts) {
  const controls = ports.controls()?.orbitControls();
  if (!controls) throw new Error('The audio-lab orbit camera is not ready');
  return controls;
}

function positionCamera(ports: AudioLabTestPorts, position: readonly [number, number, number], target?: readonly [number, number, number]): void {
  const controls = controlsFor(ports);
  controls.object.position.set(...position);
  if (target) controls.target.set(...target);
  controls.update();
}

function smooth(t: number): number { return t * t * (3 - 2 * t); }

function recordingCapture(ports: AudioLabTestPorts): TestRecordingCapture {
  const source = ports.engine.canvas;
  const listener = ports.audio.getOrCreateListener();
  if (listener.context.state !== 'running') throw new Error('Enable sound before recording the audio-lab test');
  if (!source.width || !source.height) throw new Error('The WebGL canvas has no rendered frames');

  const scaled = document.createElement('canvas');
  scaled.width = VIDEO_WIDTH;
  scaled.height = VIDEO_HEIGHT;
  const paint = scaled.getContext('2d');
  if (!paint) throw new Error('Could not create the 960x540 recording canvas');
  const destination = listener.context.createMediaStreamDestination();
  const captureGain = listener.context.createGain();
  captureGain.gain.value = 2.5;
  const stream = scaled.captureStream(CAPTURE_FPS);
  for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);

  let frame = 0;
  let lastFrameAt = 0;
  let released = false;
  const draw = (now: number) => {
    if (released) return;
    if (now - lastFrameAt >= 1000 / CAPTURE_FPS) {
      const scale = Math.min(VIDEO_WIDTH / source.width, VIDEO_HEIGHT / source.height);
      const width = source.width * scale;
      const height = source.height * scale;
      paint.fillStyle = '#0a0c16';
      paint.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
      paint.drawImage(source, (VIDEO_WIDTH - width) / 2, (VIDEO_HEIGHT - height) / 2, width, height);
      lastFrameAt = now;
    }
    frame = requestAnimationFrame(draw);
  };

  try {
    listener.gain.connect(captureGain);
    captureGain.connect(destination);
    frame = requestAnimationFrame(draw);
    const recorder = createTestMediaRecorderCapture(stream, {
      width: VIDEO_WIDTH,
      height: VIDEO_HEIGHT,
      videoBitsPerSecond: 450_000,
      audioBitsPerSecond: 48_000,
    });
    return {
      stop: () => recorder.stop(),
      dispose: () => {
        if (released) return;
        released = true;
        cancelAnimationFrame(frame);
        recorder.dispose();
        try { listener.gain.disconnect(captureGain); } catch { /* destination may already be disconnected */ }
        captureGain.disconnect();
        destination.disconnect();
        scaled.width = 0;
        scaled.height = 0;
      },
    };
  } catch (error) {
    released = true;
    cancelAnimationFrame(frame);
    for (const track of stream.getTracks()) track.stop();
    try { listener.gain.disconnect(captureGain); } catch { /* ignore partial setup */ }
    captureGain.disconnect();
    destination.disconnect();
    throw error;
  }
}

/** Audio-lab adapter: camera motion drives the real Three.js AudioListener attached to the orbit camera. */
export function createAudioLabTestAdapter(ports: AudioLabTestPorts): TestRunAdapter<AudioLabTestSettings, AudioLabSnapshot> {
  return {
    capture: () => {
      const controls = controlsFor(ports);
      const buses = ['master', 'ambient', 'music', 'sfx'] as const;
      return {
        cameraPosition: controls.object.position.toArray() as [number, number, number],
        target: controls.target.toArray() as [number, number, number],
        buses: Object.fromEntries(buses.map((bus) => [bus, { volume: ports.audio.getBusVolume(bus), muted: ports.audio.isBusMuted(bus) }])) as AudioLabSnapshot['buses'],
      };
    },
    apply: (scenario) => {
      ports.audio.setBusMuted('master', false);
      ports.audio.setBusVolume('master', 1);
      ports.audio.setBusMuted('ambient', false);
      ports.audio.setBusVolume('ambient', 1);
      ports.audio.setBusMuted('music', true);
      ports.audio.setBusMuted('sfx', false);
      ports.audio.setBusVolume('sfx', 1);
      positionCamera(ports, scenario.settings.farPosition, scenario.settings.target);
    },
    ready: async (context) => {
      if (!ports.contextRunning()) throw new Error('Enable sound before running this test');
      await renderedFrame(ports.engine, context.signal);
      if (!ports.engine.canvas.width || !ports.engine.canvas.height) throw new Error('Waiting for the audio-lab scene to render');
    },
    measure: async (scenario, context): Promise<TestObservation> => {
      const { farPosition, nearPosition, target, durationMs } = scenario.settings;
      const startedAt = performance.now();
      let closestZ = farPosition[2];
      let finalZ = farPosition[2];
      while (true) {
        if (context.signal.aborted) throw context.signal.reason;
        const progress = Math.min(1, (performance.now() - startedAt) / durationMs);
        let z: number;
        if (progress < 0.35) z = farPosition[2] + (nearPosition[2] - farPosition[2]) * smooth(progress / 0.35);
        else if (progress < 0.65) z = nearPosition[2];
        else z = nearPosition[2] + (farPosition[2] - nearPosition[2]) * smooth((progress - 0.65) / 0.35);
        finalZ = z;
        closestZ = Math.min(closestZ, z);
        positionCamera(ports, [farPosition[0], farPosition[1], z], target);
        if (progress >= 1) break;
        await renderedFrame(ports.engine, context.signal);
      }
      return {
        metrics: [],
        checks: [
          { name: 'Camera moved closer to the positional beacon', passed: closestZ <= nearPosition[2] + 0.15, detail: `nearest z ${closestZ.toFixed(2)}` },
          { name: 'Camera returned to its starting distance', passed: Math.abs(finalZ - farPosition[2]) <= 0.25, detail: `final z ${finalZ.toFixed(2)}` },
        ],
        details: { closestCameraZ: closestZ, finalCameraZ: finalZ, recordingAudioTrack: true },
      };
    },
    recording: (_scenario, context) => {
      if (context.signal.aborted) throw context.signal.reason;
      return recordingCapture(ports);
    },
    restore: (snapshot) => {
      positionCamera(ports, snapshot.cameraPosition, snapshot.target);
      for (const bus of ['master', 'ambient', 'music', 'sfx'] as const) {
        ports.audio.setBusVolume(bus, snapshot.buses[bus].volume);
        ports.audio.setBusMuted(bus, snapshot.buses[bus].muted);
      }
    },
    environment: () => ({
      'recording.source': 'audio-lab canvas + Three.js AudioListener mix',
      'recording.profile': `up to ${VIDEO_WIDTH}x${VIDEO_HEIGHT}@${CAPTURE_FPS}fps with aspect preserved, requested 450 kb/s video + 48 kb/s audio and 2.5x capture gain`,
    }),
  };
}
