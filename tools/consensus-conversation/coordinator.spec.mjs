import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseClaudeStream, parseCodexStream, resolveRepositories, runConversation as run, sourceContext } from './coordinator.mjs';

const runConversation = (config, options) => run({ synthesize: false, identityMode: 'names', ...config }, options);

test('independent opening, resumed sessions, previous round, and reported cumulative costs', async () => {
  const calls = [], snapshots = [];
  const result = await runConversation({ question: 'A question?', participants: ['a', 'b'], rounds: 2 }, {
    turn: async request => {
      calls.push(request);
      return { session: request.session ?? request.participant, text: JSON.stringify({ action: 'speak', speech: `answer-${request.participant}-${request.round}`, readiness: request.round === 2 ? 'ready' : 'discussing', agreement: {}, questions: [], responses: [] }), usage: { inputTokens: 10, outputTokens: 2, reportedCostUsd: request.round } };
    }, save: async state => snapshots.push(JSON.parse(JSON.stringify(state)))
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.turns.length, 4);
  assert.ok(!calls[1].prompt.includes('answer-a-1'));
  assert.ok(calls[2].prompt.includes('answer-b-1'));
  assert.ok(calls[3].prompt.includes('answer-a-2'));
  assert.equal(calls[2].session, 'a');
  assert.equal(result.usage.inputTokens, 40);
  assert.equal(result.usage.reportedCostUsd, 4);
  assert.equal(result.usageByParticipant.a.inputTokens, 20);
  assert.ok(snapshots.some(s => s.turns.length === 1));
});

test('provider events record file reads and reject unexpected tools', () => {
  const events = [
    { type: 'system', subtype: 'init', tools: ['Read', 'Grep', 'Glob'], mcp_servers: [] },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'code.ts' } }] } },
    { type: 'result', session_id: 's', result: '{}', usage: { input_tokens: 5, cache_read_input_tokens: 7, cache_creation_input_tokens: 3, output_tokens: 2 } },
  ];
  const encode = rows => rows.map(row => JSON.stringify(row)).join('\n');
  const parsed = parseClaudeStream(encode(events));
  assert.deepEqual(parsed.toolCalls, [{ name: 'Read', path: 'code.ts' }]);
  assert.equal(parsed.usage.inputTokens, 15);
  events[0].tools.push('Edit');
  assert.throws(() => parseClaudeStream(encode(events)), /unexpected tools/);
});

test('call and token limits stop future calls; malformed output saves failure', async () => {
  let calls = 0;
  const turn = async () => { calls++; return { session: 'x', text: '{"action":"speak","speech":"ok","readiness":"discussing","agreement":{},"questions":[],"responses":[]}', usage: { inputTokens: 100 } }; };
  const limited = await runConversation({ question: '?', participants: ['a', 'b'], maxInputTokens: 50 }, { turn });
  assert.equal(limited.status, 'limit_reached'); assert.equal(calls, 1);
  const malformed = await runConversation({ question: '?', participants: ['a', 'b'] }, { turn: async () => ({ session: 'x', text: 'bad', usage: { inputTokens: 42 } }) });
  assert.equal(malformed.status, 'failed'); assert.equal(malformed.usage.inputTokens, 42);
});

test('source selection cannot escape the workspace', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'discussion-'));
  try {
    await writeFile(path.join(root, 'code.ts'), 'const answer = 42;');
    assert.match(await sourceContext(root, ['code.ts']), /answer = 42/);
    await assert.rejects(sourceContext(root, ['../outside']));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('repository selection supports multiple directories or none', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'discussion-repos-'));
  const other = await mkdtemp(path.join(os.tmpdir(), 'discussion-dependency-'));
  try {
    const dirs = await resolveRepositories({ repositories: [root, other] }, root);
    assert.equal(dirs.length, 2);
    let seen;
    const result = await runConversation({ question: '?', participants: ['a', 'b'], repositories: [], rounds: 1 }, {
      root, turn: async request => { seen = request; return { session: 'x', text: '{"action":"speak","speech":"ok","readiness":"ready","agreement":{},"questions":[],"responses":[]}', usage: {} }; }
    });
    assert.equal(result.repositories.length, 0);
    assert.deepEqual(seen.repositories, []);
    assert.match(seen.prompt, /No repositories are selected/);
    await assert.rejects(runConversation({ question: '?', participants: ['a', 'b'], repositories: [], sourceFiles: ['code.ts'] }, { root }), /require a primary repository/);
  } finally { await rm(root, { recursive: true, force: true }); await rm(other, { recursive: true, force: true }); }
});

