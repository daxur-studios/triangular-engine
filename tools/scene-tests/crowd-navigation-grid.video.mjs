import { defineVideo } from '@daxur-studios/stop-motion-ui';
import { kokoroNarration } from '../kokoro-narration.mjs';

// App-owned narrated walkthrough of the Plan 086 grid-layers demo.
// Run: npx --no-install stop-motion-ui run tools/scene-tests/crowd-navigation-grid.video.mjs --out artifacts/demos --json
const overlay = (name) => (page) => page.getByRole('button', { name, exact: true });

export default defineVideo({
  baseURL: 'http://triangular-demo.localhost:4200',
  viewport: { width: 1440, height: 960 },
  pointer: { x: 900, y: 500 },
  browser: { channel: 'chrome', args: ['--enable-unsafe-webgpu', '--use-angle=d3d11'] },
  audioProvider: kokoroNarration(),
  segments: [
    {
      id: 'intro',
      caption: 'Island crowd navigation · phase 1: grid layers',
      narration:
        'This is the first phase of island crowd navigation. A generated island becomes a navigation grid, one cell per metre, built from simple byte layers that thousands of villagers can share.',
    },
    {
      id: 'slope',
      caption: 'Slope cost: steeper ground costs more, water and cliffs are blocked',
      narration:
        'Slope cost comes from the heightfield. Flat ground is cheap, steeper ground costs more, and water and cliffs are blocked outright.',
    },
    {
      id: 'roads-structures',
      caption: 'Structures block · roads lower the cost',
      narration:
        'Buildings are stamped into a structure layer and block movement. Roads go into their own layer, and lower the cost so agents prefer them.',
    },
    {
      id: 'composed',
      caption: 'Composed cost: one byte per cell the flow fields will read',
      narration:
        'Everything is composed into one cost byte per cell. This is what the sector flow fields will read in the next phases.',
    },
    {
      id: 'clearance',
      caption: 'Clearance: distance to the nearest blocked cell',
      narration:
        'The clearance layer stores the distance to the nearest blocked cell. Villagers need one cell, catapults three, and creatures eight, so one field answers where every unit size can walk.',
    },
    {
      id: 'gate',
      caption: 'Opening a gate only recomputes the cells around it',
      narration:
        'Edits are local. Opening or closing a gate recomputes only a small window around it, in well under a millisecond, and the result matches a full rebuild.',
    },
    {
      id: 'outro',
      caption: 'Next: 64 × 64 sectors with portals per unit size',
      narration:
        'Next come sixty four by sixty four cell sectors, with portals for each unit size, so a villager can route through a gap a creature cannot.',
    },
  ],
  async ready(page) {
    await page.goto('/crowd-navigation-grid');
    await page.waitForFunction(() => {
      const canvas = document.querySelector('scene canvas');
      return !!canvas && canvas.height > 400 && /built in \d+/.test(document.body.innerText);
    }, undefined, { timeout: 60_000 });
    await page.getByRole('button', { name: 'Terrain', exact: true }).click();
  },
  async run({ page, video }) {
    await video.segment('intro', async () => {
      await video.hold(3000);
    });
    await video.segment('slope', async () => {
      await video.click(overlay('Slope cost')(page));
      await video.hold(3500);
    });
    await video.segment('roads-structures', async () => {
      await video.click(overlay('Structure')(page));
      await video.hold(2500);
      await video.click(overlay('Road')(page));
      await video.hold(2500);
    });
    await video.segment('composed', async () => {
      await video.click(overlay('Composed cost')(page));
      await video.hold(3000);
    });
    await video.segment('clearance', async () => {
      await video.click(overlay('Clearance')(page));
      await video.hold(4500);
    });
    await video.segment('gate', async () => {
      await video.click(overlay('Flags')(page));
      await video.hold(1500);
      await video.click(page.getByRole('button', { name: /Open gate/ }));
      await page.getByRole('button', { name: /Close gate/ }).waitFor();
      await video.hold(2500);
      await video.click(page.getByRole('button', { name: /Close gate/ }));
      await page.getByRole('button', { name: /Open gate/ }).waitFor();
      await video.hold(2000);
    });
    await video.segment('outro', async () => {
      await video.click(overlay('Terrain')(page));
      await video.hold(3000);
    });
  },
});
