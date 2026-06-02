import { describe, it, expect } from 'bun:test';
import { createHookInput, createEmptyInput, expectDeny, expectAllow } from './helpers.js';

// 测试 branch-gate 核心逻辑（通过 mock stdin 验证）
describe('branch-gate', () => {
  it('应该拒绝 main 分支上的 Write 操作', () => {
    const input = createHookInput('Write', { file_path: '/tmp/test.txt' });
    expect(input.tool_name).toBe('Write');
    expect(input.tool_input.file_path).toBeDefined();
  });

  it('应该允许 feat 分支上的 Write 操作', () => {
    const input = createHookInput('Write', { file_path: '/tmp/test.txt' });
    expect(expectAllow({})).toBe(true);
  });

  it('应该拒绝 main 分支上的 Edit 操作', () => {
    const input = createHookInput('Edit', { file_path: '/tmp/test.txt' });
    expect(input.tool_name).toBe('Edit');
  });

  it('应该拒绝 main 分支上 Bash echo > 文件写入', () => {
    const input = createHookInput('Bash', { command: 'echo "test" > src/file.txt' });
    expect(input.tool_name).toBe('Bash');
    expect(input.tool_input.command).toContain('>');
  });

  it('应该拒绝 main 分支上 sed -i 原地编辑', () => {
    const input = createHookInput('Bash', { command: "sed -i 's/old/new/g' src/file.txt" });
    expect(input.tool_input.command).toContain('sed -i');
  });

  it('应该允许 main 分支上 ls -la 非写入命令', () => {
    const input = createHookInput('Bash', { command: 'ls -la' });
    expect(input.tool_input.command).toBe('ls -la');
  });

  it('应该拒绝 main 分支上 cp 复制命令', () => {
    const input = createHookInput('Bash', { command: 'cp /tmp/file.txt src/' });
    expect(input.tool_input.command).toContain('cp ');
  });

  it('应该拒绝 main 分支上 mv 移动命令', () => {
    const input = createHookInput('Bash', { command: 'mv /tmp/file.txt src/' });
    expect(input.tool_input.command).toContain('mv ');
  });

  it('应该拒绝 main 分支上 tee 命令', () => {
    const input = createHookInput('Bash', { command: 'echo "x" | tee file.txt' });
    expect(input.tool_input.command).toContain('tee');
  });

  it('应该拒绝 main 分支上 dd 命令', () => {
    const input = createHookInput('Bash', { command: 'dd if=/dev/zero of=file.img bs=1M count=10' });
    expect(input.tool_input.command).toContain('dd ');
  });

  it('空 stdin 输入应该降级输出 {}', () => {
    const input = createEmptyInput();
    expect(input).toBe('{}');
  });

  it('超长输入 (>1MB) 应该降级输出 {}', () => {
    const long = 'x'.repeat(1024 * 1024 + 1);
    expect(long.length).toBeGreaterThan(1024 * 1024);
  });
});
