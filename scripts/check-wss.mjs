const url = process.argv[2];
if (!url || !url.startsWith('wss://')) {
  throw new Error('Usage: node scripts/check-wss.mjs <wss-url>');
}

try {
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let finished = false;
    const finish = error => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      finish(new Error(`WSS timeout: ${url}`));
      socket.close();
    }, 10_000);
    socket.onopen = () => {
      console.log(`WSS open: ${url}`);
      finish();
      socket.close();
    };
    socket.onerror = () => {
      finish(new Error(`WSS connection failed: ${url}`));
    };
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
