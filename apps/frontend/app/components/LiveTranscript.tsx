"use client";

import { useEffect, useRef } from "react";
import type { TranscriptEntry } from "../types";
import { speakerBadge, speakerLabel } from "../lib/sessionDisplay";

interface LiveTranscriptProps {
  entries: TranscriptEntry[];
  /** Server-side reply state; drives only the dim while a reply streams (#43 owns that). */
  aiSpeaking: boolean;
  /** Same state the side panel shows, including buffered playback after tts_end. */
  interviewerSpeaking: boolean;
  /** The interviewer's display name; absent shows "Interviewer". */
  interviewerName?: string;
}

function Avatar({ role, interviewerName }: { role: "user" | "assistant"; interviewerName?: string }) {
  return (
    <div
      style={{
        width: 24,
        height: 24,
        borderRadius: "50%",
        background: role === "assistant" ? "#102B33" : "#E2E6EA",
        color: role === "assistant" ? "#FFFFFF" : "#566475",
        fontSize: 10,
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        letterSpacing: 0,
      }}
    >
      {speakerBadge(role, interviewerName)}
    </div>
  );
}

function Chip({ label, bg, color }: { label: string; bg: string; color: string }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        background: bg,
        color,
        padding: "2px 8px",
        borderRadius: 999,
      }}
    >
      {label}
    </span>
  );
}

export function LiveTranscript({ entries, aiSpeaking, interviewerSpeaking, interviewerName }: LiveTranscriptProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  const lastEntryIsAi =
    entries.length > 0 && entries[entries.length - 1].role === "assistant";
  const currentQuestionIndex = lastEntryIsAi ? entries.length - 1 : -1;

  const exchangeCount = entries.filter((e) => e.role === "assistant").length;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "#FFFFFF",
        // Fade transcript when AI is speaking (spec §7)
        opacity: aiSpeaking ? 0.4 : 1,
        transition: "opacity 0.2s ease",
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          flexShrink: 0,
          padding: "16px 28px 0",
          borderBottom: "1px solid #E2E6EA",
        }}
      >
        {/* Row 1: title + exchange count + speaking badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: "#000000" }}>
              Live transcript
            </span>
            <span style={{ fontSize: 12, color: "#566475", fontWeight: 400 }}>
              {exchangeCount} {exchangeCount === 1 ? "exchange" : "exchanges"}
            </span>
          </div>
          {interviewerSpeaking && (
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "#066C77",
                background: "#D8F0EC",
                padding: "3px 10px",
                borderRadius: 999,
              }}
            >
              ••• Speaking
            </span>
          )}
        </div>

      </div>

      {/* ── Transcript entries ── */}
      <div
        aria-live="polite"
        aria-label="Interview transcript"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "20px 28px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {entries.length === 0 && (
          <div
            style={{
              color: "#566475",
              fontSize: 18,
              fontStyle: "italic",
              textAlign: "center",
              marginTop: 48,
              fontWeight: 400,
            }}
          >
            The conversation will appear here…
          </div>
        )}

        {entries.map((entry, idx) => {
          const isUser = entry.role === "user";
          const isCurrentQuestion = !isUser && idx === currentQuestionIndex;

          if (isUser) {
            return (
              <div key={entry.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Avatar role="user" interviewerName={interviewerName} />
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "#566475",
                    }}
                  >
                    {speakerLabel("user", interviewerName)}
                  </span>
                </div>
                <div
                  style={{
                    padding: "14px 18px",
                    borderRadius: 8,
                    background: "#F4F5F1",
                    border: "0.5px solid #E2E6EA",
                    fontSize: 18,
                    lineHeight: 1.6,
                    color: "#000000",
                    fontWeight: 400,
                    wordBreak: "break-word",
                  }}
                >
                  {entry.content}
                </div>
              </div>
            );
          }

          if (isCurrentQuestion) {
            return (
              <div key={entry.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Avatar role="assistant" interviewerName={interviewerName} />
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "#566475",
                    }}
                  >
                    {speakerLabel("assistant", interviewerName)}
                    {interviewerSpeaking ? " speaking" : ""}
                  </span>
                  <Chip label="Current Question" bg="#D8F0EC" color="#066C77" />
                </div>
                <div
                  style={{
                    padding: "14px 18px",
                    borderRadius: 8,
                    background: "#102B33",
                    fontSize: 18,
                    lineHeight: 1.6,
                    color: "#FFFFFF",
                    fontWeight: 400,
                    wordBreak: "break-word",
                    borderLeft: "2px solid #087E8B",
                  }}
                >
                  {entry.content}
                  <span
                    style={{
                      display: "inline-block",
                      width: 2,
                      height: 18,
                      background: "#087E8B",
                      marginLeft: 3,
                      verticalAlign: "middle",
                      animation: aiSpeaking ? "blink 1s step-end infinite" : "none",
                    }}
                  />
                </div>
              </div>
            );
          }

          // Completed AI question
          return (
            <div key={entry.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Avatar role="assistant" interviewerName={interviewerName} />
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "#566475",
                  }}
                >
                  {speakerLabel("assistant", interviewerName)}
                </span>
                <Chip label="Completed" bg="#F0F2F5" color="#566475" />
              </div>
              <div
                style={{
                  padding: "14px 18px",
                  borderRadius: 8,
                  background: "#F4F5F1",
                  border: "0.5px solid #E2E6EA",
                  fontSize: 14,
                  lineHeight: 1.6,
                  color: "#566475",
                  fontWeight: 400,
                  wordBreak: "break-word",
                }}
              >
                {entry.content}
              </div>
            </div>
          );
        })}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
