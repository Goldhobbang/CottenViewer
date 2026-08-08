# 배포 및 설정 가이드

## 구조

- **봇**: 호스팅 서버(디스호스트 등)에 배포
- **LLM**: 로컬 PC에서 Ollama 실행, 터널링(ngrok/Cloudflare)로 외부 노출
- **통신**: 봇 → 로컬 LLM (환경변수 `OLLAMA_BASE_URL`로 조정)

## 사전 준비

### 로컬 PC (LLM 서버)

1. **Ollama 설치 및 모델 다운로드**
   ```bash
   ollama pull exaone3.5:7.8b
   ollama serve  # 포트 11434에서 실행됨
   ```

2. **터널링 도구 선택 및 실행**
   
   **Option A: ngrok**
   ```bash
   ngrok http 11434
   # 터미널에 출력된 URL 복사 (https://xxxx.ngrok-free.app)
   ```
   
   **Option B: Cloudflare Tunnel**
   ```bash
   cloudflared tunnel create cotton-viewer
   cloudflared tunnel route dns cotton-viewer your-domain.com
   cloudflared tunnel run cotton-viewer --url http://localhost:11434
   ```

### 호스팅 서버 설정

1. **리포지토리 클론**
   ```bash
   git clone <your-repo-url>
   cd CottonViewer
   npm install
   ```

2. **.env 파일 생성**
   ```bash
   cp .env.example .env
   ```
   
   `.env`에 다음 두 값 입력:
   - `DISCORD_TOKEN`: Discord Developer Portal에서 발급받은 봇 토큰
   - `OLLAMA_BASE_URL`: 로컬 PC 터널 URL (예: `https://f7df-221-143-73-48.ngrok-free.app/v1`)

3. **배포 전 테스트**
   ```bash
   node selftest.js
   # "셀프테스트 통과" 뜨면 OK
   ```
   
   ⚠️ `selftest.js`는 판정 로직과 마크다운 포맷만 검증함. 실제 LLM 연결은 다음 단계에서 확인.

4. **봇 시작**
   
   **PM2 사용 (VPS/자체 서버)**
   ```bash
   pm2 start index.js --name cotton-viewer
   pm2 save      # 재부팅 시 자동 시작
   pm2 logs cotton-viewer --lines 20
   ```
   
   **호스팅 서비스 (디스호스트 등)**
   - 서비스의 배포 대시보드에서 `npm start` 또는 `node index.js` 커맨드 지정
   - 포트: 필요 없음 (봇은 Discord API로 이벤트 수신, HTTP 포트 불필요)

## 실제 동작 확인

Discord 서버의 봇 채널에서 아래 커맨드 실행:

```
/ㄱㅌ [판정할 텍스트 또는 답장]
/ㅅㅁ [설명만 보기 (판정 없음)]
```

### 예상 응답

- ✅ 정상: 판정 + 확신도 마크다운 + 한줄평
- ⚠️ LLM 끊김: "현재 AI 모델 서버(로컬 PC)가 꺼져있어 응답할 수 없습니다."
- ⚠️ 형식 오류: "판정할 메시지에 답장하고 커맨드를 쳐라."

## 문제 해결

| 증상 | 원인 | 해결 |
|------|------|------|
| 봇이 반응 없음 | DISCORD_TOKEN 잘못됨 | 토큰 재확인 |
| "로컬 PC 꺼졌다" 메시지 | LLM 연결 실패 | 로컬 PC 터널 재시작, URL 갱신 |
| 타임아웃 10초 이상 | 응답 없음 | Ollama 응답성 확인 (로컬에서 `curl http://localhost:11434/api/tags` 테스트) |

## 보안 주의사항

- ❌ `.env` 파일 공개 리포에 커밋하지 마라 (`.gitignore`에 등록됨)
- ❌ `DISCORD_TOKEN` 노출 시 토큰 재발급 (Discord Developer Portal)
- ✅ `.env.example`만 리포에 올림 (실제 값 없음)
- ✅ 민감한 정보는 호스팅 서비스의 환경변수 관리 기능 사용

## ngrok URL 변경 시 (무료 플랜)

ngrok 무료 플랜은 매 재시작마다 새 URL 생성. 로컬 PC 재부팅 후:

```bash
# 로컬 PC
ngrok http 11434
# 새 URL 확인 (예: https://new-xxxx.ngrok-free.app)

# 호스팅 서버
# .env에서 OLLAMA_BASE_URL 갱신
OLLAMA_BASE_URL=https://new-xxxx.ngrok-free.app/v1

# 서비스 재시작
pm2 restart cotton-viewer --update-env
# 또는 호스팅 서비스의 재배포 버튼
```

## 파일 구성

```
CottonViewer/
├── index.js              (봇 메인 코드)
├── selftest.js           (배포 전 형식 검증)
├── knowledge.md          (LLM 참조 지식, 수정 후 봇 재시작 필요)
├── package.json          (의존성)
├── package-lock.json
├── .env.example          (환경변수 템플릿)
├── .env                  (실제 설정, .gitignore 등록)
├── .gitignore
├── README.md
└── DEPLOY.md             (이 파일)
```
