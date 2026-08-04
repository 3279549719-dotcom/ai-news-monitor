# DECISION: Phase 7 — AI 分析管线体验优化 技术选型

> 状态: Decided ｜ 决策日期: 2026-08-04 ｜ 依据: REQ-Phase7-AI分析优化
> 原则: 个人 vibe coding 项目，零新依赖、零新 API、零新部署

---

## 决策结论

**方案：纯 Prompt 重写 + 轻量 Pre-filter。** 不改架构，不加依赖，不动前端。

改动量：`ai.js` ~60 行 + `index.js` ~25 行 + test ~15 行 = **~100 行**。

---

## 一、为什么是这个方案？

### REQ 的三个用户体验目标 → 技术映射

| 用户目标 | 技术手段 | 为什么 prompt 就能解决 |
|----------|----------|----------------------|
| 摘要能省掉点击 | `analyzeResult` prompt 改为三段式强制结构 `【事件】【要点】【为什么重要】` | AI 已经有能力写好摘要，只是 prompt 没要求它这样写。给结构 + 给正反例 → 立竿见影 |
| 分类敢信 | categorySchema 每个板块附**判别标准 + 1 正例 + 1 反例** | 当前只传板块名字，AI 只能瞎猜边界。给了边界规则就能判准 |
| 无关文章零漏入 | ① prompt 硬约束（标题无词根→score≤59）② `index.js` preFilter 代码拦截 | 两道闸门：preFilter 代码层先拦 → prompt 再确认，双保险 |

### 为什么不做更重的方案？

| 方案 | 被拒绝理由 |
|------|-----------|
| Embedding 升级 crosscheck | crosscheck 不是当前日报痛点核心。19篇文章全"待核实"的根因是 bigram 粗糙 + 同次运行内聚类，换成 embedding 解决不了"不同天抓到的同一事件"。而且引入新 API 调用链 |
| 两轮 LLM | DeepSeek 太便宜了，绕过一轮 token 省不了几分钱，但多了一个失败路径 |
| TF-IDF 规则引擎 | 维护负担 > 收益。prompt 能搞定的事不需要手写规则 |
| 改前端 | 前端没问题，问题在数据质量 |

---

## 二、技术细节

### 改动 1：`src/ai.js` — analyzeResult prompt 重构

**新 prompt 结构：**

```
System: 你是信息筛选助手。只输出JSON，不要任何其他文字。

User:
  判断以下文章是否与关键词"${query}"真正相关。

  === 硬性规则（必须遵守） ===

  规则A — 标题词根检查：
  如果标题不含关键词的任何核心词根，score 上限 59。
  示例：关键词"Manchester United"，词根=["Man","United","MUFC","Mufc","老特拉福德","梦剧场"]
        → 标题"Michael Carrick Central Defence Premier League"不含任何词根 → 不相关
  例外：标题提到当前属于该球队的球员名字，视为间接相关。

  规则B — 主次判断：
  如果文章核心主语是另一个实体，关键词仅作为背景提及 → score 上限 59。
  示例：关键词"Anthropic"，文章核心是"AI对冲基金投资组合变动"，Anthropic只是该基金的持仓之一 → 不相关

  === 评分标准 ===

  从以下分数段选择一个，不要选中间值：

  【95】核心主题就是该关键词，整篇文章围绕它展开，深度讨论
  【85】文章明显围绕该关键词展开，占文章大部分篇幅
  【75】文章与该关键词相关，但不是唯一的主题
  【65】边缘相关，文章提到该关键词但并非核心
  【45】标题或正文仅顺带提及
  【25】仅共享某个词或完全不相关
  【0】完全无关

  只有 score≥60 才视为相关。

  === 摘要格式 ===

  当 score≥60 时，摘要严格按三段式输出，不得省略任何一段：

  【事件】一句话说清发生了什么（谁 + 做了什么 + 结果/影响）
  【要点】2-3个具体事实或数据（禁用模糊词：可能、或许、似乎、大概、预计）
  【为什么重要】一句话说明这条信息对关注该关键词的人意味着什么

  禁止行为：
  - 只复述标题
  - 使用"可能讨论了""或许涉及""由于缺乏细节"等占位语
  - 摘要与标题信息量相等

  正面示例：
    关键词："Anthropic"
    标题："Anthropic says its own AI models breached three companies"
    摘要：
      【事件】Anthropic在红队安全测试中发现其Claude模型成功入侵三家合作公司的内部系统
      【要点】①测试对象为三家不同行业的公司 ②Claude通过社会工程学和代码注入两种方式突破防线 ③漏洞均已被修复
      【为什么重要】首次有AI公司公开承认自家模型具备自主攻击能力，将加剧AI安全监管争议

  当 score<60 时，summary/event/category 留空字符串。

  === 板块分类 ===

  从下列板块中选择最贴切的一个（只输出 key）。

  ${categorySchemaWithRules}  ← 每个板块附判别标准+正例+反例

  板块选择的铁律：先读判别标准，再匹配正/反例。不确定时选最接近的，不要选"other"作为偷懒选项。

  === 事件提取 ===

  event 字段用一句话描述文章核心事件。格式："实体 + 动作 + 对象"。
  示例："费内巴切正式报价拉什福德3000万欧元"
  不相关时 event 留空。

  输出JSON格式：
  {"score":整数,"summary":"三段式摘要","event":"事件描述","category":"板块key"}
```

