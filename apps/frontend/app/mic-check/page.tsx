"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "../components/Nav";
import { FlowStepper } from "../components/FlowStepper";

type PermissionState = "pending" | "granted" | "denied";
type RecordState = "idle" | "recording" | "playing";

const BAR_COUNT = 50;

// Static decorative waveform for the recording preview (matches screenshot aesthetic)
const STATIC_WAVE = Array.from({ length: BAR_COUNT }, (_, i) => {
  const t = i / BAR_COUNT;
  return Math.round(
    (Math.sin(t * Math.PI * 5) * 0.45 + Math.sin(t * Math.PI * 11) * 0.3 + 0.25) * 60
  );
});

export default function MicCheckPage() {
  const router = useRouter();

  const [permission, setPermission] = useState<PermissionState>("pending");
  const [started, setStarted] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [waveform, setWaveform] = useState<number[]>(new Array(BAR_COUNT).fill(0));
  const [recordState, setRecordState] = useState<RecordState>("idle");

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const objectUrlRef = useRef<string | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Waveform visualiser (time-domain) ─────────────────────────────────────
  const startVisualiser = useCallback((analyser: AnalyserNode) => {
    const data = new Uint8Array(analyser.fftSize);
    let frameCount = 0;
    function tick() {
      frameCount++;
      // Update every 6th frame (~10fps) so bars move at a readable pace
      if (frameCount % 6 === 0) {
        analyser.getByteTimeDomainData(data);
        const step = Math.floor(data.length / BAR_COUNT);
        const next = Array.from({ length: BAR_COUNT }, (_, i) => {
          const sample = data[i * step] ?? 128;
          return Math.abs(sample - 128); // 0–128
        });
        setWaveform(next);
      }
      animFrameRef.current = requestAnimationFrame(tick);
    }
    animFrameRef.current = requestAnimationFrame(tick);
  }, []);

  // ── Start audio stream ─────────────────────────────────────────────────────
  const startStream = useCallback(
    async (deviceId?: string) => {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      if (audioCtxRef.current) {
        await audioCtxRef.current.close();
        audioCtxRef.current = null;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        });
      } catch {
        setPermission("denied");
        return;
      }

      streamRef.current = stream;
      setPermission("granted");

      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const inputs = allDevices.filter((d) => d.kind === "audioinput");
      setDevices(inputs);
      if (!deviceId && inputs.length > 0) setSelectedDeviceId(inputs[0].deviceId);

      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      startVisualiser(analyser);
    },
    [startVisualiser]
  );

  function handleStartListening() {
    setStarted(true);
    startStream();
  }

  useEffect(() => {
    return () => {
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current);
      if (recordTimerRef.current !== null) clearTimeout(recordTimerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      if (audioCtxRef.current) audioCtxRef.current.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleDeviceChange(deviceId: string) {
    setSelectedDeviceId(deviceId);
    startStream(deviceId);
  }

  // ── Record / playback test ─────────────────────────────────────────────────
  function handleRecord() {
    if (recordState !== "idle" || !streamRef.current) return;
    chunksRef.current = [];
    const recorder = new MediaRecorder(streamRef.current);
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      const audio = new Audio(url);
      setRecordState("playing");
      audio.onended = () => {
        setRecordState("idle");
        URL.revokeObjectURL(url);
        objectUrlRef.current = null;
      };
      audio.play().catch(() => setRecordState("idle"));
    };

    recorder.start();
    setRecordState("recording");
    recordTimerRef.current = setTimeout(() => {
      if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
    }, 3000);
  }

  function handleProceed() {
    sessionStorage.setItem("mic_gesture_granted", "1");
    router.push("/"); // → persona selection (step 2)
  }

  const maxWave = Math.max(...waveform, 1);
  const isActive = permission === "granted";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        background: "#F4F5F1",
        fontFamily: "var(--font-manrope), sans-serif",
      }}
    >
      <Nav />
      <FlowStepper currentStep={1} />

      {/* Main content */}
      <div className="mic-check-content" style={{ flex: 1, padding: "48px 32px 48px", maxWidth: 800, margin: "0 auto", width: "100%" }}>
        {/* Heading */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <h1
            style={{
              fontSize: 36,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              color: "#000000",
              margin: "0 0 8px",
              lineHeight: 1.15,
            }}
          >
            Test your microphone
          </h1>
          <p style={{ fontSize: 16, color: "#6B7A8D", margin: 0, fontWeight: 400 }}>
            Enable your mic to begin the conversation
          </p>
        </div>

        {/* Tips row */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "8px 24px",
            justifyContent: "center",
            marginBottom: 32,
            fontSize: 14,
            color: "#000000",
            fontWeight: 400,
          }}
        >
          {[
            { icon: "●", text: "Find a quiet space" },
            { icon: "●", text: "Test your mic levels" },
            { icon: "●", text: "Record & listen back" },
            { icon: "🎧", text: "Use headphones to avoid echo" },
          ].map(({ icon, text }) => (
            <span key={text} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "#087E8B", fontSize: icon === "🎧" ? 14 : 10 }}>{icon}</span>
              {text}
            </span>
          ))}
        </div>

        {/* Permission denied */}
        {permission === "denied" && (
          <div
            style={{
              background: "#FFCEB9",
              border: "1px solid #E9784A",
              borderRadius: 10,
              padding: "16px 20px",
              fontSize: 14,
              color: "#CF370B",
              lineHeight: 1.6,
              marginBottom: 24,
            }}
          >
            <strong>Microphone access denied.</strong> Open your browser settings, allow microphone
            access for this site, then refresh.
          </div>
        )}

        {/* Two-column cards */}
        <div className="mic-check-cards" style={{ display: "flex", gap: 16 }}>
          {/* ── Left card: Audio levels ── */}
          <div style={cardStyle}>
            <div style={cardTitleStyle}>Audio levels</div>

            {/* Waveform visualiser */}
            <div style={waveformContainerStyle}>
              {waveform.map((val, i) => {
                const height = isActive
                  ? Math.max(3, Math.round((val / maxWave) * 52))
                  : 3;
                const isLoud = val > maxWave * 0.25;
                return (
                  <div
                    key={i}
                    style={{
                      width: 3,
                      height: `${height}px`,
                      borderRadius: 2,
                      background: isActive && isLoud ? "#087E8B" : "#C5CAE9",
                      transition: "height 0.2s ease",
                      flexShrink: 0,
                    }}
                  />
                );
              })}
            </div>

            {/* Progress indicator line */}
            <div
              style={{
                height: 2,
                background: "#E2E6EA",
                borderRadius: 1,
                margin: "8px 0 14px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: isActive ? `${Math.min(100, (Math.max(...waveform) / 128) * 200)}%` : "0%",
                  background: "#087E8B",
                  borderRadius: 1,
                  transition: "width 0.1s ease",
                }}
              />
            </div>

            {/* Device selector */}
            {isActive && devices.length > 0 && (
              <div>
                <label
                  htmlFor="device-picker"
                  style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#4B5563", marginBottom: 6 }}
                >
                  Microphone
                </label>
                <select
                  id="device-picker"
                  value={selectedDeviceId}
                  onChange={(e) => handleDeviceChange(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    borderRadius: 8,
                    border: "1px solid #E2E6EA",
                    background: "#FFFFFF",
                    color: "#000000",
                    fontSize: 14,
                    fontFamily: "var(--font-manrope), sans-serif",
                    cursor: "pointer",
                    appearance: "auto",
                  }}
                >
                  {devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {!started ? (
              <button
                onClick={handleStartListening}
                style={{
                  marginTop: 12,
                  width: "100%",
                  padding: "10px 0",
                  borderRadius: 8,
                  border: "1.5px solid #087E8B",
                  background: "#FFFFFF",
                  color: "#087E8B",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "var(--font-manrope), sans-serif",
                }}
              >
                Enable microphone
              </button>
            ) : (
              <div
                style={{
                  marginTop: 12,
                  fontSize: 13,
                  color: "#6B7A8D",
                  fontWeight: 400,
                  textAlign: "center",
                }}
              >
                {permission === "pending" && "Requesting microphone access…"}
                {permission === "granted" && "Listening..."}
                {permission === "denied" && "Mic access denied"}
              </div>
            )}
          </div>

          {/* ── Right card: Recording test ── */}
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span style={cardTitleStyle}>3-second recording test</span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  color: "#6B7A8D",
                  background: "#F0F2F5",
                  padding: "2px 8px",
                  borderRadius: 999,
                }}
              >
                Optional
              </span>
            </div>

            <p style={{ fontSize: 14, color: "#6B7A8D", margin: "0 0 16px", lineHeight: 1.6, fontWeight: 400 }}>
              Record a quick test and listen back to confirm your audio is clear.
            </p>

            {/* Preview waveform */}
            <div
              style={{
                ...waveformContainerStyle,
                background: "#F4F5F7",
                marginBottom: 16,
                cursor: isActive && recordState === "idle" ? "pointer" : "default",
              }}
              onClick={isActive && recordState === "idle" ? handleRecord : undefined}
            >
              {(recordState === "recording" ? waveform : STATIC_WAVE).map((val, i) => {
                const maxVal = recordState === "recording" ? maxWave : 60;
                const height = Math.max(3, Math.round((val / maxVal) * 48));
                const color =
                  recordState === "recording"
                    ? "#087E8B"
                    : recordState === "playing"
                    ? "#087E8B"
                    : "#C5CAE9";
                return (
                  <div
                    key={i}
                    style={{
                      width: 3,
                      height: `${height}px`,
                      borderRadius: 2,
                      background: color,
                      flexShrink: 0,
                      transition: recordState === "recording" ? "height 0.04s ease" : "none",
                    }}
                  />
                );
              })}
            </div>

            <button
              onClick={handleRecord}
              disabled={!isActive || recordState !== "idle"}
              style={{
                width: "100%",
                padding: "10px 0",
                borderRadius: 8,
                border: "1px solid #E2E6EA",
                background:
                  recordState === "recording"
                    ? "#FFCEB9"
                    : recordState === "playing"
                    ? "#D8F0EC"
                    : !isActive
                    ? "#F4F5F7"
                    : "#FFFFFF",
                color:
                  recordState === "recording"
                    ? "#CF370B"
                    : recordState === "playing"
                    ? "#087E8B"
                    : "#6B7A8D",
                fontSize: 14,
                fontWeight: 600,
                cursor: isActive && recordState === "idle" ? "pointer" : "default",
                fontFamily: "var(--font-manrope), sans-serif",
                transition: "background 0.2s, color 0.2s",
              }}
            >
              {recordState === "idle" && "Record"}
              {recordState === "recording" && "● Recording…"}
              {recordState === "playing" && "▶ Playing back…"}
            </button>
          </div>
        </div>
        {/* Inline CTA */}
        <button
          onClick={handleProceed}
          disabled={!isActive}
          style={{
            display: "block",
            width: "100%",
            marginTop: 24,
            padding: "16px 0",
            borderRadius: 10,
            border: "none",
            background: isActive ? "#000000" : "#D9D9D9",
            color: isActive ? "#FFFFFF" : "#6B7A8D",
            fontSize: 16,
            fontWeight: 600,
            cursor: isActive ? "pointer" : "default",
            letterSpacing: "0.01em",
            fontFamily: "var(--font-manrope), sans-serif",
            transition: "background 0.15s",
          }}
        >
          Mic check complete — continue →
        </button>
      </div>
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  flex: 1,
  background: "#FFFFFF",
  border: "1px solid #E2E6EA",
  borderRadius: 12,
  padding: "24px 20px",
  display: "flex",
  flexDirection: "column",
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: "#000000",
  marginBottom: 12,
};

const waveformContainerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 2,
  height: 72,
  background: "#F8F9FB",
  borderRadius: 8,
  padding: "0 10px",
  overflow: "hidden",
};
