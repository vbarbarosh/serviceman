#!/usr/bin/env bash
set -euo pipefail

result="${1:-ok}"
if [[ "$result" != "ok" && "$result" != "error" ]]; then
  echo "Usage: $0 [ok|error]" >&2
  exit 1
fi

log_file="${LOG_FILE:-log-input/application.log}"
mkdir -p "$(dirname "$log_file")"

run_id="$(date -u +%Y%m%dT%H%M%S)-$$-$RANDOM"
root_uid="export-${run_id}"
child_uid="clean-${run_id}"

append_log() {
  local group_uid="$1"
  local subject="$2"
  local description="${3:-}"
  local timestamp
  timestamp="$(date -u '+%Y/%m/%d %H:%M:%S')"

  if [[ -n "$description" ]]; then
    printf '%s [%s][%s] %s\n' "$timestamp" "$group_uid" "$subject" "$description" >> "$log_file"
  else
    printf '%s [%s][%s]\n' "$timestamp" "$group_uid" "$subject" >> "$log_file"
  fi
}

append_log "$root_uid" export_html5_begin "preset=web"
sleep 1
append_log "$child_uid" spawn "parent=${root_uid}"
sleep 1
append_log "$child_uid" cronjob_clean_begin
sleep 1
append_log "$child_uid" cronjob_clean_tick "removed=42"
sleep 1

if [[ "$result" == "ok" ]]; then
  append_log "$child_uid" cronjob_clean_end_ok
  sleep 1
  append_log "$root_uid" export_html5_progress "percent=100"
  sleep 1
  append_log "$root_uid" export_html5_end_ok
else
  append_log "$child_uid" cronjob_clean_end_error "reason=disk_full"
fi

echo "Appended demo run to ${log_file}"
echo "root group:  ${root_uid}"
echo "child group: ${child_uid}"
