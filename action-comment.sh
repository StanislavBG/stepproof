#!/usr/bin/env bash
# Post or update a stepproof results comment on a GitHub PR.
# Called from action.yml after `--format github` generates .stepproof/comment.md
#
# Required env vars: GH_TOKEN, PR_NUMBER, GITHUB_REPOSITORY

set -euo pipefail

COMMENT_FILE=".stepproof/comment.md"
MARKER="<!-- stepproof-results -->"

if [ ! -f "$COMMENT_FILE" ]; then
  echo "stepproof: No comment file found at $COMMENT_FILE — skipping PR comment."
  exit 0
fi

BODY=$(cat "$COMMENT_FILE")

if [ -z "$BODY" ]; then
  echo "stepproof: Comment file is empty — skipping PR comment."
  exit 0
fi

# Find existing stepproof comment by marker
EXISTING_COMMENT_ID=$(
  gh api \
    "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" \
    --paginate \
    --jq ".[] | select(.body | contains(\"${MARKER}\")) | .id" \
  2>/dev/null | head -1 || true
)

if [ -n "$EXISTING_COMMENT_ID" ]; then
  # Update existing comment
  gh api \
    --method PATCH \
    "repos/${GITHUB_REPOSITORY}/issues/comments/${EXISTING_COMMENT_ID}" \
    -f body="$BODY" \
    --silent
  echo "stepproof: Updated existing PR comment (id: $EXISTING_COMMENT_ID)"
else
  # Create new comment
  gh api \
    --method POST \
    "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" \
    -f body="$BODY" \
    --silent
  echo "stepproof: Posted new PR comment"
fi
