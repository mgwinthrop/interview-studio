"use client";

// Claude models (one select per job, with its recommendation) and the reply length.
import { SETTINGS_LIMITS, tierLabel, type Job, type SettingsPage } from "../lib/settings";
import { disabledStyle, sectionHeadingStyle } from "../interviewers/edit/PhaseFields";
import { panelStyle } from "../interviewers/edit/EditorParts";
import { valueId, type DraftValues, type ValueKey } from "./draft";
import {
  ErrorText,
  Hint,
  SelectField,
  controlStyle,
  describedBy,
  fieldBlockStyle,
  hintStyle,
  labelStyle,
  smallSecondaryStyle,
  subHeadingStyle,
  withKept,
  type Option,
} from "./fields";

const JOBS: readonly { job: Job; key: "replyModel" | "reportModel" | "draftModel"; label: string; advice: string }[] = [
  {
    job: "reply",
    key: "replyModel",
    label: "Conversation replies",
    advice:
      "Recommended: Fast or Balanced. Replies are spoken aloud in under 40 words, so a quick answer matters more than depth. A slower model makes the interviewer pause longer before speaking.",
  },
  {
    job: "report",
    key: "reportModel",
    label: "Reports",
    advice:
      "Recommended: Balanced or Most capable. One long written answer, produced once at the end. Quality matters more than speed; there is time for it (up to 90 seconds).",
  },
  {
    job: "draft",
    key: "draftModel",
    label: "Interviewer and persona drafts",
    advice:
      "Recommended: Balanced or Most capable. One structured answer from your description or your approved calls. A more capable model usually writes a sharper persona. The check for names and client terms runs in code whichever model you pick.",
  },
];

const LIST_DOWN_ID = "claude-list-down";

function modelOptions(page: SettingsPage, job: Job, saved: string, current: string): Option[] {
  const list = page.claudeModels;
  if (!list) return [{ value: current, label: current }];
  const recommended = page.recommended[job]?.model;
  const options = list.map((m) => {
    const tier = tierLabel(m.tier);
    let label = m.displayName;
    if (tier) label += ` (${tier})`;
    if (m.deprecated) label += " (deprecated)";
    if (m.id === recommended) label += " – Recommended";
    return { value: m.id, label };
  });
  return withKept(options, saved, current);
}

function recommendationLine(page: SettingsPage, job: Job): string | null {
  const rec = page.recommended[job];
  if (!rec) return null;
  const name = page.claudeModels?.find((m) => m.id === rec.model)?.displayName ?? rec.model;
  const tier = tierLabel(rec.tier);
  return `Recommended for this job: ${name}${tier ? ` (${tier})` : ""}`;
}

interface ModelsSectionProps {
  page: SettingsPage;
  values: DraftValues;
  errors: Record<string, string>;
  /** A request is running: nothing can be changed. */
  locked: boolean;
  onChange: (key: ValueKey, value: string) => void;
  onRetryList: () => void;
  retrying: boolean;
}

export function ModelsSection({ page, values, errors, locked, onChange, onRetryList, retrying }: ModelsSectionProps) {
  const listDown = page.claudeModels === null;
  const tokensId = valueId("replyMaxTokens");
  const tokensError = errors["values.replyMaxTokens"];

  return (
    <section aria-labelledby="models-heading" style={panelStyle}>
      <h2 id="models-heading" tabIndex={-1} style={{ ...sectionHeadingStyle, outline: "none" }}>
        Claude models
      </h2>
      <p style={{ ...hintStyle, marginBottom: 16 }}>
        Recommendations are general guidance, not measurements from your usage. After changing the reply model, try a
        short conversation to check it still feels quick. Changes apply to new conversations and new work; a
        conversation already running keeps its settings.
      </p>

      {listDown && (
        <div style={{ marginBottom: 16 }}>
          <p id={LIST_DOWN_ID} style={{ ...hintStyle, color: "#102B33", fontWeight: 700, fontSize: 14 }}>
            The model list could not be loaded.
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
        </div>
      )}

      {JOBS.map(({ job, key, label, advice }) => {
        const id = valueId(key);
        const rec = recommendationLine(page, job);
        return (
          <SelectField
            key={key}
            id={id}
            label={label}
            value={values[key]}
            options={modelOptions(page, job, page.values[key], values[key])}
            onChange={(v) => onChange(key, v)}
            unavailable={locked || listDown}
            hintIds={[rec ? `${id}-rec` : "", `${id}-advice`, listDown ? LIST_DOWN_ID : ""]}
            error={errors[`values.${key}`]}
          >
            {rec && (
              <Hint id={`${id}-rec`}>
                <strong style={{ color: "#102B33" }}>{rec}</strong>
              </Hint>
            )}
            <Hint id={`${id}-advice`}>{advice}</Hint>
          </SelectField>
        );
      })}

      <h3 style={{ ...subHeadingStyle, marginTop: 8 }}>Reply length</h3>
      <div style={fieldBlockStyle}>
        <label htmlFor={tokensId} style={labelStyle}>
          Longest spoken reply (tokens)
        </label>
        <input
          id={tokensId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={values.replyMaxTokens}
          readOnly={locked}
          aria-invalid={tokensError ? true : undefined}
          aria-describedby={describedBy(`${tokensId}-hint`, tokensError && `${tokensId}-error`)}
          onChange={(e) => onChange("replyMaxTokens", e.target.value)}
          style={{ ...controlStyle(Boolean(tokensError), locked), maxWidth: 160 }}
        />
        <Hint id={`${tokensId}-hint`}>
          A whole number from {SETTINGS_LIMITS.replyMaxTokensMin} to {SETTINGS_LIMITS.replyMaxTokensMax}. Recommended:{" "}
          {SETTINGS_LIMITS.replyMaxTokensRecommended} (the default). Replies are also told to stay under 40 words, so
          this is a hard ceiling, not a target.
        </Hint>
        {tokensError && <ErrorText id={`${tokensId}-error`} message={tokensError} />}
      </div>
    </section>
  );
}
