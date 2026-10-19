// Loads the interviewer for the session page, then mounts the conversation view.
import type { ComponentType } from "react";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DESIGNER_ID,
  fetchInterviewer,
  type InterviewerDetail,
  type InterviewerInput,
} from "../lib/interviewers";
import { DEFAULT_RETURN_TO, peekDraft } from "../lib/interviewerForm";
import { LoadFailedOverlay } from "./ModeParts";
import { loadingStyle } from "./styles";

/**
 * `design`: a conversation with the designer that ends in a draft for the editor.
 * `try`: a conversation with an unsaved draft from sessionStorage. Neither stores anything.
 * Null is the normal interview.
 */
export type SessionMode = "design" | "try" | null;

export interface SessionViewProps {
  interviewer: InterviewerDetail;
  demo: boolean;
  /** Omitted for the normal interview. */
  mode?: SessionMode;
  /** What the session runs (design and try modes); the normal interview uses interviewer.id. */
  start?: string | InterviewerInput;
  /** Try mode: where "Finish trial" goes. */
  returnTo?: string;
}

export function parseMode(value: string | null): SessionMode {
  return value === "design" || value === "try" ? value : null;
}

// Try it never calls the interviewer API: the phase strip and header come from the draft itself.
export function detailFromDraft(input: InterviewerInput): InterviewerDetail {
  return { ...input, id: "", source: "custom", version: 0, createdAt: "", updatedAt: "" };
}

export function LoadingScreen() {
  return (
    <div role="status" aria-label="Loading session" style={loadingStyle}>
      Loading…
    </div>
  );
}

// Inner component — must be inside <Suspense> because it calls useSearchParams().
// Loads the interviewer first; the conversation (and its WebSocket) mounts only once
// the interviewer is known to exist, so an unknown id never opens a session.
export function SessionPageInner({ View }: { View: ComponentType<SessionViewProps> }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // The designer's id always means design mode (the server runs a designer session for it,
  // which ends in a draft, never a report), even on a link without mode=design.
  const mode: SessionMode =
    searchParams.get("interviewerId") === DESIGNER_ID ? "design" : parseMode(searchParams.get("mode"));
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

  if (loadFailed) return <LoadFailedOverlay onRetry={() => setLoadAttempt((n) => n + 1)} />;

  if (!interviewer) return <LoadingScreen />;

  if (mode === "try") {
    if (!tryDraft) return <LoadingScreen />;
    return (
      <View
        interviewer={interviewer}
        demo={demo}
        mode="try"
        start={tryDraft.input}
        returnTo={tryDraft.returnTo || DEFAULT_RETURN_TO}
      />
    );
  }

  if (mode === "design") {
    return <View interviewer={interviewer} demo={demo} mode="design" start={DESIGNER_ID} />;
  }

  return <View interviewer={interviewer} demo={demo} />;
}
