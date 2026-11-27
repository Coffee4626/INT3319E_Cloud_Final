"""Read-only readiness checks; never changes quotas, account plans or resources."""
import json
import os
import subprocess
import sys


def aws(*args):
    result = subprocess.run(["aws", *args, "--output", "json", "--no-cli-pager"],
                            capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return json.loads(result.stdout or '{}')


failures = []
try:
    identity = aws("sts", "get-caller-identity")
    print("Account:", identity["Account"])
except (RuntimeError, OSError) as exc:
    sys.exit(str(exc))
try:
    limits = aws("lambda", "get-account-settings")["AccountLimit"]
    print(f"Lambda: accessible; concurrency quota = {limits['ConcurrentExecutions']}")
    print("Lambda memory limits are not exposed by GetAccountSettings; creation must still be checked.")
except RuntimeError as exc:
    failures.append("Lambda: " + str(exc))
try:
    quota = aws("service-quotas", "get-service-quota", "--service-code", "ec2", "--quota-code", "L-1216C47A")["Quota"]["Value"]
    kind = os.getenv("WORKER_INSTANCE_TYPE", "t3.large")
    types = aws("ec2", "describe-instance-types", "--instance-types", kind)
    required = types["InstanceTypes"][0]["VCpuInfo"]["DefaultVCpus"] * int(os.getenv("MAX_WORKERS", "2"))
    if os.getenv("INFERENCE_MODE", "lambda") == "ec2":
        inference_kind = os.getenv("INFERENCE_INSTANCE_TYPE", "m7i-flex.large")
        inference = aws("ec2", "describe-instance-types", "--instance-types", inference_kind)
        required += inference["InstanceTypes"][0]["VCpuInfo"]["DefaultVCpus"]
        print(f"Inference host: {inference_kind}; workers drain before runtime replacement.")
    print(f"EC2 Standard quota: {quota:g} vCPU; project maximum needs {required} vCPU")
    if quota < required:
        failures.append("EC2 quota is insufficient; resolve through Service Quotas / AWS Support.")
except (RuntimeError, KeyError, ValueError) as exc:
    failures.append("EC2 readiness: " + str(exc))
for failure in failures:
    print("BLOCKED:", failure, file=sys.stderr)
print("Actual EC2 launch and Lambda creation still require deployment checks. CloudFront is optional with external frontend hosting.")
sys.exit(1 if failures else 0)
