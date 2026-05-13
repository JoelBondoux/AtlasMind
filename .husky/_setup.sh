#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Prepare Husky hooks
npm install husky --no-save
npx husky install
