# Story 1.3 Code Review Final Report

## Summary

- **Reviewer**: BMAD CR Agent
- **Target**: Story 1.3 dangerous-bash-commands
- **Commit**: 1a92b02
- **Date**: 2026-06-13
- **Verdict**: REQUEST CHANGES

## Acceptance Criteria Validation

| AC  | Description                                                                                     | Status        | Notes                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------- | ----------------------- |
| 1   | kubectl get secret / terraform output / openssl rsa -in / base64 -d pipe / docker exec env 拦截 | PASS          | All 5 info-leak patterns functional.                                                                                                                                 |
| 2   | `> /dev/sda`, `> /dev/nvme0n1` 拦截                                                             | PARTIAL       | Basic `> /dev/sda` works, but `N>/dev/sda`, `N>>/dev/sda` variants NOT matched despite being listed in Dev Notes.                                                    |
| 3   | `find / -delete`, `find /var -delete`, `find /etc -type f -delete` 拦截                         | PASS          | Pattern covers root prefix + wildcard system dir.                                                                                                                    |
| 4   | `mv / /tmp/`, `mv /some/path /dev/null` 拦截                                                    | PARTIAL       | AC targets blocked, but pattern also blocks legitimate `mv file.txt /tmp/` — massive false positive.                                                                 |
| 5   | fork bomb variant `:(){ :                                                                       | : : };:` 拦截 | PASS                                                                                                                                                                 | Both `:(){ : | :& };:`and`:(){ :                                          | : : };:` blocked.       |
| 6   | `chmod -R 777 /`, `chmod 777 /etc` 拦截                                                         | PASS          | All chmod 777 blocked (by existing `chmod-777` HIGH pattern). New `chmod-777-root` CRITICAL pattern is dead code — never reached due to array ordering.              |
| 7   | `wget                                                                                           | sh`, `curl    | sudo bash` 拦截                                                                                                                                                      | PASS         | Already covered by existing `curl-pipe-sh` pattern (`(curl | wget).+\|\s\*(ba)?sh`). |
| 8   | 10+ patterns, each with >=1 positive + >=1 negative test                                        | FAIL          | All 10 patterns have 1 positive test each but ZERO negative/reverse tests. AC explicitly requires both.                                                              |
| 9   | 现有测试无回归                                                                                  | PASS          | All 50 tests pass (33 pre-existing + 17 new).                                                                                                                        |
| 10  | 正常命令不被误拦截                                                                              | PASS          | `echo hello`, `ls -la`, `grep pattern file.txt` all pass. However `mv file.txt /tmp/` is a false positive (not in AC#10's list but causes real workflow disruption). |

## Findings

### MAJOR (2)

1. **`mv-root` pattern has excessive false positives**  
   Regex `/\bmv\b.+\s+\/(dev\/null|tmp\/)\s*$/` matches ANY `mv <something> /tmp/` including legitimate commands like `mv file.txt /tmp/`, `mv build.log /tmp/`, `mv x /tmp/`. The Dev Notes explicitly warned: "mv-root 模式需要特别小心，避免误拦截合法命令如 `mv file /tmp/`" — but the implementation went directly against this guidance.  
   **Impact**: Every legitimate `mv file /tmp/` in user workflow gets CRITICAL-level blocked.

2. **`redir-disk` missing common shell redirect variants**  
   Regex `/(?:^|\s)[>]\s*\/dev\/(sd|nvme|hd|vd|xvd)/` only matches bare `>`. It does NOT match `1>/dev/sda`, `2>/dev/sda`, `>>/dev/sda`, or `1>>/dev/sda` — all common shell redirect forms.  
   **Impact**: A user writing `echo 1 >foo.txt 2>/dev/sda` bypasses the check.

### MINOR (2)

3. **`chmod-777-root` pattern is dead code**  
   Pattern 14 `chmod-777` (HIGH, matching any `\bchmod\b.+\b777\b`) appears before Pattern 49 `chmod-777-root` (CRITICAL) in the array. Since `checkCommand()` iterates in array order and returns on first match, `chmod-777-root` never fires. All `chmod 777 /etc` cases return HIGH severity instead of CRITICAL.  
   **Fix**: Move `chmod-777-root` before `chmod-777` in the PATTERNS array, or merge the root-path check into a single pattern.

4. **Abbreviated pattern IDs reduce clarity**  
   Story specified descriptive IDs (`kubectl-get-secret`, `terraform-output`, `openssl-rsa-decrypt`, etc.) but implementation uses abbreviated forms (`kubectl-gs`, `tf-out`, `ossl-dec`, `b64-dec`, `dkr-exec-env`, `redir-disk`, `find-del-root`, `fb-v2`). While functional, these are harder to read in logs and error messages.

### NIT (1)

5. **Missing negative tests for all 10 new patterns** (AC#8 explicit requirement)  
   The story requires "每个新增模式至少有 1 个正向测试（应拦截）和 1 个负向测试（不应误拦截）". The test suite has 0 negative tests for the new S1.3 patterns. Needed negative test cases:
   - `kubectl get pods` / `kubectl describe pod`
   - `terraform plan` / `terraform apply`
   - `openssl version` / `openssl enc -d`
   - `echo x | base64` (no -d flag)
   - `docker exec mycontainer ls`
   - `echo data > /dev/null` (null device, not disk)
   - `find . -delete` (current directory)
   - `mv file.txt /tmp/test` (legitimate non-root move)
   - `echo hello` (simple command)
   - `chmod 755 /etc` (not 777)

## Test Results

- **Tests run**: 50
- **Passed**: 50 (100%)
- **Failed**: 0
- **New S1.3 tests**: 10 positive only (0 negative)
- **Regression**: None detected

## Decision

**REQUEST CHANGES** — Two MAJOR findings (mv-root false positives, redir-disk variant misses) and one AC failure (AC#8: zero negative tests) require remediation before this can be approved.

### Required fixes

1. Fix `mv-root` regex to only match when the source path IS a root/system path, not any path:  
   Suggestion: `/\bmv\b\s+\/(\s|\w).*\s+\/(dev\/null)\s*$/` — or use a more targeted approach that checks if the source starts with `/`.
2. Fix `redir-disk` regex to match `N>`, `>>`, `N>>` variants:  
   Suggestion: `/(?:^|\s)(\d*>>?)\s*\/dev\/(sd|nvme|hd|vd|xvd)/`
3. Add negative tests for all 10 new patterns (at minimum 1 per pattern).
4. Reorder `chmod-777-root` before `chmod-777` if CRITICAL severity for root paths is desired.
