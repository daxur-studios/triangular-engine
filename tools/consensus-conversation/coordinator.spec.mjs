import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseReply, parseClaudeStream, parseCodexStream, parseCodexCompactions, parseDeepseekStream, parseOpenCodeCompactions, parseHydrogenStream, replySchema, resolveRepositories, runConversation as run, sourceContext } from './coordinator.mjs';

const runConversation = (config, options) => run({ synthesize: false, identityMode: 'names', ...config }, options);

test('Antigravity checkpoint is a possible signal, never a confirmed compaction', () => {
  const init = { event: 'init', conversation_id: 's' };
  const result = { event: 'result', result: { status: 'SUCCESS', conversation_id: 's', response: 'answer' } };
  const checkpoint = { event: 'step_update', step_update: { conversation_id: 's', step_type: 'checkpoint', state: 'DONE', step_index: 4 } };
  const parse = events => parseHydrogenStream(events.map(JSON.stringify).join('\n'), false, true);
  const observed = parse([init, checkpoint, checkpoint, result]);
  assert.deepEqual(observed.compactionObservation, { status: 'signal_observed', signal: 'completed_checkpoint', checkpointSteps: [4] });
  assert.equal(observed.compactions, undefined);
  assert.equal(parse([init, { ...checkpoint, step_update: { ...checkpoint.step_update, state: 'RUNNING' } }, result]).compactionObservation.status, 'no_signal');
  assert.equal(parse([init, { ...checkpoint, step_update: { ...checkpoint.step_update, conversation_id: 'other' } }, result]).compactionObservation.status, 'no_signal');
  assert.equal(parse([{ ...init, conversation_id: 'other' }, result]).compactionObservation.status, 'unavailable');
  assert.equal(parseHydrogenStream([init, checkpoint, result].map(JSON.stringify).join('\n')).compactionObservation, undefined);
});

test('Antigravity checkpoint observation option and signal are saved', async () => {
  const result = await runConversation({ question: '?', participants: [{ name: 'a', model: 'gemini-4-hydrogen-low' }, 'b'], rounds: 1, observeHydrogenCompaction: true }, {
    turn: async request => {
      assert.equal(request.observeHydrogenCompaction, true);
      return { session: request.participant, text: JSON.stringify({ action: 'speak', speech: 'view', readiness: 'ready', agreement: {}, questions: [], responses: [] }), usage: {}, ...(request.participant === 'a' ? { compactionObservation: { status: 'signal_observed', signal: 'completed_checkpoint', checkpointSteps: [4] } } : {}) };
    }
  });
  assert.equal(result.compactionObservations[0].status, 'signal_observed');
  assert.equal(result.compactions.length, 0);
  await assert.rejects(runConversation({ question: '?', participants: ['a', 'b'], observeHydrogenCompaction: 'yes' }), /observeHydrogenCompaction/);
});

test('Codex observation requires completed compaction in a completed turn and complete pages', () => {
  const item = { type: 'contextCompaction', id: 'compact-1', completedAtMs: 123 };
  const turn = { status: 'completed', itemsView: 'full', items: [item] };
  assert.deepEqual(parseCodexCompactions({ data: [turn], nextCursor: null }), [{ id: 'compact-1', trigger: 'unknown', beforeTokens: null, afterTokens: null }]);
  assert.deepEqual(parseCodexCompactions({ data: [{ ...turn, status: 'failed' }, { ...turn, items: [{ ...item, completedAtMs: null }] }] }), []);
  assert.throws(() => parseCodexCompactions({ data: [turn], nextCursor: 'more' }), /incomplete/);
  assert.throws(() => parseCodexCompactions({ data: [{ ...turn, itemsView: 'summary' }] }), /full items/);
});

test('Codex observation is optional, recorded and deduplicated', async () => {
  let calls = 0;
  const result = await runConversation({ question: '?', participants: [{ name: 'a', model: 'gpt-6-luna' }, 'b'], rounds: 2, minRounds: 2, observeCodexCompaction: true }, {
    turn: async request => {
      if (request.participant === 'a') { assert.equal(request.observeCodexCompaction, true); calls++; }
      return { session: request.participant, text: JSON.stringify({ action: 'speak', speech: 'view', readiness: 'ready', agreement: {}, questions: [], responses: [] }), usage: {}, ...(request.participant === 'a' ? { compactions: [{ id: 'marker', trigger: 'unknown' }], compactionObservation: calls === 1 ? { status: 'checked' } : { status: 'unavailable', reason: 'inspection failed' } } : {}) };
    }
  });
  assert.equal(result.compactions.length, 1);
  assert.deepEqual(result.compactionObservations.map(x => x.status), ['checked', 'unavailable']);
  await assert.rejects(runConversation({ question: '?', participants: ['a', 'b'], observeCodexCompaction: 'yes' }), /observeCodexCompaction/);
});

