#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${VPC_ID:?Set VPC_ID to your default VPC ID}"
: "${SUBNET_IDS:?Set SUBNET_IDS to comma-separated public subnet IDs in that VPC}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
stack="${STACK_NAME:-automl-demo}"
tag="$(date -u +%Y%m%d%H%M%S)-$(git rev-parse --short HEAD 2>/dev/null || echo init)"
aws cloudformation deploy --stack-name "$stack-registry" \
  --template-file infra/registry.yaml --no-fail-on-empty-changeset
repo=$(aws cloudformation describe-stacks --stack-name "$stack-registry" \
  --query 'Stacks[0].Outputs[?OutputKey==`RepositoryUri`].OutputValue | [0]' --output text)
aws ecr get-login-password | docker login --username AWS --password-stdin "${repo%%/*}"
docker buildx build --platform linux/amd64 --provenance=false --sbom=false \
  -t "$repo:$tag" --push .
digest=$(aws ecr describe-images --repository-name "${repo#*/}" --image-ids imageTag="$tag" \
  --query 'imageDetails[0].imageDigest' --output text)
aws cloudformation deploy --stack-name "$stack" --template-file infra/template.yaml \
  --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND --no-fail-on-empty-changeset \
  --parameter-overrides "ImageUri=$repo@$digest" "VpcId=$VPC_ID" "SubnetIds=$SUBNET_IDS" \
  "MaxWorkers=${MAX_WORKERS:-2}" "BudgetEmail=${BUDGET_EMAIL:-}"
aws cloudformation describe-stacks --stack-name "$stack" --query 'Stacks[0].Outputs' --output table
