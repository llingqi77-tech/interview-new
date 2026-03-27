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
    if (request.method === 'POST') {
      const { session_id, timing, voice_share, structural_contribution, interruption_handling, overall_score, suggestions } = request.body;
      
      const result = await pool.query(
        `INSERT INTO feedback_reports (session_id, timing, voice_share, structural_contribution, interruption_handling, overall_score, suggestions) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [session_id, timing, voice_share, structural_contribution, interruption_handling, overall_score, suggestions]
      );
      
      return response.status(200).json(result.rows[0]);
    } 
    
    else if (request.method === 'GET' && request.query.session_id) {
      const { session_id } = request.query;
      const result = await pool.query('SELECT * FROM feedback_reports WHERE session_id = $1', [Number(session_id)]);
      return response.status(200).json(result.rows[0] || null);
    }
    
    else if (request.method === 'GET') {
      const result = await pool.query('SELECT * FROM feedback_reports ORDER BY created_at DESC');
      return response.status(200).json(result.rows);
    }
    
    return response.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error('Error:', error);
    return response.status(500).json({ error: error.message });
  }
}
