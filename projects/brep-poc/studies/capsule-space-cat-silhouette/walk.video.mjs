import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defineVideo } from '@daxur-studios/stop-motion-ui';
import { kokoroNarration } from '../../../../tools/kokoro-narration.mjs';

/**
 * The walking A/B: two identical cats, baked bone-driven legs on the left and
 * the stock rubber hose on the right. Run with
 * `npx --no-install stop-motion-ui run projects/brep-poc/studies/capsule-space-cat-silhouette/walk.video.mjs --out artifacts/videos/space-cat-legs --codec h264`.
 */
export default defineVideo({
  audioProvider: kokoroNarration(),
  viewport: { width: 1280, height: 720 },
  captureFps: 30,
  // Headless Chromium still gets the real GPU through ANGLE. The CDP screencast
  // tops out near 20 fps either way, so encode at 20 (see the README).
  browser: { args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] },
  segments: [
    {
      id: 'pair',
      caption: 'Baked leg (left) · hose leg (right)',
      narration: 'Two identical cats. Left, the baked leg on three bones. Right, the old rubber hose.',
    },
    {
      id: 'walk',
      caption: 'Goofy walk',
      narration: 'Same walk, same body. The baked knee bends, and the bevelled paw stays whole.',
    },
    {
      id: 'run',
      caption: 'Bound run',
      narration: 'At a bound, the bend spreads along the leg instead of kinking at one point.',
    },
    {
      id: 'settle',
      caption: 'Back to idle',
      narration: 'Back to idle. Same bevel, same silhouette.',
    },
  ],
  async ready(page) {
    await page.goto(pathToFileURL(resolve('artifacts/brep-space-cat-silhouette/walk.html')).href);
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, {
      timeout: 60000,
    });
    const failure = await page.evaluate(() => document.documentElement.dataset.error);
    if (failure) throw new Error(failure);
  },
  async run({ page, video }) {
    await video.segment('pair', async () => {
      await video.hold(4000);
    });
    await video.segment('walk', async () => {
      await page.evaluate(() => window.__walk.setGait('goofy_walk'));
      await video.hold(6000);
    });
    await video.segment('run', async () => {
      await page.evaluate(() => window.__walk.setGait('bound_run'));
      await video.hold(4500);
    });
    await video.segment('settle', async () => {
      await page.evaluate(() => window.__walk.setGait('idle'));
      await video.hold(3500);
    });
  },
});
