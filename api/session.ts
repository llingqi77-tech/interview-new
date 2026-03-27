import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Pool } from 'pg';

const pool = new Pool({
  host: 'pgm-uf6132jdu6cx965j3o.pg.rds.aliyuncs.com',
  port: 5432,
  user: 'dongluyao1',
  password: 'dongluyao123456@',
  database: 'interview_db',
});

export default async function handler(
  request: VercelRequest,
  response: VercelResponse
) {
  try {
    // 获取所有会话列表（可按user_id过滤）
    if (request.method === 'GET' && !request.query.session_id) {
      let query = 'SELECT * FROM simulation_sessions';
      const params: any[] = [];
      
      if (request.query.user_id) {
        query += ' WHERE user_id = $1';
        params.push(Number(request.query.user_id));
      }
      
      query += ' ORDER BY created_at DESC';
      
      const result = await pool.query(query, params);
      return response.status(200).json(result.rows);
    }
    
    if (request.method === 'POST') {
      const { company, job_title, topic, user_id } = request.body;
      
      const result = await pool.query(
        `INSERT INTO simulation_sessions (company, job_title, topic, status, user_id) VALUES ($1, $2, $3, 'DISCUSSING', $4) RETURNING *`,
        [company, job_title, topic, user_id ? Number(user_id) : null]
      );
      
      const session = result.rows[0];
      
      // 添加3个AI角色
      const characters = [
        { id: 'char1', name: '张强 (Aggressive)', role: 'AGGRESSIVE', personality: '强势控场型...', color: 'bg-red-500' },
        { id: 'char2', name: '李雅 (Structured)', role: 'STRUCTURED', personality: '逻辑枢纽型...', color: 'bg-blue-500' },
        { id: 'char3', name: '王敏 (Detail)', role: 'DETAIL', personality: '务实执行型...', color: 'bg-emerald-500' },
      ];
      
      for (const char of characters) {
        await pool.query(
          `INSERT INTO ai_personas (session_id, character_id, name, role, personality, color) VALUES ($1, $2, $3, $4, $5, $6)`,
          [session.id, char.id, char.name, char.role, char.personality, char.color]
        );
      }
      
      return response.status(200).json(session);
    } 
    
    else if (request.method === 'PUT') {
      const { session_id, status } = request.body;
      const result = await pool.query(
        `UPDATE simulation_sessions SET status = $1, finished_at = CASE WHEN $1 = 'FINISHED' THEN NOW() ELSE finished_at END WHERE id = $2 RETURNING *`,
        [status, Number(session_id)]
      );
      return response.status(200).json(result.rows[0]);
    }
    
    else if (request.method === 'GET' && request.query.session_id) {
      const { session_id } = request.query;
      const result = await pool.query('SELECT * FROM simulation_sessions WHERE id = $1', [session_id]);
      return response.status(200).json(result.rows[0] || null);
    }
    
    return response.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error('Error:', error);
    return response.status(500).json({ error: error.message });
  }
}
