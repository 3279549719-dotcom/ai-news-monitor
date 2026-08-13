'use strict';

/**
 * ai-diagnose.js — AI 诊断脚本 v1.0
 *
 * 读 ops-check 结果 + pipeline 日志 → 调 DeepSeek 生成诊断报告。
 * 双模式：
 *   CI 模式：  node scripts/ai-diagnose.js --ci        （读 stdin 的诊断材料，结果 stdout）
 *   本地模式： node scripts/ai-diagnose.js             （自动读 logs/ 下的最新结果）
 *
 * 环境变量：DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL / DEEPSEEK_MODEL（与 pipeline 共用）
 * 模块守卫：require 导入不触发执行。
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const LOGS_DIR = path.join(ROOT, 'logs');

function getEnv(name, fallback = '') {
  return process.env[name] || fallback;
}

/** 直接 HTTPS 调 DeepSeek（OpenAI 兼容），避免依赖 openai SDK。 */
function callDeepSeek(apiKey, baseUrl, model, system, user) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 1200,
      temperature: 0.2,
    });

    const url = new URL(baseUrl.replace(/\/+$/, '') + '/chat/completions');
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 60000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`DeepSeek HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
            return;
          }
          try {
            const j = JSON.parse(data);
            const msg = j.choices[0].message;
            const text = (msg.content || '') + (msg.reasoning_content || '');
            if (!text.trim()) {
              reject(new Error('empty response from DeepSeek: ' + data.slice(0, 200)));
              return;
            }
            resolve(text.trim());
          } catch (e) {
            reject(new Error('parse response failed: ' + e.message));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('DeepSeek timeout')));
    req.write(body);
    req.end();
  });
}

/** 收集诊断材料（本地模式）。 */
function collectMaterials() {
  const parts = [];

  // ops-check 结果
  const opsPath = path.join(LOGS_DIR, '.ops-check.json');
  if (fs.existsSync(opsPath)) {
    try {
      const ops = JSON.parse(fs.readFileSync(opsPath, 'utf8'));
      parts.push('=== ops-check 结果 ===');
      parts.push(`状态: ${ops.status || 'unknown'} (${ops.ts || 'no ts'})`);
      parts.push(`汇总: ${JSON.stringify(ops.summary || {})}`);
      for (const r of ops.results || []) {
        parts.push(`  [${r.ok === true ? 'PASS' : r.ok === false ? 'FAIL' : 'SKIP'}] ${r.label}: ${r.detail || ''}`);
      }
    } catch (e) {
      parts.push('ops-check 结果无法解析: ' + e.message);
    }
  } else {
    parts.push('（无 .ops-check.json）');
  }

  // 最近 pipeline 日志（取尾部 80 行）
  try {
    const logs = fs.readdirSync(LOGS_DIR)
      .filter((f) => f.startsWith('pipeline-') && f.endsWith('.log'))
      .sort()
      .reverse();
    if (logs.length > 0) {
      const content = fs.readFileSync(path.join(LOGS_DIR, logs[0]), 'utf8');
      const tail = content.split('\n').slice(-80).join('\n');
      parts.push(`\n=== 最近 pipeline 日志尾部 (${logs[0]}) ===`);
      parts.push(tail);
    }
  } catch (e) {
    parts.push('（无 pipeline 日志: ' + e.message + '）');
  }

  // auto-heal 历史
  const healPath = path.join(LOGS_DIR, '.auto-heal.json');
  if (fs.existsSync(healPath)) {
    try {
      const heal = JSON.parse(fs.readFileSync(healPath, 'utf8'));
      parts.push('\n=== 自愈历史 ===');
      parts.push(JSON.stringify(heal.history || []).slice(0, 800));
    } catch { /* ignore */ }
  }

  return parts.join('\n');
}

const SYSTEM_PROMPT = `你是资深运维工程师，负责诊断 ai-news-monitor 项目的运维巡检失败。请输出 Markdown 格式诊断报告：
## 诊断结论
（一句话根因）
## 失败项分析
（每项：现象 → 原因 → 证据）
## 修复建议
（按优先级，具体命令或步骤）
## 是否需要人工介入
（是/否 + 原因）
保持简洁，只输出诊断报告本身。`;

/**
 * 主函数：生成诊断。
 * @param {string} [materials] - 诊断材料；CI 模式传 stdin 内容，本地模式自动收集。
 */
async function diagnose(materials) {
  const apiKey = getEnv('DEEPSEEK_API_KEY');
  const baseUrl = getEnv('DEEPSEEK_BASE_URL', 'https://api.deepseek.com');
  const model = getEnv('DEEPSEEK_MODEL', 'deepseek-chat');

  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY 未配置');
  }

  const src = materials || collectMaterials();
  return callDeepSeek(apiKey, baseUrl, model, SYSTEM_PROMPT, src);
}

if (require.main === module) {
  const isCI = process.argv.includes('--ci');
  (async () => {
    try {
      let materials = null;
      if (isCI) {
        materials = fs.readFileSync(0, 'utf8'); // stdin
      }
      const report = await diagnose(materials);
      console.log(report);
      process.exit(0);
    } catch (e) {
      console.error('❌ 诊断失败:', e.message);
      process.exit(2);
    }
  })();
}

module.exports = { diagnose, collectMaterials, callDeepSeek };
