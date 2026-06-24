@echo off
cd /d C:\Users\Thinkpad\Documents\SalamLIR
C:\Users\Thinkpad\Documents\SalamLIR\backend\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 3002 >> C:\Users\Thinkpad\Documents\SalamLIR\api-3002-task.log 2>> C:\Users\Thinkpad\Documents\SalamLIR\api-3002-task.err.log
