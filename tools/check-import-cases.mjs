import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const directory = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'tests/fixtures/import-cases');
const result = spawnSync(process.execPath, [resolve(root, 'node_modules/vitest/vitest.mjs'), 'run', 'tests/import-case-acceptance.test.ts'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, IMPORT_CASE_DIR: directory },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
