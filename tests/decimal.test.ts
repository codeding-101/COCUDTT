import { describe, expect, it } from 'vitest';
import { add, div, mul, q, sum, toDisplay, toStorage } from '../src/domain/decimal';

describe('定点十进制', () => {
  it('中间结果统一舍入到 6 位小数（ROUND_HALF_UP）', () => {
    expect(toStorage(div(1, 3))).toBe('0.333333');
    expect(toStorage(div(2, 3))).toBe('0.666667');
    expect(toStorage(q('0.0000005'))).toBe('0.000001');
    expect(toStorage(q('0.0000004'))).toBe('0.000000');
    expect(toStorage(q('-0.0000005'))).toBe('-0.000001');
  });

  it('不产生浮点误差', () => {
    expect(toStorage(add('0.1', '0.2'))).toBe('0.300000');
    expect(toStorage(sum(['0.1', '0.2', '0.3']))).toBe('0.600000');
    expect(toStorage(mul('19.99', '3'))).toBe('59.970000');
    expect(toStorage(mul('0.008', '100000'))).toBe('800.000000');
  });

  it('展示保留 2 位小数，半值进位', () => {
    expect(toDisplay('7.005')).toBe('7.01');
    expect(toDisplay('758100')).toBe('758100.00');
    expect(toDisplay('0.15', 1)).toBe('0.2');
    expect(toDisplay('0.125', 1)).toBe('0.1');
  });

  it('除以零直接报错，不静默返回特殊值', () => {
    expect(() => div('1', '0')).toThrowError('DivisionByZero');
  });
});
