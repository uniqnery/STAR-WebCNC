@echo off
REM ================================================================
REM Star-WebCNC Agent 시작 스크립트
REM 장비별로 이 파일을 복사하여 환경변수를 수정하세요.
REM ASP.NET Core 환경변수: Agent__키=값 형식 (이중 밑줄)
REM ================================================================

REM ── 장비 설정 ──────────────────────────────────────────────────
set ASPNETCORE_ENVIRONMENT=Production
set Agent__AgentId=AGENT-001
set Agent__MachineId=MC-001
set Agent__TemplateId=FANUC_0i-TF Plus_SB-20R2_V1

REM ── CNC 연결 설정 ───────────────────────────────────────────────
set Agent__Cnc__IpAddress=192.168.1.101
set Agent__Cnc__Port=8193

REM ── MQTT 브로커 설정 ────────────────────────────────────────────
set Agent__Mqtt__Host=localhost
set Agent__Mqtt__Port=1883
REM ClientId 비워두면 자동 생성 (AGENT-{AgentId}-{MachineId}-{GUID})
set Agent__Mqtt__ClientId=

REM ── 서버 설정 ───────────────────────────────────────────────────
set Agent__Server__BaseUrl=http://localhost:3000

REM ── 실행 ────────────────────────────────────────────────────────
echo.
echo [Star-WebCNC Agent]
echo   MachineId : %Agent__MachineId%
echo   CNC IP    : %Agent__Cnc__IpAddress%:%Agent__Cnc__Port%
echo   MQTT      : %Agent__Mqtt__Host%:%Agent__Mqtt__Port%
echo   Server    : %Agent__Server__BaseUrl%
echo.

cd /d "%~dp0StarWebCNC.Agent\publish"
StarWebCNC.Agent.exe
