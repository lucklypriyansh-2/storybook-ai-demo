/**
 * One place for turning a Worker error code into something a grown-up can read
 * (Phase B #12). Every screen that surfaces a raw `code` from `WorkerError` or a
 * failed job funnels through here, so the same failure never reads differently
 * on two screens and a new code cannot silently fall back to a blank string.
 *
 * Unknown codes still get a sentence — never the raw code, never an empty box.
 */
export const ERROR_COPY: Record<string, string> = {
  // photos / character sheet
  photo_required: 'Please pick a photo first.',
  photo_too_small: 'That photo looks too small — try a bigger one.',
  photo_too_large: 'That photo is too big — try one under 8 MB.',
  photo_type_not_allowed: 'Please use a JPEG, PNG or WebP photo.',
  photo_not_found: 'That photo expired — upload a new one.',
  photo_expired: 'Photo expired — upload a new one.',
  consent_required: 'We need your consent before making the character.',
  others_consent_required: 'Please tick that everyone in the photo is OK with this.',
  no_character_sheet: 'No AI drawing yet — add a photo first.',
  sheet_required: 'This needs an AI likeness first — add a photo in Make.',
  hints_required: 'Nothing to save yet.',
  // budget / availability
  rate_limited: 'That is today’s limit — try again tomorrow.',
  budget_exceeded: 'AI is paused today to stay in budget — try again tomorrow.',
  kill_switch: 'AI is paused right now — stories still work.',
  provider_disabled: 'AI is unavailable right now — try again later.',
  // provider responses
  openrouter_unsupported_url: 'The AI returned an unexpected image — please try again.',
  openrouter_no_image: 'The AI did not return an image — please try again.',
  // motion (OpenRouter Videos, §H). A failed render is never faked: the page
  // keeps its still and we say so instead of showing a broken clip.
  openrouter_video_failed: 'The video did not finish — this page keeps its still.',
  openrouter_video_timeout: 'The video took too long — this page keeps its still.',
  openrouter_video_no_job_id: 'The video maker did not accept the job — please try again.',
  openrouter_video_empty_content: 'The video came back empty — this page keeps its still.',
  unsafe_video_input_key: 'That page cannot be animated.',
  // catalog / pages
  template_not_found: 'That story is no longer available.',
  template_has_no_shots: 'That story has no pages yet.',
  page_not_found: 'That page is no longer in this book.',
  text_required: 'Type something first.',
  text_or_regenerate_required: 'Nothing to save.',
  ambiguous_page_patch: 'Save your words and ask for a new drawing one at a time.',
  invalid_page_index: 'That page does not exist.',
  admin_only: 'Operators only.',
  unauthorized: 'Please sign in again.',
};

export const DEFAULT_ERROR_COPY = 'Something went wrong — please try again.';

/**
 * Motion codes carry their HTTP status (`openrouter_video_submit_http_502`), so
 * an exact lookup misses. These prefixes map a whole family onto its copy so a
 * new status never leaks a raw code onto the screen. An exact entry above always
 * wins, and unknown codes still fall through to the generic sentence.
 */
const ERROR_COPY_PREFIXES: readonly (readonly [prefix: string, copy: string])[] = [
  ['openrouter_video_', ERROR_COPY.openrouter_video_failed],
];

/** Child-friendly copy for a Worker error code (or an unknown one). */
export function errorCopy(code: string | null | undefined): string {
  if (!code) return DEFAULT_ERROR_COPY;
  const exact = ERROR_COPY[code];
  if (exact) return exact;
  for (const [prefix, copy] of ERROR_COPY_PREFIXES) {
    if (code.startsWith(prefix)) return copy;
  }
  return DEFAULT_ERROR_COPY;
}
