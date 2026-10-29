import type { GameEvent, InterviewFormat, Message, PhaseId, RoleCard, SimulationState, VisualFeatureRow } from '../../types.ts';
import { USER_INFO } from '../../data/userInfo.ts';
import {
  tickPhase,
  advancePhaseByKeyword,
  currentPhase,
  currentOpeningSpeaker,
  phaseRemainingMs,
  phaseProgress,
  stageUrgency,
  type PhaseConfig,
  type PhaseState,
  getPhaseDefs,
} from '../../engine/phaseEngine.ts';
import {
  createTurnState,
  selectNextSpeaker,
  evaluateInterrupt,
  evaluateUserCalledNoResponse,
  registerSpeak,
  registerInterrupt,
  registerUserMissedTurn,
  INTERRUPT_RULES,
  type TurnTakingState,
} from '../../engine/turnTaking.ts';
import { extractKeyPoints } from '../../engine/keyPoints.ts';
import { KeyPointTracker } from '../../engine/keyPointTracker.ts';
import { buildOpeningOrder } from '../../engine/openingOrder.ts';
import { estimateSpeechMs, playbackFallbackMs, userReplyDelayMs } from '../../engine/speechRate.ts';
import { generateAIReply, type ReplyParams, type ReplyResult } from '../../services/geminiService.ts';
import { VoiceService } from '../../services/voiceService.ts';
import { RealtimeClient, type RealtimeClientOptions } from '../../services/realtimeClient.ts';
import type { VoiceLanePool, VoiceLanePoolOptions } from '../../services/voiceLanes.ts';
import { RealtimeVoiceRouter } from '../../services/realtimeVoiceRouter.ts';
import { HOST_CARD, isHostCard } from '../../data/interviewerCards.ts';
import { saveMessage, saveEvents } from '../api.ts';
import { VisionClient } from '../vision/visionClient.ts';
import { createSessionStore, makeInitialSnapshot, type SessionStore } from './sessionStore.ts';
import { SaveQueue } from './saveQueue.ts';
import { collectVoiceSpeakers } from './voiceRoster.ts';
import { buildAiMessage, buildUserMessage, interruptEvent, speakGrantEvent, stageChangeEvent } from './transcript.ts';
import { buildReplyParams } from './replyRequest.ts';
import type { SpeakerKind } from './speakerKind.ts';
import {
  AI_PLAYING_RETRY_MS,
  BARGE_IN_HOLD_MS,
  BARGE_IN_RETRY_MS,
  HOST_NUDGE_COOLDOWN_MS,
  HOST_NUDGE_SILENCE_MS,
  PANEL_NO_RESPONSE_MS,
  PANEL_OPENING_ADVANCE_MS,
  PANEL_PHASE_DURATIONS_MS,
  READING_HOST_DELAY_MS,
  TICK_MS,
  TURN_DELAY_MIN_MS,
  TURN_DELAY_SPAN_MS,
  USER_REPLY_EXTRA_MIN_MS,
  USER_REPLY_EXTRA_SPAN_MS,
  USER_WAIT_LIMIT_MS,
} from './sessionTiming.ts';

export { TICK_MS, PANEL_PHASE_DURATIONS_MS, PANEL_OPENING_ADVANCE_MS } from './sessionTiming.ts';
export type { SpeakerKind } from './speakerKind.ts';

/**
 * SessionController —— 会话编排器。
 * 阶段、发言权、要点、落库、语音、视觉各自在独立模块；这里只负责把它们接成一场面试。
 * 公开动作与重构前一致（引擎测试 + ui-wiring 看守）。
 */

export interface SessionDeps {
  state: SimulationState;
  roles: RoleCard[];
  sessionId: number | null;
  consentSaveTranscript: boolean;
  cameraEnabled: boolean;
  facingMode: 'user' | 'environment';
  /** 群面阵型：lgd = 1 面试官 + 4 候选人（含我）；panel = 3 面试官 + 1 候选人。缺省 lgd */
  format?: InterviewFormat;
  onFinish: (history: Message[], events: GameEvent[], sessionStartAt: number, visualRows?: VisualFeatureRow[]) => void;
  /** 测试注入：替换 LLM 调用（默认 generateAIReply） */
  generateReply?: (params: ReplyParams, onChunk: (chunk: string) => void) => Promise<ReplyResult>;
  /** 测试注入：阶段时长覆盖 */
  phaseDurationsMs?: Partial<Record<PhaseId, number>>;
  /** 测试注入：panel 自我介绍结束后进入问答的等待窗 */
  panelOpeningAdvanceMs?: number;
  /** 测试注入：替换 Realtime 建链 */
  createRealtimeClient?: (opts: RealtimeClientOptions) => Promise<RealtimeClient>;
  /**
   * 测试注入：替换嘴会话分路池。
   * 缺省时按本场音色各开一条 Realtime 嘴会话。耳会话仍走 createRealtimeClient。
   */
  createVoiceLanes?: (opts: VoiceLanePoolOptions) => Promise<VoiceLanePool>;
}