### 改动 2：`src/index.js` — preFilter 函数

在 `processKeyword` 中，`analyzeItems` 前插入：

```js
// 前置过滤：标题不含关键词词根的直接跳过
function preFilter(items, keywordName) {
  const roots = getKeywordRoots(keywordName);
  if (roots.length === 0) return items; // 无法提取词根则全通过
  const filtered = [];
  const skipped = [];
  for (const item of items) {
    const t = (item.title || '').toLowerCase();
    if (roots.some(r => t.includes(r.toLowerCase()))) {
      filtered.push(item);
    } else {
      skipped.push(item);
    }
  }
  if (skipped.length > 0) {
    console.log(`  [PreFilter] ${skipped.length} 条跳过（标题不含词根）`);
  }
  return filtered;
}

// 词根映射表（硬编码三个关键词，新增时追加）
function getKeywordRoots(name) {
  const map = {
    'manchester-united': ['man', 'united', 'mufc', 'mufc', '老特拉福德', '梦剧场', 'red devils', 'rashford', 'bruno', 'garnacho', 'højlund', 'ten hag'],
    'anthropic': ['anthropic', 'claude', 'amodei'],
    'dallas-mavericks': ['maverick', 'mavs', 'dallas', 'doncic', 'luka', 'kyrie', 'irving', 'cuban'],
  };
  return map[name] || [];
}
```

**设计考量：**
- 词根表硬编码在代码里而不放 Supabase——因为这是过滤逻辑不是配置数据，跟 keyword 绑定，不常变
- preFilter 只拦确定无关的（标题里找不到任何词根），有歧义的（含球员名→放行）交给 DeepSeek 最终判断
- 日志里输出跳过数量，方便调试

### 改动 3：`src/ai.js` — 分类 schema 带示例

当前 `categoryHint` 构建方式（仅 key=value）：

```js
// 旧
const options = Object.entries(categorySchema)
  .map(([k, v]) => `"${k}"=${v}`)
  .join('，');
```

改为传入完整规则块，由各关键词的 `category_schema` 字段携带示例。格式约定：

```json
{
  "match": {
    "label": "赛事竞技资讯",
    "match": "比赛结果、球员场上表现、战术布置、伤病影响出场",
    "ok": "拉什福德梅开二度曼联3-1胜",
    "not": "拉什福德续约谈判 → transfer"
  },
  "transfer": {
    "label": "转会&合同动态",
    "match": "球员签约/离队/续约/租借/报价/违约金/合同谈判",
    "ok": "曼联5000万欧报价乌加特",
    "not": "名宿认为曼联买错了人 → analysis"
  }
}
```

`ai.js` 中动态构建板块提示时，展开为：

```
- "transfer"=转会&合同动态
  判别：球员签约/离队/续约/租借/报价/违约金/合同谈判
  正例："曼联5000万欧报价乌加特"
  别选错："名宿认为曼联买错了人"虽然提到"买"，但本质是评论分析 → analysis
```

