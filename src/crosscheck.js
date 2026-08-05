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

// 去重归一化（Phase9）：小写 + 剥离数字/货币/标点，消 "52.2M" vs "52.5M" 这类跨源措辞噪声
function normalizeForDedup(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[\d.,$€£¥%]+/g, ' ')
    .replace(/[^一-龥a-z]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 文本相似度（标题用）：归一化后共享 bigram 比例
function textSimilarity(a, b) {
  const x = normalizeForDedup(a);
  const y = normalizeForDedup(b);
  if (!x || !y) return 0;
  const gx = bigrams(x);
  const gy = bigrams(y);
  if (gx.size === 0 || gy.size === 0) return 0;
  let overlap = 0;
  for (const g of gx) if (gy.has(g)) overlap++;
  return overlap / Math.min(gx.size, gy.size);
}

// ---- Phase9 去重 v3：文本高相似 OR 专名+动作（见 dedupeBySimilarity 注释）----

// 规则A 阈值：文本高度相似的明确同事件（hack 多源、同场战报等）
const DEDUP_SIM_HIGH = 0.60;
const DEDUP_TITLE_HIGH = 0.45;

/**
 * 动作组信号：检测一条内容（event+title）落在哪个动作组。
 * 返回 { deal, trade, injury } 命中次数。用于规则B（专名+动作）防"同人不同动作"误并。
 */
function actionSignals(event, title) {
  const t = String((event || '') + ' ' + (title || '')).toLowerCase();
  return {
    deal: (t.match(/(续约|签约|签下|加盟|extension|extend|re-sign|renew|agrees?|agreed|deal|contract|sign|signed)/g) || []).length,
    trade: (t.match(/(交易|trade|swap)/g) || []).length,
    injury: (t.match(/(受伤|缺阵|伤情|injur|sidelined|out with)/g) || []).length,
  };
}

function actionGroups(event, title) {
  const s = actionSignals(event, title);
  return Object.entries(s).filter(([, v]) => v > 0).map(([k]) => k);
}

// 动作一致性：两侧均检测到动作组时，必须共享至少一个动作组；任一侧无动作组 → 放行
// （比赛/事故等无 deal/trade/injury 动作词的报道不受此门限制）
function actionsCompatible(a, b) {
  const ga = actionGroups(a.event, a.title);
  const gb = actionGroups(b.event, b.title);
  if (ga.length === 0 || gb.length === 0) return true;
  return ga.some(g => gb.includes(g));
}

// 标题中应剔除的非专名 token（停用词/媒体名/记者名/关键词主体实体），规则B 用
const NON_NOUN_TOKENS = new Set((
  'a an the to of for with and what how in on at from as by be is are was were do does did not no or if then it its ' +
  'his her their this that i you we they about after before first last new next will would could should may ' +
  'bleacher report yahoo sports espn si nba dallasnews guardian sky insider athletic athleticthe shams woj ' +
  'stein marc slater ' +
  // 关键词主体实体（每个关键词都会出现，不具区分度）
  'mavs mavericks dallas united utd man reddevils mufc manchester anthropic claude'
).split(/\s+/));

// 提取标题中的"特有专名"：非停用词/媒体/主体实体的字母 token（≥3 字符）
function distinctiveNouns(title) {
  const tokens = String(title || '')
    .toLowerCase()
    .match(/[a-z][a-z0-9']{2,}/g) || [];
  const seen = new Set();
  for (const t of tokens) {
    if (!NON_NOUN_TOKENS.has(t)) seen.add(t);
  }
  return seen;
}

/**
 * 跨运行同事件判重（Phase9 v3：双规则 + seed-only 聚类配套）。
 * 候选与已存文章是否算同一事件：
 *   规则A：事件相似度 ≥ 0.60 且 标题相似度 ≥ 0.45 → 文本高度相似的明确同事件
 *   规则B：共享特有专名(≥1) 且 两侧均有动作且共享动作组 且 事件相似度 ≥ 0.15
 *         → 同人同事件（如 Naji 续约 BR/Yahoo 措辞不同但共享 Naji+Marshall + deal 动作）
 * 任一侧 event 为空 → 不判重。
 *
 * 为什么不用单一大相似度阈值：Naji 同事件事件相似度 ~0.50，而 Anthropic 不同新闻
 * （发布Opus5 vs 升级语音模式）因共享"Anthropic/Claude"实体相似度也 ~0.35-0.5，
 * 任何单一阈值都会漏掉 Naji 或误并 Anthropic。规则B 用"特有专名 + 动作组"精准区分：
 * Naji 两篇共享球员专名 + 同动作（deal）；Anthropic 不同新闻不共享专名。
 */
function dedupeBySimilarity(candidate, existing) {
  if (!candidate || !existing) return false;
  const ev1 = normalizeEvent(candidate.event);
  const ev2 = normalizeEvent(existing.event);
  if (!ev1 || !ev2) return false;
  const evSim = eventSimilarity(ev1, ev2);

  // 规则A：文本高度相似（明确同事件，如同一事故/同一场比赛的多源报道）。
  // 需动作兼容：独行侠"续约马歇尔"与"交易马歇尔"事件相似度可到 0.67（共享实体），
  // 纯文本阈值挡不住，动作组（deal vs trade）必须一致才放行。
  if (
    evSim >= DEDUP_SIM_HIGH &&
    textSimilarity(candidate.title, existing.title) >= DEDUP_TITLE_HIGH &&
    actionsCompatible(candidate, existing)
  ) {
    return true;
  }

  // 规则B：共享特有专名 + 同一动作组（Naji 类：措辞不同但同人同事件）
  if (evSim < 0.15) return false;
  const nounsA = distinctiveNouns(candidate.title);
  const nounsB = distinctiveNouns(existing.title);
  let shared = false;
  for (const n of nounsA) if (nounsB.has(n)) { shared = true; break; }
  if (!shared) return false;
  const ga = actionGroups(candidate.event, candidate.title);
  const gb = actionGroups(existing.event, existing.title);
  if (ga.length === 0 || gb.length === 0) return false;
  return ga.some(g => gb.includes(g));
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
 * 同批合并（Phase9）：对本次运行的相关文章按"双信号同事件"聚类，
 * 每簇保留 score 最高一篇（代表行）。computeConfidence 已按簇给所有成员赋相同
 * corroboration_count，代表行自然携带多源印证；其余成员丢弃不入库。
 * 注意：event 为空的文章不参与聚类，各自保留。
 */
function collapseSameEvent(articles) {
  if (!articles || articles.length === 0) return [];
  const result = [];
  const used = new Set();
  for (let i = 0; i < articles.length; i++) {
    if (used.has(i)) continue;
    const cluster = [articles[i]];
    used.add(i);
    // seed-only：只与簇首比对，禁止链式传递。
    // 传递聚类会把"相邻两两相似"但首尾完全不同的文章级联并成一簇
    // （实测 Anthropic 14 篇不同新闻被 chain 成一个簇），必须禁掉。
    for (let j = i + 1; j < articles.length; j++) {
      if (used.has(j)) continue;
      if (dedupeBySimilarity(articles[i], articles[j])) {
        cluster.push(articles[j]);
        used.add(j);
      }
    }
    const best = cluster.reduce((a, b) => (b.score > a.score ? b : a));
    result.push(best);
  }
  return result;
}

/**
 * 计算置信度：
 * - 组内不同来源数 >= 2 → high（≥2 独立信源印证）
 * - 组内来源数 == 1 → medium（单源，待核实）
 * - 与 Tier0 冲突 → low + conflict_flag
 */
// 置信度中文标签（日报 buildReport 使用；前端 ConfidenceBadge 有对应映射）
const CONFIDENCE_LABEL = { high: '高置信', medium: '待核实', low: '存疑' };

function computeConfidence(cluster) {
  const sources = new Set(cluster.items.map(a => a.source || ''));
  const sourceCount = sources.size;
  const hasTier0 = cluster.items.some(a => a.tier === 0);

  // 冲突检测（轻量版）：T0 官方标题含"否认/辟谣/未"等否定词 → 视为与爆料冲突
  const conflict = hasTier0 && cluster.items.some(
    a => a.tier === 0 && /否认|辟谣|没有|未|不会|否定/i.test(a.title || '')
  );

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

module.exports = {
  crosscheck,
  clusterByEvent,
  collapseSameEvent,
  dedupeBySimilarity,
  computeConfidence,
  CONFIDENCE_LABEL,
};
