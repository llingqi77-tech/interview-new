import { Pool } from 'pg';

/**
 * 数据库连接（PRD D2 修复）
 * 凭据只从环境变量 DATABASE_URL 读取；代码与 git 历史中不再保存任何明文凭据。
 * 迁移后 schema 见 db/migration-v0.7.sql。
 */

let pool: Pool | null = null;

function getConnectionString(): string | undefined {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  return url && url.trim() ? url.trim() : undefined;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(getConnectionString());
}

export function getPool(): Pool {
  const connectionString = getConnectionString();
  if (!connectionString) {
    throw new Error('DATABASE_URL 未配置（D2：禁止硬编码数据库凭据）');
  }
  if (!pool) {
    const sslDisabled = /sslmode=disable/i.test(connectionString);
    pool = new Pool({
      connectionString,
      ...(sslDisabled ? {} : { ssl: { rejectUnauthorized: false } }),
      // serverless 每函数实例各持一个 pool：max 压低 + 建议生产挂 pgbouncer（transaction 模式）
      // 单容器部署时整进程只有一个 pool，max:3 会让并发 >3 的查询 5s 后直接超时，
      // 用 DB_POOL_MAX 覆盖（ECS 容器建议 10；serverless 保持 3 并挂连接池代理）
      max: Number(process.env.DB_POOL_MAX ?? 3),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
}

/** 测试注入：允许测试替换连接池（不触真实数据库） */
/** 测试注入：允许测试替换连接池（不触真实数据库） */
export function setPoolForTesting(mock: Pool | null): void {
  pool = mock;
}

/** 运行时配置变更后重建连接池（DATABASE_URL / DB_POOL_MAX 改了，旧池必须丢弃） */
export async function resetPool(): Promise<void> {
  const current = pool;
  pool = null;
  if (!current) return;
  try {
    await current.end();
  } catch {
    // 关闭旧池失败不影响新配置生效
  }
}

