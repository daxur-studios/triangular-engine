#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const PLAN_TEMPLATE = "docs/templates/engineering-plan.md";
const RECORD_TEMPLATE = "docs/templates/engineering-record.md";
const PHASE = /^[a-z][a-z0-9-]*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ITEM_KINDS = new Set(["intent", "assumption", "investigation"]);
const ITEM_STATES = new Set(["open", "deferred", "resolved"]);
const PHASE_STATES = new Set(["planned", "in_progress", "blocked", "done"]);
const SCOPE_CHANGE_KINDS = new Set(["addition", "removal", "change"]);
const SCOPE_CHANGE_ORIGINS = new Set(["requested", "discovered", "unplanned"]);
const SCOPE_CHANGE_DISPOSITIONS = new Set([
  "proposed",
  "accepted",
  "deferred",
  "rejected",
]);
const RELATION_TYPES = new Set([
  "depends-on",
  "builds-on",
  "alternative-to",
  "supersedes",
  "related-to",
]);

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function projectPath(root, value) {
  if (value.startsWith("/")) return path.resolve(root, value.slice(1));
  return path.resolve(root, value);
}

async function markdownFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"),
    )
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

function frontmatter(text, file, errors) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) {
    if (/^map_schema:/m.test(text))
      errors.push(
        `${file}: mapped document has missing or malformed YAML frontmatter`,
      );
    return {};
  }
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([a-z][a-z0-9_-]*):\s*(.*?)\s*$/.exec(line);
    if (field) data[field[1]] = field[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return data;
}

function block(text, name, file, errors, required = true) {
  const start = `<!-- tri:${name} -->`;
  const end = `<!-- /tri:${name} -->`;
  const starts = text.split(start).length - 1;
  const ends = text.split(end).length - 1;
  if (starts === 0 && ends === 0 && !required) return undefined;
  if (starts !== 1 || ends !== 1) {
    errors.push(`${file}: expected exactly one balanced tri:${name} block`);
    return undefined;
  }
  const startAt = text.indexOf(start);
  const endAt = text.indexOf(end);
  if (startAt >= endAt) {
    errors.push(`${file}: expected exactly one balanced tri:${name} block`);
    return undefined;
  }
  return text.slice(startAt + start.length, endAt).trim();
}

function normalizeHashInput(value) {
  return value
    .replace(/\r\n?/g, "\n")
    .trim()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
}

function splitCells(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function parsePhases(scope, file, errors) {
  const phases = [];
  for (const line of scope.split("\n")) {
    const match =
      /^- \*\*([a-z][a-z0-9-]*)\*\*\s+[—-]\s+(.+?)\s+Acceptance:\s*(.+)$/.exec(
        line.trim(),
      );
    if (match)
      phases.push({
        id: match[1],
        title: match[2].trim(),
        acceptance: match[3].trim(),
      });
  }
  if (phases.length === 0)
    errors.push(
      `${file}: scope needs at least one phase in the documented list format`,
    );
  const seen = new Set();
  for (const phase of phases) {
    if (!PHASE.test(phase.id) || seen.has(phase.id))
      errors.push(`${file}: invalid or duplicate phase id ${phase.id}`);
    seen.add(phase.id);
  }
  return phases;
}

function parseProgress(text, phases, file, errors) {
  const heading = /^## Current phase status\s*\r?\n((?:\|.*\r?\n)+)/m.exec(
    text,
  );
  if (!heading) {
    errors.push(`${file}: missing "## Current phase status" table`);
    return Object.fromEntries(phases.map((phase) => [phase.id, "planned"]));
  }
  const rows = heading[1]
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("|"));
  if (
    rows.length < 3 ||
    splitCells(rows[0]).join("|").toLowerCase() !== "phase|state"
  ) {
    errors.push(
      `${file}: phase status table must start with | Phase | State | and include rows`,
    );
    return Object.fromEntries(phases.map((phase) => [phase.id, "planned"]));
  }
  const state = {};
  for (const row of rows.slice(2)) {
    const cells = splitCells(row);
    if (cells.length !== 2) continue;
    if (!PHASE_STATES.has(cells[1]))
      errors.push(`${file}: unknown phase state "${cells[1]}" for ${cells[0]}`);
    if (state[cells[0]])
      errors.push(`${file}: duplicate phase status for ${cells[0]}`);
    state[cells[0]] = cells[1];
  }
  for (const phase of phases)
    if (!state[phase.id])
      errors.push(`${file}: missing phase status for ${phase.id}`);
  for (const id of Object.keys(state))
    if (!phases.some((phase) => phase.id === id))
      errors.push(`${file}: status refers to unknown phase ${id}`);
  return state;
}

