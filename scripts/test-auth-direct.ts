import 'dotenv/config';
import { NextRequest } from 'next/server';
import { GET, POST } from '../app/api/admin/auth/route';

async function testDirect() {
  const req = new NextRequest('http://localhost:3000/api/admin/auth');
  const res = await GET(req);
  console.log('GET /api/admin/auth direct result:', await res.json());

  const postReq = new NextRequest('http://localhost:3000/api/admin/auth', {
    method: 'POST',
    body: JSON.stringify({ secret: process.env.ADMIN_SECRET }),
  });
  const postRes = await POST(postReq);
  console.log('POST /api/admin/auth direct result:', await postRes.json());
  console.log('POST cookies:', postRes.cookies.get('admin_session'));
}

testDirect().catch(console.error);
