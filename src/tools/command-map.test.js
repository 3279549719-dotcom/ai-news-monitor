'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mapCommandToTool } = require('./command-map');

test('npm run check → check_all', () => {
  assert.equal(mapCommandToTool('npm run check'), 'check_all');
});

test('node scripts/run-pipeline.js --json → pipeline_run', () => {
  assert.equal(mapCommandToTool('node scripts/run-pipeline.js --json'), 'pipeline_run');
});

test('npm test → check_test', () => {
  assert.equal(mapCommandToTool('npm test'), 'check_test');
});

test('npm run ops:quality --report-path=x → check_quality', () => {
  assert.equal(mapCommandToTool('npm run ops:quality --report-path=x'), 'check_quality');
});

test('未知命令 → null', () => {
  assert.equal(mapCommandToTool('echo hello'), null);
});

test('空命令 → null', () => {
  assert.equal(mapCommandToTool(''), null);
});
