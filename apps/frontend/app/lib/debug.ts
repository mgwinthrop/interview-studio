// Operator details on the live session (the response time and the session id) show only
// when its URL has ?debug=1. The flag is read from the URL each time and never stored, so it
// does not carry over to other pages. Only the exact value "1" counts; when the key repeats,
// the first value wins (URLSearchParams.get).
export function isDebug(params: Pick<URLSearchParams, "get"> | null | undefined): boolean {
  return params?.get("debug") === "1";
}