function parseItems(review, phases, file, errors) {
  const items = [];
  const startPattern = /<!-- tri:item\s+([^>]+) -->/g;
  let match;
  while ((match = startPattern.exec(review))) {
    const close = review.indexOf("<!-- /tri:item -->", startPattern.lastIndex);
    if (close < 0) {
      errors.push(`${file}: unclosed tri:item block`);
      break;
    }
    const attrs = Object.fromEntries(
      [...match[1].matchAll(/([a-z-]+)="([^"]*)"/g)].map((entry) => [
        entry[1],
        entry[2],
      ]),
    );
    if (
      Object.keys(attrs).sort().join(",") !==
      ["applies-to", "blocks", "id", "kind", "state"].sort().join(",")
    )
      errors.push(
        `${file}: review items need exactly id, kind, applies-to, blocks and state attributes`,
      );
    const body = review.slice(startPattern.lastIndex, close).trim();
    const item = { ...attrs, body };
    items.push(item);
    startPattern.lastIndex = close + "<!-- /tri:item -->".length;
  }
  if ((review.match(/<!-- \/?tri:item\b/g) ?? []).length !== items.length * 2) {
    errors.push(`${file}: malformed or unmatched tri:item markers`);
  }
  const ids = new Set();
  for (const item of items) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(item.id ?? "") || ids.has(item.id))
      errors.push(
        `${file}: missing or duplicate review item id ${item.id ?? "(empty)"}`,
      );
    ids.add(item.id);
    if (!ITEM_KINDS.has(item.kind))
      errors.push(
        `${file}: ${item.id}: kind must be intent, assumption or investigation`,
      );
    if (!ITEM_STATES.has(item.state))
      errors.push(
        `${file}: ${item.id}: state must be open, deferred or resolved`,
      );
    const applies = (item["applies-to"] ?? "")
      .split(",")
      .map((part) => part.trim());
    const blocks = (item.blocks ?? "").split(",").map((part) => part.trim());
    if (
      !applies.length ||
      applies.some(
        (id) => !PHASE.test(id) || !phases.some((phase) => phase.id === id),
      )
    )
      errors.push(
        `${file}: ${item.id}: applies-to must name one or more known phases`,
      );
    if (
      blocks.length === 0 ||
      blocks.some(
        (id) =>
          id !== "none" &&
          (!PHASE.test(id) || !phases.some((phase) => phase.id === id)),
      ) ||
      (blocks.includes("none") && blocks.length !== 1)
    )
      errors.push(
        `${file}: ${item.id}: blocks must be "none" or known phase IDs`,
      );
    if (!blocks.includes("none") && blocks.some((id) => !applies.includes(id)))
      errors.push(
        `${file}: ${item.id}: every blocked phase must also appear in applies-to`,
      );
    const checkboxes = [...item.body.matchAll(/^- \[([ xX])\]/gm)];
    if (checkboxes.length !== 1)
      errors.push(
        `${file}: ${item.id}: needs exactly one visible Markdown checkbox`,
      );
    const checkbox = checkboxes[0]?.[1]?.toLowerCase();
    const checkboxLine = item.body
      .split(/\r?\n/)
      .find((line) => /^- \[[ xX]\]/.test(line));
    if (!checkbox)
      errors.push(`${file}: ${item.id}: needs one visible Markdown checkbox`);
    if (!/^- \[[ xX]\]\s+\S/.test(checkboxLine ?? ""))
      errors.push(
        `${file}: ${item.id}: checkbox needs a visible question or assumption`,
      );
    if (item.state === "resolved" && checkbox !== "x")
      errors.push(
        `${file}: ${item.id}: resolved items must have a checked box`,
      );
    if (item.state !== "resolved" && checkbox === "x")
      errors.push(
        `${file}: ${item.id}: open/deferred items must have an unchecked box`,
      );
    if (
      item.state === "resolved" &&
      !/^\s{2}- Resolution: .+$/m.test(item.body)
    )
      errors.push(`${file}: ${item.id}: resolved items need a Resolution line`);
    if (item.state !== "resolved" && /^\s{2}- Resolution: /m.test(item.body))
      errors.push(
        `${file}: ${item.id}: move an earlier answer to Previous resolution when reopening`,
      );
    if (
      item.state === "deferred" &&
      !/^\s{2}- Deferred because: .+$/m.test(item.body)
    )
      errors.push(
        `${file}: ${item.id}: deferred items need a Deferred because line`,
      );
    if (!/^\s{2}- Why it matters: .+$/m.test(item.body))
      errors.push(`${file}: ${item.id}: add a Why it matters line`);
    if (!/^\s{2}- Next action: .+$/m.test(item.body))
      errors.push(`${file}: ${item.id}: add a Next action line`);
    item.appliesTo = applies;
    item.blocks = blocks;
  }
  return items;
}

function parseMarkerAttributes(source) {
  return Object.fromEntries(
    [...source.matchAll(/([a-z-]+)="([^"]*)"/g)].map((entry) => [
      entry[1],
      entry[2],
    ]),
  );
}