**兼容性：** 当前 Supabase 的 `category_schema` 是旧格式（`{"transfer":"转会&合同动态"}`）。改 prompt 构建逻辑时同时兼容新旧格式：如果 value 是字符串（旧格式），不展开示例；如果是对象（新格式），展开完整规则。

### 改动 4：`src/ai.js` — selectArticleLinks prompt 硬化

当前 prompt 增加显式排除列表：

```
The following are NOT news articles and MUST be excluded:
- Standings / League tables / Scores / Box scores / Schedule / Fixtures / Results
- Stats / Player statistics / Fantasy sports / Power rankings
- Tickets / Shop / Merchandise / Sponsorship / Suites / Hospitality
- Draft picks (bare list with no story) / Mock drafts
- Video highlights / Photo galleries / Podcast episodes
- "About us" / Contact / Privacy / Terms of service
- Generic navigation: Home, News, Sports, Teams, More
```

---

## 三、验收标准（硬核版）

> 每个项有明确判定规则，Patrick 和 AI 独立判断结果一致才算 pass。全部通过才算交付完成。

### A. 摘要质量（权重 40%）

**判定方式：** 端到端运行后，打开 `reports/` 日报，随机抽取 10 篇摘要，逐条打分。

| # | 检查项 | 判定规则 | 合格线 |
|---|--------|----------|--------|
| A1 | 信息增量 | 摘要告诉了标题没说的信息。反例：标题"费内巴切关注拉什福德"，摘要"费内巴切对拉什福德表示兴趣" → 零增量，不合格 | 10 篇中 ≥8 篇合格 |
| A2 | 无占位语 | 全文搜索日报，不得出现"可能涉及""或许讨论""由于缺乏摘要/细节""具体细节不明"等空洞短语。AI 没拿到足够信息就别说，不要硬编 | 0 次出现 |
| A3 | 三段式完整 | 每条摘要包含 `【事件】` `【要点】` `【为什么重要】` 三个段落标签且内容非空 | 10 篇中 ≥8 篇合格 |
| A4 | 具体事实 | 【要点】部分至少有一条带数字/专有名词（金额、日期、人名、地名）。反例："球队进行了调整" → 不合格；"报价 3000 万欧" → 合格 | 10 篇中 ≥7 篇合格 |

### B. 分类准确度（权重 30%）

**判定方式：** 点开 10 篇文章的原文链接，人工判断类别。

| # | 检查项 | 判定规则 | 合格线 |
|---|--------|----------|--------|
| B1 | 无错配 | 文章真实分类与日报所处板块一致。判断标准：Patrick 认为不合理就算错 | 10 篇中 ≥8 篇正确 |
| B2 | 无"other"滥竽充数 | "其他"/"未分类"板块中的文章，每篇都要有进入该板块的合理理由（即确实不属于任何已定义板块） | "其他"板块 ≤2 篇 |

**常见错配示例（验收时要警惕）：**
- 转会传闻放进了"赛事竞技"（涉及转会操作但非比赛内容）
- 名宿访谈放进了"管理层"（访谈不是俱乐部决策）
- 季前赛赛程公布放进"官方公告"（应该放"赛事竞技"——赛程是赛事的一部分）

### C. 无关文章过滤（权重 20%）

**判定方式：** 浏览日报全部入库文章标题，识别可疑条目。

| # | 检查项 | 判定规则 | 合格线 |
|---|--------|----------|--------|
| C1 | 标题词根关联 | 每篇入库文章标题必须与对应关键词的词根有直接关联。反例：关键词"Manchester United"，标题"Michael Carrick Central Defence Premier League"，Carrick 不是现役球员且标题无 United 词根 → 不合格 | 0 篇异常 |
| C2 | 主次判断 | 关键词不能只是文章的背景板。反例：关键词"Anthropic"，文章核心讲某对冲基金，Anthropic 仅出现在"该基金还持有 Anthropic 股份" → 不合格 | 0 篇异常 |
| C3 | preFilter 日志 | 运行日志中出现 `[PreFilter] X 条跳过（标题不含词根）` 且 X > 0，说明筛选器在工作 | 至少 1 条被拦 |

