import { test } from "node:test";
import assert from "node:assert/strict";
import { MoonBoopGame, CAT_LIMIT, MOON_GOAL } from "./moon-boop-game.ts";

test("manual stacking conserves cats and awards treats only once", () => {
  const game = new MoonBoopGame();
  assert.equal(game.stackCat(1), true);
  assert.equal(game.state.treats, 16);
  assert.equal(game.stacked, 1);
  assert.equal(game.stackCat(1), false);
  assert.equal(game.state.cats.length, 3);
  assert.equal(game.state.treats, 16);
});
test("production uses elapsed simulation time and six kittens arrive together", () => {
  const game = new MoonBoopGame("kittens");
  game.advance(11.95);
  assert.equal(game.state.cats.filter((c) => c.source === "nursery").length, 0);
  game.advance(0.05);
  assert.equal(game.state.cats.filter((c) => c.source === "nursery").length, 6);
  assert.equal(game.state.cats.filter((c) => c.source === "catnip").length, 4);
});
test("food requires portions and purchases cannot overspend", () => {
  const game = new MoonBoopGame();
  assert.equal(game.buy("nursery"), false);
  assert.equal(game.state.treats, 12);
  assert.equal(game.buy("food"), true);
  assert.equal(game.state.treats, 4);
  assert.equal(game.buy("food"), false);
  game.advance(19);
  assert.equal(game.state.cats.filter((c) => c.source === "food").length, 6);
  assert.equal(game.state.food, 0);
});
test("pause freezes production, movement and purchases", () => {
  const game = new MoonBoopGame();
  game.toggleAuto();
  game.advance(1);
  game.state.paused = true;
  const snapshot = game.snapshot();
  game.advance(100);
  assert.equal(game.buy("shoes"), false);
  assert.equal(game.stackCat(), false);
  assert.deepEqual(game.snapshot(), snapshot);
});
test("one collector completes the round and victory stops production", () => {
  const game = new MoonBoopGame();
  game.toggleAuto();
  game.advance(300);
  assert.equal(game.state.won, true);
  assert.equal(game.stacked, MOON_GOAL);
  const snapshot = game.snapshot();
  game.advance(300);
  assert.deepEqual(game.snapshot(), snapshot);
  assert.equal(game.stackCat(), false);
});
test("shoes improve throughput without adding a collector", () => {
  const normal = new MoonBoopGame(),
    fast = new MoonBoopGame();
  fast.buy("shoes");
  normal.toggleAuto();
  fast.toggleAuto();
  normal.advance(20);
  fast.advance(20);
  assert.ok(fast.stacked > normal.stacked);
  assert.ok(!Array.isArray(fast.state.collector));
});
test("basket loads several cats and every delivered cat is counted once", () => {
  const game = new MoonBoopGame();
  game.stackCat();
  assert.equal(game.buy("basket"), true);
  assert.equal(game.capacity, 2);
  game.toggleAuto();
  game.advance(3.6);
  assert.equal(game.state.cats.filter((c) => c.place === "carried").length, 2);
  game.advance(4);
  assert.equal(game.stacked, 3);
});
test("bounded production retains nursery batches when the scene is full", () => {
  const game = new MoonBoopGame("kittens");
  game.advance(300);
  assert.ok(game.state.cats.length <= CAT_LIMIT);
  const kittens = game.state.cats.filter((c) => c.source === "nursery").length;
  assert.equal(kittens % 6, 0);
});
test("snapshot/restore preserves substep remainder and future behavior", () => {
  const game = new MoonBoopGame();
  game.toggleAuto();
  game.advance(2.073);
  const saved = game.snapshot();
  game.advance(5.127);
  const expected = game.snapshot();
  game.restore(saved);
  game.advance(5.127);
  assert.deepEqual(game.snapshot(), expected);
  game.reset("feast");
  assert.equal(game.state.cats.length, 3);
  assert.equal(game.state.food, 8);
  assert.equal(game.state.time, 0);
  assert.equal(game.state.auto, false);
});
test("fixed steps produce the same outcome across render chunk sizes", () => {
  const a = new MoonBoopGame(),
    b = new MoonBoopGame();
  a.toggleAuto();
  b.toggleAuto();
  a.advance(20);
  for (let i = 0; i < 200; i++) b.advance(0.1);
  assert.deepEqual(a.state, b.state);
});
