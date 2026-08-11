'use strict';

/**
 * tools/registry.js — 结构化工具注册表
 *
 * 把所有 npm scripts / scripts/*.js / harness 封装为符合 Anthropic/OpenAI
 * function calling 规范的 JSON Schema 工具定义。AI 通过这个 registry 理解
 * 本项目的可用工具，不再靠裸 bash("npm run xxx") 猜参数。
 *
 * 每个工具定义包含：
 *   - name: 工具名（kebab-case，语义前缀命名空间）
 *   - description: 3-4 句详细描述（做什么、何时用/何时不用、边界条件、限制）
 *   - parameters: JSON Schema 规范参数
 *   - input_examples: 1-3 个真实场景示例
 *   - return_schema: 返回值结构描述（帮助 AI 理解输出）
 *   - command: 实际执行命令（向后兼容 bash 调用）
 *   - defer_loading: 是否按需加载（高频工具 false，低频工具 true）
 *
 * 约定：
 *   - 工具名按命名空间分组：check_ / commit_ / pipeline_ / ops_ / data_ / harness_
 *   - 始终加载（defer_loading=false）的工具 ≤ 5 个
 *   - 其余标记 defer_loading=true，AI 按需发现
 *
 * @module tools/registry
 */

// ============================================================================
// 工具定义
// ============================================================================

