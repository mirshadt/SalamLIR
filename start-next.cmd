@echo off
cd /d C:\Users\Thinkpad\Documents\SalamLIR
"C:\Program Files\nodejs\node.exe" node_modules\next\dist\bin\next start --hostname 127.0.0.1 --port 8082 > next-launch.log 2>&1
echo Next exited with code %ERRORLEVEL% >> next-launch.log