### D. 评分区分度（权重 10%）

**判定方式：** 统计日报中所有入库文章的 score 分布。

| # | 检查项 | 判定规则 | 合格线 |
|---|--------|----------|--------|
| D1 | 分布不扎堆 | score 值至少覆盖 3 个不同分数段（如 60-69 / 70-79 / 80+）。当前日报 score 全在 65-95，几乎跳过 60-69 | 至少出现 2 个不同十位数段 |
| D2 | 低分区有产出 | 60-69 段至少有一篇入库（证明评分在认真区分，不是闭眼给 75+） | ≥1 篇 |

### E. 无回归（前置条件，不通过则其余免谈）

| # | 检查项 | 判定规则 |
|---|--------|----------|
| E1 | 语法检查 | `node --check src/*.js` 零报错 |
| E2 | 单元测试 | `npm test` 全绿（允许因 prompt 变化导致的断言更新） |
| E3 | 端到端不崩 | `node src/index.js` 跑完不抛异常，`reports/` 生成当天日报 |
| E4 | 三关键词有产出 | MU、Anthropic、Dallas 各至少入库 3 篇（不能优化后某个关键词被误杀到 0） |

---

## 四、验收流程

### 4.1 自动化验收脚本 `scripts/check-quality.js`

> 把验收标准映射为计算机可执行的断言。人只处理机器做不了的主观判断。

每项验收标准的自动化映射：

| 验收项 | 自动化策略 | 可机器判定？ |
|--------|-----------|:---:|
| A1 信息增量 | 禁词检查：摘要中出现"可能""或许""似乎""大概""预计" → 扣分；摘要字数 < 标题字数×2 → 疑似复述 → 警告 | ⚠️ 部分 |
| A2 无占位语 | **正则全量扫描**：`/可能涉及|或许讨论|由于缺乏(摘要|细节)|具体细节不明|整体围绕.*展开|文章讨论了/` → 出现即 FAIL | ✅ 完全 |
| A3 三段式完整 | **正则结构校验**：每条摘要必须包含 `【事件】` `【要点】` `【为什么重要】` 三个标签，且每个标签后跟随非空内容（标签间不能用空行分隔） | ✅ 完全 |
| A4 具体事实 | **正则扫描【要点】段**：`/\d+万|\d+亿|\d+欧元|\d+美元|\d+人|第[一二三]/` — 至少命中 1 个数字/量词模式 | ⚠️ 部分 |
| B1 无错配 | **不可自动化。** 需人工点开链接判断 | ❌ 人肉 |
| B2 无"other"滥竽充数 | **计数检查**：统计"其他"/"未分类"板块下的文章数，>2 → WARN | ✅ 完全 |
| C1 标题词根关联 | **preFilter 反查**：日报中的每篇文章标题，用 getKeywordRoots() 反查是否包含至少一个词根。任意一篇不包含 → FAIL | ✅ 完全 |
| C2 主次判断 | **不可自动化。** 需人工读原文判断关键词是主角还是背景 | ❌ 人肉 |
| C3 preFilter 日志 | **stdout 扫描**：日志中含 `[PreFilter]` 且跳过数 >0 → PASS | ✅ 完全 |
| D1 分布不扎堆 | **score 分布统计**：解析日报中所有 score 值，计算十位数去重计数，<2 → FAIL | ✅ 完全 |
| D2 低分区有产出 | **score 区间检查**：是否至少有一篇 score 在 60-69 区间 → PASS | ✅ 完全 |
| E1-E4 回归 | `node --check src/*.js` + `npm test` + 日报文件存在 + 三关键词均有文章 | ✅ 完全 |

**自动化覆盖率：** 14/18 项可全自动判定（78%）。剩余 2 项（B1 错配 + C2 主次）需人肉抽查，2 项（A1 + A4）给出警告辅助人判断。

### 4.2 检查项精确规则（check-quality.js 逐项实现）

