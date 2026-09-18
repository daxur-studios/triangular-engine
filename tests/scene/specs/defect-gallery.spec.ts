import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

type Bridge = {
  focus(request: { target: string; azimuthDeg?: number; elevationDeg?: number }): Promise<unknown>;
  capture(checkpoint?: string): Promise<{ image: string }>;
  diagnostics(): Promise<{ errors: unknown[] }>;
};

async function bridge(page: import('@playwright/test').Page): Promise<Bridge> {
  await page.evaluate(() => {
    if (!(window as Window & { __sceneTest?: Bridge }).__sceneTest) throw new Error('scene test adapter is not enabled');
  });
  return {
    focus: (request) => page.evaluate((value) => (window as Window & { __sceneTest: Bridge }).__sceneTest.focus(value), request),
    capture: (checkpoint) => page.evaluate((value) => (window as Window & { __sceneTest: Bridge }).__sceneTest.capture(value), checkpoint),
    diagnostics: () => page.evaluate(() => (window as Window & { __sceneTest: Bridge }).__sceneTest.diagnostics()),
  };
}

const DEFECT_CASES = [
  { id: 'z-fighting', target: 'defect-target' },
  { id: 'inverted-normals', target: 'defect-target' },
  { id: 'terrain-gap', target: 'defect-target' },
] as const;

const OUTPUT_DIRS = [
  path.resolve(__dirname, '../../../artifacts/scene-defects'),
  path.resolve('D:/code/Daxur-Daemon/cli/test/evals/fixtures/scene-vision'),
  path.resolve('D:/code/Daxur-Daemon/daxur-daemon-web/public/visual-evals'),
];

for (const dir of OUTPUT_DIRS) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function saveCapture(filename: string, dataUrl: string): void {
  const base64Data = dataUrl.split(',')[1];
  const buffer = Buffer.from(base64Data, 'base64');
  for (const dir of OUTPUT_DIRS) {
    fs.writeFileSync(path.join(dir, filename), buffer);
  }
}

/**
 * Stitches an array of frame captures horizontally into a single filmstrip sprite.
 */
async function stitchFilmstrip(
  page: import('@playwright/test').Page,
  frames: Array<{ label: string; image: string }>
): Promise<string> {
  return page.evaluate((items) => {
    return new Promise<string>((resolve, reject) => {
      const loaded: HTMLImageElement[] = [];
      let count = 0;
      items.forEach((item, idx) => {
        const img = new Image();
        img.onload = () => {
          loaded[idx] = img;
          count++;
          if (count === items.length) {
            const canvas = document.createElement('canvas');
            const frameW = loaded[0].width;
            const frameH = loaded[0].height;
            canvas.width = frameW * items.length;
            canvas.height = frameH;
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject(new Error('No 2D canvas context'));

            loaded.forEach((imgEl, i) => {
              const xOffset = i * frameW;
              ctx.drawImage(imgEl, xOffset, 0);

              // Border separator between frames
              if (i > 0) {
                ctx.strokeStyle = '#38bdf8';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(xOffset, 0);
                ctx.lineTo(xOffset, frameH);
                ctx.stroke();
              }

              // Label badge
              ctx.fillStyle = 'rgba(9, 17, 31, 0.85)';
              ctx.fillRect(xOffset + 12, 12, 120, 32);
              ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
              ctx.lineWidth = 1.5;
              ctx.strokeRect(xOffset + 12, 12, 120, 32);

              ctx.fillStyle = '#f8fafc';
              ctx.font = 'bold 15px sans-serif';
              ctx.fillText(items[i].label, xOffset + 20, 33);
            });

            resolve(canvas.toDataURL('image/png'));
          }
        };
        img.onerror = () => reject(new Error(`Failed to load frame ${idx}`));
        img.src = item.image;
      });
    });
  }, frames);
}

for (const { id, target } of DEFECT_CASES) {
  test.describe(`Visual defect: ${id}`, () => {
    test(`captures clean state`, async ({ page }, testInfo) => {
      await page.goto(`/scene-inspection-lab?sceneTest=agent-reference-v1&defect=${id}&defectActive=false`);
      await page.waitForFunction(() => Boolean((window as Window & { __sceneTest?: Bridge }).__sceneTest));
      const scene = await bridge(page);

      // 1. Single central capture
      await scene.focus({ target, azimuthDeg: 45, elevationDeg: 30 });
      const capture = await scene.capture(`${id}-clean`);
      expect(capture.image.startsWith('data:image/png;base64,')).toBe(true);
      saveCapture(`${id}-clean.png`, capture.image);

      // 2. For z-fighting, also capture a 5-frame orbit filmstrip across changing camera angles
      if (id === 'z-fighting') {
        const orbitAngles = [25, 32, 39, 46, 53];
        const frames: Array<{ label: string; image: string }> = [];
        for (let i = 0; i < orbitAngles.length; i++) {
          const deg = orbitAngles[i];
          await scene.focus({ target, azimuthDeg: deg, elevationDeg: 30 });
          const fCapture = await scene.capture(`${id}-clean-${deg}`);
          frames.push({ label: `F${i + 1} (${deg}°)`, image: fCapture.image });
        }
        const filmstrip = await stitchFilmstrip(page, frames);
        saveCapture(`${id}-clean-filmstrip.png`, filmstrip);
        await testInfo.attach(`${id}-clean-filmstrip.png`, {
          body: Buffer.from(filmstrip.split(',')[1], 'base64'),
          contentType: 'image/png',
        });
      }

      await testInfo.attach(`${id}-clean.png`, {
        body: Buffer.from(capture.image.split(',')[1], 'base64'),
        contentType: 'image/png',
      });
    });

    test(`captures defect state`, async ({ page }, testInfo) => {
      await page.goto(`/scene-inspection-lab?sceneTest=agent-reference-v1&defect=${id}&defectActive=true`);
      await page.waitForFunction(() => Boolean((window as Window & { __sceneTest?: Bridge }).__sceneTest));
      const scene = await bridge(page);

      // 1. Single central capture
      await scene.focus({ target, azimuthDeg: 45, elevationDeg: 30 });
      const capture = await scene.capture(`${id}-defect`);
      expect(capture.image.startsWith('data:image/png;base64,')).toBe(true);
      saveCapture(`${id}-defect.png`, capture.image);

      // 2. For z-fighting, also capture a 5-frame orbit filmstrip across changing camera angles
      if (id === 'z-fighting') {
        const orbitAngles = [25, 32, 39, 46, 53];
        const frames: Array<{ label: string; image: string }> = [];
        for (let i = 0; i < orbitAngles.length; i++) {
          const deg = orbitAngles[i];
          await scene.focus({ target, azimuthDeg: deg, elevationDeg: 30 });
          const fCapture = await scene.capture(`${id}-defect-${deg}`);
          frames.push({ label: `F${i + 1} (${deg}°)`, image: fCapture.image });
        }
        const filmstrip = await stitchFilmstrip(page, frames);
        saveCapture(`${id}-defect-filmstrip.png`, filmstrip);
        await testInfo.attach(`${id}-defect-filmstrip.png`, {
          body: Buffer.from(filmstrip.split(',')[1], 'base64'),
          contentType: 'image/png',
        });
      }

      await testInfo.attach(`${id}-defect.png`, {
        body: Buffer.from(capture.image.split(',')[1], 'base64'),
        contentType: 'image/png',
      });
    });
  });
}
