import localtunnel from 'localtunnel';
import fs from 'fs';

(async () => {
  try {
    const tunnel = await localtunnel({ port: 5174 });
    console.log('TUNNEL_SUCCESS:', tunnel.url);
    fs.writeFileSync('url.txt', tunnel.url);
  } catch (err) {
    console.error('TUNNEL_ERR:', err);
    fs.writeFileSync('url.txt', 'ERR: ' + err.message);
  }
})();
