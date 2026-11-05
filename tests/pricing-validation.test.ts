import {describe, expect, it} from 'vitest';
import {d, toStorage, type Numeric} from '../src/domain/decimal';
import type {CostItem} from '../src/domain/cost-item';
import {computeGrossAmount, type PricingContext} from '../src/engine/pricing';
import {EngineError} from '../src/engine/errors';
import {sampleProjectFile} from '../src/data/sample-project';
import {toTrade, toScenario} from '../src/data/project-file';
import {scenarioWithDerivedInclusions} from '../src/engine/compare';
import {analyze} from '../src/engine/analyze';
import {makeCostItem} from './helpers/factory';

const context: PricingContext = {resolveBase: () => '100', resolveDays: () => '3'};
const invalid: Numeric[] = ['-e', 'abc', 'NaN', 'Infinity', Number.NEGATIVE_INFINITY];
const cases: {name: string; field: string; make: (value: Numeric) => Partial<CostItem>; ctx?: (value: Numeric) => PricingContext}[] = [
  {name: 'fixed amount', field: 'amount', make: amount => ({pricing_method: 'FIXED', amount})},
  {name: 'actual amount', field: 'amount', make: amount => ({pricing_method: 'ACTUAL', amount})},
  {name: 'unit quantity', field: 'quantity', make: quantity => ({pricing_method: 'QTY_X_UNIT', quantity, rate: '2'})},
  {name: 'unit rate', field: 'rate', make: rate => ({pricing_method: 'QTY_X_UNIT', quantity: '2', rate})},
  {name: 'percent rate', field: 'rate', make: rate => ({pricing_method: 'PERCENT', rate, calculation_base: {kind: 'GOODS_VALUE'}})},
  {name: 'resolved percent base', field: 'calculation_base', make: () => ({pricing_method: 'PERCENT', rate: '0.05', calculation_base: {kind: 'GOODS_VALUE'}}), ctx: value => ({resolveBase: () => value})},
  {name: 'day rate', field: 'rate', make: rate => ({pricing_method: 'PER_DAY', days: '3', rate})},
  {name: 'explicit days', field: 'days', make: days => ({pricing_method: 'PER_DAY', days, rate: '2'})},
  {name: 'resolved days', field: 'days', make: () => ({pricing_method: 'PER_DAY', rate: '2'}), ctx: value => ({...context, resolveDays: () => value})},
  {name: 'tier quantity', field: 'quantity', make: quantity => ({pricing_method: 'TIERED', quantity, tiers: [{up_to: null, rate: '2'}]})},
  {name: 'tier days', field: 'days', make: days => ({pricing_method: 'TIERED', tier_basis: 'DAYS', days, tiers: [{up_to: null, rate: '2'}]})},
  {name: 'tier rate', field: 'rate', make: rate => ({pricing_method: 'TIERED', quantity: '2', tiers: [{up_to: null, rate}]})},
  {name: 'tier upper bound before sorting', field: 'up_to', make: up_to => ({pricing_method: 'TIERED', quantity: '2', tiers: [{up_to, rate: '1'}, {up_to: '10', rate: '2'}]})},
];

describe('invalid cost numbers remain actionable input errors', () => {
  for (const row of cases) {
    it.each(invalid)(row.name + ' rejects %s without guessing zero', value => {
      const item = makeCostItem({cost_id: 'invalid-input', ...row.make(value)});
      const before = structuredClone(item);
      let failure: unknown;
      try {computeGrossAmount(item, row.ctx?.(value) ?? context);} catch (error) {failure = error;}
      expect(failure).toBeInstanceOf(EngineError);
      expect(failure).toMatchObject({code: 'PRICING_INPUT_INVALID', detail: {cost_id: item.cost_id, field: row.field}});
      expect(item).toEqual(before);
    });
  }
  it.each(['goods', 'freight', 'insurance'])('analyze exposes the original %s field error', costId => {
    const project = sampleProjectFile();
    project.items.find(item => item.cost_id === costId)!.amount = '-e';
    const trade = toTrade(project), scenario = scenarioWithDerivedInclusions(toScenario(project), trade);
    expect(() => analyze({trade, scenario, taxProfile: project.tax_profile, fxBooks: project.fx_books})).toThrowError(EngineError);
    try {analyze({trade, scenario, taxProfile: project.tax_profile, fxBooks: project.fx_books});} catch (error) {
      expect(error).toMatchObject({code: 'PRICING_INPUT_INVALID', detail: {cost_id: costId, field: 'amount'}});
    }
    expect(project.items.find(item => item.cost_id === costId)!.amount).toBe('-e');
  });
  it.each<Numeric>(['0', '-12.5', '1e2', '0.0000004', 12.5, d('2.25')])('keeps the existing finite value %s', value => {
    const item = makeCostItem({cost_id: 'valid-input', pricing_method: 'FIXED', amount: value});
    expect(toStorage(computeGrossAmount(item, context))).toBe(toStorage(d(value)));
  });
  it.each(['', ' ', undefined, null])('keeps the missing-input distinction for %s', value => {
    const item = makeCostItem({cost_id: 'missing-input', pricing_method: 'FIXED', amount: value as Numeric});
    expect(() => computeGrossAmount(item, context)).toThrowError(EngineError);
    try {computeGrossAmount(item, context);} catch (error) {expect(error).toMatchObject({code: 'PRICING_INPUT_MISSING'});}
  });
  it('does not hide unexpected errors from a base resolver', () => {
    const error = Error('Unexpected resolver failure');
    const item = makeCostItem({cost_id: 'resolver-input', pricing_method: 'PERCENT', rate: '0.05', calculation_base: {kind: 'GOODS_VALUE'}});
    expect(() => computeGrossAmount(item, {resolveBase: () => {throw error;}})).toThrow(error);
  });
});
