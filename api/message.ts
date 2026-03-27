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
    // 保存消息
    if (request.method === 'POST') {
      const { session_id, speaker_type, speaker_id, speaker_name, message, round } = request.body;
      
      const result = await pool.query(
        `INSERT INTO conversation_records (session_id, speaker_type, speaker_id, speaker_name, message, round) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [Number(session_id), speaker_type, speaker_id, speaker_name, message, round || 1]
      );
      
      return response.status(200).json(result.rows[0]);
    } 
    
    // 获取某个会话的所有消息
    else if (request.method === 'GET' && request.query.session_id) {
      const { session_id } = request.query;
      const result = await pool.query(
        'SELECT * FROM conversation_records WHERE session_id = $1 ORDER BY created_at ASC',
        [Number(session_id)]
      );
      return response.status(200).json(result.rows);
    }
    
    // 获取所有消息
    else if (request.method === 'GET') {
      const result = await pool.query('SELECT * FROM conversation_records ORDER BY created_at DESC');
      return response.status(200).json(result.rows);
    }
    
    return response.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error('Error:', error);
    return response.status(500).json({ error: error.message });
  }
}
