/**
 * Generates procedural AudioBuffers using the Web Audio API for zero-asset demo playback.
 */

/** Creates a soothing, seamlessly loopable ambient chord pad. */
export function createAmbientPadBuffer(
  ctx: AudioContext,
  durationSeconds = 6,
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const buffer = ctx.createBuffer(2, numSamples, sampleRate);

  // Frequencies for a warm Cmaj9 chord (C3, G3, B3, D4, E4)
  const freqs = [130.81, 196.0, 246.94, 293.66, 329.63];

  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    const stereoPhase = channel * 0.25;

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      let sample = 0;

      for (let f = 0; f < freqs.length; f++) {
        const freq = freqs[f];
        // Gentle detuned chorus
        const lfo = 1 + 0.003 * Math.sin(2 * Math.PI * (0.2 + f * 0.1) * t);
        const wave = Math.sin(2 * Math.PI * freq * lfo * t + stereoPhase);
        sample += wave * (1 / (f + 1));
      }

      // Smooth loop window (cosine envelope at edges)
      const window =
        Math.sin((Math.PI * i) / numSamples);

      data[i] = sample * 0.08 * Math.sqrt(window);
    }
  }

  return buffer;
}

/** Creates a rhythmic, crisp 3D acoustic pulse/ping loop for spatial localization. */
export function createBeaconLoopBuffer(
  ctx: AudioContext,
  durationSeconds = 1.5,
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const buffer = ctx.createBuffer(1, numSamples, sampleRate);
  const data = buffer.getChannelData(0);

  // Two short harmonic pings within the loop period
  const pingTimes = [0, 0.5];
  const pingFreq = 587.33; // D5

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let sample = 0;

    for (const startTime of pingTimes) {
      const dt = t - startTime;
      if (dt >= 0 && dt < 0.35) {
        // Fast attack, exponential decay
        const env = Math.exp(-dt * 12);
        // Sine with slight octave overtone
        const wave =
          Math.sin(2 * Math.PI * pingFreq * dt) * 0.8 +
          Math.sin(2 * Math.PI * pingFreq * 2 * dt) * 0.2;
        sample += wave * env;
      }
    }

    data[i] = sample * 0.25;
  }

  return buffer;
}

/** Creates an electronic motor/drone hum loop for revolving objects. */
export function createDroneLoopBuffer(
  ctx: AudioContext,
  durationSeconds = 2.0,
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const buffer = ctx.createBuffer(1, numSamples, sampleRate);
  const data = buffer.getChannelData(0);

  const baseFreq = 220.0; // A3

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    // Vibrato / motor rumble
    const lfo = Math.sin(2 * Math.PI * 6.0 * t);
    const freq = baseFreq + lfo * 8.0;

    const wave =
      0.6 * Math.sin(2 * Math.PI * freq * t) +
      0.3 * Math.sin(2 * Math.PI * freq * 2 * t) +
      0.1 * (Math.random() * 2 - 1) * 0.1; // slight electrical hiss

    data[i] = wave * 0.2;
  }

  return buffer;
}

/** Creates a bright chime / impact one-shot sound effect. */
export function createOneShotPingBuffer(
  ctx: AudioContext,
  freq = 880,
  durationSeconds = 0.8,
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const buffer = ctx.createBuffer(1, numSamples, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-t * 6);
    const wave =
      Math.sin(2 * Math.PI * freq * t) * 0.7 +
      Math.sin(2 * Math.PI * (freq * 1.5) * t) * 0.3;

    data[i] = wave * env * 0.4;
  }

  return buffer;
}