function parseScopeHistory(recordText, recordFile, recordFields, errors) {
  const empty = {
    baseline: { state: "unconfirmed", goals: [] },
    changes: [],
  };
  const history = block(
    recordText,
    "scope-history",
    recordFile,
    errors,
    false,
  );
  if (history === undefined) return empty;
  if (recordFields.scope_history_schema !== "1")
    errors.push(`${recordFile}: tri:scope-history needs scope_history_schema: 1`);

  const baselineMatches = [
    ...history.matchAll(/<!-- tri:scope-baseline\s+([^>]+) -->([\s\S]*?)<!-- \/tri:scope-baseline -->/g),
  ];
  if (
    baselineMatches.length !== 1 ||
    (history.match(/<!-- \/?tri:scope-baseline\b/g) ?? []).length !== 2
  ) {
    errors.push(`${recordFile}: scope history needs one balanced scope-baseline block`);
    return empty;
  }
  const baselineAttrs = parseMarkerAttributes(baselineMatches[0][1]);
  const baselineBody = baselineMatches[0][2].trim();
  let baseline = empty.baseline;
  if (baselineAttrs.state === "unconfirmed") {
    if (
      Object.keys(baselineAttrs).join(",") !== "state" ||
      baselineBody
    )
      errors.push(`${recordFile}: an unconfirmed baseline has no metadata or snapshot`);
  } else if (baselineAttrs.state === "confirmed") {
    const expected = ["confirmed", "confirmed-by", "id", "scope-hash", "state"];
    if (Object.keys(baselineAttrs).sort().join(",") !== expected.join(","))
      errors.push(`${recordFile}: a confirmed baseline needs id, date, developer, scope hash and state`);
    if (!/^baseline-[a-z0-9-]+$/.test(baselineAttrs.id ?? ""))
      errors.push(`${recordFile}: confirmed baseline id must start with baseline-`);
    if (!validDate(baselineAttrs.confirmed ?? ""))
      errors.push(`${recordFile}: baseline confirmation date must be YYYY-MM-DD`);
    if (baselineAttrs["confirmed-by"] !== "developer")
      errors.push(`${recordFile}: only explicit developer confirmation establishes a baseline`);
    if (!SHA256.test(baselineAttrs["scope-hash"] ?? ""))
      errors.push(`${recordFile}: confirmed baseline needs a SHA-256 scope-hash`);
    const goals = [];
    for (const line of baselineBody.split(/\r?\n/)) {
      const match = /^- \*\*([a-z][a-z0-9-]*)\*\*\s+[—-]\s+(.+?)\s+Acceptance:\s*(.+)$/.exec(line.trim());
      if (match)
        goals.push({ id: match[1], title: match[2].trim(), acceptance: match[3].trim() });
      else if (line.trim()) errors.push(`${recordFile}: malformed confirmed baseline goal: ${line.trim()}`);
    }
    if (!goals.length) errors.push(`${recordFile}: confirmed baseline needs at least one scope goal`);
    if (new Set(goals.map((goal) => goal.id)).size !== goals.length)
      errors.push(`${recordFile}: confirmed baseline goal IDs must be unique`);
    baseline = {
      id: baselineAttrs.id,
      state: "confirmed",
      confirmed: baselineAttrs.confirmed,
      confirmedBy: baselineAttrs["confirmed-by"],
      scopeHash: baselineAttrs["scope-hash"],
      goals,
    };
  } else {
    errors.push(`${recordFile}: baseline state must be unconfirmed or confirmed`);
  }

  const changes = [];
  const pattern = /<!-- tri:scope-change\s+([^>]+) -->([\s\S]*?)<!-- \/tri:scope-change -->/g;
  for (const match of history.matchAll(pattern)) {
    const attrs = parseMarkerAttributes(match[1]);
    const body = match[2].trim();
    const fieldValue = (label) => new RegExp(`^- ${label}: (.+)$`, "m").exec(body)?.[1]?.trim() ?? "";
    const change = {
      id: attrs.id,
      date: attrs.date,
      kind: attrs.kind,
      origin: attrs.origin,
      disposition: attrs.disposition,
      scopeIds: (attrs["scope-ids"] ?? "").split(",").map((id) => id.trim()),
      summary: fieldValue("Summary"),
      reason: fieldValue("Reason"),
      impact: fieldValue("Impact"),
    };
    changes.push(change);
    const expected = ["date", "disposition", "id", "kind", "origin", "scope-ids"];
    if (Object.keys(attrs).sort().join(",") !== expected.join(","))
      errors.push(`${recordFile}: scope changes need id, date, kind, origin, disposition and scope-ids`);
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(change.id ?? ""))
      errors.push(`${recordFile}: invalid scope-change id ${change.id ?? "(empty)"}`);
    if (!validDate(change.date ?? ""))
      errors.push(`${recordFile}: ${change.id}: scope-change date must be YYYY-MM-DD`);
    if (!SCOPE_CHANGE_KINDS.has(change.kind))
      errors.push(`${recordFile}: ${change.id}: unsupported scope-change kind`);
    if (!SCOPE_CHANGE_ORIGINS.has(change.origin))
      errors.push(`${recordFile}: ${change.id}: unsupported scope-change origin`);
    if (!SCOPE_CHANGE_DISPOSITIONS.has(change.disposition))
      errors.push(`${recordFile}: ${change.id}: unsupported scope-change disposition`);
    if (!change.scopeIds.length || change.scopeIds.some((id) => !PHASE.test(id)))
      errors.push(`${recordFile}: ${change.id}: scope-ids must list stable scope IDs`);
    for (const field of ["summary", "reason", "impact"])
      if (!change[field])
        errors.push(`${recordFile}: ${change.id}: scope change needs ${field}`);
  }
  if ((history.match(/<!-- \/?tri:scope-change\b/g) ?? []).length !== changes.length * 2)
    errors.push(`${recordFile}: malformed or unmatched tri:scope-change markers`);
  const ids = changes.map((change) => change.id);
  if (new Set(ids).size !== ids.length)
    errors.push(`${recordFile}: scope-change IDs must be unique`);
  const remainder = history
    .replace(/<!-- tri:scope-baseline\s+[^>]+ -->[\s\S]*?<!-- \/tri:scope-baseline -->/g, "")
    .replace(/<!-- tri:scope-change\s+[^>]+ -->[\s\S]*?<!-- \/tri:scope-change -->/g, "")
    .trim();
  if (remainder)
    errors.push(`${recordFile}: put all scope history text inside baseline/change markers`);
  return { baseline, changes };
}

function reviewFingerprint(scope, reviewBody) {
  const items = [];
  const pattern = /<!-- tri:item\s+([^>]+) -->([\s\S]*?)<!-- \/tri:item -->/g;
  for (const match of reviewBody.matchAll(pattern)) {
    const attrs = match[1].replace(/state="[^"]+"/, 'state="*"');
    const body = match[2]
      .replace(/^- \[[ xX]\]/gm, "- [ ]")
      .replace(
        /^\s{2}- (?:Resolution|Previous resolution|Deferred because):.*(?:\r?\n|$)/gm,
        "",
      )
      .trim();
    items.push(`<!-- tri:item ${attrs} -->\n${body}\n<!-- /tri:item -->`);
  }
  return createHash("sha256")
    .update(
      `${normalizeHashInput(scope)}\n${normalizeHashInput(items.join("\n"))}`,
    )
    .digest("hex");
}

