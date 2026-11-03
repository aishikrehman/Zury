#!/bin/bash
# Deploys or updates Zury on Toolforge. Run as the tool account:
#   ssh <you>@login.toolforge.org
#   become zury
#   ~/www/js/scripts/toolforge-deploy.sh
set -euo pipefail

APP_DIR="$HOME/www/js"
IMAGE="${ZURY_NODE_IMAGE:-node20}"

if [ ! -d "$APP_DIR/.git" ]; then
  git clone https://github.com/aishikrehman/Zury.git "$APP_DIR"
fi
cd "$APP_DIR"

if [ ! -f .env ]; then
  echo "Create $APP_DIR/.env first (see README, 'Deploying to Toolforge'), then run this again." >&2
  exit 1
fi
chmod 600 .env

git pull --ff-only

# Install and migrate inside the same container image the webservice runs in,
# so Prisma downloads the matching query engine.
webservice "$IMAGE" shell -- bash -c 'npm ci && npx prisma generate && npx prisma migrate deploy'

if webservice status | grep -q running; then
  webservice "$IMAGE" restart
else
  webservice "$IMAGE" start
fi
webservice status
