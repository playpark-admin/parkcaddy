import test from "node:test";
import assert from "node:assert/strict";
import { summarizeAngles } from "../diagnostics.mjs";
import { normalizeContext, connectScorecard } from "../embed.mjs";
test("angle spread rejects stale/future/non-finite values and does not label accuracy", () => {
  const s = summarizeAngles(
    [
      { angleDeg: 10, timestamp: 9000 },
      { angleDeg: 12, timestamp: 9200 },
      { angleDeg: 100, timestamp: 9900 },
      { angleDeg: 50, timestamp: 4000 },
      { angleDeg: 20, timestamp: 11000 },
      { angleDeg: NaN, timestamp: 9999 },
    ],
    10000,
  );
  assert.deepEqual(s, { count: 3, medianDeg: 12, madDeg: 2 });
  assert.deepEqual(summarizeAngles([], 10000), {
    count: 0,
    medianDeg: null,
    madDeg: null,
  });
});
test("scorecard context preserves unknown holes without inventing a match", () => {
  assert.deepEqual(normalizeContext({ course: "  구장  ", hole: 7 }), {
    course: "구장",
    hole: 7,
  });
  assert.equal(normalizeContext({ hole: "7" }).hole, null);
  assert.equal(normalizeContext({ hole: 37 }).hole, null);
});
test("bridge accepts context only from actual parent exact referrer origin; messages contain no raw data", () => {
  const sent = [],
    parent = { postMessage: (data, origin) => sent.push({ data, origin }) },
    received = [];
  let listener;
  const host = {
    parent,
    document: { referrer: "https://score.example/game" },
    addEventListener: (name, fn) => (listener = fn),
  };
  const bridge = connectScorecard((c) => received.push(c), host);
  listener({
    source: parent,
    origin: "https://evil.example",
    data: { type: "parkcaddy:context", context: { course: "bad", hole: 1 } },
  });
  listener({
    source: {},
    origin: "https://score.example",
    data: { type: "parkcaddy:context", context: { course: "bad", hole: 1 } },
  });
  listener({
    source: parent,
    origin: "https://score.example",
    data: { type: "parkcaddy:context", context: { course: "good", hole: 2 } },
  });
  assert.deepEqual(received, [{ course: "good", hole: 2 }]);
  assert.equal(bridge.close(), true);
  assert.deepEqual(
    sent.map((s) => s.origin),
    ["https://score.example", "https://score.example"],
  );
  assert.deepEqual(Object.keys(sent[0].data).sort(), ["type", "version"]);
});
