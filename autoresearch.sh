#!/bin/bash
# PRD 一致性基准：输出 METRIC prd_pass=<通过条数>
set -euo pipefail
node scripts/prd-conformance.mjs
