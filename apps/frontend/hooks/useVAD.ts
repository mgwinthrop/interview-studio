"use client";

// VAD integration — spec §5.2
// Uses @ricky0123/vad-web (Silero WASM) for end-of-turn detection and
// speech-onset interrupt signalling. All thresholds are locked in AGENTS.md.
//
// minSpeechMs: 128  = minSpeechFrames(8)   × 16ms per frame
// preSpeechPadMs: 160 = preSpeechPadFrames(10) × 16ms per frame

import { useCallback, useEffect, useRef, useState } from "react";
import { MicVAD } from "@ricky0123/vad-web";
import type { ClientMessage } from "../app/types";

interface UseVADOptions {
  sendMessage: (msg: ClientMessage) => void;
  aiSpeaking: boolean;
  /** Fires after PCM16 audio is sent in onSpeechEnd — use to transition orb to "thinking" */
  onSpeechSent?: () => void;
  /** Fires in onSpeechStart when AI is not speaking — reserved for future use */
  onInterrupt?: () => void;
  /**
   * Given performance.now() at speech start, returns ms since the interviewer's playback
   * finished, or null when there is no valid gap. Consulted only for answers that began
   * while the interviewer was silent.
   */
  getResponseGapMs?: (speechStartedAtMs: number) => number | null;
}

interface UseVADReturn {
  micActive: boolean;
  startMic: () => Promise<void>;
  stopMic: () => void;
  pauseMic: () => void;
  resumeMic: () => void;
}

