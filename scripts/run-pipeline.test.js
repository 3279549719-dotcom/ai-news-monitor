'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseArgs, healthCheckOutputPath } = require('./run-pipeline');

test('parseArgs: --ci → ci=true', () => {
  assert.strictEqual(parseArgs(['node', 'run-pipeline.js', '--ci']).ci, true);
});

test('parseArgs: 无参全 false', () => {
  const a = parseArgs(['node', 'run-pipeline.js']);
  assert.strictEqual(a.ci, false);
  assert.strictEqual(a.noDocker, false);
  assert.strictEqual(a.noAlert, false);
});

test('parseArgs: --no-docker + --no-alert', () => {
  const a = parseArgs(['node', 'run-pipeline.js', '--no-docker', '--no-alert']);
  assert.strictEqual(a.noDocker, true);
  assert.strictEqual(a.noAlert, true);
});

test('healthCheckOutputPath: win32 → nul', () => {
  assert.strictEqual(healthCheckOutputPath('win32'), 'nul');
});

test('healthCheckOutputPath: linux → /dev/null', () => {
  assert.strictEqual(healthCheckOutputPath('linux'), '/dev/null');
});
