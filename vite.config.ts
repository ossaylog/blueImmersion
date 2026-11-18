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

/**
 * 한 파일로 묶인 게임 코드(수백 KB)를 <head>에서 </body> 앞으로 옮김
 *  → 브라우저가 코드를 다 받기 전에 '바다를 불러오고 있어요' 로딩 화면(#boot)부터 그림
 */
function scriptToBodyEnd(): Plugin {
  return {
    name: 'script-to-body-end',
    enforce: 'post',
    // vite-plugin-singlefile도 order: 'post'에서 코드를 인라인하므로, 그보다 뒤(플러그인 배열에서 뒤)에 실행
    generateBundle: { order: 'post', handler(_, bundle) {
      for (const f of Object.values(bundle)) {
        if (f.type !== 'asset' || !f.fileName.endsWith('.html')) continue;
        const html = String(f.source);
        const a = html.indexOf('<script type="module" crossorigin>');
        const head = html.indexOf('</head>');
        if (a < 0 || a > head) continue;
        const b = html.indexOf('</script>', a) + '</script>'.length;
        const tag = html.slice(a, b);
        const rest = html.slice(0, a) + html.slice(b);
        const end = rest.lastIndexOf('</body>');
        f.source = rest.slice(0, end) + tag + '\n' + rest.slice(end);
      }
    } },
  };
}

export default defineConfig({
  plugins: [viteSingleFile(), scriptToBodyEnd(), multiplayer()],
  build: { target: 'es2020', assetsInlineLimit: 100000000, chunkSizeWarningLimit: 5000 },
  server: { host: true, allowedHosts },
  preview: { host: true, allowedHosts },
});
