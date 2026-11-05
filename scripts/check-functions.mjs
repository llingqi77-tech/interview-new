#!/usr/bin/env node
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

// Vercel excludes files/directories beginning with "_" from API discovery.
// This Vite project deploys each remaining .ts/.js API file as one function.
function entrypoints(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (/^[_.]/.test(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entrypoints(path);
    return /\.(?:[cm]?[jt]s|[jt]sx)$/.test(entry.name) ? [path] : [];
  });
}

const functions = entrypoints('api');
// Hobby 的 12 个函数上限是免费档约束；Pro/Enterprise 不设该限制。
// 升级后设 VERCEL_FUNCTION_LIMIT 覆盖默认值，别让门禁继续按免费档顶格卡着。
const limit = Number(process.env.VERCEL_FUNCTION_LIMIT ?? 12);
console.log(`Vercel functions: ${functions.length}/${limit}${process.env.VERCEL_FUNCTION_LIMIT ? '' : ' (Hobby 默认上限)'}`);
if (functions.length > limit) {
  console.error('Consolidate API entrypoints before deploying:\n' + functions.join('\n'));
  process.exitCode = 1;
}
