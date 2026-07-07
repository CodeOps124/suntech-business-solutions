#!/usr/bin/env bash
# Render a space/comma list of subnet ids into the JSON-array string the
# refresh_pipeline.yaml PrivateSubnetIdsJson parameter expects.
#   ./render_subnets.sh subnet-aaa subnet-bbb  ->  ["subnet-aaa","subnet-bbb"]
set -euo pipefail
printf '['
sep=""
for s in "$@"; do printf '%s"%s"' "$sep" "$s"; sep=","; done
printf ']\n'