const REGISTRY = {
  // ── 始终加载的核心工具（高频，defer_loading=false）────────────────────
  //
  // 选择标准：AI 在当前项目中每次会话几乎必定用到
  //   1. check_all — 改代码后必须验证
  //   2. check_test — 改逻辑后必须跑测试
  //   3. commit_git — 改完验证通过后要提交
  //   4. pipeline_auto — 日常运维高频
  //   5. ops_check — 出了问题先诊断

  check_all: {
    name: 'check_all',
    description: [
      '运行项目全套验证流程：后端语法检查（node --check src/ scripts/ 下所有 .js）、',
      '前端 TypeScript 类型检查、前端 ESLint、后端全量测试。',
      '',
      '何时用：修改任何 src/ 或 client/ 下的代码后、准备 git commit 之前。',
      '何时不用：只想验证语法时用 check_syntax；只想跑测试时用 check_test；',
      '只改了 markdown/json 等非代码文件时不需要。',
      '',
      '限制：这是重量级检查，耗时 15-60 秒。每次只跑全部，无法指定只检查某个文件。',
      '所有阶段都通过才算成功，任一失败都会在输出中标明失败的具体阶段和原因。',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    input_examples: [
      {},
      { 'comment': '工具无参数，总是跑全部检查' },
    ],
    return_schema: {
      type: 'object',
      properties: {
        passed: { type: 'boolean', description: '所有检查是否全部通过' },
        stages: {
          type: 'object',
          properties: {
            lint: { type: 'string', enum: ['pass', 'fail'] },
            type_check: { type: 'string', enum: ['pass', 'fail'] },
            test: { type: 'string', enum: ['pass', 'fail'] },
          },
        },
        failures: { type: 'array', items: { type: 'string' }, description: '失败项的简要说明列表' },
      },
    },
    command: 'npm run check',
    defer_loading: false,
    namespace: 'check',
    tags: ['验证', '高频'],
  },

  check_test: {
    name: 'check_test',
    description: [
      '只运行后端测试套件（node --test "src/*.test.js"），不跑 lint 和 type-check。',
      '',
      '何时用：修改了后端逻辑后快速验证；check_all 太慢时先跑测试。',
      '何时不用：改了前端 TypeScript 代码时用 check_type；改了样式/配置时不需要。',
      '',
      '限制：只覆盖 src/*.test.js 下的测试文件。新增代码如果没有对应测试文件不会被覆盖。',
      '测试失败时会输出失败用例名称和断言差异，但不提供自动修复建议。',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        watch: {
          type: 'boolean',
          description: '是否以 watch 模式持续运行（默认 false，跑完即退出）',
        },
      },
      required: [],
      additionalProperties: false,
    },
    input_examples: [
      {},
      { watch: true, 'comment': '开发时持续监控测试结果' },
    ],
    return_schema: {
      type: 'object',
      properties: {
        passed: { type: 'boolean' },
        total: { type: 'number', description: '测试用例总数' },
        failed: { type: 'number', description: '失败用例数' },
        failures: { type: 'array', items: { type: 'string' } },
      },
    },
    command: 'npm test',
    defer_loading: false,
    namespace: 'check',
    tags: ['验证', '高频'],
  },

  commit_git: {
    name: 'commit_git',
    description: [
      '提交当前暂存区的改动到 Git 仓库，支持 conventional commit 格式校验。',
      '会自动：校验提交信息格式（type(scope): 描述）→ 拦截 .env* 敏感文件入暂存 →',
      '执行 git commit。可选推送和跳过 pre-commit 检查。',
      '',
      '何时用：代码改动通过 check_all 验证后准备提交。',
      '何时不用：没有改动时、没跑过 check_all 时。',
      '不要用这个工具做 force-push —— 项目禁止 force-push。',
      '',
      '限制：提交前必须先 git add 暂存文件。不能同时 --amend 和 --push。',
      '跳过检查（-n）跳过了 hook 但仍会拦截 .env* 文件。',
      '推送时会自动 fetch → 评估分叉 → rebase 后 push，符合项目 Git Push 铁律。',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: '提交信息，conventional commit 格式：type(scope): 描述。type 可选 feat/fix/docs/refactor/test/chore 等',
        },
        push: {
          type: 'boolean',
          description: '提交后是否推送到 origin（默认 false，只提交不推送）',
        },
        skipCheck: {
          type: 'boolean',
          description: '是否跳过 pre-commit 全套检查（默认 false）。仍会拦截 .env* 文件',
        },
        stageAll: {
          type: 'boolean',
          description: '是否先 git add -A 暂存全部改动（默认 false，需手动暂存）',
        },
      },
      required: ['message'],
      additionalProperties: false,
    },
    input_examples: [
      { message: 'feat(ai): 增加 event_type 分类支持', 'comment': '仅提交不推送' },
      { message: 'fix(pipeline): 修复 Docker 自愈重试逻辑', push: true, 'comment': '提交并推送' },
      { message: 'docs: 更新 AGENTS.md 行为规范', skipCheck: true, 'comment': '文档变更跳过检查' },
    ],
    return_schema: {
      type: 'object',
      properties: {
        committed: { type: 'boolean' },
        pushed: { type: 'boolean', description: '仅 push=true 时有意义' },
        branch: { type: 'string', description: '提交到的分支名' },
        message: { type: 'string', description: '实际提交信息' },
      },
    },
    command: 'npm run commit --',
    defer_loading: false,
    namespace: 'commit',
    tags: ['Git', '高频'],
  },

  pipeline_run: {
    name: 'pipeline_run',
    description: [
      '运行一次完整的信息监控管线：启动 Docker crawl4ai 容器 → 抓取所有关键词的',
      '信源内容 → AI 评分过滤 → 生成日报 → 发送邮件摘要 → 持久化到 Supabase。',
      '管线会自动自愈 Docker 容器（docker start → 健康检查 → 失败则重启 Docker 引擎）。',
      '',
      '何时用：手动触发一次信息搜集和评分；定时任务每天自动跑。',
      '何时不用：只想快速测试某个信源抓取时用 test_scrape 工具；只想看日报内容时直接读 reports/。',
      '',
      '限制：依赖 Docker Desktop 和 crawl4ai 容器在线。Docker 不可用时仍会降级运行',
      '（所有网站信源走 scraper-direct 备胎通道），但数据质量会下降。',
      '运行时间 2-10 分钟取决于信源数量。会自动将日志写入 logs/pipeline-YYYY-MM-DD.log。',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        noDocker: {
          type: 'boolean',
          description: '跳过 Docker 容器管理（默认 false）。适合 CI 或容器已由外部管理的场景',
        },
        noAlert: {
          type: 'boolean',
          description: '跳过告警邮件（默认 false）。适合测试运行，避免误发告警',
        },
        ci: {
          type: 'boolean',
          description: 'CI 模式：容器由 job 管理，仅健康检查不做自愈（默认 false）',
        },
      },
      required: [],
      additionalProperties: false,
    },
    input_examples: [
      {},
      { noAlert: true, 'comment': '测试运行，不发告警邮件' },
      { noDocker: true, 'comment': '容器自行管理，跳过自愈' },
    ],
    return_schema: {
      type: 'object',
      properties: {
        started: { type: 'boolean', description: '管线是否成功启动' },
        crawl4ai_ready: { type: 'boolean', description: 'crawl4ai 容器是否就绪' },
        log_file: { type: 'string', description: '日志文件路径' },
        status_file: { type: 'string', description: '状态文件路径 logs/.last-run.json' },
      },
    },
    command: 'node scripts/run-pipeline.js',
    defer_loading: false,
    namespace: 'pipeline',
    tags: ['运维', '管线', '高频'],
  },

  ops_check: {
    name: 'ops_check',
    description: [
      '运行运维巡检，检查项目各项基础设施健康状态：Docker/crawl4ai 容器、',
      '磁盘余量、最近一次管线运行状态（是否成功、日志中有多少错误行）、',
      'Supabase 近 24h 新文章量（检测数据囤积）、npm 依赖完整性。',
      '',
      '何时用：管线执行异常后诊断原因；定期健康巡检；CI/CD 流水线中做质量门禁。',
      '何时不用：只想看管线运行日志时直接读 logs/pipeline-YYYY-MM-DD.log；',
      '确定是代码问题而非基础设施问题时用 check_all。',
      '',
      '限制：本地完整模式需要 Docker Desktop 运行（检查容器状态）；',
      '--light 模式跳过 Docker 和磁盘检查；--actions 模式适配 GitHub Actions 环境。',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['full', 'light', 'actions'],
          description: '检查模式。full=本地完整（默认），light=跳过Docker+磁盘，actions=GitHub Actions适配',
        },
      },
      required: [],
      additionalProperties: false,
    },
    input_examples: [
      {},
      { mode: 'light', 'comment': '轻量模式，跳过 Docker 检查' },
      { mode: 'actions', 'comment': 'GitHub Actions 环境' },
    ],
    return_schema: {
      type: 'object',
      properties: {
        healthy: { type: 'boolean', description: '整体健康状态' },
        checks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              status: { type: 'string', enum: ['pass', 'fail', 'warn', 'skip'] },
              message: { type: 'string' },
            },
          },
        },
        summary: { type: 'string' },
      },
    },
    command: 'node scripts/ops-check.js',
    defer_loading: false,
    namespace: 'ops',
    tags: ['运维', '诊断', '高频'],
  },

  // ── 按需加载的工具（defer_loading=true）───────────────────────────

  check_syntax: {
    name: 'check_syntax',
    description: [
      '只检查后端 JavaScript 语法（node --check 对所有 src/ scripts/ 下的 .js 文件）。',
      '比 check_all 快很多（1-3 秒），适合只改了少量后端文件后快速验证。',
      '',
      '何时用：只改了后端 .js 文件且只需语法检查时。',
      '何时不用：改了前端 TypeScript 文件时用 check_type；需要全面验证时用 check_all。',
      '',
      '限制：只做语法检查，不做类型推导和逻辑分析。通过语法检查不代表代码能正常运行。',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    input_examples: [{}],
    return_schema: {
      type: 'object',
      properties: {
        passed: { type: 'boolean' },
        files_checked: { type: 'number' },
        failures: { type: 'array', items: { type: 'string' } },
      },
    },
    command: 'npm run lint:backend',
    defer_loading: true,
    namespace: 'check',
    tags: ['验证'],
  },

  check_type: {
    name: 'check_type',
    description: [
      '只运行前端 TypeScript 类型检查（client/ 目录）。',
      '',
      '何时用：改了前端 .ts/.tsx 文件后验证类型安全。',
      '何时不用：纯后端改动不需要；配置/json/css 改动不需要。',
      '',
      '限制：只检查 client/ 下的 TypeScript。后端用 check_syntax。',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    input_examples: [{}],
    return_schema: {
      type: 'object',
      properties: {
        passed: { type: 'boolean' },
        errors: { type: 'array', items: { type: 'string' } },
      },
    },
    command: 'npm run type-check',
    defer_loading: true,
    namespace: 'check',
    tags: ['验证', '前端'],
  },

  check_quality: {
    name: 'check_quality',
    description: [
      '运行日报质量验收：读取当天日报 + 运行日志，逐项比对质量验收标准。',
      '检查项：日报存在性、三关键词产出、无占位语、三段式完整、事实锚点、',
      '信息增量、标题词根关联、score 分布、preFilter 工作等 15+ 项。',
      '',
      '何时用：管线跑完后验收日报质量；发现有 FAIL 条目时排查摘要质量问题。',
      '何时不用：不是修摘要问题——这个工具只诊断不修复。要修复用 data_backfill。',
      '',
      '限制：需要当天 reports/YYYY-MM-DD.md 存在。有 FAIL → exit 1（CI 可据此阻断）。',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        report_path: {
          type: 'string',
          description: '日报文件路径。默认 reports/YYYY-MM-DD.md（当天）',
        },
        log_path: {
          type: 'string',
          description: '运行日志路径。默认 run.log（当前目录）',
        },
      },
      required: [],
      additionalProperties: false,
    },
    input_examples: [
      {},
      { report_path: 'reports/2026-08-11.md', log_path: 'logs/pipeline-2026-08-11.log' },
    ],
    return_schema: {
      type: 'object',
      properties: {
        passed: { type: 'boolean' },
        pass_count: { type: 'number' },
        fail_count: { type: 'number' },
        warn_count: { type: 'number' },
        skip_count: { type: 'number' },
        required_fails: { type: 'array', items: { type: 'string' }, description: '红线 FAIL 项 ID' },
      },
    },
    command: 'npm run ops:quality',
    defer_loading: true,
    namespace: 'check',
    tags: ['质量', '验收'],
  },

  pipeline_schedule: {
    name: 'pipeline_schedule',
    description: [
      '在 Windows 任务计划程序中注册/查看/卸载每日定时管线任务。',
      '注册后每天指定时间（默认 08:00）自动运行 run-pipeline.js。',
      '',
      '何时用：首次部署后注册定时任务；需要修改执行时间；不再需要自动化时卸载。',
      '何时不用：只是想手动跑一次管线时用 pipeline_run。',
      '',
      '限制：只支持 Windows（依赖 schtasks.exe）。任务仅在用户登录时运行。',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['install', 'info', 'remove'],
          description: '操作类型。install=注册每日任务，info=查看任务详情，remove=删除任务',
        },
        time: {
          type: 'string',
          description: '每日执行时间（HH:MM 格式，默认 08:00）。仅在 action=install 时有效',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    input_examples: [
      { action: 'install' },
      { action: 'install', time: '07:30' },
      { action: 'info' },
      { action: 'remove' },
    ],
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        task_name: { type: 'string' },
        details: { type: 'string' },
      },
    },
    command: 'node scripts/install-schedule.js',
    defer_loading: true,
    namespace: 'pipeline',
    tags: ['运维', '定时任务'],
  },

  pipeline_auto_heal: {
    name: 'pipeline_auto_heal',
    description: [
      '自动修复脚本：读取上一次管线执行状态，如果今天未跑或失败，',
      '运行 ops_check 诊断 → 根据白名单命令匹配修复策略 → 执行修复。',
      '修复后写入 logs/.auto-heal.json。',
      '',
      '何时用：收到管线告警邮件后让 AI 自行排查和修复；定期健康巡检发现异常时。',
      '何时不用：修复策略未覆盖的复杂问题（仍需人工介入）。',
      '',
      '限制：修复能力受 .auto-fix.json 白名单限制，只能处理已知故障模式。',
      '如果自动修复失败（exit 1），需要人工介入排查。',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    input_examples: [{}],
    return_schema: {
      type: 'object',
      properties: {
        healed: { type: 'boolean' },
        diagnosis: { type: 'object', description: '诊断结果摘要' },
        actions: { type: 'array', items: { type: 'string' }, description: '执行的修复操作列表' },
        log_file: { type: 'string', description: '修复日志路径' },
      },
    },
    command: 'node scripts/auto-heal.js',
    defer_loading: true,
    namespace: 'pipeline',
    tags: ['运维', '自愈'],
  },

  data_backfill: {
    name: 'data_backfill',
    description: [
      '对存量相关文章用正文喂养管线重算摘要/event/event_type/category/score。',
      '解决旧管线只喂标题导致摘要望文生义的问题。',
      '',
      '何时用：管线算法升级后需要重算历史数据；发现某批文章摘要质量差时。',
      '何时不用：常规管线运行不需要（新数据自动走新管线）。',
      '',
      '限制：依赖 crawl4ai 容器在线（抓取正文）和 DeepSeek API。',
      '建议 pool=1 串行模式——crawl4ai 容器并发过载会导致大面积正文缺失。',
      '默认运行在 score≥60 的文章上；--lt60 修复模式只处理低分文章。',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        dry_run: {
          type: 'boolean',
          description: '预览模式（默认 false），不实际写入数据库',
        },
        lt60: {
          type: 'boolean',
          description: '修复模式：只处理当前 score<60 的文章（默认处理 score≥60）',
        },
        keyword: {
          type: 'string',
          description: '限定关键词（如 dallas-mavericks），不传则处理所有关键词',
        },
        limit: { type: 'number', description: '最多处理 N 篇文章' },
        pool: {
          type: 'number',
          description: '并发数（默认 1）。建议保持 1，高并发会导致 crawl4ai 正文缺失',
        },
      },
      required: [],
      additionalProperties: false,
    },
    input_examples: [
      { dry_run: true, 'comment': '预览要处理的文章列表' },
      { keyword: 'dallas-mavericks', limit: 20 },
      { lt60: true, keyword: 'anthropic', 'comment': '修复被误判的低分文章' },
    ],
    return_schema: {
      type: 'object',
      properties: {
        processed: { type: 'number', description: '处理文章数' },
        updated: { type: 'number', description: '实际更新的行数' },
        skipped: { type: 'number', description: '跳过的行数' },
        errors: { type: 'array', items: { type: 'string' } },
      },
    },
    command: 'npm run ops:backfill',
    defer_loading: true,
    namespace: 'data',
    tags: ['数据', '回填'],
  },

  data_dedup: {
    name: 'data_dedup',
    description: [
      '对近 30 天 score≥60 的相关文章，按"双信号同事件"规则聚类去重。',
      '每簇保留最高分一篇，其余删除。解决同一事件跨信源/跨运行各存各的重复问题。',
      '',
      '何时用：发现日报中有多篇文章报道同一事件时；定期清理存量重复数据。',
      '何时不用：常规管线运行已经内置同批次去重，这个工具是针对跨运行重复。',
      '',
      '⚠️ 警告：删除不可逆！必须先 --dry-run 预览，确认无误后再 --apply。',
      '未带 --dry-run 的 --apply 会被 harness pretooluse 拦截。',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        dry_run: {
          type: 'boolean',
          description: '预览模式（默认 false），列出保留/待删清单但不执行',
        },
        apply: {
          type: 'boolean',
          description: '执行删除。⚠️ 必须先用 --dry-run 预览确认！',
        },
        keyword: {
          type: 'string',
          description: '限定关键词（如 dallas-mavericks），不传则处理所有',
        },
        days: {
          type: 'number',
          description: '回溯天数（默认 30）',
        },
        keep_ids: {
          type: 'string',
          description: '不删除的文章 id，逗号分隔。用于保护被误并的边缘关联行',
        },
      },
      required: [],
      additionalProperties: false,
    },
    input_examples: [
      { dry_run: true, 'comment': '先预览，不执行' },
      { apply: true, keyword: 'dallas-mavericks', 'comment': '确认预览结果后执行' },
      { apply: true, keep_ids: 'abc123,def456', 'comment': '保护特定文章不删' },
    ],
    return_schema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['dry_run', 'apply'] },
        clusters: { type: 'number', description: '重复簇数量' },
        kept: { type: 'number', description: '保留文章数' },
        removing: { type: 'number', description: '待删除/已删除文章数' },
      },
    },
    command: 'npm run ops:dedup',
    defer_loading: true,
    namespace: 'data',
    tags: ['数据', '去重', '危险操作'],
  },

  ops_screenshot: {
    name: 'ops_screenshot',
    description: [
      '用 Playwright 对前端页面做截图验证。支持自定义 URL、输出路径、视口尺寸。',
      '',
      '何时用：前端 UI 改完后验证视觉效果；打包日报截图附件。',
      '何时不用：纯后端改动不需要。',
      '',
      '限制：需要 Playwright 浏览器已安装（C:\\Users\\asus\\AppData\\Local\\ms-playwright）。',
      '默认截图 localhost:5173（需 Vite dev server 运行中）。',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '要截图的页面 URL（默认 http://localhost:5173）',
        },
        out: {
          type: 'string',
          description: '输出文件路径（默认 ./ui-screenshot.png）',
        },
        wait: { type: 'number', description: '页面加载等待时间 ms（默认 3000）' },
        width: { type: 'number', description: '视口宽度（默认 1280）' },
        height: { type: 'number', description: '视口高度（默认 800）' },
      },
      required: [],
      additionalProperties: false,
    },
    input_examples: [
      {},
      { url: 'https://ai-news-monitor-silk.vercel.app', out: 'screenshots/prod.png', width: 1440 },
    ],
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        output_path: { type: 'string' },
        dimensions: { type: 'string' },
      },
    },
    command: 'npm run ops:screenshot',
    defer_loading: true,
    namespace: 'ops',
    tags: ['前端', '截图'],
  },

  ops_docker_restart: {
    name: 'ops_docker_restart',
    description: [
      '重启 Windows Docker Desktop 引擎。用于 Docker 服务卡死或容器无法启动时。',
      '',
      '何时用：docker start crawl4ai 持续失败；Docker Desktop 托盘图标显示异常；',
      'ops_check 报告容器不可达且简单 start 无效时。',
      '何时不用：容器只是慢（冷启动需要 10-30s 加载模型），先等一等再看。',
      '',
      '限制：重启 Docker 引擎会中断所有正在运行的容器，耗时 1-3 分钟。',
      '只有 Windows 环境可用（PowerShell 脚本）。重启后容器需要重新 start。',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    input_examples: [{}],
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
      },
    },
    command: 'npm run ops:docker-restart',
    defer_loading: true,
    namespace: 'ops',
    tags: ['运维', 'Docker'],
  },

  test_scrape: {
    name: 'test_scrape',
    description: [
      '快速测试单个信源的抓取效果。用于新增信源或排查抓取失败时验证。',
      '',
      '何时用：新增白名单信源后验证是否能正常抓取内容；排查特定信源抓取失败原因。',
      '何时不用：常规管线运行不需要（管线自动逐个信源抓取）。',
      '',
      '限制：只测试抓取通道，不跑完整 AI 评分和入库管线。',
      '需要 crawl4ai 容器在线。',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要测试的信源 URL' },
        source_name: { type: 'string', description: '信源名称（用于日志标识）' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    input_examples: [
      { url: 'https://www.manutd.com/en/news', source_name: 'Man Utd Official' },
      { url: 'https://www.skysports.com/manchester-united', source_name: 'Sky Sports' },
    ],
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        items_found: { type: 'number' },
        channel: { type: 'string', enum: ['crawl4ai', 'scraper-direct'], description: '实际使用的抓取通道' },
        sample: { type: 'array', items: { type: 'object' }, description: '前几条抓取结果' },
      },
    },
    command: 'node scripts/test-scrape.js',
    defer_loading: true,
    namespace: 'test',
    tags: ['测试', '调试'],
  },

  seed_demo: {
    name: 'seed_demo',
    description: [
      '用演示数据填充 Supabase，覆盖关键词、信源配置、示例文章等。',
      '用于快速搭建开发/演示环境。',
      '',
      '何时用：首次搭建本地开发环境；重置演示数据。',
      '何时不用：生产环境不要用——演示数据会污染真实数据库内容。',
      '',
      '⚠️ 注意：会先清空现有数据再插入。仅在开发环境使用。',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    input_examples: [{}],
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        keywords: { type: 'number' },
        sources: { type: 'number' },
        articles: { type: 'number' },
      },
    },
    command: 'node scripts/seed-demo.js',
    defer_loading: true,
    namespace: 'data',
    tags: ['数据', '开发'],
  },

  update_sources: {
    name: 'update_sources',
    description: [
      '更新 Supabase 中关键词的信源配置（keyword_sources 表）。',
      '支持新增/替换信源 URL、tier 等级、fetch_type（crawl4ai/firecrawl）。',
      '',
      '何时用：新增信源后同步到数据库；调整信源优先级或抓取方式。',
      '何时不用：只改本地测试不需同步数据库时。',
      '',
      '⚠️ 注意：会先删除旧信源再插入新配置。确保数据备份。',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description: '关键词标识（如 manchester-united、anthropic、dallas-mavericks）',
        },
      },
      required: ['keyword'],
      additionalProperties: false,
    },
    input_examples: [
      { keyword: 'manchester-united' },
    ],
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        deleted: { type: 'number' },
        inserted: { type: 'number' },
      },
    },
    command: 'node scripts/update-sources.js',
    defer_loading: true,
    namespace: 'data',
    tags: ['数据', '配置'],
  },

  // ── Harness 工具（AI 通过结构化输出理解诊断结果）─────────────────
  //
  // harness 四件套本身是 hooks（自动触发），但它们产出的信息需要被 AI 理解。
  // 这些工具不执行新命令，而是读取 harness 的输出/日志。

  harness_diagnose: {
    name: 'harness_diagnose',
    description: [
      '读取最近一次 harness 检查的完整诊断结果（check/pretooluse/precommit/stop 的汇总）。',
      '从 stdout/stderr 和日志中提取结构化诊断信息：哪些检查通过/失败、具体错误位置、',
      '建议的修复方案。',
      '',
      '何时用：AI 操作被 harness 拦截后了解原因；代码改动后 harness 报了 fail；',
      '提交被 precommit 阻止时排查。',
      '何时不用：没有 harness 报错时不需调用。',
      '',
      '限制：harness 当前产出是文本格式，本工具做最佳-effort 解析。',
      '随着 harne…化升级，解析准确率会提高。',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        harness_type: {
          type: 'string',
          enum: ['pretooluse', 'posttooluse', 'precommit', 'stop', 'all'],
          description: '要诊断的 harness 类型。all=汇总所有（默认）',
        },
        file_path: {
          type: 'string',
          description: '最近一次被检查的文件路径（可选，用于 posttooluse 诊断）',
        },
      },
      required: [],
      additionalProperties: false,
    },
    input_examples: [
      {},
      { harness_type: 'precommit' },
      { harness_type: 'posttooluse', file_path: 'src/ai.js' },
    ],
    return_schema: {
      type: 'object',
      properties: {
        issues: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              harness: { type: 'string' },
              severity: { type: 'string', enum: ['error', 'warning', 'info'] },
              message: { type: 'string' },
              suggestion: { type: 'string', description: '建议的修复方案' },
            },
          },
        },
        summary: { type: 'string' },
      },
    },
    command: null, // 纯信息汇总，不执行命令
    defer_loading: true,
    namespace: 'harness',
    tags: ['诊断', 'harness'],
  },
};

