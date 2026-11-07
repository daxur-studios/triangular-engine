import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MoonBoopGame,
  CAT_LIMIT,
  MOON_GOAL,
  CARE_AFTER,
  LEAVE_AFTER,
  GUN_PERIOD,
  TREAT_FLIGHT,
} from "./moon-boop-game.ts";

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
test("one collector with purchased upkeep completes the round and victory freezes care too", () => {
  const game = new MoonBoopGame();
  game.toggleAuto();
  for (let t = 0; t < 600 && !game.state.won; t += 0.1) {
    if (game.state.guns < 2) game.buy("gun");
    else if (game.state.shoes < 3) game.buy("shoes");
    else game.buy("basket");
    game.advance(0.1);
  }
  assert.equal(game.state.won, true);
  assert.equal(game.stacked, MOON_GOAL);
  const snapshot = game.snapshot();
  game.advance(300);
  assert.deepEqual(game.snapshot(), snapshot);
  assert.equal(game.stackCat(), false);
  assert.equal(game.petCat(), false);
  assert.equal(game.buy("gun"), false);
});

test("care deadlines use simulation time and middle departures preserve stable tower order", () => {
  const game = new MoonBoopGame();
  game.toggleCare();
  game.stackCat(1);
  game.stackCat(2);
  game.stackCat(3);
  game.advance(CARE_AFTER - 0.05);
  assert.equal(game.needsCare(game.state.cats[1]), false);
  game.advance(0.05);
  assert.equal(game.needsCare(game.state.cats[1]), true);
  game.state.cats[0].caredAt = game.state.time;
  game.state.cats[2].caredAt = game.state.time;
  game.advance(LEAVE_AFTER - CARE_AFTER - 0.05);
  assert.equal(game.stacked, 3);
  game.advance(0.05);
  assert.equal(game.stacked, 2);
  assert.deepEqual(
    game.state.cats.filter((c) => c.place === "stacked").map((c) => c.id),
    [1, 3],
  );
  assert.deepEqual(game.state.cats.find((c) => c.id === 2).departure, {
    at: game.state.time,
    level: 1,
  });
  const budget = game.state.treats;
  game.advance(3);
  assert.equal(
    game.state.cats.some((c) => c.id === 2),
    false,
  );
  assert.equal(game.state.treats, budget);
  assert.equal(game.state.departures, 1);
});

test("explicit petting uses one request slot and refreshes exactly the requested cat", () => {
  const game = new MoonBoopGame("petting");
  assert.equal(game.petCat(1), false);
  assert.equal(game.petCat(4), true);
  assert.equal(game.petCat(4), false);
  game.advance(0.8);
  assert.equal(game.petCat(4), false);
  game.advance(5);
  assert.equal(game.state.pets, 1);
  assert.equal(game.state.cats.find((c) => c.id === 4).careBy, "human");
  assert.ok(
    game.state.cats.filter((c) => c.id !== 4).every((c) => c.careCount === 0),
  );
  assert.equal(game.state.collector.phase, "idle");
  assert.equal(game.state.collector.y, 0);
});

test("pause freezes pet jobs and projectiles; reset clears all care work and purchases", () => {
  const game = new MoonBoopGame("treats");
  game.petCat(4);
  game.buy("gun");
  game.advance(0.4);
  assert.ok(game.state.shots.length);
  assert.notEqual(game.state.collector.phase, "idle");
  game.state.paused = true;
  const before = game.snapshot();
  game.advance(80);
  assert.equal(game.petCat(3), false);
  assert.equal(game.toggleCare(), false);
  assert.equal(game.buy("gun"), false);
  assert.deepEqual(game.snapshot(), before);
  game.state.paused = false;
  game.advance(0.5);
  assert.equal(game.state.treatHits, 1);
  game.reset();
  assert.equal(game.state.guns, 0);
  assert.equal(game.state.shots.length, 0);
  assert.equal(game.state.pets, 0);
  assert.equal(game.state.treatHits, 0);
  assert.equal(game.state.requestedCat, null);
  assert.equal(game.state.collector.y, 0);
});

test("one then two guns enforce costs, target reservation, cadence and actual hit delay", () => {
  const game = new MoonBoopGame("treats");
  assert.equal(game.buy("gun"), true);
  assert.equal(game.state.treats, 32);
  game.advance(0.05);
  const first = game.state.shots[0];
  assert.equal(first.catId, 1);
  assert.equal(game.state.treatHits, 0);
  assert.equal(game.buy("gun"), true);
  assert.equal(game.state.treats, 0);
  assert.equal(game.buy("gun"), false);
  game.advance(0.05);
  assert.equal(game.state.shots[1].catId, 2);
  game.advance(TREAT_FLIGHT - 0.1);
  assert.equal(game.state.treatHits, 0);
  game.advance(0.05);
  assert.equal(game.state.cats.find((c) => c.id === 1).careBy, "treat");
  assert.equal(game.state.cats.find((c) => c.id === 2).careBy, "arrival");
  game.advance(0.05);
  assert.equal(game.state.treatHits, 2);
  game.advance(GUN_PERIOD - TREAT_FLIGHT - 0.1);
  assert.equal(game.state.shots.length, 0);
  game.advance(0.05);
  assert.equal(
    game.state.shots[0].firedAt - first.firedAt >= GUN_PERIOD - 1e-9,
    true,
  );
  game.advance(8);
  assert.equal(game.state.treatHits, 8);
  assert.equal(game.state.departures, 0);
});