```js
// ===== 输入 =====
// 1. reports/YYYY-MM-DD.md — 当天日报
// 2. run.log — 端到端运行 stdout
// 3. src/index.js — 源码（校验 preFilter/getKeywordRoots 存在）

// ===== 输出格式 =====
// 每项一行：[PASS] / [FAIL] / [WARN] / [SKIP] <检查项代码> <详情>
// 最后一行：SUMMARY: X PASS, Y FAIL, Z WARN
// 退出码：有 FAIL → 1，否则 → 0

const checks = [

  // ── E 类：回归（前置） ──
  {
    id: 'E1', label: '语法检查',
    run() {
      // 执行 node --check src/*.js，exitCode === 0 → PASS
    }
  },
  {
    id: 'E2', label: '单元测试',
    run() {
      // 执行 npm test，exitCode === 0 → PASS
    }
  },
  {
    id: 'E3', label: '端到端不崩',
    run() {
      // 检查 run.log 最后 3 行不含 "Error:" / "Unhandled" / "throw"
      // 且 reports/YYYY-MM-DD.md 文件存在、非空、>500 字节
    }
  },
  {
    id: 'E4', label: '三关键词均有产出',
    run() {
      // 解析日报 ## 标题，从 run.log 提取 `相关: N/` 行
      // 方法：在日报中搜索三个关键词 section 标题
      // "Manchester United" / "Anthropic" / "Dallas Mavericks"
      // 每个 section 下至少有一篇文章（以 "- " 开头的行）
      const sections = ['Manchester United', 'Anthropic', 'Dallas Mavericks'];
      for (const s of sections) {
        const sectionStart = report.indexOf(`## ${s}`);
        const nextSection = report.indexOf('## ', sectionStart + 1);
        const content = report.slice(sectionStart, nextSection > 0 ? nextSection : undefined);
        const articles = content.match(/^- /gm);
        if (!articles || articles.length < 1) return fail(`关键词"${s}"缺少文章`);
      }
      return pass;
    }
  },

  // ── A 类：摘要质量 ──
  {
    id: 'A2', label: '无占位语', required: true,
    run() {
      // 在日报 markdown 中搜索禁用短语
      const banned = [
        /可能涉及/g, /或许讨论/g, /由于缺乏(摘要|细节)/g,
        /具体细节不明/g, /整体围绕.*展开/g, /文章讨论了/g,
        /核心涉及/g, /可能讨论/g, /内容与.*直接相关/g
      ];
      let fails = [];
      for (const re of banned) {
        const lines = report.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            fails.push(`L${i+1}: ${lines[i].trim().slice(0,60)}`);
          }
        }
      }
      return fails.length === 0 ? pass : fail(`${fails.length} 处占位语`, fails);
    }
  },
  {
    id: 'A3', label: '三段式完整', required: true,
    run() {
      // 提取日报中所有文章块（以 "- " 开头，到下一个 "- " 或空行结束）
      // 每个文章块找到 summary 行（含 > 引用块）
      // summary 必须包含【事件】+【要点】+【为什么重要】，且每个标签后跟非空白内容
      const articles = extractArticles(report); // [{title, summary}]
      let missing = 0;
      for (const a of articles) {
        if (!a.summary) { missing++; continue; }
        const hasEvent = /【事件】\S/.test(a.summary);
        const hasPoints = /【要点】\S/.test(a.summary);
        const hasWhy = /【为什么重要】\S/.test(a.summary);
        if (!hasEvent || !hasPoints || !hasWhy) missing++;
      }
      const total = articles.length;
      return missing <= total * 0.2
        ? pass(`${total - missing}/${total} 三段完整`)
        : fail(`${missing}/${total} 缺少三段`);
    }
  },
  {
    id: 'A1', label: '信息增量（辅助）',
    run() {
      // 启发式：摘要中出现模糊词次数
      const fuzzy = ['可能', '或许', '似乎', '大概', '预计', '也许'];
      let count = 0;
      for (const w of fuzzy) {
        count += (report.match(new RegExp(w, 'g')) || []).length;
      }
      const articles = extractArticles(report);
      return count > articles.length * 0.5
        ? warn(`模糊词 ${count} 次，> 文章数一半`)
        : pass(`模糊词 ${count} 次`);
    }
  },
  {
    id: 'A4', label: '具体事实（辅助）',
    run() {
      // 在日报中搜索【要点】段，检查是否含数字/量词
      const points = report.match(/【要点】[^\n【]+/g) || [];
      let withNumber = 0;
      for (const p of points) {
        if (/\d+万|\d+亿|\d+欧元|\d+美元|\d+人|\d+%|第[一二三]/.test(p)) withNumber++;
      }
      return withNumber >= points.length * 0.7
        ? pass(`${withNumber}/${points.length} 【要点】含具体数据`)
        : warn(`${withNumber}/${points.length} 【要点】含具体数据（<70%）`);
    }
  },

  // ── B 类：分类准确度 ──
  {
    id: 'B2', label: 'other板块不滥竽充数',
    run() {
      // 统计日报中 "other"/"未分类" section 下的文章数
      // 先找到 `### (其他|未分类)` 标题，统计到下一个 `###` 之间的 "- " 行数
      const re = /### (其他|未分类|other)/;
      let total = 0;
      const sections = report.split(/^### /gm);
      for (const sec of sections) {
        if (/^(其他|未分类|other)/.test(sec)) {
          total += (sec.match(/^- /gm) || []).length;
        }
      }
      return total <= 2
        ? pass(`"其他"板块 ${total} 篇`)
        : warn(`"其他"板块 ${total} 篇（>2）`);
    }
  },
  // B1 无错配：SKIP（需人工）

  // ── C 类：无关文章过滤 ──
  {
    id: 'C1', label: '标题词根关联', required: true,
    run() {
      // 用 preFilter 逻辑反查日报文章
      // 提取日报中每篇文章的 title，用 getKeywordRoots() 检查
      const KEYWORD_ROOTS = {
        'Manchester United': ['man', 'united', 'mufc', 'mufc', '老特拉福德', '梦剧场', 'red devils', 'rashford', 'bruno', 'garnacho', 'højlund', 'ten hag'],
        'Anthropic': ['anthropic', 'claude', 'amodei'],
        'Dallas Mavericks': ['maverick', 'mavs', 'dallas', 'doncic', 'luka', 'kyrie', 'irving', 'cuban'],
      };
      // 遍历日报，找到每篇文章所属关键词 + 标题，检查词根
      let keyword = null;
      let violations = [];
      for (const line of report.split('\n')) {
        const h2 = line.match(/^## (.+)/);
        if (h2) keyword = h2[1] in KEYWORD_ROOTS ? h2[1] : null;
        const article = line.match(/^- (.+)/);
        if (article && keyword) {
          const title = article[1].trim();
          const roots = KEYWORD_ROOTS[keyword];
          if (!roots.some(r => title.toLowerCase().includes(r.toLowerCase()))) {
            violations.push(title.slice(0, 60));
          }
        }
      }
      return violations.length === 0
        ? pass
        : fail(`标题不含词根: ${violations.length} 篇`, violations);
    }
  },
  // C2 主次判断：SKIP（需人工）

  {
    id: 'C3', label: 'preFilter 工作',
    run() {
      // 在 run.log 中搜索 [PreFilter]
      const log = fs.readFileSync('run.log', 'utf8');
      const match = log.match(/\[PreFilter\] (\d+) 条跳过/);
      return match && parseInt(match[1]) > 0
        ? pass(`preFilter 拦截 ${match[1]} 条`)
        : warn('preFilter 未拦截任何文章（可能本轮无无关文章，或 preFilter 未触发）');
    }
  },

  // ── D 类：评分区分度 ──
  {
    id: 'D1', label: 'score 分布不扎堆',
    run() {
      // 从日报中提取所有 "相关度: N" 的行
      const scores = [];
      const re = /相关度:\s*(\d+)/g;
      let m;
      while ((m = re.exec(report)) !== null) scores.push(parseInt(m[1]));
      if (scores.length === 0) return fail('未找到 score');
      const decades = new Set(scores.map(s => Math.floor(s / 10)));
      return decades.size >= 2
        ? pass(`score 跨越 ${decades.size} 个十位段 (${scores.join(',')})`)
        : fail(`score 全集中在 ${[...decades][0]}0-${[...decades][0]}9 段`);
    }
  },
  {
    id: 'D2', label: '低分区有产出',
    run() {
      const scores = [];
      const re = /相关度:\s*(\d+)/g;
      let m;
      while ((m = re.exec(report)) !== null) scores.push(parseInt(m[1]));
      const low = scores.filter(s => s >= 60 && s <= 69);
      return low.length >= 1
        ? pass(`低分区(60-69) ${low.length} 篇`)
        : warn('无低分区文章 （评分可能偏松）');
    }
  },

];
```

### 4.3 验收流程

```
Step 0: node --check src/*.js && npm test        ← E1/E2 门禁
Step 1: node src/index.js > run.log 2>&1          ← 跑一次，同时保存日志
Step 2: node scripts/check-quality.js              ← 自动化验收，输出 PASS/WARN/FAIL
Step 3: 人工抽查 B1（随机点 5 篇链接确认分类）+ C2（可疑文章点开看主次）
Step 4: 全部 PASS → 更新 PROGRESS → 交付
        WARN/FAIL → 分析根因 → 调 prompt → 回到 Step 1
```

**判定口径：**
- E 类 FAIL → 其余免谈
- A2/A3/C1 任一 FAIL → 必须修到通过才能交付（核心体验红线）
- D 类 FAIL → 可降级为 nice-to-have，记录为"后续微调"
- A1/A4 WARN → 记录，超过 3 次 WARN 视同 FAIL
- B1/C2 → 人肉判定，任一不合格需修

---

## 五、不做的技术决策（及理由）

| 决策 | 理由 |
|------|------|
| 不升级 crosscheck bigram → embedding | 当前日报痛点不在交叉验证（所有文章"待核实"不影响阅读），且 embedding 解决不了"不同天抓到的同事件文章" |
| 不改 category_schema Supabase 存储格式 | 旧格式 `{"transfer":"转会"}` 通过 prompt 构建时兼容即可，不需要 migrate 数据库。后续手动更新 schema 为对象格式就行 |
| 不引入 token 计数/成本监控 | 个人项目 DeepSeek 极便宜，不值得加监控基础设施 |
| 不做 A/B 对比框架 | 改完直接跑一次看效果，肉眼对比日报即可，不需要量化框架 |

---

## 六、风险与回滚

| 风险 | 影响 | 缓解 |
|------|------|------|
| prompt 改太硬导致相关文章被误杀 | 漏新闻 | ① preFilter 只在代码层拦"确定无关"的，玩家名/球队名都放行 ② 硬约束在 prompt 里给了例外判断（球员关联） |
| 三段式摘要偶尔失败（AI 不听话） | 摘要格式不统一 | parseAnalyzeResult 已有容错，不因格式问题丢文章 |
| 分类 prompt 太长撑满 token | 截断 | DEEPSEEK_MODEL 上下文足够大，当前 user prompt < 2000 token，加完示例仍在安全范围 |
| 旧 category_schema 格式兼容出 bug | 分类 prompt 不生效 | 构建时判断 value 类型，字符串走旧路径，对象走新路径 |

**回滚方式：** Git revert 即可。改动集中在 `ai.js` 和 `index.js`，不回滚需要动数据库。

---

## 八、实施顺序

| # | 步骤 | 文件 | 说明 |
|---|------|------|------|
| 1 | analyzeResult prompt 重写 | `src/ai.js` | 核心改动 |
| 2 | selectArticleLinks prompt 硬化 | `src/ai.js` | 顺手 |
| 3 | preFilter + getKeywordRoots | `src/index.js` | ~25 行 |
| 4 | categorySchema 兼容新旧格式 | `src/ai.js` | ~10 行 |
| 5 | 创建自动化验收脚本 | `scripts/check-quality.js` | 含所有可机器判定的检查 |
| 6 | 更新 ai.test.js 断言 | `src/ai.test.js` | 按需 |
| 7 | `node --check` + `npm test` | — | 门禁 |
| 8 | 端到端 `node src/index.js` | — | 产出日报 |
| 9 | 运行 `node scripts/check-quality.js` | — | 自动验收 |
| 10 | 人工抽查 B1 + C2 | — | 最后确认 |
| 11 | 更新 PROGRESS + DOCUMENT_MAP | docs | 收尾 |
