#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
.venv/bin/python -m src.preprocessing --config config.yaml --out-dir data/processed_value --require-winner
.venv/bin/python -m src.train_policy_value --config config.yaml --init-checkpoint checkpoints/best.pt --processed-dir data/processed_value --checkpoints-dir checkpoints/policy_value --num-workers 4
echo "PIPELINE_DONE"
