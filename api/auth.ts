import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Pool } from 'pg';

const pool = new Pool({
  host: 'pgm-uf6132jdu6cx965j3o.pg.rds.aliyuncs.com',
  port: 5432,
  user: 'dongluyao1',
  password: 'dongluyao123456@',
  database: 'interview_db',
});

// 简单哈希（生产环境请用 bcrypt）
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

export default async function handler(
  request: VercelRequest,
  response: VercelResponse
) {
  try {
    // 注册
    if (request.method === 'POST' && request.body.action === 'register') {
      const { username, password } = request.body;
      
      // 检查用户名是否已存在
      const check = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
      if (check.rows.length > 0) {
        return response.status(400).json({ error: '用户名已存在' });
      }
      
      const hashedPassword = simpleHash(password);
      const result = await pool.query(
        'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id, username',
        [username, hashedPassword]
      );
      
      return response.status(200).json({ user: result.rows[0] });
    }
    
    // 登录
    if (request.method === 'POST' && request.body.action === 'login') {
      const { username, password } = request.body;
      
      const hashedPassword = simpleHash(password);
      const result = await pool.query(
        'SELECT id, username FROM users WHERE username = $1 AND password = $2',
        [username, hashedPassword]
      );
      
      if (result.rows.length === 0) {
        return response.status(401).json({ error: '用户名或密码错误' });
      }
      
      return response.status(200).json({ user: result.rows[0] });
    }
    
    // 获取当前用户信息
    if (request.method === 'GET' && request.query.user_id) {
      const result = await pool.query(
        'SELECT id, username, created_at FROM users WHERE id = $1',
        [Number(request.query.user_id)]
      );
      
      if (result.rows.length === 0) {
        return response.status(404).json({ error: '用户不存在' });
      }
      
      return response.status(200).json(result.rows[0]);
    }
    
    return response.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error('Error:', error);
    return response.status(500).json({ error: error.message });
  }
}
