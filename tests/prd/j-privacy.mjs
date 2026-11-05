import assert from 'node:assert/strict';
import { load, need, read } from './_helpers.mjs';

const area = 'privacy';

export const checks = [
  {
    id: 'J1', area, title: '群面转写文本需用户明确同意才收集',
    async run() {
      const m = await load('engine/privacy.ts');
      need(m, 'PRIVACY', 'CONSENT_ITEMS');
      assert.ok(m.PRIVACY.collected.some((x) => x.includes('转写')), '收集项缺少转写文本');
      assert.ok(m.CONSENT_ITEMS.some((x) => x.includes('转写')), '同意项缺少转写文本');
    },
  },
  {
    id: 'J2', area, title: '收集聚合特征（发言时长、打断次数、话语权占比）',
    async run() {
      const m = await load('engine/privacy.ts');
      const joined = m.PRIVACY.collected.join('|');
      for (const k of ['发言时长', '打断', '话语权']) {
        assert.ok(joined.includes(k), `聚合特征缺少 ${k}`);
      }
    },
  },
  {
    id: 'J3', area, title: '原始音频/视频默认不保存',
    async run() {
      const m = await load('engine/privacy.ts');
      assert.ok(m.PRIVACY.notSaved.some((x) => x.includes('原始音频')), '缺少原始音频不保存声明');
      assert.ok(m.PRIVACY.notSaved.some((x) => x.includes('视频')), '缺少原始视频不保存声明');
    },
  },
  {
    id: 'J4', area, title: '摄像头分析全部在浏览器本地完成（0 字节上传）',
    async run() {
      const m = await load('engine/privacy.ts');
      assert.ok(m.PRIVACY.localOnly.some((x) => x.includes('摄像头')), '缺少摄像头本地分析声明');
      const worker = read('src/vision/visionWorker.ts');
      assert.ok(!/fetch\(|XMLHttpRequest|navigator\.sendBeacon/.test(worker), '视觉 worker 不应有网络上传');
      const client = read('src/vision/visionClient.ts');
      assert.ok(!/fetch\(|XMLHttpRequest/.test(client), '视觉客户端不应上传画面');
    },
  },
  {
    id: 'J5', area, title: '第三方 API 分工：DeepSeek 文本 / StepFun 音频',
    async run() {
      const m = await load('engine/privacy.ts');
      const ds = m.PRIVACY.thirdParties.find((p) => p.name === 'DeepSeek');
      const sf = m.PRIVACY.thirdParties.find((p) => p.name === 'StepFun');
      assert.ok(ds && ds.scope.includes('文本'), 'DeepSeek 分工缺失');
      assert.ok(sf && /TTS|ASR|语音/.test(sf.scope), 'StepFun 分工缺失');
    },
  },
  {
    id: 'J6', area, title: 'API 密钥仅保存在服务端，前端不持有',
    async run() {
      const vite = read('vite.config.ts');
      assert.ok(!/DEEPSEEK_API_KEY\s*:/.test(vite), 'vite 不应注入 DEEPSEEK_API_KEY');
      const src = read('src/api.ts');
      assert.ok(!/DEEPSEEK_API_KEY|STEPFUN_API_KEY/.test(src), '前端不应出现 API key 变量');
    },
  },
  {
    id: 'J7', area, title: '语音凭证由服务端短时签发',
    async run() {
      const m = await load('engine/privacy.ts');
      assert.ok(m.PRIVACY.thirdParties.some((p) => p.credential && p.credential.includes('服务端')), '缺少凭证服务端签发声明');
      const token = read('api/realtime-token.ts');
      assert.ok(/expires|ttl|exp/i.test(token), '实时语音 token 未设置有效期');
    },
  },
  {
    id: 'J8', area, title: '用途仅限本次报告与产品改进分析',
    async run() {
      const m = await load('engine/privacy.ts');
      const joined = m.PRIVACY.purpose.join('|');
      assert.ok(joined.includes('报告'), '用途缺少报告');
      assert.ok(joined.includes('改进'), '用途缺少产品改进');
    },
  },
];