interface SpokenReply {
  result: ReplyResult;
  content: string;
  startedAt: number;
}

export class SessionController {
  readonly store: SessionStore;
  /** 阶段配置。openingOrder 构造时定一次，避免每帧重抽用户位置 */
  readonly phaseConfig: PhaseConfig;

  private deps: SessionDeps;
  private phaseRef: PhaseState;
  private turn: TurnTakingState = createTurnState();
  private readonly keyPoints = new KeyPointTracker();
  private readonly saves = new SaveQueue();
  private generating = new Set<string>();
  private openingTriggered = new Set<number>();
  private scheduled: ReturnType<typeof setTimeout> | null = null;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private speakEndsAt = 0;
  private bargedInAt = 0;
  private finished = false;
  private sessionStartAt = Date.now();
  private voice: VoiceService | null = null;
  private realtime: RealtimeClient | null = null;
  /** 耳会话 + 按音色去重的嘴会话。耳失败时为 null，整路降级 */
  private router: RealtimeVoiceRouter | null = null;
  private realtimeTried = false;
  /** dispose / 重新 init 时自增，在途握手据此丢弃过期连接 */
  private realtimeGeneration = 0;
  /** realtime AI 语音播放中的角色 */
  private realtimeSpeakingCharId: string | null = null;
  /** panel：用户在个人陈述阶段内的发言时间，用于说完后自动进问答 */
  private openingUserSpeechAt = 0;
  /** 当前发言权窗口归属。只有它结束时才允许清零 speakEndsAt */
  private speakWindowOwner: string | null = null;
  /** 用户打断后自增。在途 LLM 回合据此判定过期 */
  private turnEpoch = 0;
  /** dispose 后置位，阻止在途回调把资源复活 */
  private disposed = false;
  /** 已做阶段开场白标记 */
  private stageEnterAnnounced = new Set<string>();
  private lastHostNudgeAt = 0;
  private userStream: MediaStream | null = null;
  private visionClient: VisionClient | null = null;
  private visualRows: VisualFeatureRow[] = [];
  /** AI 台词播报兜底定时器。dispose 时统一清理 */
  private playbackTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(deps: SessionDeps) {
    this.deps = deps;
    this.store = createSessionStore(makeInitialSnapshot(Date.now(), { cameraOn: deps.cameraEnabled }));
    this.phaseRef = this.store.getSnapshot().phase;
    const format = deps.format ?? 'lgd';
    const panelDurations = format === 'panel' ? PANEL_PHASE_DURATIONS_MS : undefined;
    this.phaseConfig = {
      openingOrder: buildOpeningOrder(deps.roles, format),
      durationsMs: { ...panelDurations, ...(deps.phaseDurationsMs ?? {}) },
    };
  }

  /** props 每渲染同步最新引用（onFinish / consent 等） */
  updateDeps(deps: SessionDeps): void {
    this.deps = deps;
  }

  get format(): InterviewFormat {
    return this.deps.format ?? 'lgd';
  }

  // ---------- 生命周期 ----------

  init(): void {
    this.disposed = false;
    this.finished = false;
    this.sessionStartAt = Date.now();
    this.loadKeyPoints();
    this.startVoice();
    this.startCamera();
    this.tickInterval = setInterval(() => this.tick(), TICK_MS);
    void this.initRealtime();
  }

  dispose(): void {
    this.disposed = true;
    this.realtimeTried = false;
    this.realtimeGeneration += 1;
    this.turnEpoch += 1;
    this.stopClock();
    this.stopPlaybackTimers();
    this.releaseVoice();
    this.releaseRealtime();
    void this.stopVision();
    this.stopCamera();
  }

  // ---------- 事件 / 消息 ----------

  pushEvents(newEvents: GameEvent[]): void {
    if (newEvents.length === 0) return;
    this.store.set({ events: [...this.snap.events, ...newEvents] });
    this.persistEvents(newEvents);
  }

  addMessage(msg: Message): void {
    const messages = [...this.snap.messages, msg];
    this.store.set({ messages });
    this.keyPoints.noteUtterance();
    this.persistMessage(msg, messages.length);
  }

  async finishSession(): Promise<void> {
    if (this.finished || this.disposed) return;
    this.finished = true;
    this.clearScheduledTurn();
    const visualRows = await this.stopVision();
    await this.saves.flush();
    this.deps.onFinish(this.snap.messages, this.snap.events, this.sessionStartAt, visualRows);
  }

  // ---------- AI 发言 ----------

