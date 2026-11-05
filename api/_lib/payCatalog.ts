/**
 * 商品目录（支付通道用）
 *
 * 你只需要改这一个文件里的 DEFAULT_CATALOG 就能改商品和价格。
 * 也可以在环境变量 ALIPAY_PAY_CATALOG 里放一段 JSON 覆盖（不用改代码、不用重新构建）：
 *
 *   ALIPAY_PAY_CATALOG=[{"sku":"p10","subject":"群面练习 10 场","amount":"9.90"}]
 *
 * 规则：
 *   - sku      唯一标识，只能用小写字母/数字/下划线/短横线，最长 32
 *   - subject  支付宝收银台显示的标题，不能含 / = & 等特殊字符，最长 256
 *   - amount   「元」为单位、两位小数的字符串，范围 [0.01, 100000000]
 *   - 金额一律用字符串，禁止用浮点数（0.1 + 0.2 !== 0.3）
 */

export interface PaySku {
  sku: string;
  subject: string;
  amount: string;
  description?: string;
}

/** ← 改这里：商品与价格 */
export const DEFAULT_CATALOG: PaySku[] = [
  {
    sku: 'practice_5',
    subject: '群面模拟 5 场',
    amount: '9.90',
    description: '5 场完整群面练习，含 AI 报告',
  },
  {
    sku: 'practice_20',
    subject: '群面模拟 20 场',
    amount: '29.90',
    description: '20 场完整群面练习，含 AI 报告',
  },
  {
    sku: 'practice_50',
    subject: '群面模拟 50 场',
    amount: '59.90',
    description: '50 场完整群面练习，含 AI 报告',
  },
];

const SKU_RE = /^[a-z0-9_-]{1,32}$/;
const AMOUNT_RE = /^\d+(?:\.\d{1,2})?$/;

function validate(sku: PaySku): PaySku {
  if (!SKU_RE.test(sku.sku)) {
    throw new Error(`商品 sku 非法（只允许小写字母/数字/下划线/短横线，≤32）：${sku.sku}`);
  }
  if (!sku.subject || sku.subject.length > 256) {
    throw new Error(`商品 subject 非法（1-256 字符）：${sku.sku}`);
  }
  if (!AMOUNT_RE.test(sku.amount)) {
    throw new Error(`商品 amount 非法（元，两位小数）：${sku.sku} = ${sku.amount}`);
  }
  const value = Number(sku.amount);
  if (!(value >= 0.01 && value <= 100_000_000)) {
    throw new Error(`商品 amount 超出范围 [0.01, 100000000]：${sku.sku} = ${sku.amount}`);
  }
  return {
    sku: sku.sku,
    subject: sku.subject,
    amount: value.toFixed(2),
    ...(sku.description ? { description: sku.description } : {}),
  };
}

let cached: PaySku[] | null = null;

/** 当前生效的商品目录（环境变量优先，其次 DEFAULT_CATALOG） */
export function getCatalog(): PaySku[] {
  if (cached) return cached;

  const raw = (process.env.ALIPAY_PAY_CATALOG ?? '').trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as PaySku[];
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('ALIPAY_PAY_CATALOG 必须是非空数组');
      }
      cached = parsed.map(validate);
      return cached;
    } catch (error) {
      // 配置写错时回退默认目录，不让整个支付通道 500
      console.error('[payCatalog] ALIPAY_PAY_CATALOG 解析失败，回退默认目录：', error);
    }
  }

  cached = DEFAULT_CATALOG.map(validate);
  return cached;
}

export function findSku(sku: string): PaySku | null {
  return getCatalog().find((item) => item.sku === sku) ?? null;
}

/** 测试用：清掉缓存 */
export function resetCatalogCache(): void {
  cached = null;
}
