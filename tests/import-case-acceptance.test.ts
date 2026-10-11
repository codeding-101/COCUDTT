import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseProject, toScenario, toTrade } from '../src/data/project-file';
import { d } from '../src/domain/decimal';
import { analyze } from '../src/engine/analyze';
import { scenarioWithDerivedInclusions } from '../src/engine/compare';
import { isIsoDate } from '../src/engine/tax/china-import';

interface ImportCase {
  case_id: string;
  kind: 'SYNTHETIC' | 'ANONYMIZED_REAL';
  project_file: string;
  evidence_index: string;
  reviewer: string;
  reviewed_on: string;
  calculations: string[];
  expected: { dutiable_value: string; duty: string; consumption_tax: string; vat: string; buyer_total: string; buyer_ex_deductible: string };
}

// 可通过IMPORT_CASE_DIR在本机验证脱敏案例，默认只运行标为合成的公式用例。
const directory = resolve(process.env.IMPORT_CASE_DIR ?? fileURLToPath(new URL('./fixtures/import-cases', import.meta.url)));
const manifests = readdirSync(directory).filter(file => file.endsWith('.case.json')).sort();

describe('进口案例逐项对照验收', () => {
  it('案例目录至少包含一个明确标识的对照案例', () => expect(manifests.length).toBeGreaterThan(0));
  for (const file of manifests) {
    it(file, () => {
      const manifestPath = resolve(directory, file);
      const value = JSON.parse(readFileSync(manifestPath, 'utf8')) as ImportCase;
      expect(value.case_id).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(['SYNTHETIC', 'ANONYMIZED_REAL']).toContain(value.kind);
      expect(value.project_file).toMatch(/^[^\\/]+\.json$/);
      expect(value.evidence_index.trim()).not.toBe('');
      expect(value.reviewer.trim()).not.toBe('');
      expect(isIsoDate(value.reviewed_on)).toBe(true);
      expect(Array.isArray(value.calculations)).toBe(true);
      expect(value.calculations.length).toBeGreaterThan(0);
      expect(value.calculations.every(line => typeof line === 'string' && line.trim() !== '')).toBe(true);
      const project = parseProject(readFileSync(resolve(dirname(manifestPath), value.project_file), 'utf8'));
      expect(project.tax_profile.import.calculationMode).toBe('CN_GENERAL_TRADE');
      const trade = toTrade(project);
      const result = analyze({ trade, scenario: scenarioWithDerivedInclusions(toScenario(project), trade), taxProfile: project.tax_profile, fxBooks: project.fx_books });
      const actual = {
        dutiable_value: result.dutiable_value.value, duty: result.import_tax.duty,
        consumption_tax: result.import_tax.consumption_tax, vat: result.import_tax.vat,
        buyer_total: result.buyer.landed_cost_with_tax, buyer_ex_deductible: result.buyer.landed_cost_ex_deductible,
      };
      for (const [key, amount] of Object.entries(actual)) {
        const expected = value.expected[key as keyof ImportCase['expected']];
        expect(expected, `${key}必须是明确到分的人工预期金额`).toMatch(/^\d+\.\d{2}$/);
        expect(amount.equals(d(expected)), `${value.case_id} ${key} 应为${expected}，实际${amount.toString()}`).toBe(true);
      }
      if (value.kind === 'SYNTHETIC') {
        expect(result.decision.ready, '合成案例需保留示例来源状态').toBe(false);
        expect(result.decision.issues.join()).toContain('示例数据');
      } else {
        expect(result.decision.ready, result.decision.issues.join('；')).toBe(true);
      }
    });
  }
});
