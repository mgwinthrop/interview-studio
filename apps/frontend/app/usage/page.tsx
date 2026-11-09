"use client";

// Usage: what the app has spent on model calls, per UTC day, for a chosen range. Numbers and fixed
// labels only. The controls are never unmounted, so focus stays on the button that was pressed.
// Stale responses (an older range) are ignored. Messages are fixed text; nothing here logs.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Shell, panelStyle } from "../interviewers/edit/EditorParts";
import { fetchUsageTrend, type UsageTrend } from "../lib/usage";
import { buildChartData, hasCost, type Measure } from "../lib/usageChart";
import { TrendChart } from "../components/usage/TrendChart";
import { TrendTable } from "../components/usage/TrendTable";
import { Controls, toggleStyle, type Range } from "./Controls";
import { UsageTiles } from "./UsageTiles";
import { UsageTables } from "./UsageTables";

const LOAD_FAILED = "Usage could not be loaded.";
const LOADING = "Loading usage…";
const COST_FALLBACK = "Costs are not available for this range, showing tokens.";
const EMPTY = "No usage recorded in this range.";

const CHART_TITLE_ID = "usage-chart-title";
const TABLE_CAPTION_ID = "usage-chart-caption";

const secondaryStyle: CSSProperties = { fontSize: 15, color: "#566475", lineHeight: 1.6, margin: "0 0 20px" };
const noteStyle: CSSProperties = { fontSize: 13, color: "#566475", lineHeight: 1.5, margin: "8px 0 0" };
const headingStyle: CSSProperties = { fontSize: 18, fontWeight: 700, color: "#102B33", margin: 0 };
const linkStyle: CSSProperties = { color: "#066C77", textDecoration: "underline" };

type Loaded = { days: Range; trend: UsageTrend };

