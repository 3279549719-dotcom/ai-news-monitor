#!/usr/bin/env node
// Harness B1：PreToolUse 危险操作拦截（matcher Bash）
// 拦三条已知 footgun，命中 → stderr 说明 + exit 2 阻止该 Bash 调用。
const fs = require('fs');

let input = {};
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch (e) {
  input = {};
}

const cmd = (input.tool_input && (input.tool_input.command || '')) || '';
const norm = String(cmd).replace(/\\/g, '/');
const reasons = [];

// 规则①：dedup-existing --apply 未带 --dry-run
if (/dedup-existing/.test(norm) && /--apply/.test(norm) && !/--dry-run/.test(norm)) {
  reasons.push(
    '⚠️ [harness B1] 拦截：`dedup-existing --apply` 未带 `--dry-run`。' +
      '硬反向操作必须先跑 `--dry-run` 预览"保留+待删"清单，确认后再执行。'
  );
}

// 规则②：--keep-ids= 等号形式（flag() 只认空格分隔）
if (/--keep-ids\s*=/.test(norm)) {
  reasons.push(
    '⚠️ [harness B1] 拦截：`--keep-ids=` 等号形式会被 flag() 静默忽略' +
      '（keep 集为空 → 全部行被删，2026-08-05 事故）。必须空格分隔：`--keep-ids ID1 ID2`。'
  );
}

// 规则③：node --test src 误触真实管线（src 作测试入口；*.test.js 形式安全不拦）
if (/node\s+--test/.test(norm) && /\bsrc\b/.test(norm) && !/\.test\.js/.test(norm)) {
  reasons.push(
    '⚠️ [harness B1] 拦截：`node --test src` 会把 src 当单个测试入口、误执行 src/index.js' +
      '触发真实管线（连 crawl4ai + DeepSeek + Supabase，写库并生成日报）。请用 `npm test`（`node --test "src/*.test.js"`）。'
  );
}

if (reasons.length > 0) {
  process.stderr.write(reasons.join('\n') + '\n');
  process.exit(2); // 阻止
}
process.exit(0);