function parseReview(text, scope, phases, file, errors) {
  const validationStart = errors.length;
  const matches = [
    ...text.matchAll(
      /^<!-- tri:review version="([^"]+)" scope-hash="([^"]+)" reviewed="([^"]+)" reviewer="([^"]+)" -->$/gm,
    ),
  ];
  const openCount = (text.match(/<!-- tri:review\b/g) ?? []).length;
  const closeCount = (text.match(/<!-- \/tri:review -->/g) ?? []).length;
  if (matches.length !== 1 || openCount !== 1 || closeCount !== 1) {
    errors.push(`${file}: needs one balanced versioned tri:review marker`);
    return {
      current: false,
      items: [],
      phases: Object.fromEntries(
        phases.map(({ id }) => [
          id,
          { state: "unassessed", open: 0, blockers: 0 },
        ]),
      ),
    };
  }
  const [marker] = matches;
  const reviewEnd = text.indexOf("<!-- /tri:review -->", marker.index);
  if (reviewEnd < 0) errors.push(`${file}: missing closing tri:review marker`);
  const bodyStart = marker.index + marker[0].length;
  const reviewBody = text.slice(
    bodyStart,
    reviewEnd < 0 ? text.length : reviewEnd,
  );
  const version = marker[1];
  const savedHash = marker[2];
  const reviewed = marker[3];
  const reviewer = marker[4];
  const currentHash = reviewFingerprint(scope, reviewBody);
  if (version !== "1")
    errors.push(`${file}: unsupported review schema ${version}`);
  if (!SHA256.test(savedHash) || savedHash !== currentHash)
    errors.push(
      `${file}: readiness review is missing or stale; inspect scope and run review before relying on its badge`,
    );
  if (!validDate(reviewed))
    errors.push(`${file}: review date must be YYYY-MM-DD`);
  if (!/^[A-Za-z0-9_. -]+$/.test(reviewer) || !reviewer.trim())
    errors.push(
      `${file}: review must name a simple reviewer role, such as agent or developer`,
    );
  const items = parseItems(reviewBody, phases, file, errors);
  const itemOnly = reviewBody
    .replace(/<!-- tri:item\s+[^>]+ -->[\s\S]*?<!-- \/tri:item -->/g, "")
    .trim();
  if (itemOnly)
    errors.push(
      `${file}: put all readiness text inside structured tri:item markers`,
    );
  const current =
    errors.length === validationStart &&
    version === "1" &&
    SHA256.test(savedHash) &&
    savedHash === currentHash &&
    validDate(reviewed) &&
    Boolean(reviewer.trim());
  const phaseReadiness = {};
  for (const phase of phases) {
    const relevant = items.filter(
      (item) => item.appliesTo?.includes(phase.id) && item.state !== "resolved",
    );
    const blockers = relevant.filter(
      (item) =>
        !item.blocks?.includes("none") && item.blocks?.includes(phase.id),
    ).length;
    phaseReadiness[phase.id] = {
      state: !current
        ? "unassessed"
        : blockers
          ? "needs-resolution"
          : relevant.length
            ? "open-items"
            : "ready",
      open: relevant.length,
      blockers,
    };
  }
  return {
    current,
    version,
    scopeHash: currentHash,
    reviewed,
    reviewer,
    items,
    phases: phaseReadiness,
  };
}

function parseRelations(scope, file, errors) {
  const relations = [];
  const expression =
    /^- \*\*(depends-on|builds-on|alternative-to|supersedes|related-to)\*\*:\s+\[([^\]]+)\]\(([^)]+)\)\s*$/gm;
  for (const match of scope.matchAll(expression)) {
    relations.push({ type: match[1], title: match[2], href: match[3] });
  }
  const declarations = [...scope.matchAll(/^- \*\*([^*]+)\*\*:/gm)];
  if (declarations.length !== relations.length)
    errors.push(
      `${file}: relationships must use a supported type and link format`,
    );
  for (const declaration of declarations)
    if (!RELATION_TYPES.has(declaration[1]))
      errors.push(`${file}: unsupported relation ${declaration[1]}`);
  return relations;
}

