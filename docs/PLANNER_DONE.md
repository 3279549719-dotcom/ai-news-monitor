# PLANNER_DONE — 管线搬 GitHub

> 状态: PLANNER 完成 ｜ 日期: 2026-08-11 ｜ 产出: [PLAN](PLAN-管线搬GitHub.md) + [SPRINT](SPRINT-20260811-github-pipeline.md)
> 交接方: Planner（主会话）→ 接收方: Generator（subagent）

Generator 请按 [PLAN-管线搬GitHub.md](PLAN-管线搬GitHub.md) 执行；"完成"定义见 [SPRINT-20260811-github-pipeline.md](SPRINT-20260811-github-pipeline.md) §1.2。

## 验收命令（交付前必须全绿，输出贴进 GENERATOR_DONE.md）

- `node --check scripts/run-pipeline.js`
- `node --test scripts/run-pipeline.test.js -v`（5 PASS）
- `npm test`（≥118/118，基线 113 不得减少）
- `npm run check`（全绿）
- `npx --yes actionlint .github/workflows/daily-pipeline.yml .github/workflows/crawl4ai-smoke.yml`

## 工作区

- 目录: `.worktrees/experiment-gha`（分支 `feat/experiment-gha-pipeline`，HEAD = 2dc6130）
- 只改 PLAN §二 列出的 5 个文件，不顺手重构
- 提交走 `npm run commit -- "feat(generator): <msg>"`（只 `git add` 本次文件，不用 `-a`）
- 不回显 .env / secret 值

## 已知风险（PLAN §八）

1. `unclecode/crawl4ai:latest` 在 runner 独立启动未验证 → 已备 `crawl4ai-smoke.yml`，Phase 4 先冒烟
2. `--ci` 分支不得影响本地无参路径 → 有单测兜底

## 交付物

- 代码: `scripts/run-pipeline.js`（--ci）、`scripts/run-pipeline.test.js`、`package.json`
- 工作流: `.github/workflows/daily-pipeline.yml`、`.github/workflows/crawl4ai-smoke.yml`
- 交接信号: `docs/GENERATOR_DONE.md`（含全部验收命令真实输出 + 改动清单 + 待实机验证项）
