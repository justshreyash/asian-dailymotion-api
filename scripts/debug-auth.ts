async function main() {
  const res = await fetch('http://localhost:3000/api/admin/auth');
  console.log('Status:', res.status);
  console.log('Content-Type:', res.headers.get('content-type'));
  const body = await res.text();
  console.log('Body:', body.slice(0, 300));
}

main();

export {};