function frontmatterList(text, field) {
  const match = new RegExp(`^${field}:\\r?\\n((?:  - .*\\r?\\n?)+)`, "m").exec(
    text,
  );
  return match
    ? [...match[1].matchAll(/^  - (.+)$/gm)].map((line) =>
        line[1].trim().replace(/^(['"])(.*)\1$/, "$2"),
      )
    : [];
}

function resolveRelation(root, sourceFile, href) {
  const [target, phase] = href.split("#");
  const absolute = target.startsWith("/")
    ? projectPath(root, target)
    : path.resolve(path.dirname(sourceFile), target);
  return {
    path: `/${path.relative(root, absolute).split(path.sep).join("/")}`,
    phase: phase || undefined,
  };
}

async function readPlans(root, errors) {
  const documents = [];
  const plansDir = path.join(root, "docs", "plans");
  const planIndex = await readFileIfPresent(path.join(plansDir, "index.md"));
  const recordIndex = await readFileIfPresent(
    path.join(root, "docs", "runbook", "index.md"),
  );
  for (const filename of await markdownFiles(plansDir)) {
    const text = await readFile(filename, "utf8");
    const fields = frontmatter(text, filename, errors);
    const relative = path.relative(root, filename).split(path.sep).join("/");
    if (fields.map_schema === undefined) {
      if (fields.type !== "Plan") continue;
      const stem = path.basename(filename, ".md");
      const number = numericPrefix(path.basename(filename));
      const legacySlug = stem
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      documents.push({
        id: number ? `plan-${number}` : `legacy-plan-${legacySlug}`,
        number: number ? Number(number) : null,
        initiativeId: `legacy-${legacySlug}`,
        title: fields.title ?? stem,
        plan: `/${relative}`,
        record: fields.runbook ?? null,
        recordId: null,
        scopeHash: null,
        mapped: false,
        review: { state: "unassessed", reviewed: null, reviewer: null },
        phases: [],
        progress: null,
        relations: [],
        _filename: filename,
        _text: text,
      });
      continue;
    }
    if (fields.map_schema !== "1") {
      errors.push(`${filename}: unsupported map_schema ${fields.map_schema}`);
      continue;
    }
    const scope = block(text, "scope", filename, errors);
    const phases = scope ? parsePhases(scope, filename, errors) : [];
    const progress = parseProgress(text, phases, filename, errors);
    const review = scope
      ? parseReview(text, scope, phases, filename, errors)
      : { current: false, items: [], phases: {} };
    const initiative = fields.initiative_id;
    if (!initiative || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(initiative))
      errors.push(`${filename}: initiative_id must be a stable lowercase slug`);
    if (!fields.title)
      errors.push(`${filename}: frontmatter title is required`);
    if (fields.type !== "Plan")
      errors.push(
        `${filename}: map_schema: 1 documents must retain type: Plan`,
      );
    if (!fields.runbook)
      errors.push(
        `${filename}: reciprocal runbook reference is required during compatibility period`,
      );
    const recordPath = fields.runbook ? projectPath(root, fields.runbook) : "";
    const recordRelative = fields.runbook
      ? path.relative(path.join(root, "docs", "runbook"), recordPath)
      : "";
    if (
      fields.runbook &&
      (recordRelative === ".." ||
        recordRelative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(recordRelative) ||
        !recordRelative.toLowerCase().endsWith(".md"))
    )
      errors.push(
        `${filename}: runbook must point to an Engineering Record under docs/runbook`,
      );
    const documentId = fields.document_id;
    const idNumber = /^plan-(\d+)$/.exec(documentId ?? "")?.[1];
    if (!idNumber)
      errors.push(
        `${filename}: document_id must be a stable plan-NNN identifier`,
      );
    const filenameNumber = numericPrefix(path.basename(filename));
    if (
      filenameNumber &&
      idNumber &&
      Number(filenameNumber) !== Number(idNumber)
    )
      errors.push(`${filename}: filename number does not match document_id`);
    const recordText = fields.runbook
      ? await readFileIfPresent(recordPath)
      : "";
    if (
      fields.runbook &&
      !frontmatterList(recordText, "plans").includes(`/${relative}`)
    )
      errors.push(
        `${filename}: Engineering Record must reciprocally list /${relative} in plans:`,
      );
    if (fields.runbook && !/^type:\s*Runbook\s*$/m.test(recordText))
      errors.push(
        `${filename}: paired Engineering Record must retain type: Runbook during the compatibility period`,
      );
    const recordFields = recordText
      ? frontmatter(recordText, recordPath, errors)
      : {};
    const scopeHistory = parseScopeHistory(
      recordText,
      recordPath,
      recordFields,
      errors,
    );
    if (!/^er-\d+$/.test(recordFields.record_id ?? ""))
      errors.push(
        `${recordPath || filename}: record_id must be a stable er-NNN identifier`,
      );
    const recordNumber = /^er-(\d+)$/.exec(recordFields.record_id ?? "")?.[1];
    const recordFilenameNumber = recordRelative
      ? numericPrefix(path.basename(recordRelative))
      : undefined;
    if (
      recordFilenameNumber &&
      recordNumber &&
      Number(recordFilenameNumber) !== Number(recordNumber)
    )
      errors.push(`${recordPath}: filename number does not match record_id`);
    if (!planIndex.includes(`(${`/${relative}`})`))
      errors.push(`${filename}: add the plan to docs/plans/index.md`);
    if (fields.runbook && !recordIndex.includes(`(${fields.runbook})`))
      errors.push(
        `${filename}: add the Engineering Record to docs/runbook/index.md`,
      );
    const relations = scope
      ? parseRelations(scope, filename, errors).map((relation) => ({
          ...relation,
          ...resolveRelation(root, filename, relation.href),
        }))
      : [];
    for (const relation of relations) {
      const targetPath = projectPath(root, relation.path);
      const relativeTarget = path.relative(root, targetPath);
      if (
        relativeTarget === ".." ||
        relativeTarget.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeTarget)
      )
        errors.push(
          `${filename}: relation target escapes the project root: ${relation.href}`,
        );
      if (!(await exists(targetPath)))
        errors.push(
          `${filename}: relation target does not exist: ${relation.path}`,
        );
      if (relation.phase && !PHASE.test(relation.phase))
        errors.push(`${filename}: invalid relation phase ${relation.phase}`);
    }
    const done = Object.values(progress).filter(
      (state) => state === "done",
    ).length;
    documents.push({
      id: documentId ?? "",
      number: Number(idNumber ?? filenameNumber ?? 0),
      initiativeId: initiative ?? "",
      title: fields.title,
      outcome:
        /## Intended outcome\s*\r?\n([\s\S]*?)(?=\r?\n## |$)/.exec(scope ?? "")?.[1]
          ?.trim() ?? "",
      plan: `/${relative}`,
      record: fields.runbook ?? "",
      recordId: recordFields.record_id ?? null,
      scopeHash: review.scopeHash,
      mapped: true,
      review: {
        state: review.current ? "reviewed" : "unassessed",
        reviewed: review.reviewed ?? null,
        reviewer: review.reviewer ?? null,
        items: review.items.map(({ id, kind, state, appliesTo, blocks, body }) => ({
          id,
          kind,
          state,
          appliesTo,
          blocks,
          body,
        })),
      },
      phases: phases.map((phase) => ({
        ...phase,
        progress: progress[phase.id] ?? "planned",
        readiness: review.phases[phase.id] ?? {
          state: "unassessed",
          open: 0,
          blockers: 0,
        },
      })),
      progress: {
        done,
        total: phases.length,
        percent: phases.length ? Math.round((done / phases.length) * 100) : 0,
      },
      relations,
      scopeHistory,
      _filename: filename,
      _text: text,
    });
  }
  return documents;
}

async function readFileIfPresent(filename) {
  try {
    return await readFile(filename, "utf8");
  } catch {
    return "";
  }
}

async function exists(filename) {
  try {
    await realpath(filename);
    return true;
  } catch {
    return false;
  }
}

function validateRelationGraph(root, documents, errors) {
  const byPath = new Map(
    documents.map((document) => [
      path.normalize(projectPath(root, document.plan)),
      document,
    ]),
  );
  for (const document of documents)
    for (const relation of document.relations) {
      const target = byPath.get(
        path.normalize(projectPath(root, relation.path)),
      );
      if (!target) continue; // Existing unconverted plans remain valid relation targets.
      if (
        relation.phase &&
        !target.phases.some((phase) => phase.id === relation.phase)
      )
        errors.push(
          `${document.plan}: relation points to missing phase ${relation.phase} in ${relation.path}`,
        );
    }
  const graph = new Map(documents.map((document) => [document.plan, []]));
  for (const document of documents)
    for (const relation of document.relations) {
      if (relation.type === "depends-on" && graph.has(relation.path))
        graph.get(document.plan).push(relation.path);
    }
  const visiting = new Set();
  const visited = new Set();
  const visit = (node) => {
    if (visiting.has(node)) {
      errors.push(`dependency cycle includes ${node}`);
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    for (const target of graph.get(node) ?? []) visit(target);
    visiting.delete(node);
    visited.add(node);
  };
  for (const node of graph.keys()) visit(node);
}

async function readPlansAndValidate(root) {
  const errors = [];
  const documents = await readPlans(root, errors);
  const documentIds = new Set();
  const recordIds = new Map();
  for (const document of documents) {
    if (documentIds.has(document.id))
      errors.push(
        `${document.plan}: duplicate document identity ${document.id}`,
      );
    documentIds.add(document.id);
    if (!document.recordId) continue;
    const priorRecordPath = recordIds.get(document.recordId);
    if (priorRecordPath && priorRecordPath !== document.record)
      errors.push(
        `${document.plan}: duplicate Engineering Record identity ${document.recordId}`,
      );
    recordIds.set(document.recordId, document.record);
  }
  validateRelationGraph(root, documents, errors);
  return { documents, errors };
}

function templateValues({
  number,
  title,
  description,
  slug,
  initiativeId,
  date,
}) {
  const yaml = (value) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return {
    NUMBER: number,
    TITLE: title,
    TITLE_YAML: yaml(title),
    DESCRIPTION: description,
    DESCRIPTION_YAML: yaml(description),
    SLUG: slug,
    INITIATIVE_ID: initiativeId,
    DATE: date,
  };
}

function fillTemplate(source, values, filename) {
  const output = source.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
    if (values[key] === undefined)
      throw new Error(`${filename}: no value for template field ${key}`);
    return String(values[key]);
  });
  const pending = output.match(/\{\{[^}]+\}\}/);
  if (pending)
    throw new Error(`${filename}: unresolved template field ${pending[0]}`);
  return output;
}

