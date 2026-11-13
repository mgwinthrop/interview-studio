// Presentational parts of the session page: the full-screen states, the banners and the footer.
// Everything here takes values, refs and callbacks as props; the state lives in SessionView.
import type { ReactNode, RefObject } from "react";
import Link from "next/link";
import {
  endButtonStyle,
  footerStyle,
  overlayActionsStyle,
  overlayBodyStyle,
  overlayPrimaryStyle,
  overlaySecondaryStyle,
  overlayStyle,
  overlayTitleStyle,
  pauseButtonStyle,
  pausedBackdropStyle,
  pausedResumeStyle,
  pausedTitleStyle,
  sttToastStyle,
  textInputBarStyle,
  textInputFieldStyle,
  textSendStyle,
  trialBannerStyle,
  typeToggleStyle,
} from "./styles";
import type { SessionMode } from "./SessionLoader";

export function OverlayFrame({
  role = "alert",
  title,
  titleRef,
  body,
  children,
}: {
  role?: "alert" | "status";
  title: ReactNode;
  titleRef?: RefObject<HTMLHeadingElement | null>;
  body: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div role={role} style={overlayStyle}>
      <h2 ref={titleRef} tabIndex={titleRef ? -1 : undefined} style={overlayTitleStyle}>
        {title}
      </h2>
      <p style={overlayBodyStyle}>{body}</p>
      {children && <div style={overlayActionsStyle}>{children}</div>}
    </div>
  );
}

export function LoadFailedOverlay({ onRetry }: { onRetry: () => void }) {
  return (
    <OverlayFrame title="Could not load the interviewer" body="Check your connection, then try again.">
      <button onClick={onRetry} style={overlayPrimaryStyle}>
        Try again
      </button>
      <Link href="/" style={overlaySecondaryStyle}>
        Back to start
      </Link>
    </OverlayFrame>
  );
}

// Design mode: the draft was made but this browser would not keep it for the editor.
export function DraftNotKeptOverlay({ retryRef, onRetry }: { retryRef: RefObject<HTMLButtonElement | null>; onRetry: () => void }) {
  return (
    <OverlayFrame title="Draft not kept" body="Your draft could not be kept in this browser. Try again.">
      <button ref={retryRef} onClick={onRetry} style={overlayPrimaryStyle}>
        Retry
      </button>
    </OverlayFrame>
  );
}

// Design mode: the server could not make a valid draft.
export function DesignFailedOverlay({ retryRef, onRetry }: { retryRef: RefObject<HTMLButtonElement | null>; onRetry: () => void }) {
  return (
    <OverlayFrame title="No draft yet" body="The designer could not make a draft from this conversation.">
      <button ref={retryRef} onClick={onRetry} style={overlayPrimaryStyle}>
        Try again
      </button>
      <Link href="/interviewers" style={overlaySecondaryStyle}>
        Back
      </Link>
    </OverlayFrame>
  );
}

// Try mode: a trial has no report, so the feedback wording of SessionFailedOverlay does not apply.
export function TrialEndedOverlay({ onBack }: { onBack: () => void }) {
  return (
    <OverlayFrame title="The trial has ended" body="The trial ended unexpectedly. Nothing was saved.">
      <button onClick={onBack} style={overlayPrimaryStyle}>
        Back to the draft
      </button>
    </OverlayFrame>
  );
}

// The server ended the session without a report and closes the socket.
export function SessionFailedOverlay() {
  return (
    <OverlayFrame
      title="The session could not be completed"
      body="Something went wrong while preparing your feedback, so no report was saved."
    >
      <Link href="/" style={overlayPrimaryStyle}>
        Back to start
      </Link>
    </OverlayFrame>
  );
}

// Try mode: the draft was refused before the trial started.
export function DraftRejectedOverlay({ backRef, onBack }: { backRef: RefObject<HTMLButtonElement | null>; onBack: () => void }) {
  return (
    <OverlayFrame
      title="This draft isn&apos;t ready to try yet"
      body="Some fields are missing or not valid. Go back to the draft and press Save to see which."
    >
      <button ref={backRef} onClick={onBack} style={overlayPrimaryStyle}>
        Back to the draft
      </button>
    </OverlayFrame>
  );
}

