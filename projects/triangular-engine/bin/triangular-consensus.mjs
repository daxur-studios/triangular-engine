#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OUTCOMES = new Set([
  "pending",
  "recommended",
  "contenders",
  "needs-evidence",
  "unresolved",
]);

function templatePath() {
  return path.join(PACKAGE_ROOT, "docs", "templates", "consensus-review.md");
}

function parseFlags(args) {
  const result = { _positionals: [] };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      result._positionals.push(arg);
      continue;
    }
    const equal = arg.indexOf("=");
    const key = arg.slice(2, equal < 0 ? undefined : equal);
    if (equal >= 0) {
      result[key] = arg.slice(equal + 1);
      continue;
    }
    result[key] =
      args[index + 1] === undefined || args[index + 1].startsWith("--")
        ? true
        : args[++index];
  }
  return result;
}

function quoteYaml(value) {
  return JSON.stringify(value);
}

function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) throw new Error("Consensus file has missing or malformed frontmatter");
  const values = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([a-z][a-z0-9_-]*):\s*(.*?)\s*$/.exec(line);
    if (!field) continue;
    const raw = field[2];
    try {
      values[field[1]] = raw.startsWith('"') ? JSON.parse(raw) : raw;
    } catch {
      values[field[1]] = raw;
    }
  }
  return values;
}

function setFrontmatterField(text, key, value) {
  const line = `${key}: ${value}`;
  const pattern = new RegExp(`^${key}:.*$`, "m");
  if (pattern.test(text)) return text.replace(pattern, line);
  return text.replace(/\r?\n---(?:\r?\n|$)/, `\n${line}\n---\n`);
}

function normalized(value) {
  return value.replace(/\r\n?/g, "\n").trim();
}

function extractBlock(text, start, end, name) {
  const first = text.indexOf(start);
  const last = text.indexOf(end);
  if (first < 0 || last < 0 || last <= first)
    throw new Error(`Consensus file needs one balanced ${name} block`);
  if (text.indexOf(start, first + start.length) >= 0 || text.indexOf(end, last + end.length) >= 0)
    throw new Error(`Consensus file has duplicate ${name} markers`);
  return text.slice(first + start.length, last).trim();
}

function briefFrom(text) {
  return extractBlock(
    text,
    "<!-- tri:consensus-brief -->",
    "<!-- /tri:consensus-brief -->",
    "tri:consensus-brief",
  );
}

function briefHash(text) {
  return createHash("sha256").update(normalized(briefFrom(text))).digest("hex");
}

function roundBounds(text, round) {
  const start = `<!-- tri:consensus-round round="${round}" -->`;
  const startAt = text.indexOf(start);
  if (startAt < 0) throw new Error(`Missing round ${round} section`);
  const contentAt = startAt + start.length;
  const endAt = text.indexOf("<!-- /tri:consensus-round -->", contentAt);
  if (endAt < 0) throw new Error(`Unclosed round ${round} section`);
  return { contentAt, endAt };
}

function responseMatches(roundText) {
  const pattern =
    /<!-- tri:consensus-response round="([12])" participant="([a-z0-9-]+)" model="([^\"]*)" -->\r?\n([\s\S]*?)\r?\n<!-- \/tri:consensus-response -->/g;
  return [...roundText.matchAll(pattern)].map((match) => ({
    round: Number(match[1]),
    participant: match[2],
    model: decodeURIComponent(match[3]),
    body: match[4].trim(),
    full: match[0],
    index: match.index,
  }));
}

async function withLock(lockPath, action) {
  await mkdir(path.dirname(lockPath), { recursive: true });
  let handle;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      handle = await open(lockPath, "wx");
      break;
    } catch (error) {
      if (error.code !== "EEXIST" || attempt === 39) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    return await action();
  } finally {
    await handle?.close();
    await unlink(lockPath).catch(() => {});
  }
}