function numericPrefix(filename) {
  return /^(\d{3,})(?:[_-]|\.)/.exec(filename)?.[1];
}

export async function nextNumber(root = DEFAULT_ROOT) {
  let highest = 0;
  for (const folder of ["docs/plans", "docs/runbook"])
    for (const filename of await markdownFiles(path.join(root, folder))) {
      const prefix = numericPrefix(path.basename(filename));
      if (prefix) highest = Math.max(highest, Number(prefix));
      const body = await readFile(filename, "utf8");
      for (const match of body.matchAll(
        /^(?:document_id:\s*plan-|record_id:\s*er-)(\d+)\s*$/gm,
      )) {
        highest = Math.max(highest, Number(match[1]));
      }
    }
  return highest + 1;
}

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function withIndexLock(root, action) {
  const lock = path.join(root, "docs", ".engineering-records.lock");
  let handle;
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      handle = await open(lock, "wx");
      try {
        await handle.writeFile(String(process.pid), "utf8");
      } catch (error) {
        await handle.close();
        await unlink(lock).catch(() => {});
        throw error;
      }
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      await wait(20);
    }
  }
  if (!handle) {
    const owner = await readFile(lock, "utf8").catch(() => "unknown");
    throw new Error(
      `Timed out waiting for docs/.engineering-records.lock (owner PID ${owner.trim() || "unknown"}). Retry when it is free; remove the lock only after confirming that process has stopped.`,
    );
  }
  try {
    return await action();
  } finally {
    await handle.close().catch(() => {});
    await unlink(lock).catch(() => {});
  }
}

