import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { attachRelay } from './server/relay.js';

/** 개발(npm run dev)·미리보기(npm run preview) 서버에 멀티유저 릴레이(/mp)를 붙임 */
const multiplayer = (): Plugin => ({
  name: 'blue-immersion-mp',
  configureServer(server) { if (server.httpServer) attachRelay(server.httpServer); },
  configurePreviewServer(server) { if (server.httpServer) attachRelay(server.httpServer); },
});

/** 외부 도메인으로 접속 허용 (Vite는 기본적으로 모르는 Host 헤더를 막음) */
const allowedHosts = ['blue-immersion.o-r.kr', '.blue-immersion.o-r.kr'];

export default defineConfig({
  plugins: [viteSingleFile(), multiplayer()],
  build: { target: 'es2020', assetsInlineLimit: 100000000, chunkSizeWarningLimit: 5000 },
  server: { host: true, allowedHosts },
  preview: { host: true, allowedHosts },
});
