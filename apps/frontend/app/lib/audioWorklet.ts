/**
 * AudioWorkletProcessor source exported as a string for blob-URL registration.
 *
 * AudioWorklet processors run in the AudioWorkletGlobalScope — a separate thread
 * from the main JS thread. They cannot be imported as ES modules in the standard
 * Next.js bundle, so we export the source as a string and register it via a
 * blob URL: audioContext.audioWorklet.addModule(blobUrl).
 *
 * Spec §5.1: 16kHz, mono, PCM16 — 100ms frames = 1600 samples at 16kHz.
 * AGENTS.md: AudioWorkletProcessor must run off the main thread.
 */

/** Samples per 100ms chunk at 16kHz (spec §5.1 locked chunk size). */
export const SAMPLES_PER_CHUNK = 1600; // 16000 Hz × 0.1 s

/**
 * Source code of the PCM16 capture AudioWorkletProcessor.
 * Register with:
 *   const blob = new Blob([PCM16_PROCESSOR_CODE], { type: "application/javascript" });
 *   await audioContext.audioWorklet.addModule(URL.createObjectURL(blob));
 */
export const PCM16_PROCESSOR_CODE = `
const SAMPLES_PER_CHUNK = ${SAMPLES_PER_CHUNK};

class PCM16CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    /** @type {Float32Array[]} */
    this._chunks = [];
    this._buffered = 0;
  }

  /**
   * Called by the audio engine per render quantum (~128 samples).
   * Buffers incoming mono samples until a full 100ms chunk is ready,
   * then transfers it to the main thread via postMessage.
   *
   * @param {Float32Array[][]} inputs  - inputs[0][0] is the mono channel
   * @returns {boolean} true = keep processor alive
   */
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel || channel.length === 0) return true;

    this._chunks.push(channel.slice()); // copy — quantum buffer is reused
    this._buffered += channel.length;

    while (this._buffered >= SAMPLES_PER_CHUNK) {
      // Assemble exactly SAMPLES_PER_CHUNK samples from buffered chunks
      const out = new Float32Array(SAMPLES_PER_CHUNK);
      let written = 0;

      while (written < SAMPLES_PER_CHUNK && this._chunks.length > 0) {
        const head = this._chunks[0];
        const needed = SAMPLES_PER_CHUNK - written;
        if (head.length <= needed) {
          out.set(head, written);
          written += head.length;
          this._chunks.shift();
        } else {
          out.set(head.subarray(0, needed), written);
          this._chunks[0] = head.subarray(needed);
          written = SAMPLES_PER_CHUNK;
        }
      }

      this._buffered -= SAMPLES_PER_CHUNK;
      // Transfer ownership — zero-copy to main thread
      this.port.postMessage(out, [out.buffer]);
    }

    return true;
  }
}

registerProcessor("pcm16-capture", PCM16CaptureProcessor);
`;

/**
 * Register the PCM16 capture AudioWorkletProcessor on the given AudioContext.
 * Must be called after a user gesture (AudioContext may be suspended otherwise).
 */
export async function registerPCM16Worklet(context: AudioContext): Promise<void> {
  const blob = new Blob([PCM16_PROCESSOR_CODE], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  try {
    await context.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
