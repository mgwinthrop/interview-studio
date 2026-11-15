"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useWebSocket } from "../hooks/useWebSocket";
import { useVAD } from "../../hooks/useVAD";
import { AudioQueue } from "../../lib/audioQueue";
import { Nav } from "../components/Nav";
import { DemoBadge } from "../components/DemoBadge";
import { PhaseStrip } from "../components/PhaseStrip";
import { AgentPanel } from "../components/AgentPanel";
import { LiveTranscript } from "../components/LiveTranscript";
import { DEFAULT_RETURN_TO, storeDraft } from "../lib/interviewerForm";
import type { OrbState } from "../types";
import {
  ConnectionLostOverlay,
  DesignFailedOverlay,
  DraftNotKeptOverlay,
  DraftRejectedOverlay,
  EndConfirmDialog,
  MakingDraftOverlay,
  PausedOverlay,
  SessionFailedOverlay,
  SessionFooter,
  SttToast,
  TextInputBar,
  TrialBanner,
  TrialEndedOverlay,
} from "./ModeParts";
import { LoadingScreen, SessionPageInner, type SessionViewProps } from "./SessionLoader";
import { headerBarStyle, interviewerNameStyle, sessionIdStyle, sessionRootStyle, timerStyle } from "./styles";
import { THINKING_WATCHDOG_MS } from "./timing";
import { micFallbackMessage } from "../lib/micDevice";
import { isDebug } from "../lib/debug";
import { HEARING_DEADLINE_MS, displayedOrbState, hearingUnavailable, panelState } from "../lib/sessionDisplay";

