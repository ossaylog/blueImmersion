// 멀티유저 릴레이: 접속한 다이버들의 상태(위치·자세·장비)를 서로에게 전달
//  - Vite 개발/미리보기 서버에 /mp 경로로 붙음 (vite.config.ts)
//  - 단독 실행: `npm run server` → dist/ 정적 파일 + /mp 웹소켓 (PORT, 기본 8787)
//  서버는 상태를 해석하지 않고 중계만 함 (닉네임 중복 정리 + 시계 맞추기 응답)
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_PEERS = 40;
const MAX_MSG = 2048;

export function attachRelay(httpServer, path = '/mp') {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG });
  /** @type {Map<string, { ws: import('ws').WebSocket, nick: string, s: unknown }>} */
  const peers = new Map();
  let seq = 0;

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== path) return; // 다른 업그레이드(Vite HMR 등)는 건드리지 않음
    if (peers.size >= MAX_PEERS) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });

  const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  const broadcast = (from, msg) => { const data = JSON.stringify(msg); for (const [id, p] of peers) if (id !== from && p.ws.readyState === 1) p.ws.send(data); };
  // 닉네임이 겹치면 숫자 대신 한글 꾸밈말을 앞에 붙여 구분
  const PREFIX = ['작은', '큰', '새내기', '베테랑', '아기', '어른', '숲속의', '바닷가', '파도타는', '햇살', '달빛', '별빛', '노을빛', '은빛', '금빛', '물방울'];
  const uniqueNick = (nick) => {
    const taken = new Set([...peers.values()].map((p) => p.nick));
    if (!taken.has(nick)) return nick;
    for (const pre of [...PREFIX].sort(() => Math.random() - 0.5)) if (!taken.has(`${pre} ${nick}`)) return `${pre} ${nick}`;
    for (const a of PREFIX) for (const b of PREFIX) if (a !== b && !taken.has(`${a} ${b} ${nick}`)) return `${a} ${b} ${nick}`;
    return nick;
  };
  // 닉네임은 한글·공백만 허용 (숫자·기호 제거)
  const cleanNick = (raw) => String(raw ?? '').replace(/[^가-힣ㄱ-ㅎㅏ-ㅣ ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24) || '다이버';

  wss.on('connection', (ws) => {
    const id = (++seq).toString(36) + Math.random().toString(36).slice(2, 6);
    let joined = false;
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'hello' && !joined) {
        joined = true;
        const nick = uniqueNick(cleanNick(m.nick));
        peers.set(id, { ws, nick, s: null });
        send(ws, { t: 'welcome', id, nick, peers: [...peers].filter(([pid]) => pid !== id).map(([pid, p]) => ({ id: pid, nick: p.nick, s: p.s })) });
        broadcast(id, { t: 'join', id, nick });
      } else if (m.t === 'time' && typeof m.c === 'number') {
        // 시계 맞추기: 보낸 시각(c)을 그대로 돌려주며 서버 시각(s)을 함께 → 모든 접속자가 같은 '바다 시각'으로 생물을 봄
        send(ws, { t: 'time', c: m.c, s: Date.now() });
      } else if (m.t === 'state' && joined) {
        const p = peers.get(id);
        if (!p) return;
        p.s = m.s;
        broadcast(id, { t: 'state', id, s: m.s });
      }
    });
    const bye = () => { if (peers.delete(id)) broadcast(id, { t: 'leave', id }); };
    ws.on('close', bye);
    ws.on('error', bye);
  });

  // 끊긴 연결 정리
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false; ws.ping();
    }
  }, 15000);
  wss.on('connection', (ws) => { ws.isAlive = true; ws.on('pong', () => (ws.isAlive = true)); });
  httpServer.on('close', () => clearInterval(timer));
  return wss;
}

// ───────── 단독 서버 (빌드 결과물 + 릴레이) ─────────
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1]);
if (isMain) {
  const root = fileURLToPath(new URL('../dist/', import.meta.url));
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json' };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    if (!p || p.endsWith('/')) p += 'index.html';
    const file = join(root, p);
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end('not found'); }
  });
  attachRelay(server);
  const port = Number(process.env.PORT ?? 8787);
  server.listen(port, '0.0.0.0', () => console.log(`BLUE IMMERSION 멀티 서버: http://localhost:${port}  (웹소켓 /mp)`));
}
