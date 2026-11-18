#!/bin/sh
# 정식 서버 배포: 빌드 → ~/blue-immersion-server 로 복사 → 서버 재시작
#  macOS는 백그라운드 서비스의 바탕화면(Desktop) 폴더 접근을 막으므로, 실행본은 홈 폴더의 별도 위치에 둠
#  서버는 launchd(kr.blue-immersion.server)가 Mac이 켜질 때 자동 실행하고, 꺼지면 다시 띄움 (PORT 5173 = Caddy 연결 대상)
set -e
cd "$(dirname "$0")/.."
DEST="$HOME/blue-immersion-server"
npx tsc -p .
npx vite build
mkdir -p "$DEST/server" "$DEST/node_modules"
rsync -a --delete dist/ "$DEST/dist/"
rsync -a server/relay.js server/chatFilter.js "$DEST/server/"
rsync -a --delete node_modules/ws "$DEST/node_modules/"
printf '{ "type": "module" }\n' > "$DEST/package.json"
launchctl kickstart -k "gui/$(id -u)/kr.blue-immersion.server" 2>/dev/null && echo "서버 재시작 완료" || echo "서버 등록 필요: launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/kr.blue-immersion.server.plist"
