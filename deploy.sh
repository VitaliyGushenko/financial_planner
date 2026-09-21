#!/usr/bin/env bash
# Деплой в Firebase (hosting + правила Firestore).
# Использование: ./deploy.sh [--skip-tests]
set -e

cd "$(dirname "$0")"

if ! command -v firebase >/dev/null 2>&1; then
  echo "Firebase CLI не найден. Установите: npm install -g firebase-tools"
  exit 1
fi

if ! firebase projects:list --project financial-planner-e1c41 >/dev/null 2>&1; then
  echo "Нужно войти: firebase login"
  exit 1
fi

if [ "$1" != "--skip-tests" ]; then
  echo "=== Тесты ==="
  npm run deploy:tests
fi

echo "=== Сборка ==="
npm run build

echo "=== Деплой ==="
firebase deploy --only hosting,firestore:rules --project financial-planner-e1c41 --non-interactive

echo "Готово: https://financial-planner-e1c41.web.app"
