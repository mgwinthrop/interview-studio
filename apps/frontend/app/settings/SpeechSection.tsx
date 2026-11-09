"use client";

// Speech (speech-to-text id, text-to-speech model) and Audio (the fixed microphone format and the
// spoken-reply format).
import {
  CREATOR_PLAN_FORMAT,
  RECOMMENDED_FORMAT,
  RECOMMENDED_STT,
  RECOMMENDED_TTS,
  formatLabel,
  listDownMessage,
  type SettingsPage,
} from "../lib/settings";
import { disabledStyle, sectionHeadingStyle } from "../interviewers/edit/PhaseFields";
import { panelStyle } from "../interviewers/edit/EditorParts";
import { valueId, type DraftValues, type ValueKey } from "./draft";
import { ErrorText, Hint, SelectField, controlStyle, describedBy, fieldBlockStyle, hintStyle, labelStyle, smallSecondaryStyle, withKept, type Option } from "./fields";

const TTS_DOWN_ID = "tts-list-down";

function ttsOptions(page: SettingsPage, saved: string, current: string): Option[] {
  const list = page.ttsModels;
  if (!list) return [{ value: current, label: current }];
  const options = list.map((m) => ({
    value: m.id,
    label: `${m.name} (${m.id})${m.id === RECOMMENDED_TTS ? " – Recommended" : ""}`,
  }));
  return withKept(options, saved, current);
}

function formatOptions(page: SettingsPage, saved: string, current: string): Option[] {
  const options: Option[] = page.spokenFormats.map((id) => {
    let label = formatLabel(id);
    if (id === RECOMMENDED_FORMAT) label += " – Recommended";
    if (id === CREATOR_PLAN_FORMAT) label += " – needs the ElevenLabs Creator plan or above";
    return { value: id, label };
  });
  return withKept(options, saved, current);
}

interface SpeechSectionProps {
  page: SettingsPage;
  values: DraftValues;
  errors: Record<string, string>;
  locked: boolean;
  onChange: (key: ValueKey, value: string) => void;
  onRetryList: () => void;
  retrying: boolean;
}

export function SpeechSection({ page, values, errors, locked, onChange, onRetryList, retrying }: SpeechSectionProps) {
  const sttId = valueId("sttModel");
  const sttError = errors["values.sttModel"];
  const ttsId = valueId("ttsModel");
  const formatId = valueId("spokenFormat");
  const ttsDown = page.ttsModels === null;
  const downMsg = listDownMessage("tts", page.ttsListIssue);

  return (
    <>
      <section aria-labelledby="speech-heading" style={panelStyle}>
        <h2 id="speech-heading" tabIndex={-1} style={{ ...sectionHeadingStyle, outline: "none" }}>
          Speech
        </h2>
        <div style={fieldBlockStyle}>
          <label htmlFor={sttId} style={labelStyle}>
            Speech-to-text model
          </label>
          <input
            id={sttId}
            type="text"
            value={values.sttModel}
            readOnly={locked}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            aria-invalid={sttError ? true : undefined}
            aria-describedby={describedBy(`${sttId}-hint`, sttError && `${sttId}-error`)}
            onChange={(e) => onChange("sttModel", e.target.value)}
            style={controlStyle(Boolean(sttError), locked)}
          />
          <Hint id={`${sttId}-hint`}>
            Recommended: <code>{RECOMMENDED_STT}</code>. Type the model id exactly. A wrong id makes speech recognition
            fail; Reset to recommended fixes it.
          </Hint>
          {sttError && <ErrorText id={`${sttId}-error`} message={sttError} />}
        </div>

        {ttsDown && (
          <div style={{ marginBottom: 12 }}>
            <p id={TTS_DOWN_ID} style={{ ...hintStyle, color: "#102B33", fontWeight: 700, fontSize: 14 }}>
              {downMsg.text}
            </p>
            <button
              type="button"
              aria-disabled={locked ? true : undefined}
              onClick={() => {
                if (!locked) onRetryList();
              }}
              style={disabledStyle(smallSecondaryStyle, locked)}
            >
              {retrying ? "Loading the list…" : "Try loading the list again"}
            </button>
            {downMsg.keyNote && <p style={{ ...hintStyle, marginTop: 8 }}>{downMsg.keyNote}</p>}
          </div>
        )}
        <SelectField
          id={ttsId}
          label="Text-to-speech model"
          value={values.ttsModel}
          options={ttsOptions(page, page.values.ttsModel, values.ttsModel)}
          onChange={(v) => onChange("ttsModel", v)}
          unavailable={locked || ttsDown}
          hintIds={[`${ttsId}-hint`, ttsDown ? TTS_DOWN_ID : ""]}
          error={errors["values.ttsModel"]}
        >
          <Hint id={`${ttsId}-hint`}>
            Recommended: <code>{RECOMMENDED_TTS}</code>. This is the voice model that speaks the interviewer&apos;s
            replies.
          </Hint>
        </SelectField>
      </section>

      <section aria-labelledby="audio-heading" style={panelStyle}>
        <h2 id="audio-heading" style={sectionHeadingStyle}>
          Audio
        </h2>
        <p style={{ fontSize: 15, color: "#102B33", lineHeight: 1.6, margin: "0 0 16px" }}>
          Your microphone: 16 kHz, mono, 16-bit. This is fixed because voice detection, speech recognition and the
          connection depend on it.
        </p>
        <SelectField
          id={formatId}
          label="Spoken-reply format"
          value={values.spokenFormat}
          options={formatOptions(page, page.values.spokenFormat, values.spokenFormat)}
          onChange={(v) => onChange("spokenFormat", v)}
          unavailable={locked}
          hintIds={[`${formatId}-hint`]}
          error={errors["values.spokenFormat"]}
        >
          <Hint id={`${formatId}-hint`}>
            Recommended: {formatLabel(RECOMMENDED_FORMAT)}. The 192 kbps format needs the ElevenLabs Creator plan or
            above.
          </Hint>
        </SelectField>
      </section>
    </>
  );
}
