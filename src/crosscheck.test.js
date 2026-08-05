'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clusterByEvent, collapseSameEvent, dedupeBySimilarity, computeConfidence, crosscheck, CONFIDENCE_LABEL } = require('./crosscheck');

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

// ---- Phase9 同事件去重 ----

// 真实 Naji 案例（DB 实测）：同一续约事件，跨源措辞/金额不同
const br = { title: 'Mavs Extend Naji Marshall 7-year vet agrees to 3-yr, $52.2M fully guaranteed deal (Shams)', event: '达拉斯独行侠以3年5220万续约纳吉马歇尔', score: 85 };
const yahoo = { title: 'Naji Marshall, Mavericks agree to 3-year, $52.5 million extension', event: 'Naji Marshall与达拉斯独行侠达成3年5250万美元续约', score: 85 };
const si1 = { title: 'What Mavericks Extending Naji Marshall Means For P.J. Washington', event: '达拉斯独行侠续约纳吉马歇尔并可能影响p.j.华盛顿的角色', score: 85 };
const si2 = { title: 'Dallas Mavericks Announce Contract Extension for Forward Despite Roster Logjam', event: '达拉斯独行侠官方宣布与前锋完成续约', score: 85 };

test('dedupeBySimilarity: 同一续约事件跨源判重', () => {
  assert.equal(dedupeBySimilarity(br, yahoo), true);
  assert.equal(dedupeBySimilarity(br, si1), true);
});

test('dedupeBySimilarity: 同人不同事件（受伤）不判重', () => {
  const inj = { title: 'Naji Marshall out two weeks with ankle injury', event: '纳吉马歇尔因脚踝伤缺阵两周' };
  assert.equal(dedupeBySimilarity(br, inj), false);
  assert.equal(dedupeBySimilarity(inj, si1), false);
});

test('dedupeBySimilarity: 同人不同事件（交易 vs 续约）不判重（动作门）', () => {
  const trade = { title: 'Mavericks reportedly trade for Naji Marshall', event: '独行侠交易纳吉马歇尔' };
  assert.equal(dedupeBySimilarity(br, trade), false);
});

test('dedupeBySimilarity: 空 event 不判重', () => {
  assert.equal(dedupeBySimilarity({ title: 'x', event: '' }, { title: 'x', event: '某事件' }), false);
});

test('collapseSameEvent: Naji 主簇（BR/Yahoo/SI1 同事件）合并，泛化公告 SI2 独立', () => {
  const out = collapseSameEvent([br, yahoo, si1, si2]);
  // seed-only：BR 作簇首，Yahoo/SI1 经"专名+动作"并入；SI2 无特有专名，独立保留
  assert.equal(out.length, 2);
});

test('collapseSameEvent: 交易/受伤等不同事件各自独立，不被吞并', () => {
  const inj = { title: 'Naji Marshall out two weeks with ankle injury', event: '纳吉马歇尔因脚踝伤缺阵两周', score: 80 };
  const trade = { title: 'Mavericks reportedly trade for Naji Marshall', event: '独行侠交易纳吉马歇尔', score: 80 };
  const out = collapseSameEvent([br, yahoo, si1, si2, inj, trade]);
  // Naji 主簇 1 + SI2 + 受伤 + 交易 = 4 个独立簇
  assert.equal(out.length, 4);
});

test('collapseSameEvent: 空输入返回空数组', () => {
  assert.deepEqual(collapseSameEvent([]), []);
});
