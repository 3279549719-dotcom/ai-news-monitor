'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clusterByEvent, computeConfidence, crosscheck, CONFIDENCE_LABEL } = require('./crosscheck');

test('相似事件描述聚类为一组', () => {
  const articles = [
    { title: 'A', url: '1', source: 'sky', tier: 2, event: '曼联接近签下乌加特' },
    { title: 'B', url: '2', source: 'guardian', tier: 2, event: '曼联即将签下乌加特' },
  ];
  const clusters = clusterByEvent(articles);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].items.length, 2);
});

test('不同事件分成不同组', () => {
  const articles = [
    { title: 'A', url: '1', source: 'sky', tier: 2, event: '曼联接近签下乌加特' },
    { title: 'B', url: '2', source: 'sky', tier: 2, event: '曼联备战新赛季揭幕战' },
  ];
  const clusters = clusterByEvent(articles);
  assert.equal(clusters.length, 2);
});

test('双源印证 → high', () => {
  const cluster = {
    event: 'x',
    items: [
      { title: 'A', source: 'sky', tier: 2 },
      { title: 'B', source: 'guardian', tier: 2 },
    ],
  };
  const r = computeConfidence(cluster);
  assert.equal(r.confidence, 'high');
  assert.equal(r.corroborationCount, 2);
  assert.equal(r.conflictFlag, false);
});

test('单源 → medium', () => {
  const cluster = { event: 'x', items: [{ title: 'A', source: 'sky', tier: 2 }] };
  const r = computeConfidence(cluster);
  assert.equal(r.confidence, 'medium');
  assert.equal(r.corroborationCount, 1);
});

test('T0 官方否认 → low + conflict_flag', () => {
  const cluster = {
    event: 'x',
    items: [
      { title: '曼联否认与乌加特达成协议', source: 'manutd', tier: 0 },
      { title: '乌加特接近加盟曼联', source: 'sky', tier: 2 },
    ],
  };
  const r = computeConfidence(cluster);
  assert.equal(r.confidence, 'low');
  assert.equal(r.conflictFlag, true);
});

test('crosscheck 主入口给每篇附加字段', () => {
  const articles = [
    { title: 'A', url: '1', source: 'sky', tier: 2, event: '曼联接近签下乌加特' },
    { title: 'B', url: '2', source: 'guardian', tier: 2, event: '曼联即将签下乌加特' },
  ];
  const out = crosscheck(articles);
  assert.equal(out.length, 2);
  for (const a of out) {
    assert.ok('confidence' in a);
    assert.ok('corroboration_count' in a);
    assert.ok('conflict_flag' in a);
  }
  assert.equal(out[0].confidence, 'high');
});

test('crosscheck 空输入返回空数组', () => {
  assert.deepEqual(crosscheck([]), []);
});

test('CONFIDENCE_LABEL 覆盖三种置信度', () => {
  assert.equal(CONFIDENCE_LABEL.high, '高置信');
  assert.equal(CONFIDENCE_LABEL.medium, '待核实');
  assert.equal(CONFIDENCE_LABEL.low, '存疑');
});