export default function UsagePage() {
  const [days, setDays] = useState<Range>(30);
  const [measure, setMeasure] = useState<Measure>("tokens");
  const [asTable, setAsTable] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<number | null>(null);
  const [status, setStatus] = useState("");
  const [attempt, setAttempt] = useState(0);
  const requestRef = useRef(0);
  const measureRef = useRef<Measure>(measure);
  const retryingRef = useRef(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    measureRef.current = measure;
  }, [measure]);

  useEffect(() => {
    const id = ++requestRef.current;
    setLoading(true);
    const done = (trend: UsageTrend | null) => {
      if (id !== requestRef.current) return; // a newer request is on its way
      setLoading(false);
      if (!trend) {
        // The Retry button stays (it keeps its focus); the alert remounts so it is announced again.
        retryingRef.current = false;
        setLoaded(null);
        setFailure((n) => (n ?? 0) + 1);
        return;
      }
      setFailure(null);
      setLoaded({ days, trend });
      if (measureRef.current === "cost" && !hasCost(trend)) {
        setMeasure("tokens");
        setStatus(COST_FALLBACK);
      }
      if (retryingRef.current) {
        retryingRef.current = false;
        // The Retry button has gone: move focus to the page heading.
        titleRef.current?.focus();
      }
    };
    fetchUsageTrend(days).then(
      (r) => done(r.kind === "ok" ? r.value : null),
      () => done(null)
    );
  }, [days, attempt]);

  const trend = loaded?.trend ?? null;
  const costAvailable = trend !== null && hasCost(trend);
  const shownMeasure: Measure = measure === "cost" && !costAvailable ? "tokens" : measure;
  const data = useMemo(() => (trend ? buildChartData(trend, shownMeasure) : null), [trend, shownMeasure]);

  function onDays(next: Range) {
    setStatus("");
    setDays(next);
  }

  function onMeasure(next: Measure) {
    setStatus("");
    setMeasure(next);
  }

  function retry() {
    if (loading) return;
    retryingRef.current = true;
    setAttempt((a) => a + 1);
  }

  return (
    <Shell>
      <h1
        id="usage-title"
        ref={titleRef}
        tabIndex={-1}
        style={{ fontSize: 30, fontWeight: 800, color: "#102B33", margin: "0 0 8px", letterSpacing: "-0.02em", outline: "none" }}
      >
        Usage
      </h1>
      <p style={secondaryStyle}>What the app has spent on model calls. Days are UTC. Costs are estimates.</p>

      <Controls days={days} measure={shownMeasure} costAvailable={costAvailable}
        explainCost={trend !== null && !costAvailable}
        onDays={onDays} onMeasure={onMeasure} />

      <div role="status" style={{ fontSize: 15, color: "#102B33", lineHeight: 1.6 }}>
        {loading ? <p style={{ margin: "0 0 12px" }}>{LOADING}</p> : status ? <p style={{ margin: "0 0 12px", fontWeight: 700 }}>{status}</p> : null}
      </div>

      {failure !== null && (
        <div style={{ margin: "0 0 20px" }}>
          <p key={failure} role="alert" style={{ fontSize: 15, color: "#B3261E", fontWeight: 700, lineHeight: 1.6, margin: "0 0 8px" }}>
            {LOAD_FAILED}
          </p>
          <button
            type="button"
            aria-disabled={loading ? true : undefined}
            onClick={retry}
            style={toggleStyle(false, loading)}
          >
            {loading ? "Loading…" : "Retry"}
          </button>
        </div>
      )}

      {loaded && data && (
        <div aria-busy={loading ? true : undefined}>
          <UsageTiles days={loaded.days} totals={loaded.trend.totals} priceTableAsOf={loaded.trend.priceTableAsOf} />

          {!data.hasAnyUsage ? (
            <div style={panelStyle}>
              <p style={{ fontSize: 15, color: "#102B33", lineHeight: 1.6, margin: 0 }}>{EMPTY}</p>
            </div>
          ) : (
            <>
              <section aria-labelledby={CHART_TITLE_ID} style={panelStyle}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, margin: "0 0 12px" }}>
                  <h2 id={CHART_TITLE_ID} style={headingStyle}>
                    {shownMeasure === "cost" ? "Estimated cost per day" : "Tokens per day"}
                  </h2>
                  <button type="button" aria-pressed={asTable} onClick={() => setAsTable((t) => !t)} style={toggleStyle(asTable)}>
                    View as table
                  </button>
                </div>
                {asTable ? (
                  <TrendTable data={data} measure={shownMeasure} captionId={TABLE_CAPTION_ID} />
                ) : (
                  // Room under the chart: on narrow screens its tooltip sits below the columns.
                  <div style={{ paddingBottom: 48 }}>
                    <TrendChart data={data} measure={shownMeasure} titleId={CHART_TITLE_ID} />
                  </div>
                )}
                <p style={noteStyle}>Days with no activity show as empty.</p>
                {shownMeasure === "cost" && <p style={noteStyle}>A day&rsquo;s cost counts only the calls that had a price.</p>}
              </section>

              <UsageTables trend={loaded.trend} days={loaded.days} />
            </>
          )}

          <section aria-labelledby="usage-notes-heading" style={panelStyle}>
            <h2 id="usage-notes-heading" style={{ ...headingStyle, margin: "0 0 4px" }}>
              How to read these numbers
            </h2>
            <ul style={{ ...noteStyle, paddingLeft: 20 }}>
              <li>
                Costs are estimates, using the prices in place when each call was recorded. Prices are set in{" "}
                <Link href="/settings" style={linkStyle}>
                  Settings
                </Link>
                .
              </li>
              <li>Only calls made after a price was set have a cost.</li>
              <li>Replies that were interrupted are not counted.</li>
              <li>Designer chat is counted under &ldquo;Conversation replies&rdquo;.</li>
              <li>Speech is billed by ElevenLabs and is not shown here.</li>
            </ul>
          </section>
        </div>
      )}
    </Shell>
  );
}
