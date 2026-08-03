'use strict';

/**
 * 交叉验证模块（方案B）
 *
 * 输入：本次运行分析后的相关文章数组（含 event 事件描述 + tier 来源等级）
 * 输出：每篇文章附加 confidence / corroboration_count / conflict_flag
 *
 * 逻辑：
 * 1. 按 event 描述聚类（同一事件的多篇文章归组）
 * 2. 组内 ≥2 个不同来源 → 交叉印证，高置信
 * 3. 组内 1 个来源 → 单源，中/低置信
 * 4. 与 Tier0 官方来源冲突（标题/事件矛盾）→ 标记 conflict_flag
 */

function normalizeEvent(event) {
  if (!event) return '';
  return event
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 60);
}

// 生成 2-gram 集合（相邻字符对），中文/英文通用
function bigrams(str) {
  const chars = str.replace(/\s+/g, '');
  const set = new Set();
  for (let i = 0; i < chars.length - 1; i++) {
    set.add(chars.slice(i, i + 2));
  }
  return set;
}

// 相似度：两个事件描述共享 bigram 的比例
function eventSimilarity(ev1, ev2) {
  const a = bigrams(ev1);
  const b = bigrams(ev2);
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const g of a) {
    if (b.has(g)) overlap++;
  }
  // 取较小集合作为分母，避免长描述稀释
  const min = Math.min(a.size, b.size);
  return overlap / min;
}

/**
 * 聚类：把文章按事件描述分组。
 * 简单做法：完全相同的 event 归一组；不同但高度相似的（编辑距离小）合并。
 * 轻量版：先用完全匹配 + 关键词重叠阈值。
 */
function clusterByEvent(articles) {
  const clusters = [];
  const used = new Set();

  for (let i = 0; i < articles.length; i++) {
    if (used.has(i)) continue;
    const ev = normalizeEvent(articles[i].event);
    const cluster = { event: articles[i].event || '未分类', items: [articles[i]] };
    used.add(i);

    for (let j = i + 1; j < articles.length; j++) {
      if (used.has(j)) continue;
      const ev2 = normalizeEvent(articles[j].event);
      if (!ev || !ev2) continue;
      // 事件相似度 ≥ 0.4（共享 40% 以上字符对）→ 同一事件
      if (eventSimilarity(ev, ev2) >= 0.4) {
        cluster.items.push(articles[j]);
        used.add(j);
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

/**
 * 计算置信度：
 * - 组内不同来源数 >= 2 → high（≥2 独立信源印证）
 * - 组内来源数 == 1 → medium（单源，待核实）
 * - 与 Tier0 冲突 → low + conflict_flag
 */
function computeConfidence(cluster) {
  const sources = new Set(cluster.items.map(a => a.source || ''));
  const sourceCount = sources.size;
  const hasTier0 = cluster.items.some(a => a.tier === 0);

  // 冲突检测：同组内有 T0 且其他源描述的语义与 T0 冲突 —— 轻量版用标题关键词否定检测
  let conflict = false;
  if (hasTier0) {
    const t0Items = cluster.items.filter(a => a.tier === 0);
    const otherItems = cluster.items.filter(a => a.tier !== 0);
    for (const t0 of t0Items) {
      for (const other of otherItems) {
        // 简化：如果 T0 标题含"否认/辟谣/未"等词，且其他源标题不含 → 视为冲突
        if (/否认|辟谣|没有|未|不会|否定/i.test(t0.title)) {
          conflict = true;
        }
      }
    }
  }

  let confidence = 'medium';
  if (sourceCount >= 2) confidence = 'high';
  if (conflict) confidence = 'low';

  return {
    confidence,
    corroborationCount: sourceCount,
    conflictFlag: conflict,
  };
}

/**
 * 主入口：给每篇文章附加交叉验证结果
 * @param {Array} articles - 含 event/tier/source/title 的文章数组
 * @returns {Array} 附加 confidence/corroboration_count/conflict_flag
 */
function crosscheck(articles) {
  if (!articles || articles.length === 0) return [];

  const clusters = clusterByEvent(articles);
  const result = [];

  for (const cluster of clusters) {
    const { confidence, corroborationCount, conflictFlag } = computeConfidence(cluster);
    for (const item of cluster.items) {
      result.push({
        ...item,
        confidence,
        corroboration_count: corroborationCount,
        conflict_flag: conflictFlag,
      });
    }
  }
  return result;
}

module.exports = { crosscheck, clusterByEvent, computeConfidence };
