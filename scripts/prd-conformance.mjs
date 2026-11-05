#!/usr/bin/env node
/**
 * PRD 一致性检查运行器。
 *
 * 指标：prd_pass = 通过的检查条数（越高越好），prd_total = 检查总条数。
 * 每条检查对应《面试模拟器 PRD》里一条可验证的需求，检查体是真实行为断言
 * （导入真实模块 / 用 react-dom/server 渲染真实组件），不是字符串 grep。
 *
 * 用法：node scripts/prd-conformance.mjs [--verbose] [--area=setup]
 */
import { registerHooks } from 'node:module';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = process.cwd();

function findEsbuild() {
  const pnpm = join(ROOT, 'node_modules/.pnpm');
  if (existsSync(pnpm)) {
    const dirs = readdirSync(pnpm).filter((d) => /^esbuild@/.test(d)).sort();
    for (const d of dirs.reverse()) {
      const p = join(pnpm, d, 'node_modules/esbuild/lib/main.js');
      if (existsSync(p)) return p;
    }
  }
  const direct = join(ROOT, 'node_modules/esbuild/lib/main.js');
  return existsSync(direct) ? direct : null;
}

const esbuildPath = findEsbuild();
if (!esbuildPath) {
  console.error('esbuild not found — cannot transform TS/TSX');
  process.exit(2);
}
const esbuild = await import(pathToFileURL(esbuildPath).href);

const EXTS = ['.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts'];

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (e) {
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) throw e;
      const parent = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : ROOT;
      const base = specifier.startsWith('/') ? specifier : join(parent, specifier);
      for (const ext of EXTS) {
        const candidate = base + ext;
        if (existsSync(candidate)) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
      throw e;
    }
  },
  load(url, context, nextLoad) {
    if (!url.startsWith('file:')) return nextLoad(url, context);
    const p = fileURLToPath(url);
    if (p.endsWith('.tsx') || p.endsWith('.ts')) {
      const source = readFileSync(p, 'utf8');
      const { code } = esbuild.transformSync(source, {
        loader: p.endsWith('.tsx') ? 'tsx' : 'ts',
        format: 'esm',
        target: 'node22',
        jsx: 'automatic',
        sourcefile: p,
        sourcemap: false,
      });
      return { format: 'module', source: code, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const areaFilter = (args.find((a) => a.startsWith('--area=')) || '').split('=')[1] || null;

const dir = join(ROOT, 'tests/prd');
const files = readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort();

const results = [];
for (const file of files) {
  let mod;
  try {
    mod = await import(pathToFileURL(join(dir, file)).href);
  } catch (e) {
    results.push({ id: `${file}:load`, area: file, title: '模块加载', ok: false, error: String(e && e.message ? e.message : e) });
    continue;
  }
  for (const check of mod.checks || []) {
    if (areaFilter && check.area !== areaFilter) continue;
    const started = Date.now();
    try {
      await check.run();
      results.push({ id: check.id, area: check.area, title: check.title, ok: true, ms: Date.now() - started });
    } catch (e) {
      results.push({
        id: check.id,
        area: check.area,
        title: check.title,
        ok: false,
        ms: Date.now() - started,
        error: String(e && e.message ? e.message : e).split('\n').slice(0, 3).join(' | '),
      });
    }
  }
}

const pass = results.filter((r) => r.ok).length;
const total = results.length;
const areas = [...new Set(results.map((r) => r.area))];

console.log(`METRIC prd_pass=${pass}`);
console.log(`METRIC prd_total=${total}`);
console.log(`METRIC prd_ratio=${total ? (pass / total).toFixed(4) : 0}`);
for (const area of areas) {
  const rs = results.filter((r) => r.area === area);
  const p = rs.filter((r) => r.ok).length;
  console.log(`METRIC prd_${area}_pass=${p}`);
  console.log(`METRIC prd_${area}_total=${rs.length}`);
}

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log(`\n--- FAIL (${failed.length}/${total}) ---`);
  for (const f of failed.slice(0, verbose ? 500 : 60)) {
    console.log(`✗ ${f.id} [${f.area}] ${f.title}\n    ${f.error}`);
  }
  if (!verbose && failed.length > 60) console.log(`... 还有 ${failed.length - 60} 条失败（--verbose 查看全部）`);
} else {
  console.log('\nALL PRD CHECKS PASS');
}
