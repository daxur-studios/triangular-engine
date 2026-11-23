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
      id: 'idle', caption: 'Fused rear hip on the left',
      narration: 'On the left, the near rear leg blends into the rump. On the right, it is a separate piece.',
    },
    {
      id: 'walk', caption: 'Same goofy walk on both cats',
      narration: 'Both legs use the same three bones. Watch how the rounded join bends as the rear paw reaches forward and pushes back.',
    },
  ],
  async ready(page) {
    const url = pathToFileURL(resolve('artifacts/brep-space-cat-silhouette/rear-hip.html'));
    await page.goto(url.href);
    await page.waitForFunction(() => document.documentElement.dataset.ready || document.documentElement.dataset.error);
    const failure = await page.evaluate(() => document.documentElement.dataset.error);
    if (failure) throw new Error(failure);
    await page.evaluate(() => window.__walk.setGait('idle'));
  },
  async run({ page, video }) {
    await video.segment('idle', async () => video.hold(3500));
    await video.segment('walk', async () => {
      await page.evaluate(() => window.__walk.setGait('goofy_walk'));
      await video.hold(7500);
    });
  },
});
