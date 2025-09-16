@echo off
REM go to project folder
cd /d "C:\Users\andre\OneDrive\Documents\scripting\Secret-Santa-main"

REM start the Node server in a new window
start "Secret Santa Server" cmd /k "npm start"

REM wait a little so server spins up
timeout /t 5 /nobreak >nul

REM start ngrok in a new window
start "ngrok tunnel" cmd /k "ngrok http 3000"

echo ---------------------------------------------------
echo Secret Santa is starting...
echo Server at http://localhost:3000
echo Ngrok will print your public link in its window.
echo Keep both windows open while people are playing!
echo ---------------------------------------------------
pause
