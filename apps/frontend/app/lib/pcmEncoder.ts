/**
 * Convert a Float32Array of audio samples to a PCM16 little-endian ArrayBuffer.
 *
 * Spec §5.1: 16kHz, mono, PCM16 little-endian — do not change format.
 * Input samples are in the range [-1, 1]; output is Int16 in [-32768, 32767].
 */
export function float32ToPCM16(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i++) {
    // Clamp to [-1, 1] then scale to Int16 range
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, clamped * 32767, /* littleEndian= */ true);
  }
  return buffer;
}
