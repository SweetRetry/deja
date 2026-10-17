#!/bin/sh
#
# Walks the boundary of .githooks/commit-msg: what it accepts and what it
# rejects. Run it after editing the hook.
#
#   sh .githooks/commit-msg.test.sh

set -u

hook=$(dirname "$0")/commit-msg
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
failures=0

repeat() {
  awk -v n="$1" -v c="$2" 'BEGIN { for (i = 0; i < n; i++) printf "%s", c }'
}

check() {
  expect=$1
  name=$2
  printf '%s\n' "$3" >"$tmp/msg"
  if sh "$hook" "$tmp/msg" >"$tmp/out" 2>&1; then got=accept; else got=reject; fi
  if [ "$got" = "$expect" ]; then
    printf 'ok    %s (%s)\n' "$name" "$got"
  else
    failures=$((failures + 1))
    printf 'FAIL  %s: expected %s, got %s\n' "$name" "$expect" "$got"
    sed 's/^/      /' "$tmp/out"
  fi
}

check accept 'a feature with a body' 'feat(import): skip duplicate drops

same_bytes narrows by file size, then compares bytes.'

check accept 'a breaking change' 'refactor(vault)!: drop the legacy scan API'
check accept 'a message with no body' 'fix: keep the toast after locating'
check accept 'a scope with a slash' 'chore(hooks/ui): allow a slash in the scope'
check accept 'the longest header allowed' "feat: $(repeat 66 a)"
check accept 'a merge commit git wrote itself' 'Merge branch main'
check accept 'a line of comments only' '# a template comment
feat: add a commit hook'

check reject 'an empty message' ''
check reject 'a missing type' 'add a commit hook'
check reject 'an unknown type' 'feature: add a commit hook'
check reject 'a missing colon' 'feat add a commit hook'
check reject 'a capitalised description' 'feat: Add a commit hook'
check reject 'a trailing period' 'feat: add a commit hook.'
check reject 'a header one character over' "feat: $(repeat 67 a)"
check reject 'a missing blank line before the body' 'feat: add a hook
body with no blank line above it'
check reject 'a body line over 100 characters' "feat: add a hook

$(repeat 101 a)"
check reject 'trailing whitespace' 'feat: add a hook '
check reject 'CJK' 'feat: 增加一个提交钩子'
check reject 'an em dash' 'feat: add a hook — now enforced'

printf '\n%d case(s) failed\n' "$failures"
[ "$failures" -eq 0 ]
