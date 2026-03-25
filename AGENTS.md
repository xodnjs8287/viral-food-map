# 요즘뭐먹 (yozmeat.com)

바이럴 음식 트렌드를 자동 탐지하고 내 주변 판매처를 지도로 보여주는 서비스

## 빌드 & 실행

```bash
# 프론트엔드
cd frontend && npm install && npm run dev     # 개발서버 http://localhost:3000
cd frontend && npx next build                  # 프로덕션 빌드

# 크롤러
cd crawler && pip install -r requirements.txt
cd crawler && uvicorn main:app --reload        # 개발서버 http://localhost:8000
```

## 테스트 & 검증

- 프론트: `npx next build` 성공 여부로 타입/빌드 검증 (별도 테스트 스위트 없음)
- 크롤러: 개별 모듈을 `python3 -c "..."` 로 단위 실행하여 검증
- UI 변경 시 반드시 Chrome 브라우저(mcp__claude-in-chrome)로 스크린샷 확인

## 배포

- **프론트엔드**: `git push origin main` → Vercel 자동 배포 (www.yozmeat.com)
- **크롤러**: GitHub 연동 → Koyeb 자동 재배포
- IMPORTANT: 코드 변경 후 반드시 빌드 확인 → push → 배포 확인까지 완료할 것

## 기술 스택

- **프론트**: Next.js 14 (App Router) + Tailwind + Kakao Map SDK + Supabase
- **크롤러**: Python 3.12 + FastAPI + httpx + APScheduler
- **DB**: Supabase PostgreSQL (프로젝트: jtbtqsdyfzmaqcsahxwe)
- **폰트**: Wanted Sans Variable (본문) + Black Han Sans (로고)
- **컬러**: Primary #9B7DD4 (퍼플), Secondary #8BACD8 (블루)

## 프로젝트 구조

```
frontend/
  src/app/          # Next.js App Router 페이지
    page.tsx        # 홈 (트렌드 목록)
    map/page.tsx    # 지도 페이지
    trend/[id]/     # 트렌드 상세 (지도+판매처)
    report/page.tsx # 제보 페이지
    admin/page.tsx  # 어드민 백오피스
  src/components/   # React 컴포넌트
  src/lib/          # Supabase, types, Zustand store
  public/           # PWA manifest, 아이콘, 로고

crawler/
  crawlers/         # 데이터 수집 (image_finder, store_finder, naver_*)
  detector/         # 트렌드 감지 (trend_detector, keyword_manager)
  routers/          # FastAPI 엔드포인트
```

## 코드 스타일

- TypeScript: ES 모듈, 구조분해 import, Tailwind 클래스 사용
- Python: async/await, type hints, f-string 로깅
- 컴포넌트: "use client" 클라이언트 컴포넌트, Props 인터페이스 명시
- CSS 간격: 카드 리스트는 `flex flex-col gap-8` 사용 (space-y는 margin collapsing 문제)

## 중요 규칙

- IMPORTANT: 카드 간격은 `flex flex-col gap-8` 이상 유지. space-y 사용 금지 (Link 내부에서 margin collapsing 발생)
- 색상 변경 시 tailwind.config.js + globals.css + manifest.json + layout.tsx themeColor 4곳 동시 수정
- 카카오맵 타입 추가 시 `src/lib/kakao.d.ts`에 선언 필요
- 제보는 reports 테이블에만 저장, admin 승인 시 stores에 삽입 (즉시 반영 아님)
- stores 테이블: place_url, rating 컬럼 있음 (nullable)

## 환경변수

- 프론트: `frontend/.env.local` (SUPABASE_URL/KEY, KAKAO_MAP_KEY)
- 크롤러: `crawler/.env` (SUPABASE_URL/KEY, NAVER_ID/SECRET, KAKAO_REST_KEY)

## DB 테이블

- `trends`: 트렌드 (name, category, status, peak_score, image_url)
- `stores`: 판매처 (name, address, lat, lng, place_url, rating, source, verified)
- `reports`: 유저 제보 (store_name, address, status:pending/verified)
- `keywords`: 모니터링 키워드

## 도메인 & 외부 서비스

- Vercel: viral-food-map 프로젝트 (www.yozmeat.com + yozmeat.com)
- 카카오 개발자: 앱 "뜨는맛집" ID 1413367, JS SDK 도메인 3개 등록
- Supabase: jtbtqsdyfzmaqcsahxwe 프로젝트
- Koyeb: silly-donnamarie 크롤러 서비스