test('questions are tracked for each addressee and pending questions prevent early completion', async () => {
  const calls = [];
  const result = await runConversation({ question: '?', participants: ['a', 'b', 'c'], rounds: 2 }, {
    turn: async request => {
      calls.push(request);
      const opening = request.round === 1 && request.participant === 'a';
      const answer = request.round === 2 && request.participant === 'b';
      const pass = request.round === 2 && request.participant === 'c';
      return { session: request.participant, text: JSON.stringify({ action: pass ? 'pass' : 'speak', speech: pass ? '' : answer ? 'My answer is yes.' : 'Position.', readiness: 'ready', agreement: {}, questions: opening ? [{ to: 'b', question: 'Why?' }, { to: 'c', question: 'Why?' }] : [], responses: answer ? [{ id: 'Q1', status: 'answered' }] : [] }), usage: {} };
    }
  });
  assert.equal(result.status, 'round_limit');
  assert.equal(calls.length, 6);
  assert.ok(!calls[1].prompt.includes('Why?'));
  assert.match(calls[4].prompt, /Q1/);
  assert.deepEqual(result.questions.map(q => [q.id, q.status]), [['Q1', 'answered'], ['Q2', 'open']]);
  assert.deepEqual(result.outcome.unresolvedQuestions, ['Q2']);
  assert.equal(result.outcome.positions[2].speech, 'Position.');
  assert.match(calls[4].prompt, /final round/);
});

test('a participant cannot resolve a question addressed to someone else', async () => {
  const result = await runConversation({ question: '?', participants: ['a', 'b', 'c'], rounds: 2 }, {
    turn: async ({ participant, round }) => ({ session: participant, text: JSON.stringify({ action: 'speak', speech: 'Position', readiness: 'discussing', agreement: {}, questions: round === 1 && participant === 'a' ? [{ to: 'c', question: 'Why?' }] : [], responses: round === 2 && participant === 'b' ? [{ id: 'Q1', status: 'answered' }] : [] }), usage: {} })
  });
  assert.equal(result.status, 'failed');
  assert.match(result.error, /invalid question response/);
  assert.deepEqual(result.outcome.unresolvedQuestions, ['Q1']);
});

test('identity mode uses only chosen names or only model labels, defaulting to model labels', async () => {
  const prompts = [];
  const turn = async request => { prompts.push(request.prompt); return { session: request.participant, text: JSON.stringify({ action: 'speak', speech: 'view', readiness: 'ready', agreement: {}, questions: [], responses: [] }), usage: {} }; };
  const hidden = await runConversation({ question: '?', participants: ['a', 'b'], rounds: 1, identityMode: 'names' }, { turn });
  assert.equal(hidden.identityMode, 'names');
  assert.ok(prompts.every(p => !p.includes('claude-haiku-5-5')));
  prompts.length = 0;
  const revealed = await run({ question: '?', participants: ['a', 'b'], rounds: 1, synthesize: false }, { turn });
  assert.equal(revealed.identityMode, 'models');
  assert.deepEqual(revealed.participants, ['claude-haiku-5-5 (a)', 'claude-haiku-5-5 (b)']);
  assert.ok(prompts.every(p => p.includes('Participants: claude-haiku-5-5 (a), claude-haiku-5-5 (b)')));
  assert.ok(prompts.every(p => !p.includes('Participants: a, b')));
  assert.deepEqual(revealed.turns.map(t => t.participant), revealed.participants);
  await assert.rejects(runConversation({ question: '?', participants: ['a', 'b'], identityMode: 'unknown' }), /identityMode/);
});

