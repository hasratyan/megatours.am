import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
import { fetchTextWithDeadline } from "../lib/fetch-text-with-deadline.ts";

test("supplier deadline covers stalled bodies, releases connections, and preserves HTTP responses", async (t) => {
  let bodyClosed = false;
  const server = createServer((request, response) => {
    if (request.url === "/stalled") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write('{"hotels":[');
      response.on("close", () => { bodyClosed = true; });
      return;
    }
    if (request.url === "/error") response.statusCode = 503;
    response.end('{"ok":true}');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const start = performance.now();
  await assert.rejects(fetchTextWithDeadline(`${base}/stalled`, {}, 100), { name: "TimeoutError" });
  assert.ok(performance.now() - start < 1500, "body read should be bounded");
  // The same client must remain usable after an aborted response.
  const success = await fetchTextWithDeadline(base, {}, 1000);
  assert.equal(success.response.status, 200);
  assert.equal(success.text, '{"ok":true}');
  assert.ok(bodyClosed, "timed-out body must release its connection");
  const failure = await fetchTextWithDeadline(`${base}/error`, {}, 1000);
  assert.equal(failure.response.status, 503);
  assert.equal(failure.text, '{"ok":true}');
  await assert.rejects(fetchTextWithDeadline(base, { signal: AbortSignal.abort() }, 1000), { name: "AbortError" });
});
