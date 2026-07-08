import { describe, it, expect } from 'bun:test';
import { execSync } from 'child_process';
import { join } from 'path';
import { PROJECT_ROOT } from './helpers.js';

describe('audit-notify-sync.sh', () => {
  const script = join(PROJECT_ROOT, 'scripts/audit-notify-sync.sh');
  const fixture = join(import.meta.dir, 'fixtures/audit-notify-sync-sample.jsonl');

  it('fixture 应识别未配对 BLOCKED 与 empty_summary 缺口', () => {
    const result = execSync(
      `python3 - <<'PY'
import json, os, shutil, subprocess
from pathlib import Path
home = Path('/tmp/audit-notify-sync-test-home')
log_dir = home / '.claude/hooks-logs'
log_dir.mkdir(parents=True, exist_ok=True)
shutil.copy('${fixture}', log_dir / '2026-07-07.jsonl')
proc = subprocess.run(['bash', '${script}', '--date', '2026-07-07', '--json'], capture_output=True, text=True, env={**os.environ, 'HOME': str(home)})
print(proc.stdout)
print('EXIT', proc.returncode)
PY`,
      { cwd: PROJECT_ROOT, encoding: 'utf-8' },
    );
    const lines = result.trim().split('\n');
    const jsonLine = lines.find((l) => l.startsWith('{'));
    expect(jsonLine).toBeDefined();
    const report = JSON.parse(jsonLine!);
    expect(report.ok).toBe(false);
    expect(report.blocked_gaps.length).toBeGreaterThan(0);
    expect(report.session_end_gaps.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes('EXIT 1'))).toBe(true);
  });
});
