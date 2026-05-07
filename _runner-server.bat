@echo off
cd /d C:\Star-WebCNC\packages\server
set NODE_ENV=development
npx tsx src/index.ts > C:\temp\server.log 2>&1