// ============================================================================
// 查询与导出
// ============================================================================

/**
 * 获取始终加载的核心工具（defer_loading=false）。
 * 按 Anthropic 推荐，保持 ≤5 个高频工具在上下文中。
 * @returns {Array} 核心工具定义数组
 */
function getCoreTools() {
  return Object.values(REGISTRY).filter(t => !t.defer_loading);
}

/**
 * 获取按需加载的工具（defer_loading=true）。
 * @returns {Array} 按需工具定义数组
 */
function getDeferredTools() {
  return Object.values(REGISTRY).filter(t => t.defer_loading);
}

/**
 * 按命名空间筛选工具。
 * @param {string} ns - 命名空间前缀（check/commit/pipeline/ops/data/harness/test）
 * @returns {Array} 匹配的工具
 */
function getToolsByNamespace(ns) {
  return Object.values(REGISTRY).filter(t => t.namespace === ns);
}

/**
 * 按标签搜索工具。
 * @param {string} tag - 标签（如 '高频'、'运维'、'Git'）
 * @returns {Array} 匹配的工具
 */
function getToolsByTag(tag) {
  return Object.values(REGISTRY).filter(t => t.tags && t.tags.includes(tag));
}

/**
 * 获取所有工具的索引摘要（用于 Tool Search Tool 语义匹配）。
 * 只返回 name + description 首句，避免工具定义本身占满上下文。
 * @returns {Array<{name:string, summary:string, namespace:string}>}
 */
