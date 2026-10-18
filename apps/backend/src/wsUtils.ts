import { WebSocket } from "ws";
import type { ServerToClientMessage } from "./types";

// Send a typed JSON message. tts_chunk is excluded — it is sent as a raw binary frame.
export function send(ws: WebSocket, payload: Exclude<ServerToClientMessage, { type: "tts_chunk" }>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}