async function atomicWrite(filename, content) {
  const temp = `${filename}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, content, { encoding: "utf8", flag: "wx" });
  try {
    await rename(temp, filename);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

function addIndexRow(source, row, number, kind, filename) {
  const lines = source.split(/\r?\n/);
  const separator = lines.findIndex((line) => /^\|\s*:?-{2,}/.test(line));
  if (separator < 0)
    throw new Error(`${filename}: expected a Markdown index table`);
  const pathPrefix = kind === "plan" ? "/docs/plans/" : "/docs/runbook/";
  if (source.includes(pathPrefix + `${String(number).padStart(3, "0")}_`))
    return source;
  let insertion = lines.findIndex(
    (line, index) =>
      index > separator && /^(Convention:|Existing records)/.test(line),
  );
  if (insertion < 0) insertion = lines.length;
  for (let index = separator + 1; index < lines.length; index++) {
    const reference = new RegExp(
      `\\(${pathPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d{3,})_`,
    ).exec(lines[index]);
    if (reference && Number(reference[1]) > number) {
      insertion = index;
      break;
    }
  }
  while (insertion > separator + 1 && lines[insertion - 1] === "") insertion--;
  lines.splice(insertion, 0, row);
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  return lines.join(newline);
}

async function updateIndexes(root, number, title, stem) {
  const planIndex = path.join(root, "docs", "plans", "index.md");
  const recordIndex = path.join(root, "docs", "runbook", "index.md");
  const [oldPlan, oldRecord] = await Promise.all([
    readFile(planIndex, "utf8"),
    readFile(recordIndex, "utf8"),
  ]);
  const padded = String(number).padStart(3, "0");
  const planPath = `/docs/plans/${stem}.md`;
  const recordPath = `/docs/runbook/${stem}.md`;
  const nextPlan = addIndexRow(
    oldPlan,
    `| [${title}](${planPath}) | planned | [ER ${padded}](${recordPath}) |`,
    number,
    "plan",
    planIndex,
  );
  const nextRecord = addIndexRow(
    oldRecord,
    `| [${title}](${recordPath}) | [PLAN-${padded}](${planPath}) |`,
    number,
    "record",
    recordIndex,
  );
  if (nextPlan !== oldPlan) await atomicWrite(planIndex, nextPlan);
  try {
    if (nextRecord !== oldRecord) await atomicWrite(recordIndex, nextRecord);
  } catch (error) {
    if (nextPlan !== oldPlan)
      await atomicWrite(planIndex, oldPlan).catch(() => {});
    throw error;
  }
}

export async function createPair({
  root = DEFAULT_ROOT,
  templateRoot = DEFAULT_ROOT,
  title,
  slug,
  description = "Implementation goals and acceptance criteria.",
  initiativeId = slug,
  date = new Date().toISOString().slice(0, 10),
}) {
  if (!title?.trim() || /[\r\n]/.test(title))
    throw new Error("Provide a one-line --title");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug ?? ""))
    throw new Error("--slug must be a lowercase kebab-case name");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(initiativeId ?? ""))
    throw new Error("--initiative must be a lowercase stable slug");
  if (/[\r\n]/.test(description))
    throw new Error("Provide a one-line --description");
  const valuesBase = {
    title: title.trim(),
    slug,
    initiativeId,
    description: description.trim() || title.trim(),
    date,
  };
  const planTemplate = await readFile(
    path.join(templateRoot, PLAN_TEMPLATE),
    "utf8",
  );
  const recordTemplate = await readFile(
    path.join(templateRoot, RECORD_TEMPLATE),
    "utf8",
  );
  const plansDir = path.join(root, "docs", "plans");
  const recordsDir = path.join(root, "docs", "runbook");
  await Promise.all([
    mkdir(plansDir, { recursive: true }),
    mkdir(recordsDir, { recursive: true }),
  ]);
  return withIndexLock(root, async () => {
    for (let tries = 0; tries < 30; tries++) {
      const number = String(await nextNumber(root)).padStart(3, "0");
      const stem = `${number}_${slug}`;
      const planFile = path.join(plansDir, `${stem}.md`);
      const recordFile = path.join(recordsDir, `${stem}.md`);
      const values = templateValues({ ...valuesBase, number });
      const planText = fillTemplate(planTemplate, values, PLAN_TEMPLATE);
      const recordText = fillTemplate(recordTemplate, values, RECORD_TEMPLATE);
      let planHandle;
      let recordHandle;
      try {
        planHandle = await open(planFile, "wx");
      } catch (error) {
        if (error.code === "EEXIST") continue;
        throw error;
      }
      try {
        await planHandle.writeFile(planText, "utf8");
        await planHandle.close();
        planHandle = undefined;
        recordHandle = await open(recordFile, "wx");
        await recordHandle.writeFile(recordText, "utf8");
        await recordHandle.close();
        await updateIndexes(
          root,
          Number(number),
          title.trim().replace(/\|/g, "\\|"),
          stem,
        );
        return {
          number,
          plan: path.relative(root, planFile).split(path.sep).join("/"),
          record: path.relative(root, recordFile).split(path.sep).join("/"),
        };
      } catch (error) {
        await planHandle?.close().catch(() => {});
        await recordHandle?.close().catch(() => {});
        await unlink(planFile).catch(() => {});
        if (recordHandle) await unlink(recordFile).catch(() => {});
        if (error.code === "EEXIST")
          throw new Error(
            `Cannot create pair ${number}: an Engineering Record already uses ${path.basename(recordFile)}. Resolve the partial pair before retrying.`,
          );
        throw error;
      }
    }
    throw new Error(
      "Could not allocate a document number after 30 collisions; retry the command.",
    );
  });
}

export async function refreshReview({
  root = DEFAULT_ROOT,
  planPath,
  reviewer,
  date = new Date().toISOString().slice(0, 10),
}) {
  if (!planPath) throw new Error("Provide a plan path");
  if (!/^[A-Za-z0-9_. -]+$/.test(reviewer ?? "") || !reviewer.trim())
    throw new Error("Provide --reviewer agent or developer");
  if (!validDate(date))
    throw new Error("Review date must be a valid YYYY-MM-DD date");
  const filename = projectPath(root, planPath.replace(/\\/g, "/"));
  const relative = path.relative(path.join(root, "docs", "plans"), filename);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    !relative.toLowerCase().endsWith(".md")
  )
    throw new Error("Review can only refresh a Markdown file under docs/plans");
  if (Number.isNaN(Date.parse(`${date}T00:00:00Z`)))
    throw new Error("Review date must be a valid YYYY-MM-DD date");
  const text = await readFile(filename, "utf8");
  const errors = [];
  const scope = block(text, "scope", filename, errors);
  if (!scope || errors.length) throw new Error(errors.join("\n"));
  const reviewMarker =
    /^<!-- tri:review version="([^"]+)" scope-hash="([^"]+)" reviewed="([^"]+)" reviewer="([^"]+)" -->$/m;
  const existingReview = reviewMarker.exec(text);
  if (!existingReview)
    throw new Error(
      `${filename}: add one tri:review marker before refreshing review`,
    );
  const close = text.indexOf(
    "<!-- /tri:review -->",
    existingReview.index + existingReview[0].length,
  );
  if (close < 0)
    throw new Error(`${filename}: missing closing tri:review marker`);
  const body = text.slice(
    existingReview.index + existingReview[0].length,
    close,
  );
  const reviewErrors = [];
  const phases = parsePhases(scope, filename, reviewErrors);
  parseItems(body, phases, filename, reviewErrors);
  if ((text.match(/^<!-- tri:review\b/gm) ?? []).length !== 1)
    reviewErrors.push(`${filename}: expected one review section`);
  if (existingReview[1] !== "1")
    reviewErrors.push(
      `${filename}: unsupported review schema ${existingReview[1]}`,
    );
  if (reviewErrors.length) throw new Error(reviewErrors.join("\n"));
  const scopeHash = reviewFingerprint(scope, body);
  const updated = text.replace(
    reviewMarker,
    `<!-- tri:review version="1" scope-hash="${scopeHash}" reviewed="${date}" reviewer="${reviewer.trim()}" -->`,
  );
  const temp = `${filename}.${process.pid}.tmp`;
  await writeFile(temp, updated, { encoding: "utf8", flag: "wx" });
  try {
    await rename(temp, filename);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
  return {
    file: filename,
    scopeHash,
    reviewed: date,
    reviewer: reviewer.trim(),
  };
}

export async function confirmScopeBaseline({
  root = DEFAULT_ROOT,
  planPath,
  developerConfirmed = false,
  confirmedDate = new Date().toISOString().slice(0, 10),
}) {
  if (!developerConfirmed)
    throw new Error(
      "Baseline confirmation requires --developer-confirmed after the developer explicitly confirms the exact scope.",
    );
  if (!planPath) throw new Error("A plan path is required.");
  if (!validDate(confirmedDate)) throw new Error("Invalid baseline confirmation date.");
  const filename = projectPath(root, planPath.replace(/\\/g, "/"));
  const relative = path.relative(root, filename);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error("Plan path must stay inside the project root.");
  const errors = [];
  const text = await readFile(filename, "utf8");
  const fields = frontmatter(text, filename, errors);
  if (fields.map_schema !== "1")
    throw new Error("Only mapped Plan schema 1 documents can establish a baseline.");
  const scope = block(text, "scope", filename, errors);
  const phases = scope ? parsePhases(scope, filename, errors) : [];
  if (errors.length) throw new Error(errors.join("\n"));
  const recordPath = fields.runbook ? projectPath(root, fields.runbook) : "";
  if (!recordPath) throw new Error("The plan needs a paired Engineering Record.");
  let recordText = await readFile(recordPath, "utf8");
  const recordFields = frontmatter(recordText, recordPath, errors);
  if (recordFields.scope_history_schema !== "1")
    throw new Error("The Engineering Record needs scope_history_schema: 1.");
  const history = block(recordText, "scope-history", recordPath, errors);
  if (history === undefined) throw new Error("The Engineering Record needs a tri:scope-history block.");
  const baselineMatch = /<!-- tri:scope-baseline\s+([^>]+) -->([\s\S]*?)<!-- \/tri:scope-baseline -->/.exec(history);
  if (!baselineMatch) throw new Error("The scope history needs one balanced baseline block.");
  const baseline = parseMarkerAttributes(baselineMatch[1]);
  if (baseline.state !== "unconfirmed")
    throw new Error("This Engineering Record already has a confirmed baseline; never replace it.");
  const scopeHash = createHash("sha256").update(normalizeHashInput(scope)).digest("hex");
  const snapshot = phases
    .map((phase) => `- **${phase.id}** — ${phase.title} Acceptance: ${phase.acceptance}`)
    .join("\n");
  const confirmed = `<!-- tri:scope-baseline id="baseline-${fields.document_id}" state="confirmed" confirmed="${confirmedDate}" confirmed-by="developer" scope-hash="${scopeHash}" -->\n${snapshot}\n<!-- /tri:scope-baseline -->`;
  const updatedHistory = history.replace(baselineMatch[0], confirmed);
  recordText = recordText.replace(
    /<!-- tri:scope-history -->[\s\S]*?<!-- \/tri:scope-history -->/,
    `<!-- tri:scope-history -->\n${updatedHistory}\n<!-- /tri:scope-history -->`,
  );
  const temp = `${recordPath}.${process.pid}.tmp`;
  await writeFile(temp, recordText, { encoding: "utf8", flag: "wx" });
  try {
    await rename(temp, recordPath);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
  return { recordPath, baselineId: `baseline-${fields.document_id}`, scopeHash, confirmedDate };
}

export async function inspectDocuments(root = DEFAULT_ROOT) {
  const { documents, errors } = await readPlansAndValidate(root);
  return {
    manifest: {
      schemaVersion: 1,
      documents: documents.map(
        ({ _filename, _text, ...publicDocument }) => publicDocument,
      ),
    },
    errors,
  };
}

function parseFlags(args) {
  const result = {};
  result._positionals = [];
  for (let index = 0; index < args.length; index++) {
    if (!args[index].startsWith("--")) {
      result._positionals.push(args[index]);
      continue;
    }
    const key = args[index].slice(2);
    result[key] =
      args[index + 1]?.startsWith("--") || args[index + 1] === undefined
        ? true
        : args[++index];
  }
  return result;
}

function help() {
  return `Engineering document helper\n\n  npm run docs:records:next\n  npm run docs:records:new -- --title "Water scattering" --slug water-scattering\n  npm run docs:records:review -- docs/plans/NNN_topic.md agent\n  npm run docs:records:baseline -- docs/plans/NNN_topic.md --developer-confirmed\n  npm run docs:records:check\n  npm run docs:records:manifest [--output path]\n\nReview refreshes an agent assessment; it does not signify developer approval. Baseline confirmation requires explicit developer approval of the exact scope snapshot.`;
}

export async function main(args = process.argv.slice(2), root = DEFAULT_ROOT) {
  const [command, ...rest] = args;
  const flags = parseFlags(rest);
  if (flags.root === true) throw new Error("--root requires a directory");
  const projectRoot = flags.root ? path.resolve(root, flags.root) : root;
  if (command === "help" || command === "--help" || !command) {
    console.log(help());
    return 0;
  }
  if (command === "next") {
    console.log(String(await nextNumber(projectRoot)).padStart(3, "0"));
    return 0;
  }
  if (command === "new") {
    const result = await createPair({
      root: projectRoot,
      templateRoot: DEFAULT_ROOT,
      title: flags.title,
      slug: flags.slug,
      initiativeId: flags.initiative ?? flags.slug,
      description: flags.description,
    });
    console.log(
      `Created PLAN-${result.number} and ER ${result.number}: ${result.plan}, ${result.record}`,
    );
    return 0;
  }
  if (command === "review") {
    const planPath = flags._positionals[0];
    const result = await refreshReview({
      root: projectRoot,
      planPath,
      reviewer: flags.reviewer ?? flags._positionals[1],
    });
    console.log(
      `Refreshed ${result.file} scope review (${result.scopeHash}); this records the named review role, not developer approval.`,
    );
    return 0;
  }
  if (command === "baseline") {
    const result = await confirmScopeBaseline({
      root: projectRoot,
      planPath: flags._positionals[0],
      developerConfirmed: flags["developer-confirmed"] === true,
    });
    console.log(
      `Recorded developer-confirmed ${result.baselineId} in ${path.relative(projectRoot, result.recordPath)} (${result.scopeHash}).`,
    );
    return 0;
  }
  if (command === "check" || command === "manifest") {
    const { manifest, errors } = await inspectDocuments(projectRoot);
    if (command === "manifest") {
      const serialized = `${JSON.stringify({ ...manifest, diagnostics: errors }, null, 2)}\n`;
      if (flags.output === true) throw new Error("--output requires a file path");
      if (flags.output) {
        const output = path.resolve(projectRoot, flags.output);
        await mkdir(path.dirname(output), { recursive: true });
        await writeFile(output, serialized, { encoding: "utf8" });
        console.log(`Wrote ${path.relative(projectRoot, output)}`);
      } else {
        console.log(serialized);
      }
      return 0;
    }
    if (errors.length) {
      for (const error of errors) console.error(`ERROR ${error}`);
      return 1;
    }
    console.log(
      `OK: ${manifest.documents.filter((document) => document.mapped).length} mapped and ${manifest.documents.filter((document) => !document.mapped).length} legacy plan(s); review freshness, phase readiness, relations and reciprocal record links are valid.`,
    );
    return 0;
  }
  console.error(help());
  return 2;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
