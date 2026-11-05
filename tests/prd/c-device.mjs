import assert from 'node:assert/strict';
import { render, contains, notContains, load, need } from './_helpers.mjs';

const area = 'device';

const baseState = {
  mic: 'ok', camera: 'ok', speaker: 'ok', network: 'ok',
  micLevel: 0.42, networkLatencyMs: 120,
};

export const checks = [
  {
    id: 'D1', area, title: '麦克风：权限检测 + 实时音量条',
    async run() {
      const C = await load('components/DeviceCheck.tsx');
      const html = render(C, { onReady() {}, onBack() {}, format: 'lgd' });
      contains(html, '麦克风', '音量');
    },
  },
  {
    id: 'D2', area, title: '麦克风失败自动切为纯文字模式',
    async run() {
      const m = await load('engine/deviceCheck.ts');
      need(m, 'resolveDegradation');
      const d = m.resolveDegradation({ ...baseState, mic: 'failed' });
      assert.equal(d.inputMode, 'text');
      assert.equal(d.voiceEnabled, false);
    },
  },
  {
    id: 'D3', area, title: '摄像头：权限检测 + 画面预览 + 可跳过',
    async run() {
      const C = await load('components/DeviceCheck.tsx');
      const html = render(C, { onReady() {}, onBack() {}, format: 'lgd' });
      contains(html, '摄像头', '跳过');
    },
  },
  {
    id: 'D4', area, title: '跳过摄像头进入纯语音模式',
    async run() {
      const m = await load('engine/deviceCheck.ts');
      const d = m.resolveDegradation({ ...baseState, camera: 'skipped' });
      assert.equal(d.cameraEnabled, false);
      assert.equal(d.voiceEnabled, true);
      assert.equal(d.visualScored, false);
    },
  },
  {
    id: 'D5', area, title: '移动端可切换前后摄像头',
    async run() {
      const m = await load('engine/deviceCheck.ts');
      need(m, 'nextFacingMode');
      assert.equal(m.nextFacingMode('user'), 'environment');
      assert.equal(m.nextFacingMode('environment'), 'user');
      const C = await load('components/DeviceCheck.tsx');
      const html = render(C, { onReady() {}, onBack() {}, format: 'lgd', isMobile: true });
      contains(html, '切换摄像头');
    },
  },
  {
    id: 'D6', area, title: '扬声器：播放测试音确认能听到 AI 发言',
    async run() {
      const m = await load('engine/deviceCheck.ts');
      need(m, 'SPEAKER_TEST_TEXT');
      assert.ok(m.SPEAKER_TEST_TEXT.length > 4);
      const C = await load('components/DeviceCheck.tsx');
      const html = render(C, { onReady() {}, onBack() {}, format: 'lgd' });
      contains(html, '扬声器', '测试音');
    },
  },
  {
    id: 'D7', area, title: '网络：连通性 + API 探测延迟',
    async run() {
      const m = await load('engine/deviceCheck.ts');
      need(m, 'probeNetwork', 'WEAK_NETWORK_MS');
      const C = await load('components/DeviceCheck.tsx');
      const html = render(C, { onReady() {}, onBack() {}, format: 'lgd' });
      contains(html, '网络', '延迟');
    },
  },
  {
    id: 'D8', area, title: '弱网自动降级为纯语音/纯文字',
    async run() {
      const m = await load('engine/deviceCheck.ts');
      const d = m.resolveDegradation({ ...baseState, networkLatencyMs: m.WEAK_NETWORK_MS + 500 });
      assert.ok(d.degraded, '弱网未标记降级');
      assert.ok(['asr', 'webspeech', 'text'].includes(d.inputMode), `弱网输入模式未降级: ${d.inputMode}`);
    },
  },
  {
    id: 'D9', area, title: '移动端提示：竖屏 / iOS Safari 后台音频 / 省电模式',
    async run() {
      const m = await load('engine/deviceCheck.ts');
      need(m, 'MOBILE_HINTS');
      assert.equal(m.MOBILE_HINTS.length, 3);
      const joined = m.MOBILE_HINTS.join('|');
      assert.ok(joined.includes('竖屏'), '缺少竖屏提示');
      assert.ok(joined.includes('iOS'), '缺少 iOS 提示');
      assert.ok(joined.includes('省电'), '缺少省电模式提示');
    },
  },
  {
    id: 'D10', area, title: '数据同意开关：保存转写文本与聚合特征',
    async run() {
      const C = await load('components/DeviceCheck.tsx');
      const html = render(C, { onReady() {}, onBack() {}, format: 'lgd' });
      contains(html, '同意', '转写', '聚合特征');
    },
  },
  {
    id: 'D11', area, title: '原始音频/视频默认不保存',
    async run() {
      const C = await load('components/DeviceCheck.tsx');
      const html = render(C, { onReady() {}, onBack() {}, format: 'lgd' });
      contains(html, '原始音频');
      const m = await load('engine/privacy.ts');
      assert.ok(m.PRIVACY.notSaved.some((x) => x.includes('原始音频')), '隐私声明缺少原始音频');
    },
  },
  {
    id: 'D12', area, title: '流程预览：展示当前模式完整分阶段流程',
    async run() {
      const C = await load('components/DeviceCheck.tsx');
      const lgd = render(C, { onReady() {}, onBack() {}, format: 'lgd' });
      contains(lgd, '流程预览', '审题', '自我介绍', '自由讨论', '总结陈词');
      const panel = render(C, { onReady() {}, onBack() {}, format: 'panel' });
      contains(panel, '流程预览', '面试官问答', '反问');
    },
  },
  {
    id: 'D13', area, title: '通过后按钮文案：进入群面房间 / 进入单面房间',
    async run() {
      const C = await load('components/DeviceCheck.tsx');
      contains(render(C, { onReady() {}, onBack() {}, format: 'lgd' }), '进入群面房间');
      contains(render(C, { onReady() {}, onBack() {}, format: 'panel' }), '进入单面房间');
    },
  },
];
