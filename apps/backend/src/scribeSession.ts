export type TranscriptHandler = (text: string) => void;
export type SttErrorHandler = (opts: { reason: string }) => void;

export class ScribeSession {
  private apiKey: string;
  private onTranscript: TranscriptHandler;
  private onSttError?: SttErrorHandler;
  private active = false;
  private fetchController: AbortController | null = null;

  constructor(apiKey: string, onTranscript: TranscriptHandler, onSttError?: SttErrorHandler) {
    this.apiKey = apiKey;
    this.onTranscript = onTranscript;
    this.onSttError = onSttError;
  }

  start(): void {
    this.active = true;
  }

  /**
   * Transcribe a complete PCM16 utterance buffer (from VAD onSpeechEnd).
   * Buffer must be 16kHz, mono, PCM16 little-endian.
   *
   * Uses the ElevenLabs REST API directly via fetch to avoid SDK multipart
   * upload issues (SDK's formdata-node sets filename='blob' when stream has
   * no .name property, causing the API to reject the audio).
   */
  async transcribe(pcm16Buffer: Buffer): Promise<void> {
    if (!this.active) return;

    this.fetchController = new AbortController();

    const formData = new FormData();
    // Use a named Blob so ElevenLabs receives a proper filename
    const blob = new Blob([pcm16Buffer], { type: "audio/pcm" });
    formData.append("file", blob, "audio.pcm");
    formData.append("model_id", "scribe_v2"); // locked per AGENTS.md
    formData.append("file_format", "pcm_s16le_16");
    formData.append("language_code", "en");

    try {
      const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
        method: "POST",
        signal: this.fetchController.signal,
        headers: { "xi-api-key": this.apiKey },
        body: formData,
      });

      if (!response.ok) {
        const body = await response.text();
        console.error(`Scribe error ${response.status}: ${body}`);
        this.onSttError?.({ reason: "low_confidence" });
        return;
      }

      const result = (await response.json()) as { text?: string };
      const text = result.text?.trim();
      if (text && this.active) {
        this.onTranscript(text);
      } else if (this.active) {
        // Empty transcript — signal client to retry (spec §5.3 stt_error)
        this.onSttError?.({ reason: "low_confidence" });
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        console.log("[ScribeSession] in-flight transcription aborted (interrupt) — result dropped");
        return;
      }
      console.error("Scribe transcription error:", err);
      this.onSttError?.({ reason: "low_confidence" });
    } finally {
      this.fetchController = null;
    }
  }

  /**
   * Cancel in-flight STT request and reset to accept new input (§5.9 step 7).
   */
  reset(): void {
    this.active = false;
    this.fetchController?.abort();
    this.fetchController = null;
    this.active = true;
  }

  stop(): void {
    this.active = false;
    this.fetchController?.abort();
    this.fetchController = null;
  }
}
