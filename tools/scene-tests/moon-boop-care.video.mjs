import { defineVideo } from "@daxur-studios/stop-motion-ui";
import { kokoroNarration } from "../kokoro-narration.mjs";
import assert from "node:assert/strict";

// Page-owned deterministic fixtures; the installed recorder prepares/cache speech
// before capture. This walkthrough is separate from engine test-result artifacts.
export default defineVideo({
  baseURL: "http://triangular-demo.localhost:4200",
  viewport: { width: 1440, height: 960 },
  pointer: { x: 1110, y: 360 },
  browser: {
    channel: "chrome",
    args: ["--enable-unsafe-webgpu", "--use-angle=d3d11"],
  },
  audioProvider: kokoroNarration(),
  segments: [
    {
      id: "briefing",
      caption: "Operation Moon Boop · the purr department",
      narration:
        "Moon Boop now runs on affection. Amber cats need a head pat or a snack.",
    },
    {
      id: "head-pat",
      caption: "Petting practice · one human takes the cat lift",
      narration:
        "Our only human rides the cat lift, pets Cat Four, and comes back down. A real head pat refreshes that cat’s care.",
    },
    {
      id: "sofa-break",
      caption: "Missed-care fixture · safe exit, gentle tower reflow",
      narration:
        "In this missed-care example, Cat Four takes a safe sofa break. A little platform carries the cat away, and the tower closes the gap.",
    },
    {
      id: "first-gun",
      caption: "Treat-gun trial · first cannon costs 20 treats",
      narration:
        "Now eight cats want snacks. The first treat gun costs twenty treats, and automatically feeds the neediest cats.",
    },
    {
      id: "twin-guns",
      caption: "Add a mint twin · separate targets, real treat hits",
      narration:
        "Thirty-two more treats buys a mint twin. The guns choose different cats. Care refreshes when each flying snack actually arrives.",
    },
    {
      id: "all-purring",
      caption: "Eight cats cared for · still exactly one human",
      narration:
        "Eight cats cared for, and still just one human. Keep building. Keep purring.",
    },
  ],
  async ready(page) {
    await page.goto("/cat-space-program");
    await page.waitForFunction(
      () =>
        window.moonBoopDemo?.ready() &&
        window.moonBoopDemo.actions.includes("pet") &&
        document.querySelector("scene canvas").height > 400,
    );
    await page.evaluate(() => {
      if (
        !window.moonBoopDemo.act("reset", "petting") ||
        !window.moonBoopDemo.act("pause")
      )
        throw new Error("Care fixture refused");
    });
  },
  async run({ page, video }) {
    const act = async (action, value) =>
      assert.equal(
        await page.evaluate(
          ({ action, value }) => window.moonBoopDemo.act(action, value),
          { action, value },
        ),
        true,
        `Refused ${action}`,
      );
    const read = () => page.evaluate(() => window.moonBoopDemo.read());
    const wait = (condition) =>
      page.waitForFunction(condition, undefined, { timeout: 60000 });
    await video.segment("briefing", async () => {});
    await video.segment("head-pat", async () => {
      await video.click(
        page.getByRole("button", { name: "Resume", exact: true }),
      );
      await video.click(
        page.getByRole("button", { name: "Pet Cat 4", exact: true }),
      );
      await video.moveTo(1110, 360);
      await wait(
        () =>
          window.moonBoopDemo.read().pets === 1 &&
          window.moonBoopDemo.read().collector.phase === "idle",
      );
      assert.equal((await read()).cats.find((c) => c.id === 4).careBy, "human");
    });
    await video.segment("sofa-break", async () => {
      await act("reset", "departure");
      await wait(
        () =>
          window.moonBoopDemo.read().departures === 1 &&
          !window.moonBoopDemo.read().cats.some((c) => c.id === 4),
      );
      assert.deepEqual(
        (await read()).cats
          .filter((c) => c.place === "stacked")
          .map((c) => c.id),
        [1, 2, 3, 5, 6],
      );
    });
    await video.segment("first-gun", async () => {
      await act("reset", "treats");
      await video.click(page.getByTestId("buy-gun"));
      await video.moveTo(1110, 360);
      await wait(() => window.moonBoopDemo.read().treatHits >= 2);
      assert.equal((await read()).guns, 1);
    });
    await video.segment("twin-guns", async () => {
      await video.click(page.getByTestId("buy-gun"));
      await video.moveTo(1110, 360);
      await wait(() => window.moonBoopDemo.read().treatHits === 8);
      await act("pause");
      const state = await read();
      assert.equal(state.guns, 2);
      assert.equal(state.departures, 0);
      assert.equal(state.pets, 0);
      assert.ok(
        state.cats
          .filter((c) => c.place === "stacked")
          .every((c) => c.careBy === "treat"),
      );
    });
    await video.segment("all-purring", async () => {
      await video.hold(1200);
    });
    console.error(
      `Care demo complete: ${JSON.stringify({ hits: (await read()).treatHits, guns: (await read()).guns })}`,
    );
  },
});
