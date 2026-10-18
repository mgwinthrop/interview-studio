"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useWebSocket } from "../hooks/useWebSocket";
import { useVAD } from "../../hooks/useVAD";
import { AudioQueue } from "../../lib/audioQueue";
import { Nav } from "../components/Nav";
import { PhaseStrip } from "../components/PhaseStrip";
import { AgentPanel } from "../components/AgentPanel";
import { LiveTranscript } from "../components/LiveTranscript";
import { getTopicConfig } from "../lib/topics";
import type { OrbState } from "../types";

// Inner component — must be inside <Suspense> because it calls useSearchParams()
function SessionPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const topicId = searchParams.get("topicId") ?? "";
  const demo = searchParams.get("demo") === "true";

  // Guard: redirect to persona selection if topicId is missing or unrecognised
  useEffect(() => {
    if (!getTopicConfig(topicId)) {
      router.replace("/");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // runs once on mount — topicId doesn't change during a session

  // Track actual playback, including buffered speech after tts_end.
  const [audioPlaying, setAudioPlaying] = useState(false);
  const audioQueueRef = useRef<AudioQueue | null>(null);
  useEffect(() => {
    const queue = new AudioQueue(setAudioPlaying);
    audioQueueRef.current = queue;
    return () => { queue.dispose(); audioQueueRef.current = null; };
  }, []);

  const handleAudioChunk = useCallback((chunk: ArrayBuffer) => {
    audioQueueRef.current?.enqueue(chunk);
  }, []);

  const handleTtsEnd = useCallback(() => {
    audioQueueRef.current?.flushBuffer();
  }, []);

  // STT error — non-blocking toast, auto-dismisses after 3s; resets orb to listening
  const [sttError, setSttError] = useState(false);
  const handleSttError = useCallback(() => {
    setSttError(true);
    setOrbState("listening");
    setTimeout(() => setSttError(false), 3000);
  }, []);

  const topicConfig = getTopicConfig(topicId);

  const { connectionState, phase, transcript, aiSpeaking, sessionComplete, sessionId, lastLatencyMs, sendMessage, reconnect } =
    useWebSocket(topicId, demo, handleAudioChunk, handleTtsEnd, handleSttError);

  // Orb state — 4 states: listening / thinking / speaking / interrupted (spec §7)
  const [orbState, setOrbState] = useState<OrbState>("listening");
  // Timer ref for interrupt flash — cleared on rapid double-interrupt
  const interruptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Watchdog: resets "thinking" → "listening" if tts_start never arrives within 10s
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // aiSpeaking → speaking / listening transitions
  // Functional update: only reset to "listening" if we were "speaking" — never clobbers "interrupted"
  useEffect(() => {
    if (aiSpeaking) {
      // tts_start fired — clear thinking watchdog before snapping to speaking
      if (watchdogRef.current !== null) {
        clearTimeout(watchdogRef.current);
        watchdogRef.current = null;
      }
      setOrbState("speaking");
    } else {
      setOrbState((prev) => (prev === "speaking" ? "listening" : prev));
    }
  }, [aiSpeaking]);

  const handleSpeechSent = useCallback(() => {
    setOrbState("thinking");
    // Watchdog: if server drops the turn and tts_start never fires, reset after 10s
    if (watchdogRef.current !== null) clearTimeout(watchdogRef.current);
    watchdogRef.current = setTimeout(() => {
      setOrbState((prev) => (prev === "thinking" ? "listening" : prev));
      watchdogRef.current = null;
    }, 6000);
  }, []);

  const handleInterrupt = useCallback(() => {
    // Clear any pending post-interrupt reset before starting a new one
    if (interruptTimerRef.current !== null) {
      clearTimeout(interruptTimerRef.current);
    }
    setOrbState("interrupted");
    interruptTimerRef.current = setTimeout(() => {
      setOrbState("listening");
      interruptTimerRef.current = null;
    }, 200);
  }, []);

  // Also flush audio queue on interrupt (spec §5.9 step 3)
  // Wrap sendMessage so interrupt also flushes locally
  const sendMessageWithFlush = useCallback(
    (msg: Parameters<typeof sendMessage>[0]) => {
      sendMessage(msg);
      if (msg.type === "interrupt") {
        audioQueueRef.current?.flush();
      }
    },
    [sendMessage]
  );

  const { startMic, stopMic, pauseMic, resumeMic } = useVAD({
    sendMessage: sendMessageWithFlush,
    aiSpeaking: aiSpeaking || audioPlaying,
    onSpeechSent: handleSpeechSent,
    onInterrupt: handleInterrupt,
  });

  // Auto-start AudioContext + VAD using the landing page button click as the
  // user gesture. The landing page writes "mic_gesture_granted" to sessionStorage
  // immediately before router.push(), so by the time this effect runs the browser
  // considers the navigation a user-gesture-derived context.
  useEffect(() => {
    if (sessionStorage.getItem("mic_gesture_granted") === "1") {
      sessionStorage.removeItem("mic_gesture_granted");
      audioQueueRef.current
        ?.resume()
        .catch((err) => console.error("AudioContext.resume() failed:", err))
        .then(() => startMic());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — runs once on mount

  // Clean up VAD on unmount
  useEffect(() => () => stopMic(), [stopMic]);

  // Presenter pause — suspends AudioContext and VAD, no backend interaction needed
  const [isPaused, setIsPaused] = useState(false);

  // Focus management for paused overlay
  const pauseOverlayButtonRef = useRef<HTMLButtonElement>(null);
  const prePauseFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (isPaused) {
      prePauseFocusRef.current = document.activeElement as HTMLElement;
      pauseOverlayButtonRef.current?.focus();
    } else {
      prePauseFocusRef.current?.focus();
    }
  }, [isPaused]);

  const handlePause = useCallback(async () => {
    pauseMic();
    await audioQueueRef.current?.suspend();
    setIsPaused(true);
  }, [pauseMic]);

  const handleResume = useCallback(async () => {
    await audioQueueRef.current?.resume();
    resumeMic();
    setIsPaused(false);
  }, [resumeMic]);

  // Session timer — counts up from 00:00
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Text input fallback — collapsed by default (spec §7)
  const [showTextInput, setShowTextInput] = useState(false);
  const [textInput, setTextInput] = useState("");

  const handleTextSend = useCallback(() => {
    const content = textInput.trim();
    if (!content) return;
    sendMessageWithFlush({ type: "text_input", content });
    setTextInput("");
  }, [textInput, sendMessageWithFlush]);

  // Redirect to report page when session_complete received
  useEffect(() => {
    if (sessionComplete) {
      router.push(`/report/${sessionComplete.reportId}?topicId=${topicId}`);
    }
  }, [sessionComplete, router, topicId]);

  function handleEndSession() {
    audioQueueRef.current?.flush();
    sendMessage({ type: "session_end" });
    router.push(`/report/${sessionId}?topicId=${topicId}`);
  }

  const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const seconds = String(elapsed % 60).padStart(2, "0");

  // ── Connection error overlay (all hooks must be above this) ───────────────
  // Shows when WS drops mid-session. Guards against normal session end:
  // after session_complete or End Session, we navigate before onclose fires,
  // so sessionComplete will already be truthy and this branch won't trigger.
  const connectionError =
    (connectionState === "error" || connectionState === "disconnected") && !sessionComplete;

  if (connectionError) {
    return (
      <div
        role="alert"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 50,
          background: "#102B33",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          fontFamily: "var(--font-manrope), sans-serif",
        }}
      >
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "#FFFFFF", margin: 0, letterSpacing: "-0.01em" }}>
          Connection lost
        </h2>
        <p
          style={{
            fontSize: 16,
            color: "#6B7A8D",
            margin: 0,
            textAlign: "center",
            maxWidth: 400,
            lineHeight: 1.6,
          }}
        >
          The session was interrupted. Your progress has been saved.
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          {/* Primary: reconnect using same sessionId — backend resumes from SQLite */}
          <button
            onClick={reconnect}
            style={{
              padding: "12px 28px",
              borderRadius: 8,
              border: "none",
              background: "#087E8B",
              color: "#FFFFFF",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "var(--font-manrope), sans-serif",
              letterSpacing: "0.01em",
            }}
          >
            Reconnect
          </button>
          {/* Secondary: navigate to report page (polling handles not-yet-ready state) */}
          <button
            onClick={() => router.push(`/report/${sessionId}?topicId=${topicId}`)}
            style={{
              padding: "12px 28px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.3)",
              background: "transparent",
              color: "#FFFFFF",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "var(--font-manrope), sans-serif",
              letterSpacing: "0.01em",
            }}
          >
            End session
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="session-root"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "#F4F5F1",
        color: "#000000",
        fontFamily: "var(--font-manrope), sans-serif",
        overflow: "hidden",
      }}
    >
      {/* Nav */}
      <Nav />

      {/* Phase strip — interview phases (spec §7) */}
      <PhaseStrip currentPhase={phase} />

      {/* Session header bar */}
      <div
        className="session-header-bar"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 24px",
          background: "#FFFFFF",
          borderBottom: "1px solid #E2E6EA",
          flexShrink: 0,
        }}
      >
        {/* Topic title */}
        <span style={{ fontSize: 15, fontWeight: 700, color: "#000000" }}>
          {topicConfig?.sessionLabel ?? "Interview Session"}
        </span>

        {/* Session ID — hidden on mobile */}
        <span className="session-id-label" style={{ fontSize: 11, color: "#6B7A8D", fontFamily: "monospace" }}>
          {`mg_interview_${sessionId.slice(0, 11)}`}
        </span>

        {/* Right cluster: signal + timer + demo badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* Timer */}
          <div
            className="session-timer-display"
            style={{
              fontSize: 20,
              fontWeight: 600,
              color: "#000000",
              letterSpacing: "0.05em",
              fontVariantNumeric: "tabular-nums",
              fontFamily: "var(--font-manrope), monospace",
            }}
          >
            {minutes}:{seconds}
          </div>

          {/* Demo badge */}
          {demo && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                background: "#FDF1D0",
                color: "#8B6200",
                padding: "3px 10px",
                borderRadius: 999,
              }}
            >
              DEMO MODE
            </span>
          )}
        </div>
      </div>

      {/* Main content — Agent Panel + Transcript */}
      <main
        className="session-main"
        style={{
          display: "flex",
          flex: 1,
          overflow: "hidden",
        }}
      >
        {/* Left column — Agent Panel */}
        <aside
          className="session-agent-aside"
          style={{
            width: 240,
            borderRight: "1px solid #23464D",
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            background: "#102B33",
          }}
        >
          <AgentPanel
            orbState={audioPlaying && orbState !== "interrupted" ? "speaking" : orbState}
            paused={isPaused}
            connectionState={connectionState}
            lastLatencyMs={lastLatencyMs}
            sessionId={sessionId}
          />
        </aside>

        {/* Right column — Live Transcript */}
        <section
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <LiveTranscript entries={transcript} aiSpeaking={aiSpeaking} />
        </section>
      </main>

      {/* Paused overlay — full-screen dim so presenter and audience see paused state clearly */}
      {isPaused && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="paused-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 40,
            background: "rgba(11, 22, 59, 0.82)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            backdropFilter: "blur(2px)",
          }}
        >
          <div style={{ fontSize: 48, lineHeight: 1 }} aria-hidden="true">⏸</div>
          <p
            id="paused-title"
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "#FFFFFF",
              margin: 0,
              letterSpacing: "-0.01em",
              fontFamily: "var(--font-manrope), sans-serif",
            }}
          >
            Session paused
          </p>
          <button
            ref={pauseOverlayButtonRef}
            onClick={handleResume}
            style={{
              marginTop: 8,
              padding: "12px 32px",
              borderRadius: 8,
              border: "none",
              background: "#087E8B",
              color: "#FFFFFF",
              fontSize: 16,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "var(--font-manrope), sans-serif",
              letterSpacing: "0.01em",
            }}
          >
            ▶ Resume session
          </button>
        </div>
      )}

      {/* STT error banner — non-blocking, auto-dismisses after 3s */}
      {sttError && (
        <div
          role="alert"
          aria-live="polite"
          style={{
            position: "fixed",
            bottom: 72,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#FFCEB9",
            border: "1px solid #E9784A",
            borderRadius: 8,
            padding: "10px 20px",
            fontSize: 14,
            color: "#CF370B",
            fontWeight: 500,
            pointerEvents: "none",
            zIndex: 10,
            whiteSpace: "nowrap",
          }}
        >
          Didn&rsquo;t catch that — please repeat
        </div>
      )}

      {/* Text input fallback — fixed bar above footer, hidden by default (spec §7) */}
      {showTextInput && (
        <div
          className="session-text-input-bar"
          style={{
            position: "fixed",
            bottom: 53, // footer height
            left: 0,
            right: 0,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 32px",
            borderTop: "1px solid #E2E6EA",
            background: "#FFFFFF",
            zIndex: 5,
          }}
        >
          <input
            type="text"
            aria-label="Type your message"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleTextSend(); }}
            placeholder="Type your message…"
            autoFocus
            style={{
              flex: 1,
              padding: "10px 16px",
              borderRadius: 8,
              border: "1px solid #E2E6EA",
              background: "#F4F5F1",
              color: "#000000",
              fontSize: 16,
              fontFamily: "var(--font-manrope), sans-serif",
            }}
          />
          <button
            onClick={handleTextSend}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "none",
              background: "#087E8B",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Send
          </button>
        </div>
      )}

      {/* Bottom bar — Type toggle + End Session */}
      <footer
        className="session-footer"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 12,
          padding: "12px 24px",
          borderTop: "1px solid #E2E6EA",
          background: "#FFFFFF",
          flexShrink: 0,
        }}
      >
        {/* Text input toggle */}
        <button
          onClick={() => setShowTextInput((v) => !v)}
          aria-label="Type message instead of speaking"
          aria-pressed={showTextInput}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: `1px solid ${showTextInput ? "#087E8B" : "#E2E6EA"}`,
            background: showTextInput ? "#D8F0EC" : "transparent",
            color: showTextInput ? "#087E8B" : "#6B7A8D",
            fontSize: 14,
            fontWeight: 500,
            cursor: "pointer",
            lineHeight: 1,
            transition: "background 0.2s, color 0.2s, border-color 0.2s",
            fontFamily: "var(--font-manrope), sans-serif",
          }}
        >
          ↩ Type instead
        </button>

        {/* Pause / Resume */}
        <button
          onClick={isPaused ? handleResume : handlePause}
          aria-label={isPaused ? "Resume session" : "Pause session"}
          style={{
            padding: "10px 24px",
            borderRadius: 8,
            border: `1px solid ${isPaused ? "#087E8B" : "#6B7A8D"}`,
            background: isPaused ? "#087E8B" : "transparent",
            color: isPaused ? "#FFFFFF" : "#6B7A8D",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            letterSpacing: "0.03em",
            transition: "background 0.2s, color 0.2s, border-color 0.2s",
            fontFamily: "var(--font-manrope), sans-serif",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {isPaused ? "▶ Resume" : "⏸ Pause"}
        </button>

        {/* End Session */}
        <button
          onClick={handleEndSession}
          style={{
            padding: "10px 24px",
            borderRadius: 8,
            border: "1px solid #E9784A",
            background: "transparent",
            color: "#E9784A",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            letterSpacing: "0.03em",
            transition: "background 0.2s, color 0.2s",
            fontFamily: "var(--font-manrope), sans-serif",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "#E9784A";
            (e.currentTarget as HTMLButtonElement).style.color = "#fff";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            (e.currentTarget as HTMLButtonElement).style.color = "#E9784A";
          }}
        >
          End Session
        </button>
      </footer>
    </div>
  );
}

// Page wrapper — Suspense required for useSearchParams() in App Router
export default function SessionPage() {
  return (
    <Suspense fallback={
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "#F4F5F1",
          color: "#6B7A8D",
          fontSize: 16,
        }}
      >
        Loading…
      </div>
    }>
      <SessionPageInner />
    </Suspense>
  );
}
