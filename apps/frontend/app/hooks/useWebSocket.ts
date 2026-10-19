"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { TranscriptEntry, ServerMessage, ClientMessage } from "../types";
import type { InterviewerInput } from "../lib/interviewers";

export type ConnectionState = "connecting" | "connected" | "disconnected" | "error";

/** Short user-facing explanations for server close codes (see docs/websocket-protocol.md). */
const CLOSE_REASONS: Record<number, string> = {
  1013: "Too many active conversations. Close another tab, then start over.",
  1008: "The server rejected the request. Start over.",
  1009: "The audio or message was too large. Start over.",
  1001: "The conversation timed out from inactivity. Start over.",
};

interface UseWebSocketReturn {
  connectionState: ConnectionState;
  /** Current phase name from the last phase_change; "" until the first one arrives. */
  phase: string;
  transcript: TranscriptEntry[];
  aiSpeaking: boolean;
  sessionComplete: { reportId: string } | null;
  /** True once the server reports the session ended as failed (no report). */
  sessionFailed: boolean;
  /** Server-issued id from session_started; "" until it arrives. */
  sessionId: string;
  lastLatencyMs: number | null;
  /** Specific explanation for the last unexpected close, or null for the generic message. */
  closeReason: string | null;
  /** The drafted interviewer from a designer session's draft message; null until it arrives. */
  draft: InterviewerInput | null;
  sendMessage: (msg: ClientMessage) => void;
  reconnect: () => void;
}

/**
 * `start` names what the session runs: a string is an interviewerId, an object is an unsaved
 * draft (Try it). It is read when the socket opens, so a new object identity on a later render
 * never reopens the socket; only reconnect() does.
 */
