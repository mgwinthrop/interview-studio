"use client";

// One line under the Dashboard heading: the last 30 days of usage and a link to the Usage page.
// While loading, or if the numbers cannot be had, only the link shows.
import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchUsageTotals, formatUsd, type UsageTotals } from "../lib/usage";
import { formatTokens } from "../lib/usageChart";

export function usageLineText(totals: UsageTotals): string {
  if (totals.calls === 0) return "";
  // The cost counts only calls that had a price, so say so rather than present it as the whole spend.
  if (totals.estimatedCostUsd !== null) return `${formatUsd(totals.estimatedCostUsd)} estimated, priced calls only`;
  return `${formatTokens(totals.inputTokens + totals.outputTokens)} tokens`;
}

export function UsageLine() {
  const [totals, setTotals] = useState<UsageTotals | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchUsageTotals(30)
      .then((r) => {
        if (!cancelled && r.kind === "ok") setTotals(r.value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const text = totals ? usageLineText(totals) : "";
  return (
    <p style={{ margin: "4px 0 0", fontSize: 13, color: "#566475", fontWeight: 400 }}>
      {text && `Last 30 days: ${text} · `}
      <Link href="/usage" style={{ color: "#066C77", textDecoration: "underline" }}>
        See usage →
      </Link>
    </p>
  );
}
