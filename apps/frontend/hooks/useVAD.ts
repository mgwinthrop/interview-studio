"use client";

// VAD integration — spec §5.2
// Uses @ricky0123/vad-web (Silero WASM) for end-of-turn detection and
// speech-onset interrupt signalling. All thresholds are locked in AGENTS.md.
//
// minSpeechMs: 128  = minSpeechFrames(8)   × 16ms per frame
// preSpeechPadMs: 160 = preSpeechPadFrames(10) × 16ms per frame

import { useCallback, useEffect, useRef, useState } from "react";
import { MicVAD } from "@ricky0123/vad-web";
import type { ClientMessage, Hearing } from "../app/types";
import { audioConstraints, findByLabel, isMissingDevice, readMicChoice, saveMicChoice, type MicFallback } from "../app/lib/micDevice";

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
  /** Whether voice detection is really listening; the page must not say "Listening" otherwise. */
  hearing: Hearing;
  /** Set when the remembered microphone was missing and another one opened instead (FQ-40). */
  micFallback: MicFallback | null;
  startMic: () => Promise<void>;
  stopMic: () => void;
  pauseMic: () => void;
  resumeMic: () => void;
}

export function useVAD({ sendMessage, aiSpeaking, onSpeechSent, onInterrupt, getResponseGapMs }: UseVADOptions): UseVADReturn {
  const [micActive, setMicActive] = useState(false);
  const [hearing, setHearing] = useState<Hearing>("off");
  const [micFallback, setMicFallback] = useState<MicFallback | null>(null);
  const vadRef = useRef<Awaited<ReturnType<typeof MicVAD.new>> | null>(null);
  // Start generation: each startMic takes a new one, and stopMic/unmount bump it. A VAD whose
  // generation is no longer current is stale: its callbacks do nothing, and if it finishes
  // loading after a stop it is destroyed at once, so its microphone track never stays live.
  const genRef = useRef(0);
  // The start in progress, so overlapping startMic calls share it instead of making a second VAD.
  const startingRef = useRef<Promise<void> | null>(null);
  // True between unmount and the next mount: a late startMic (e.g. after audioQueue.resume())
  // must open nothing. The effect below resets it so a StrictMode remount re-enables the hook.
  const unmountedRef = useRef(false);
  // A pause requested before or during a start applies to that start. Set by pauseMic, cleared
  // by resumeMic and stopMic; startMic leaves it alone.
  const pausedRef = useRef(false);

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
    if (unmountedRef.current) return;
    let opened: MediaStream | null = null;
    const stopOpened = () => opened?.getTracks().forEach((t) => t.stop());
    // Opens the microphone for this start (first open and every reopen after a pause): the one
    // chosen in the mic check, found by id and then by name (ids can change between page loads),
    // or else the default with a notice (FQ-40). A stream that arrives after this start went
    // stale is stopped, so a stop during a reopen never leaves a microphone live.
    const openMic = async (): Promise<MediaStream> => {
      const choice = readMicChoice();
      let stream: MediaStream;
      let fallback: MicFallback | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(choice) });
      } catch (err) {
        if (!choice || !isMissingDevice(err)) throw err;
        const renamed = findByLabel(await navigator.mediaDevices.enumerateDevices(), choice.label);
        const found = renamed
          ? await navigator.mediaDevices.getUserMedia({ audio: audioConstraints({ ...choice, deviceId: renamed }) }).catch(() => null)
          : null;
        if (found) {
          stream = found;
          saveMicChoice({ deviceId: renamed!, label: choice.label });
        } else {
          stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(null) });
          fallback = { label: choice.label, using: stream.getAudioTracks()[0]?.label ?? "" };
        }
      }
      if (gen !== genRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error("stale microphone open");
      }
      setMicFallback(fallback);
      return stream;
    };
    let vad: Awaited<ReturnType<typeof MicVAD.new>>;
    try {
      vad = await MicVAD.new({
      // Worklet bundle + ONNX model served from public/ (copied by next.config.mjs)
      baseAssetPath: "/",
      // ONNX Runtime loader (.mjs) and WASM served from public/ too, copied by next.config.mjs from
      // the onnxruntime-web this package resolves, so their version always matches the JS runtime
      // and no third-party host is contacted (FQ-41).
      ortConfig: (ort) => {
        ort.env.wasm.wasmPaths = "/";
      },

      // Echo/noise suppression — prevents AI audio from triggering VAD. The settings live in
      // audioConstraints (app/lib/micDevice.ts), unchanged; only the chosen deviceId is added.
      getStream: async () => {
        opened = await openMic();
        return opened;
      },
      // Reopen after a pause: same device and settings (vad-web's default reopens the browser
      // default with its own settings).
      resumeStream: () => openMic(),

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
    } catch (err) {
      // The runtime or model could not load (blocked or missing file, unsupported browser). ONNX
      // Runtime keeps that failure for the page, so a retry would fail the same way.
      if (gen !== genRef.current) return;
      console.warn("Voice detection failed to load:", err instanceof Error ? err.name : "unknown");
      setHearing("failed");
      return;
    }

    // With startOnLoad false, MicVAD.new opens no microphone; start() does (getUserMedia).
    // vad-web's destroy() throws until start() has finished, so a stale VAD is only marked
    // destroyed here (it holds no stream yet), and start() is awaited before it is kept.
    // vad-web has no supported release for a VAD that never started (destroy() throws before
    // model.release()), so this path leaks one ONNX session per race; no microphone is involved.
    if (gen !== genRef.current || unmountedRef.current) {
      vad.destroy().catch(() => {});
      return;
    }
    try {
      await vad.start();
    } catch (err) {
      stopOpened(); // e.g. the worklet failed after the microphone opened
      if (gen !== genRef.current) return; // stale: stopMic/unmount already moved on
      // Log the name only (e.g. NotAllowedError or a blocked worklet); startMic never rejects.
      console.warn("Microphone start failed:", err instanceof Error ? err.name : "unknown");
      setHearing("failed");
      return;
    }
    // Stopped (or unmounted) while the microphone was opening: close it now.
    if (gen !== genRef.current) {
      stopOpened();
      await vad.destroy().catch(() => {});
      return;
    }
    vadRef.current = vad;
    // A pause requested while opening: keep the VAD but do not leave the mic live.
    if (pausedRef.current) vad.pause().catch(() => {});
    setMicActive(true);
    setHearing("ready");
  }, []);

  const startMic = useCallback(async (): Promise<void> => {
    if (unmountedRef.current) return;
    if (vadRef.current) return; // already initialised
    if (startingRef.current) return startingRef.current; // a start is already in progress
    const gen = ++genRef.current;
    setHearing("starting");
    setMicFallback(null);
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
    pausedRef.current = false;
    setMicActive(false);
    setHearing("off");
    setMicFallback(null);
  }, []);

  const pauseMic = useCallback(() => {
    pausedRef.current = true;
    vadRef.current?.pause().catch(() => {});
  }, []);

  const resumeMic = useCallback(() => {
    pausedRef.current = false;
    vadRef.current?.start().catch(() => {});
  }, []);

  // Clean up on unmount — bumping the generation gates callbacks so StrictMode's
  // first-unmount destroy doesn't cause stale callbacks to fire on remount, and a start
  // still loading destroys its VAD when it resolves.
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      genRef.current++;
      startingRef.current = null;
      vadRef.current?.destroy().catch(() => {});
      vadRef.current = null;
    };
  }, []);

  return { micActive, hearing, micFallback, startMic, stopMic, pauseMic, resumeMic };
}