export function useVAD({ sendMessage, aiSpeaking, onSpeechSent, onInterrupt, getResponseGapMs }: UseVADOptions): UseVADReturn {
  const [micActive, setMicActive] = useState(false);
  const vadRef = useRef<Awaited<ReturnType<typeof MicVAD.new>> | null>(null);
  // Start generation: each startMic takes a new one, and stopMic/unmount bump it. A VAD whose
  // generation is no longer current is stale: its callbacks do nothing, and if it finishes
  // loading after a stop it is destroyed at once, so its microphone track never stays live.
  const genRef = useRef(0);
  // The start in progress, so overlapping startMic calls share it instead of making a second VAD.
  const startingRef = useRef<Promise<void> | null>(null);

  // aiSpeakingRef — kept fresh so VAD closure always reads current value
  const aiSpeakingRef = useRef(false);
  useEffect(() => { aiSpeakingRef.current = aiSpeaking; }, [aiSpeaking]);

  // Stable refs so VAD callbacks don't capture stale function references
  const sendMessageRef = useRef(sendMessage);
  useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);
  const onSpeechSentRef = useRef(onSpeechSent);
  useEffect(() => { onSpeechSentRef.current = onSpeechSent; }, [onSpeechSent]);
  const onInterruptRef = useRef(onInterrupt);
  useEffect(() => { onInterruptRef.current = onInterrupt; }, [onInterrupt]);
  const getResponseGapMsRef = useRef(getResponseGapMs);
  useEffect(() => { getResponseGapMsRef.current = getResponseGapMs; }, [getResponseGapMs]);

  // Response-gap bookkeeping for the utterance currently in progress.
  const speechStartedAtRef = useRef<number | null>(null);
  // True when the interviewer was speaking as this utterance began (a barge-in): no gap is reported.
  const startedDuringAiSpeechRef = useRef(false);

  // Creates and starts the VAD for start generation `gen` (only startMic calls this).
  const loadVad = useCallback(async (gen: number): Promise<void> => {
    // The stream start() opens, so a start that fails or goes stale can always stop its tracks.
    let opened: MediaStream | null = null;
    const stopOpened = () => opened?.getTracks().forEach((t) => t.stop());
    const vad = await MicVAD.new({
      // Worklet bundle + ONNX model served from public/ (copied by next.config.mjs)
      baseAssetPath: "/",
      // WASM binaries from CDN — avoids shipping large .wasm files in the bundle
      ortConfig: (ort) => {
        ort.env.wasm.wasmPaths =
          "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/";
      },

      // Echo/noise suppression — prevents AI audio from triggering VAD
      getStream: async () => {
        opened = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            sampleRate: 16000,
            channelCount: 1,
          },
        });
        return opened;
      },

      // Locked thresholds — do not change (AGENTS.md)
      positiveSpeechThreshold: 0.8,
      negativeSpeechThreshold: 0.5,
      minSpeechMs: 128,        // 8 frames × 16ms
      preSpeechPadMs: 160,     // 10 frames × 16ms
      startOnLoad: false,

      onSpeechStart() {
        if (gen !== genRef.current) return;
        speechStartedAtRef.current = performance.now();
        startedDuringAiSpeechRef.current = aiSpeakingRef.current;
        // Only interrupt when AI is currently speaking — echo cancellation prevents
        // false positives from the AI's own audio triggering this path.
        // When AI is not speaking, onSpeechStart is a no-op: onSpeechEnd sends the audio.
        if (!aiSpeakingRef.current) return;
        sendMessageRef.current({ type: "interrupt" }); // sends WS msg + flushes audioQueue via sendMessageWithFlush
        onInterruptRef.current?.(); // snap orb to interrupted immediately (spec §5.9 step 4)
      },

      onSpeechEnd(audio: Float32Array) {
        if (gen !== genRef.current) return;
        // Convert Float32 → PCM16 little-endian (spec §5.1)
        const pcm16 = new Int16Array(audio.length);
        for (let i = 0; i < audio.length; i++) {
          pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(audio[i] * 32768)));
        }
        // Report how long the user took to start answering, unless this was a barge-in.
        const startedAt = speechStartedAtRef.current;
        const wasBargeIn = startedDuringAiSpeechRef.current;
        speechStartedAtRef.current = null;
        startedDuringAiSpeechRef.current = false;
        if (startedAt !== null && !wasBargeIn) {
          const gap = getResponseGapMsRef.current?.(startedAt);
          if (typeof gap === "number" && Number.isFinite(gap) && gap >= 0) {
            sendMessageRef.current({ type: "turn_timing", responseGapMs: Math.round(gap) });
          }
        }
        sendMessageRef.current({ type: "audio", data: pcm16.buffer });
        onSpeechSentRef.current?.(); // orb transitions to "thinking"
      },

      onVADMisfire() {
        if (gen !== genRef.current) return;
        // Short non-speech burst — ignore (spec §5.2); just drop the recorded start
        speechStartedAtRef.current = null;
        startedDuringAiSpeechRef.current = false;
      },
    });

    // With startOnLoad false, MicVAD.new opens no microphone; start() does (getUserMedia).
    // vad-web's destroy() throws until start() has finished, so a stale VAD is only marked
    // destroyed here (it holds no stream yet), and start() is awaited before it is kept.
    if (gen !== genRef.current) {
      vad.destroy().catch(() => {});
      return;
    }
    try {
      await vad.start();
    } catch (err) {
      stopOpened(); // e.g. the worklet failed after the microphone opened
      throw err;
    }
    // Stopped (or unmounted) while the microphone was opening: close it now.
    if (gen !== genRef.current) {
      stopOpened();
      await vad.destroy().catch(() => {});
      return;
    }
    vadRef.current = vad;
    setMicActive(true);
  }, []);

  const startMic = useCallback(async (): Promise<void> => {
    if (vadRef.current) return; // already initialised
    if (startingRef.current) return startingRef.current; // a start is already in progress
    const gen = ++genRef.current;
    const starting = loadVad(gen);
    startingRef.current = starting;
    try {
      await starting;
    } finally {
      // stopMic may have dropped this start already, and a newer one may have replaced it.
      if (startingRef.current === starting) startingRef.current = null;
    }
  }, [loadVad]);

  const stopMic = useCallback(() => {
    genRef.current++; // stale-marks any start still loading and the current VAD's callbacks
    startingRef.current = null; // a start after this stop makes a new VAD, never reuses the stale one
    vadRef.current?.destroy().catch(() => {});
    vadRef.current = null;
    setMicActive(false);
  }, []);

  const pauseMic = useCallback(() => {
    vadRef.current?.pause();
  }, []);

  const resumeMic = useCallback(() => {
    vadRef.current?.start();
  }, []);

  // Clean up on unmount — bumping the generation gates callbacks so StrictMode's
  // first-unmount destroy doesn't cause stale callbacks to fire on remount, and a start
  // still loading destroys its VAD when it resolves.
  useEffect(() => {
    return () => {
      genRef.current++;
      startingRef.current = null;
      vadRef.current?.destroy().catch(() => {});
      vadRef.current = null;
    };
  }, []);

  return { micActive, startMic, stopMic, pauseMic, resumeMic };
}
