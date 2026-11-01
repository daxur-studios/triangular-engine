#!/usr/bin/env node
// Exports a Claude Code session transcript for handover to another account.
//
// Writes one file in docs/handover/ (gitignored, local only):
//   <name>.transcript.md  the person's messages, assistant text, compaction summaries, subagent briefs and subagent
//                         hand-back reports. Tool results, thinking and routine tool calls are omitted.
// Subagent transcripts (<session>/subagents/*.jsonl) are not copied; their reports are in the hand-backs.
//
// Usage:
//   node scripts/export-session-handover.mjs --name 073_example_topic
//   node scripts/export-session-handover.mjs --name 073_example_topic --session <session-id>
//   node scripts/export-session-handover.mjs --name 073_example_topic --include-sidechains
//   node scripts/export-session-handover.mjs --name 073_example_topic --transcript <path-to-.jsonl>
//
// Without --session, the most recently modified transcript for this workspace is used.
// --transcript reads that file directly, for a session started in another folder (its transcript lives under that
// folder's project directory, not this one's).

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const handoverDir = join(repoRoot, 'docs', 'handover');
/** Characters of a subagent's brief kept in the handover; longer briefs are cut. */
const BRIEF_LIMIT = 1200;

function parseArgs(argv) {
  const args = { name: null, session: null, transcript: null, includeSidechains: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--name') args.name = argv[++i];
    else if (arg === '--session') args.session = argv[++i];
    else if (arg === '--transcript') args.transcript = argv[++i];
    else if (arg === '--include-sidechains') args.includeSidechains = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.transcript && args.session) throw new Error('Use --session or --transcript, not both.');
  if (args.transcript && !existsSync(args.transcript)) throw new Error(`No transcript ${args.transcript}`);
  if (!args.name || !/^\d{3}_[a-z0-9_-]+$/i.test(args.name)) {
    throw new Error('--name is required and must look like 073_topic (matches the handover file name stem)');
  }
  return args;
}

// Claude Code stores transcripts under ~/.claude/projects/<cwd with separators replaced by ->.
function transcriptDir() {
  const slug = repoRoot.replace(/[:\\/]/g, '-');
  return join(homedir(), '.claude', 'projects', slug);
}

function findTranscript(dir, sessionId) {
  if (!existsSync(dir)) throw new Error(`No transcript directory at ${dir}`);
  if (sessionId) {
    const file = join(dir, `${sessionId}.jsonl`);
    if (!existsSync(file)) throw new Error(`No transcript ${file}`);
    return file;
  }
  const newest = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ file: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0];
  if (!newest) throw new Error(`No .jsonl transcripts in ${dir}`);
  return newest.file;
}

function textOf(message) {
  const content = message?.content;
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    text = content
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n\n');
  }
  // Harness-injected reminders (context, hooks, mode notices) are not something the person wrote.
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
}

// A subagent's final report, delivered back to this session as a peer message.
const isHandBack = (record) =>
  record.type === 'user' && record.origin?.kind === 'peer' && textOf(record.message).includes('[Subagent hand-back]');

// Harness-written records that are kept: compaction summaries (the state carried across a compaction) and subagent
// hand-backs. Other harness records (meta notes, background task notifications, local command output) are dropped.
function isInjected(record) {
  if (record.isCompactSummary || isHandBack(record)) return false;
  if (record.isMeta || record.isVisibleInTranscriptOnly) return true;
  if (record.type === 'user' && record.origin && record.origin.kind !== 'human' && record.origin.kind !== 'peer') return true;
  return false;
}

/** Heading label for a kept record. */
function labelOf(record) {
  if (record.isCompactSummary) return 'Compaction summary';
  if (isHandBack(record)) return 'Subagent hand-back';
  return record.type === 'user' ? 'User' : 'Assistant';
}

/**
 * A subagent launch: its description, type and brief. The brief is what the subagent was told to do, so the handover
 * keeps it; the subagent's result arrives later as a hand-back.
 */
function agentStarts(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  return content
    .filter((block) => block.type === 'tool_use' && block.name === 'Agent')
    .map(({ input = {} }) => {
      const brief = String(input.prompt ?? '').trim();
      const shown = brief.length > BRIEF_LIMIT ? `${brief.slice(0, BRIEF_LIMIT)}...` : brief;
      return `**Subagent started:** ${input.description ?? '(no description)'} (${input.subagent_type ?? 'default'}, ${input.model ?? 'inherited model'})\n\n> ${shown.replace(/\n/g, '\n> ')}`;
    });
}

function renderMarkdown(records, { includeSidechains }) {
  const out = [];
  const seen = new Set();
  let duplicates = 0;
  let injectedSkipped = 0;
  let sidechainSkipped = 0;
  let turns = 0;

  for (const record of records) {
    if (record.type !== 'user' && record.type !== 'assistant') continue;
    // A long session can repeat the same record many times in the transcript file; keep one copy.
    if (record.uuid) {
      if (seen.has(record.uuid)) {
        duplicates++;
        continue;
      }
      seen.add(record.uuid);
    }
    if (record.isSidechain && !includeSidechains) {
      sidechainSkipped++;
      continue;
    }
    if (isInjected(record)) {
      injectedSkipped++;
      continue;
    }
    // Tool-result user records and routine tool-call assistant records have no text or subagent brief, so they drop out here.
    const text = textOf(record.message);
    const agents = record.type === 'assistant' ? agentStarts(record.message) : [];
    if (!text && agents.length === 0) continue;

    turns++;
    const time = record.timestamp ? ` (${record.timestamp})` : '';
    out.push(`## ${labelOf(record)}${time}`, '', [text, ...agents].filter(Boolean).join('\n\n'), '');
  }

  const header = [
    '# Session transcript (compacted)',
    '',
    'User and assistant text, compaction summaries, subagent briefs and subagent hand-backs. Tool results, thinking',
    'and routine tool calls are omitted. Subagent transcripts are not copied; their reports are in the hand-backs.',
    '',
    `Messages: ${turns}` +
      (sidechainSkipped ? `, subagent messages skipped: ${sidechainSkipped}` : '') +
      (duplicates ? `, repeated records dropped: ${duplicates}` : '') +
      (injectedSkipped ? `, harness-injected records dropped: ${injectedSkipped}` : ''),
    '',
    '---',
    '',
  ];
  return header.concat(out).join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = args.transcript ? resolve(args.transcript) : findTranscript(transcriptDir(), args.session);
  const sessionId = source.split(/[\\/]/).pop().replace(/\.jsonl$/, '');

  mkdirSync(handoverDir, { recursive: true });
  const markdown = join(handoverDir, `${args.name}.transcript.md`);

  const records = readFileSync(source, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  writeFileSync(markdown, renderMarkdown(records, { includeSidechains: args.includeSidechains }), 'utf8');

  console.log(`Session ${sessionId}`);
  console.log(`  markdown: ${markdown} (${(statSync(markdown).size / 1024).toFixed(1)} KB)`);
  console.log('Gitignored. Transfer it by a private channel; do not commit it.');
}

main();
