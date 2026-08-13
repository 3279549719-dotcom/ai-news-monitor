'use strict';

/**
 * supabase-check.js — Supabase 平台健康巡检 v1.0
 *
 * 检查项：
 *   1. 平台全局状态（status.supabase.com，无需认证）
 *   2. 项目整体状态（Management API，需 PAT）
 *   3. 分服务健康（db/rest/auth/storage/realtime，需 PAT）
 *   4. 磁盘用量（免费计划 500MB 阈值预警，需 PAT）
 *   5. （可选 --restore）检测到暂停态自动恢复
 *
 * 环境变量：
 *   SUPABASE_ACCESS_TOKEN — Management API PAT（sbp_ 开头，已确认 .env 中旧的 401 需重新生成）
 *   SUPABASE_URL          — 项目 REST URL（与现有 pipeline 共用）
 *   SUPABASE_REF          — 项目 ref（默认从 SUPABASE_URL 提取）
 *
 * 用法：
 *   node scripts/supabase-check.js
 *   node scripts/supabase-check.js --restore   （检测到暂停自动恢复）
 *   node scripts/supabase-check.js --json
 *
 * 退出码：0 = 正常；1 = 异常；2 = 工具错误
 */

const https = require('https');
const path = require('path');

function getEnv(name, fallback = '') {
  return process.env[name] || fallback;
}

const BEARER = 'Bea' + 'rer '; // 防 write 工具腐败

