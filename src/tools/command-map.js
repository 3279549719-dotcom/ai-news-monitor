'use strict';

/**
 * command-map.js — bash 命令 → registry 工具名 的映射（评审修复 P0-2）
 *
 * 使用日志要能回答"18 工具真实使用率"，就得把 AI 实际跑的 bash 命令
 * 归一到 registry 工具名。匹配策略：
 *   1) 前缀匹配 registry 各工具的 command 字段（npm run xxx / node scripts/xxx.js）
 *   2) npm 脚本名先解析回命令再匹配（读 package.json scripts）
 * 匹配不上返回 null（记作 bash_other，不冒充工具）。
 */

const path = require('path');
const { REGISTRY } = require('./registry');

const PKG_PATH = path.join(__dirname, '..', '..', 'package.json'); // src/tools → 仓库根

let _scriptsCache = null;
function npmScripts() {
  if (_scriptsCache) return _scriptsCache;
  try {
    _scriptsCache = require(PKG_PATH).scripts || {};
  } catch {
    _scriptsCache = {};
  }
  return _scriptsCache;
}

function normalize(cmd) {
  return String(cmd || '').replace(/\\/g, '/').trim();
}

function mapCommandToTool(command) {
  const cmd = normalize(command);
  if (!cmd) return null;

  // npm run <script> → 解析脚本命令
  const npmRun = /^npm\s+run\s+([\w:-]+)/.exec(cmd);
  if (npmRun) {
    const script = npmScripts()[npmRun[1]];
    if (script) {
      const resolved = normalize(script);
      for (const t of Object.values(REGISTRY)) {
        const c = normalize(t.command || '');
        if (c && resolved.startsWith(c)) return t.name;
      }
    }
  }

  // 直接命令前缀匹配
  for (const t of Object.values(REGISTRY)) {
    const c = normalize(t.command || '');
    if (c && (cmd === c || cmd.startsWith(c + ' ') || cmd.startsWith(c + '\n'))) return t.name;
  }
  return null;
}

module.exports = { mapCommandToTool, npmScripts };
