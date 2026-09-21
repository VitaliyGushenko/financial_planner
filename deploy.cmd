@echo off
rem Деплой в Firebase (hosting + правила Firestore) без тестов.
cd /d "%~dp0"

where firebase >nul 2>nul
if errorlevel 1 (
  echo Firebase CLI не найден. Установите: npm install -g firebase-tools
  exit /b 1
)

echo === Сборка ===
call npm run build || goto :error

echo === Деплой ===
call firebase deploy --only hosting,firestore:rules --project financial-planner-e1c41 --non-interactive || goto :error

echo Готово: https://financial-planner-e1c41.web.app
goto :eof

:error
echo Ошибка деплоя
exit /b 1
