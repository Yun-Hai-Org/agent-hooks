import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'child_process';
import { join } from 'path';

const script = join(import.meta.dir, '..', '..', '..', 'scripts', 'cursor-yingmi-hooks', 'prohibited-content-pretool-guard.sh');

function runGuard(payload: unknown) {
  return spawnSync('bash', [script], {
    input: JSON.stringify(payload),
    encoding: 'utf-8',
  });
}

describe('prohibited-content-pretool-guard', () => {
  it('Cursor path 字段的普通写入应 allow 且退出码 0', () => {
    const result = runGuard({
      tool_name: 'Write',
      tool_input: { path: '/tmp/note.md', contents: '普通中文内容' },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"permission":"allow"');
  });

  it('意外错误应把行号打到 stderr 并以 allow 退出', () => {
    const result = spawnSync(
      'bash',
      [
        '-c',
        `set -eEuo pipefail
         on_unexpected_error() {
           local line="$1"
           local cmd="$2"
           local status="$3"
           trap - ERR
           printf 'prohibited-content-pretool-guard: line %s: %s (exit %s)\\n' "$line" "$cmd" "$status" >&2
           printf '%s\\n' '{"permission":"allow"}'
           exit 0
         }
         trap 'on_unexpected_error "$LINENO" "$BASH_COMMAND" "$?"' ERR
         false
        `,
      ],
      { encoding: 'utf-8' },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"permission":"allow"');
    expect(result.stderr).toContain('prohibited-content-pretool-guard: line');
    expect(result.stderr).toContain('false');
  });
});
