import { describe, expect, it } from 'vitest';

import { parseUiAmount } from '../src/index.js';

describe('parseUiAmount', () => {
  it('converts a decimal UI amount to raw bigint without floating point', () => {
    expect(parseUiAmount('9007199254740993.000001', 6)).toBe(9007199254740993000001n);
  });

  it.each(['', '-1', '1e3', '1.001', '.5'])('rejects invalid amount %j', (amount) => {
    expect(() => parseUiAmount(amount, 2)).toThrowError(/amount/i);
  });
});
