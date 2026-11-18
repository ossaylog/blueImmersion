import { App } from './App';

const app = new App();
app.init().catch((e) => {
  console.error(e);
  document.getElementById('boot')?.remove();
  const el = document.getElementById('ui');
  if (el) el.innerHTML = `<div style="position:fixed;inset:0;display:grid;place-items:center;color:#fff;font:14px sans-serif;padding:24px;text-align:center">3D 환경을 시작하지 못했어요.<br>WebGL을 지원하는 최신 브라우저(Chrome, Edge, Safari)에서 열어주세요.<br><small style="opacity:.6">${String(e)}</small></div>`;
});
