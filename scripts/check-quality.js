#!/usr/bin/env node
'use strict';

/**
 * check-quality.js — Phase 7 自动化验收脚本
 *
 * 读取当天日报 + 运行日志，逐项比对 DECISION 中的验收标准。
 * 每项输出 [PASS] / [FAIL] / [WARN] / [SKIP]。
 * 有 FAIL → exit 1；全 PASS → exit 0。
 *
 * 用法: node scripts/check-quality.js [report路径] [log路径]
 *       默认: reports/YYYY-MM-DD.md 和 run.log（当前目录）
 */

const fs = require('fs');
const path = require('path');

// ── 工具函数 ──

const PASS = Symbol('PASS');
const FAIL = Symbol('FAIL');
const WARN = Symbol('WARN');
const SKIP = Symbol('SKIP');

function tag(s) { return { [PASS]: '\x1b[32m[PASS]\x1b[0m', [FAIL]: '\x1b[31m[FAIL]\x1b[0m', [WARN]: '\x1b[33m[WARN]\x1b[0m', [SKIP]: '\x1b[37m[SKIP]\x1b[0m' }[s]; }

// 词根表（与 src/index.js 的 getKeywordRoots 保持一致）
const KEYWORD_ROOTS = {
  'Manchester United': ['man', 'united', 'mufc', 'mufc', '老特拉福德', '梦剧场', 'red devils', 'rashford', 'bruno', 'garnacho', 'højlund', 'ten hag'],
  'Anthropic': ['anthropic', 'claude', 'amodei'],
  'Dallas Mavericks': ['maverick', 'mavs', 'dallas', 'doncic', 'luka', 'kyrie', 'irving', 'cuban'],
};

// 关键词名 → category label 映射
const KEYWORD_LABELS = {
  'Manchester United': 'Manchester United',
  'Anthropic': 'Anthropic',
  'Dallas Mavericks': 'Dallas Mavericks',
};

