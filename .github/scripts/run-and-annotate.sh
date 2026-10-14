#!/usr/bin/env bash
# Runs a command and, if it fails, repeats the end of its output as an error
# annotation. Annotations show on the run summary without signing in to GitHub,
# unlike job logs. Registered secrets are masked in both.
set -o pipefail
log=$(mktemp)
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  msg=$(tail -n 20 "$log" | sed 's/\x1b\[[0-9;]*m//g')
  msg=${msg//'%'/'%25'}
  msg=${msg//$'\r'/'%0D'}
  msg=${msg//$'\n'/'%0A'}
  echo "::error title=$1 failed::$msg"
fi
exit "$status"
