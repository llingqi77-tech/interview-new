import assert from 'node:assert/strict';
import { load, need, read } from './_helpers.mjs';

const area = 'stack';

export const checks = [
  {
    id: 'K1', area, title: 'DeepSeek 负责题目生成、角色发言与面后分析',
    async run() {
      const m = await load('api/_lib/llmRoute.ts');
      const src = read('api/_lib/llm.ts');
      assert.ok(/deepseek/i.test(src), 'LLM 层未接 DeepSeek');
      const p = await load('api/_lib/prompts.ts');
      need(p, 'buildTopicPrompt', 'buildPanelQuestionPrompt', 'buildAnalyzePrompt');
    },
  },
  {
    id: 'K2', area, title: 'StepFun 负责 ASR 语音识别',
    async run() {
      const src = read('api/asr.ts');
      assert.ok(/stepfun|step-?asr/i.test(src), 'ASR 未接 StepFun');
    },
  },
  {
    id: 'K3', area, title: 'StepFun 负责 TTS 语音合成',
    async run() {
      const src = read('api/tts.ts');
      assert.ok(/stepfun|step-?tts/i.test(src), 'TTS 未接 StepFun');
    },
  },
  {
    id: 'K4', area, title: 'StepFun Realtime 全双工语音',
    async run() {
      const src = read('api/realtime-token.ts') + read('services/realtimeClient.ts');
      assert.ok(/realtime/i.test(src), '缺少 Realtime 通道');
      const m = await load('engine/inputMode.ts');
      assert.equal(m.INPUT_MODE_CHAIN[0], 'realtime');
    },
  },
  {
    id: 'K5', area, title: '浏览器 Web Speech API 兜底',
    async run() {
      const src = read('services/voiceService.ts');
      assert.ok(/webkitSpeechRecognition|SpeechRecognition/.test(src), '缺少 Web Speech 兜底');
    },
  },
  {
    id: 'K6', area, title: '每位角色独立音色',
    async run() {
      const m = await load('data/roleCards.ts');
      const roles = m.generateCandidates({ company: '字节跳动', jobTitle: '产品经理', seed: 9 });
      const voices = roles.map((r) => r.voice.voice_id);
      assert.equal(new Set(voices).size, 3, `候选人音色重复: ${voices}`);
      const iv = await load('data/interviewers.ts');
      const host = iv.hostInterviewerFor({ company: '字节跳动', jobTitle: '产品经理' });
      assert.ok(host.voiceId && !voices.includes(host.voiceId), '主持面试官音色与候选人重复');
    },
  },
];
