import assert from 'node:assert/strict';
import { read, render, contains, notContains, load, need } from './_helpers.mjs';

const area = 'setup';

export const checks = [
  {
    id: 'S1', area, title: '目标公司必填',
    async run() {
      const m = await load('engine/setupValidation.ts');
      need(m, 'validateSetup');
      const errs = m.validateSetup({ company: '', jobTitle: '产品经理', format: 'lgd' });
      assert.ok(errs.some((e) => e.field === 'company'), '空公司未报错');
      assert.deepEqual(m.validateSetup({ company: '字节跳动', jobTitle: '产品经理', format: 'lgd' }), []);
    },
  },
  {
    id: 'S2', area, title: '应聘岗位必填',
    async run() {
      const m = await load('engine/setupValidation.ts');
      const errs = m.validateSetup({ company: '字节跳动', jobTitle: '', format: 'lgd' });
      assert.ok(errs.some((e) => e.field === 'jobTitle'), '空岗位未报错');
    },
  },
  {
    id: 'S3', area, title: '无领导小组讨论四种题目类型',
    async run() {
      const t = await load('types.ts');
      need(t, 'LGD_TOPIC_TYPES');
      const labels = t.LGD_TOPIC_TYPES.map((x) => x.label);
      assert.deepEqual(labels, ['商业案例题', '开放辩论题', '资源争夺题', '优先级排序题']);
    },
  },
  {
    id: 'S4', area, title: 'LGD 由系统按岗位行业自动生成 3 位 AI 候选人',
    async run() {
      const m = await load('data/roleCards.ts');
      need(m, 'generateCandidates');
      const roles = m.generateCandidates({ company: '字节跳动', jobTitle: '产品经理', seed: 7 });
      assert.equal(roles.length, 3);
      assert.equal(new Set(roles.map((r) => r.id)).size, 3);
    },
  },
  {
    id: 'S5', area, title: 'LGD 面试官只有 1 位主持面试官',
    async run() {
      const m = await load('data/interviewers.ts');
      need(m, 'hostInterviewerFor');
      const host = m.hostInterviewerFor({ company: '字节跳动', jobTitle: '产品经理' });
      assert.equal(host.role, 'host');
      assert.ok(host.name && host.title);
    },
  },
  {
    id: 'S6', area, title: '主持面试官为目标公司目标岗位专业人士，manager 以上且 ≥3 年经验',
    async run() {
      const m = await load('data/interviewers.ts');
      const host = m.hostInterviewerFor({ company: '字节跳动', jobTitle: '产品经理' });
      assert.ok(['manager', 'director', 'vp', 'head'].includes(host.level), `级别不足: ${host.level}`);
      assert.ok(host.yearsExperience >= 3, `经验不足: ${host.yearsExperience}`);
      assert.ok(host.company === '字节跳动', '主持面试官应属于目标公司');
      assert.ok(Array.isArray(host.jobFamilies) && host.jobFamilies.length > 0, '缺少岗位族');
    },
  },
  {
    id: 'S7', area, title: '结构化单面面试官人数默认 2 位',
    async run() {
      const t = await load('types.ts');
      assert.equal(t.DEFAULT_PANEL_SIZE, 2);
    },
  },
  {
    id: 'S8', area, title: '6 个面试官形象可选',
    async run() {
      const m = await load('data/interviewers.ts');
      need(m, 'INTERVIEWERS');
      assert.equal(m.INTERVIEWERS.length, 6);
      const names = m.INTERVIEWERS.map((i) => i.archetype);
      assert.deepEqual(names, ['科技远见者', '产品传奇', '供应链大师', '加密先锋', '价值投资者', '投行分析师']);
    },
  },
  {
    id: 'S9', area, title: '岗位匹配：面试官角色与岗位结合，不差异过大',
    async run() {
      const m = await load('data/interviewers.ts');
      need(m, 'matchInterviewers');
      const tech = m.matchInterviewers({ jobTitle: '后端开发工程师', company: '字节跳动', count: 2 });
      assert.equal(tech.length, 2);
      assert.ok(tech.every((i) => i.jobFamilies.includes('tech')), `技术岗匹配到非技术面试官: ${tech.map((i) => i.archetype)}`);
      const fin = m.matchInterviewers({ jobTitle: '量化研究员', company: '中金公司', count: 2 });
      assert.ok(fin.every((i) => i.jobFamilies.includes('finance')), `金融岗匹配到非金融面试官: ${fin.map((i) => i.archetype)}`);
      const sc = m.matchInterviewers({ jobTitle: '供应链管培生', company: '宝洁', count: 2 });
      assert.ok(sc.some((i) => i.jobFamilies.includes('supply')), '供应链岗未匹配到供应链面试官');
    },
  },
  {
    id: 'S10', area, title: 'LGD 题目来自预设题库，四类各至少 3 题',
    async run() {
      const m = await load('data/topicBank.ts');
      need(m, 'TOPIC_BANK', 'pickTopic');
      for (const type of ['business_case', 'open_debate', 'resource_scramble', 'priority_rank']) {
        assert.ok(Array.isArray(m.TOPIC_BANK[type]), `题库缺少 ${type}`);
        assert.ok(m.TOPIC_BANK[type].length >= 3, `${type} 题目不足 3 条`);
        const t = m.pickTopic(type, 3);
        assert.ok(t.title && t.prompt, `${type} 题目结构不完整`);
      }
    },
  },
  {
    id: 'S11', area, title: 'LGD 点「AI 生成题目」流式生成到可编辑文本框',
    async run() {
      const SetupForm = await load('components/SetupForm.tsx');
      const html = render(SetupForm, { onStart() {}, initialFormat: 'lgd' });
      contains(html, 'AI 生成题目', '<textarea');
      const svc = await load('services/geminiService.ts');
      need(svc, 'generateTopicStream');
    },
  },
  {
    id: 'S12', area, title: '结构化单面配置页不生成题目（进房后即时生成）',
    async run() {
      const SetupForm = await load('components/SetupForm.tsx');
      const html = render(SetupForm, { onStart() {}, initialFormat: 'panel' });
      notContains(html, 'AI 生成题目');
      contains(html, '面试官');
    },
  },
  {
    id: 'S13', area, title: '单面题目基于自我介绍与目标岗位即时生成',
    async run() {
      const p = await load('api/_lib/prompts.ts');
      need(p, 'buildPanelQuestionPrompt');
      const prompt = p.buildPanelQuestionPrompt({
        company: '字节跳动', jobTitle: '产品经理',
        selfIntro: '我叫张三，本科计算机，做过两年增长产品实习。',
        phase: 'qa',
      });
      assert.ok(prompt.includes('字节跳动') && prompt.includes('产品经理'), 'prompt 未包含目标公司/岗位');
      assert.ok(prompt.includes('我叫张三'), 'prompt 未包含自我介绍原文');
    },
  },
  {
    id: 'S14', area, title: '单面采用 STAR 结构化面试',
    async run() {
      const p = await load('api/_lib/prompts.ts');
      const prompt = p.buildPanelQuestionPrompt({ company: 'A', jobTitle: 'B', selfIntro: 'C', phase: 'qa' });
      for (const k of ['STAR', '情境', '任务', '行动', '结果']) {
        assert.ok(prompt.includes(k), `STAR prompt 缺少 ${k}`);
      }
    },
  },
  {
    id: 'S15', area, title: 'AI 候选人学历本科及以上且层次有区别',
    async run() {
      const m = await load('data/roleCards.ts');
      for (let seed = 1; seed <= 40; seed++) {
        const roles = m.generateCandidates({ company: '字节跳动', jobTitle: '产品经理', seed });
        const levels = roles.map((r) => r.background.education);
        assert.ok(levels.every((l) => ['本科', '硕士', '博士'].includes(l)), `学历不合规: ${levels}`);
        assert.ok(new Set(levels).size >= 2, `学历层次无区别: ${levels}`);
      }
    },
  },
  {
    id: 'S16', area, title: 'AI 候选人专业方向互有差异',
    async run() {
      const m = await load('data/roleCards.ts');
      for (let seed = 1; seed <= 40; seed++) {
        const roles = m.generateCandidates({ company: '字节跳动', jobTitle: '产品经理', seed });
        const majors = roles.map((r) => r.background.major);
        assert.equal(new Set(majors).size, 3, `专业重复: ${majors}`);
      }
    },
  },
  {
    id: 'S17', area, title: 'AI 候选人具备与目标公司岗位匹配的实习经历',
    async run() {
      const m = await load('data/roleCards.ts');
      const roles = m.generateCandidates({ company: '字节跳动', jobTitle: '产品经理', seed: 11 });
      for (const r of roles) {
        assert.ok(r.background.internship && r.background.internship.length >= 4, '缺少实习经历');
        assert.ok(
          r.background.internship.includes('字节跳动') || r.background.internship.includes('产品'),
          `实习经历与目标不匹配: ${r.background.internship}`
        );
      }
    },
  },
  {
    id: 'S18', area, title: '3 位候选人背景信息互不相同',
    async run() {
      const m = await load('data/roleCards.ts');
      for (let seed = 1; seed <= 40; seed++) {
        const roles = m.generateCandidates({ company: '字节跳动', jobTitle: '产品经理', seed });
        const sigs = roles.map((r) => `${r.name}|${r.background.education}|${r.background.major}|${r.background.internship}`);
        assert.equal(new Set(sigs).size, 3, `背景重复: ${sigs}`);
      }
    },
  },
  {
    id: 'S19', area, title: '配置页有「开始设备检测」入口',
    async run() {
      const SetupForm = await load('components/SetupForm.tsx');
      const html = render(SetupForm, { onStart() {}, initialFormat: 'lgd' });
      contains(html, '开始设备检测');
    },
  },
];
