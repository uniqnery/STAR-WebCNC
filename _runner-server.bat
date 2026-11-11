@echo off
cd /d C:\Star-WebCNC\packages\server
set NODE_ENV=development
set DATA_DIR=C:\StarWebCNC-Data
set PROGRAM_REPOSITORY_ROOT=C:\StarWebCNC-Data\program-repository
npx tsx src/index.ts > C:\temp\server.log 2>&1
