#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${CLICKSTACK_API_KEY:-}" ]]; then
  echo "CLICKSTACK_API_KEY is required." >&2
  echo "Copy it from ClickStack: Team Settings -> API Keys." >&2
  echo "Then run: export CLICKSTACK_API_KEY='<key>'" >&2
  exit 1
fi

batch_count="${1:-1}"
if ! [[ "$batch_count" =~ ^[1-9][0-9]*$ ]]; then
  echo "Usage: $0 [positive-batch-count]" >&2
  exit 1
fi

endpoint="${CLICKSTACK_OTLP_ENDPOINT:-http://localhost:4318}"
endpoint="${endpoint%/}"

for ((batch = 1; batch <= batch_count; batch++)); do
  timestamp_ns="$(date +%s)000000000"
  order_id="order-$(date +%s)-${batch}"

  curl --fail-with-body --silent --show-error \
    -X POST "${endpoint}/v1/logs" \
    -H "Authorization: ${CLICKSTACK_API_KEY}" \
    -H "Content-Type: application/json" \
    --data-binary @- <<JSON
{
  "resourceLogs": [
    {
      "resource": {
        "attributes": [
          {"key": "service.name", "value": {"stringValue": "demo-api"}},
          {"key": "deployment.environment.name", "value": {"stringValue": "local"}}
        ]
      },
      "scopeLogs": [
        {
          "scope": {"name": "clickstack-playground"},
          "logRecords": [
            {
              "timeUnixNano": "${timestamp_ns}",
              "severityNumber": 9,
              "severityText": "INFO",
              "body": {"stringValue": "checkout request started"},
              "attributes": [
                {"key": "order.id", "value": {"stringValue": "${order_id}"}},
                {"key": "http.request.method", "value": {"stringValue": "POST"}}
              ]
            },
            {
              "timeUnixNano": "${timestamp_ns}",
              "severityNumber": 13,
              "severityText": "WARN",
              "body": {"stringValue": "payment authorization retry"},
              "attributes": [
                {"key": "order.id", "value": {"stringValue": "${order_id}"}},
                {"key": "retry.count", "value": {"intValue": "1"}}
              ]
            },
            {
              "timeUnixNano": "${timestamp_ns}",
              "severityNumber": 17,
              "severityText": "ERROR",
              "body": {"stringValue": "payment authorization declined"},
              "attributes": [
                {"key": "order.id", "value": {"stringValue": "${order_id}"}},
                {"key": "error.type", "value": {"stringValue": "card_declined"}}
              ]
            }
          ]
        }
      ]
    }
  ]
}
JSON

  echo "Sent 3 logs for ${order_id}"
done