// 提取日报中的文章 [{title, summary, score, category, section}]
function extractArticles(report) {
  const articles = [];
  let currentSection = null;
  let currentArticle = null;

  const lines = report.split('\n');
  for (const line of lines) {
    // 二级标题 → 关键词
    const h2 = line.match(/^## (.+)/);
    if (h2 && h2[1] in KEYWORD_LABELS) {
      currentSection = h2[1];
      continue;
    }

    // 三级标题 → 板块
    const h3 = line.match(/^### (.+)/);
    if (h3) {
      // 结束上一篇文章
      if (currentArticle) {
        currentArticle.category = h3[1];
        articles.push(currentArticle);
        currentArticle = null;
      }
      continue;
    }

    // 文章标题行
    const articleMatch = line.match(/^- (.+)/);
    if (articleMatch) {
      if (currentArticle) {
        articles.push(currentArticle);
      }
      currentArticle = {
        title: articleMatch[1].trim(),
        summary: '',
        score: 0,
        category: null,
        section: currentSection,
      };
      continue;
    }

    // 摘要行 — 紧跟在元数据空行后的非引用文本
    if (currentArticle) {
      const scoreMatch = line.match(/相关度:\s*(\d+)/);
      if (scoreMatch) currentArticle.score = parseInt(scoreMatch[1]);

      // 摘要出现在空行之后、非 URL 非引用行
      if (line && !line.startsWith('  >') && !line.startsWith('http') && !line.startsWith('- ') && !line.startsWith('#') && !line.startsWith('> ')) {
        currentArticle.summary += (currentArticle.summary ? '\n' : '') + line;
      }
    }
  }
  if (currentArticle) articles.push(currentArticle);
  return articles;
}

// ── 检查项 ──

const checks = [];

// E1: 语法检查
checks.push({
  id: 'E1', label: '语法检查',
  run() {
    // 实际执行需在 shell 中，这里检查源文件是否存在
    const files = ['src/ai.js', 'src/index.js', 'src/search.js', 'src/crosscheck.js', 'src/report.js', 'src/config.js', 'src/store.js', 'src/items.js', 'src/tiers.js'];
    const missing = files.filter(f => !fs.existsSync(path.join(__dirname, '..', f)));
    if (missing.length > 0) return [FAIL, `缺失文件: ${missing.join(', ')}`];
    return [SKIP, '需手动执行: node --check src/*.js'];
  }
});

// E2: 单元测试
checks.push({
  id: 'E2', label: '单元测试',
  run() {
    return [SKIP, '需手动执行: npm test'];
  }
});

// E3: 日报文件存在
checks.push({
  id: 'E3', label: '日报文件存在',
  run(report, reportPath) {
    if (!report || report.length < 500) return [FAIL, `日报文件不存在或过短 (${report ? report.length : 0} bytes)`];
    return [PASS, `${reportPath} (${report.length} bytes)`];
  }
});

// E4: 三关键词均有产出
checks.push({
  id: 'E4', label: '三关键词均有产出',
  run(report) {
    const results = {};
    for (const kw of Object.keys(KEYWORD_LABELS)) {
      const sectionStart = report.indexOf(`## ${kw}`);
      const nextSectionIdx = report.indexOf('\n## ', sectionStart + 1);
      const content = report.slice(sectionStart, nextSectionIdx > 0 ? nextSectionIdx : undefined);
      const articles = (content.match(/^- /gm) || []).length;
      results[kw] = articles;
    }
    const fails = Object.entries(results).filter(([, n]) => n < 1).map(([k]) => k);
    if (fails.length > 0) return [FAIL, `缺少文章: ${fails.join(', ')}`];
    return [PASS, `MU:${results['Manchester United']} Anthropic:${results['Anthropic']} Dallas:${results['Dallas Mavericks']}`];
  }
});

// A2: 无占位语
checks.push({
  id: 'A2', label: '无占位语', required: true,
  run(report) {
    const banned = [
      /可能涉及/g, /或许讨论/g, /由于缺乏(摘要|细节)/g,
      /具体细节不明/g, /整体围绕.*展开/g, /文章讨论了/g,
      /核心涉及/g, /可能讨论/g, /内容与.*直接相关/g,
    ];
    const lines = report.split('\n');
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
      for (const re of banned) {
        if (re.test(lines[i])) {
          hits.push(`L${i + 1}: ${lines[i].trim().slice(0, 80)}`);
          break;
        }
      }
    }
    if (hits.length === 0) return [PASS, '0 处占位语'];
    return [FAIL, `${hits.length} 处占位语`, hits.slice(0, 5)];
  }
});

// A3: 三段式完整
checks.push({
  id: 'A3', label: '三段式完整', required: true,
  run(report) {
    const articles = extractArticles(report);
    if (articles.length === 0) return [SKIP, '无文章'];
    let missing = 0;
    const bad = [];
    for (const a of articles) {
      if (!a.summary) { missing++; continue; }
      const hasEvent = /【事件】\S/.test(a.summary);
      const hasPoints = /【要点】\S/.test(a.summary);
      const hasWhy = /【为什么重要】\S/.test(a.summary);
      if (!hasEvent || !hasPoints || !hasWhy) {
        missing++;
        bad.push(a.title.slice(0, 50));
      }
    }
    const total = articles.length;
    if (missing <= total * 0.2) {
      const ok = total - missing;
      return [PASS, `${ok}/${total} 三段完整 (${missing} 缺失)`];
    }
    return [FAIL, `${missing}/${total} 缺少三段结构`, bad.slice(0, 5)];
  }
});

// A1: 信息增量辅助
checks.push({
  id: 'A1', label: '信息增量（辅助）',
  run(report) {
    const fuzzy = ['可能', '或许', '似乎', '大概', '预计', '也许'];
    let count = 0;
    for (const w of fuzzy) {
      count += (report.match(new RegExp(w, 'g')) || []).length;
    }
    const articles = extractArticles(report);
    const threshold = Math.max(articles.length * 0.5, 3);
    if (count > threshold) return [WARN, `模糊词 ${count} 次（>${threshold}）`];
    return [PASS, `模糊词 ${count} 次`];
  }
});

// A4: 具体事实辅助
checks.push({
  id: 'A4', label: '具体事实（辅助）',
  run(report) {
    const points = extractArticles(report).filter(a => a.summary).map(a => {
      const m = a.summary.match(/【要点】([^\n【]*)/);
      return m ? m[1] : '';
    }).filter(Boolean);
    if (points.length === 0) return [SKIP, '无【要点】段'];
    let withNumber = 0;
    for (const p of points) {
      if (/\d+万|\d+亿|\d+欧元|\d+美元|\d+人|\d+%|第[一二三]/.test(p)) withNumber++;
    }
    const ratio = withNumber / points.length;
    if (ratio >= 0.7) return [PASS, `${withNumber}/${points.length} 含具体数据 (${(ratio * 100).toFixed(0)}%)`];
    return [WARN, `${withNumber}/${points.length} 含具体数据 (${(ratio * 100).toFixed(0)}% < 70%)`];
  }
});

// B2: other 板块不滥竽充数
checks.push({
  id: 'B2', label: 'other板块不滥竽充数',
  run(report) {
    const sections = report.split(/^### /gm);
    let total = 0;
    for (const sec of sections) {
      if (/^(其他|未分类|other)/.test(sec)) {
        total += (sec.match(/^- /gm) || []).length;
      }
    }
    if (total <= 2) return [PASS, `"其他/未分类" ${total} 篇`];
    return [WARN, `"其他/未分类" ${total} 篇（>2）`];
  }
});

// C1: 标题词根关联
checks.push({
  id: 'C1', label: '标题词根关联', required: true,
  run(report) {
    const articles = extractArticles(report);
    const violations = [];
    for (const a of articles) {
      if (!a.section) continue;
      const roots = KEYWORD_ROOTS[a.section];
      if (!roots) continue;
      const t = a.title.toLowerCase();
      if (!roots.some(r => t.includes(r.toLowerCase()))) {
        violations.push(`${a.section}: ${a.title.slice(0, 60)}`);
      }
    }
    if (violations.length === 0) return [PASS, `0 篇标题不含词根`];
    return [FAIL, `${violations.length} 篇标题不含词根`, violations.slice(0, 5)];
  }
});

// C3: preFilter 工作
checks.push({
  id: 'C3', label: 'preFilter 工作',
  run(_report, _reportPath, runLog) {
    if (!runLog) return [SKIP, '无 run.log'];
    const match = runLog.match(/\[PreFilter\] (\d+) 条跳过/);
    if (match && parseInt(match[1]) > 0) return [PASS, `preFilter 拦截 ${match[1]} 条`];
    if (match) return [WARN, 'preFilter 触发但未拦截'];
    return [WARN, 'preFilter 未触发（可能本轮无无关文章）'];
  }
});

// D1: score 分布
checks.push({
  id: 'D1', label: 'score 分布不扎堆',
  run(report) {
    const scores = [];
    const re = /相关度:\s*(\d+)/g;
    let m;
    while ((m = re.exec(report)) !== null) scores.push(parseInt(m[1]));
    if (scores.length === 0) return [FAIL, '未找到 score'];
    const decades = new Set(scores.map(s => Math.floor(s / 10)));
    if (decades.size >= 2) return [PASS, `score 跨越 ${decades.size} 个十位段 (${scores.join(',')})`];
    return [FAIL, `score 全集中在 ${[...decades][0]}0-${[...decades][0]}9 段`];
  }
});

// D2: 低分区有产出
checks.push({
  id: 'D2', label: '低分区有产出',
  run(report) {
    const scores = [];
    const re = /相关度:\s*(\d+)/g;
    let m;
    while ((m = re.exec(report)) !== null) scores.push(parseInt(m[1]));
    const low = scores.filter(s => s >= 60 && s <= 69);
    if (low.length >= 1) return [PASS, `低分区(60-69) ${low.length} 篇`];
    return [WARN, '无低分区文章（评分可能偏松）'];
  }
});

// ── 主流程 ──

function main() {
  const today = new Date().toISOString().split('T')[0];
  const reportPath = process.argv[2] || path.join(__dirname, '..', 'reports', `${today}.md`);
  const logPath = process.argv[3] || path.join(process.cwd(), 'run.log');

  let report = '';
  let runLog = '';
  try { report = fs.readFileSync(reportPath, 'utf8'); } catch { /* 文件不存在 */ }
  try { runLog = fs.readFileSync(logPath, 'utf8'); } catch { /* 文件不存在 */ }

  console.log(`=== Phase 7 质量验收 ===`);
  console.log(`日报: ${reportPath} (${report.length} bytes)`);
  console.log(`日志: ${logPath} (${runLog.length} bytes)`);
  console.log('');

  let passCount = 0, failCount = 0, warnCount = 0, skipCount = 0;
  const requiredFails = [];

  for (const check of checks) {
    const [status, msg, details] = check.run(report, reportPath, runLog);
    console.log(`${tag(status)} ${check.id} ${check.label}: ${msg}`);
    if (details && Array.isArray(details) && details.length > 0) {
      for (const d of details) console.log(`       ${d}`);
    }
    if (status === PASS) passCount++;
    else if (status === FAIL) { failCount++; if (check.required) requiredFails.push(check.id); }
    else if (status === WARN) warnCount++;
    else skipCount++;
  }

  console.log('');
  console.log(`SUMMARY: ${passCount} PASS, ${failCount} FAIL, ${warnCount} WARN, ${skipCount} SKIP`);
  if (requiredFails.length > 0) {
    console.log(`\x1b[31m红线 FAIL: ${requiredFails.join(', ')}\x1b[0m`);
  }

  if (failCount > 0) process.exit(1);
  process.exit(0);
}

main();