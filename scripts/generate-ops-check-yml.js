#!/usr/bin/env node
/**
 * generate-ops-check-yml.js
 *
 * Generates .github/workflows/ops-check.yml using String.fromCharCode(36)
 * to avoid Windows/PowerShell dollar-brace corruption of ${{ }} syntax.
 *
 * Usage: node scripts/generate-ops-check-yml.js
 */

const fs = require('fs');
const path = require('path');

const D = String.fromCharCode(36); // '$'

const yml = [
  'name: Ops Check',
  '',
  'on:',
  '  schedule:',
  "    - cron: '0 8,16 * * *'",
  '  workflow_dispatch:',
  '',
  'permissions:',
  '  issues: write',
  '',
  'jobs:',
  '  ops-check:',
  '    runs-on: ubuntu-latest',
  '    timeout-minutes: 5',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '        with:',
  '          fetch-depth: 0',
  '      - uses: actions/setup-node@v4',
  '        with:',
  "          node-version: '22'",
  "          cache: 'npm'",
  '      - run: npm ci',
  '      - name: Pull latest logs',
  '        run: |',
  '          git pull origin master --rebase || echo "no new logs to pull"',
  '      - name: Run ops check',
  '        run: node scripts/ops-check.js --actions',
  '        env:',
  `          SUPABASE_URL: ${D}{{ secrets.SUPABASE_URL }}`,
  `          SUPABASE_SERVICE_KEY: ${D}{{ secrets.SUPABASE_SERVICE_KEY }}`,
  '      - name: Upload result',
  '        if: always()',
  '        uses: actions/upload-artifact@v4',
  '        with:',
  '          name: ops-check-result',
  '          path: logs/.ops-check.json',
  '          retention-days: 7',
  '',
  '  alert-on-failure:',
  '    needs: ops-check',
  '    if: failure()',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '      - name: Create issue on failure',
  '        run: |',
  "          cat > /tmp/issue_body.md << 'BODYEOF'",
  '## Ops Check Failed',
  `Run: ${D}{{ github.server_url }}/${D}{{ github.repository }}/actions/runs/${D}{{ github.run_id }}`,
  '',
  '@copilot Please analyze the ops-check failure. Read the ops-check-result artifact, locate all failed checks, analyze root causes, and post your diagnosis as a comment.',
  'BODYEOF',
  '          gh issue create \\',
  `            --title "Ops Check Failed — Run ${D}{{ github.run_id }}" \\`,
  '            --body-file /tmp/issue_body.md \\',
  '            --label "ops,ai-diagnose" \\',
  `            --repo ${D}{{ github.repository }}`,
  '        env:',
  `          GH_TOKEN: ${D}{{ github.token }}`,
  '',
].join('\n') + '\n';

const targetPath = path.resolve(__dirname, '..', '.github', 'workflows', 'ops-check.yml');

fs.writeFileSync(targetPath, yml, 'utf-8');

// Verify
const written = fs.readFileSync(targetPath, 'utf-8');
const count = (written.match(/\$\{\{/g) || []).length;

console.log(`Wrote ${targetPath}`);
console.log(D + '{{ count: ' + count + ' (expected 8)');
console.log(count === 8 ? '\u2713 PASS' : '\u2717 FAIL');

if (count !== 8) {
  process.exit(1);
}