function getToolIndex() {
  return Object.values(REGISTRY).map(t => ({
    name: t.name,
    summary: t.description.split('\n')[0],
    namespace: t.namespace,
    defer_loading: t.defer_loading,
  }));
}

/**
 * 获取完整工具定义（含 schema、examples、return_schema）。
 * @param {string} name - 工具名
 * @returns {Object|null} 完整工具定义，不存在返回 null
 */
function getTool(name) {
  return REGISTRY[name] || null;
}

/**
 * 获取工具数量统计。
 * @returns {{total:number, core:number, deferred:number, byNamespace:Object}}
 */
function getStats() {
  const byNs = {};
  for (const t of Object.values(REGISTRY)) {
    byNs[t.namespace] = (byNs[t.namespace] || 0) + 1;
  }
  return {
    total: Object.keys(REGISTRY).length,
    core: getCoreTools().length,
    deferred: getDeferredTools().length,
    byNamespace: byNs,
  };
}

// 模块守卫：直接运行此文件时输出统计信息
if (require.main === module) {
  const stats = getStats();
  console.log('\n=== tools/registry.js — 工具注册表统计 ===\n');
  console.log(`总工具数: ${stats.total}`);
  console.log(`始终加载: ${stats.core} | 按需加载: ${stats.deferred}`);
  console.log('\n按命名空间分布:');
  for (const [ns, count] of Object.entries(stats.byNamespace)) {
    const names = Object.values(REGISTRY)
      .filter(t => t.namespace === ns)
      .map(t => `  ${t.defer_loading ? '⏳' : '📌'} ${t.name}`)
      .join('\n');
    console.log(`  ${ns} (${count}):`);
    console.log(names);
  }
  console.log('\n✅ 注册表加载完成\n');
}

module.exports = { REGISTRY, getCoreTools, getDeferredTools, getToolsByNamespace, getToolsByTag, getToolIndex, getTool, getStats };
