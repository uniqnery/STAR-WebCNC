@echo off
cd /d C:\Star-WebCNC\packages\agent\StarWebCNC.Agent\publish
set ASPNETCORE_ENVIRONMENT=Production
dotnet StarWebCNC.Agent.dll > C:\temp\agent_prod.log 2>&1
