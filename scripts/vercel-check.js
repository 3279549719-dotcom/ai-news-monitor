'use strict';

/**
 * vercel-check.js — Vercel 部署状态巡检 v1.0
 *
 * 轮询 Vercel REST API 检查最新部署状态（Hobby 免费套餐可用，webhook 需 Pro）。
 *
 * 检查项：
 *   1. 最新 production 部署状态（readyState/state）
 *   2. 失败时的 errorCode / errorMessage
 *   3. （可选 --redeploy）对失败部署自动重部署，带冷却文件防循环
 *
 * 环境变量：
 *   VERCEL_TOKEN     — 必填，vercel.com/account/tokens 创建（实测本机为 vcp_ 前缀，vca_ 亦为合法格式）
 *   VERCEL_PROJECT   — 可选，项目名（如 ai-news-monitor），不填自动按仓库搜索
 *   VERCEL_TEAM_ID   — 可选，团队项目需要
 *
 * 用法：
 *   node scripts/vercel-check.js            巡检（发现）
 *   node scripts/vercel-check.js --redeploy 巡检+自动重部署（修复）
 *   node scripts/vercel-check.js --json     输出纯 JSON
 *
 * 退出码：0 = 最新部署正常；1 = 部署失败；2 = 工具/配置错误
 * 模块守卫：require 导入不触发执行。
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const COOLDOWN_PATH = path.join(ROOT, 'logs', '.vercel-redeploy.json');
const COOLDOWN_MS = 60 * 60 * 1000; // 1 小时内同一部署只重部署一次

function getEnv(name, fallback = '') {
  return process.env[name] || fallback;
}

const BEARER = 'Bea' + 'rer '; // 防 write 工具腐败

/** Vercel API GET 封装。 */
function vercelGet(token, pathname, teamId) {
  return new Promise((resolve, reject) => {
    const q = teamId ? '?teamId=' + encodeURIComponent(teamId) : '';
    const url = new URL('https://api.vercel.com' + pathname + q);
    const req = https.get(
      url,
      { headers: { Authorization: 'Bearer ' + token } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode === 200) {
            try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('parse error')); }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
  });
}

/** Vercel API POST 封装（用于 redeploy）。 */
function vercelPost(token, pathname, body, teamId) {
  return new Promise((resolve, reject) => {
    const q = teamId ? '?teamId=' + encodeURIComponent(teamId) : '';
    const payload = JSON.stringify(body);
    const url = new URL('https://api.vercel.com' + pathname + q);
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 30000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(data)); } catch { resolve({}); }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(payload);
    req.end();
  });
}

/** 按项目名/搜索定位项目 ID。 */
async function findProjectId(token, teamId, projectName) {
  const q = '?search=' + encodeURIComponent(projectName);
  const list = await vercelGet(token, '/v10/projects' + q, teamId);
  const p = (list.projects || list || []).find((x) => x.name === projectName)
    || (list.projects || list || [])[0];
  if (!p) throw new Error('未找到项目：' + projectName);
  return p.id;
}

/** 冷却检查：同一部署 ID 1 小时内不重复重部署。 */
function checkCooldown(deploymentId) {
  try {
    if (!fs.existsSync(COOLDOWN_PATH)) return true;
    const j = JSON.parse(fs.readFileSync(COOLDOWN_PATH, 'utf8'));
    if (j.id !== deploymentId) return true;
    return Date.now() - (j.ts || 0) > COOLDOWN_MS;
  } catch {
    return true;
  }
}

function recordRedeploy(deploymentId) {
  try {
    fs.mkdirSync(path.dirname(COOLDOWN_PATH), { recursive: true });
    fs.writeFileSync(COOLDOWN_PATH, JSON.stringify({ id: deploymentId, ts: Date.now() }), 'utf8');
  } catch (e) {
    console.warn('[vercel-check] 冷却记录写入失败:', e.message);
  }
}

/**
 * 主巡检。
 * @param {{redeploy?: boolean}} opts
 * @returns {Promise<{ok:boolean, detail:string, result:object}>}
 */
async function checkVercel(opts = {}) {
  const token = getEnv('VERCEL_TOKEN');
  if (!token) {
    return { ok: null, detail: 'VERCEL_TOKEN 未配置，跳过', result: null };
  }
  const teamId = getEnv('VERCEL_TEAM_ID');
  const projectName = getEnv('VERCEL_PROJECT', 'ai-news-monitor');

  try {
    const projectId = await findProjectId(token, teamId, projectName);
    const list = await vercelGet(token, `/v7/deployments?projectId=${projectId}&limit=3`, teamId);
    const deployments = list.deployments || list || [];
    if (deployments.length === 0) {
      return { ok: true, detail: '无部署记录', result: { deployments: [] } };
    }
    const latest = deployments[0];
    const state = latest.readyState || latest.state;
    const detail = `${latest.target || 'prod'} ${state} | ${latest.url || ''}${latest.errorCode ? ' | ' + latest.errorCode : ''}${latest.errorMessage ? ': ' + latest.errorMessage.slice(0, 80) : ''}`;

    const result = { projectId, latest };

    if (state === 'ERROR') {
      // 拉构建日志（失败原因诊断材料）
      let events = [];
      try {
        const ev = await vercelGet(token, `/v3/deployments/${latest.uid || latest.id}/events?limit=-1`, teamId);
        events = ev || [];
      } catch (e) {
        events = [{ payload: { text: 'events 拉取失败: ' + e.message } }];
      }
      result.events = events;

      // 可选自动重部署
      if (opts.redeploy) {
        if (!checkCooldown(latest.uid || latest.id)) {
          return { ok: false, detail: detail + ' | 冷却中，跳过重部署', result };
        }
        try {
          await vercelPost(token, '/v13/deployments', {
            name: latest.name || projectName,
            deploymentId: latest.uid || latest.id,
            withLatestCommit: true,
            target: latest.target || 'production',
          }, teamId);
          recordRedeploy(latest.uid || latest.id);
          return { ok: false, detail: detail + ' | 已自动重部署', result, redeployed: true };
        } catch (e) {
          return { ok: false, detail: detail + ' | 重部署失败: ' + e.message, result };
        }
      }
      return { ok: false, detail, result };
    }
    return { ok: true, detail, result };
  } catch (e) {
    return { ok: false, detail: 'Vercel API 错误: ' + e.message, result: null };
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const wantJson = args.includes('--json');
  const redeploy = args.includes('--redeploy');

  checkVercel({ redeploy }).then((r) => {
    if (wantJson) {
      console.log(JSON.stringify(r, null, 2));
    } else {
      const mark = r.ok === true ? '✓' : r.ok === false ? '✗' : '—';
      console.log(`  ${mark} Vercel 部署 — ${r.detail}`);
    }
    process.exit(r.ok === false ? 1 : 0);
  }).catch((e) => {
    console.error('✗ Vercel 巡检异常:', e.message);
    process.exit(2);
  });
}

module.exports = { checkVercel, vercelGet, vercelPost, findProjectId };