test('OpenCode export requires a completed summary linked to a same-session compaction marker', () => {
  const marker = { info: { id: 'm', sessionID: 's', role: 'user' }, parts: [{ type: 'compaction', id: 'p', sessionID: 's', messageID: 'm', auto: true }] };
  const summary = { info: { id: 'answer', parentID: 'm', sessionID: 's', role: 'assistant', summary: true, finish: 'stop', time: { completed: 10 } } };
  const exportOf = messages => JSON.stringify({ info: { id: 's' }, messages });
  assert.deepEqual(parseOpenCodeCompactions(exportOf([marker, summary]), 's'), [{ id: 'p', trigger: 'auto', beforeTokens: null, afterTokens: null }]);
  assert.deepEqual(parseOpenCodeCompactions(exportOf([marker, { info: { ...summary.info, finish: 'error' } }]), 's'), []);
  assert.deepEqual(parseOpenCodeCompactions(exportOf([marker, { info: { ...summary.info, sessionID: 'other' } }]), 's'), []);
  assert.throws(() => parseOpenCodeCompactions(exportOf([marker, summary]), 'other'), /unexpected session/);
});

test('OpenCode compaction observations persist and repeated export markers are deduplicated', async () => {
  let calls = 0;
  const result = await runConversation({ question: '?', participants: [{ name: 'a', model: 'opencode-go/deepseek-v4.1-flash' }, 'b'], rounds: 2, minRounds: 2, observeOpenCodeCompaction: true }, {
    turn: async request => {
      if (request.participant === 'a') { assert.equal(request.observeOpenCodeCompaction, true); calls++; }
      return { session: request.participant, text: JSON.stringify({ action: 'speak', speech: 'view', readiness: 'ready', agreement: {}, questions: [], responses: [] }), usage: {}, ...(request.participant === 'a' ? { compactions: [{ id: 'marker', trigger: 'auto' }], compactionObservation: calls === 1 ? { status: 'checked' } : { status: 'unavailable', reason: 'export failed' } } : {}) };
    }
  });
  assert.equal(result.compactions.length, 1);
  assert.deepEqual(result.compactionObservations.map(x => x.status), ['checked', 'unavailable']);
  await assert.rejects(runConversation({ question: '?', participants: ['a', 'b'], observeOpenCodeCompaction: 'yes' }), /observeOpenCodeCompaction/);
});

test('Claude compaction boundaries are recorded without mistaking other sessions or status for completed compaction', () => {
  const events = [
    { type: 'system', subtype: 'status', status: 'compacting', session_id: 's' },
    { type: 'system', subtype: 'init', tools: [], mcp_servers: [] },
    { type: 'system', subtype: 'compact_boundary', session_id: 'other', compact_metadata: { trigger: 'auto' } },
    { type: 'system', subtype: 'compact_boundary', session_id: 's', compact_metadata: { trigger: 'auto', pre_tokens: 100000, post_tokens: 12000 } },
    { type: 'result', session_id: 's', result: 'answer', usage: {} },
  ];
  assert.deepEqual(parseClaudeStream(events.map(JSON.stringify).join('\n')).compactions, [{ trigger: 'auto', beforeTokens: 100000, afterTokens: 12000 }]);
});

test('native Claude compaction settings and events survive rejected replies and resume', async () => {
  const requests = [];
  const result = await runConversation({ question: '?', participants: ['a', 'b'], rounds: 1, claudeAutoCompactWindowTokens: 100000 }, {
    turn: async request => {
      requests.push(request);
      const first = requests.length === 1;
      return { session: request.participant, text: first ? 'bad' : JSON.stringify({ action: 'speak', speech: 'view', readiness: 'ready', agreement: {}, questions: [], responses: [] }), compactions: first ? [{ trigger: 'auto', beforeTokens: 100000, afterTokens: 10000 }] : [], usage: {} };
    }
  });
  assert.equal(result.status, 'ready');
  assert.equal(requests[1].session, 'a');
  assert.ok(requests.every(request => request.claudeAutoCompactWindowTokens === 100000));
  assert.deepEqual(result.compactions, [{ participant: 'a', model: 'claude-haiku-5-5', round: 1, trigger: 'auto', beforeTokens: 100000, afterTokens: 10000 }]);
  await assert.rejects(() => runConversation({ question: '?', participants: ['a', 'b'], claudeAutoCompactWindowTokens: 1000 }), /100000 to 1000000/);
});

