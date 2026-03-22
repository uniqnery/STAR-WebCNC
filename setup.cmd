@echo off
REM ================================================================
REM Star-WebCNC 설치 스크립트 (Windows)
REM 고객사 PC 최초 설치 시 실행
REM ================================================================
setlocal EnableDelayedExpansion

echo.
echo ╔═══════════════════════════════════════════════════════╗
echo ║         Star-WebCNC 설치 스크립트                    ║
echo ╚═══════════════════════════════════════════════════════╝
echo.

REM ── 1. Node.js 확인 ──────────────────────────────────────────────
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js가 설치되지 않았습니다.
    echo         https://nodejs.org 에서 LTS 버전을 설치하세요.
    pause & exit /b 1
)
echo [OK] Node.js: 설치됨

REM ── 2. Docker 확인 ───────────────────────────────────────────────
docker --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker가 설치되지 않았습니다.
    echo         https://www.docker.com/products/docker-desktop 에서 설치하세요.
    pause & exit /b 1
)
echo [OK] Docker: 설치됨

REM ── 3. .env 파일 생성 (없는 경우만) ─────────────────────────────
if not exist "packages\server\.env" (
    echo.
    echo [SETUP] 서버 환경설정 파일 생성 중...

    REM 랜덤 시크릿 생성 (날짜/시간 기반)
    for /f "delims=" %%a in ('powershell -Command "[System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))"') do set ACCESS_SECRET=%%a
    for /f "delims=" %%a in ('powershell -Command "[System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))"') do set REFRESH_SECRET=%%a
    for /f "delims=" %%a in ('powershell -Command "[System.Security.Cryptography.RandomNumberGenerator]::GetBytes(16) | ForEach-Object { $_.ToString('x2') } | Join-String"') do set DB_PASS=%%a

    (
        echo # Database
        echo POSTGRES_USER=starwebcnc
        echo POSTGRES_PASSWORD=!DB_PASS!
        echo POSTGRES_DB=starwebcnc
        echo DATABASE_URL=postgresql://starwebcnc:!DB_PASS!@localhost:5432/starwebcnc
        echo.
        echo # Redis
        echo REDIS_URL=redis://localhost:6379
        echo.
        echo # MQTT
        echo MQTT_BROKER_URL=mqtt://localhost:1883
        echo.
        echo # Server
        echo PORT=3000
        echo NODE_ENV=production
        echo.
        echo # JWT ^(자동 생성된 시크릿^)
        echo JWT_ACCESS_SECRET=!ACCESS_SECRET!
        echo JWT_REFRESH_SECRET=!REFRESH_SECRET!
        echo JWT_ACCESS_EXPIRES_IN=15m
        echo JWT_REFRESH_EXPIRES_IN=7d
        echo.
        echo # CORS
        echo CORS_ORIGIN=http://localhost:5173
    ) > "packages\server\.env"
    echo [OK] .env 파일 생성 완료
) else (
    echo [SKIP] .env 파일이 이미 존재합니다.
)

REM ── 4. 의존성 설치 ───────────────────────────────────────────────
echo.
echo [SETUP] 서버 의존성 설치 중...
cd packages\server
call npm install --omit=dev 2>nul || call npm install
cd ..\..

echo.
echo [SETUP] 프론트엔드 의존성 설치 중...
cd packages\web
call npm install --omit=dev 2>nul || call npm install
cd ..\..

REM ── 5. 인프라 기동 (Docker) ──────────────────────────────────────
echo.
echo [SETUP] 인프라 서비스 시작 (PostgreSQL, Redis, MQTT)...

REM docker-compose.yml 위치 찾기
if exist "docker-compose.yml" (
    docker compose up -d db redis mqtt 2>nul || docker-compose up -d db redis mqtt
) else if exist "packages\server\docker-compose.yml" (
    cd packages\server
    docker compose up -d 2>nul || docker-compose up -d
    cd ..\..
)

echo [SETUP] 서비스 기동 대기 (10초)...
timeout /t 10 /nobreak >nul

REM ── 6. DB 초기화 ─────────────────────────────────────────────────
echo.
echo [SETUP] 데이터베이스 초기화 중...
cd packages\server

REM 마이그레이션 실행
call npx prisma migrate deploy
if errorlevel 1 (
    echo [WARN] migrate deploy 실패, db push 시도...
    call npx prisma db push --accept-data-loss
)

REM Prisma 클라이언트 생성
call npx prisma generate

REM 시드 데이터 (최초 1회)
echo.
set /p SEED="초기 사용자/템플릿 데이터를 생성하시겠습니까? (y/N): "
if /i "!SEED!"=="y" (
    call npx ts-node prisma/seed.ts 2>nul || call npx tsx prisma/seed.ts
    echo [OK] 시드 데이터 생성 완료
)
cd ..\..

REM ── 7. 완료 ──────────────────────────────────────────────────────
echo.
echo ╔═══════════════════════════════════════════════════════╗
echo ║              설치 완료!                               ║
echo ╠═══════════════════════════════════════════════════════╣
echo ║  서버 시작: cd packages\server ^&^& npm start         ║
echo ║  웹 시작:   cd packages\web ^&^& npm run dev          ║
echo ║  Agent:     packages\agent\start-agent.cmd 편집 후 실행║
echo ║                                                       ║
echo ║  기본 계정:                                           ║
echo ║    admin       / admin123!    (ADMIN)                 ║
echo ║    as_manager  / as123!       (HQ_ENGINEER)           ║
echo ║    operator    / user123!     (USER)                  ║
echo ╚═══════════════════════════════════════════════════════╝
echo.
pause