  async triggerAITurn(card: RoleCard, opts?: { speakerKind?: SpeakerKind; force?: boolean }): Promise<void> {
    if (!this.canStartAiTurn(card, opts?.force)) return;
    const speakerKind = opts?.speakerKind ?? this.defaultSpeakerKind(card);
    const phaseAtStart = currentPhase(this.phaseRef, this.phaseConfig);
    const epoch = this.beginAiTurn(card);
    let stale = false;
    try {
      const spoken = await this.requestReply(card, speakerKind);
      stale = epoch !== this.turnEpoch;
      if (stale || this.disposed) {
        console.log('[session] AI 回合被用户打断，丢弃本次台词');
        return;
      }
      this.commitAiUtterance(card, speakerKind, phaseAtStart, spoken);
      await this.playAiLine(card, spoken);
    } catch (err) {
      console.error('AI 发言失败:', err);
      this.store.set({ degraded: true });
    } finally {
      this.endAiTurn(card.id, speakerKind, stale);
    }
  }

  scheduleNextTurn(delayMs?: number): void {
    if (this.finished || this.disposed) return;
    this.clearScheduledTurn();
    const delay = delayMs ?? TURN_DELAY_MIN_MS + Math.random() * TURN_DELAY_SPAN_MS;
    this.scheduled = setTimeout(() => this.runScheduledTurn(), delay);
  }

  // ---------- 用户发言 / 打断 ----------

  /** 文字发送：先停 AI 播报，再落消息 */
  sendTextMessage(text: string): void {
    // barge-in v1：用户输入即停止 AI 播报（TC-04：300ms 内停止）
    this.bargeIn();
    this.submitUserMessage(text, 'text');
  }

  /** Realtime 最终转写。VAD 已经停过播，这里只落消息 */
  sendUserSpeech(text: string, confidence?: number): void {
    this.submitUserMessage(text, 'realtime', confidence);
  }

  /** dock 打断按钮 / 发送消息共用 */
  bargeIn(): void {
    this.voice?.bargeIn();
    this.stopRealtimeSpeech();
    this.store.set({ speakingCharId: null });
    this.closeSpeakWindow();
    this.turnEpoch += 1;
    this.bargedInAt = Date.now();
  }

  /**
   * Realtime VAD 用户开口。目标 ≤300ms 停声。
   * 400ms 确认窗与 800ms 冷却在 RealtimeClient 侧完成。
   */
  onUserVadStart(): void {
    const interruptedCharId = this.snap.speakingCharId ?? this.snap.activeCharId;
    const hadScheduled = Boolean(this.scheduled);
    const isBargeIn = Boolean(interruptedCharId) || this.snap.isGenerating || hadScheduled;
    this.voice?.bargeIn();
    this.stopRealtimeSpeech();
    this.closeSpeakWindow();
    this.turnEpoch += 1;
    this.store.set({ speakingCharId: null, isGenerating: false, userSpeaking: true });
    if (this.scheduled) {
      clearTimeout(this.scheduled);
      this.scheduled = null;
    }
    this.bargedInAt = Date.now();
    if (!isBargeIn) return;
    this.recordUserBargeIn(interruptedCharId);
  }

  onUserVadStop(): void {
    if (this.snap.userSpeaking) this.store.set({ userSpeaking: false });
  }

  setUserSpeaking(speaking: boolean): void {
    this.store.set({ userSpeaking: speaking });
  }

  // ---------- Realtime ----------

  async initRealtime(): Promise<void> {
    if (this.router || this.realtime || this.realtimeTried || this.finished || this.disposed) return;
    this.realtimeTried = true;
    const generation = this.realtimeGeneration;
    this.store.set({ realtimeStatus: 'connecting' });
    try {
      const router = await this.connectRouter(generation);
      this.attachRouter(router, generation);
    } catch (err) {
      this.failRealtime(generation, err);
    }
  }

  isRealtimeActive(): boolean {
    return this.realtime !== null;
  }

  isRealtimeVoiceActive(): boolean {
    return this.realtime !== null && this.realtime.state === 'open';
  }

  getRealtimePlaybackAnalyser(): AnalyserNode | null {
    return this.router?.getPlaybackAnalyser() ?? this.realtime?.getPlaybackAnalyser() ?? null;
  }

  async startUserAsr(onPartial: (text: string) => void, onFinal: (text: string) => void): Promise<void> {
    if (!this.voice || this.isRealtimeActive()) return;
    await this.voice.startAsr(onPartial, onFinal);
  }

  async stopUserAsr(): Promise<string> {
    if (!this.voice || this.isRealtimeActive()) return '';
    return this.voice.stopAsr();
  }

  // ---------- 设备 ----------

  toggleMic(): void {
    const next = !this.snap.micOn;
    this.store.set({ micOn: next });
    this.realtime?.setMuted(!next);
  }

  toggleCamera(): void {
    const next = !this.snap.cameraOn;
    this.store.set({ cameraOn: next });
    const stream = this.userStream;
    if (!stream) return;
    stream.getVideoTracks().forEach((track) => {
      track.enabled = next;
    });
    if (next) this.startVision(stream);
    else void this.stopVision();
  }

  getVisionLatest(): VisualFeatureRow | null {
    return this.visionClient?.getLatestRow() ?? null;
  }