function httpGetJson(url, headers = {}, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get(
      u,
      { headers, timeout: timeoutMs },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode === 200) {
            try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
            catch (e) { reject(new Error('parse error: ' + e.message)); }
          } else {
            resolve({ status: res.statusCode, body: data.slice(0, 200) });
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

function httpPostJson(url, headers = {}, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      u,
      { method: 'POST', headers, timeout: timeoutMs },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

/** 从 SUPABASE_URL 提取 project ref。 */
function extractRef() {
  const url = getEnv('SUPABASE_URL');
  const m = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
  return m ? m[1] : getEnv('SUPABASE_REF');
}

/** 1. 平台全局状态（无需认证）。 */
async function checkPlatformStatus() {
  try {
    const r = await httpGetJson('https://status.supabase.com/api/v2/status.json');
    if (r.status !== 200) {
      return { label: 'Supabase 平台状态', ok: false, detail: '状态页 HTTP ' + r.status };
    }
    const indicator = r.body.status?.indicator;
    if (indicator === 'none') {
      return { label: 'Supabase 平台状态', ok: true, detail: '全系统正常' };
    }
    const desc = r.body.status?.description || indicator;
    return { label: 'Supabase 平台状态', ok: false, detail: '平台级异常: ' + desc };
  } catch (e) {
    return { label: 'Supabase 平台状态', ok: false, detail: e.message };
  }
}

/** 2+3+4. Management API 检查（需 PAT）。 */
async function checkProjectHealth(token, ref) {
  const results = [];
  const headers = { Authorization: BEARER + token };

  // 项目整体状态
  try {
    const r = await httpGetJson(`https://api.supabase.com/v1/projects/${ref}`, headers);
    if (r.status === 401) {
      return { needPat: true, detail: 'SUPABASE_ACCESS_TOKEN 401 已失效（需在 supabase.com/dashboard/account/tokens 重新生成）' };
    }
    if (r.status !== 200) {
      results.push({ label: 'Supabase 项目状态', ok: false, detail: 'HTTP ' + r.status });
      return { needPat: false, results };
    }
    const status = r.body.status;
    const healthyStates = ['ACTIVE_HEALTHY', 'COMING_UP', 'RESTORING'];
    const badStates = ['ACTIVE_UNHEALTHY', 'PAUSING', 'PAUSE_FAILED', 'RESTORE_FAILED', 'INIT_FAILED', 'REMOVED', 'UNKNOWN', 'INACTIVE'];
    const ok = healthyStates.includes(status);
    results.push({
      label: 'Supabase 项目状态',
      ok,
      detail: `${status}${ok ? '' : '（异常状态）'}`,
      status,
    });
  } catch (e) {
    results.push({ label: 'Supabase 项目状态', ok: false, detail: e.message });
    return { needPat: false, results };
  }

  // 分服务健康
  try {
    const r = await httpGetJson(
      `https://api.supabase.com/v1/projects/${ref}/health?services=auth,db,pooler,realtime,rest,storage`,
      headers
    );
    if (r.status === 200) {
      const services = Array.isArray(r.body) ? r.body : (r.body.services || []);
      const unhealthy = services.filter((s) => s.status === 'UNHEALTHY');
      results.push({
        label: 'Supabase 分服务健康',
        ok: unhealthy.length === 0,
        detail: unhealthy.length > 0
          ? '异常: ' + unhealthy.map((s) => s.name).join(', ')
          : services.map((s) => `${s.name}:${s.status}`).join(' '),
      });
    } else {
      results.push({ label: 'Supabase 分服务健康', ok: null, detail: 'HTTP ' + r.status + '（跳过）' });
    }
  } catch (e) {
    results.push({ label: 'Supabase 分服务健康', ok: null, detail: e.message + '（跳过）' });
  }

  // 磁盘用量（免费 500MB，80% 预警）
  try {
    const r = await httpGetJson(`https://api.supabase.com/v1/projects/${ref}/config/disk/util`, headers);
    if (r.status === 200 && r.body.metrics) {
      const m = r.body.metrics;
      const used = m.fs_used_bytes || 0;
      const size = m.fs_size_bytes || 0;
      const pct = size > 0 ? Math.round((used / size) * 100) : null;
      const ok = pct === null || pct < 80;
      results.push({
        label: 'Supabase 磁盘用量',
        ok,
        detail: pct === null
          ? '数据缺失'
          : `${pct}% (${(used / 1024 / 1024).toFixed(0)}MB / ${(size / 1024 / 1024).toFixed(0)}MB)${ok ? '' : ' — 接近免费额度上限'}`,
      });
    } else {
      results.push({ label: 'Supabase 磁盘用量', ok: null, detail: 'HTTP ' + r.status + '（跳过）' });
    }
  } catch (e) {
    results.push({ label: 'Supabase 磁盘用量', ok: null, detail: e.message + '（跳过）' });
  }

  return { needPat: false, results };
}

/** 5. 恢复暂停项目。 */
async function restoreProject(token, ref) {
  const headers = { Authorization: BEARER + token };
  const r = await httpPostJson(`https://api.supabase.com/v1/projects/${ref}/restore`, headers);
  return { ok: r.status === 200, detail: `HTTP ${r.status} ${r.body ? String(r.body).slice(0, 100) : ''}` };
}

/**
 * 主巡检。
 * @param {{restore?: boolean}} opts
 */
async function checkSupabase(opts = {}) {
  const results = [];
  results.push(await checkPlatformStatus());

  const token = getEnv('SUPABASE_ACCESS_TOKEN');
  const ref = extractRef();

  if (!token) {
    results.push({ label: 'Supabase 项目管理', ok: null, detail: 'SUPABASE_ACCESS_TOKEN 未配置，跳过（平台状态页已查）' });
    return results;
  }
  if (!ref) {
    results.push({ label: 'Supabase 项目管理', ok: false, detail: '无法从 SUPABASE_URL 提取 ref' });
    return results;
  }

  const health = await checkProjectHealth(token, ref);
  if (health.needPat) {
    results.push({ label: 'Supabase 项目管理', ok: false, detail: health.detail });
    return results;
  }
  results.push(...health.results);

  // 自动恢复
  if (opts.restore) {
    const projStatus = health.results.find((r) => r.label === 'Supabase 项目状态');
    const needRestore = projStatus && ['PAUSING', 'PAUSE_FAILED', 'RESTORE_FAILED', 'INACTIVE'].includes(projStatus.status);
    if (needRestore) {
      const rr = await restoreProject(token, ref);
      results.push({ label: 'Supabase 自动恢复', ok: rr.ok, detail: rr.ok ? '已触发恢复' : rr.detail });
    }
  }

  return results;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const wantJson = args.includes('--json');
  const restore = args.includes('--restore');

  checkSupabase({ restore }).then((results) => {
    if (wantJson) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      for (const r of results) {
        const mark = r.ok === true ? '✓' : r.ok === false ? '✗' : '—';
        console.log(`  ${mark} ${r.label} — ${r.detail}`);
      }
    }
    const failed = results.filter((r) => r.ok === false).length;
    process.exit(failed > 0 ? 1 : 0);
  }).catch((e) => {
    console.error('✗ Supabase 巡检异常:', e.message);
    process.exit(2);
  });
}

module.exports = { checkSupabase, checkPlatformStatus, checkProjectHealth, restoreProject, extractRef };
