#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
stack="${STACK_NAME:-stratus-automl}"
enable_api="${ENABLE_API:-true}"
inference_mode="${INFERENCE_MODE:-lambda}"
[[ "$enable_api" == true || "$enable_api" == false ]] || { echo 'ENABLE_API must be true or false' >&2; exit 1; }
[[ "$inference_mode" == lambda || "$inference_mode" == ec2 ]] || { echo 'INFERENCE_MODE must be lambda or ec2' >&2; exit 1; }
if [[ ! "$stack" =~ ^[a-z][a-z0-9-]{2,29}$ ]]; then
  echo 'STACK_NAME must be 3–30 lowercase letters/digits/hyphens, starting with a letter.' >&2
  exit 1
fi
for cmd in aws docker node npm python3; do command -v "$cmd" >/dev/null || { echo "Missing prerequisite: $cmd" >&2; exit 1; }; done
docker info >/dev/null
aws sts get-caller-identity --query '{Account:Account,Arn:Arn}' --output table
output() {
  aws cloudformation describe-stacks --stack-name "$1" --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue | [0]" --output text
}
# Do not replace workers or inference runtimes while training deliveries are active.
if aws cloudformation describe-stacks --stack-name "$stack" >/dev/null 2>&1; then
  queue=$(output "$stack" QueueUrl)
  if [[ "$queue" != None ]]; then
    attributes=$(aws sqs get-queue-attributes --queue-url "$queue" --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible ApproximateNumberOfMessagesDelayed --query Attributes --output json)
    if ! printf '%s' "$attributes" | python3 -c 'import json,sys; sys.exit(0 if sum(map(int,json.load(sys.stdin).values())) == 0 else 1)'; then
      echo 'Training queue is not empty. Let jobs finish and pause submissions before upgrading.' >&2
      exit 1
    fi
  fi
  if [[ "$inference_mode" == ec2 ]]; then
    group=$(output "$stack" WorkerGroup)
    if [[ "$group" != None ]]; then
      # Reserve vCPU headroom for replacing the inference host. The queue was
      # checked above; submissions must stay paused throughout deployment.
      aws autoscaling set-desired-capacity --auto-scaling-group-name "$group" --desired-capacity 0
      for attempt in $(seq 1 120); do
        count=$(aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$group" --query 'length(AutoScalingGroups[0].Instances)' --output text)
        [[ "$count" == 0 ]] && break
        sleep 5
      done
      [[ "$count" == 0 ]] || { echo 'Workers did not drain; inspect scale-in protection before retrying.' >&2; exit 1; }
    fi
  fi
fi
if [[ -z "${VPC_ID:-}" && -z "${SUBNET_IDS:-}" ]]; then
  aws cloudformation deploy --stack-name "$stack-network" --template-file infra/network.yaml --no-fail-on-empty-changeset
  VPC_ID=$(output "$stack-network" VpcId)
  SUBNET_IDS=$(output "$stack-network" SubnetIds)
fi
: "${VPC_ID:?Set both VPC_ID and SUBNET_IDS, or leave both unset for automatic network creation}"
: "${SUBNET_IDS:?Set both VPC_ID and SUBNET_IDS, or leave both unset for automatic network creation}"
origin="${FRONTEND_ORIGIN:-}"
if [[ -z "$origin" && "$enable_api" == true ]]; then
  aws cloudformation deploy --stack-name "$stack-web" --template-file infra/frontend.yaml --no-fail-on-empty-changeset --parameter-overrides EnableHosting=true
  origin=$(output "$stack-web" WebUrl)
fi
origin="${origin:-http://localhost:3000}"
aws cloudformation deploy --stack-name "$stack-registry" --template-file infra/registry.yaml --no-fail-on-empty-changeset
repo=$(output "$stack-registry" RepositoryUri)
tag="$(date -u +%Y%m%d%H%M%S)-$(git rev-parse --short HEAD 2>/dev/null || echo init)"
aws ecr get-login-password | docker login --username AWS --password-stdin "${repo%%/*}"
docker buildx build --platform linux/amd64 --provenance=false --sbom=false -t "$repo:$tag" --push .
digest=$(aws ecr describe-images --repository-name "${repo#*/}" --image-ids imageTag="$tag" --query 'imageDetails[0].imageDigest' --output text)
aws cloudformation deploy --stack-name "$stack" --template-file infra/template.yaml \
  --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND --no-fail-on-empty-changeset \
  --parameter-overrides "ImageUri=$repo@$digest" "ControllerImageUri=" "InferenceImageUri=" "WorkerImageUri=" "VpcId=$VPC_ID" "SubnetIds=$SUBNET_IDS" \
  "AllowedOrigin=$origin" "WorkerInstanceType=${WORKER_INSTANCE_TYPE:-t3.large}" \
  "MaxWorkers=${MAX_WORKERS:-3}" "BudgetEmail=${BUDGET_EMAIL:-}" "EnableApi=$enable_api" \
  "ControlMemoryMB=${CONTROL_MEMORY_MB:-1024}" "PredictMemoryMB=${PREDICT_MEMORY_MB:-2048}" \
  "InferenceMode=$inference_mode" "InferenceInstanceType=${INFERENCE_INSTANCE_TYPE:-m7i-flex.large}"
if [[ "$enable_api" == false ]]; then
  aws cloudformation describe-stacks --stack-name "$stack" --query 'Stacks[0].Outputs' --output table
  echo 'Storage, queue and worker infrastructure deployed. API/Cognito/Lambda are disabled; enable after account restrictions are resolved.'
  exit 0
fi
npm --prefix frontend ci
npm --prefix frontend run build
aws cloudformation describe-stacks --stack-name "$stack" --output json | \
  python3 scripts/write_config.py --region "$AWS_DEFAULT_REGION" --output frontend/dist/config.js
if [[ -n "${FRONTEND_ORIGIN:-}" ]]; then
  printf '\nBackend deployed. Serve frontend/dist at %s (config.js contains public AWS settings).\n' "$origin"
  exit 0
fi
bucket=$(output "$stack-web" WebBucket)
distribution=$(output "$stack-web" DistributionId)
# Keep old hashed assets available during CloudFront propagation / browser sessions.
aws s3 sync frontend/dist/ "s3://$bucket/" --exclude index.html --exclude config.js --cache-control 'public,max-age=31536000,immutable'
aws s3 cp frontend/dist/index.html "s3://$bucket/index.html" --cache-control no-cache --content-type text/html
aws s3 cp frontend/dist/config.js "s3://$bucket/config.js" --cache-control no-store --content-type application/javascript
aws cloudfront create-invalidation --distribution-id "$distribution" --paths '/*' --query Invalidation.Id --output text
aws cloudformation describe-stacks --stack-name "$stack" --query 'Stacks[0].Outputs' --output table
printf '\nFrontend: %s\nCreate a Cognito user, then sign in. See docs/aws-setup.md.\n' "$origin"
