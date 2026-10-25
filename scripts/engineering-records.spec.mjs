import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, test } from "node:test";
import {
  confirmScopeBaseline,
  createPair,
  inspectDocuments,
  nextNumber,
  refreshReview,
} from "./engineering-records.mjs";

const SCRIPT = fileURLToPath(
  new URL("./engineering-records.mjs", import.meta.url),
);

let root;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "engineering-records-"));
  await mkdir(path.join(root, "docs", "plans"), { recursive: true });
  await mkdir(path.join(root, "docs", "runbook"), { recursive: true });
  await writeFile(
    path.join(root, "docs", "plans", "index.md"),
    "# Plans\n\n| Plan | Status | Engineering Record |\n| --- | --- | --- |\n\nConvention: docs/plans-and-runbooks.md\n",
  );
  await writeFile(
    path.join(root, "docs", "runbook", "index.md"),
    "# Engineering Records\n\n| Engineering Record | Plan |\n| --- | --- |\n\nConvention: docs/plans-and-runbooks.md\n",
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function create(slug = "sample-feature", title = "Sample feature") {
  return createPair({ root, title, slug, date: "2026-10-25" });
}

async function planText(pair) {
  return readFile(path.join(root, pair.plan), "utf8");
}

async function replacePlan(pair, transform) {
  const filename = path.join(root, pair.plan);
  const original = await readFile(filename, "utf8");
  await writeFile(filename, transform(original));
}

async function replaceRecord(pair, transform) {
  const filename = path.join(root, pair.record);
  const original = await readFile(filename, "utf8");
  await writeFile(filename, transform(original));
}

async function assess(pair) {
  return refreshReview({
    root,
    planPath: pair.plan,
    reviewer: "agent",
    date: "2026-10-25",
  });
}

test("allocates after the highest plan or record number and creates reciprocal indexed files", async () => {
  await writeFile(path.join(root, "docs", "plans", "104_old.md"), "# old");
  await writeFile(path.join(root, "docs", "runbook", "106_old.md"), "# old");
  assert.equal(await nextNumber(root), 107);

  const pair = await create("water-scattering", "Water | scattering");
  assert.equal(pair.number, "107");
  const plan = await planText(pair);
  const record = await readFile(path.join(root, pair.record), "utf8");
  assert.match(plan, /map_schema: 1/);
  assert.match(
    plan,
    /title: "Water \\| scattering"|title: "Water \| scattering"/,
  );
  assert.match(plan, /runbook: \/docs\/runbook\/107_water-scattering\.md/);
  assert.match(record, /- \/docs\/plans\/107_water-scattering\.md/);
  assert.match(record, /record_id: er-107/);
  assert.match(
    await readFile(path.join(root, "docs", "plans", "index.md"), "utf8"),
    /\[Water \\\| scattering\]/,
  );
  assert.match(
    await readFile(path.join(root, "docs", "runbook", "index.md"), "utf8"),
    /\[PLAN-107\]/,
  );
  assert.doesNotMatch(plan + record, /\{\{[A-Z_]+\}\}/);
});

test("concurrent creation reserves distinct shared numbers and does not lose index rows", async () => {
  const created = await Promise.all([
    create("parallel-one", "Parallel one"),
    create("parallel-two", "Parallel two"),
  ]);
  assert.deepEqual(created.map((item) => item.number).sort(), ["001", "002"]);
  await Promise.all(created.map(assess));
  const planIndex = await readFile(
    path.join(root, "docs", "plans", "index.md"),
    "utf8",
  );
  const recordIndex = await readFile(
    path.join(root, "docs", "runbook", "index.md"),
    "utf8",
  );
  for (const item of created) {
    assert.ok(planIndex.includes(`(${`/${item.plan}`})`));
    assert.ok(recordIndex.includes(`(${`/${item.record}`})`));
  }
  const result = await inspectDocuments(root);
  assert.deepEqual(result.errors, []);
});

test("readiness distinguishes a blocker, open items, resolution, deferral and reopening", async () => {
  const pair = await create();
  let result = await inspectDocuments(root);
  assert.ok(
    result.errors.some((error) => error.includes("review is missing or stale")),
  );
  assert.equal(
    result.manifest.documents[0].phases[0].readiness.state,
    "unassessed",
  );

  await assess(pair);
  result = await inspectDocuments(root);
  assert.deepEqual(result.errors, []);
  assert.equal(
    result.manifest.documents[0].phases[0].readiness.state,
    "needs-resolution",
  );

  await replacePlan(pair, (text) =>
    text.replace('blocks="phase-id"', 'blocks="none"'),
  );
  result = await inspectDocuments(root);
  assert.ok(
    result.errors.some((error) => error.includes("review is missing or stale")),
  );
  await assess(pair);
  result = await inspectDocuments(root);
  assert.equal(
    result.manifest.documents[0].phases[0].readiness.state,
    "open-items",
  );

  await replacePlan(pair, (text) =>
    text
      .replace('blocks="none" state="open"', 'blocks="none" state="resolved"')
      .replace(
        "- [ ] State one consequential question or assumption in concrete terms.",
        "- [x] State one consequential question or assumption in concrete terms.",
      )
      .replace(
        "  - Next action: state who investigates, decides, or records the answer.",
        "  - Next action: state who investigates, decides, or records the answer.\n  - Resolution: the intended behavior is now recorded.",
      ),
  );
  result = await inspectDocuments(root);
  assert.deepEqual(result.errors, []);
  assert.equal(result.manifest.documents[0].phases[0].readiness.state, "ready");

  await replacePlan(pair, (text) =>
    text
      .replace(
        'blocks="none" state="resolved"',
        'blocks="phase-id" state="deferred"',
      )
      .replace(
        "- [x] State one consequential question or assumption in concrete terms.",
        "- [ ] State one consequential question or assumption in concrete terms.",
      )
      .replace(
        "  - Resolution: the intended behavior is now recorded.",
        "  - Deferred because: the owner needs to investigate the impact first.",
      ),
  );
  await assess(pair);
  result = await inspectDocuments(root);
  assert.deepEqual(result.errors, []);
  assert.equal(
    result.manifest.documents[0].phases[0].readiness.state,
    "needs-resolution",
  );

  await replacePlan(pair, (text) =>
    text
      .replace('state="deferred"', 'state="open"')
      .replace(
        "  - Deferred because: the owner needs to investigate the impact first.",
        "  - Previous resolution: the intended behavior was recorded, then reopened.",
      ),
  );
  result = await inspectDocuments(root);
  assert.deepEqual(result.errors, []);
  assert.equal(
    result.manifest.documents[0].phases[0].readiness.state,
    "needs-resolution",
  );
});

test("a scope or question meaning edit makes readiness unassessed until the review is refreshed", async () => {
  const pair = await create();
  await assess(pair);
  await replacePlan(pair, (text) =>
    text
      .replace(
        "observable conditions that demonstrate the result.",
        "a concrete integration acceptance condition.",
      )
      .replace(
        "How it is interpreted differently.",
        "How an unresolved choice changes the result.",
      ),
  );
  let result = await inspectDocuments(root);
  assert.ok(
    result.errors.some((error) => error.includes("review is missing or stale")),
  );
  assert.equal(
    result.manifest.documents[0].phases[0].readiness.state,
    "unassessed",
  );
  await assess(pair);
  result = await inspectDocuments(root);
  assert.deepEqual(result.errors, []);
});

test("an explicitly reviewed empty question list is clear, while a missing review stays unassessed", async () => {
  const pair = await create();
  const emptyPlan = (await planText(pair)).replace(
    /<!-- tri:item\b[\s\S]*?<!-- \/tri:item -->\r?\n?/g,
    "",
  );
  assert.doesNotMatch(emptyPlan, /^## Readiness review$/m);
  await replacePlan(pair, () => emptyPlan);
  await assess(pair);
  const result = await inspectDocuments(root);
  assert.deepEqual(result.errors, []);
  assert.equal(result.manifest.documents[0].phases[0].readiness.state, "ready");
});

test("scope baselines require an explicit developer action and changes retain source fields", async () => {
  const pair = await create("scope-history");
  await assess(pair);
  const filename = path.join(root, pair.record);
  const initial = await inspectDocuments(root);
  assert.equal(initial.manifest.documents[0].scopeHistory.baseline.state, "unconfirmed");
  assert.deepEqual(initial.manifest.documents[0].scopeHistory.changes, []);
  await assert.rejects(
    confirmScopeBaseline({ root, planPath: pair.plan, confirmedDate: "2026-10-25" }),
    /requires --developer-confirmed/,
  );

  const confirmedBaseline = await confirmScopeBaseline({
    root,
    planPath: pair.plan,
    developerConfirmed: true,
    confirmedDate: "2026-10-25",
  });
  await replaceRecord(pair, (text) => text.replace(
    "<!-- /tri:scope-baseline -->",
    `<!-- /tri:scope-baseline -->\n<!-- tri:scope-change id="SC-1" date="2026-10-25" kind="addition" origin="discovered" disposition="accepted" scope-ids="phase-id" -->\n- Summary: Add shoreline foam controls.\n- Reason: The scene test needs a stable tuning control.\n- Impact: Adds one accepted goal to the current scope.\n<!-- /tri:scope-change -->`,
  ));
  const result = await inspectDocuments(root);
  assert.deepEqual(result.errors, []);
  const document = result.manifest.documents[0];
  assert.equal(document.scopeHistory.baseline.state, "confirmed");
  assert.equal(document.scopeHistory.baseline.confirmedBy, "developer");
  assert.equal(document.scopeHistory.baseline.goals[0].id, "phase-id");
  assert.deepEqual(document.scopeHistory.changes[0], {
    id: "SC-1",
    date: "2026-10-25",
    kind: "addition",
    origin: "discovered",
    disposition: "accepted",
    scopeIds: ["phase-id"],
    summary: "Add shoreline foam controls.",
    reason: "The scene test needs a stable tuning control.",
    impact: "Adds one accepted goal to the current scope.",
  });
  assert.equal((await readFile(filename, "utf8")).includes(confirmedBaseline.baselineId), true);
});

test("legacy documents remain readable and stable IDs preserve allocation after path changes", async () => {
  await writeFile(
    path.join(root, "docs", "plans", "005_legacy-plan.md"),
    "---\ntype: Plan\ntitle: Legacy plan\n---\n\nA historical plan without structured metadata.\n",
  );
  await writeFile(
    path.join(root, "docs", "runbook", "005_legacy-record.md"),
    "Its historical record.\n",
  );
  const pair = await create();
  assert.equal(pair.number, "006");
  await assess(pair);

  const planPath = path.join(root, pair.plan);
  const recordPath = path.join(root, pair.record);
  const renamedPlan = path.join(root, "docs", "plans", "current-scope.md");
  const renamedRecord = path.join(
    root,
    "docs",
    "runbook",
    "development-history.md",
  );
  const plan = (await readFile(planPath, "utf8")).replace(
    `/docs/runbook/${path.basename(pair.record)}`,
    "/docs/runbook/development-history.md",
  );
  const record = (await readFile(recordPath, "utf8")).replace(
    `/docs/plans/${path.basename(pair.plan)}`,
    "/docs/plans/current-scope.md",
  );
  await writeFile(renamedPlan, plan);
  await writeFile(renamedRecord, record);
  await rm(planPath);
  await rm(recordPath);
  const planIndex = path.join(root, "docs", "plans", "index.md");
  const recordIndex = path.join(root, "docs", "runbook", "index.md");
  await writeFile(
    planIndex,
    (await readFile(planIndex, "utf8")).replace(
      `(${`/${pair.plan}`})`,
      "(/docs/plans/current-scope.md)",
    ),
  );
  await writeFile(
    recordIndex,
    (await readFile(recordIndex, "utf8")).replace(
      `(${`/${pair.record}`})`,
      "(/docs/runbook/development-history.md)",
    ),
  );

  const result = await inspectDocuments(root);
  assert.deepEqual(result.errors, []);
  const mapped = result.manifest.documents.find(
    (document) => document.id === "plan-006",
  );
  assert.equal(mapped.recordId, "er-006");
  const legacy = result.manifest.documents.find(
    (document) => document.id === "plan-005",
  );
  assert.equal(legacy.mapped, false);
  assert.equal(legacy.review.state, "unassessed");
  assert.equal(legacy.progress, null);
  assert.equal(await nextNumber(root), 7);
});

test("reports malformed item state, unknown phases, and broken reciprocal links", async () => {
  const pair = await create();
  await assess(pair);
  await replacePlan(pair, (text) =>
    text.replace('applies-to="phase-id"', 'applies-to="missing-phase"'),
  );
  const result = await inspectDocuments(root);
  assert.ok(
    result.errors.some((error) => error.includes("applies-to must name")),
  );
  assert.ok(
    result.errors.some((error) => error.includes("review is missing or stale")),
  );

  const filename = path.join(root, pair.record);
  const record = await readFile(filename, "utf8");
  await writeFile(
    filename,
    record.replace(`/${pair.plan}`, "/docs/plans/099_missing.md"),
  );
  const broken = await inspectDocuments(root);
  assert.ok(
    broken.errors.some((error) => error.includes("must reciprocally list")),
  );
});

test("rejects unsupported map schema versions instead of parsing them as the current format", async () => {
  const pair = await create();
  await assess(pair);
  await replacePlan(pair, (text) =>
    text.replace("map_schema: 1", "map_schema: 2"),
  );
  const result = await inspectDocuments(root);
  assert.ok(
    result.errors.some((error) => error.includes("unsupported map_schema 2")),
  );
  assert.equal(result.manifest.documents.length, 0);
});

test("rejects unstructured review prose and impossible calendar dates", async () => {
  const pair = await create();
  await assess(pair);
  await replacePlan(pair, (text) =>
    text.replace("\n<!-- tri:item", "\nUnstructured concern.\n\n<!-- tri:item"),
  );
  let result = await inspectDocuments(root);
  assert.ok(
    result.errors.some((error) => error.includes("all readiness text inside")),
  );

  await replacePlan(pair, (text) =>
    text.replace('reviewed="2026-10-25"', 'reviewed="2026-02-31"'),
  );
  result = await inspectDocuments(root);
  assert.ok(
    result.errors.some((error) => error.includes("review date must be")),
  );
  assert.equal(
    result.manifest.documents[0].phases[0].readiness.state,
    "unassessed",
  );
});

test("validates relation targets and rejects dependency cycles while allowing related-to cycles", async () => {
  const a = await create("approach-a", "Approach A");
  const b = await create("approach-b", "Approach B");
  const linkTo = (pair, type, target, phase = "") =>
    replacePlan(pair, (text) =>
      text.replace(
        "<!-- Add only links that have a defined relation; omit this placeholder line when there are none. -->",
        `- **${type}**: [${target.slug}](${`/${target.plan}`}${phase ? `#${phase}` : ""})`,
      ),
    );
  await linkTo(a, "related-to", b);
  await linkTo(b, "related-to", a);
  await assess(a);
  await assess(b);
  let result = await inspectDocuments(root);
  assert.deepEqual(result.errors, []);

  await replacePlan(a, (text) =>
    text
      .replace("**related-to**", "**depends-on**")
      .replace(`/${b.plan})`, `/${b.plan}#missing)`),
  );
  await replacePlan(b, (text) =>
    text
      .replace("**related-to**", "**depends-on**")
      .replace(`/${a.plan})`, `/${a.plan}#phase-id)`),
  );
  await assess(a);
  await assess(b);
  result = await inspectDocuments(root);
  assert.ok(result.errors.some((error) => error.includes("missing phase")));
  assert.ok(result.errors.some((error) => error.includes("dependency cycle")));
});

test("does not leave generated documents when the indexes cannot be updated", async () => {
  await rm(path.join(root, "docs", "runbook", "index.md"));
  await assert.rejects(create("partial-pair"), /ENOENT/);
  assert.deepEqual(
    (await readdir(path.join(root, "docs", "plans"))).filter((name) =>
      /^066_/.test(name),
    ),
    [],
  );
  assert.deepEqual(
    (await readdir(path.join(root, "docs", "runbook"))).filter((name) =>
      /^066_/.test(name),
    ),
    [],
  );
});

test("the CLI creates and validates a separate consumer workspace through its manifest", async () => {
  const created = spawnSync(
    process.execPath,
    [
      SCRIPT,
      "new",
      "--title",
      "Consumer terrain",
      "--slug",
      "consumer-terrain",
      "--root",
      root,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(created.status, 0, created.stderr);
  const planPath = "docs/plans/001_consumer-terrain.md";

  const beforeReview = spawnSync(
    process.execPath,
    [SCRIPT, "manifest", "--root", root],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(beforeReview.status, 0, beforeReview.stderr);
  const staleManifest = JSON.parse(beforeReview.stdout);
  assert.ok(
    staleManifest.diagnostics.some((error) =>
      error.includes("review is missing or stale"),
    ),
  );
  assert.equal(
    staleManifest.documents[0].phases[0].readiness.state,
    "unassessed",
  );

  const reviewed = spawnSync(
    process.execPath,
    [SCRIPT, "review", planPath, "--reviewer", "agent", "--root", root],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(reviewed.status, 0, reviewed.stderr);
  const checked = spawnSync(
    process.execPath,
    [SCRIPT, "check", "--root", root],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /1 mapped and 0 legacy plan/);

  const exported = spawnSync(
    process.execPath,
    [SCRIPT, "manifest", "--root", root, "--output", "out/map.json"],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(exported.status, 0, exported.stderr);
  const output = JSON.parse(await readFile(path.join(root, "out", "map.json"), "utf8"));
  assert.equal(output.documents[0].scopeHistory.baseline.state, "unconfirmed");
});
