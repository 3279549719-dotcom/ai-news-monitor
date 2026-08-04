# REQ: Phase 7 — AI 分析管线体验优化

> 状态: Draft ｜ 创建: 2026-08-04 ｜ 关联: PRD
> 方法: 逆向思考 — 从读者痛点出发，反推 prompt/代码层面的根因和修复

---

## 一、读者视角：当前日报哪里不好读？

以 `reports/2026-08-04.md` 为样本，逐条标注问题。

### 问题 1：摘要看了等于没看

> 日报的目的：3 秒扫一眼摘要 → 决定要不要点链接。当前摘要做不到。

**典型坏例 ① — AI 在猜，不在说**

> "文章标题提及曼联球员迈克尔·卡里克出现在中后卫位置，可能讨论其在该位置的发挥或战术安排。内容与曼联直接相关，围绕球队阵容和球员角色展开。由于缺乏摘要，具体细节不明，但核心涉及曼联。"

读完你知道什么？"可能讨论卡里克打中卫"。没了。Carrick 2018 年就离队了，他为什么又出现在中卫位置？是季前赛客串？是评论员身份分析？完全不知道。**这个摘要没有省掉点链接的时间。**

**典型坏例 ② — 只复述标题**

> "据报道，费内巴切对曼联前锋拉什福德表示兴趣。这则转会传闻引起了广泛关注。目前尚不确定拉什福德是否会转会。"

标题是"Fenerbahce eye Rashford"，摘要说了三句等于一句："费内巴切对拉什福德感兴趣"。报价多少？拉什福德什么态度？曼联愿不愿意放人？**零新增信息。**

**典型坏例 ③ — 打太极**

> "文章分析了达拉斯独行侠在繁忙休赛期后的阵容变化，探讨球队下赛季能否取得进步。内容可能涉及球员交易、签约和选秀等操作，以及对球队竞争力的评估。整体围绕独行侠的未来前景展开深度讨论。"

"可能涉及"、"整体围绕"——全是安全词。文章到底说了什么？独行侠会变强还是变弱？**完全没给判断。**

---

### 问题 2：分类不可信

> 板块设计的初衷：快速跳到自己关心的主题。当前做不到。

| 实际文章 | 当前分类 | 应该在哪 | 偏差 |
|----------|----------|----------|------|
| Carrick 打中卫 | 赛事竞技资讯 | 不可能——Carrick 退役了，这不是赛事 | 🟥 |
| Rashford 转会传闻 | 未证实传闻 | 转会&合同动态 | 🟧 |
| Zaza Pachulia 谈 Dirk | 其他 | 没法分——名宿访谈在 schema 里没位置 | 🟧 |
| Cuban 卖掉股份 | 管理层·教练组 | ✅ 对的 | 🟩 |
| Cuban 卖掉股份 #2 | 管理层·教练组 | ✅ 对的但跟上面是同一事件却没聚类 | 🟧 |
| 季前赛中国行 | 官方公告 | 赛事竞技资讯更贴切 | 🟧 |

根因：AI 只知道板块名字，不知道每个板块的**判别边界**。在它眼里 "官方公告" 和 "赛事竞技资讯" 都是"关于球队的消息"。

---

### 问题 3：偶尔混进不需要的东西

| 坏例 | 为什么不该进来 |
|------|----------------|
| Carrick 文章（score 70） | 标题碰巧含 "Manchester United"，但内容极可能不是关于曼联球队本身的 |
| AI 对冲基金仍持 Anthropic 股份（score 65） | 这是对冲基金故事，Anthropic 只是背景板 |
| Andrey Santos 转会（score 85） | 文章讲 Chelsea+维拉三方交易，曼联是"也感兴趣"的第四方 |

---

### 问题 4：交叉验证只剩装饰

19 篇文章，0 篇标记 "高置信"，全部 "待核实"。交叉验证的置信度徽章在前端板块视图里失去了区分意义——用户看多了就学会了自动忽略。

根因：bigram 聚类太粗糙，而且只有同一次运行内的文章能交叉——不同源报道同一事件如果发布时间差几天，永远聚不到一起。

---

## 二、根因回溯：哪个环节出的问题？

把每个痛点映射到具体代码层：

| 痛点 | 直接根因 | 文件位置 |
|------|----------|----------|
| 摘要空洞/复述/太极 | `ai.js` analyzeResult → prompt 没给摘要结构要求，AI 自由发挥 | `src/ai.js:65-80` |
| 分类不准 | `ai.js` analyzeResult → categorySchema 只传 key=value，没给判别标准 | `src/ai.js:43-49` |
| 无关文章漏入 | `ai.js` analyzeResult → 评分标准只说分数段，没硬约束"标题不含词根→上限59" | `src/ai.js:75-80` |
| 交叉验证无用 | `crosscheck.js` → bigram 只懂字符对不懂语义；只聚类同次运行的文章 | `src/crosscheck.js` |
| 链接精选空 JSON | `ai.js` selectArticleLinks → 没有显式排除体育站导航链接（Standings/Scores/Schedule等） | `src/ai.js:157` |

---

## 三、优化方案

### 原则

- **只改 prompt + 轻量代码**，不引入新依赖、新 API、新部署
- **改动量 < 150 行**，集中在 `ai.js` 和 `index.js`
- **以读者体验为唯一验收标准**

### 改动 1：摘要结构化 ⭐⭐⭐

**当前 prompt：** "请用3句中文简要概括文章核心内容"

**改为：** 三段式强制结构

