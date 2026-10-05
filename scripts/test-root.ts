async function main() {
  try {
    const res = await fetch('http://localhost:3000/');
    console.log('HTTP Status:', res.status);
    const text = await res.text();
    console.log('HTML Length:', text.length);
    console.log('Preview:', text.slice(0, 200));
  } catch (err) {
    console.error('Fetch error:', (err as Error).message);
  }
}

main();
