"use client";

import { useMotionPaused } from "../lib/motion";

/** Button that pauses or resumes every animation on the site (WCAG 2.2.2). */
export function MotionToggle() {
  const { paused, toggle } = useMotionPaused();
  return (
    <button type="button" className="motion-toggle" onClick={toggle}>
      {paused ? "Resume animations" : "Pause animations"}
    </button>
  );
}
