import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defineVideo } from '@daxur-studios/stop-motion-ui';
import { kokoroNarration } from '../../../../tools/kokoro-narration.mjs';

export default defineVideo({
  audioProvider: kokoroNarration(),
  viewport: { width: 1280, height: 720 },
  captureFps: 30,
  browser: { args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] },
  segments: [
    {
      id: 'idle', caption: 'Joined legs and tail on the left',
      narration: 'The new cat is on the left. The legs end in small rounded tips, and the shoulders and tail blend into the body.',
    },
    {
      id: 'walk', caption: 'Both cats on the same goofy walk',
      narration: 'Watch the front legs swing and the tail sway. The cat on the right is the earlier rear hip study.',
    },
  ],
  async ready(page) {
    await page.goto(pathToFileURL(resolve('artifacts/brep-space-cat-silhouette/joined-cat.html')).href);
    await page.waitForFunction(() => document.documentElement.dataset.ready || document.documentElement.dataset.error);
    const failure = await page.evaluate(() => document.documentElement.dataset.error);
    if (failure) throw new Error(failure);
    await page.evaluate(() => window.__walk.setGait('idle'));
  },
  async run({ page, video }) {
    await video.segment('idle', async () => video.hold(4200));
    await video.segment('walk', async () => {
      await page.evaluate(() => window.__walk.setGait('goofy_walk'));
      await video.hold(7200);
    });
  },
});
