'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeUrlKey } = require('./items');

// URL → 去重键：与 items.normalizeUrlKey 同一语义（去协议/www/query/尾斜杠）。
function keyForUrl(url) {
  return normalizeUrlKey(url);
}

// 固定容量环形缓冲：Set 判存在 + 数组保序，超容量逐出最旧，O(1) 均摊。
class SeenRing {
  constructor(capacity = 200) {
    this.capacity = capacity;
    this._set = new Set();
    this._order = [];
  }

  has(key) {
    return this._set.has(key);
  }

  add(key) {
    if (this._set.has(key)) {
      this._bump(key);
      return;
    }
    if (this._order.length >= this.capacity) {
      const oldest = this._order.shift();
      this._set.delete(oldest);
    }
    this._set.add(key);
    this._order.push(key);
  }

  _bump(key) {
    const i = this._order.indexOf(key);
    if (i !== -1) {
      this._order.splice(i, 1);
      this._order.push(key);
    }
  }

  keys() {
    return [...this._order];
  }
}

// 每源一个 SeenRing 的持久化门面：load 惰性失败回退空（文件缺失/损坏不阻断管线）。
class SeenStore {
  constructor(capacity = 200) {
    this.capacity = capacity;
    this.rings = new Map(); // sourceKey -> SeenRing
  }

  static async load({ filePath, capacity = 200 } = {}) {
    const store = new SeenStore(capacity);
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      for (const [sk, keys] of Object.entries(parsed.sources || {})) {
        const ring = new SeenRing(capacity);
        for (const k of keys) ring.add(k); // 超容量在 add 时自动逐出最旧
        store.rings.set(sk, ring);
      }
    } catch {
      // 首次运行/文件损坏：空 store
    }
    return store;
  }

  ringFor(sourceKey) {
    let ring = this.rings.get(sourceKey);
    if (!ring) {
      ring = new SeenRing(this.capacity);
      this.rings.set(sourceKey, ring);
    }
    return ring;
  }

  has(sourceKey, urlKey) {
    return this.ringFor(sourceKey).has(urlKey);
  }

  add(sourceKey, urlKey) {
    this.ringFor(sourceKey).add(urlKey);
  }

  async save({ filePath } = {}) {
    const out = { version: 1, sources: {} };
    for (const [sk, ring] of this.rings) out.sources[sk] = ring.keys();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(out, null, 2), 'utf8');
  }
}

module.exports = { keyForUrl, SeenRing, SeenStore };
