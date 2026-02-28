#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

npm version patch --no-git-tag-version
git add .
git commit -m "upgrade"
git push
npm publish
