#!/bin/bash
# 测试钩子脚本

echo "=== 测试 block-dangerous-commands.js ==="

echo "--- 测试1: 安全命令 (应放行) ---"
echo '{"tool_name":"Bash","tool_input":{"command":"ls -la"},"session_id":"test","cwd":"/test"}' | bun /Users/zhangwm/Python/TEST/20260531-hooks/.claude/hooks/block-dangerous-commands.js
echo ""

echo "--- 测试2: rm -rf ~ (应拦截) ---"
echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf ~"},"session_id":"test","cwd":"/test"}' | bun /Users/zhangwm/Python/TEST/20260531-hooks/.claude/hooks/block-dangerous-commands.js
echo ""

echo "--- 测试3: git push --force (应拦截) ---"
echo '{"tool_name":"Bash","tool_input":{"command":"git push --force origin main"},"session_id":"test","cwd":"/test"}' | bun /Users/zhangwm/Python/TEST/20260531-hooks/.claude/hooks/block-dangerous-commands.js
echo ""

echo "=== 测试 protect-secrets.js ==="

echo "--- 测试4: 读取普通文件 (应放行) ---"
echo '{"tool_name":"Read","tool_input":{"file_path":"/home/user/README.md"},"session_id":"test","cwd":"/test"}' | bun /Users/zhangwm/Python/TEST/20260531-hooks/.claude/hooks/protect-secrets.js
echo ""

echo "--- 测试5: 读取 .env 文件 (应拦截) ---"
echo '{"tool_name":"Read","tool_input":{"file_path":"/home/user/.env"},"session_id":"test","cwd":"/test"}' | bun /Users/zhangwm/Python/TEST/20260531-hooks/.claude/hooks/protect-secrets.js
echo ""

echo "--- 测试6: 读取 SSH 密钥 (应拦截) ---"
echo '{"tool_name":"Read","tool_input":{"file_path":"/home/user/.ssh/id_rsa"},"session_id":"test","cwd":"/test"}' | bun /Users/zhangwm/Python/TEST/20260531-hooks/.claude/hooks/protect-secrets.js
echo ""

echo "=== 测试完成 ==="
