#!/usr/bin/env node
/**
 * Summarizes the perf history log (tests/perf/history/perf-history.jsonl)
 * as trend tables, one per comparable series (same machine profile,
 * scenario version, params and protocol).
 *
 *   node tools/perf-report.mjs [--metric cpuFrameMs.p50] [--last 10]
 *                              [--scenario instanced-static] [--profile <id>]
 *                              [--file path.jsonl] [--html out.html] [--json]
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const file = path.resolve(option('--file', 'tests/perf/history/perf-history.jsonl'));
const metric = option('--metric', 'cpuFrameMs.p50');
const last = Number(option('--last', '10'));
const scenarioFilter = option('--scenario', undefined);
const profileFilter = option('--profile', undefined);
const htmlOut = option('--html', undefined);

if (!fs.existsSync(file)) {
  console.log(`No perf history at ${path.relative(process.cwd(), file)} yet. Record one with: node tools/run-perf.mjs --record`);
  process.exit(0);
}

const entries = fs
  .readFileSync(file, 'utf8')
  .split(/\r?\n/)
  .filter((line) => line.trim())
  .flatMap((line) => {
    try {
      const entry = JSON.parse(line);
      return entry.schema === 'perf-history-v1' ? [entry] : [];
    } catch {
      return [];
    }
  })
  .filter((entry) => !scenarioFilter || entry.scenario.id === scenarioFilter)
  .filter((entry) => !profileFilter || entry.profile.id === profileFilter);

// Must match comparisonKey() in tests/perf/lib/perf-history.ts.
const keyOf = (entry) => `${entry.profile.id}|${entry.scenario.id}@v${entry.scenario.version}|${entry.scenario.paramsHash}|${entry.protocol.name}`;

const series = new Map();
for (const entry of entries) {
  const key = keyOf(entry);
  if (!series.has(key)) series.set(key, []);
  series.get(key).push(entry);
}

const fmt = (value, digits = 2) => (Number.isFinite(value) ? value.toFixed(digits) : 'n/a');
const pct = (value) => (Number.isFinite(value) ? `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)}%` : '');

const groups = [...series.values()].map((list) => {
  const first = list[0];
  const rows = list.slice(-last).map((entry, index, shown) => {
    const previous = index > 0 ? shown[index - 1] : list[list.length - shown.length - 1];
    const value = entry.metrics[metric];
    const before = previous?.metrics[metric];
    return {
      recordedAt: entry.recordedAt,
      commit: `${entry.git.commit.slice(0, 8)}${entry.git.dirty ? '+dirty' : ''}`,
      value,
      change: Number.isFinite(before) && before !== 0 ? (value - before) / before : Number.NaN,
      fps: entry.metrics.fps,
      drawCalls: entry.metrics.drawCalls,
    };
  });
  const firstValue = first.metrics[metric];
  const lastValue = list[list.length - 1].metrics[metric];
  return {
    scenario: first.scenario.id,
    version: first.scenario.version,
    params: first.scenario.params,
    profile: first.profile,
    protocol: first.protocol.name,
    runs: list.length,
    overallChange: Number.isFinite(firstValue) && firstValue !== 0 ? (lastValue - firstValue) / firstValue : Number.NaN,
    rows,
  };
});

if (args.includes('--json')) {
  console.log(JSON.stringify({ metric, groups }, null, 2));
} else {
  console.log(`# Perf history — ${metric} (lower is better)\n`);
  console.log(`${entries.length} entries in ${groups.length} comparable series from ${path.relative(process.cwd(), file)}\n`);
  for (const group of groups) {
    console.log(`## ${group.scenario} v${group.version} ${JSON.stringify(group.params)}`);
    console.log(`${group.profile.label} (${group.profile.id}) · ${group.protocol} · ${group.runs} run(s) · first→latest ${pct(group.overallChange) || 'n/a'}\n`);
    console.log(`| recorded | commit | ${metric} | Δ prev | fps | draw calls |`);
    console.log('| --- | --- | ---: | ---: | ---: | ---: |');
    for (const row of group.rows) {
      console.log(`| ${row.recordedAt.slice(0, 16).replace('T', ' ')} | ${row.commit} | ${fmt(row.value, 3)} | ${pct(row.change)} | ${fmt(row.fps, 1)} | ${row.drawCalls ?? ''} |`);
    }
    console.log('');
  }
}

if (htmlOut) {
  fs.writeFileSync(htmlOut, renderHtml(groups));
  console.log(`Wrote ${htmlOut}`);
}

function renderHtml(list) {
  const escape = (text) => String(text).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
  const chart = (rows) => {
    const values = rows.map((row) => row.value).filter(Number.isFinite);
    if (values.length === 0) return '<p>No values.</p>';
    const width = 560;
    const height = 140;
    const max = Math.max(...values) * 1.1 || 1;
    const x = (index) => (rows.length === 1 ? width / 2 : 30 + (index * (width - 60)) / (rows.length - 1));
    const y = (value) => height - 20 - (value / max) * (height - 40);
    const points = rows.map((row, index) => `${x(index)},${y(row.value)}`).join(' ');
    const dots = rows
      .map((row, index) => `<circle cx="${x(index)}" cy="${y(row.value)}" r="3"><title>${escape(row.commit)} · ${fmt(row.value, 3)} ms</title></circle>`)
      .join('');
    return `<svg viewBox="0 0 ${width} ${height}" role="img"><line x1="30" x2="${width - 30}" y1="${height - 20}" y2="${height - 20}" class="axis"/><polyline points="${points}"/>${dots}<text x="30" y="14">max ${fmt(max / 1.1, 3)} ms</text></svg>`;
  };
  const sections = list
    .map(
      (group) => `<section><h2>${escape(group.scenario)} v${group.version} <code>${escape(JSON.stringify(group.params))}</code></h2>
<p>${escape(group.profile.label)} · ${escape(group.protocol)} · ${group.runs} run(s) · first→latest ${escape(pct(group.overallChange) || 'n/a')}</p>${chart(group.rows)}</section>`,
    )
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Perf History</title>
<style>:root{--bg:#fff;--fg:#1f2933;--line:#2563eb;--muted:#9aa5b1}@media (prefers-color-scheme: dark){:root{--bg:#0b1220;--fg:#e5edf7;--line:#60a5fa;--muted:#475569}}
body{background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif;margin:0 auto;max-width:640px;padding:16px}
svg{width:100%;height:auto}polyline{fill:none;stroke:var(--line);stroke-width:2}circle{fill:var(--line)}.axis{stroke:var(--muted)}text{fill:var(--muted);font-size:11px}
code{font-size:12px}section{margin:24px 0}</style></head><body><h1>Perf history — ${escape(metric)}</h1>${sections}</body></html>`;
}
