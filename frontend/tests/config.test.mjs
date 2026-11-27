import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRuntimeConfig } from "../scripts/write-runtime-config.mjs";

const env = {
  STRATUS_API_URL: "https://example.execute-api.ap-southeast-2.amazonaws.com/prod/",
  STRATUS_AWS_REGION: "ap-southeast-2",
  STRATUS_COGNITO_CLIENT_ID: "publicclient123",
  STRATUS_COGNITO_DOMAIN: "https://example.auth.ap-southeast-2.amazoncognito.com/",
};

test("Build without overrides retains the checked-in public config", () => {
  assert.equal(buildRuntimeConfig({}), null);
});
test("Cloud build can describe EC2 inference and rejects invalid modes", () => {
  assert.equal(buildRuntimeConfig({ ...env, STRATUS_INFERENCE_MODE: "ec2" }).inferenceMode, "ec2");
  assert.throws(() => buildRuntimeConfig({ ...env, STRATUS_INFERENCE_MODE: "public" }));
});
test("Cloud build preserves the API stage and includes only public settings", () => {
  assert.deepEqual(buildRuntimeConfig({ ...env, AWS_SECRET_ACCESS_KEY: "never-export" }), {
    apiUrl: "https://example.execute-api.ap-southeast-2.amazonaws.com/prod",
    region: "ap-southeast-2",
    clientId: "publicclient123",
    cognitoDomain: "https://example.auth.ap-southeast-2.amazoncognito.com",
    local: false,
  });
});
test("Partial cloud settings fail instead of silently falling back to local", () => {
  assert.throws(() => buildRuntimeConfig({ STRATUS_API_URL: env.STRATUS_API_URL }), /STRATUS_COGNITO_CLIENT_ID/);
});
test("Cloud settings reject HTTP, credentials, URL parameters and Cognito paths", () => {
  for (const apiUrl of ["http://localhost:8000", "https://user:pass@example.com", "https://example.com?key=secret", "https://example.com#fragment"]) {
    assert.throws(() => buildRuntimeConfig({ ...env, STRATUS_API_URL: apiUrl }));
  }
  assert.throws(() => buildRuntimeConfig({ ...env, STRATUS_COGNITO_DOMAIN: env.STRATUS_COGNITO_DOMAIN + "login" }));
});
