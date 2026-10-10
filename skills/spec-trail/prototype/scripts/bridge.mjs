// Optional browser-only host helper. Call after the prototype is interactive.
/** @param {{version: string, status?: "ready" | "error", message?: string}} options */
export function connectPreview({ version, status = "ready", message }) {
  const listener = (event) => {
    const data = event.data;
    if (
      event.source !== window.parent ||
      data?.type !== "openfolio:preview:init" ||
      typeof data.requestId !== "string" ||
      data.requestId.length > 200
    )
      return;
    window.parent.postMessage(
      {
        type: "openfolio:preview:status",
        requestId: data.requestId,
        version,
        status,
        ...(message ? { message: String(message).slice(0, 300) } : {}),
      },
      "*",
    );
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
