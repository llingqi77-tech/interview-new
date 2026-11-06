import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * UI 接线与流程静态测试（PRD TC-04/05/07/08/09/10、US-13、5.2 流程、C6）
 * 组件行为已由引擎/服务层测试覆盖；此处验证组件正确接线与响应式布局。
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
/** 会话逻辑在 controller，房间 UI 在 InterviewRoom（RoomStage 容器派生视图） */
const readController = () => read('src/session/sessionController.ts');
const readRoomUi = () => read('components/InterviewRoom.tsx') + read('components/RoomStage.tsx');

test('TC-04: 用户输入/说话时调用 bargeIn（SessionController + InterviewRoom 接线）', () => {
  const controller = readController();
  // 发送消息即抢话（sendTextMessage 首步 bargeIn）
  assert.ok(/sendTextMessage\(text: string\)[\s\S]{0,400}this\.bargeIn\(\)/.test(controller), 'sendTextMessage 未先调用 bargeIn');
  assert.ok(/this\.voice\?\.bargeIn\(\)/.test(controller), 'controller.bargeIn 未调用 VoiceService.bargeIn');
  // 语音输入/打断按钮接线到 controller.bargeIn
  const room = readRoomUi();
  assert.ok(/onBargeIn/.test(room), '房间未接线抢话');
  assert.ok(/controller\.bargeIn\(\)/.test(room), '抢话未调用 controller.bargeIn');
});
test('TC-05: AI 发言超时被打断后由调度器立即安排发言（interrupt → triggerAITurn）', () => {
  const controller = readController();
  assert.ok(/evaluateInterrupt\(this\.deps\.roles, this\.turn, now\)/.test(controller), '未评估打断规则');
  assert.ok(/registerInterrupt\(this\.turn, interrupt\.targetId, interrupt\.interrupterId\)/.test(controller), '打断未登记（罚分/加成）');
  assert.ok(/interruptEvent\(/.test(controller), '打断未走统一事件构造');
  assert.ok(/event_type: 'interrupt'/.test(read('src/session/transcript.ts')), '打断事件未记录');
  // 用户被点名 5 秒未回应 → 其他 AI 接话
  assert.ok(/evaluateUserCalledNoResponse\(this\.deps\.roles, this\.turn, now[,\)]/.test(controller), '未实现点名未响应接话');
});
test('TC-10: 异常降级提示与输入模式展示（InterviewRoom）', () => {
  const room = readRoomUi();
  assert.ok(/degraded/.test(room) && /部分能力降级中/.test(room), '缺少降级提示');
  assert.ok(/INPUT_MODE_LABELS/.test(room), '缺少输入模式展示');
});
test('TC-07: 报告证据点击定位到原话（ReportView 接线）', () => {
  const report = read('components/ReportView.tsx');
  assert.ok(/onLocate/.test(report), '证据点击未定位消息');
  assert.ok(/message_index/.test(report), '证据未关联消息序号');
  assert.ok(/data-message-index/.test(report), '缺少定位锚点');
});

test('TC-08/US-09: 响应式布局（桌面右侧栏 + 移动端隐藏）', () => {
  const room = read('components/InterviewRoom.tsx');
  // 桌面右侧栏
  assert.ok(/hidden md:flex md:w-72/.test(room), '缺少桌面右侧栏');
  // 倒计时始终可见（顶部状态栏）
  assert.ok(/data-testid="countdown-ring"/.test(room), '倒计时未常驻');
  assert.ok(/formatCountdown/.test(room), '倒计时未格式化');
});
test('TC-09/US-10: 前后摄像头切换（DeviceCheck 接线）', () => {
  const dc = read('components/DeviceCheck.tsx');
  assert.ok(/facingMode/.test(dc) && /switchCamera/.test(dc), '缺少摄像头切换');
  assert.ok(/environment/.test(dc) && /user'/.test(dc), '缺少前后摄像头方向');
  const app = read('App.tsx');
  assert.ok(/facingMode/.test(app), 'App 未传递 facingMode');
});

test('TC-10: 网络检测与跳过摄像头（DeviceCheck）', () => {
  const dc = read('components/DeviceCheck.tsx');
  assert.ok(/getNetworkInfo|connection/.test(dc), '缺少网络信息检测');
  assert.ok(/API 不可达（弱网降级纯语音）/.test(dc), '缺少弱网提示');
  assert.ok(/跳过摄像头/.test(dc) && /纯语音模式/.test(dc), '缺少跳过摄像头选项');
  assert.ok(/省电|前台|横屏/.test(dc), '缺少移动端专项提示');
});

test('US-13: SetupForm 四种题型 + 系统自动生成 3 位候选人 + 必填校验', () => {
  const form = read('components/SetupForm.tsx');
  assert.ok(/LGD_TOPIC_TYPES\.map/.test(form), '未渲染四种题型');
  assert.ok(/generateCandidates/.test(form), '未按岗位自动生成候选人');
  assert.ok(/validateSetup/.test(form), '未做必填校验');
  assert.ok(/type="radio"/.test(form), '题型应为单选');
  assert.ok(!/<textarea|<select/.test(form), '进入前不应显示题目');
  assert.ok(/进入面试房间/.test(form), '缺少进入房间入口');
});

test('5.2: 目标流程状态机（IDLE → PREPARING → DISCUSSING → FINISHED）', () => {
  const app = read('App.tsx');
  assert.ok(/status: 'IDLE'/.test(app));
  assert.ok(/status: 'PREPARING'/.test(app));
  assert.ok(/status: 'DISCUSSING'/.test(app));
  assert.ok(/status: 'FINISHED'/.test(app));
  assert.ok(/SetupForm onStart=\{startPreparation\}/.test(app), 'SetupForm 未接入');
  assert.ok(/DeviceCheck onReady=\{enterRoom\}/.test(app), 'DeviceCheck 未接入');
  assert.ok(/RoomStage[\s\S]*onFinish=\{finishSimulation\}/.test(app), 'RoomStage 未接入');
  assert.ok(/ReportView[\s\S]*onDelete=/.test(app), 'ReportView 未接入删除');
});

test('5.2: 降级路径（无麦克风纯文字 / 无摄像头纯语音 / 弱网提示）', () => {
  const app = read('App.tsx');
  assert.ok(/dbAvailable/.test(app) && /本地模式/.test(app), '缺少本地模式降级');
  const room = readRoomUi();
  assert.ok(/inputMode/.test(room), '房间未消费输入模式（降级结果）');
});

test('C6: 不做原生 App——无 Swift/Kotlin/RN 工程文件', () => {
  const forbidden = ['ios/', 'android/', 'App.tsx.bak'];
  for (const f of forbidden) {
    assert.ok(!existsSync(join(ROOT, f)), `存在原生工程目录 ${f}`);
  }
  const pkg = JSON.parse(read('package.json'));
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    assert.ok(!/react-native|expo|capacitor|electron/i.test(dep), `存在原生壳依赖 ${dep}`);
  }
});

test('4.1.1: 前端服务层只调 /api/llm（无直连 DeepSeek）', () => {
  const svc = read('services/geminiService.ts');
  assert.ok(/\/api\/llm/.test(svc), '未调用 /api/llm');
  assert.ok(!/api\.deepseek\.com/.test(svc), '前端仍直连 DeepSeek');
  assert.ok(!/Authorization/.test(svc), '前端仍携带鉴权头');
});

test('4.1.3: 房间使用倒计时阶段与要点跟踪（非 25 轮）', () => {
  const controller = readController();
  assert.ok(/tickPhase/.test(controller), '未驱动倒计时引擎');
  assert.ok(/MAX_DISCUSSIONS_PER_KEY_POINT|maybeAdvanceKeyPoint/.test(controller), '缺少要点跟踪');
  assert.ok(!/MAX_ROUNDS/.test(controller), '仍存在 25 轮上限');
});
test('D4: 关键词检测降级为辅助（advancePhaseByKeyword 仅兜底）', () => {
  const controller = readController();
  assert.ok(/advancePhaseByKeyword/.test(controller), '未保留关键词兜底');
  assert.ok(/phase\.id === 'FREE_DISCUSSION' && this\.shouldAdvanceByKeyword/.test(controller), '关键词推进未限定条件');
});

// ==================== M7 P2：Realtime 全双工与实时打断 ====================

test('M7-P2: onUserVadStart 调用了 bargeIn 且取消了挂起调度（≤300ms 实时打断接线）', () => {
  const controller = read('src/session/sessionController.ts');
  const vadBlock = controller.slice(controller.indexOf('onUserVadStart(): void'));
  assert.ok(/this\.voice\?\.bargeIn\(\)/.test(vadBlock.slice(0, 800)), 'onUserVadStart 未先停 TTS 播放');
  assert.ok(/clearTimeout\(this\.scheduled\)/.test(vadBlock.slice(0, 1200)), 'onUserVadStart 未取消挂起的调度');
  assert.ok(/user_barge_in_realtime/.test(vadBlock), '未登记 user_barge_in_realtime 打断事件');
});

test('M7-P2: realtime-token 端点与 503 降级契约（fallback: push-to-talk）', () => {
  const api = read('api/realtime-token.ts');
  assert.ok(/issueToken\('realtime'\)/.test(api), '未签发 realtime 凭证');
  assert.ok(/503/.test(api) && /fallback: 'push-to-talk'/.test(api), '缺少 503 + fallback 降级契约');
});

test('M7-P2: StepFun 专有事件名只允许出现在适配层（供应商边界）', () => {
  const proprietary = ['speech_started', 'speech_stopped', 'input_audio_buffer', 'session.update', 'response.cancel'];
  const frontendFiles = [
    'components/InterviewRoom.tsx',
    'components/RoomStage.tsx',
    'src/session/sessionController.ts',
    'src/session/sessionStore.ts',
    'src/session/useSession.ts',
    'services/voiceService.ts',
    'services/geminiService.ts',
  ];
  for (const f of frontendFiles) {
    const src = read(f);
    for (const kw of proprietary) {
      assert.ok(!src.includes(kw), `${f} 泄漏 StepFun 专有事件名 ${kw}（应收敛在 services/realtimeClient.ts）`);
    }
  }
  // 适配层确实包含这些事件名（边界成立）
  const client = read('services/realtimeClient.ts');
  for (const kw of proprietary) {
    assert.ok(client.includes(kw), `realtimeClient.ts 缺少事件名 ${kw}`);
  }
});

test('M7-P2: dev WS 代理挂载（浏览器无法设 Authorization 头 → 服务端代理）', () => {
  const localApi = read('server/local-api.ts');
  assert.ok(/realtime-proxy/.test(localApi) && /upgrade/.test(localApi), 'local-api 未挂载 realtime WS 代理');
  const proxy = read('server/realtime-proxy.ts');
  assert.ok(/Authorization: `Bearer/.test(proxy), '代理未持 key 连上游');
  assert.ok(/verifyToken/.test(proxy), '代理未校验短时凭证');
});