export function useWebSocket(
  start: string | InterviewerInput,
  demo: boolean,
  onAudioChunk?: (chunk: ArrayBuffer) => void,
  onTtsEnd?: () => void,
  onSttError?: () => void
): UseWebSocketReturn {
  // The server issues the session id in session_started. Every connection is a new session.
  const [sessionId, setSessionId] = useState<string>("");
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [phase, setPhase] = useState<string>("");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [sessionComplete, setSessionComplete] = useState<{ reportId: string } | null>(null);
  const [sessionFailed, setSessionFailed] = useState(false);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [closeReason, setCloseReason] = useState<string | null>(null);
  const [draft, setDraft] = useState<InterviewerInput | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  // Tracks the id of the pending partial assistant entry so subsequent partials
  // update it in place rather than appending new entries (spec §7 streaming transcript).
  const pendingAssistantIdRef = useRef<string | null>(null);
  // Tracks the id of the most recently added assistant entry. Used to re-attach
  // partial transcripts when a non-partial arrives before the partials (race condition
  // where backend sends final transcript then partials, causing a duplicate entry).
  const lastAiEntryIdRef = useRef<string | null>(null);
  // Reconnect: trigger re-run of the WS setup effect. The server does not resume sessions,
  // so a reconnect starts a new conversation with a new server-issued id.
  const [reconnectTrigger, setReconnectTrigger] = useState(0);
  // Prevents the onclose handler from setting "disconnected" during deliberate closes
  // (reconnect and unmount) — avoids a brief flash of the error overlay.
  const deliberateCloseRef = useRef(false);

  const reconnect = useCallback(() => {
    deliberateCloseRef.current = true;
    setConnectionState("connecting"); // snap immediately so overlay disappears
    setReconnectTrigger((t) => t + 1);
  }, []);

  const sendMessage = useCallback((msg: ClientMessage) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    if (msg.type === "audio") {
      // Send PCM16 as raw binary frame — backend detects via isBinary flag
      wsRef.current.send(msg.data);
    } else {
      // All other messages as typed JSON (AGENTS.md WS protocol rule)
      wsRef.current.send(JSON.stringify(msg));
    }

    // tts_end is suppressed on the server when TTS is aborted (session controller),
    // so reset aiSpeaking immediately on the client side instead of waiting.
    if (msg.type === "interrupt") {
      setAiSpeaking(false);
      pendingAssistantIdRef.current = null;
      lastAiEntryIdRef.current = null;
    }
  }, []);

  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
    if (!wsUrl || !start) {
      console.error(!wsUrl ? "NEXT_PUBLIC_WS_URL is not set" : "interviewerId is required");
      setConnectionState("error");
      return;
    }

    // A new connection is a new session: clear everything from the previous one.
    setSessionId("");
    setPhase("");
    setTranscript([]);
    setAiSpeaking(false);
    setSessionComplete(null);
    setSessionFailed(false);
    setLastLatencyMs(null);
    setCloseReason(null);
    setDraft(null);
    pendingAssistantIdRef.current = null;
    lastAiEntryIdRef.current = null;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer"; // ensures binary frames arrive as ArrayBuffer, not Blob
    wsRef.current = ws;
    setConnectionState("connecting");

    ws.onopen = () => {
      setConnectionState("connected");
      const startMsg: ClientMessage =
        typeof start === "string"
          ? { type: "session_start", interviewerId: start, demo }
          : { type: "session_start", draft: start, demo };
      ws.send(JSON.stringify(startMsg));
    };

    // Keep stable refs so closures always call the latest version
    const onAudioChunkRef = { current: onAudioChunk };
    const onTtsEndRef = { current: onTtsEnd };
    const onSttErrorRef = { current: onSttError };

    ws.onmessage = (event) => {
      // Binary frames are TTS audio chunks — forward to audio queue
      if (event.data instanceof ArrayBuffer) {
        onAudioChunkRef.current?.(event.data);
        return;
      }

      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case "tts_start":
          setAiSpeaking(true);
          break;

        case "tts_end":
          onTtsEndRef.current?.(); // decode trailing buffered chunks
          setAiSpeaking(false);
          break;

        case "transcript":
          if (msg.partial && msg.role === "assistant") {
            if (pendingAssistantIdRef.current === null) {
              if (lastAiEntryIdRef.current !== null) {
                // A non-partial arrived before the partials — re-attach to that entry
                // instead of creating a duplicate.
                pendingAssistantIdRef.current = lastAiEntryIdRef.current;
              } else {
                const id = crypto.randomUUID();
                pendingAssistantIdRef.current = id;
                lastAiEntryIdRef.current = id;
                setTranscript((prev) => [...prev, { id, role: "assistant", content: msg.text }]);
              }
            }
            // Update the (possibly just re-attached) pending entry
            if (pendingAssistantIdRef.current !== null) {
              const id = pendingAssistantIdRef.current;
              setTranscript((prev) =>
                prev.map((e) => (e.id === id ? { ...e, content: msg.text } : e))
              );
            }
          } else if (msg.role === "assistant" && pendingAssistantIdRef.current !== null) {
            // Final non-partial: confirm the pending entry with clean text, clear ref
            const id = pendingAssistantIdRef.current;
            pendingAssistantIdRef.current = null;
            setTranscript((prev) =>
              prev.map((e) => (e.id === id ? { ...e, content: msg.text } : e))
            );
          } else if (msg.role === "assistant") {
            // Non-partial with no pending entry (arrives before partials) — create the
            // entry and record its id so partials can re-attach rather than duplicate.
            const id = crypto.randomUUID();
            lastAiEntryIdRef.current = id;
            setTranscript((prev) => [...prev, { id, role: "assistant", content: msg.text }]);
          } else {
            // User transcript — reset AI entry tracking for the new turn
            lastAiEntryIdRef.current = null;
            setTranscript((prev) => [
              ...prev,
              { id: crypto.randomUUID(), role: msg.role, content: msg.text },
            ]);
          }
          break;

        case "phase_change":
          setPhase(msg.phase);
          break;

        case "session_started":
          setSessionId(msg.sessionId);
          break;

        case "session_complete":
          setSessionComplete({ reportId: msg.reportId });
          break;

        case "session_failed":
          // The server closes the socket next; the page shows the failure state.
          setAiSpeaking(false);
          setSessionFailed(true);
          break;

        case "draft":
          // Designer sessions only; session_complete follows.
          setDraft(msg.draft);
          break;

        case "latency_metric":
          setLastLatencyMs(msg.ms);
          break;

        case "stt_error":
          onSttErrorRef.current?.();
          break;
      }
    };

    ws.onerror = () => {
      setConnectionState("error");
    };

    ws.onclose = (event) => {
      // Suppress "disconnected" during deliberate closes (reconnect, unmount) to
      // avoid a flash of the error overlay between cleanup and the new WS opening.
      if (!deliberateCloseRef.current) {
        setCloseReason(CLOSE_REASONS[event.code] ?? null);
        setConnectionState("disconnected");
      }
      deliberateCloseRef.current = false;
    };

    return () => {
      deliberateCloseRef.current = true; // suppress onclose on cleanup
      ws.close();
      wsRef.current = null;
    };
    // demo/start are read when the socket opens (mount or reconnect), never on re-render — intentional.
    // reconnectTrigger increments on explicit reconnect, which opens a new session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconnectTrigger]);

  return {
    connectionState,
    phase,
    transcript,
    aiSpeaking,
    sessionComplete,
    sessionFailed,
    sessionId,
    lastLatencyMs,
    closeReason,
    draft,
    sendMessage,
    reconnect,
  };
}