test('schema output accepts unknown scores and passes per-participant schemas only to supported CLIs', async () => {
  const calls = [];
  const result = await runConversation({ question: '?', participants: [{ name: 'a', model: 'gpt-6-luna' }, { name: 'b', model: 'opencode-go/deepseek-v4.1-flash' }], schemaOutput: true, rounds: 1 }, {
    turn: async request => {
      calls.push(request);
      return { session: request.participant, text: JSON.stringify({ action: 'speak', speech: 'view', readiness: 'ready', agreement: request.schema ? { b: null } : {}, questions: [], responses: [] }), usage: {} };
    }
  });
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.turns[0].agreement, {});
  assert.deepEqual(calls[0].schema, replySchema('a', ['a', 'b']));
  assert.equal(calls[1].schema, undefined);
  assert.match(calls[0].prompt, /all agreement scores MUST be null/);
});

test('structured provider envelopes preserve returned speech and require structured output', () => {
  const payload = { action: 'speak', speech: 'real words', readiness: 'ready', agreement: {}, questions: [], responses: [] };
  const encode = rows => rows.map(row => JSON.stringify(row)).join('\n');
  const claude = [{ type: 'system', subtype: 'init', tools: ['StructuredOutput'] }, { type: 'result', session_id: 's', result: '', structured_output: payload }];
  assert.equal(JSON.parse(parseClaudeStream(encode(claude), true).text).speech, 'real words');
  delete claude[1].structured_output;
  assert.throws(() => parseClaudeStream(encode(claude), true), /missing structured output/);
  const agy = [{ event: 'init' }, { event: 'result', result: { status: 'SUCCESS', conversation_id: 's', structured_output: payload } }];
  assert.equal(JSON.parse(parseHydrogenStream(encode(agy), true).text).speech, 'real words');
});

