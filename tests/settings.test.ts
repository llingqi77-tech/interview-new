import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CONFIG_GROUPS,
  CONFIG_KEYS,
  configFilePath,
  getConfigEntries,
  isRuntimeConfigWritable,
  loadRuntimeConfigSync,
  maskValue,
  saveRuntimeConfig,
} from '../api/_lib/runtimeConfig.ts';
import settingsHandler from '../api/settings.ts';

/**
 * 设置页（/api/settings）—— 运行时配置覆盖层测试
 *
 * 重点：页面填的值必须真的进 process.env（否则 handler 读不到，功能等于没做），
 * 清除必须回落到 .env.local 的基线值而不是把变量删掉，
 * 未授权请求不能拿到任何密钥片段。
 */

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'lgd-settings-'));
process.env.RUNTIME_CONFIG_FILE = path.join(tmpDir, 'runtime-config.json');

function mockRes() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      return res;
    },
    send(data: unknown) {
      res.body = data;
      return res;
    },
    setHeader(key: string, value: string) {
      res.headers[key] = value;
      return res;
    },
  };
  return res;
}

function mockReq(overrides: Record<string, unknown> = {}) {
  return {
    method: 'GET',
    query: {},
    headers: {},
    url: '/api/settings',
    body: undefined,
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as any;
}

test('配置分组：key 唯一且全部大写', () => {
  assert.equal(new Set(CONFIG_KEYS).size, CONFIG_KEYS.length, 'CONFIG_KEYS 有重复项');
  for (const key of CONFIG_KEYS) {
    assert.match(key, /^[A-Z][A-Z0-9_]*$/, `${key} 不是合法环境变量名`);
  }
  assert.ok(CONFIG_GROUPS.length >= 4);
  for (const group of CONFIG_GROUPS) {
    assert.ok(group.fields.length > 0, `${group.id} 分组为空`);
  }
});

test('maskValue：短值全掩码，长值保留首尾四位', () => {
  assert.equal(maskValue(''), '');
  assert.equal(maskValue('short'), '••••••');
  assert.equal(maskValue('sk-1234567890abcdef'), 'sk-1••••••cdef');
  assert.ok(!maskValue('sk-1234567890abcdef').includes('234567890'));
});

test('落盘路径可被 RUNTIME_CONFIG_FILE 覆盖', () => {
  assert.equal(configFilePath(), process.env.RUNTIME_CONFIG_FILE);
});

test('保存：写入文件并立即覆盖 process.env', async () => {
  process.env.DEEPSEEK_API_KEY = 'sk-base-0000000000';
  process.env.DEEPSEEK_BASE_URL = 'https://base.example/v1';
  loadRuntimeConfigSync();

  const result = await saveRuntimeConfig({ DEEPSEEK_API_KEY: 'sk-page-1111111111' });
  assert.deepEqual(result.changed, ['DEEPSEEK_API_KEY']);
  assert.equal(process.env.DEEPSEEK_API_KEY, 'sk-page-1111111111', 'process.env 未被覆盖');

  const onDisk = JSON.parse(readFileSync(configFilePath(), 'utf8'));
  assert.equal(onDisk.DEEPSEEK_API_KEY, 'sk-page-1111111111');

  const entries = getConfigEntries({ reveal: true });
  assert.equal(entries.DEEPSEEK_API_KEY.source, 'runtime');
  assert.equal(entries.DEEPSEEK_API_KEY.preview, 'sk-p••••••1111');
  assert.equal(entries.DEEPSEEK_BASE_URL.source, 'env');
});

test('清除：删掉页面配置并回落到基线环境变量', async () => {
  const result = await saveRuntimeConfig({ DEEPSEEK_API_KEY: '' });
  assert.deepEqual(result.changed, ['DEEPSEEK_API_KEY']);
  assert.equal(process.env.DEEPSEEK_API_KEY, 'sk-base-0000000000', '未回落到基线值');

  const onDisk = JSON.parse(readFileSync(configFilePath(), 'utf8'));
  assert.equal(onDisk.DEEPSEEK_API_KEY, undefined);

  const entries = getConfigEntries({ reveal: true });
  assert.equal(entries.DEEPSEEK_API_KEY.source, 'env');
});

test('白名单：未知 key 被忽略，不写盘也不进 process.env', async () => {
  const result = await saveRuntimeConfig({ NOT_A_REAL_KEY: 'x', DEEPSEEK_MODEL: 'kimi-k3' });
  assert.deepEqual(result.changed, ['DEEPSEEK_MODEL']);
  assert.equal(process.env.NOT_A_REAL_KEY, undefined);

  const onDisk = JSON.parse(readFileSync(configFilePath(), 'utf8'));
  assert.equal(onDisk.NOT_A_REAL_KEY, undefined);
  assert.equal(onDisk.DEEPSEEK_MODEL, 'kimi-k3');
});

test('无变化时不重复写盘', async () => {
  const result = await saveRuntimeConfig({ DEEPSEEK_MODEL: 'kimi-k3' });
  assert.deepEqual(result.changed, []);
});

test('未授权：不回显任何密钥片段', () => {
  const entries = getConfigEntries({ reveal: false });
  for (const entry of Object.values(entries)) {
    assert.equal(entry.preview, null, `${entry.key} 在未授权时泄露了 preview`);
  }
});

test('GET /api/settings：返回分组与状态', async () => {
  const res = mockRes();
  await settingsHandler(mockReq(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.writable, true);
  assert.equal(res.body.authorized, true);
  assert.ok(Array.isArray(res.body.groups));
  assert.equal(res.body.groups.length, CONFIG_GROUPS.length);
  assert.equal(res.body.entries.DEEPSEEK_MODEL.configured, true);
});

test('POST /api/settings：保存后状态变为 runtime', async () => {
  const res = mockRes();
  await settingsHandler(
    mockReq({
      method: 'POST',
      body: { values: { STEPFUN_API_KEY: 'sf-page-2222222222' } },
    }),
    res
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.changed, ['STEPFUN_API_KEY']);
  assert.equal(res.body.entries.STEPFUN_API_KEY.source, 'runtime');
  assert.equal(process.env.STEPFUN_API_KEY, 'sf-page-2222222222');
});

test('POST /api/settings：body.values 缺失 → 400', async () => {
  const res = mockRes();
  await settingsHandler(mockReq({ method: 'POST', body: {} }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'BAD_REQUEST');
});

test('写保护：公网来源且未设令牌 → 403', async () => {
  const res = mockRes();
  await settingsHandler(
    mockReq({
      method: 'POST',
      body: { values: { DEEPSEEK_MODEL: 'hijacked' } },
      socket: { remoteAddress: '8.8.8.8' },
    }),
    res
  );
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'FORBIDDEN');
  assert.notEqual(process.env.DEEPSEEK_MODEL, 'hijacked');
});

test('写保护：设了 SETTINGS_ADMIN_TOKEN 后必须带正确令牌', async () => {
  process.env.SETTINGS_ADMIN_TOKEN = 'tok-abc';
  try {
    const denied = mockRes();
    await settingsHandler(
      mockReq({ method: 'POST', body: { values: { DEEPSEEK_MODEL: 'nope' } } }),
      denied
    );
    assert.equal(denied.statusCode, 403);

    const allowed = mockRes();
    await settingsHandler(
      mockReq({
        method: 'POST',
        headers: { 'x-admin-token': 'tok-abc' },
        body: { values: { DEEPSEEK_MODEL: 'kimi-k3' } },
      }),
      allowed
    );
    assert.equal(allowed.statusCode, 200);
  } finally {
    delete process.env.SETTINGS_ADMIN_TOKEN;
  }
});

test('Vercel 环境：只读，写入返回 501', async () => {
  process.env.VERCEL = '1';
  try {
    assert.equal(isRuntimeConfigWritable().writable, false);
    const res = mockRes();
    await settingsHandler(mockReq({ method: 'POST', body: { values: { DEEPSEEK_MODEL: 'x' } } }), res);
    assert.equal(res.statusCode, 501);
    assert.equal(res.body.error, 'READ_ONLY');
  } finally {
    delete process.env.VERCEL;
  }
});

test('损坏的配置文件：按空配置处理，不抛错', () => {
  writeFileSync(configFilePath(), '{ this is not json', 'utf8');
  const entries = getConfigEntries({ reveal: true });
  assert.equal(entries.DEEPSEEK_MODEL.source, 'env');
});

test('清理临时目录', () => {
  rmSync(tmpDir, { recursive: true, force: true });
});
