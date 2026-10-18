'use strict';
// For `ng serve` proxyConfig: starts the receiver once and forwards the same-origin sink path to it.
// proxy.conf.cjs:  module.exports = require('triangular-engine/bin/triangular-test-proxy.cjs')();
const { spawn } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

module.exports = function createTestSinkProxy(options = {}) {
  const root = options.root ?? process.cwd();
  let port = options.port ?? 4223;
  const cfg = join(root, 'triangular-test.config.json');
  if (!options.port && existsSync(cfg)) port = JSON.parse(readFileSync(cfg, 'utf8')).port ?? port;
  if (!globalThis.__triangularTestReceiver) {
    const child = spawn(process.execPath, [join(__dirname, 'triangular-test-receiver.mjs')], {
      cwd: root, stdio: 'inherit', env: { ...process.env, TRIANGULAR_TEST_PORT: String(port) },
    });
    child.on('error', (error) => console.warn('[triangular-test] receiver failed to start:', error.message));
    process.on('exit', () => child.kill());
    globalThis.__triangularTestReceiver = child;
  }
  return { '/__triangular-test-sink': { target: `http://127.0.0.1:${port}`, secure: false, logLevel: 'warn' } };
};