  getUserStream(): MediaStream | null {
    return this.userStream;
  }

  getVoiceService(): VoiceService | null {
    return this.voice;
  }

  isFinished(): boolean {
    return this.finished;
  }

  /** 测试专用：跳过真实倒计时，直接写入阶段态 */
  forcePhaseForTest(next: PhaseState): void {
    this.phaseRef = next;
    this.store.set({ phase: next });
  }

  // ---------- 内部：时钟 ----------

  private tick(): void {
    if (this.finished || this.disposed) return;
    const now = Date.now();
    if (this.advancePhaseClock(now)) return;
    const phase = currentPhase(this.phaseRef, this.phaseConfig);
    if (phase.id === 'OPENING') {
      this.tickOpening(now);
      return;
    }
    if (phase.id === 'READING') {
      this.tickReading(now);
      return;
    }
    this.tickDiscussion(now, phase);
  }

  private advancePhaseClock(now: number): boolean {
    const res = tickPhase(this.phaseRef, now, this.phaseConfig, this.sessionStartAt);
    if (!res.changed) return false;
    const prevPhaseId = currentPhase(this.phaseRef, this.phaseConfig).id;
    this.phaseRef = res.state;
    this.store.set({ phase: res.state });
    this.pushEvents(res.events);
    if (res.state.finished) {
      void this.finishSession();
      return true;
    }
    const nextPhaseId = currentPhase(this.phaseRef, this.phaseConfig).id;
    if (nextPhaseId !== prevPhaseId) this.onStageEnter(nextPhaseId);
    return false;
  }

  private tickOpening(now: number): void {
    if (this.panelIntroReady(now)) {
      this.advancePanelOpening(now);
      return;
    }
    this.triggerOpeningSpeaker(now);
  }

  private tickReading(now: number): void {
    if (this.format !== 'lgd' || this.stageEnterAnnounced.has('READING')) return;
    if (now <= this.sessionStartAt + READING_HOST_DELAY_MS) return;
    this.stageEnterAnnounced.add('READING');
    void this.triggerAITurn(HOST_CARD, { speakerKind: 'host', force: true });
  }

  private tickDiscussion(now: number, phase: { id: PhaseId }): void {
    if (this.takeOverSilentUser(now)) return;
    if (this.handleSpeakTimeout(now)) return;
    if (this.shouldNudgeHost(now, phase.id)) {
      this.lastHostNudgeAt = now;
      void this.triggerAITurn(HOST_CARD, { speakerKind: 'host', force: true });
      return;
    }
    if (this.userWaitingTooLong(now) && this.format === 'lgd' && !this.scheduled && this.generating.size === 0) {
      this.scheduleNextTurn(0);
    }
  }

  private onStageEnter(phaseId: PhaseId): void {
    if (this.finished || this.stageEnterAnnounced.has(phaseId)) return;
    this.stageEnterAnnounced.add(phaseId);
    if (this.format === 'lgd') {
      if (phaseId === 'FREE_DISCUSSION' || phaseId === 'SUMMARY') {
        void this.triggerAITurn(HOST_CARD, { speakerKind: 'host', force: true });
      }
      return;
    }
    if (phaseId === 'OPENING' || phaseId === 'SUMMARY') {
      const first = this.deps.roles[0];
      if (first) void this.triggerAITurn(first, { speakerKind: 'interviewer', force: true });
    }
  }

  // ---------- 内部：发言权 ----------

  private runScheduledTurn(): void {
    this.scheduled = null;
    if (this.finished || this.disposed) return;
    const phase = currentPhase(this.phaseRef, this.phaseConfig);
    if (!phase.allowSpeech || this.generating.size > 0) return;
    if (this.aiVoicePlaying()) {
      this.scheduled = setTimeout(() => this.runScheduledTurn(), AI_PLAYING_RETRY_MS);
      return;
    }
    const now = Date.now();
    const decision = selectNextSpeaker(this.deps.roles, this.turn, {
      now,
      stageUrgency: stageUrgency(this.phaseRef, now, this.phaseConfig),
      silenceMs: this.silenceMs(now),
    });
    if (this.withinBargeInHold(now) && decision.speakerId !== 'user') {
      this.scheduled = setTimeout(() => this.runScheduledTurn(), BARGE_IN_RETRY_MS);
      return;
    }
    this.grantTurn(decision.speakerId, now);
  }

  private grantTurn(speakerId: string, now: number): void {
    if (speakerId === 'user') {
      this.handMicToUser(now);
      return;
    }
    const card = this.findRole(speakerId);
    if (!card) return;
    this.store.set({ awaitingUser: false });
    if (this.format !== 'panel') this.turn = registerUserMissedTurn(this.turn);
    void this.triggerAITurn(card);
  }

