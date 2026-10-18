import Anthropic from "@anthropic-ai/sdk";
import { WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import { getSession, updateSession } from "./sessionStore";
import { getRuntimeState, setRuntimeState } from "./runtimeStore";
import { SentenceChunker } from "./sentenceChunker";
import { streamTTS } from "./ttsStream";
import { buildSystemPrompt, shouldTransition, nextPhase } from "./llm";
import { getTopicConfig } from "./topic";
import { ConversationTurn } from "./types";
import { send } from "./wsUtils";
import { persistTurn, persistPhaseTransition } from "./persistence";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });

// Overridable via CARTESIA_VOICE_ID env var — see AGENTS.md Infrastructure
const CARTESIA_DEFAULT_VOICE_ID = "694f9389-aac1-45b6-b726-9d9369183238";


export async function runTurn(
  sessionId: string,
  userText: string,
  ws: WebSocket
): Promise<void> {
  const session = getSession(sessionId);
  if (!session) return;

  const voiceId = process.env.ELEVENLABS_VOICE_ID ?? "pNInz6obpgDQGcFmaJgB";
  const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY ?? "";
  const cartesiaApiKey = process.env.CARTESIA_API_KEY;
  const cartesiaVoiceId = process.env.CARTESIA_VOICE_ID ?? CARTESIA_DEFAULT_VOICE_ID;
  const cartesiaOptions = cartesiaApiKey ? { apiKey: cartesiaApiKey, voiceId: cartesiaVoiceId } : undefined;

  // Build message history from all turns in the session.
  const messages: Anthropic.MessageParam[] = session.turns.map((turn) => ({
    role: turn.role as "user" | "assistant",
    content: turn.content,
  }));

  // When session.turns is empty this is the synthetic greeting trigger — no real user turn exists yet.
  // Prime the LLM with a minimal user message so it generates its opening greeting.
  // The message is never stored in session.turns, so it doesn't affect turn counts or transcripts.
  if (messages.length === 0) {
    messages.push({ role: "user", content: "Hello" });
  }

  const systemPrompt = buildSystemPrompt(session.phase, getTopicConfig(session.topicId));

  const chunker = new SentenceChunker();
  setRuntimeState(sessionId, { activeChunker: chunker });
  let fullResponse = "";
  // Accumulates complete sentences for partial transcript events (spec §7 streaming transcript)
  let partialAccumulated = "";

  // Sequential TTS pipeline: each sentence is queued onto a promise chain
  // so sentences play one after another without overlap.
  let ttsChain: Promise<void> = Promise.resolve();
  let latencyEmitted = false; // Only the first sentence carries vadT0 for latency_metric

  chunker.on("sentence", (sentence: string) => {
    // Emit partial transcript immediately (before TTS is queued) so text arrives
    // ahead of audio — the client accumulates these into a single growing entry.
    partialAccumulated += sentence;
    send(ws, { type: "transcript", text: partialAccumulated, role: "assistant", partial: true });

    ttsChain = ttsChain.then(async () => {
      // If an interrupt fired before this callback ran, llmController is already aborted.
      // Skip streamTTS() entirely — starting a stream with no cancel handle is the bug.
      if (llmController.signal.aborted) return;
      // Pass vadT0 only on the first sentence so latency_metric fires on the first tts_chunk
      const vadT0 = latencyEmitted ? undefined : getRuntimeState(sessionId)?.vadT0;
      if (vadT0 !== undefined) latencyEmitted = true;
      const { promise, abort } = streamTTS(sentence, ws, voiceId, elevenLabsApiKey, vadT0, cartesiaOptions);
      // Register abort handle immediately before any async gap
      getRuntimeState(sessionId)?.activeTTSAborts.push(() => abort.abort());
      await promise;
    }).catch((err) => {
      if (!llmController.signal.aborted) {
        console.error(`[${sessionId}] TTS sentence error:`, err);
        send(ws, { type: "tts_end" });
      }
    });
    // Track the tail of the chain so the interrupt handler can await settlement
    setRuntimeState(sessionId, { activeTTSChain: ttsChain });
  });

  // Wrap LLM stream in an AbortController so interrupt handling can cancel it
  const llmController = new AbortController();
  setRuntimeState(sessionId, { activeLLMAbort: llmController });

  const stream = anthropic.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 300,
    system: systemPrompt,
    messages,
  }, { signal: llmController.signal });

  try {
    for await (const event of stream) {
      if (llmController.signal.aborted) break;
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        const token = event.delta.text;
        fullResponse += token;
        chunker.push(token);
      }
    }
  } catch (err) {
    if (llmController.signal.aborted) {
      // Expected on interrupt — exit cleanly without storing partial response
      setRuntimeState(sessionId, { activeLLMAbort: undefined, activeChunker: undefined, activeTTSChain: undefined });
      return;
    }
    console.error(`[${sessionId}] LLM stream error:`, err);
    // Fall through — store whatever was accumulated and end the turn
  }

  // Stream complete — clear transient handles so stale references don't persist into the next turn
  setRuntimeState(sessionId, { activeLLMAbort: undefined, activeChunker: undefined, activeTTSChain: undefined });

  // Emit assistant transcript to client (§5.3) — only if the LLM completed (not interrupted)
  if (fullResponse && !llmController.signal.aborted) {
    send(ws, { type: "transcript", text: fullResponse, role: "assistant" });
  }

  // Flush any remaining partial sentence
  chunker.flush();

  // Wait for all queued TTS to complete, then clear abort handles
  await ttsChain;
  setRuntimeState(sessionId, { activeTTSAborts: [] });

  // Store the full assistant response
  const assistantTurn: ConversationTurn = {
    id: uuidv4(),
    sessionId,
    role: "assistant",
    content: fullResponse,
    phase: session.phase,
    timestamp: new Date(),
  };

  const updatedSession = getSession(sessionId);
  if (!updatedSession) return;

  updateSession(sessionId, (s) => ({ turns: [...s.turns, assistantTurn] }));
  persistTurn(assistantTurn).catch((err) =>
    console.error(`[${sessionId}] persistTurn (assistant) error:`, err)
  );

  // Check for phase transition — count user turns only
  const userTurnCount = updatedSession.turns.filter((t) => t.role === "user").length;
  if (shouldTransition(updatedSession.phase, userTurnCount, getRuntimeState(sessionId)?.demo)) {
    const next = nextPhase(updatedSession.phase);
    updateSession(sessionId, { phase: next });
    persistPhaseTransition(sessionId, next).catch((err) =>
      console.error(`[${sessionId}] persistPhaseTransition error:`, err)
    );
    send(ws, { type: "phase_change", phase: next });
    console.log(`[${sessionId}] phase transition: ${updatedSession.phase} → ${next}`);
  }
}
