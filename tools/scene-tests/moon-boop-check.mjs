// Headless functional checks against the already-served demo; never starts a server.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const out = "ignore/moon-boop-verification";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-unsafe-webgpu", "--use-angle=d3d11"],
});
const evidence = {
  checks: [],
  errors: [],
  limitations: [
    "Functional checks only; no controlled GPU performance measurements.",
  ],
};
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  page.on("pageerror", (e) => evidence.errors.push(e.message));
  await page.goto("http://triangular-demo.localhost:4200/cat-space-program", {
    waitUntil: "networkidle",
  });
  await page.waitForFunction(
    () =>
      window.moonBoopDemo?.ready() &&
      typeof window.moonBoopDemo.selection === "function" &&
      document.querySelector("scene canvas").height > 400,
  );
  const act = (action, value) =>
    page.evaluate(
      ({ action, value }) => window.moonBoopDemo.act(action, value),
      { action, value },
    );
  await page.getByRole("button", { name: "Stack one waiting cat" }).click();
  assert.equal(
    (await page.evaluate(() => window.moonBoopDemo.read())).cats.filter(
      (c) => c.place === "stacked",
    ).length,
    1,
  );
  evidence.checks.push("Angular manual stacking uses game accounting");
  await act("select", "catnip");
  await act("highlights");
  await page.waitForFunction(() =>
    document.querySelector(".focus-overlay rect"),
  );
  const canvas = await page.locator("scene canvas").boundingBox();
  const target = await page.evaluate(() =>
    window.moonBoopDemo.targets().find((t) => t.id === "moon"),
  );
  await page.mouse.click(
    canvas.x + ((target.x + target.width / 2) / 100) * canvas.width,
    canvas.y + ((target.y + target.height / 2) / 100) * canvas.height,
  );
  assert.equal(
    await page.evaluate(() => window.moonBoopDemo.selection()),
    "moon",
  );
  assert.ok(await page.locator(".focus-overlay rect").count());
  evidence.checks.push(
    "Named target bounds support a real browser pointer click and focus overlay",
  );
  await act("pause");
  const paused = await page.evaluate(() => window.moonBoopDemo.read());
  // Await actual completed browser renders while testing that game state remains frozen.
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        let n = 0;
        const frame = () =>
          ++n >= 8 ? resolve() : requestAnimationFrame(frame);
        requestAnimationFrame(frame);
      }),
  );
  assert.deepEqual(
    await page.evaluate(() => window.moonBoopDemo.read()),
    paused,
  );
  evidence.checks.push(
    "Pause preserves the complete game state across rendered frames",
  );
  await act("reset", "kittens");
  await page.locator("details.tests > summary").click();
  const before = await page.evaluate(() => window.moonBoopDemo.read());
  await page.getByRole("button", { name: "Run suite", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).waitFor();
  assert.equal(await act("stack"), false);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Run suite", exact: true }).waitFor();
  const restored = await page.evaluate(() => window.moonBoopDemo.read());
  assert.equal(restored.scenario, before.scenario);
  assert.deepEqual(restored.cats, before.cats);
  assert.equal(restored.auto, before.auto);
  assert.ok(restored.time >= before.time && restored.time - before.time < 1);
  evidence.checks.push(
    "Cancelling the testing-entry run restores the previous round and releases input locks",
  );
  if (process.argv.includes("--full-suite")) {
    await page.getByRole("button", { name: "Run suite", exact: true }).click();
    await page.getByRole("button", { name: "Cancel", exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Run suite", exact: true })
      .waitFor({ timeout: 65000 });
    evidence.suiteText = await page.locator("tri-test-runner").innerText();
    assert.match(evidence.suiteText, /3 valid · 0 invalid · 0 failed/);
    assert.doesNotMatch(
      evidence.suiteText,
      /Expected game transition.*failed/i,
    );
    evidence.checks.push(
      "Full testing-entry functional suite completed; read the durable result summary for verdicts",
    );
  }
  await page.locator("details.tests > summary").click();
  await act("reset");
  await page.screenshot({ path: `${out}/playable.png` });
  await page.goto("http://triangular-demo.localhost:4200/", {
    waitUntil: "networkidle",
  });
  assert.ok(await page.locator('a[href="/cat-space-program"]').count());
  evidence.checks.push("The demo hub links to the playable route");
  assert.deepEqual(evidence.errors, []);
  console.log(JSON.stringify(evidence));
} catch (error) {
  evidence.failure = error.stack;
  throw error;
} finally {
  await writeFile(
    `${out}/browser-checks.json`,
    JSON.stringify(evidence, null, 2),
  );
  await browser.close();
}
