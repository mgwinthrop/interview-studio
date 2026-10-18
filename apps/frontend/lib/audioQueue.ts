// AudioQueue — receives TTS audio chunks from the server and plays them
// sequentially using precise Web Audio API scheduling (spec §5.8).
// Must be created inside a user gesture handler (or resume() called there)
// to satisfy browser autoplay policy.

export class AudioQueue {
  private context: AudioContext;
  private nextStartTime = 0;
  private chunkBuffer: Uint8Array[] = [];

  // Serialise all decodes through a promise chain so they schedule in arrival order,
  // even if decodeAudioData resolves out of order (which it can on some browsers).
  private decodeChain = Promise.resolve();
  // Incremented on flush() so in-flight decodes from the previous turn are discarded.
  private flushGeneration = 0;

  private sources = new Set<AudioBufferSourceNode>();
  private playbackTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private onPlaybackChange: (playing: boolean) => void = () => {}) {
    this.context = new AudioContext();
  }

  // Unblocks the AudioContext after the first user gesture, and resumes after presenter pause.
  async resume(): Promise<void> {
    if (this.context.state === "suspended") {
      await this.context.resume();
      this.onPlaybackChange(this.sources.size > 0);
    }
  }

  private scheduleDecoded(combined: Uint8Array): void {
    const gen = this.flushGeneration;
    this.decodeChain = this.decodeChain.then(async () => {
      if (this.disposed || this.flushGeneration !== gen) return; // flushed while decoding — discard

      let audioBuffer: AudioBuffer;
      try {
        audioBuffer = await this.context.decodeAudioData(combined.buffer as ArrayBuffer);
      } catch {
        return; // malformed chunk — skip
      }

      if (this.disposed || this.flushGeneration !== gen) return; // flushed during decode — discard

      const source = this.context.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.context.destination);
      const startAt = this.nextStartTime > this.context.currentTime
        ? this.nextStartTime
        : this.context.currentTime + 0.1;
      this.sources.add(source);
      source.onended = () => {
        this.sources.delete(source);
        if (this.sources.size === 0) this.onPlaybackChange(false);
      };
      if (this.playbackTimer === null) {
        this.playbackTimer = setTimeout(() => {
          this.playbackTimer = null;
          if (!this.disposed && this.flushGeneration === gen && this.context.state === "running" && this.sources.size > 0) this.onPlaybackChange(true);
        }, Math.max(0, (startAt - this.context.currentTime) * 1000));
      }
      source.start(startAt);
      this.nextStartTime = startAt + audioBuffer.duration;
    });
  }

  // Buffer incoming chunks — do NOT decode mid-stream.
  // decodeAudioData expects a complete audio file; mid-stream MP3 chunks lack
  // proper headers and produce artifacts or silent failures. flushBuffer() on
  // tts_end decodes the complete sentence audio in one call.
  enqueue(buffer: ArrayBuffer): void {
    this.chunkBuffer.push(new Uint8Array(buffer));
  }

  // Decode and schedule all buffered chunks as a complete audio file — call on tts_end.
  flushBuffer(): void {
    if (this.chunkBuffer.length === 0) return;

    const totalBytes = this.chunkBuffer.reduce((sum, c) => sum + c.byteLength, 0);
    if (totalBytes < 512) {
      console.warn(`[AudioQueue] dropping ${totalBytes}-byte buffer (below 512 threshold)`);
      this.chunkBuffer = [];
      return;
    }

    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of this.chunkBuffer) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.chunkBuffer = [];
    this.scheduleDecoded(combined);
  }

  // Stop all future audio immediately — called on interrupt (spec §5.9 step 3).
  flush(): void {
    if (this.playbackTimer !== null) clearTimeout(this.playbackTimer);
    this.playbackTimer = null;
    this.sources.forEach((source) => {
      source.onended = null;
      source.stop();
      source.disconnect();
    });
    this.sources.clear();
    this.onPlaybackChange(false);
    this.chunkBuffer = [];
    this.flushGeneration++;
    this.decodeChain = Promise.resolve(); // abandon pending chain
    this.nextStartTime = this.context.currentTime;
  }

  dispose(): void {
    this.disposed = true;
    this.flush();
    void this.context.close();
  }

  // Suspend audio playback immediately — called on presenter pause.
  async suspend(): Promise<void> {
    if (this.context.state === "running") {
      await this.context.suspend();
      this.onPlaybackChange(false);
    }
  }
}