  private takeOverSilentUser(now: number): boolean {
    const noRespGraceMs = this.format === 'panel' ? PANEL_NO_RESPONSE_MS : INTERRUPT_RULES.userCalledMs;
    const noResp = evaluateUserCalledNoResponse(this.deps.roles, this.turn, now, noRespGraceMs);
    if (noResp.type !== 'interrupt') return false;
    this.turn = registerInterrupt(this.turn, noResp.targetId, noResp.interrupterId);
    this.pushEvents([interruptEvent(noResp.interrupterId, noResp.targetId, this.elapsedAt(now), noResp.rule)]);
    this.turn = { ...this.turn, userCalledAt: null, userMissedTurns: 0 };
    this.store.set({ awaitingUser: false });
    this.startRoleTurn(noResp.interrupterId);
    return true;
  }

  private handleSpeakTimeout(now: number): boolean {
    if (now >= this.speakEndsAt || !this.turn.currentSpeaker) return false;
    const interrupt = evaluateInterrupt(this.deps.roles, this.turn, now);
    if (interrupt.type !== 'interrupt') return false;
    this.voice?.bargeIn();
    this.store.set({ speakingCharId: null });
    this.turn = registerInterrupt(this.turn, interrupt.targetId, interrupt.interrupterId);
    this.pushEvents([interruptEvent(interrupt.interrupterId, interrupt.targetId, this.elapsedAt(now), interrupt.rule)]);
    this.startRoleTurn(interrupt.interrupterId);
    return true;
  }

  private panelIntroReady(now: number): boolean {
    const waitMs = this.deps.panelOpeningAdvanceMs ?? PANEL_OPENING_ADVANCE_MS;
    return (
      this.format === 'panel' &&
      this.openingUserSpeechAt > 0 &&
      now - this.openingUserSpeechAt > waitMs &&
      now >= this.speakEndsAt
    );
  }

  private advancePanelOpening(now: number): void {
    const nextIndex = Math.min(this.phaseRef.phaseIndex + 1, this.phaseConfigLength());
    this.phaseRef = { ...this.phaseRef, phaseIndex: nextIndex, phaseStartedAt: now };
    this.store.set({ phase: this.phaseRef });
    this.pushEvents([stageChangeEvent('FREE_DISCUSSION', this.elapsedAt(now), 'panel_intro_done')]);
    this.onStageEnter('FREE_DISCUSSION');
  }

  private triggerOpeningSpeaker(now: number): void {
    const index = this.phaseRef.openingIndex;
    const speaker = currentOpeningSpeaker(this.phaseRef, this.phaseConfig);
    if (!speaker || this.openingTriggered.has(index)) return;
    this.openingTriggered.add(index);
    if (speaker === 'user') {
      this.handMicToUser(now);
      return;
    }
    const card = this.findRole(speaker);
    if (!card) return;
    void this.triggerAITurn(card, { speakerKind: this.format === 'panel' ? 'interviewer' : 'candidate' });
  }

  // ---------- 内部：AI 回合 ----------

  private canStartAiTurn(card: RoleCard, force?: boolean): boolean {
    if (this.finished || this.disposed || !card?.id) return false;
    if (this.generating.has(card.id)) return false;
    const phase = currentPhase(this.phaseRef, this.phaseConfig);
    return phase.allowSpeech || Boolean(force);
  }

  private beginAiTurn(card: RoleCard): number {
    this.generating.add(card.id);
    this.store.set({ activeCharId: card.id, isGenerating: true, streamingText: '', awaitingUser: false });
    return this.turnEpoch;
  }

  private async requestReply(card: RoleCard, speakerKind: SpeakerKind): Promise<SpokenReply> {
    const reply = this.deps.generateReply ?? generateAIReply;
    const startedAt = Date.now();
    const phase = currentPhase(this.phaseRef, this.phaseConfig);
    const result = await reply(
      buildReplyParams({
        card,
        topic: this.deps.state.topic,
        jobTitle: this.deps.state.jobTitle,
        history: this.snap.messages,
        phase: phase.promptPhase,
        currentKeyPoint: this.keyPoints.current,
        keyPointDiscussionCount: this.keyPoints.discussionCount,
        allKeyPointsDiscussed: this.keyPoints.allDiscussed,
        allKeyPoints: this.keyPoints.points,
        currentKeyPointIndex: this.keyPoints.index,
        voiceMode: this.isRealtimeVoiceActive() || this.snap.caps?.outputMode === 'stepfun-tts',
        speakerKind,
        phaseRemainingMs: phaseRemainingMs(this.phaseRef, startedAt, this.phaseConfig),
        sessionId: this.deps.sessionId,
      }),
      (chunk) => this.store.set({ streamingText: this.snap.streamingText + chunk }),
    );
    const content = result.content?.trim();
    if (!content) throw new Error('空回复');
    return { result, content, startedAt };
  }

