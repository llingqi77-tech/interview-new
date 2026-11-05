import assert from 'node:assert/strict';
import { read, render, contains, notContains, load } from './_helpers.mjs';

const area = 'product';

export const checks = [
  {
    id: 'P1', area, title: '网页标题为「AI 面试练习」',
    run() {
      assert.match(read('index.html'), /<title>AI 面试练习<\/title>/);
    },
  },
  {
    id: 'P2', area, title: '纯前端单页应用：无路由库、无其他子页面',
    run() {
      const pkg = JSON.parse(read('package.json'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const r of ['react-router', 'react-router-dom', 'next', 'wouter', '@tanstack/react-router']) {
        assert.ok(!deps[r], `不应引入路由库 ${r}`);
      }
      const html = read('index.html');
      assert.ok(!/href="\/[a-z]/i.test(html), 'index.html 不应有站内子页面链接');
    },
  },
  {
    id: 'P3', area, title: '打开即可用：首屏直接是练习配置，无登录/注册',
    async run() {
      const App = await load('App.tsx');
      const html = render(App);
      contains(html, '目标公司', '应聘岗位');
      notContains(html, '登录', '注册', 'Sign in', 'Login');
    },
  },
  {
    id: 'P4', area, title: '四段式状态机 IDLE/PREPARING/DISCUSSING/FINISHED',
    async run() {
      const t = await load('types.ts');
      const src = read('types.ts');
      for (const s of ['IDLE', 'PREPARING', 'DISCUSSING', 'FINISHED']) {
        assert.ok(src.includes(`'${s}'`), `状态机缺少 ${s}`);
      }
      assert.ok(t.STATUS_FLOW, '缺少 STATUS_FLOW 导出');
      assert.deepEqual([...t.STATUS_FLOW], ['IDLE', 'PREPARING', 'DISCUSSING', 'FINISHED']);
    },
  },
  {
    id: 'P5', area, title: '两种面试模式：无领导小组讨论 / 结构化单面',
    async run() {
      const App = await load('App.tsx');
      const html = render(App);
      contains(html, '无领导小组讨论', '结构化单面');
    },
  },
  {
    id: 'P6', area, title: '无付费墙：界面不出现购买/支付入口',
    async run() {
      const App = await load('App.tsx');
      const html = render(App);
      notContains(html, '购买', '支付', '付费', '解锁');
    },
  },
  {
    id: 'P7', area, title: '部署域名为 groupinterview.online',
    run() {
      const files = ['Caddyfile', 'vercel.json', 'docker-compose.yml', '.env.example'];
      const hit = files.some((f) => {
        try { return read(f).includes('groupinterview.online'); } catch { return false; }
      });
      assert.ok(hit, '部署配置里没有 groupinterview.online');
    },
  },
  {
    id: 'P8', area, title: '无注册登录：无鉴权表单与账号体系',
    run() {
      const src = read('App.tsx');
      assert.ok(!/LoginForm|SignUpForm|AuthGate|requireAuth/.test(src), 'App 不应有鉴权门');
    },
  },
];
