'use strict';

const config = require('./config');

// 通道注册表。email 通道惰性 require('./email')：email.js 顶部 require('./notify')，
// 若 notify 顶层也 require email 会成环；函数内 require 拿到的是已完整加载的缓存模块。
const CHANNELS = {
  email: async (payload, opts = {}) => {
    const email = require('./email');
    return email.sendEmail(payload, opts);
  },
};

// 解析启用的通道名（逗号分隔）。opts.channels 覆盖 config.NOTIFY_CHANNELS（测试用）。
// 兼容字符串（'email,telegram'）与数组（['email']）两种输入形态。
function resolveChannels(opts = {}) {
  const raw = opts.channels != null ? opts.channels : config.NOTIFY_CHANNELS;
  if (Array.isArray(raw)) {
    return raw.map(s => String(s).trim()).filter(Boolean);
  }
  return String(raw || '').split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * 统一通知分发：逐通道投递，单个通道失败不影响其他，绝不向上抛错。
 * @param {{subject:string, text?:string, html?:string}} payload - 通知载荷。
 * @param {{channels?:string[], registry?:Object, config?:Object}} opts
 * @returns {Promise<{sent:boolean, subject?:string, reason?:string, results?:Array}>}
 */
async function notify(payload, opts = {}) {
  const channels = resolveChannels(opts);
  if (channels.length === 0) return { sent: false, reason: 'no channels configured' };

  const registry = opts.registry || CHANNELS;
  const results = [];
  let anySent = false;
  let lastReason = '';
  for (const name of channels) {
    const channel = registry[name];
    if (typeof channel !== 'function') {
      lastReason = `unknown channel: ${name}`;
      continue;
    }
    try {
      const r = await channel(payload, opts);
      results.push({ channel: name, ...(r || {}) });
      if (r && r.sent) anySent = true;
      else if (r && r.reason) lastReason = r.reason;
      else lastReason = `${name} 未确认送达`;
    } catch (err) {
      lastReason = err.message;
      results.push({ channel: name, sent: false, reason: err.message });
    }
  }
  return anySent
    ? { sent: true, subject: payload.subject, results }
    : { sent: false, reason: lastReason || 'all channels failed', results };
}

// 以 notify 函数本身作为模块导出（可调用 + 具名属性）。
// 消费者（email.js/run-pipeline.js）`const notify = require('./notify')` 后直接
// `notify(payload, opts)` 调用；测试 `const { resolveChannels, notify } = require('./notify')`
// 解构具名属性同样可用。
module.exports = notify;
module.exports.CHANNELS = CHANNELS;
module.exports.resolveChannels = resolveChannels;
module.exports.notify = notify;
