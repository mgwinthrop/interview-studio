"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useWebSocket } from "../hooks/useWebSocket";
import { useVAD } from "../../hooks/useVAD";
import { AudioQueue } from "../../lib/audioQueue";
import { Nav } from "../components/Nav";
import { PhaseStrip } from "../components/PhaseStrip";
import { AgentPanel } from "../components/AgentPanel";
import { LiveTranscript } from "../components/LiveTranscript";
import {
  DESIGNER_ID,
  fetchInterviewer,
  type InterviewerDetail,
  type InterviewerInput,
} from "../lib/interviewers";
import { peekDraft, storeDraft } from "../lib/interviewerForm";
import type { OrbState } from "../types";

/**
 * `design`: a conversation with the designer that ends in a draft for the editor.
 * `try`: a conversation with an unsaved draft from sessionStorage. Neither stores anything.
 * Null is the normal interview.
 */
type SessionMode = "design" | "try" | null;

function parseMode(value: string | null): SessionMode {
  return value === "design" || value === "try" ? value : null;
}

const DEFAULT_TRY_RETURN_TO = "/interviewers/edit?from=draft";

// Try it never calls the interviewer API: the phase strip and header come from the draft itself.
function detailFromDraft(input: InterviewerInput): InterviewerDetail {
  return { ...input, id: "", source: "custom", version: 0, createdAt: "", updatedAt: "" };
}

// Full-screen error state shared by "connection lost" and "session failed".
const overlayStyle: React.CSSProperties = {
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
};
const overlayTitleStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  color: "#FFFFFF",
  margin: 0,
  letterSpacing: "-0.01em",
};
const overlayBodyStyle: React.CSSProperties = {
  fontSize: 16,
  color: "#6B7A8D",
  margin: 0,
  textAlign: "center",
  maxWidth: 400,
  lineHeight: 1.6,
};
const overlayPrimaryStyle: React.CSSProperties = {
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
  textDecoration: "none",
};
const overlaySecondaryStyle: React.CSSProperties = {
  ...overlayPrimaryStyle,
  border: "1px solid rgba(255,255,255,0.3)",
  background: "transparent",
};

function LoadingScreen() {
  return (
    <div
      role="status"
      aria-label="Loading session"
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
  );
}

