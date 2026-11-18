// 멀티유저 릴레이: 접속한 다이버들의 상태(위치·자세·장비)를 서로에게 전달
//  - Vite 개발/미리보기 서버에 /mp 경로로 붙음 (vite.config.ts)
//  - 단독 실행: `npm run server` → dist/ 정적 파일 + /mp 웹소켓 (PORT, 기본 8787)
//  서버는 상태를 해석하지 않고 중계만 함 (닉네임 중복 정리 + 시계 맞추기 응답)
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { gzipSync, brotliCompressSync, constants as zc } from 'node:zlib';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkChat } from './chatFilter.js';

const MAX_PEERS = 40;
const MAX_MSG = 2048;
const CHAT_KEEP = 40;          // 새로 들어온 사람에게 보여 줄 최근 대화
const CHAT_GAP = 900;          // 한 사람이 연달아 보낼 수 있는 간격 (ms)
const CHAT_BURST = [6, 15000]; // 15초에 최대 6개
const STRIKES = 3;             // 고운 말 경고 3번이면
const MUTE_MS = 60000;         //   1분 동안 채팅 금지

export function attachRelay(httpServer, path = '/mp') {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG });
  /** @type {Map<string, { ws: import('ws').WebSocket, nick: string, s: unknown }>} */
  const peers = new Map();
  let seq = 0;
  /** 최근 대화 (서버가 살아 있는 동안만, 저장하지 않음) */
  const history = [];

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
        send(ws, { t: 'welcome', id, nick, chat: history, peers: [...peers].filter(([pid]) => pid !== id).map(([pid, p]) => ({ id: pid, nick: p.nick, s: p.s })) });
        broadcast(id, { t: 'join', id, nick });
      } else if (m.t === 'time' && typeof m.c === 'number') {
        // 시계 맞추기: 보낸 시각(c)을 그대로 돌려주며 서버 시각(s)을 함께 → 모든 접속자가 같은 '바다 시각'으로 생물을 봄
        send(ws, { t: 'time', c: m.c, s: Date.now() });
      } else if (m.t === 'state' && joined) {
        const p = peers.get(id);
        if (!p) return;
        p.s = m.s;
        broadcast(id, { t: 'state', id, s: m.s });
      } else if (m.t === 'chat' && joined) {
        // 채팅: 서버가 최종 판정 (클라이언트 필터를 거치지 않고 직접 보낸 메시지도 막음)
        const p = peers.get(id);
        if (!p) return;
        const now = Date.now();
        const no = (why) => send(ws, { t: 'chatNo', why, k: m.k });
        if (p.muteUntil && now < p.muteUntil) return no('muted');
        p.sent = (p.sent ?? []).filter((at) => now - at < CHAT_BURST[1]);
        if (p.sent.length >= CHAT_BURST[0] || now - (p.sent[p.sent.length - 1] ?? 0) < CHAT_GAP) return no('flood');
        const r = checkChat(m.x);
        if (!r.ok) {
          if (r.why === 'bad') { p.strikes = (p.strikes ?? 0) + 1; if (p.strikes >= STRIKES) { p.strikes = 0; p.muteUntil = now + MUTE_MS; return no('muted'); } }
          return no(r.why);
        }
        // 같은 말 반복(도배) 막기
        if (p.lastText === r.text && now - (p.lastAt ?? 0) < 8000) return no('flood');
        p.sent.push(now); p.lastText = r.text; p.lastAt = now;
        const msg = { t: 'chat', id, nick: p.nick, x: r.text, at: now, k: m.k };
        history.push({ id, nick: p.nick, x: r.text, at: now });
        if (history.length > CHAT_KEEP) history.shift();
        // 보낸 사람에게도 돌려줌 → 모두가 같은 순서로 봄
        const data = JSON.stringify(msg);
        for (const [, q] of peers) if (q.ws.readyState === 1) q.ws.send(data);
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
  /** 파일별 압축본 캐시 (파일이 바뀌면 다시 압축) */
  const cache = new Map();
  const load = async (file) => {
    const st = await stat(file);
    const c = cache.get(file);
    if (c && c.mtime === st.mtimeMs) return c;
    const raw = await readFile(file);
    const text = /\.(html|js|css|json|svg)$/.test(file) && raw.length > 1024;
    const f = {
      mtime: st.mtimeMs, raw, etag: `"${st.size.toString(36)}-${Math.round(st.mtimeMs).toString(36)}"`,
      gz: text ? gzipSync(raw, { level: 9 }) : null,
      br: text ? brotliCompressSync(raw, { params: { [zc.BROTLI_PARAM_QUALITY]: 11, [zc.BROTLI_PARAM_SIZE_HINT]: raw.length } }) : null,
    };
    cache.set(file, f);
    return f;
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    if (!p || p.endsWith('/')) p += 'index.html';
    const file = join(root, p);
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    try {
      const f = await load(file);
      const enc = String(req.headers['accept-encoding'] ?? '');
      const head = { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache', etag: f.etag, vary: 'accept-encoding' };
      if (req.headers['if-none-match'] === f.etag) { res.writeHead(304, head).end(); return; }
      // 압축 전송: 885KB → 약 210KB(br) / 255KB(gzip) — 느린 모바일 망에서 첫 로딩 시간이 크게 줄어듦
      if (f.br && /\bbr\b/.test(enc)) res.writeHead(200, { ...head, 'content-encoding': 'br' }).end(f.br);
      else if (f.gz && /\bgzip\b/.test(enc)) res.writeHead(200, { ...head, 'content-encoding': 'gzip' }).end(f.gz);
      else res.writeHead(200, head).end(f.raw);
    } catch { res.writeHead(404).end('not found'); }
  });
  attachRelay(server);
  const port = Number(process.env.PORT ?? 8787);
  server.listen(port, '0.0.0.0', () => console.log(`BLUE IMMERSION 멀티 서버: http://localhost:${port}  (웹소켓 /mp)`));
}
