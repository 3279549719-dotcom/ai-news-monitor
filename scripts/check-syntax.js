// 后端语法检查（`npm run lint:backend`）：对 src/ 与 scripts/ 下所有 .js 逐个执行 node --check。
// 说明：Windows cmd 下 npm script 不做 shell 通配符展开，`node --check src/*.js` 只会把字面量
// 当单参数传入导致报错；这里用 fs 枚举文件逐个检查，跨平台可靠。
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIRS = ['src', 'scripts'];
const files = [];
for (const dir of DIRS) {
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith('.js')) files.push(path.join(dir, name));
  }
}

let failed = 0;
for (const file of files) {
  try {
    execSync(`node --check "${file}"`, { stdio: 'inherit' });
    console.log(`  ok ${file}`);
  } catch {
    failed++;
  }
}

if (failed) {
  console.error(`\n❌ ${failed}/${files.length} 个文件语法检查失败`);
  process.exit(1);
}
console.log(`\n✅ 语法检查通过（${files.length} 个文件）`);
