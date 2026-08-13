#!/usr/bin/env node
// harness-usage.js — PostToolUse(Bash) 钩子：每次 Bash 调用记使用日志（评审 P0-2）
// stdin: Claude Code PostToolUse hook JSON（tool_name / tool_input.command / exit_code / duration_ms）
const fs = require('fs');
const { logToolUse } = require('../src/tools/usage-logger');
const { mapCommandToTool } = require('../src/tools/command-map');

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch (e) { /* 非 JSON 输入忽略 */ }

const ti = input.tool_input || {};
const tr = input.tool_response || {};
const command = ti.command || ti.cmdline || '';
const tool = mapCommandToTool(command) || 'bash_other';
// exit_code 可能在顶层（PreToolUse）或 tool_response 里（PostToolUse），容错取
const exitCode = input.exit_code ?? tr.exit_code;

logToolUse({
  tool,
  trigger: 'ai_call',
  success: exitCode == null ? undefined : exitCode === 0,
  durationMs: input.duration_ms || 0,
  files: ti.file_path ? [ti.file_path] : [],
  // 脱敏：擦掉行内 env 赋值（如 SUPABASE_KEY=xxx），再截断
  meta: { command: command.replace(/([A-Z_]{3,})(=)([^\s"']+)/g, '$1$2***').slice(0, 120) },
});
process.exit(0);
