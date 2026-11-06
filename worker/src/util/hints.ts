import { MAX_HINT_LENGTH } from "../config/limits";

/**
 * R.3.2 avatar-editor hints: the small, parent-editable description of how a
 * child should look in the drawing. Deliberately a closed vocabulary of short
 * strings — this is prompt input, so it is normalised, length-capped and never
 * free-form prose from an untrusted client.
 */
export type Hints = {
  skin: string;
  hair: string;
  extras: string;
  outfit: string;
  style: string;
};

export const HINT_KEYS = ["skin", "hair", "extras", "outfit", "style"] as const;

export const EMPTY_HINTS: Hints = { skin: "", hair: "", extras: "", outfit: "", style: "" };

/** Strips control characters and clamps one hint to MAX_HINT_LENGTH. */
export function normalizeHint(value: unknown): string {
  if (typeof value !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_HINT_LENGTH);
}

/**
 * Parses a stored hints JSON blob (or an API payload) into a complete Hints
 * object. Anything missing, malformed or of the wrong shape becomes `""`, so
 * callers never branch on undefined and a corrupt row degrades to "no hints"
 * rather than failing the request.
 */
export function parseHints(raw: unknown): Hints {
  let source: Record<string, unknown> | null = null;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        source = parsed as Record<string, unknown>;
      }
    } catch {
      source = null;
    }
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    source = raw as Record<string, unknown>;
  }
  if (!source) return { ...EMPTY_HINTS };
  return {
    skin: normalizeHint(source.skin),
    hair: normalizeHint(source.hair),
    extras: normalizeHint(source.extras),
    outfit: normalizeHint(source.outfit),
    style: normalizeHint(source.style),
  };
}

/**
 * `null` when nothing is set — the API contract returns `hints: null` for a kid
 * whose look was never edited, so the SPA can tell "no hints" from "empty hints".
 */
export function hintsOrNull(raw: unknown): Hints | null {
  const hints = parseHints(raw);
  return HINT_KEYS.some((k) => hints[k].length > 0) ? hints : null;
}

export function serializeHints(raw: unknown): string | null {
  const hints = hintsOrNull(raw);
  return hints ? JSON.stringify(hints) : null;
}

const LABELS: Record<keyof Hints, string> = {
  skin: "skin tone",
  hair: "hair",
  extras: "extra details (glasses, freckles)",
  outfit: "outfit",
  style: "drawing style",
};

/** Appended to the character-sheet prompt so a redraw honours the saved look. */
export function hintsPrompt(hints: Hints | null | undefined): string {
  if (!hints) return "";
  const parts = HINT_KEYS.filter((k) => hints[k].length > 0).map((k) => `${LABELS[k]}: ${hints[k]}`);
  if (parts.length === 0) return "";
  return `Parent-requested look — ${parts.join("; ")}.`;
}

/** The full prompt for a sheet render; unchanged base text plus any hints. */
export function characterSheetPrompt(hints: Hints | null | undefined): string {
  const base =
    "Character sheet for a children's storybook. Preserve the child's likeness, keep it gentle and consistent.";
  const extra = hintsPrompt(hints);
  return extra ? `${base} ${extra}` : base;
}