// Inner component — must be inside <Suspense> because it calls useSearchParams().
// Loads the interviewer first; the conversation (and its WebSocket) mounts only once
// the interviewer is known to exist, so an unknown id never opens a session.
function SessionPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = parseMode(searchParams.get("mode"));
  // Links from before interviewers existed have no interviewerId, so they redirect home below.
  // Design mode always talks to the designer, whatever id the link carries.
  const interviewerId = mode === "design" ? DESIGNER_ID : searchParams.get("interviewerId") ?? "";
  const demo = searchParams.get("demo") === "true";

  const [interviewer, setInterviewer] = useState<InterviewerDetail | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  // Try mode: the stored draft, read once (peek, so the editor still finds it afterwards).
  const [tryDraft, setTryDraft] = useState<{ input: InterviewerInput; returnTo: string } | null>(null);
  const tryDraftReadRef = useRef(false);

  // Try mode: read the draft once; a missing or corrupt one sends the user to a blank editor.
  useEffect(() => {
    if (mode !== "try" || tryDraftReadRef.current) return;
    tryDraftReadRef.current = true;
    const stored = peekDraft();
    if (!stored) {
      router.replace("/interviewers/edit");
      return;
    }
    setTryDraft(stored);
    setInterviewer(detailFromDraft(stored.input));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mode doesn't change during a session

  // Guard: redirect to interviewer selection if the id is missing or unknown.
  useEffect(() => {
    if (mode === "try") return; // never calls the interviewer API
    if (!interviewerId) {
      router.replace("/");
      return;
    }
    let cancelled = false;
    setLoadFailed(false);
    fetchInterviewer(interviewerId)
      .then((found) => {
        if (cancelled) return;
        if (found) setInterviewer(found);
        else router.replace("/");
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAttempt]); // interviewerId doesn't change during a session

  if (loadFailed) {
    return (
      <div role="alert" style={overlayStyle}>
        <h2 style={overlayTitleStyle}>Could not load the interviewer</h2>
        <p style={overlayBodyStyle}>Check your connection, then try again.</p>
        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          <button onClick={() => setLoadAttempt((n) => n + 1)} style={overlayPrimaryStyle}>
            Try again
          </button>
          <Link href="/" style={overlaySecondaryStyle}>
            Back to start
          </Link>
        </div>
      </div>
    );
  }

  if (!interviewer) return <LoadingScreen />;

  if (mode === "try") {
    if (!tryDraft) return <LoadingScreen />;
    return (
      <SessionView
        interviewer={interviewer}
        demo={demo}
        mode="try"
        start={tryDraft.input}
        returnTo={tryDraft.returnTo || DEFAULT_TRY_RETURN_TO}
      />
    );
  }

  if (mode === "design") {
    return <SessionView interviewer={interviewer} demo={demo} mode="design" start={DESIGNER_ID} />;
  }

  return <SessionView interviewer={interviewer} demo={demo} />;
}

interface SessionViewProps {
  interviewer: InterviewerDetail;
  demo: boolean;
  /** Omitted for the normal interview. */
  mode?: SessionMode;
  /** What the session runs (design and try modes); the normal interview uses interviewer.id. */
  start?: string | InterviewerInput;
  /** Try mode: where "Finish trial" goes. */
  returnTo?: string;
}

// The live conversation. Mounted only after the interviewer has loaded.
function SessionView({ interviewer, demo, mode = null, start, returnTo }: SessionViewProps) {
  const router = useRouter();
  const interviewerId = interviewer.id;
  // Design and try sessions store nothing: they never lead to a report page.
  const leaveTo = mode === "try" ? returnTo ?? DEFAULT_TRY_RETURN_TO : "/interviewers";

  // Track actual playback, including buffered speech after tts_end.
  const [audioPlaying, setAudioPlaying] = useState(false);
  const audioQueueRef = useRef<AudioQueue | null>(null);
  // Response-gap timing: when the interviewer's playback last finished (null = no valid end),
  // and a synchronous mirror of the playing state so VAD callbacks never read a stale render.
  const lastPlaybackEndedAtRef = useRef<number | null>(null);
  const audioPlayingRef = useRef(false);
  const handlePlaybackChange = useCallback((playing: boolean) => {
    if (audioPlayingRef.current && !playing) {
      lastPlaybackEndedAtRef.current = performance.now();
    }
    audioPlayingRef.current = playing;
    setAudioPlaying(playing);
  }, []);
  useEffect(() => {
    const queue = new AudioQueue(handlePlaybackChange);
    audioQueueRef.current = queue;
    return () => { queue.dispose(); audioQueueRef.current = null; };
  }, [handlePlaybackChange]);

  // Design mode: true while "Making your draft…" shows; speech arriving then is not played.
  // Always false in the other modes.
  const makingDraftRef = useRef(false);

  const handleAudioChunk = useCallback((chunk: ArrayBuffer) => {
    if (makingDraftRef.current) return;
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

  const {
    connectionState,
    phase,
    transcript,
    aiSpeaking,
    sessionComplete,
    sessionFailed,
    sessionId,
    lastLatencyMs,
    closeReason,
    closeInfo,
    draft,
    sendMessage,
    reconnect,
  } = useWebSocket(start ?? interviewerId, demo, handleAudioChunk, handleTtsEnd, handleSttError);

  // Sessions start in the interviewer's first phase; phase_change then names the current one.
  const phaseNames = interviewer.phases.map((p) => p.name);
  const currentPhase = phase || (phaseNames[0] ?? "");

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
      // The interviewer is speaking again: an earlier end-of-playback can no longer
      // describe the gap before the next answer (that end is recorded when this reply finishes).
      lastPlaybackEndedAtRef.current = null;
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
        // flush() reports playing=false, which stamps an end time; an interrupted reply
        // never finished, so discard it (must come after the flush).
        lastPlaybackEndedAtRef.current = null;
      }
    },
    [sendMessage]
  );

  // Ms from the end of the interviewer's playback to the given speech start, or null when
  // there is no valid end (still playing, interrupted, or already used by an earlier answer).
  const getResponseGapMs = useCallback((speechStartedAtMs: number): number | null => {
    const endedAt = lastPlaybackEndedAtRef.current;
    if (endedAt === null) return null;
    if (audioPlayingRef.current) return null;
    // One gap per reply: back-to-back answers must not reuse the same end.
    lastPlaybackEndedAtRef.current = null;
    return Math.max(0, speechStartedAtMs - endedAt);
  }, []);

  const { micActive, startMic, stopMic, pauseMic, resumeMic } = useVAD({
    sendMessage: sendMessageWithFlush,
    aiSpeaking: aiSpeaking || audioPlaying,
    onSpeechSent: handleSpeechSent,
    onInterrupt: handleInterrupt,
    getResponseGapMs,
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
    // The pause is not thinking time: an answer after it has no measured gap before answering.
    lastPlaybackEndedAtRef.current = null;
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

  // Session failed: stop listening and drop any queued speech; the failure state renders below.
  useEffect(() => {
    if (sessionFailed) {
      stopMic();
      audioQueueRef.current?.flush();
    }
  }, [sessionFailed, stopMic]);

  // Try mode: the server refused the draft itself (missing or invalid fields). Starting over
  // would send the same draft again, so the page sends the person back to the draft instead.
  const draftRejected =
    mode === "try" &&
    connectionState === "disconnected" &&
    closeInfo?.code === 1008 &&
    closeInfo.reason === "invalid draft";
  useEffect(() => {
    if (draftRejected) stopMic();
  }, [draftRejected, stopMic]);

  // Redirect to report page when session_complete received.
  // Design and try sessions store no report: their reportId names nothing, so it is ignored.
  useEffect(() => {
    if (sessionComplete && mode === null) {
      router.push(`/report/${sessionComplete.reportId}`);
    }
  }, [sessionComplete, router, mode]);

  // Try mode: set once the page is on its way back to the editor, so it navigates only once.
  const leftTrialRef = useRef(false);
  // Try mode: the server can end the trial itself (turn cap); that is the end of the trial,
  // so go back where "Finish trial" goes. The draft is still stored (it was only peeked).
  useEffect(() => {
    if (sessionComplete && mode === "try" && !leftTrialRef.current) {
      leftTrialRef.current = true;
      router.push(leaveTo);
    }
  }, [sessionComplete, router, mode, leaveTo]);

  // Design mode: the draft arrives just before session_complete; hand it to the editor. If the
  // browser will not keep it, stay here (the draft is still in state) and offer to retry.
  const [draftStoreFailed, setDraftStoreFailed] = useState(false);
  const handOffDraft = useCallback(() => {
    if (!draft) return;
    if (storeDraft(draft)) {
      setDraftStoreFailed(false);
      router.push("/interviewers/edit?from=design");
    } else {
      setDraftStoreFailed(true);
    }
  }, [draft, router]);
  useEffect(() => {
    if (mode === "design" && draft) handOffDraft();
  }, [mode, draft, handOffDraft]);

  // Design mode: "Finish and create draft" was pressed and the draft is being made.
  const [makingDraft, setMakingDraft] = useState(false);
  // Design mode: whether the mic ever ran, so "Try again" restarts it (and never prompts
  // for a microphone the user chose not to use).
  const micUsedRef = useRef(false);
  useEffect(() => {
    if (micActive) micUsedRef.current = true;
  }, [micActive]);

  // The report page needs the server-issued id; before session_started there is none.
  const goToReportOrHome = useCallback(() => {
    if (mode !== null) {
      if (mode === "try") {
        if (leftTrialRef.current) return;
        leftTrialRef.current = true;
      }
      router.push(leaveTo);
      return;
    }
    router.push(sessionId ? `/report/${sessionId}` : "/");
  }, [router, sessionId, mode, leaveTo]);

  // Design mode: session_end only reaches the server on an open socket with a started
  // session; until then "Finish and create draft" is disabled (it would wait forever).
  const designNotReady = mode === "design" && !(connectionState === "connected" && sessionId);

  function handleEndSession() {
    if (mode === "design") {
      if (designNotReady) return;
      // No navigation yet: the server makes the draft, then sends it (or session_failed).
      sendMessage({ type: "session_end" });
      stopMic();
      audioQueueRef.current?.flush();
      makingDraftRef.current = true;
      setMakingDraft(true);
      return;
    }
    audioQueueRef.current?.flush();
    sendMessage({ type: "session_end" });
    goToReportOrHome();
  }

  // Design mode failure: start a new designer session; the typed text stays in the input.
  const handleDesignRetry = useCallback(() => {
    makingDraftRef.current = false;
    setMakingDraft(false);
    reconnect();
    if (micUsedRef.current) {
      audioQueueRef.current
        ?.resume()
        .catch((err) => console.error("AudioContext.resume() failed:", err))
        .then(() => startMic());
    }
  }, [reconnect, startMic]);

  // Design mode: the draft failed (see the overlay below).
  const designFailed = mode === "design" && (sessionFailed || (!!sessionComplete && !draft));

  // Design mode: when an overlay replaces the End button, move focus into it.
  const makingDraftHeadingRef = useRef<HTMLHeadingElement>(null);
  const designRetryButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (makingDraft) makingDraftHeadingRef.current?.focus();
  }, [makingDraft]);
  useEffect(() => {
    if (designFailed) designRetryButtonRef.current?.focus();
  }, [designFailed]);
  const draftStoreRetryRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (draftStoreFailed) draftStoreRetryRef.current?.focus();
  }, [draftStoreFailed]);
  const draftRejectedBackRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (draftRejected) draftRejectedBackRef.current?.focus();
  }, [draftRejected]);

  const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const seconds = String(elapsed % 60).padStart(2, "0");

  // ── Error overlays (all hooks must be above this) ─────────────────────────
  // Design mode: the server could not make a valid draft (nothing said, or the draft call failed).
  // A completion with no draft before it (which the server never sends) is treated the same,
  // so the page cannot wait on "Making your draft…" forever.
  // Design mode: the draft was made but this browser would not keep it for the editor.
  if (mode === "design" && draftStoreFailed) {
    return (
      <div role="alert" style={overlayStyle}>
        <h2 style={overlayTitleStyle}>Draft not kept</h2>
        <p style={overlayBodyStyle}>Your draft could not be kept in this browser. Try again.</p>
        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          <button ref={draftStoreRetryRef} onClick={handOffDraft} style={overlayPrimaryStyle}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (designFailed) {
    return (
      <div role="alert" style={overlayStyle}>
        <h2 style={overlayTitleStyle}>No draft yet</h2>
        <p style={overlayBodyStyle}>The designer could not make a draft from this conversation.</p>
        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          <button ref={designRetryButtonRef} onClick={handleDesignRetry} style={overlayPrimaryStyle}>
            Try again
          </button>
          <Link href="/interviewers" style={overlaySecondaryStyle}>
            Back
          </Link>
        </div>
      </div>
    );
  }

  // Try mode: a trial has no report, so the feedback wording below does not apply.
  if (sessionFailed && mode === "try") {
    return (
      <div role="alert" style={overlayStyle}>
        <h2 style={overlayTitleStyle}>The trial has ended</h2>
        <p style={overlayBodyStyle}>The trial ended unexpectedly. Nothing was saved.</p>
        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          <button onClick={goToReportOrHome} style={overlayPrimaryStyle}>
            Back to the draft
          </button>
        </div>
      </div>
    );
  }

  // Session failed: the server ended the session without a report and closes the socket.
  if (sessionFailed) {
    return (
      <div role="alert" style={overlayStyle}>
        <h2 style={overlayTitleStyle}>The session could not be completed</h2>
        <p style={overlayBodyStyle}>
          Something went wrong while preparing your feedback, so no report was saved.
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          <Link href="/" style={overlayPrimaryStyle}>
            Back to start
          </Link>
        </div>
      </div>
    );
  }

  // Try mode: the draft was refused before the trial started (see draftRejected above).
  if (draftRejected) {
    return (
      <div role="alert" style={overlayStyle}>
        <h2 style={overlayTitleStyle}>This draft isn&apos;t ready to try yet</h2>
        <p style={overlayBodyStyle}>
          Some fields are missing or not valid. Go back to the draft and press Save to see which.
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          <button ref={draftRejectedBackRef} onClick={goToReportOrHome} style={overlayPrimaryStyle}>
            Back to the draft
          </button>
        </div>
      </div>
    );
  }

  // Shows when WS drops mid-session. Guards against normal session end:
  // after session_complete or End Session, we navigate before onclose fires,
  // so sessionComplete will already be truthy and this branch won't trigger.
  const connectionError =
    (connectionState === "error" || connectionState === "disconnected") && !sessionComplete && !draft;

  if (connectionError) {
    return (
      <div role="alert" style={overlayStyle}>
        <h2 style={overlayTitleStyle}>Connection lost</h2>
        <p style={overlayBodyStyle}>
          {closeReason ??
            "The connection to the interviewer was lost and this conversation cannot be resumed. Reconnecting starts a new conversation."}
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          {/* Primary: open a new connection, which the server treats as a new session */}
          {/* (design mode also clears "Making your draft…" and restarts the mic it stopped) */}
          <button onClick={mode === "design" ? handleDesignRetry : reconnect} style={overlayPrimaryStyle}>
            Start over
          </button>
          {/* Secondary: leave; the report page explains that this session has no report.
              Design and try sessions have no report, so they go back to the interviewers. */}
          <button onClick={goToReportOrHome} style={overlaySecondaryStyle}>
            End session
          </button>
        </div>
      </div>
    );
  }

  // Design mode: waiting for the draft. Nothing to dismiss; the draft or a failure ends it.
  if (makingDraft) {
    return (
      <div role="status" style={overlayStyle}>
        <h2 ref={makingDraftHeadingRef} tabIndex={-1} style={overlayTitleStyle}>
          Making your draft…
        </h2>
        <p style={overlayBodyStyle}>
          The designer is turning this conversation into a draft interviewer for you to review.
        </p>
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
      <PhaseStrip phases={phaseNames} currentPhase={currentPhase} />

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
        {/* Interviewer name */}
        <span dir="auto" style={{ fontSize: 15, fontWeight: 700, color: "#000000", overflowWrap: "anywhere" }}>
          {mode === "design" ? "Designing an interviewer" : interviewer.name}
        </span>

        {/* Session ID — hidden on mobile */}
        <span className="session-id-label" style={{ fontSize: 11, color: "#6B7A8D", fontFamily: "monospace" }}>
          {sessionId ? `interview_${sessionId.slice(0, 11)}` : ""}
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

      {/* Try mode: say plainly that this conversation is not kept */}
      {mode === "try" && (
        <div
          role="status"
          style={{
            padding: "8px 24px",
            background: "#FDF1D0",
            color: "#8B6200",
            fontSize: 14,
            fontWeight: 600,
            borderBottom: "1px solid #E2E6EA",
            flexShrink: 0,
          }}
        >
          Trying a draft — nothing from this conversation is saved
        </div>
      )}

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
          // Design mode only: disabled until the designer session has started.
          disabled={designNotReady}
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
            ...(designNotReady ? { cursor: "not-allowed", opacity: 0.5 } : {}),
          }}
          onMouseEnter={(e) => {
            if (designNotReady) return;
            (e.currentTarget as HTMLButtonElement).style.background = "#E9784A";
            (e.currentTarget as HTMLButtonElement).style.color = "#fff";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            (e.currentTarget as HTMLButtonElement).style.color = "#E9784A";
          }}
        >
          {mode === "design"
            ? designNotReady
              ? "Connecting to the designer…"
              : "Finish and create draft"
            : mode === "try"
              ? "Finish trial"
              : "End Session"}
        </button>
      </footer>
    </div>
  );
}

// Page wrapper — Suspense required for useSearchParams() in App Router
export default function SessionPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <SessionPageInner />
    </Suspense>
  );
}
