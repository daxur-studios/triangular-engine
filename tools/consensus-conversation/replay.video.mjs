import { defineVideo } from '@daxur-studios/stop-motion-ui';
import path from 'node:path';

// Records the local, bounded mixed-provider test; no provider calls are made.
export default defineVideo({
  baseURL: 'http://triangular-demo.localhost:4200',
  viewport: { width: 1440, height: 900 },
  browser: { channel: 'chrome', args: ['--enable-unsafe-webgpu', '--use-angle=d3d11'] },
  narration: 'off',
  segments: [
    { id: 'intro', caption: 'A saved Codex Luna and Claude Haiku conversation' },
    { id: 'first', caption: 'Luna gives its opening view' },
    { id: 'second', caption: 'Haiku gives its opening view' },
    { id: 'third', caption: 'Luna responds after hearing Haiku' },
    { id: 'fourth', caption: 'Haiku responds; agreement affects distance' },
  ],
  async ready(page) {
    await page.goto('/consensus-debrief?replay=1');
    await page.locator('input[type=file]').setInputFiles(path.resolve('artifacts/consensus-conversation/mixed-live-2.json'));
    await page.getByText('Turn 0 / 4').waitFor();
  },
  async run({ page, video }) {
    await video.segment('intro', async () => { await video.hold(2500); });
    for (const id of ['first', 'second', 'third', 'fourth']) {
      await video.segment(id, async () => {
        await video.click(page.getByRole('button', { name: 'Next', exact: true }));
        await video.hold(5000);
      });
    }
    await page.getByText('Turn 4 / 4').waitFor();
  },
});
