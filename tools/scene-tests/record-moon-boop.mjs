/** Convenience launcher for the installed Stop Motion UI recipe. */
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  codec: { type: 'string', default: 'hevc' }, silent: { type: 'boolean' },
} });
if (positionals.length > 1 || !['hevc', 'h264'].includes(values.codec)) throw new Error('Usage: record-moon-boop.mjs [speech-directory] [--codec hevc|h264] [--silent]');
const require = createRequire(import.meta.url);
const cli = path.resolve(path.dirname(require.resolve('@daxur-studios/stop-motion-ui')), '../bin/stop-motion-ui.mjs');
const child = spawn(process.execPath, [cli, 'run', 'tools/scene-tests/moon-boop.video.mjs', '--out', 'ignore/moon-boop-videos', '--codec', values.codec, ...(values.silent ? ['--narration', 'off'] : []), '--json'], {
  stdio: 'inherit', windowsHide: true,
  env: { ...process.env, ...(positionals[0] ? { MOON_BOOP_SPEECH_DIR: path.resolve(positionals[0]) } : {}) },
});
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
