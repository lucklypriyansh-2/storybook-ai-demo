# Starring Me — personalised AI kids storybook (demo)
A clickable, mobile-first demo: onboarding → parental consent → photo upload (stays in the browser) → character creation → character reveal → story pick → generation loader → page-turn reader → narrated slideshow video (browser speechSynthesis) → **demo** print checkout (no payment) → share, library, settings/privacy.
Landing site at `/`, app at `/app/`. "Starring Me" and all prices are placeholders.

Stack: Vite + React + TypeScript + Framer Motion. Story is a seeded template with the child's name, age, pronoun, outfit and sidekick filled in (no AI/paid APIs). Design and motion spec from Research & Build Bot (tokens, 15 mockups, motion demos).

```
npm i && npm run dev     # local
npm test                 # vitest
npm run build            # static output in dist/
```
Deploys to GitHub Pages via `.github/workflows/pages.yml`. All illustrations are AI-generated and fictional.