// Shows when the WebSocket drops mid-session.
export function ConnectionLostOverlay({
  closeReason,
  onStartOver,
  onEnd,
}: {
  closeReason: string | null | undefined;
  onStartOver: () => void;
  onEnd: () => void;
}) {
  return (
    <OverlayFrame
      title="Connection lost"
      body={
        closeReason ??
        "The connection to the interviewer was lost and this conversation cannot be resumed. Reconnecting starts a new conversation."
      }
    >
      {/* Primary: open a new connection, which the server treats as a new session */}
      <button onClick={onStartOver} style={overlayPrimaryStyle}>
        Start over
      </button>
      {/* Secondary: leave; the report page explains that this session has no report.
          Design and try sessions have no report, so they go back to the interviewers. */}
      <button onClick={onEnd} style={overlaySecondaryStyle}>
        End session
      </button>
    </OverlayFrame>
  );
}

// Design mode: waiting for the draft. Nothing to dismiss; the draft or a failure ends it.
export function MakingDraftOverlay({ headingRef }: { headingRef: RefObject<HTMLHeadingElement | null> }) {
  return (
    <OverlayFrame
      role="status"
      title="Making your draft…"
      titleRef={headingRef}
      body="The designer is turning this conversation into a draft interviewer for you to review."
    />
  );
}

// Try mode: say plainly that this conversation is not kept.
export function TrialBanner() {
  return (
    <div role="status" style={trialBannerStyle}>
      Trying a draft — nothing from this conversation is saved
    </div>
  );
}

// Full-screen dim so presenter and audience see the paused state clearly.
export function PausedOverlay({ resumeRef, onResume }: { resumeRef: RefObject<HTMLButtonElement | null>; onResume: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="paused-title" style={pausedBackdropStyle}>
      <div style={{ fontSize: 48, lineHeight: 1 }} aria-hidden="true">⏸</div>
      <p id="paused-title" style={pausedTitleStyle}>
        Session paused
      </p>
      <button ref={resumeRef} onClick={onResume} style={pausedResumeStyle}>
        ▶ Resume session
      </button>
    </div>
  );
}

// Non-blocking; the page clears it after 3s.
export function SttToast() {
  return (
    <div role="alert" aria-live="polite" style={sttToastStyle}>
      Didn&rsquo;t catch that — please repeat
    </div>
  );
}

// Text input fallback: a fixed bar above the footer.
export function TextInputBar({
  value,
  onChange,
  onSend,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
}) {
  return (
    <section aria-label="Text input" className="session-text-input-bar" style={textInputBarStyle}>
      <input
        type="text"
        aria-label="Type your message"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onSend(); }}
        placeholder="Type your message…"
        autoFocus
        style={textInputFieldStyle}
      />
      <button onClick={onSend} style={textSendStyle}>
        Send
      </button>
    </section>
  );
}

// Bottom bar: type toggle, pause / resume and the end button.
export function SessionFooter({
  mode,
  showTextInput,
  onToggleText,
  isPaused,
  onPause,
  onResume,
  designNotReady,
  onEnd,
}: {
  mode: SessionMode;
  showTextInput: boolean;
  onToggleText: () => void;
  isPaused: boolean;
  onPause: () => void;
  onResume: () => void;
  designNotReady: boolean;
  onEnd: () => void;
}) {
  return (
    <footer className="session-footer" style={footerStyle}>
      {/* Text input toggle */}
      <button
        onClick={onToggleText}
        aria-label="Type message instead of speaking"
        aria-pressed={showTextInput}
        style={typeToggleStyle(showTextInput)}
      >
        ↩ Type instead
      </button>

      {/* Pause / Resume */}
      <button
        onClick={isPaused ? onResume : onPause}
        aria-label={isPaused ? "Resume session" : "Pause session"}
        style={pauseButtonStyle(isPaused)}
      >
        {isPaused ? "▶ Resume" : "⏸ Pause"}
      </button>

      {/* End Session */}
      <button
        onClick={onEnd}
        // Design mode only: disabled until the designer session has started.
        disabled={designNotReady}
        style={endButtonStyle(designNotReady)}
        onMouseEnter={(e) => {
          if (designNotReady) return;
          (e.currentTarget as HTMLButtonElement).style.background = "#B03E14";
          (e.currentTarget as HTMLButtonElement).style.color = "#fff";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "transparent";
          (e.currentTarget as HTMLButtonElement).style.color = "#B03E14";
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
  );
}
