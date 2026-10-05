import 'dotenv/config';

async function testEndpoints() {
  const adminSecret = process.env.ADMIN_SECRET;
  console.log('Testing Authentication & Security System...\n');

  // 1. Check Auth status before login
  const statusRes = await fetch('http://localhost:3000/api/admin/auth');
  const statusData = await statusRes.json();
  console.log('1. Initial Session Status:', statusData);

  // 2. Test Invalid Secret
  const badLogin = await fetch('http://localhost:3000/api/admin/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: 'wrong_secret_123' }),
  });
  console.log('2. Invalid Secret Attempt HTTP Status:', badLogin.status, await badLogin.json());

  // 3. Test Valid Secret Login
  const goodLogin = await fetch('http://localhost:3000/api/admin/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: adminSecret }),
  });
  const cookieHeader = goodLogin.headers.get('set-cookie');
  console.log('3. Valid Secret Attempt HTTP Status:', goodLogin.status, await goodLogin.json());
  console.log('   Set-Cookie received:', Boolean(cookieHeader));

  // 4. Test Protected API without Cookie (Should be 401)
  const unauthRes = await fetch('http://localhost:3000/api/admin/accounts');
  console.log('4. Protected Accounts Endpoint without Auth:', unauthRes.status, await unauthRes.json());

  // 5. Test Protected API with Cookie (Should be 200 and masked secrets)
  const authRes = await fetch('http://localhost:3000/api/admin/accounts', {
    headers: { 'Cookie': cookieHeader || '' },
  });
  const accountsData = await authRes.json();
  console.log('5. Protected Accounts Endpoint with Cookie:', authRes.status);
  console.log('   Accounts returned:', accountsData.accounts?.length);
  if (accountsData.accounts?.[0]) {
    console.log('   Account #1 masked secret:', accountsData.accounts[0].api_secret);
  }

  // 6. Test Public Stream Endpoint (Should work without any auth and expose NO secrets)
  const publicRes = await fetch('http://localhost:3000/ko/314939/1/1');
  const publicData = await publicRes.json();
  console.log('\n6. Public Stream Lookup (/ko/314939/1/1):', publicRes.status);
  console.log('   Result:', publicData);
}

testEndpoints().catch(console.error);
