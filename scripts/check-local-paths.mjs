#!/usr/bin/env node
// Fails when added lines (staged by default, all tracked files with --all) contain a personal home-directory path such
// as C:\Users\<name>\..., /Users/<name>/... or /home/<name>/.... Placeholders like <user> or %USERNAME% are allowed.
// The check is generic on purpose: this repo is public, so it must not name any particular user.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PLACEHOLDER =
  /^(<.*>|%.*%|\$.*|\{.*\}|\.\.\.|user|username|you|name|me|your[-_ ]?name|example|public|default|all users|shared|runner|ci|vsts|node)$/i;
const HOME_PATH = /(?:[A-Za-z]:[\\/]+Users|\/Users|\/home)[\\/]+([^\\/\s'"`)\]]+)/g;

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

function findLocalPaths(text) {
  return [...text.matchAll(HOME_PATH)].filter((m) => !PLACEHOLDER.test(m[1])).map((m) => m[0]);
}

function* addedLines() {
  if (process.argv.includes('--all')) {
    for (const file of git('ls-files', '-z', '--cached', '--exclude-standard').split('\0').filter(Boolean)) {
      let body;
      try {
        body = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      if (body.includes('\0')) continue;
      const lines = body.split('\n');
      for (let i = 0; i < lines.length; i++) yield { file, line: i + 1, text: lines[i] };
    }
    return;
  }
  let file = '';
  let line = 0;
  for (const raw of git('diff', '--cached', '--no-color', '-U0', '--diff-filter=AMR').split('\n')) {
    if (raw.startsWith('+++ ')) file = raw.slice(6);
    else if (raw.startsWith('@@')) line = Number(/\+(\d+)/.exec(raw)?.[1] ?? 0) - 1;
    else if (raw.startsWith('+')) yield { file, line: ++line, text: raw.slice(1) };
  }
}

const problems = [];
for (const { file, line, text } of addedLines()) {
  for (const hit of findLocalPaths(text)) problems.push(`${file}:${line}  ${hit}`);
}
if (problems.length) {
  console.error('Personal home-directory paths found (this repo is public):\n  ' + problems.join('\n  '));
  console.error('\nReplace them with a generic description or a placeholder such as <user>.');
  process.exit(1);
}
