import { describe, it, expect } from 'bun:test';
import { isExecErrorLike, stringifyUnknown, asString } from '../types.js';

describe('types helpers', () => {
  it('isExecErrorLike 识别对象', () => {
    expect(isExecErrorLike({ stdout: 'a' })).toBe(true);
    expect(isExecErrorLike(null)).toBe(false);
    expect(isExecErrorLike('x')).toBe(false);
  });

  it('stringifyUnknown 处理 Error/字符串/其他', () => {
    expect(stringifyUnknown(new Error('boom'))).toBe('boom');
    expect(stringifyUnknown('plain')).toBe('plain');
    expect(stringifyUnknown({ a: 1 })).toBe('{"a":1}');
  });

  it('asString 转换', () => {
    expect(asString('hi')).toBe('hi');
    expect(asString(42)).toBe('');
    expect(asString(undefined)).toBe('');
  });
});
