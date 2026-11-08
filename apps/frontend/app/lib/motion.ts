"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A manual "pause animations" preference (WCAG 2.2.2 Pause, Stop, Hide).
 *
 * The device setting `prefers-reduced-motion` is already respected in CSS. This adds a control for
 * people who have not set it. When paused, `<html data-motion="paused">` switches off all animation (see
 * globals.css). The choice is remembered in this browser only; if storage is unavailable it still works
 * for the current page.
 */
const STORAGE_KEY = "studio_motion_paused";

let paused = false;
let started = false;
const listeners = new Set<() => void>();

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function apply() {
  if (paused) document.documentElement.dataset.motion = "paused";
  else delete document.documentElement.dataset.motion;
}

function start() {
  if (started) return;
  started = true;
  paused = readStored();
  apply();
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useMotionPaused() {
  const isPaused = useSyncExternalStore(subscribe, () => paused, () => false);
  const toggle = useCallback(() => {
    paused = !paused;
    try {
      window.localStorage.setItem(STORAGE_KEY, paused ? "1" : "0");
    } catch {
      // Storage can be blocked; the setting then lasts until the page is reloaded.
    }
    apply();
    listeners.forEach((listener) => listener());
  }, []);
  return { paused: isPaused, toggle };
}