async function atomicWrite(filename, contents) {
  const temp = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, contents, { encoding: "utf8", flag: "wx" });
  try {
    await rename(temp, filename);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

function indexHeader() {
  return `# Consensus Reviews\n\n| ID | Decision | Linked Plan | File |\n| --- | --- | --- | --- |\n`;
}

async function updateIndex(root, id, title, relativeFile, plan) {
  const indexFile = path.join(root, "docs", "consensus", "index.md");
  await withLock(`${indexFile}.lock`, async () => {
    let content;
    try {
      content = await readFile(indexFile, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      content = indexHeader();
    }
    const row = `| ${id} | ${title.replaceAll("|", "\\|")} | ${plan ? `[Plan](${plan})` : "—"} | [Review](/${relativeFile.split(path.sep).join("/")}) |`;
    const lines = content.split(/\r?\n/);
    const existing = lines.findIndex((line) => line.startsWith(`| ${id} |`));
    if (existing >= 0) lines[existing] = row;
    else lines.push(row);
    const output = `${lines.filter((line, index) => line || index < 4).join("\n").replace(/\n*$/, "\n")}`;
    await atomicWrite(indexFile, output);
  });
}

async function reviewFiles(root) {
  const directory = path.join(root, "docs", "consensus");
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && /^C\d+_.+\.md$/.test(entry.name))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

async function findReview(root, identifier) {
  if (!identifier) throw new Error("Provide a consensus ID, e.g. C001");
  const files = await reviewFiles(root);
  for (const filename of files) {
    const text = await readFile(filename, "utf8");
    const fields = frontmatter(text);
    if (
      fields.consensus_id?.toLowerCase() === identifier.toLowerCase() ||
      fields.consensus_key === identifier
    )
      return { filename, text, fields };
  }
  throw new Error(`No consensus review found for ${identifier}`);
}

async function createReview(root, flags) {
  const slug = flags.slug;
  const title = flags.title;
  const question = flags.question;
  if (!slug || !SLUG.test(slug))
    throw new Error("Provide --slug in lowercase kebab-case");
  if (!title || !String(title).trim()) throw new Error("Provide --title");
  if (!question || String(question).includes("\n"))
    throw new Error("Provide a one-line --question");

  const directory = path.join(root, "docs", "consensus");
  await mkdir(directory, { recursive: true });
  return withLock(path.join(directory, ".create.lock"), async () => {
    for (const filename of await reviewFiles(root)) {
      const existing = await readFile(filename, "utf8");
      const fields = frontmatter(existing);
      if (fields.consensus_key !== slug) continue;
      const brief = briefFrom(existing);
      const linkConflict =
        (flags.plan !== undefined && fields.plan !== flags.plan) ||
        (flags.record !== undefined && fields.record !== flags.record);
      if (
        fields.title !== title ||
        !brief.includes(`\n${question}\n`) ||
        linkConflict
      )
        throw new Error(
          `Consensus key ${slug} already exists with different input; left unchanged at ${path.relative(root, filename)}`,
        );
      await updateIndex(
        root,
        fields.consensus_id,
        fields.title,
        path.relative(root, filename),
        fields.plan,
      );
      return { id: fields.consensus_id, filename, created: false };
    }

    let highest = 0;
    for (const filename of await reviewFiles(root)) {
      const id = /^C(\d+)_/.exec(path.basename(filename))?.[1];
      if (id) highest = Math.max(highest, Number(id));
    }
    try {
      const index = await readFile(path.join(directory, "index.md"), "utf8");
      for (const match of index.matchAll(/^\| C(\d+) \|/gm))
        highest = Math.max(highest, Number(match[1]));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const template = await readFile(templatePath(), "utf8");
    const date = new Date().toISOString().slice(0, 10);
    while (true) {
      const id = `C${String(++highest).padStart(3, "0")}`;
      const filename = path.join(directory, `${id}_${slug}.md`);
      const body = template
        .replaceAll("{{CONSENSUS_ID}}", id)
        .replaceAll("{{CONSENSUS_KEY}}", slug)
        .replaceAll("{{TITLE_YAML}}", quoteYaml(title))
        .replaceAll("{{TITLE}}", title)
        .replaceAll("{{DATE}}", date)
        .replaceAll("{{PLAN_YAML}}", flags.plan ? quoteYaml(flags.plan) : "null")
        .replaceAll("{{RECORD_YAML}}", flags.record ? quoteYaml(flags.record) : "null")
        .replaceAll("{{QUESTION}}", String(question).trim());
      if (body.includes("{{")) throw new Error("Consensus template has unfilled placeholders");
      try {
        const handle = await open(filename, "wx");
        try {
          await handle.writeFile(body, "utf8");
        } finally {
          await handle.close();
        }
        await updateIndex(
          root,
          id,
          title,
          path.relative(root, filename),
          flags.plan,
        );
        return { id, filename, created: true };
      } catch (error) {
        if (error.code === "EEXIST") continue;
        throw error;
      }
    }
  });
}

async function generatePrompt(root, identifier, flags) {
  const participant = flags.participant;
  if (!participant || !SLUG.test(participant))
    throw new Error("Provide --participant as a lowercase slug");
  const round = Number(flags.round ?? 1);
  if (round !== 1 && round !== 2) throw new Error("--round must be 1 or 2");
  const found = await findReview(root, identifier);
  const lockPath = `${found.filename}.lock`;
  let text;
  let fields;
  await withLock(lockPath, async () => {
    text = await readFile(found.filename, "utf8");
    fields = frontmatter(text);
    const brief = briefFrom(text);
    if (/\[TODO:/i.test(brief))
      throw new Error("Complete the shared brief before generating agent prompts");
    const hash = briefHash(text);
    if (fields.brief_sha256) {
      if (fields.brief_sha256 !== hash)
        throw new Error("The frozen brief changed; create a new consensus review to preserve context");
    } else {
      text = setFrontmatterField(text, "brief_sha256", quoteYaml(hash));
      text = setFrontmatterField(text, "status", "round-1");
      await atomicWrite(found.filename, text);
      fields = frontmatter(text);
    }
  });

  let content = `Consensus review ${fields.consensus_id}: ${fields.title}\nParticipant: ${participant}\nRound: ${round}\nFrozen brief SHA-256: ${fields.brief_sha256}\n\n`;
  content += `Shared brief:\n\n${briefFrom(text)}\n\n`;
  if (round === 1) {
    content += `Form an independent proposal from the shared brief. Do not inspect or infer other participants' answers. Separate verified facts from assumptions. Address: recommendation; reasoning and evidence; strongest alternative; material risks; confidence; and the smallest experiment or spike that could falsify your recommendation, with success/failure criteria. Return only your attributed contribution. Do not implement the design.\n`;
  } else {
    const bounds = roundBounds(text, 1);
    const roundOne = text.slice(bounds.contentAt, bounds.endAt).trim();
    const responses = responseMatches(roundOne);
    if (responses.length < 2)
      throw new Error("Round 2 needs at least two recorded round-one responses");
    content += `Round-one responses:\n\n${roundOne}\n\nReview the proposals. Identify material agreements and disagreements, challenge assumptions using evidence, state what changed your mind (if anything), and what evidence or spike would settle remaining differences. You may keep your original position. Return only your second-round contribution. Do not implement the design.\n`;
  }
  process.stdout.write(`${content.trim()}\n`);
}

async function addResponse(root, identifier, flags) {
  const round = Number(flags.round ?? 1);
  const participant = flags.participant;
  const model = flags.model ?? "unknown";
  const responseFile = flags["response-file"];
  if (round !== 1 && round !== 2) throw new Error("--round must be 1 or 2");
  if (!participant || !SLUG.test(participant))
    throw new Error("Provide --participant as a lowercase slug");
  if (!responseFile) throw new Error("Provide --response-file");
  const found = await findReview(root, identifier);
  const response = (await readFile(path.resolve(process.cwd(), responseFile), "utf8")).trim();
  if (!response) throw new Error("Response file is empty");
  if (response.includes("<!-- /tri:consensus-response -->"))
    throw new Error("Response text contains a reserved closing marker");

  const lockPath = `${found.filename}.lock`;
  let added = false;
  let text;
  await withLock(lockPath, async () => {
    text = await readFile(found.filename, "utf8");
    const fields = frontmatter(text);
    if (!fields.brief_sha256)
      throw new Error("Generate a round-one prompt before recording responses to freeze the brief");
    if (fields.brief_sha256 !== briefHash(text))
      throw new Error("The frozen brief changed; this response cannot be attached to it");
    if (round === 2) {
      const firstRound = roundBounds(text, 1);
      if (
        responseMatches(
          text.slice(firstRound.contentAt, firstRound.endAt),
        ).length < 2
      )
        throw new Error("Round 2 needs at least two recorded round-one responses");
    }
    const bounds = roundBounds(text, round);
    const section = text.slice(bounds.contentAt, bounds.endAt);
    const responses = responseMatches(section);
    const previous = responses.find((item) => item.participant === participant);
    const heading = `### ${participant} (${model}) — ${new Date().toISOString().slice(0, 10)}\n\n`;
    const block = `<!-- tri:consensus-response round="${round}" participant="${participant}" model="${encodeURIComponent(model)}" -->\n${heading}${response}\n<!-- /tri:consensus-response -->`;
    if (previous) {
      const previousResponse = previous.body.replace(/^### .*\r?\n\r?\n/, "").trim();
      if (previous.model === model && previousResponse === response) {
        added = false;
        return;
      }
      if (!flags.replace)
        throw new Error(`Round ${round} response for ${participant} already exists; pass --replace to replace it`);
      const absoluteStart = bounds.contentAt + previous.index;
      text = `${text.slice(0, absoluteStart)}${block}${text.slice(absoluteStart + previous.full.length)}`;
    } else {
      text = `${text.slice(0, bounds.endAt).replace(/\s*$/, "\n\n")}${block}\n\n${text.slice(bounds.endAt)}`;
    }
    text = setFrontmatterField(text, "status", round === 1 ? "round-1" : "round-2");
    await atomicWrite(found.filename, text);
    added = true;
  });
  if (added) {
    const fields = frontmatter(text);
    await updateIndex(
      root,
      fields.consensus_id,
      fields.title,
      path.relative(root, found.filename),
      fields.plan,
    );
  }
  console.log(`${added ? "Recorded" : "Already recorded"} round ${round} response for ${participant} in ${path.relative(root, found.filename)}`);
}

async function checkReview(root, identifier) {
  const found = await findReview(root, identifier);
  const errors = [];
  const fields = found.fields;
  if (!/^C\d+$/.test(fields.consensus_id ?? "")) errors.push("invalid consensus_id");
  if (!SLUG.test(fields.consensus_key ?? "")) errors.push("invalid consensus_key");
  if (!OUTCOMES.has(fields.outcome)) errors.push(`unknown outcome ${fields.outcome}`);
  const brief = briefFrom(found.text);
  if (fields.brief_sha256 && fields.brief_sha256 !== briefHash(found.text))
    errors.push("frozen brief hash does not match current brief");
  const participants = new Set();
  for (const round of [1, 2]) {
    const bounds = roundBounds(found.text, round);
    const responses = responseMatches(found.text.slice(bounds.contentAt, bounds.endAt));
    for (const response of responses) {
      const key = `${round}:${response.participant}`;
      if (participants.has(key)) errors.push(`duplicate response ${key}`);
      participants.add(key);
    }
  }
  if (/\[TODO:/i.test(brief)) console.log("Draft: complete the shared brief before asking agents.");
  if (errors.length) {
    for (const error of errors) console.error(`ERROR ${error}`);
    return 1;
  }
  console.log(`OK: ${fields.consensus_id} ${fields.consensus_key}; ${participants.size} response(s); outcome ${fields.outcome}`);
  return 0;
}

async function listReviews(root) {
  for (const filename of await reviewFiles(root)) {
    const fields = frontmatter(await readFile(filename, "utf8"));
    console.log(`${fields.consensus_id}\t${fields.consensus_key}\t${fields.title}\t${fields.outcome}\t${path.relative(root, filename)}`);
  }
}

function help() {
  return `Consensus review tools\n\n  triangular docs consensus new --slug terrain-rendering --title "Terrain rendering" --question "Which approach should we test?" [--plan /docs/plans/NNN_example.md]\n  triangular docs consensus prompt C001 --participant astra --round 1\n  triangular docs consensus add-response C001 --participant astra --model "Astra 6.1" --round 1 --response-file ./astra.md [--replace]\n  triangular docs consensus check C001\n  triangular docs consensus list\n\nCreation is keyed by --slug. Repeating it with the same title and question returns the existing file without replacing contributions. Prompts freeze the brief; changing it requires a new review. The CLI never launches AI providers.`;
}

export async function main(args = process.argv.slice(2), defaultRoot = process.cwd()) {
  const [command, ...rest] = args;
  const flags = parseFlags(rest);
  if (flags.root === true) throw new Error("--root requires a directory");
  const root = flags.root ? path.resolve(defaultRoot, flags.root) : defaultRoot;
  if (!command || command === "help" || command === "--help") {
    console.log(help());
    return 0;
  }
  if (command === "new") {
    const result = await createReview(root, flags);
    console.log(`${result.created ? "Created" : "Already exists"} Consensus ${result.id}: ${path.relative(root, result.filename)}`);
    return 0;
  }
  if (command === "prompt") {
    await generatePrompt(root, flags._positionals[0], flags);
    return 0;
  }
  if (command === "add-response") {
    await addResponse(root, flags._positionals[0], flags);
    return 0;
  }
  if (command === "check") return checkReview(root, flags._positionals[0]);
  if (command === "list") {
    await listReviews(root);
    return 0;
  }
  console.error(help());
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
