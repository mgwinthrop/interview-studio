import CopyPlugin from "copy-webpack-plugin";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * COOP/COEP headers — required for SharedArrayBuffer, which is used by
   * onnxruntime-web's threaded WASM backend (loaded by @ricky0123/vad-web).
   * Scoped to /session only to avoid breaking other pages or third-party embeds.
   */
  async headers() {
    return [
      {
        source: "/session",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
      {
        // Also apply to all static assets fetched from /session context
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },

  webpack(config, { isServer }) {
    if (!isServer) {
      config.plugins.push(
        new CopyPlugin({
          patterns: [
            // VAD AudioWorklet bundle — loaded by MicVAD via baseAssetPath
            {
              from: path.join(
                __dirname,
                "node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js"
              ),
              to: path.join(__dirname, "public"),
            },
            // Silero VAD ONNX models — loaded by MicVAD via baseAssetPath
            {
              from: path.join(
                __dirname,
                "node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx"
              ),
              to: path.join(__dirname, "public"),
            },
            {
              from: path.join(
                __dirname,
                "node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx"
              ),
              to: path.join(__dirname, "public"),
            },
            // ONNX Runtime WASM binaries — loaded via ort.env.wasm.wasmPaths
            {
              from: path.join(
                __dirname,
                "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm"
              ),
              to: path.join(__dirname, "public"),
            },
            {
              from: path.join(
                __dirname,
                "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm"
              ),
              to: path.join(__dirname, "public"),
            },
          ],
        })
      );
    }
    return config;
  },
};

export default nextConfig;
