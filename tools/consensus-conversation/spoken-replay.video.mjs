import { defineVideo } from '@daxur-studios/stop-motion-ui';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const exec = promisify(execFile);
const transcript = JSON.parse(readFileSync('artifacts/consensus-conversation/mixed-live-2.json', 'utf8'));
const excerpts = [
  transcript.turns[0].speech.split(' For example:')[0],
  transcript.turns[1].speech.split('\n\n')[0],
];
const tracks = new Map();
const fps = 25;
const daxur = path.join(process.env.APPDATA, 'npm/node_modules/cli/bin/daxur.cjs');

// The provider prepares local speech and its amplitude envelope before capture.
const audioProvider = {
  id: 'local-kokoro-envelope', version: '1', options: { run: Date.now() },
  async synthesize({ text, outputPath, signal }) {
    const index = excerpts.indexOf(text);
    if (index < 0) throw new Error('Unexpected narration');
    const voice = index === 0 ? 'am_adam' : 'af_heart';
    await exec(process.execPath, [daxur, 'tts', '--engine', 'kokoro', '--voice', voice, '--out', outputPath, text], { signal, timeout: 180000 });
    const { stdout } = await exec('ffmpeg', ['-v', 'error', '-i', outputPath, '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], { encoding: 'buffer', maxBuffer: 16000000, signal });
    const sampleCount = 16000 / fps;
    const envelope = [];
    for (let start = 0; start < stdout.length / 2; start += sampleCount) {
      let sum = 0, count = 0;
      for (let i = start; i < Math.min(start + sampleCount, stdout.length / 2); i++) {
        const s = stdout.readInt16LE(i * 2) / 32768;
        sum += s * s; count++;
      }
      envelope.push(Math.min(1, Math.sqrt(sum / count) * 5));
    }
    tracks.set(text, envelope);
    return outputPath;
  },
};

export default defineVideo({
  baseURL: 'http://triangular-demo.localhost:4200',
  viewport: { width: 1440, height: 900 },
  browser: { channel: 'chrome', args: ['--enable-unsafe-webgpu', '--use-angle=d3d11'] },
  pointer: { x: 1420, y: 880 },
  audioProvider,
  segments: [
    { id: 'setup1' },
    { id: 'luna', caption: 'Luna — excerpt from its opening turn', narration: excerpts[0] },
    { id: 'setup2' },
    { id: 'haiku', caption: 'Haiku — excerpt from its opening turn', narration: excerpts[1] },
  ],
  async ready(page) {
    await page.goto('/consensus-debrief?replay=1');
    await page.locator('input[type=file]').setInputFiles(path.resolve('artifacts/consensus-conversation/mixed-live-2.json'));
    await page.getByText('Turn 0 / 4').waitFor();
    if (tracks.size !== 2) throw new Error('Speech envelopes were not prepared');
  },
  async run({ page, video }) {
    for (let i = 0; i < 2; i++) {
      await video.segment(`setup${i + 1}`, async () => {
        await video.click(page.getByRole('button', { name: 'Next', exact: true }));
      });
      await video.segment(i === 0 ? 'luna' : 'haiku', async () => {
        await page.evaluate(({ id, to, env, fps, text }) => window.__debrief.speak(id, to, env, fps, text), {
          id: transcript.turns[i].participant, to: transcript.turns[1 - i].participant,
          env: tracks.get(excerpts[i]), fps, text: excerpts[i],
        });
      });
    }
  },
});
