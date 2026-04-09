#!/usr/bin/env bash
set -euo pipefail

# Pull latest changes and publish Public_html to the live web root.
# Usage:
#   bash scripts/deploy-on-pi.sh
# Optional overrides:
#   BRANCH=main REPO_DIR=/home/david/repos/publicLandingPage SITE_TARGET_DIR=/var/www/farawayfound bash scripts/deploy-on-pi.sh

BRANCH="${BRANCH:-main}"
REPO_DIR="${REPO_DIR:-$HOME/repos/publicLandingPage}"
SITE_SOURCE_DIR="${SITE_SOURCE_DIR:-Public_html}"
SITE_TARGET_DIR="${SITE_TARGET_DIR:-/var/www/farawayfound}"

TIMESTAMP="$(date '+%Y-%m-%d %H:%M:%S')"
echo "[$TIMESTAMP] Starting deployment"
echo "  branch: $BRANCH"
echo "  repo:   $REPO_DIR"
echo "  source: $SITE_SOURCE_DIR"
echo "  target: $SITE_TARGET_DIR"

if [[ ! -d "$REPO_DIR/.git" ]]; then
  echo "ERROR: REPO_DIR is not a git repo: $REPO_DIR" >&2
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "ERROR: rsync is required but not installed." >&2
  exit 1
fi

cd "$REPO_DIR"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

if [[ ! -d "$SITE_SOURCE_DIR" ]]; then
  echo "ERROR: Source directory not found: $REPO_DIR/$SITE_SOURCE_DIR" >&2
  exit 1
fi

sudo mkdir -p "$SITE_TARGET_DIR"
sudo rsync -av --delete "$SITE_SOURCE_DIR"/ "$SITE_TARGET_DIR"/

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Deployment complete"
