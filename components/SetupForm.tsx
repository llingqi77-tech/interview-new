import React, { useMemo, useState } from 'react';
import type { InterviewFormat, InterviewerCard, JobFamily, LgdTopicType, RoleCard } from '../types';
import { LGD_TOPIC_TYPES } from '../types';
import { pickTopic } from '../data/topicBank';
import { INTERVIEWERS, inferJobFamily, matchInterviewers } from '../data/interviewers';
import { generateCandidates } from '../data/roleCards';
import { validateSetup } from '../engine/setupValidation';

/** 练习配置：选择题型后进入设备检测；题目在房间审题阶段揭示。 */

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
  const [panelSize, setPanelSize] = useState<2 | 3>(2);
  const [selected, setSelected] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  const jobFamily = useMemo(() => inferJobFamily(jobTitle), [jobTitle]);
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

  const toggleInterviewer = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= panelSize) return [...prev.slice(1), id];
      return [...prev, id];
    });
  };

  const handleStart = () => {
    const entry = pickTopic(topicType);
    const errs = validateSetup({
      company,
      jobTitle,
      format,
      topicType,
      topic: format === 'lgd' ? entry.prompt : undefined,
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
      topic: format === 'lgd' ? entry.prompt : '',
      keyPoints: format === 'lgd' ? entry.keyPoints : [],
      roles: format === 'lgd' ? candidates : [],
      interviewers: format === 'panel' ? effectiveInterviewers : [],
      panelSize,
      jobFamily,
    });
  };

  return (
    <div className="setup-page">
      <header className="setup-heading"><h1>开始一场面试练习</h1></header>
      <div className="setup-fields">
        <label><span className="field-label">目标公司 *</span><input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="例如：字节跳动" className="glass-input w-full" autoComplete="organization" /></label>
        <label><span className="field-label">应聘岗位 *</span><input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="例如：产品经理" className="glass-input w-full" /></label>
      </div>
      <section className="setup-section">
        <h2>面试模式</h2>
        <div className="mode-options">
          {([
            { id: 'lgd', label: '无领导小组讨论', hint: '与 3 位 AI 候选人讨论，由主持面试官控场。' },
            { id: 'panel', label: '结构化单面', hint: '2 或 3 位面试官轮流提问，按岗位深入追问。' },
          ] as const).map((m) => (
            <button key={m.id} type="button" onClick={() => setFormat(m.id)} aria-pressed={format === m.id} data-active={format === m.id} className="mode-option">
              <span className="mode-title">{m.label}</span><span className="mode-hint">{m.hint}</span><span className="choice-dot" aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>
      {format === 'lgd' ? (
        <fieldset className="setup-section topic-section">
          <legend>选择题型</legend>
          <div className="topic-radios">
            {LGD_TOPIC_TYPES.map((t) => (
              <label key={t.id} className="topic-radio"><input type="radio" name="topic-type" value={t.id} checked={topicType === t.id} onChange={() => setTopicType(t.id)} /><span>{t.label}</span></label>
            ))}
          </div>
        </fieldset>
      ) : (
        <section className="setup-section">
          <h2>选择面试官</h2>
          <div className="panel-tools"><span>面试官人数</span>{[2, 3].map((n) => (
            <button key={n} type="button" onClick={() => {setPanelSize(n as 2 | 3);setSelected([]);}} aria-pressed={panelSize === n} data-active={panelSize === n} className="glass-btn">{n} 位</button>
          ))}<button type="button" onClick={() => setSelected(matched.map((i) => i.id))} className="glass-btn panel-match">岗位匹配</button></div>
          <div className="persona-grid">{INTERVIEWERS.map((i) => {
            const active = effectiveInterviewers.some((x) => x.id === i.id);
            return <button key={i.id} type="button" onClick={() => toggleInterviewer(i.id)} aria-pressed={active} data-active={active} className="persona-option">
              <span className="persona-avatar" aria-hidden="true">{i.name.slice(0,1)}</span><strong>{i.name}</strong><span>{i.title}</span><small>{i.archetype} · {i.yearsExperience} 年经验</small><span className="persona-check" aria-hidden="true">{active ? '✓' : ''}</span>
            </button>;
          })}</div>
        </section>
      )}
      {errors.length > 0 && <ul className="setup-errors" role="alert">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      <div className="setup-submit"><button type="button" onClick={handleStart} className="glass-btn-primary">进入面试房间 <span aria-hidden="true">↗</span></button></div>
    </div>
  );
};

export default SetupForm;
