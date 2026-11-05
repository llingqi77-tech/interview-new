import React, { useMemo, useState } from 'react';
import type { InterviewFormat, InterviewerCard, JobFamily, LgdTopicType, RoleCard } from '../types';
import { LGD_TOPIC_TYPES } from '../types';
import { TOPIC_BANK, pickTopic } from '../data/topicBank';
import { INTERVIEWERS, inferJobFamily, matchInterviewers } from '../data/interviewers';
import { generateCandidates } from '../data/roleCards';
import { validateSetup } from '../engine/setupValidation';
import { generateTopicStream } from '../services/geminiService';

/**
 * 练习配置（PRD 2. 开始练习页）
 *
 * 群面：公司/岗位 → 题型（四选一）→ 题库选题 → 可「AI 生成题目」流式改写 → 可编辑文本框
 * 单面：公司/岗位 → 面试官人数（默认 2）→ 从 6 个形象里挑 → 支持「岗位匹配」
 * 两种模式都走「开始设备检测」进入下一环节。
 */

export interface SetupParams {
  company: string;
  jobTitle: string;
  format: InterviewFormat;
  topicType: LgdTopicType;
  topic: string;
  keyPoints: string[];
  roles: RoleCard[];
  interviewers: InterviewerCard[];
  panelSize: 2 | 3;
  jobFamily: JobFamily;
}

export interface SetupFormProps {
  onStart: (params: SetupParams) => void;
  initialFormat?: InterviewFormat;
}