test("two guns improve automatic upkeep and neither steals an active human target", () => {
  const one = new MoonBoopGame("treats"),
    two = new MoonBoopGame("treats");
  one.buy("gun");
  two.buy("gun");
  two.buy("gun");
  one.advance(9);
  two.advance(9);
  assert.equal(one.state.treatHits, 4);
  assert.equal(two.state.treatHits, 8);
  const mixed = new MoonBoopGame("treats");
  mixed.petCat(1);
  mixed.advance(0.05);
  mixed.buy("gun");
  mixed.advance(0.05);
  assert.equal(mixed.state.collector.catId, 1);
  assert.equal(mixed.state.shots[0].catId, 2);
});

test("a deadline wins a simultaneous late treat hit; no departed cat can be resurrected", () => {
  const game = new MoonBoopGame("treats");
  game.state.cats = [game.state.cats[0]];
  game.state.cats[0].caredAt = -(LEAVE_AFTER - TREAT_FLIGHT - 0.05);
  game.buy("gun");
  game.advance(1);
  assert.equal(game.state.departures, 1);
  assert.equal(game.state.treatHits, 0);
  assert.equal(game.state.shots.length, 0);
  assert.equal(game.state.cats[0].place, "departing");
});

test("automatic care cannot starve collection and turning it off finishes the current trip", () => {
  const game = new MoonBoopGame("treats");
  game.toggleCare();
  game.toggleAuto();
  game.advance(20);
  assert.ok(game.state.pets >= 2);
  assert.ok(
    game.state.cats.some(
      (c) =>
        c.source === "catnip" &&
        c.id >= 9 &&
        (c.place === "stacked" || c.place === "carried"),
    ),
  );
  const job = new MoonBoopGame("petting");
  job.toggleCare();
  job.advance(1);
  job.toggleCare();
  job.advance(8);
  assert.equal(job.state.pets, 1);
  assert.equal(job.state.collector.phase, "idle");
});

test("pending pets wait behind a collection trip, and missing targets return the human safely", () => {
  const game = new MoonBoopGame();
  game.toggleAuto();
  game.advance(1);
  game.stackCat(2);
  game.state.cats.find((c) => c.id === 2).caredAt =
    game.state.time - CARE_AFTER;
  game.petCat(2);
  game.advance(7);
  assert.ok(game.stacked >= 2);
  assert.ok(
    ["ascending", "petting", "descending"].includes(game.state.collector.phase),
  );
  const missed = new MoonBoopGame("departure");
  missed.state.cats[3].caredAt = -LEAVE_AFTER + 0.5;
  missed.petCat(4);
  missed.advance(6);
  assert.equal(missed.state.pets, 0);
  assert.equal(missed.state.collector.phase, "idle");
  assert.equal(missed.state.collector.y, 0);
});

test("snapshot and fixed-step chunk equivalence include airborne treats, care and departures", () => {
  const a = new MoonBoopGame("treats"),
    b = new MoonBoopGame("treats");
  for (const g of [a, b]) {
    g.buy("gun");
    g.toggleCare();
    g.advance(0.173);
  }
  const saved = a.snapshot();
  a.advance(55.027);
  for (let i = 0; i < 550; i++) b.advance(0.1);
  b.advance(0.027);
  assert.deepEqual(a.state, b.state);
  a.restore(saved);
  a.advance(55.027);
  assert.deepEqual(a.state, b.state);
  assert.ok(a.state.cats.length <= CAT_LIMIT);
});

test("a pet trip follows the same recipient when a lower cat leaves mid-ascent", () => {
  const game = new MoonBoopGame("treats");
  game.state.cats[3].caredAt = -LEAVE_AFTER + 0.5;
  game.petCat(7);
  game.advance(5);
  assert.equal(game.state.cats.find((c) => c.id === 7).careBy, "human");
  assert.equal(game.state.cats.find((c) => c.id === 6).careCount, 0);
  assert.equal(game.state.departures, 1);
  assert.equal(game.state.collector.y, 0);
});

test("departing cats occupy the population cap until their safe exit completes", () => {
  const game = new MoonBoopGame("departure");
  while (game.state.cats.length < CAT_LIMIT)
    game.state.cats.push({
      id: game.state.nextId++,
      source: "catnip",
      place: "waiting",
      caredAt: 0,
      careBy: "arrival",
      careCount: 0,
    });
  game.state.clocks.catnip = 7;
  const next = game.state.nextId;
  game.advance(6.95);
  assert.equal(game.state.cats.length, CAT_LIMIT);
  assert.equal(game.state.nextId, next);
  game.advance(0.05);
  assert.equal(game.state.cats.length, CAT_LIMIT);
  assert.equal(game.state.nextId, next + 1);
  assert.equal(
    game.state.cats.some((c) => c.id === 4),
    false,
  );
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