```
摘要必须按以下三段格式输出，不得省略：

【事件】一句话说清发生了什么（谁 + 做了什么 + 结果）
【要点】2-3个关键事实或数据（不要用"可能""似乎""或许"等模糊词）
【为什么重要】一句话说明这条信息对关注该关键词的人有什么意义

反面示例（禁止）：
  - "文章讨论了...可能涉及..." → 太空洞
  - "据报道，XX对YY表示兴趣" → 只复述标题
  - "整体围绕...展开了讨论" → 没给具体信息

正面示例：
  【事件】费内巴切向曼联提交了对拉什福德的3000万欧元报价，曼联尚未回应
  【要点】①报价3000万欧分两期支付 ②拉什福德合同剩2年 ③土超转会窗8月底关闭
  【为什么重要】拉什福德是曼联青训核心，若离队将标志锋线重建信号
```

### 改动 2：分类加入判别边界 ⭐⭐⭐

**当前：** `"transfer"="转会&合同动态"` — 只有名字。

**改为：** 每个板块附带判别标准 + 正反例

```
板块分类：以下每个板块附判别标准和示例。选择最贴切的。

"match"="赛事竞技"
  特征：比赛结果、球员场上表现、战术布置、伤病影响出场
  正例："拉什福德梅开二度曼联3-1胜"
  反例："拉什福德续约谈判陷入僵局" → transfer

"transfer"="转会&合同动态"
  特征：球员签约/离队/续约/租借、报价/违约金、合同谈判
  正例："曼联5000万欧报价某中场"
  反例："某名宿认为曼联买错了人" → analysis

... (每个板块如此)
```

### 改动 3：硬约束过滤 ⭐⭐

**在 analyzeResult prompt 中新增：**

```
硬性规则（必须遵守）：
1. 如果文章标题不包含关键词的任何一个核心词根，score 上限 59
   示例：关键词="Manchester United"，标题不含"Man"/"United"/"MUFC"/"Mufc"/"老特拉福德"/"梦剧场"任何一个 → 不相关
   例外：标题里提到球员名字且该球员当前属于该球队（需你自行判断）
2. 如果文章核心主语是另一家公司/球队，该关键词仅作为背景被提及 → score 上限 59
   示例：关键词="Anthropic"，文章讲 AI 对冲基金的投资组合变动，Anthropic 仅仅是该基金持仓之一
```

### 改动 4：preFilter（代码层）⭐⭐

在 `index.js` 的 `analyzeItems` 调用前加入：

```js
// 前置过滤：标题不含关键词词根直接跳过，省 DeepSeek 调用
function preFilter(items, keyword) {
  const roots = keywordRoots(keyword); // "Manchester United" → ["Man","United","MUFC","Mufc"]
  return items.filter(item => {
    const t = (item.title || '').toLowerCase();
    return roots.some(r => t.includes(r.toLowerCase()));
  });
}
```

目的：在送给 DeepSeek 之前就拦住明显的无关文章，省 token。

### 改动 5：硬化 selectArticleLinks prompt ⭐

**当前：** "Identify which are NEWS ARTICLES. Ignore navigation/menu/footer/social/homepage/trending-topic links."

**加显式排除列表：**

```
You are a web scraping assistant.

DEFINITION: A "news article" is a piece of editorial content with a specific story or report.
The following are NOT news articles and MUST be excluded:
- Standings / League tables / Scores / Schedule / Fixtures
- Stats / Player statistics / Fantasy sports
- Tickets / Shop / Merchandise / Sponsorship / Suites
- Draft picks (bare list, no story)
- Video highlights / Photo galleries / Podcasts
- "About us" / Contact / Privacy / Terms
- Navigation links (Home, News, Sports, Teams, etc.)

Return ONLY a JSON array of real news articles.
```

---

## 四、验收标准（读者视角）

改完后 `node src/index.js` 运行一次，对比新旧日报，从读者角度打分：

| # | 验收项 | 通过标准 |
|---|--------|----------|
| 1 | **摘要可操作** | 随机抽 5 篇摘要，不需要点原文就能说清"发生了什么+关键事实+为什么重要"。不得出现"可能""或许""具体细节不明"等占位语 |
| 2 | **分类可信** | 随机抽 10 篇文章，人工判断 ≥8 篇分类合理 |
| 3 | **无关文章零漏入** | 所有入库文章标题必须与关键词词根有明确关联 |
| 4 | **评分有区分度** | 入库文章 score 至少在 60-98 区间分布，不只扎堆 70-95 |
| 5 | **无回归** | 三关键词均产出≥3 篇入库；`node --check` + `npm test` 全过 |

---

## 五、影响范围

| 改动文件 | 改动内容 | 行数 |
|----------|----------|------|
| `src/ai.js` | analyzeResult prompt 重写 + selectArticleLinks prompt 硬化 | ~60 |
| `src/index.js` | 新增 preFilter 函数 + processKeyword 中调用 | ~25 |
| `src/ai.test.js` | 更新测试断言（如 score 边界） | ~15 |

**不影响：** 前端、Supabase schema、crosscheck.js、crawl4ai-fetch.js、report.js 结构。

---

## 六、不做

- ❌ 不引入 embedding / TF-IDF / 新 NLP 库
- ❌ 不引入两轮 LLM 调用
- ❌ 不改 crosscheck.js 聚类算法（P5 低严重度，不是当前日报痛点的核心）
- ❌ 不改前端
- ❌ 不新增 Supabase 表/字段