// The live conversation. Mounted only after the interviewer has loaded.
function SessionView({ interviewer, demo, mode = null, start, returnTo }: SessionViewProps) {
  const router = useRouter();
  // FQ-46: the response time and the session id are operator details, shown only with ?debug=1.
  const debug = isDebug(useSearchParams());
  const interviewerId = interviewer.id;
  // Design and try sessions store nothing: they never lead to a report page.
  const leaveTo = mode === "try" ? returnTo ?? DEFAULT_RETURN_TO : "/interviewers";

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
    }, THINKING_WATCHDOG_MS);
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

  const { micActive, hearing, micFallback, hearingAttempt, startMic, stopMic, pauseMic, resumeMic } = useVAD({
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
  // FQ-47: true from the moment the end dialog opens until its flow has settled. While it is
  // true the dialog owns focus, so this effect neither records nor restores focus for the
  // pause and resume the dialog makes.
  const endFlowOwnsFocusRef = useRef(false);
  useEffect(() => {
    if (endFlowOwnsFocusRef.current) return;
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

  // FQ-47: confirm before ending a normal interview. Opening the dialog pauses the session with
  // the existing Pause (unless it is already paused), so nothing said reaches the interviewer.
  // `confirmingEnd` stays true until the end flow has settled: through the resume of a pause the
  // dialog made, and for good once the end is confirmed. The pause screen is hidden while it is
  // true, so it never flashes. When the flow settles without ending, this effect sets focus
  // explicitly: the pause screen's Resume session if the session stays paused, otherwise End
  // Session (where the browser's own dialog focus restore has usually put it already).
  const endDialogRef = useRef<HTMLDialogElement>(null);
  const endButtonRef = useRef<HTMLButtonElement>(null);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const pausedByEndDialogRef = useRef(false);
  // The pause the dialog started. Closing waits for it, so a quick Escape cannot resume before
  // the pause has finished (which would leave the session Paused with the mic live).
  const endDialogPauseRef = useRef<Promise<void> | null>(null);
  const endConfirmedRef = useRef(false);
  useEffect(() => {
    const dialog = endDialogRef.current;
    if (confirmingEnd && dialog && !dialog.open) dialog.showModal();
  }, [confirmingEnd]);
  useEffect(() => {
    if (confirmingEnd || !endFlowOwnsFocusRef.current) return;
    endFlowOwnsFocusRef.current = false;
    if (isPaused) pauseOverlayButtonRef.current?.focus();
    else endButtonRef.current?.focus();
  }, [confirmingEnd, isPaused]);

  // Session timer — counts up from 00:00
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Text input fallback — collapsed by default (spec §7)
  const [showTextInput, setShowTextInput] = useState(false);

  // FQ-41: if voice detection is not listening 10 s after this view opens, for any reason (failed
  // or hung load, blocked worklet, no gesture after a reload), say so and open typing. A late
  // start that becomes ready clears the message.
  // FQ-79: the 10 s also restarts with every new attempt (a start, or a reopen after a pause),
  // so a reopen that hangs is reported too. The first timer still runs from mount, so a start
  // that never begins (no gesture) is reported as before.
  const [hearingDeadlinePassed, setHearingDeadlinePassed] = useState(false);
  const [hearingEpoch, setHearingEpoch] = useState(0);
  useEffect(() => {
    if (hearing === "starting") setHearingEpoch((e) => e + 1);
  }, [hearing]);
  useEffect(() => {
    setHearingDeadlinePassed(false);
    const t = setTimeout(() => setHearingDeadlinePassed(true), HEARING_DEADLINE_MS);
    return () => clearTimeout(t);
  }, [hearingEpoch]);
  const cannotHear = hearingUnavailable(hearing, hearingDeadlinePassed);
  useEffect(() => {
    if (cannotHear) setShowTextInput(true);
  }, [cannotHear]);
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

  // End Session: design and try modes end straight away as before; a normal interview asks first.
  function handleEndClick() {
    if (mode !== null) {
      handleEndSession();
      return;
    }
    // FQ-98: while the end flow is still settling (closing waits for the dialog's pause), End
    // Session does nothing; starting another pause here would outlive the close.
    if (confirmingEnd) return;
    endConfirmedRef.current = false;
    endFlowOwnsFocusRef.current = true;
    pausedByEndDialogRef.current = !isPaused;
    // A pause that fails (the audio already shut down) is treated as no pause: it never rejects.
    endDialogPauseRef.current = isPaused ? null : handlePause().catch(() => undefined);
    setConfirmingEnd(true);
  }

  async function handleEndDialogClose() {
    // Confirmed: the page is leaving; stay in the end flow so the pause screen never returns.
    if (endConfirmedRef.current) return;
    try {
      if (pausedByEndDialogRef.current) {
        pausedByEndDialogRef.current = false;
        await endDialogPauseRef.current;
        endDialogPauseRef.current = null;
        // Even if the pause failed, the mic was paused first, so resuming is still right.
        await handleResume();
      }
    } catch {
      // A resume that fails must not leave the end flow stuck; the session controls stay usable.
    } finally {
      setConfirmingEnd(false);
    }
  }

  function handleEndConfirmed() {
    endConfirmedRef.current = true;
    endDialogRef.current?.close();
    handleEndSession();
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
  if (mode === "design" && draftStoreFailed) {
    return <DraftNotKeptOverlay retryRef={draftStoreRetryRef} onRetry={handOffDraft} />;
  }

  if (designFailed) {
    return <DesignFailedOverlay retryRef={designRetryButtonRef} onRetry={handleDesignRetry} />;
  }

  if (sessionFailed && mode === "try") return <TrialEndedOverlay onBack={goToReportOrHome} />;

  if (sessionFailed) return <SessionFailedOverlay />;

  // Try mode: the draft was refused before the trial started (see draftRejected above).
  if (draftRejected) return <DraftRejectedOverlay backRef={draftRejectedBackRef} onBack={goToReportOrHome} />;

  // Shows when WS drops mid-session. Guards against normal session end:
  // after session_complete or End Session, we navigate before onclose fires,
  // so sessionComplete will already be truthy and this branch won't trigger.
  const connectionError =
    (connectionState === "error" || connectionState === "disconnected") && !sessionComplete && !draft;

  if (connectionError) {
    return (
      <ConnectionLostOverlay
        closeReason={closeReason}
        // design mode also clears "Making your draft…" and restarts the mic it stopped
        onStartOver={mode === "design" ? handleDesignRetry : reconnect}
        onEnd={goToReportOrHome}
      />
    );
  }

  if (makingDraft) return <MakingDraftOverlay headingRef={makingDraftHeadingRef} />;

  // One answer to "is the interviewer speaking?" for the panel and the transcript. It counts
  // buffered playback after tts_end, and is false whenever the panel shows paused or a
  // connection state instead of the orb.
  const shownOrbState = displayedOrbState(orbState, audioPlaying);
  const interviewerSpeaking = !isPaused && connectionState === "connected" && shownOrbState === "speaking";

  return (
    <div className="session-root" style={sessionRootStyle}>
      {/* Nav */}
      <Nav />

      {/* Phase strip — interview phases (spec §7) */}
      <PhaseStrip phases={phaseNames} currentPhase={currentPhase} />

      {/* Session header bar */}
      <header className="session-header-bar" style={headerBarStyle}>
        {/* Interviewer name */}
        <h1 dir="auto" style={interviewerNameStyle}>
          {mode === "design" ? "Designing an interviewer" : interviewer.name}
        </h1>

        {/* Session ID — hidden on mobile */}
        <span className="session-id-label" style={sessionIdStyle}>
          {debug && sessionId ? `interview_${sessionId.slice(0, 11)}` : ""}
        </span>

        {/* Right cluster: signal + timer + demo badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* Timer */}
          <div className="session-timer-display" style={timerStyle}>
            {minutes}:{seconds}
          </div>

          {/* Demo badge */}
          {demo && <DemoBadge>DEMO MODE</DemoBadge>}
        </div>
      </header>

      {mode === "try" && <TrialBanner />}

      {/* Main content — Agent Panel + Transcript */}
      <main
        id="main-content"
        tabIndex={-1}
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
            orbState={panelState(shownOrbState, hearing, hearingDeadlinePassed)}
            hearing={hearing}
            displayName={interviewer.displayName}
            purpose={interviewer.purpose}
            paused={isPaused}
            connectionState={connectionState}
            lastLatencyMs={debug ? lastLatencyMs : null}
            sessionId={debug ? sessionId : ""}
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
          {micFallback && (
            <p role="status" className="session-mic-notice">{micFallbackMessage(micFallback)}</p>
          )}
          <LiveTranscript
            entries={transcript}
            aiSpeaking={aiSpeaking}
            interviewerSpeaking={interviewerSpeaking}
            interviewerName={interviewer.displayName}
          />
        </section>
      </main>

      {isPaused && !confirmingEnd && (
        <PausedOverlay resumeRef={pauseOverlayButtonRef} onResume={handleResume} onEnd={mode === null ? handleEndClick : undefined} />
      )}

      {/* STT error banner — non-blocking, auto-dismisses after 3s */}
      {sttError && <SttToast />}

      {/* Text input fallback — fixed bar above footer, hidden by default (spec §7) */}
      {cannotHear && (
        <p role="alert" className="session-hearing-alert">
          {hearingAttempt === "resume" ? (
            <><strong>We can&apos;t hear your microphone.</strong> It didn&apos;t restart after the pause. You can type your answers, or pause and resume to try again.</>
          ) : (
            <><strong>We can&apos;t hear you in this browser.</strong> Voice detection didn&apos;t start. You can type your answers instead.</>
          )}
        </p>
      )}
      {showTextInput && <TextInputBar value={textInput} onChange={setTextInput} onSend={handleTextSend} />}

      <SessionFooter
        mode={mode}
        showTextInput={showTextInput}
        onToggleText={() => setShowTextInput((v) => !v)}
        isPaused={isPaused}
        onPause={handlePause}
        onResume={handleResume}
        designNotReady={designNotReady}
        onEnd={handleEndClick}
        endButtonRef={endButtonRef}
      />

      {mode === null && (
        <EndConfirmDialog
          dialogRef={endDialogRef}
          onKeepTalking={() => endDialogRef.current?.close()}
          onConfirm={handleEndConfirmed}
          onClose={handleEndDialogClose}
        />
      )}
    </div>
  );
}

// Page wrapper — Suspense required for useSearchParams() in App Router
export default function SessionPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <SessionPageInner View={SessionView} />
    </Suspense>
  );
}
