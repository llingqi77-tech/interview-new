import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AVATAR_PRESETS } from '../data/avatars.ts';
import { ROLE_CARDS } from '../data/roleCards.ts';
import { HOST_CARD, HOST_CARD_ID } from '../data/interviewerCards.ts';
import {
  AVATAR_3D_CHARACTERS,
  buildAvatarPrompt,
  findAvatar3dCharacter,
  STYLE_BASELINE,
} from '../data/avatar3dCharacters.ts';

/**
 * 角色 3D 资产（文生 3D）的一致性测试
 *
 * 守的是「角色总数 = 13」这个事实：
 *   12 张候选人角色卡 + 1 张主持面试官卡 = 13 个角色，
 *   每个角色在 data/avatars.ts 里对应唯一 AvatarPreset（形象不重复），
 *   每个角色在 data/avatar3dCharacters.ts 里对应唯一一条 3D 美术设定。
 * 少一个 / 多一个 / 撞号，这里都会红。
 */

test('3D 角色数 = 13（12 候选人卡 + 1 主持面试官卡）', () => {
  assert.equal(ROLE_CARDS.length, 12);
  assert.equal(AVATAR_3D_CHARACTERS.length, 13);
  assert.equal(AVATAR_3D_CHARACTERS.length, ROLE_CARDS.length + 1);
});

test('每个 3D 角色的 id 都对应一个真实存在的 AvatarPreset', () => {
  const presetIds = new Set(AVATAR_PRESETS.map((a) => a.id));
  for (const c of AVATAR_3D_CHARACTERS) {
    assert.ok(presetIds.has(c.id), `没有对应的预设形象：${c.id}`);
  }
});

test('12 张候选人卡与主持卡的形象各自有一个 3D 角色', () => {
  const cardPresetIds = ROLE_CARDS.map((c) => c.avatar.preset_id);
  assert.equal(cardPresetIds.length, 12);
  assert.equal(new Set(cardPresetIds).size, 12, '候选人卡的形象不能重复');
  assert.equal(HOST_CARD.avatar.preset_id, 'host_01');
  assert.equal(HOST_CARD.id, HOST_CARD_ID);

  const modelIds = new Set<string>(AVATAR_3D_CHARACTERS.map((c) => c.id));
  for (const id of [...cardPresetIds, HOST_CARD.avatar.preset_id]) {
    assert.ok(modelIds.has(id), `角色卡 ${id} 没有 3D 模型设定`);
  }
  assert.equal(modelIds.size, 13);
});

test('3D 角色的 roleCardId 与角色卡对得上', () => {
  const cardByPreset = new Map(ROLE_CARDS.map((c) => [c.avatar.preset_id, c]));
  for (const c of AVATAR_3D_CHARACTERS) {
    if (c.id === HOST_CARD.avatar.preset_id) {
      assert.equal(c.roleCardId, HOST_CARD_ID);
      continue;
    }
    const card = cardByPreset.get(c.id);
    assert.ok(card, `找不到形象为 ${c.id} 的角色卡`);
    assert.equal(c.roleCardId, card.id);
    // 名字对齐的是「预设形象名」（data/avatars.ts），不是角色卡名：两者有 2 处不同
    // （远见者 vs 科技远见者、传奇产品人 vs 产品传奇）
    const preset = AVATAR_PRESETS.find((p) => p.id === c.id);
    assert.ok(preset, `找不到预设形象 ${c.id}`);
    assert.equal(c.name, preset.name, `${c.id} 的名字要与预设形象一致`);
    assert.deepEqual(c.traits, card.persona.traits, `${c.id} 的性格标签要与角色卡一致`);
  }
});

test('提示词是英文、结构完整、带风格基线与内容约束', () => {
  for (const c of AVATAR_3D_CHARACTERS) {
    const prompt = buildAvatarPrompt(c);
    assert.ok(prompt.length > 200, `${c.id} 提示词太短`);
    assert.ok(prompt.includes(STYLE_BASELINE), `${c.id} 提示词缺风格基线`);
    assert.ok(prompt.includes('single character only'), `${c.id} 提示词缺「单角色」约束`);
    assert.ok(prompt.includes('no text'), `${c.id} 提示词缺「无文字」约束`);
    // 提示词只给模型看，必须是 ASCII（Rodin 对中文还原很差）
    // eslint-disable-next-line no-control-regex
    assert.ok(/^[\x20-\x7E,]+$/.test(prompt), `${c.id} 提示词含非 ASCII 字符`);
  }
});

test('按 id 能查到角色', () => {
  assert.equal(findAvatar3dCharacter('host_01')?.name, '主持面试官');
  assert.equal(findAvatar3dCharacter('nope_01'), undefined);
});
