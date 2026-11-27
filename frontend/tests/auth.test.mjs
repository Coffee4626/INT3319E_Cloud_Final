import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const storage = new Map();
globalThis.sessionStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
globalThis.location = { hostname: "studio.example.com", origin: "https://studio.example.com", pathname: "/app", search: "" };
globalThis.window = Object.assign(new EventTarget(), {
  STRATUS_CONFIG: { local: false, apiUrl: "https://api.example.com/prod", region: "ap-southeast-2",
    clientId: "client", cognitoDomain: "https://login.example.com" },
});
const { signedIn, verifySession, api, completeSignIn } = await import("../src/api.ts");
const valid = () => sessionStorage.setItem("stratus.tokens", JSON.stringify({
  id_token: "header.payload.signature", refresh_token: "refresh", expires_at: Date.now() + 600_000,
}));
beforeEach(() => {
  storage.clear();
  location.search = "";
  globalThis.fetch = async () => { throw new Error("Unexpected network request"); };
});

test("Anonymous and malformed sessions do not unlock the workspace", async () => {
  assert.equal(signedIn(), false);
  assert.equal(await verifySession(), false);
  for (const value of ["{}", "null", "broken", JSON.stringify({ id_token: "invalid" })]) {
    sessionStorage.setItem("stratus.tokens", value);
    assert.equal(signedIn(), false);
  }
});
test("Stored credentials are validated against the authenticated API", async () => {
  valid();
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.example.com/prod/health");
    assert.equal(options.headers.Authorization, "header.payload.signature");
    return Response.json({ status: "ok" });
  };
  assert.equal(await verifySession(), true);
});
test("A rejected session is cleared and notifies the workspace gate", async () => {
  valid();
  let expired = false;
  window.addEventListener("stratus:session-expired", () => { expired = true; }, { once: true });
  globalThis.fetch = async () => Response.json({ message: "Unauthorized" }, { status: 401 });
  await assert.rejects(verifySession(), /đăng nhập lại/);
  assert.equal(signedIn(), false);
  assert.equal(expired, true);
});
test("A wrong prediction key does not sign out an authenticated owner", async () => {
  valid();
  globalThis.fetch = async () => Response.json({ error: "Invalid key" }, { status: 401 });
  await assert.rejects(api("/predict/model", { rows: [] }, "POST", "wrong"));
  assert.equal(signedIn(), true);
});
test("Login restores workspace links and rejects external return destinations", async () => {
  for (const [destination, expected] of [["/app/new?task=regression", "/app/new?task=regression"], ["//external.example", "/app"]]) {
    sessionStorage.setItem("stratus.pkce", JSON.stringify({ state: "expected", verifier: "verifier" }));
    sessionStorage.setItem("stratus.returnTo", destination);
    location.search = "?state=expected&code=code";
    let restored;
    globalThis.history = { replaceState: (_, __, path) => { restored = path; } };
    globalThis.fetch = async () => Response.json({ id_token: "header.payload.signature", refresh_token: "refresh", expires_in: 3600 });
    await completeSignIn();
    assert.equal(restored, expected);
  }
});

test("Dataset preparation polls its result ID and propagates failures", async () => {
  valid();
  const { waitForDataset } = await import('../src/api.ts');
  let calls = 0;
  globalThis.fetch = async url => {
    assert.ok(String(url).endsWith('/datasets/prepared-id'));
    calls++;
    return Response.json({dataset_id: 'prepared-id', status: 'READY', prepared: true});
  };
  const ready = await waitForDataset({dataset_id: 'prepared-id', status: 'PROCESSING'});
  assert.equal(ready.prepared, true);
  assert.equal(calls, 1);
  await assert.rejects(waitForDataset({status: 'FAILED', error: 'CSV limit: 100,000 rows'}), /100,000 rows/);
});
