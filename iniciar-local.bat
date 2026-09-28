@echo off
REM Abre PDF PRO en tu PC con un servidor local (necesita Node.js: https://nodejs.org)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
    echo No se encontro Node.js. Instalalo desde https://nodejs.org y vuelve a intentarlo.
    pause
    exit /b 1
)
echo Iniciando PDF PRO en http://localhost:5173  (cierra esta ventana para detenerlo)
start "" http://localhost:5173/
node tools\serve.mjs 5173
