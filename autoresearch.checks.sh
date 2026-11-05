#!/bin/bash
# 正确性回压：类型检查 + 项目测试套件。只放错误，成功时静默。
set -euo pipefail
npx tsc --noEmit 2>&1 | grep -E "error TS" | head -30 || true
if npx tsc --noEmit 2>&1 | grep -q "error TS"; then
  echo "TYPECHECK FAILED"
  exit 1
fi
node --test "tests/*.test.ts" 2>&1 | grep -E "^not ok|^# (fail|pass)|✖" | head -40 || true
if ! node --test "tests/*.test.ts" >/tmp/ar-test.log 2>&1; then
  tail -40 /tmp/ar-test.log
  exit 1
fi
