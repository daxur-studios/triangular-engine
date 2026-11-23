import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

async function daxurCommand() {
  if (process.env.DAXUR_CLI_JS) return [process.execPath, process.env.DAXUR_CLI_JS];
  if (process.platform !== 'win32') return ['daxur'];
  // Resolve Windows npm shims to their Node entry point so speech stays a
  // literal argument. An installed standalone executable works directly.
  for (const directory of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const executable = join(directory, 'daxur.exe');
    if (await access(executable).then(() => true, () => false)) return [executable];
    const shim = await readFile(join(directory, 'daxur.cmd'), 'utf8').catch(() => '');
    const entry = shim.match(/"%dp0%[\\/]([^"\r\n]+\.(?:cjs|mjs|js))"/i)?.[1];
    if (entry) return [process.execPath, resolve(directory, entry)];
  }
  throw new Error('Daxur was not found on PATH. Set DAXUR_CLI_JS to the Daxur Node entry point for a custom installation.');
}

/** Local narration provider for Stop Motion UI recipes. */
export function kokoroNarration({ voice = 'af_heart' } = {}) {
  return {
    id: 'daxur-kokoro',
    version: '1',
    options: { voice },
    async synthesize({ text, outputPath, signal }) {
      const [executable, ...prefix] = await daxurCommand();
      const args = ['tts', '--engine', 'kokoro', '--voice', voice, '--out', outputPath, text];
      await exec(executable, [...prefix, ...args], {
        signal,
        timeout: 180000,
      });
      return outputPath;
    },
  };
}
