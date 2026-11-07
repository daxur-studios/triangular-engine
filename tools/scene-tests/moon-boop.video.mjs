import { defineVideo, daxurSpeech } from '@daxur-studios/stop-motion-ui';
import path from 'node:path';

// App-owned recipe. Recording, cursor pacing, speech and retiming live in the
// installed package; no recorder internals or other source checkout imports.
const speechDirectory = process.env.MOON_BOOP_SPEECH_DIR;
const speech = (file, narration) => speechDirectory
  ? { audio: path.resolve(speechDirectory, file) }
  : { narration };

export default defineVideo({
  baseURL: 'http://triangular-demo.localhost:4200',
  viewport: { width: 1440, height: 960 },
  pointer: { x: 1050, y: 400 },
  browser: { channel: 'chrome', args: ['--enable-unsafe-webgpu', '--use-angle=d3d11'] },
  audioProvider: daxurSpeech({ voice: 'Fola' }),
  segments: [
    { id: 'briefing', caption: 'Operation Moon Boop · one human, eighteen cats', ...speech('intro.wav', 'Welcome to Operation Moon Boop. One human will help us stack eighteen cats all the way to the Moon.') },
    { id: 'assign', caption: 'A few clicks. The collector handles the walking.', ...speech('collector.wav', 'We stack the first cats, buy some faster shoes, and send our collector to work. The green box follows our very patient human.') },
    { id: 'kitten-countdown', speed: 3, caption: 'Waiting for six kittens · footage accelerated' },
    { id: 'kitten-arrival', caption: 'Six tiny astronauts. One extremely patient human.', ...speech('kittens.wav', 'Six tiny astronauts have arrived. We can follow the collector while the cats wait for their turn.') },
    { id: 'gathering', speed: 5, caption: 'Gathering and hauling · footage accelerated' },
    { id: 'moon-boop', caption: 'One giant boop for catkind.', ...speech('victory.wav', 'The last few cats complete our tower. One giant boop for catkind.') },
  ],
  async ready(page) {
    await page.goto('/cat-space-program');
    await page.waitForFunction(() => window.moonBoopDemo?.ready() && document.querySelector('scene canvas').height > 400);
    await page.evaluate(() => {
      if (!window.moonBoopDemo.act('reset', 'kittens') || !window.moonBoopDemo.act('pause')) throw new Error('Game setup refused');
    });
  },
  async run({ page, video }) {
    const act = async (action, value) => {
      const ok = await page.evaluate(({ action, value }) => window.moonBoopDemo.act(action, value), { action, value });
      if (!ok) throw new Error(`Game action refused: ${action}`);
    };
    await video.segment('briefing', async () => { await video.hold(5800); });
    await video.segment('assign', async () => {
      await video.click(page.getByRole('button', { name: 'Resume', exact: true }));
      for (let i = 0; i < 3; i++) await video.click(page.getByRole('button', { name: 'Stack one waiting cat' }));
      await video.click(page.getByRole('button', { name: 'Zoomies shoes' }));
      await video.click(page.getByRole('button', { name: 'Start collecting cats', exact: true }));
      await act('select', 'collector');
      await video.click(page.getByRole('button', { name: 'Show focus box', exact: true }));
      await video.hold(2500);
    });
    await video.segment('kitten-countdown', async () => {
      await page.waitForFunction(() => window.moonBoopDemo.read().cats.filter(c => c.source === 'nursery').length >= 6, undefined, { timeout: 90_000 });
    });
    await video.segment('kitten-arrival', async () => {
      await video.click(page.getByRole('button', { name: 'Follow human', exact: true }));
      await video.hold(5200);
      await video.click(page.getByRole('button', { name: 'Overview', exact: true }));
    });
    await video.segment('gathering', async () => {
      await page.waitForFunction(() => window.moonBoopDemo.read().time >= 37, undefined, { timeout: 120_000 });
    });
    await video.segment('moon-boop', async () => {
      while (!(await page.evaluate(() => window.moonBoopDemo.read().won))) {
        const state = await page.evaluate(() => window.moonBoopDemo.read());
        if (!state.cats.some(c => c.place === 'waiting')) throw new Error('No waiting cats for the final tower');
        await video.click(page.getByRole('button', { name: 'Stack one waiting cat' }));
      }
      await video.click(page.getByRole('button', { name: 'Moon cam', exact: true }));
      await act('select', 'tower');
      await video.hold(5800);
      const state = await page.evaluate(() => window.moonBoopDemo.read());
      if (!state.won || state.cats.filter(c => c.place === 'stacked').length !== 18) throw new Error('Expected eighteen-cat Moon victory');
      console.error(`Moon Boop complete: ${JSON.stringify({ won: state.won, time: state.time })}`);
    });
  },
});
