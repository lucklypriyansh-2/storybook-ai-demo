# Reel Feed — Frontend Architecture (M1/M2)

**Scope:** vertical snap-swipe reel feed on iPhone Safari. React + Framer Motion, no new deps.

## Layout and viewport
- Root is a single flex column at `height: 100dvh` (not `100vh` — iOS Safari's URL bar would otherwise cut the last reel). Fallback `height: 100vh` for old WebKit via `@supports not (height: 100dvh)`.
- Top chrome (`Today · 3 of 6`) uses `padding-top: env(safe-area-inset-top)`; bottom tab bar uses `padding-bottom: env(safe-area-inset-bottom)`. Reel content stretches edge to edge.
- Each reel is a `section` sized `height: 100dvh; scroll-snap-align: start; scroll-snap-stop: always`.

## Swipe: CSS scroll-snap (recommended) over pointer-drag
- Use the native scroller: `overflow-y: scroll; scroll-snap-type: y mandatory; overscroll-behavior: contain; -webkit-overflow-scrolling: touch`. Reasons: iOS Safari's rubber-band, momentum, and hit-testing are hard to reproduce by hand; pointer-drag implementations consistently fight the browser (stuck mid-swipe, broken rotation, no voiceover). `scroll-snap-stop: always` makes one swipe = one reel even on long flings.
- Framer Motion is used *inside* each reel (not as the pager): captions springing in, the Remake sheet (`<motion.div drag="y" dragConstraints>`), love-heart burst, end-card reveal. Keep AnimatePresence local to one reel to avoid full-feed re-layouts.
- Track the active reel with one `IntersectionObserver` (threshold `0.6`) on the scroller; only the active reel autoplays video, the `prev`/`next` get video `preload="metadata"` + poster. Set `will-change: transform` only on the active reel to keep GPU memory bounded.

## Autoplay video + image fallback
- `<video src poster muted playsInline preload="metadata" loop autoPlay>` with `muted` and `playsInline` both set — iOS requires both for inline autoplay and ignores `autoplay` without `muted` outside user gesture. Use `video.play().catch(() => showTapToPlay())` because a sideloaded WebView can still reject.
- Fallback stack: if `status !== 'ready'` or `video_url` is null, render only the poster (`<img>` with `loading="eager"` for the active reel, `"lazy"` for neighbours) plus an overlaid Ken-Burns CSS transform (`transform: scale(1.05) translateY(-2%)` animated over 8s) so the still doesn't look dead.
- A first user tap anywhere unmutes the active video and persists `autoplay: true` in `settings`; the mute toggle lives top-right and is sticky.

## Daily set bar + end card
- The top bar (`Today · N of 6`) is a `position: sticky; top: 0` child of the scroller and does NOT itself snap — `scroll-snap-align: none`. `N` comes from `settings.reels_per_day`, progress from the IntersectionObserver index.
- The end card is simply the (N+1)-th snap section. It holds "Make a book from today" and "Remake any reel" CTAs. On reach, fire a `feed:complete` event so the bar can switch to "All done ✨".

## Rendering state (live updates)
- Reels with `status in ('queued','rendering')` render the poster + a shimmer + "Rendering…" chip. Do NOT poll per-reel on a timer.
- Subscribe once at feed mount: `supabase.channel('reels:'+householdId).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'reels', filter: 'household_id=eq.'+householdId }, applyPatch)`. Also subscribe to `reel_versions` so the version chip updates mid-render.
- Realtime is best-effort. Safety net: a single `setInterval(refetchQueuedReels, 15000)` that only runs while at least one reel is non-ready AND the tab is `document.visibilityState === 'visible'`. On `visibilitychange → visible` do one immediate refetch (catches resumes from background).
- When a reel flips to `ready`, swap `<img poster>` for `<video>` with a Framer `AnimatePresence` cross-fade (200ms). Do not auto-scroll — the user may be mid-swipe.
