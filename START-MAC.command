#!/bin/sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo 'Install Node.js 24 LTS from https://nodejs.org/ and run this launcher again.'
  printf 'Press Return to close. '; read -r answer; exit 1
fi
node scripts/start-local.mjs
