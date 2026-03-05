/**
 * Shared constants for conflict-status display used by NewsMapWidget and
 * LiveEventFeed.  Centralising here ensures the dot colours and labels are
 * always in sync across both components.
 */

import type { ConflictStatus } from "./types";

/** Tailwind dot colour class for each conflict status */
export const CONFLICT_STATUS_DOT: Record<ConflictStatus, string> = {
  active:          "bg-error-500",
  escalating:      "bg-error-400 animate-pulse motion-reduce:animate-none",
  ceasefire:       "bg-success-500",
  frozen:          "bg-gray-400",
  "low-intensity": "bg-warning-400",
};

/** Short human-readable label for each conflict status */
export const CONFLICT_STATUS_LABEL: Record<ConflictStatus, string> = {
  active:          "Active conflict",
  escalating:      "Escalating",
  ceasefire:       "Ceasefire",
  frozen:          "Frozen conflict",
  "low-intensity": "Low-intensity",
};

/**
 * Canonical list of data sources used by the Flashpoints system.
 * Mirrors FLASHPOINT_DATA_SOURCES from api/conflicts.ts and is used by the
 * client-side components as a static fallback when the API response does not
 * include the dataSources field (e.g. when the client-side mock is active).
 */
export const DEFAULT_FLASHPOINT_SOURCES: readonly string[] = [
  "ACLED",
  "CFR Global Conflict Tracker",
  "UCDP",
  "UN OCHA",
  "DoD",
  "Live News Feeds",
];
