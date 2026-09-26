import test from "node:test";
import assert from "node:assert/strict";
import { estimateFlatDistance } from "../physics.mjs";

const base = {
  heightM: 1.2,
  heightErrorM: 0.05,
  angleDeg: 30,
  angleErrorDeg: 1,
  maxDistanceM: 15,
};
function close(actual, expected, tolerance = 1e-10) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    actual + " != " + expected,
  );
}

test("known 45-degree geometry with zero assumed errors", () => {
  const result = estimateFlatDistance({
    ...base,
    heightM: 1,
    heightErrorM: 0,
    angleDeg: 45,
    angleErrorDeg: 0,
    maxDistanceM: 1,
  });
  assert.equal(result.valid, true);
  close(result.distanceM, 1);
  close(result.minM, 1);
  close(result.maxM, 1);
  assert.equal(result.worstCaseM, 0);
  assert.equal(result.relativeError, 0);
  assert.ok(result.assumptions.some((line) => line.includes("보장하지")));
});

test("exact interval encloses the full input rectangle without probability assumptions", () => {
  const result = estimateFlatDistance(base);
  assert.equal(result.valid, true);
  close(result.distanceM, 1.2 * Math.sqrt(3));
  close(result.minM, 1.15 / Math.tan((31 * Math.PI) / 180));
  close(result.maxM, 1.25 / Math.tan((29 * Math.PI) / 180));
  for (let hi = 0; hi <= 20; hi += 1) {
    for (let ai = 0; ai <= 20; ai += 1) {
      const distance =
        (1.15 + hi * 0.005) / Math.tan(((29 + ai * 0.1) * Math.PI) / 180);
      assert.ok(
        distance >= result.minM - 1e-12 && distance <= result.maxM + 1e-12,
      );
    }
  }
  close(
    result.worstCaseM,
    Math.max(result.distanceM - result.minM, result.maxM - result.distanceM),
  );
  close(result.relativeError, result.worstCaseM / result.distanceM);
  assert.notEqual(
    result.maxM - result.distanceM,
    result.distanceM - result.minM,
  );
});

test("distance sensitivity increases for a farther target with equal input bounds", () => {
  const nearer = estimateFlatDistance({
    ...base,
    angleDeg: (Math.atan(1.2 / 5) * 180) / Math.PI,
  });
  const farther = estimateFlatDistance({
    ...base,
    angleDeg: (Math.atan(1.2 / 10) * 180) / Math.PI,
  });
  assert.equal(nearer.valid, true);
  assert.equal(farther.valid, true);
  assert.ok(farther.worstCaseM > nearer.worstCaseM);
  assert.ok(farther.relativeError > nearer.relativeError);
});

test("rejects a measurement whose upper interval exceeds the maximum", () => {
  const result = estimateFlatDistance({
    ...base,
    heightM: 1,
    heightErrorM: 0.1,
    angleDeg: 45,
    angleErrorDeg: 1,
    maxDistanceM: 1.1,
  });
  assert.equal(result.valid, false);
  assert.match(result.reason, /최대 거리/);
  assert.equal(result.distanceM, null);
});

test("rejects unavailable sensor values, invalid types and non-finite numbers", () => {
  for (const input of [undefined, null, [], "1.2", 1.2, true, {}]) {
    assert.equal(estimateFlatDistance(input).valid, false);
  }
  for (const key of Object.keys(base)) {
    for (const value of [null, "1", NaN, Infinity, -Infinity, true]) {
      const result = estimateFlatDistance({ ...base, [key]: value });
      assert.equal(result.valid, false, key + " accepted " + value);
      for (const name of [
        "distanceM",
        "minM",
        "maxM",
        "worstCaseM",
        "relativeError",
      ]) {
        assert.equal(result[name], null);
      }
    }
  }
});

test("rejects bounds touching horizon or camera foot and overflowing geometry", () => {
  const invalidInputs = [
    { heightM: 0 },
    { heightM: -1 },
    { heightErrorM: -0.1 },
    { heightErrorM: 1.2 },
    { heightErrorM: 2 },
    { angleDeg: 0 },
    { angleDeg: -1 },
    { angleDeg: 90 },
    { angleDeg: 180 },
    { angleErrorDeg: -1 },
    { angleDeg: 1, angleErrorDeg: 1 },
    { angleDeg: 89, angleErrorDeg: 1 },
    { angleErrorDeg: 100 },
    { maxDistanceM: 0 },
    { maxDistanceM: -1 },
    { heightM: Number.MAX_VALUE, heightErrorM: Number.MAX_VALUE / 2 },
    { angleDeg: Number.MIN_VALUE, angleErrorDeg: 0 },
  ];
  for (const changes of invalidInputs) {
    assert.equal(
      estimateFlatDistance({ ...base, ...changes }).valid,
      false,
      JSON.stringify(changes),
    );
  }
});

test("default maximum is 15 metres and assumptions cannot be mutated globally", () => {
  const { maxDistanceM, ...withoutMax } = base;
  assert.deepEqual(
    estimateFlatDistance(withoutMax),
    estimateFlatDistance(base),
  );
  const first = estimateFlatDistance(base);
  first.assumptions.length = 0;
  assert.ok(estimateFlatDistance(base).assumptions.length > 0);
});
