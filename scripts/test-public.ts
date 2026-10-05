import 'dotenv/config';

async function testPublicEndpoints() {
  console.log('Testing Public API Edge Cases...\n');

  // 1. Existing Uploaded Episode
  const r1 = await fetch('http://localhost:3000/ko/314939/1/1');
  console.log('1. Uploaded S1E1:', r1.status, await r1.json());

  // 2. On-Air Pending Episode (S1E7)
  const r2 = await fetch('http://localhost:3000/ko/314939/1/7');
  console.log('\n2. On-Air S1E7:', r2.status, await r2.json());

  // 3. Series Summary
  const r3 = await fetch('http://localhost:3000/ko/314939');
  console.log('\n3. Series Summary:', r3.status, await r3.json());

  // 4. Unknown TMDB ID
  const r4 = await fetch('http://localhost:3000/ko/99999999');
  console.log('\n4. Unknown TMDB ID:', r4.status, await r4.json());
}

testPublicEndpoints().catch(console.error);
