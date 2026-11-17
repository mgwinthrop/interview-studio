import CopyPlugin from "copy-webpack-plugin";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The onnxruntime-web build that vad-web's real-time VAD loads, resolved from vad-web itself so
// the copied loader and WASM always match the JS runtime it runs (FQ-41: no CDN, no version skew).
const ortDist = path.dirname(
  createRequire(path.join(__dirname, "node_modules/@ricky0123/vad-web/package.json")).resolve("onnxruntime-web/wasm")
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The Playwright build sets NEXT_DIST_DIR=.next-e2e, so its test-seam build never overwrites
  // the normal .next (FQ-108 S0). Everything else uses the default.
  distDir: process.env.NEXT_DIST_DIR || ".next",

  // Always defined, so Next inlines it as a literal. Left unset, Next keeps a runtime lookup on
  // its process.env polyfill, the seam check cannot fold to false, and the seam code ships
  // (caught by check:no-test-seams while building FQ-108 S0).
  env: { NEXT_PUBLIC_TEST_SEAMS: process.env.NEXT_PUBLIC_TEST_SEAMS === "1" ? "1" : "" },

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
            // ONNX Runtime loader and WASM — loaded from "/" via ort.env.wasm.wasmPaths (useVAD.ts).
            // The .mjs is also the script of the runtime's pthread workers.
            { from: path.join(ortDist, "ort-wasm-simd-threaded.mjs"), to: path.join(__dirname, "public") },
            { from: path.join(ortDist, "ort-wasm-simd-threaded.wasm"), to: path.join(__dirname, "public") },
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
