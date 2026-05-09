@echo off
cd /d "%~dp0"
set HOST=127.0.0.1
set PORT=4567
node src\server.mjs >> codex-control.out.log 2>> codex-control.err.log
