// Dev helper: joins a room with bot players that chase the ball.
// Usage: node tools/bots.js ROOMCODE [count] [url]
const { io } = require('socket.io-client');
const [code, count = '1', url = 'http://localhost:3000'] = process.argv.slice(2);
if (!code) { console.log('Usage: node tools/bots.js ROOMCODE [count] [url]'); process.exit(1); }

for (let i = 0; i < Number(count); i++) {
  const s = io(url);
  let slot = -1;
  s.on('connect', () => s.emit('join', { code, name: `Bot ${i + 1}` }, (r) => console.log(`Bot ${i + 1}:`, r)));
  s.on('lobby', (l) => { slot = l.players.findIndex((p) => p && p.id === s.id); });
  s.on('state', (st) => {
    const me = st.c.find((c) => c[0] === slot);
    if (!me) return;
    const [, x, y, a] = me;
    const want = Math.atan2(st.b[1] - y, st.b[0] - x);
    let d = want - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    s.emit('input', { u: true, l: d < -0.15, r: d > 0.15, b: Math.abs(d) < 0.2 && Math.random() < 0.3 });
  });
}
