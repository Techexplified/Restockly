async function main() {
  const url = "https://accordingly-arbor-utilize-sandra.trycloudflare.com/webhooks/products/update";
  console.log(`Checking tunnel endpoint: ${url}`);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ test: true })
    });
    console.log(`Tunnel responded with Status: ${res.status}`);
    const text = await res.text();
    console.log(`Response text:`, text);
  } catch (err) {
    console.error("Tunnel check failed:", err.message);
  }
}

main();
