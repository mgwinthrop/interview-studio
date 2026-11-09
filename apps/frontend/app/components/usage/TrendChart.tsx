"use client";

// Stacked day-by-day usage columns. One Tab stop (roving tabindex); arrow keys, Home and End move
// between days; hover, focus and tap show the same tooltip. No animation or transitions.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FEATURE_LABELS, SERIES_COLORS, type ChartData, type Measure } from "../../lib/usageChart";
import {
  DEFAULT_WIDTH,
  computeLayout,
  dayAriaLabel,
  nextActiveIndex,
  roundedTopPath,
  placeTooltip,
  tooltipContent,
  type Layout,
} from "./chartLayout";

// useLayoutEffect warns during server rendering, so fall back to useEffect there.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const secondaryText: React.CSSProperties = { margin: "8px 0 0", fontSize: 13, color: "#566475", lineHeight: 1.5 };
const swatch = (color: string): React.CSSProperties => ({
  display: "inline-block",
  width: 10,
  height: 10,
  borderRadius: 2,
  background: color,
  flex: "0 0 auto",
});
// The "calls without a price" key: the same flat dash as the mark, so it is told apart by shape.
const dashSwatch: React.CSSProperties = { ...swatch("#7A8590"), height: 2, borderRadius: 0 };

/** Horizontal extent of the focus ring around a day (also what the tooltip must not cover). */
function ringExtent(d: Layout["days"][number]): { left: number; width: number } {
  const width = Math.max(d.slotW, d.colW + 6);
  return { left: d.cx - width / 2, width };
}

export function TrendChart({ data, measure, titleId }: { data: ChartData; measure: Measure; titleId: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const dayRefs = useRef<(SVGGElement | null)[]>([]);
  const [measured, setMeasured] = useState(DEFAULT_WIDTH);
  const n = data.days.length;
  const [active, setActive] = useState(n - 1);
  const [focused, setFocused] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useIsoLayoutEffect(() => {
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

  // A tapped day's tooltip goes away when the person taps or clicks anywhere outside the chart.
  useEffect(() => {
    if (hovered === null) return;
    const onDown = (e: PointerEvent) => {
      const el = wrapRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) setHovered(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [hovered]);

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
    <div ref={wrapRef} style={{ position: "relative", width: "100%" }}>
      <div role="group" aria-labelledby={titleId}>
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
                onBlur={(e) => {
                  setFocused((f) => (f === g.index ? null : f));
                  const next = e.relatedTarget;
                  if (!(next instanceof Node) || !wrapRef.current?.contains(next)) setHovered(null);
                }}
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
                {g.unpriced && (
                  <rect
                    x={g.unpriced.x}
                    y={g.unpriced.y}
                    width={g.unpriced.w}
                    height={g.unpriced.h}
                    fill="#7A8590"
                    data-mark="unpriced"
                  />
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
              x={ringExtent(layout.days[focused]).left}
              y={plot.top - 3}
              width={ringExtent(layout.days[focused]).width}
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
        {layout.hasUnpriced && (
          <li style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#102B33" }}>
            <span aria-hidden="true" style={dashSwatch} />
            Calls without a price
          </li>
        )}
      </ul>
      {shownDay && shown !== null && (
        <Tooltip day={shownDay} measure={measure} layout={layout} index={shown} wrapperWidth={measured} />
      )}
    </div>
  );
}

function Tooltip({
  day,
  measure,
  layout,
  index,
  wrapperWidth,
}: {
  day: ChartData["days"][number];
  measure: Measure;
  layout: Layout;
  index: number;
  wrapperWidth: number;
}) {
  const c = tooltipContent(day, measure);
  const geom = layout.days[index];
  const ring = ringExtent(geom);
  const place = placeTooltip({
    colLeft: ring.left,
    colRight: ring.left + ring.width,
    colTop: geom.colTop,
    plotTop: layout.plot.top,
    plotBottom: layout.plot.bottom,
    chartHeight: layout.height,
    wrapperWidth: wrapperWidth > 0 ? wrapperWidth : layout.width,
    rows: c.rows.length,
  });
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        top: place.top,
        left: place.left,
        width: place.width,
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
