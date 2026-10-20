'use strict';
// For `ng serve` proxyConfig: starts the receiver once and forwards the same-origin sink path to it.
// proxy.conf.cjs:  module.exports = require('triangular-engine/bin/triangular-test-proxy.cjs')();
// DAXUR_TEST_SINK is set by a router that runs the receiver itself (one per app): then nothing is spawned here and
// the function only returns the forwarding mapping.
const { spawn } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const DEFAULT_PORT = 4723;

module.exports = function createTestSinkProxy(options = {}) {
  const root = options.root ?? process.cwd();
  let port = options.port ?? DEFAULT_PORT;
  const cfg = join(root, 'triangular-test.config.json');
  if (!options.port && existsSync(cfg)) port = JSON.parse(readFileSync(cfg, 'utf8')).port ?? port;
  if (!process.env.DAXUR_TEST_SINK && !globalThis.__triangularTestReceiver) {
    let stopping = false;
    const child = spawn(process.execPath, [join(__dirname, 'triangular-test-receiver.mjs')], {
      cwd: root, stdio: 'inherit', env: { ...process.env, TRIANGULAR_TEST_PORT: String(port) },
    });
    child.on('error', (error) => console.error(`[triangular-test] ERROR: receiver failed to start: ${error.message}`));
    // Exit 1 is the receiver refusing the port (another app's receiver or server holds it). The mapping below still
    // forwards to that port, so say so loudly: this app's results are not saved by its own receiver.
    child.on('exit', (code) => {
      if (stopping || !code) return;
      console.error([
        `[triangular-test] ERROR: the receiver for this app did not start on port ${port} (exit ${code}; see above).`,
        '  Test results posted to the sink are NOT saved to this app\'s folder. Set "port" in triangular-test.config.json to a free port and restart ng serve.',
      ].join('\n'));
    });
    process.on('exit', () => { stopping = true; child.kill(); });
    globalThis.__triangularTestReceiver = child;
  }
  return { '/__triangular-test-sink': { target: `http://127.0.0.1:${port}`, secure: false, logLevel: 'warn' } };
};
