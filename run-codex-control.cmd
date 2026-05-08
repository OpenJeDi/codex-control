@echo off
cd /d "%USERPROFILE%\work\personal\codex-control"
set HOST=127.0.0.1
set PORT=4567
node src\server.mjs >> codex-control.out.log 2>> codex-control.err.log
