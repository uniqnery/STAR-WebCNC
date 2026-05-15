@echo off
cd /d C:\Star-WebCNC\packages\server
set NODE_ENV=development
set DATA_DIR=C:\StarWebCNC-Data
npx tsx src/index.ts > C:\temp\server.log 2>&1