  private commitAiUtterance(card: RoleCard, speakerKind: SpeakerKind, phase: { id: PhaseId }, spoken: SpokenReply): void {
    const endedAt = Date.now();
    this.addMessage(
      buildAiMessage({
        cardId: card.id,
        cardName: card.name,
        content: spoken.content,
        startedAt: spoken.startedAt,
        endedAt,
        sessionStartAt: this.sessionStartAt,
        emotion: spoken.result.emotion,
      }),
    );
    this.turn = registerSpeak(this.turn, card.id, endedAt);
    this.grantSpeakWindow(card.id, endedAt + estimateSpeechMs(spoken.content));
    this.pushEvents([speakGrantEvent(card.id, this.elapsedAt(endedAt))]);
    if (speakerKind === 'candidate') this.maybeAdvanceKeyPoint(spoken.content);
    this.maybeAdvancePhaseByKeyword(phase, speakerKind, spoken.content);
  }

  private maybeAdvancePhaseByKeyword(phase: { id: PhaseId }, speakerKind: SpeakerKind, content: string): void {
    if (this.format === 'lgd' && speakerKind === 'candidate' && phase.id === 'FREE_DISCUSSION' && this.shouldAdvanceByKeyword(content)) {
      const res = advancePhaseByKeyword(this.phaseRef, Date.now(), this.phaseConfig, this.sessionStartAt);
      if (!res.changed) return;
      this.phaseRef = res.state;
      this.store.set({ phase: res.state });
      this.pushEvents(res.events);
    }
  }

  private async playAiLine(card: RoleCard, spoken: SpokenReply): Promise<void> {
    const voicedByMouth = this.router?.speak(card.id, spoken.content, spoken.result.stepfun_tts_instruction) ?? false;
    if (voicedByMouth || (!this.router && this.isRealtimeVoiceActive() && this.realtime)) {
      this.markRealtimeSpeaking(card.id);
      if (!voicedByMouth) this.realtime?.speak(spoken.content);
      this.armPlaybackFallback(card.id, spoken.content);
      return;
    }
    await this.playWithFallbackTts(card, spoken);
  }

  private async playWithFallbackTts(card: RoleCard, spoken: SpokenReply): Promise<void> {
    this.store.set({ speakingCharId: card.id });
    try {
      await this.voice?.speak(spoken.content, {
        voiceId: card.voice.voice_id,
        rate: card.voice.rate,
        emotion: spoken.result.emotion,
        instruction: spoken.result.stepfun_tts_instruction,
      });
    } finally {
      if (this.snap.speakingCharId === card.id) this.store.set({ speakingCharId: null });
    }
  }

  private endAiTurn(cardId: string, speakerKind: SpeakerKind, stale: boolean): void {
    this.generating.delete(cardId);
    this.store.set({ activeCharId: null, isGenerating: false, streamingText: '' });
    if (this.disposed) return;
    if (!stale && this.format === 'panel' && speakerKind === 'interviewer' && !this.finished) {
      this.handMicToUser();
      return;
    }
    this.scheduleNextTurn();
  }

  // ---------- 内部：用户发言 ----------

  private submitUserMessage(text: string, source: 'text' | 'realtime', confidence?: number): void {
    const trimmed = text.trim();
    if (!trimmed || this.finished || this.disposed) return;
    const sentAt = Date.now();
    this.addMessage(
      buildUserMessage({
        text: trimmed,
        sentAt,
        sessionStartAt: this.sessionStartAt,
        source,
        senderName: USER_INFO.name,
        confidence,
      }),
    );
    this.noteUserSpoke(trimmed, sentAt, source);
    this.maybeAdvanceKeyPoint(trimmed);
    this.scheduleNextTurn(userReplyDelayMs(trimmed) + USER_REPLY_EXTRA_MIN_MS + Math.random() * USER_REPLY_EXTRA_SPAN_MS);
  }

  private noteUserSpoke(text: string, sentAt: number, source: 'text' | 'realtime'): void {
    this.store.set(source === 'realtime' ? { awaitingUser: false, userSpeaking: false } : { awaitingUser: false });
    this.turn = registerSpeak(this.turn, 'user', sentAt);
    this.grantSpeakWindow('user', sentAt + estimateSpeechMs(text));
    if (this.format === 'panel' && currentPhase(this.phaseRef, this.phaseConfig).id === 'OPENING') {
      this.openingUserSpeechAt = sentAt;
    }
  }

  private recordUserBargeIn(interruptedCharId: string | null): void {
    const now = Date.now();
    this.turn = registerSpeak(this.turn, 'user', now);
    this.pushEvents([interruptEvent('user', interruptedCharId ?? 'all', this.elapsedAt(now), 'user_barge_in_realtime')]);
  }

  // ---------- 内部：Realtime ----------