const SetupForm: React.FC<SetupFormProps> = ({ onStart, initialFormat = 'lgd' }) => {
  const [company, setCompany] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [format, setFormat] = useState<InterviewFormat>(initialFormat);
  const [topicType, setTopicType] = useState<LgdTopicType>('business_case');
  const [topicIndex, setTopicIndex] = useState(0);
  const [topic, setTopic] = useState('');
  const [keyPoints, setKeyPoints] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [panelSize, setPanelSize] = useState<2 | 3>(2);
  const [selected, setSelected] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  const jobFamily = useMemo(() => inferJobFamily(jobTitle), [jobTitle]);
  const bank = TOPIC_BANK[topicType];
  const candidates = useMemo(
    () => (company && jobTitle ? generateCandidates({ company, jobTitle, seed: 20261105 }) : []),
    [company, jobTitle]
  );

  const matched = useMemo(
    () => matchInterviewers({ jobTitle: jobTitle || '通用岗位', company, count: panelSize }),
    [jobTitle, company, panelSize]
  );

  const effectiveInterviewers = useMemo(() => {
    const picked = selected
      .map((id) => INTERVIEWERS.find((i) => i.id === id))
      .filter((i): i is InterviewerCard => Boolean(i));
    const list = picked.length === panelSize ? picked : matched;
    return list.map((i, idx) => ({ ...i, role: idx === 0 ? ('lead' as const) : ('support' as const) }));
  }, [selected, panelSize, matched]);

  const applyBankTopic = (index: number) => {
    const entry = bank[index] ?? bank[0];
    setTopicIndex(index);
    setTopic(entry.prompt);
    setKeyPoints(entry.keyPoints);
  };

  const handleGenerate = async () => {
    if (!company.trim() || !jobTitle.trim()) {
      setErrors(['请先填写目标公司与应聘岗位']);
      return;
    }
    setErrors([]);
    setGenerating(true);
    const seed = pickTopic(topicType, topicIndex);
    setTopic('');
    try {
      await generateTopicStream(
        company,
        jobTitle,
        (chunk) => setTopic((prev) => prev + chunk),
        { format: 'lgd', topicType, seed: seed.prompt }
      );
      setKeyPoints(seed.keyPoints);
    } catch {
      setTopic(seed.prompt);
      setKeyPoints(seed.keyPoints);
    } finally {
      setGenerating(false);
    }
  };

  const toggleInterviewer = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= panelSize) return [...prev.slice(1), id];
      return [...prev, id];
    });
  };

  const handleStart = () => {
    const errs = validateSetup({
      company,
      jobTitle,
      format,
      topicType,
      topic: format === 'lgd' ? topic : undefined,
      interviewerIds: format === 'panel' ? effectiveInterviewers.map((i) => i.id) : undefined,
      panelSize,
    });
    if (errs.length > 0) {
      setErrors(errs.map((e) => e.message));
      return;
    }
    setErrors([]);
    onStart({
      company: company.trim(),
      jobTitle: jobTitle.trim(),
      format,
      topicType,
      topic: format === 'lgd' ? topic : '',
      keyPoints: format === 'lgd' ? keyPoints : [],
      roles: format === 'lgd' ? candidates : [],
      interviewers: format === 'panel' ? effectiveInterviewers : [],
      panelSize,
      jobFamily,
    });
  };

  return (
    <div className="glass-panel p-6 md:p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-white">开始一场面试练习</h1>
        <p className="text-sm text-white/55 mt-1">
          填写目标公司与应聘岗位，选择面试模式，AI 会按岗位生成题目与角色。
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="text-sm text-white/70">目标公司 *</span>
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="例如：字节跳动"
            className="glass-input mt-1 w-full px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="text-sm text-white/70">应聘岗位 *</span>
          <input
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            placeholder="例如：产品经理"
            className="glass-input mt-1 w-full px-3 py-2"
          />
        </label>
      </section>

      <section>
        <span className="text-sm text-white/70">面试模式</span>
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          {(
            [
              { id: 'lgd', label: '无领导小组讨论', hint: '1 位主持面试官 + 3 位 AI 候选人，倒计时四阶段' },
              { id: 'panel', label: '结构化单面', hint: '2 位面试官轮流提问，STAR 结构化追问' },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setFormat(m.id)}
              data-active={format === m.id}
              className={`glass-btn text-left px-4 py-3 ${format === m.id ? 'ring-1 ring-cyan-300/60' : ''}`}
            >
              <div className="font-semibold text-white">{m.label}</div>
              <div className="text-xs text-white/50 mt-1">{m.hint}</div>
            </button>
          ))}
        </div>
      </section>

      {format === 'lgd' ? (
        <section className="space-y-3">
          <div>
            <span className="text-sm text-white/70">题目类型</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {LGD_TOPIC_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setTopicType(t.id);
                    setTopicIndex(0);
                    setTopic('');
                    setKeyPoints([]);
                  }}
                  data-active={topicType === t.id}
                  className={`glass-chip px-3 py-1.5 text-xs ${topicType === t.id ? 'ring-1 ring-cyan-300/60' : ''}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={topicIndex}
              onChange={(e) => applyBankTopic(Number(e.target.value))}
              className="glass-input px-3 py-2 text-sm"
            >
              {bank.map((entry, i) => (
                <option key={entry.id} value={i}>
                  {entry.title}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => applyBankTopic(topicIndex)} className="glass-btn text-sm px-3 py-2">
              从题库调用
            </button>
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={generating}
              className="glass-btn-primary text-sm px-3 py-2 disabled:opacity-50"
            >
              {generating ? '生成中…' : 'AI 生成题目'}
            </button>
          </div>

          <label className="block">
            <span className="text-sm text-white/70">讨论题目（可编辑）</span>
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              rows={5}
              placeholder="从题库调用，或点「AI 生成题目」流式生成后在这里修改"
              className="glass-input mt-1 w-full px-3 py-2 text-sm leading-relaxed"
            />
          </label>

          {candidates.length > 0 && (
            <div>
              <span className="text-sm text-white/70">本场 AI 候选人（按岗位自动生成）</span>
              <div className="mt-2 grid gap-2 md:grid-cols-3">
                {candidates.map((c) => (
                  <div key={c.id} className="glass-panel p-3 text-xs text-white/70">
                    <div className="font-semibold text-white">{c.name}</div>
                    <div className="mt-1">
                      {c.background?.education} · {c.background?.major}
                    </div>
                    <div className="text-white/45 mt-1">{c.background?.internship}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      ) : (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-white/70">面试官人数</span>
            {[2, 3].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  setPanelSize(n as 2 | 3);
                  setSelected([]);
                }}
                data-active={panelSize === n}
                className={`glass-chip px-3 py-1.5 text-xs ${panelSize === n ? 'ring-1 ring-cyan-300/60' : ''}`}
              >
                {n} 位
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSelected(matched.map((i) => i.id))}
              className="glass-btn text-sm px-3 py-1.5"
            >
              岗位匹配
            </button>
            <span className="text-xs text-white/40">当前岗位族：{jobFamily}</span>
          </div>

          <div className="grid gap-2 md:grid-cols-3">
            {INTERVIEWERS.map((i) => {
              const active = effectiveInterviewers.some((x) => x.id === i.id);
              return (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => toggleInterviewer(i.id)}
                  data-active={active}
                  className={`glass-panel p-3 text-left text-xs ${active ? 'ring-1 ring-cyan-300/60' : ''}`}
                >
                  <div className="font-semibold text-white">{i.archetype}</div>
                  <div className="text-white/60 mt-1">
                    {i.name} · {i.title}
                  </div>
                  <div className="text-white/40 mt-1">
                    {i.yearsExperience} 年经验 · {i.jobFamilies.join('/')}
                  </div>
                </button>
              );
            })}
          </div>

          <p className="text-xs text-white/45">
            面试题目将在进入房间后，根据你的自我介绍与目标岗位即时生成（STAR 结构化面试）。
          </p>
        </section>
      )}

      {errors.length > 0 && (
        <ul className="text-sm text-red-300 space-y-1">
          {errors.map((e) => (
            <li key={e}>· {e}</li>
          ))}
        </ul>
      )}

      <div className="flex justify-end">
        <button type="button" onClick={handleStart} className="glass-btn-primary px-6 py-2.5">
          开始设备检测
        </button>
      </div>
    </div>
  );
};

export default SetupForm;
