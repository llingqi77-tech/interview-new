import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

export const ROOT = process.cwd();
export const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
export const has = (rel) => existsSync(join(ROOT, rel));

/** 渲染真实组件为静态 HTML（真实行为断言，不是源码 grep） */
export function render(Component, props = {}) {
  const C = Component?.default ?? Component;
  assert.equal(typeof C, 'function', '组件不是可渲染的函数组件');
  return renderToStaticMarkup(React.createElement(C, props));
}

/** 断言 HTML 里同时出现若干文案 */
export function contains(html, ...needles) {
  for (const n of needles) {
    assert.ok(html.includes(n), `渲染结果缺少「${n}」`);
  }
}

export function notContains(html, ...needles) {
  for (const n of needles) {
    assert.ok(!html.includes(n), `渲染结果不应出现「${n}」`);
  }
}

/** 断言模块导出存在 */
export function need(mod, ...names) {
  for (const n of names) {
    assert.ok(mod[n] !== undefined, `模块缺少导出 ${n}`);
  }
}

export async function load(rel) {
  return import(new URL(`../../${rel}`, import.meta.url).href);
}

export function near(actual, expected, tol = 0.01, msg = '') {
  assert.ok(Math.abs(actual - expected) <= tol, `${msg} 期望 ${expected}±${tol}，实际 ${actual}`);
}