test('accepts fenced JSON with trailing whitespace', () => {
  const payload = { action: 'speak', speech: 'A view', readiness: 'ready', agreement: {}, questions: [], responses: [] };
  assert.equal(parseReply(`\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`\n`, 'a', ['a', 'b']).speech, 'A view');
});

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
  assert.equal(malformed.status, 'failed'); assert.equal(malformed.usage.inputTokens, 84);
});

test('malformed replies get one same-session correction, preserving rejected output and accounting for calls', async () => {
  const calls = [], snapshots = [];
  const result = await runConversation({ question: '?', participants: ['a', 'b'], rounds: 1 }, {
    turn: async request => {
      calls.push(request);
      return { session: request.participant, text: calls.length === 1 ? '{bad' : JSON.stringify({ action: 'speak', speech: `Words from ${request.participant}`, readiness: 'ready', agreement: {}, questions: [], responses: [] }), usage: { inputTokens: 10, outputTokens: 2 } };
    },
    save: async state => snapshots.push(JSON.parse(JSON.stringify(state)))
  });
  assert.equal(result.status, 'ready');
  assert.equal(calls.length, 3);
  assert.equal(calls[1].session, 'a');
  assert.match(calls[1].prompt, /preserving your intended speech/);
  assert.equal(result.rejectedTurns[0].text, '{bad');
  assert.ok(snapshots.some(state => state.rejectedTurns?.length && state.turns.length === 0));
  assert.deepEqual(result.turns.map(t => t.speech), ['Words from a', 'Words from b']);
  assert.equal(result.usage.inputTokens, 30);
  assert.equal(result.usageByParticipant.a.inputTokens, 20);
  assert.deepEqual(result.responseQuality, { rejectedReplies: 1, correctionCalls: 1, correctedTurns: 1, byModel: { 'claude-haiku-5-5': { rejectedReplies: 1, correctionCalls: 1, correctedTurns: 1 } } });
  const example = calls[0].prompt.split('Example format only; replace the example speech with your own answer: ')[1];
  assert.equal(parseReply(example, 'a', ['a', 'b'], [], true).speech, 'Your concise response.');
});

test('a correction cannot exceed call or token limits', async () => {
  for (const limit of [{ maxTotalCalls: 1 }, { maxInputTokens: 10 }]) {
    let calls = 0;
    const result = await runConversation({ question: '?', participants: ['a', 'b'], ...limit }, {
      turn: async () => { calls++; return { session: 'a', text: '{bad', usage: { inputTokens: 10 } }; }
    });
    assert.equal(result.status, 'limit_reached');
    assert.equal(calls, 1);
    assert.equal(result.rejectedTurns.length, 1);
    assert.equal(result.turns.length, 0);
    assert.equal(result.responseQuality.rejectedReplies, 1);
    assert.equal(result.responseQuality.correctionCalls, 0);
    assert.equal(result.responseQuality.correctedTurns, 0);
  }
});

test('response quality counts repeated failures without claiming a successful correction', async () => {
  const result = await runConversation({ question: '?', participants: ['a', 'b'], rounds: 1 }, {
    turn: async () => ({ session: 'a', text: '{bad', usage: {} })
  });
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.responseQuality, { rejectedReplies: 2, correctionCalls: 1, correctedTurns: 0, byModel: { 'claude-haiku-5-5': { rejectedReplies: 2, correctionCalls: 1, correctedTurns: 0 } } });
  assert.equal(result.rejectedTurns.length, 2);
});

test('response quality groups duplicate participants by model', async () => {
  const counts = new Map();
  const result = await runConversation({ question: '?', participants: ['a', 'b'], rounds: 1 }, {
    turn: async request => {
      const count = (counts.get(request.participant) ?? 0) + 1;
      counts.set(request.participant, count);
      return { session: request.participant, text: count === 1 ? 'bad' : JSON.stringify({ action: 'speak', speech: 'view', readiness: 'ready', agreement: {}, questions: [], responses: [] }), usage: {} };
    }
  });
  assert.deepEqual(result.responseQuality.byModel['claude-haiku-5-5'], { rejectedReplies: 2, correctionCalls: 2, correctedTurns: 2 });
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
  assert.equal(result.rejectedTurns[0].participant, 'b');
  assert.match(result.rejectedTurns[0].text, /Q1/);
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

test('new provider streams preserve sessions, usage, and reject failures', () => {
  const deepseek = [
    { type: 'text', sessionID: 'deep', part: { text: '{}' } },
    { type: 'step_finish', sessionID: 'deep', part: { tokens: { input: 10, output: 2, reasoning: 3, cache: { read: 5, write: 1 } } } },
  ].map(JSON.stringify).join('\n');
  assert.deepEqual(parseDeepseekStream(deepseek).usage, { inputTokens: 16, cachedInputTokens: 5, outputTokens: 5, reportedCostUsd: null });
  assert.equal(parseDeepseekStream(deepseek).session, 'deep');
  assert.throws(() => parseDeepseekStream('{"type":"error"}'), /error or missing session/);
  const hydrogen = [
    { event: 'init', conversation_id: 'hydrogen', init: {} },
    { event: 'result', result: { status: 'SUCCESS', conversation_id: 'hydrogen', response: '{}', usage: { input_tokens: 10, cache_read_tokens: 4, output_tokens: 3 } } },
  ].map(JSON.stringify).join('\n');
  assert.equal(parseHydrogenStream(hydrogen).session, 'hydrogen');
  assert.equal(parseHydrogenStream(hydrogen).usage.inputTokens, 10);
  assert.throws(() => parseHydrogenStream(hydrogen.replace('SUCCESS', 'ERROR')), /error or missing session/);
});

test('four providers preserve separate sessions and mark mixed cost as partial', async () => {
  const models = ['gpt-6-luna', 'claude-haiku-5-5', 'opencode-go/deepseek-v4.1-flash', 'gemini-4-hydrogen-low'];
  const requests = [];
  const result = await run({ question: '?', participants: models.map((model, i) => ({ name: `p${i}`, model })), rounds: 2, minRounds: 2, maxTotalCalls: 8, synthesize: false }, {
    turn: async request => { requests.push(request); return { session: request.session ?? request.model, text: JSON.stringify({ action: 'speak', speech: 'view', readiness: 'ready', agreement: {}, questions: [], responses: [] }), usage: { inputTokens: 5, reportedCostUsd: request.model === 'claude-haiku-5-5' ? 0.01 : null } }; }
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.turns.length, 8);
  assert.deepEqual(requests.slice(4).map(r => r.session), models);
  assert.equal(result.usage.inputTokens, 40);
  assert.equal(result.usage.costIsPartial, true);
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
