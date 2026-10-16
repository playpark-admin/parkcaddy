/**
 * Conditional flat-ground geometry. Distances are metres; input angles degrees.
 * Error inputs are absolute +/- bounds, NOT standard deviations, confidence
 * intervals, measured sensor accuracy, or a precision guarantee.
 */
const ASSUMPTIONS = Object.freeze([
  "카메라 바로 아래 지면과 조준점이 같은 수평면에 있다는 평지 가정입니다.",
  "높이는 지면부터 카메라 렌즈 중심까지, 각도는 수평선 아래 조준각입니다.",
  "입력한 ±높이·각도 오차가 실제 오차를 모두 포함한다는 조건부 범위입니다.",
  "±입력은 표준편차나 95% 신뢰구간이 아닙니다. 실제 기기 정확도를 보장하지 않습니다.",
  "렌즈·광축·센서 보정, 흔들림, 조준 오차는 입력 범위 안에 포함되어야 합니다.",
  "지면의 높낮이·경사·굴곡을 측정하거나 복원한 결과가 아닙니다.",
]);

function invalid(reason) {
  return {
    valid: false,
    reason,
    distanceM: null,
    minM: null,
    maxM: null,
    worstCaseM: null,
    relativeError: null,
    assumptions: [...ASSUMPTIONS],
  };
}

/**
 * d = h * cot(alpha), where alpha is depression below the horizon.
 * On h > 0 and 0 < alpha < 90 degrees, d increases with h and decreases
 * with alpha. Opposite rectangle corners give exact analytical extrema.
 * Floating-point evaluation is not certified interval arithmetic.
 * A non-flat surface invalidates the physical model.
 *
 * @param {object} input
 * @param {number} input.heightM Positive lens height above local ground, metres.
 * @param {number} input.heightErrorM Nonnegative absolute height bound, metres.
 * @param {number} input.angleDeg Depression below horizon, degrees.
 * @param {number} input.angleErrorDeg Nonnegative absolute angle bound, degrees.
 * @param {number} [input.maxDistanceM=15] Operational upper limit, metres.
 * @returns {{valid:boolean,reason:string,distanceM:number|null,minM:number|null,
 * maxM:number|null,worstCaseM:number|null,relativeError:number|null,
 * assumptions:string[]}}
 */
export function estimateFlatDistance(input = {}) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return invalid("측정 입력은 숫자 단위를 갖춘 객체여야 합니다.");
  }
  const {
    heightM,
    heightErrorM,
    angleDeg,
    angleErrorDeg,
    maxDistanceM = 15,
  } = input;
  const values = [heightM, heightErrorM, angleDeg, angleErrorDeg, maxDistanceM];
  if (
    !values.every(
      (value) => typeof value === "number" && Number.isFinite(value),
    )
  ) {
    return invalid(
      "높이·거리는 m, 각도는 ° 단위의 유한한 숫자로 입력해 주세요.",
    );
  }
  if (heightM <= 0 || maxDistanceM <= 0) {
    return invalid("카메라 높이와 최대 거리는 0보다 커야 합니다.");
  }
  if (heightErrorM < 0 || angleErrorDeg < 0) {
    return invalid("±오차 범위는 0 이상의 숫자여야 합니다.");
  }

  const minHeight = heightM - heightErrorM;
  const maxHeight = heightM + heightErrorM;
  const minAngle = angleDeg - angleErrorDeg;
  const maxAngle = angleDeg + angleErrorDeg;
  if (!Number.isFinite(maxHeight) || minHeight <= 0) {
    return invalid("±오차를 포함한 카메라 높이 전체가 0m보다 커야 합니다.");
  }
  if (minAngle <= 0 || maxAngle >= 90 || !Number.isFinite(maxAngle)) {
    return invalid(
      "±오차를 포함한 조준각 전체가 수평선 아래 0° 초과, 90° 미만이어야 합니다.",
    );
  }

  const radians = Math.PI / 180;
  const distanceM = heightM / Math.tan(angleDeg * radians);
  const minM = minHeight / Math.tan(maxAngle * radians);
  const maxM = maxHeight / Math.tan(minAngle * radians);
  if (
    ![distanceM, minM, maxM].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  ) {
    return invalid(
      "입력 범위에서 안정적인 거리 계산이 불가능합니다. 조준각과 단위를 확인해 주세요.",
    );
  }
  // Numerical rounding only; this is not a measurement-error allowance.
  const roundingTolerance = 8 * Number.EPSILON * Math.max(maxM, maxDistanceM);
  if (maxM - maxDistanceM > roundingTolerance) {
    return invalid(
      "±오차를 포함한 거리 상한이 설정한 최대 거리를 넘습니다. 더 가까운 지점을 조준해 주세요.",
    );
  }
  const worstCaseM = Math.max(distanceM - minM, maxM - distanceM);
  const relativeError = worstCaseM / distanceM;
  if (!Number.isFinite(worstCaseM) || !Number.isFinite(relativeError)) {
    return invalid("입력 범위에서 안정적인 오차 계산이 불가능합니다.");
  }
  return {
    valid: true,
    reason: "",
    distanceM,
    minM,
    maxM,
    worstCaseM,
    relativeError,
    assumptions: [...ASSUMPTIONS],
  };
}
