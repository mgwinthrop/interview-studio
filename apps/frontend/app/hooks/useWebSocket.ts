"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Phase, TranscriptEntry, ServerMessage, ClientMessage } from "../types";

export type ConnectionState = "connecting" | "connected" | "disconnected" | "error";

interface UseWebSocketReturn {
  connectionState: ConnectionState;
  phase: Phase;
  transcript: TranscriptEntry[];
  aiSpeaking: boolean;
  sessionComplete: { reportId: string } | null;
  sessionId: string;
  lastLatencyMs: number | null;
  sendMessage: (msg: ClientMessage) => void;
  reconnect: () => void;
}

export function useWebSocket(
  topicId: string,
  demo: boolean,
  onAudioChunk?: (chunk: ArrayBuffer) => void,
  onTtsEnd?: () => void,
  onSttError?: () => void
): UseWebSocketReturn {
  // Generate sessionId once — stable across StrictMode double-mount
  const [sessionId] = useState<string>(() => crypto.randomUUID());

  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [phase, setPhase] = useState<Phase>("intro");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [sessionComplete, setSessionComplete] = useState<{ reportId: string } | null>(null);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  // Tracks the id of the pending partial assistant entry so subsequent partials
  // update it in place rather than appending new entries (spec §7 streaming transcript).
  const pendingAssistantIdRef = useRef<string | null>(null);
  // Tracks the id of the most recently added assistant entry. Used to re-attach
  // partial transcripts when a non-partial arrives before the partials (race condition
  // where backend sends final transcript then partials, causing a duplicate entry).
  const lastAiEntryIdRef = useRef<string | null>(null);
  // Reconnect: trigger re-run of the WS setup effect
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

    // tts_end is suppressed on the server when TTS is aborted (ttsStream.ts),
    // so reset aiSpeaking immediately on the client side instead of waiting.
    if (msg.type === "interrupt") {
      setAiSpeaking(false);
      pendingAssistantIdRef.current = null;
      lastAiEntryIdRef.current = null;
    }
  }, []);

  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
    if (!wsUrl || !topicId) {
      console.error(!wsUrl ? "NEXT_PUBLIC_WS_URL is not set" : "topicId is required");
      setConnectionState("error");
      return;
    }

    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer"; // ensures binary frames arrive as ArrayBuffer, not Blob
    wsRef.current = ws;
    setConnectionState("connecting");

    ws.onopen = () => {
      setConnectionState("connected");
      const startMsg: ClientMessage = {
        type: "session_start",
        sessionId,
        topicId,
        phase: "intro",
        demo,
      };
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

        case "session_complete":
          setSessionComplete({ reportId: msg.reportId });
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

    ws.onclose = () => {
      // Suppress "disconnected" during deliberate closes (reconnect, unmount) to
      // avoid a flash of the error overlay between cleanup and the new WS opening.
      if (!deliberateCloseRef.current) {
        setConnectionState("disconnected");
      }
      deliberateCloseRef.current = false;
    };

    return () => {
      deliberateCloseRef.current = true; // suppress onclose on cleanup
      ws.close();
      wsRef.current = null;
    };
    // sessionId is stable; demo/topicId are read once at mount — intentional
    // reconnectTrigger increments on explicit reconnect; re-reads same sessionId/topicId/demo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, reconnectTrigger]);

  return {
    connectionState,
    phase,
    transcript,
    aiSpeaking,
    sessionComplete,
    sessionId,
    lastLatencyMs,
    sendMessage,
    reconnect,
  };
}