test('mixed models have distinct labels, sessions and usage', async () => {
  const requests = [];
  const result = await run({ question: '?', participants: [{ name: 'Ada', model: 'gpt-6-luna' }, { name: 'Bea', model: 'claude-haiku-5-5' }], rounds: 2, synthesize: false }, {
    turn: async request => {
      requests.push(request);
      return { session: request.participant, text: JSON.stringify({ action: 'speak', speech: 'view', readiness: 'discussing', agreement: {}, questions: [], responses: [] }), usage: { inputTokens: 5 } };
    }
  });
  assert.deepEqual(result.participants, ['gpt-6-luna', 'claude-haiku-5-5']);
  assert.deepEqual(requests.map(r => r.model), ['gpt-6-luna', 'claude-haiku-5-5', 'gpt-6-luna', 'claude-haiku-5-5']);
  assert.equal(requests[2].session, 'gpt-6-luna');
  assert.equal(result.usageByParticipant['gpt-6-luna'].inputTokens, 10);
  await assert.rejects(run({ question: '?', participants: [{ name: 'a', model: 'gpt-6-luna' }, 'b'], repositories: [] }), /requires a repository/);
});

test('minimum rounds continue after early readiness and Codex events retain reported usage', async () => {
  const turn = async request => ({ session: request.participant, text: JSON.stringify({ action: 'speak', speech: 'view', readiness: 'ready', agreement: {}, questions: [], responses: [] }), usage: {} });
  const result = await runConversation({ question: '?', participants: ['a', 'b'], rounds: 2, minRounds: 2 }, { turn });
  assert.equal(result.turns.length, 4);
  assert.equal(result.status, 'ready');
  const stream = [ { type: 'thread.started', thread_id: 'id' }, { type: 'item.completed', item: { type: 'agent_message', text: '{}' } }, { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 50, output_tokens: 4 } } ].map(JSON.stringify).join('\n');
  assert.equal(parseCodexStream(stream).usage.inputTokens, 100);
  assert.equal(parseCodexStream(stream).usage.cachedInputTokens, 50);
});

test('facilitator synthesis is separate, bounded and included in usage', async () => {
  const calls = [];
  const turn = async request => {
    calls.push(request);
    return request.role === 'facilitator'
      ? { session: 'facilitator-session', text: JSON.stringify({ commonGround: ['Agreed'], disagreements: ['Different emphasis'], nextSteps: [] }), usage: { inputTokens: 15, outputTokens: 3, reportedCostUsd: 0.1 } }
      : { session: request.participant, text: JSON.stringify({ action: 'speak', speech: 'view', readiness: 'ready', agreement: {}, questions: [], responses: [] }), usage: { inputTokens: 10, outputTokens: 2, reportedCostUsd: 0.2 } };
  };
  const config = { question: '?', participants: ['facilitator', 'b'], rounds: 1, synthesize: true };
  const result = await runConversation(config, { turn });
  assert.equal(result.outcome.synthesis.status, 'completed');
  assert.deepEqual(result.outcome.synthesis.disagreements, ['Different emphasis']);
  assert.equal(result.turns.length, 2);
  assert.equal(calls[2].session, undefined);
  assert.deepEqual(calls[2].repositories, []);
  assert.equal(result.usage.inputTokens, 35);
  assert.ok(Math.abs(result.usage.reportedCostUsd - 0.5) < 1e-9);
  calls.length = 0;
  const limited = await runConversation({ ...config, maxTotalCalls: 2 }, { turn });
  assert.equal(calls.length, 2);
  assert.equal(limited.outcome.synthesis.reason, 'limit_reached');
});

test('invalid facilitator output preserves the discussion and counts its usage', async () => {
  const result = await runConversation({ question: '?', participants: ['a', 'b'], rounds: 1, synthesize: true }, {
    turn: async request => request.role === 'facilitator'
      ? { text: 'bad', usage: { inputTokens: 11 } }
      : { session: request.participant, text: JSON.stringify({ action: 'speak', speech: 'view', readiness: 'ready', agreement: {}, questions: [], responses: [] }), usage: {} }
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.outcome.synthesis.status, 'failed');
  assert.equal(result.usage.inputTokens, 11);
  assert.equal(result.turns.length, 2);
});
