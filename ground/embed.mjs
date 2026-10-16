// Only the actual embedding parent, identified by the browser referrer, may send context.
export function normalizeContext(value) {
  if (!value || typeof value !== "object") return { course: "", hole: null };
  const course =
    typeof value.course === "string" ? value.course.trim().slice(0, 80) : "";
  const hole =
    Number.isInteger(value.hole) && value.hole >= 1 && value.hole <= 36
      ? value.hole
      : null;
  return { course, hole };
}
export function connectScorecard(onContext, host = window) {
  if (host.parent === host)
    return { embedded: false, send: () => false, close: () => false };
  let origin;
  try {
    const ref = new URL(host.document.referrer);
    if (!["https:", "http:"].includes(ref.protocol)) throw new Error();
    origin = ref.origin;
  } catch {
    return { embedded: true, send: () => false, close: () => false };
  }
  const send = (type) => {
    host.parent.postMessage({ type, version: 1 }, origin);
    return true;
  };
  host.addEventListener("message", (e) => {
    if (
      e.source !== host.parent ||
      e.origin !== origin ||
      e.data?.type !== "parkcaddy:context"
    )
      return;
    onContext(normalizeContext(e.data.context));
  });
  send("parkcaddy:ready");
  return { embedded: true, send, close: () => send("parkcaddy:close") };
}