  private async connectRouter(generation: number): Promise<RealtimeVoiceRouter> {
    const create = this.deps.createRealtimeClient ?? ((opts: RealtimeClientOptions) => RealtimeClient.create(opts));
    return RealtimeVoiceRouter.connect({
      speakers: collectVoiceSpeakers(this.format, this.deps.roles),
      createClient: create,
      createLanes: this.deps.createVoiceLanes,
      onMouthPlayback: (roleId, speaking) => this.onMouthPlayback(roleId, speaking),
      earEvents: {
        onVadStart: () => this.onUserVadStart(),
        onVadStop: () => this.onUserVadStop(),
        onUserTranscript: ({ text, isFinal }) => {
          if (isFinal) this.sendUserSpeech(text);
        },
        onError: (error) => console.error('Realtime 错误:', error.code, error.message),
        onClose: () => this.handleEarClosed(generation),
      },
    });
  }

  private attachRouter(router: RealtimeVoiceRouter, generation: number): void {
    if (this.disposed || generation !== this.realtimeGeneration) {
      router.dispose();
      if (this.disposed && !this.router) this.store.set({ realtimeStatus: 'fallback' });
      return;
    }
    this.router = router;
    this.realtime = router.ear;
    router.ear.setMuted(!this.snap.micOn);
    router.start();
    this.store.set({ realtimeStatus: 'active' });
  }

  private failRealtime(generation: number, err: unknown): void {
    if (generation !== this.realtimeGeneration) return;
    console.warn('Realtime 不可用，退回按键说话:', err instanceof Error ? err.message : err);
    this.router = null;
    this.realtime = null;
    this.store.set({ realtimeStatus: 'fallback' });
  }

  private handleEarClosed(generation: number): void {
    if (generation !== this.realtimeGeneration) return;
    const dying = this.router;
    this.router = null;
    this.realtime = null;
    this.realtimeSpeakingCharId = null;
    this.store.set({ realtimeStatus: 'fallback', userSpeaking: false, speakingCharId: null });
    dying?.dispose();
  }

  private onMouthPlayback(roleId: string | null, speaking: boolean): void {
    if (speaking && roleId) {
      this.markRealtimeSpeaking(roleId);
      return;
    }
    if (speaking || (roleId && this.realtimeSpeakingCharId !== roleId)) return;
    this.realtimeSpeakingCharId = null;
    this.store.set({ speakingCharId: null });
    this.closeSpeakWindowIfOwner(roleId);
  }

  // ---------- 内部：设备 / 落库 ----------

  private loadKeyPoints(): void {
    const points = this.format === 'panel' ? [] : extractKeyPoints(this.deps.state.topic);
    this.keyPoints.reset(points);
    this.store.set({ currentKeyPoint: this.keyPoints.current });
  }

  private startVoice(): void {
    const voice = new VoiceService();
    this.voice = voice;
    voice
      .init()
      .then((caps) => this.store.set({ caps }))
      .catch(() => this.store.set({ caps: voice.getCapabilities() }));
    voice.onSpeakingChange((speaking) => this.onFallbackTtsChange(speaking));
  }

  private onFallbackTtsChange(speaking: boolean): void {
    if (speaking) {
      if (this.snap.activeCharId) this.store.set({ speakingCharId: this.snap.activeCharId });
      return;
    }
    if (this.snap.speakingCharId) this.store.set({ speakingCharId: null });
    this.closeSpeakWindow();
  }

