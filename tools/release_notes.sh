#!/usr/bin/env bash
# Release notes for VERSION (v1.2.3 or v1.2.3-beta.1) from the commit subjects since the
# previous release, as Markdown on stdout. Used by .github/workflows/release.yml instead of
# GitHub's generated notes, which list merged pull requests (this project has none).
#   tools/release_notes.sh v0.2.0 > notes.md
# Previous release: for a stable version the previous stable tag (so its notes cover all of
# its betas); for a beta the previous tag of any kind. Only tags on HEAD's history count.
# Needs the tags (actions/checkout with fetch-depth: 0). Env: GITHUB_SERVER_URL and
# GITHUB_REPOSITORY for the compare link (set in GitHub Actions).
set -euo pipefail
VERSION="${1:?usage: release_notes.sh VERSION}"
case "$VERSION" in
  *-*) PAT='^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$'; BETA=1 ;;
  *) PAT='^v[0-9]+\.[0-9]+\.[0-9]+$'; BETA= ;;
esac
# versionsort.suffix=-: v1.2.0-beta.3 sorts before v1.2.0
PREV=$(git -c versionsort.suffix=- tag --merged HEAD --sort=-v:refname |
  grep -E "$PAT" | grep -vxF "$VERSION" | head -n 1 || true)

if [ -n "$BETA" ]; then
  echo "Beta (pre-release): offered on the settings page only with **Beta versions** on,"
  echo "and in the Shelly script library from the \`library-beta\` branch."
  echo
fi
if [ -z "$PREV" ]; then
  echo "## Changes"
  echo
  git log --no-merges --format='- %s (%h)' HEAD
  exit 0
fi
echo "## Changes since $PREV"
echo
CHANGES=$(git log --no-merges --format='- %s (%h)' "$PREV..HEAD")
if [ -n "$CHANGES" ]; then
  echo "$CHANGES"
else
  echo "No code changes: the same build as $PREV, under a new version."
fi
if [ -n "${GITHUB_REPOSITORY:-}" ]; then
  echo
  echo "**Full diff**: ${GITHUB_SERVER_URL:-https://github.com}/$GITHUB_REPOSITORY/compare/$PREV...$VERSION"
fi
