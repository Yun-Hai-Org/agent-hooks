import { describe, it, expect } from 'bun:test';
import { scanDiffForFindings } from '../checks/code-review.js';

describe('scanDiffForFindings', () => {
  it('独立 debugger 语句行应计入 deny', () => {
    const diff = ['+++ b/a.ts', '+    debugger;', ' context'].join('\n');
    const { deny, warn } = scanDiffForFindings(diff);
    expect(deny.length).toBe(1);
    expect(warn.length).toBe(0);
  });

  it('含 debugger 字样的标识符/字符串不应误判为 deny', () => {
    const diff = ["+  { id: 'debugger', regex: /^\\+\\s*debugger/ }"].join('\n');
    const { deny } = scanDiffForFindings(diff);
    expect(deny.length).toBe(0);
  });

  it('console.log 应计入 warn 而非 deny', () => {
    const diff = ['+++ b/src/app.ts', "+  console.log('hello');"].join('\n');
    const { deny, warn } = scanDiffForFindings(diff);
    expect(deny.length).toBe(0);
    expect(warn.length).toBe(1);
  });

  it('hook 文件中的 console.log 不告警', () => {
    const diff = ['+++ b/.claude/hooks/auto-stage.ts', "+      console.log('{}');"].join('\n');
    const { warn } = scanDiffForFindings(diff);
    expect(warn.length).toBe(0);
  });

  it('TODO/FIXME 应计入 warn', () => {
    const diff = ['+// TODO: refactor later', '+// FIXME bug'].join('\n');
    const { warn } = scanDiffForFindings(diff);
    expect(warn.length).toBe(2);
  });

  it('删除行（-）与文件头（+++）不参与扫描', () => {
    const diff = ['+++ b/x.ts', '-    debugger;', ' unchanged'].join('\n');
    const { deny, warn } = scanDiffForFindings(diff);
    expect(deny.length).toBe(0);
    expect(warn.length).toBe(0);
  });

  it('干净 diff 无 findings', () => {
    const diff = ['+const x = 1;', '+export const y = 2;'].join('\n');
    const { deny, warn } = scanDiffForFindings(diff);
    expect(deny.length).toBe(0);
    expect(warn.length).toBe(0);
  });
});
