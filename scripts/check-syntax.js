// 后端语法检查（`npm run lint:backend`）：对 src/ 与 scripts/ 下所有 .js 逐个执行 node --check。
// 说明：Windows cmd 下 npm script 不做 shell 通配符展开，`node --check src/*.js` 只会把字面量
// 当单参数传入导致报错；这里用 fs 枚举文件逐个检查（共享核心 scripts/lib/check-js.js）。
// 注意：仅枚举 src/ scripts/ 顶层 .js；子目录（src/tools/、scripts/lib/、scripts/_archive/）不递归
// ——与 2026-08-13 重构前行为一致（lib/ 内的模块由调用方 require 时自然解析）。
const { checkAllDirs } = require('./lib/check-js');

const DIRS = ['src', 'scripts'];
const result = checkAllDirs(DIRS);

if (!result.ok) {
  console.error(`\n❌ ${result.failed}/${result.total} 个文件语法检查失败`);
  process.exit(1);
}
console.log(`\n✅ 语法检查通过（${result.total} 个文件）`);
