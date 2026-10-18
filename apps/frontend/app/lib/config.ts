/**
 * Derive the backend HTTP API URL from the WebSocket URL.
 * wss:// → https://   ws:// → http://
 * Single source of truth: NEXT_PUBLIC_WS_URL.
 */
export const apiUrl =
  process.env.NEXT_PUBLIC_WS_URL
    ?.replace(/^wss:/, "https:")
    .replace(/^ws:/, "http:") ?? "";
