"use client";

// Stacked day-by-day usage columns. One Tab stop (roving tabindex); arrow keys, Home and End move
// between days; hover, focus and tap show the same tooltip. No animation or transitions.
import { useEffect, useRef, useState } from "react";
import { FEATURE_LABELS, SERIES_COLORS, type ChartData, type Measure } from "../../lib/usageChart";
import {
  DEFAULT_WIDTH,
  computeLayout,
  dayAriaLabel,
  nextActiveIndex,
  roundedTopPath,
  tooltipContent,
  tooltipLeft,
} from "./chartLayout";

const TOOLTIP_WIDTH = 220;
const secondaryText: React.CSSProperties = { margin: "8px 0 0", fontSize: 13, color: "#566475", lineHeight: 1.5 };
const swatch = (color: string): React.CSSProperties => ({
  display: "inline-block",
  width: 10,
  height: 10,
  borderRadius: 2,
  background: color,
  flex: "0 0 auto",
});

export function TrendChart({ data, measure, titleId }: { data: ChartData; measure: Measure; titleId: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const dayRefs = useRef<(SVGGElement | null)[]>([]);
  const [measured, setMeasured] = useState(DEFAULT_WIDTH);
  const n = data.days.length;
  const [active, setActive] = useState(n - 1);
  const [focused, setFocused] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => setMeasured(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data.hasAnyUsage]);

  // A new range starts on the most recent day again.
  useEffect(() => {
    setActive(n - 1);
    setHovered(null);
  }, [n]);

  if (!data.hasAnyUsage) return <p style={secondaryText}>No usage recorded in this range.</p>;

  const layout = computeLayout(data, measure, measured);
  const { plot } = layout;
  const activeIndex = active >= 0 && active < n ? active : n - 1;
  const shown = hovered ?? (dismissed ? null : focused);
  const shownDay = shown !== null && shown < n ? data.days[shown] : null;

  function onKeyDown(e: React.KeyboardEvent<SVGGElement>, i: number) {
    const next = nextActiveIndex(e.key, i, n);
    if (next !== null) {
      e.preventDefault();
      setActive(next);
      setHovered(null);
      setDismissed(false);
      dayRefs.current[next]?.focus();
    } else if (e.key === "Escape") {
      setDismissed(true);
      setHovered(null);
    }
  }

  return (
    <div>
      <div ref={wrapRef} role="group" aria-labelledby={titleId} style={{ position: "relative", width: "100%" }}>
        <svg
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          style={{ display: "block", maxWidth: "100%", overflow: "visible" }}
          onMouseLeave={() => setHovered(null)}
        >
          <g aria-hidden="true">
            {layout.ticks.map((t) => (
              <g key={t.value}>
                {t.value !== 0 && (
                  <line x1={plot.left} x2={plot.right} y1={t.y} y2={t.y} stroke="#E2E6EA" strokeWidth={1} />
                )}
                <text
                  x={plot.left - 8}
                  y={t.y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize={12}
                  fill="#566475"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {t.label}
                </text>
              </g>
            ))}
            {layout.xLabels.map((l) => (
              <text key={l.index} x={l.x} y={plot.bottom + 18} textAnchor="middle" fontSize={12} fill="#566475">
                {l.label}
              </text>
            ))}
          </g>
          {layout.days.map((g) => {
            const day = data.days[g.index];
            return (
              <g
                key={day.date}
                ref={(el) => {
                  dayRefs.current[g.index] = el;
                }}
                role="img"
                aria-label={dayAriaLabel(day, measure)}
                tabIndex={g.index === activeIndex ? 0 : -1}
                onFocus={() => {
                  setActive(g.index);
                  setFocused(g.index);
                  setDismissed(false);
                }}
                onBlur={() => setFocused((f) => (f === g.index ? null : f))}
                onKeyDown={(e) => onKeyDown(e, g.index)}
                onMouseEnter={() => setHovered(g.index)}
                onClick={() => setHovered(g.index)}
              >
                <rect x={g.slotX} y={plot.top} width={g.slotW} height={plot.bottom - plot.top} fill="transparent" />
                {g.segments.map((s) =>
                  s.rounded ? (
                    <path key={s.key} d={roundedTopPath(s.x, s.y, s.w, s.h)} fill={s.color} />
                  ) : (
                    <rect key={s.key} x={s.x} y={s.y} width={s.w} height={s.h} fill={s.color} />
                  )
                )}
              </g>
            );
          })}
          <line
            aria-hidden="true"
            x1={plot.left}
            x2={plot.right}
            y1={plot.bottom + 0.5}
            y2={plot.bottom + 0.5}
            stroke="#7A8590"
            strokeWidth={1}
          />
          {focused !== null && focused < n && (
            <rect
              aria-hidden="true"
              x={layout.days[focused].cx - Math.max(layout.days[focused].slotW, layout.days[focused].colW + 6) / 2}
              y={plot.top - 3}
              width={Math.max(layout.days[focused].slotW, layout.days[focused].colW + 6)}
              height={plot.bottom - plot.top + 6}
              fill="none"
              stroke="#087E8B"
              strokeWidth={2}
              rx={3}
              pointerEvents="none"
            />
          )}
          {layout.direct && (
            <text
              aria-hidden="true"
              x={layout.direct.x}
              y={layout.direct.y}
              textAnchor="middle"
              fontSize={12}
              fontWeight={700}
              fill="#102B33"
              pointerEvents="none"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {layout.direct.text}
            </text>
          )}
        </svg>
        {shownDay && shown !== null && <Tooltip day={shownDay} measure={measure} anchorX={layout.days[shown].cx} wrapperWidth={layout.width} />}
      </div>
      <p style={secondaryText}>Use the arrow keys to move between days.</p>
      <ul
        aria-label="Legend"
        style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "flex", flexWrap: "wrap", gap: "6px 16px" }}
      >
        {data.seriesKeys.map((key) => (
          <li key={key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#102B33" }}>
            <span aria-hidden="true" style={swatch(SERIES_COLORS[key])} />
            {FEATURE_LABELS[key]}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tooltip({
  day,
  measure,
  anchorX,
  wrapperWidth,
}: {
  day: ChartData["days"][number];
  measure: Measure;
  anchorX: number;
  wrapperWidth: number;
}) {
  const c = tooltipContent(day, measure);
  const width = Math.min(TOOLTIP_WIDTH, wrapperWidth);
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        top: 0,
        left: tooltipLeft(anchorX, width, wrapperWidth),
        width,
        boxSizing: "border-box",
        pointerEvents: "none",
        background: "#FFFFFF",
        border: "1px solid #E2E6EA",
        borderRadius: 8,
        padding: "8px 10px",
        fontSize: 13,
        lineHeight: 1.4,
        color: "#102B33",
      }}
    >
      <div style={{ fontWeight: 700 }}>{c.title}</div>
      <div style={{ fontVariantNumeric: "tabular-nums" }}>{c.total}</div>
      {c.rows.map((r) => (
        <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
          <span style={swatch(r.color)} />
          <span style={{ flex: "1 1 auto" }}>{r.label}</span>
          <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}