  private startCamera(): void {
    if (!this.deps.cameraEnabled || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: this.deps.facingMode }, audio: false })
      .then((stream) => this.adoptCameraStream(stream))
      .catch(() => this.store.set({ cameraOn: false }));
  }

  private adoptCameraStream(stream: MediaStream): void {
    if (this.disposed) {
      this.stopStream(stream);
      return;
    }
    this.stopCamera();
    this.userStream = stream;
    this.startVision(stream);
  }

  private startVision(stream: MediaStream): void {
    if (this.visionClient) return;
    if (!this.deps.consentSaveTranscript) return;
    const client = new VisionClient({ stream, sessionId: this.deps.sessionId, persist: true });
    this.visionClient = client;
    client.start().catch(() => undefined);
  }

  private async stopVision(): Promise<VisualFeatureRow[]> {
    const client = this.visionClient;
    this.visionClient = null;
    if (!client) return this.visualRows;
    const rows = await client.stop().catch(() => [] as VisualFeatureRow[]);
    this.visualRows = rows;
    return rows;
  }

  private persistEvents(events: GameEvent[]): void {
    if (this.deps.consentSaveTranscript && this.deps.sessionId) {
      this.saves.track(saveEvents(this.deps.sessionId, events));
    }
  }

  private persistMessage(msg: Message, round: number): void {
    if (this.deps.consentSaveTranscript && this.deps.sessionId) {
      this.saves.track(
        saveMessage({
          sessionId: this.deps.sessionId,
          speaker: msg.senderId === 'user' ? 'user' : msg.senderId,
          speakerType: msg.senderId === 'user' ? 'user' : 'ai',
          speakerId: msg.senderId,
          speakerName: msg.senderName,
          message: msg.content,
          round,
          startMs: msg.startMs,
          endMs: msg.endMs,
          confidence: msg.confidence,
          stepfunSegmentId: msg.stepfunSegmentId ?? null,
        }),
      );
    }
  }

  private maybeAdvanceKeyPoint(content: string): void {
    if (!this.keyPoints.advanceIfReady(content)) return;
    this.store.set({ currentKeyPoint: this.keyPoints.current });
  }

  private shouldAdvanceByKeyword(content: string): boolean {
    const progress = phaseProgress(this.phaseRef, Date.now(), this.phaseConfig);
    return this.keyPoints.shouldAdvancePhase(content, progress);
  }

  // ---------- 内部：小工具 ----------

  private get snap() {
    return this.store.getSnapshot();
  }

  private defaultSpeakerKind(card: RoleCard): SpeakerKind {
    if (this.format === 'panel') return 'interviewer';
    return isHostCard(card) ? 'host' : 'candidate';
  }

  private findRole(roleId: string): RoleCard | undefined {
    return this.deps.roles.find((card) => card.id === roleId);
  }

  private startRoleTurn(roleId: string): void {
    const card = this.findRole(roleId);
    if (card) void this.triggerAITurn(card);
  }

  private handMicToUser(now = Date.now()): void {
    this.store.set({ awaitingUser: true });
    this.turn = { ...this.turn, userCalledAt: now };
  }

  private grantSpeakWindow(owner: string, endsAt: number): void {
    this.speakEndsAt = endsAt;
    this.speakWindowOwner = owner;
  }

  private closeSpeakWindow(): void {
    this.speakEndsAt = 0;
    this.speakWindowOwner = null;
  }

  private closeSpeakWindowIfOwner(roleId: string | null): void {
    if (!roleId || this.speakWindowOwner === roleId) this.closeSpeakWindow();
  }

  private elapsedAt(now: number): number {
    return now - this.sessionStartAt;
  }

  private silenceMs(now: number): number {
    return Math.max(0, now - Math.max(this.speakEndsAt, this.sessionStartAt));
  }

  private withinBargeInHold(now: number): boolean {
    const sinceBarge = now - this.bargedInAt;
    return sinceBarge >= 0 && sinceBarge < BARGE_IN_HOLD_MS;
  }

  private shouldNudgeHost(now: number, phaseId: PhaseId): boolean {
    const quietFor = now - Math.max(this.speakEndsAt, this.bargedInAt, this.sessionStartAt);
    return (
      this.format === 'lgd' &&
      phaseId === 'FREE_DISCUSSION' &&
      this.generating.size === 0 &&
      !this.snap.activeCharId &&
      !this.scheduled &&
      !this.aiVoicePlaying() &&
      quietFor > HOST_NUDGE_SILENCE_MS &&
      now - this.lastHostNudgeAt > HOST_NUDGE_COOLDOWN_MS
    );
  }

  private userWaitingTooLong(now: number): boolean {
    return this.snap.awaitingUser && this.turn.userCalledAt !== null && now - this.turn.userCalledAt > USER_WAIT_LIMIT_MS;
  }

  private aiVoicePlaying(): boolean {
    if (this.router) return this.router.isAIPlaying();
    return Boolean(this.realtime?.isAIPlaying());
  }

  private markRealtimeSpeaking(charId: string): void {
    this.realtimeSpeakingCharId = charId;
    this.store.set({ speakingCharId: charId });
  }

  private stopRealtimeSpeech(): void {
    this.router?.stopAll();
    this.realtime?.stopAISpeech();
    this.realtimeSpeakingCharId = null;
  }

  private armPlaybackFallback(charId: string, text: string): void {
    const timer = setTimeout(() => {
      this.playbackTimers.delete(timer);
      if (this.realtimeSpeakingCharId === charId) {
        this.realtimeSpeakingCharId = null;
        this.store.set({ speakingCharId: null });
      }
      this.router?.disarm(charId);
    }, playbackFallbackMs(text));
    this.playbackTimers.add(timer);
  }

  private clearScheduledTurn(): void {
    if (!this.scheduled) return;
    clearTimeout(this.scheduled);
    this.scheduled = null;
  }

  private stopClock(): void {
    if (this.tickInterval) clearInterval(this.tickInterval);
    this.tickInterval = null;
    this.clearScheduledTurn();
  }

  private stopPlaybackTimers(): void {
    for (const timer of this.playbackTimers) clearTimeout(timer);
    this.playbackTimers.clear();
  }

  private releaseVoice(): void {
    this.voice?.dispose();
    this.voice = null;
  }

  private releaseRealtime(): void {
    const router = this.router;
    const realtime = this.realtime;
    this.router = null;
    this.realtime = null;
    if (router) router.dispose();
    else realtime?.dispose();
  }

  private stopCamera(): void {
    this.stopStream(this.userStream);
    this.userStream = null;
  }

  private stopStream(stream: MediaStream | null): void {
    stream?.getTracks().forEach((track) => track.stop());
  }

  private phaseConfigLength(): number {
    return getPhaseDefs(this.phaseConfig).length;
  }
}
