# RIYAN'S TECH UNIVERSE — Interactive 3D Portfolio

> **Riyan Pasha · TECH KING**
> *"I don't belong to one technology. I build across technology."*

A futuristic 3D **Tech Universe** — not an AI-lab template, not a resume.
The environment **is** the portfolio: ten stations orbit a golden core, and
every station is a world of Riyan's technical identity.

## Tech stack

| Layer | Tools |
| --- | --- |
| Core | React 19 · TypeScript · Vite · Tailwind CSS v4 · GSAP |
| 3D | Three.js · React Three Fiber · @react-three/drei · @react-three/postprocessing |
| State | Zustand |

## Run it

```bash
npm install
npm run dev        # dev server → http://localhost:5173
npm run build      # type-check + production build → dist/
npm run preview    # preview the production build
```

## The universe

| Station | World / Sector | Content |
| --- | --- | --- |
| CORE | **RIYAN PASHA · TECH KING** + animated holographic portrait | Hero: rotating `AI × DATA × SOFTWARE × PRODUCTS × EXPERIMENTATION`, the 8-world map, actions |
| 01 | **ARTIFICIAL INTELLIGENCE** | Interactive skill constellation (28 hoverable nodes) + the **AI × DATA × SOFTWARE = AI PRODUCT ENGINEERING** intersection |
| 02 | **DATA** | About Me (technologist profile) + data domain |
| 03 | **SOFTWARE** | Engineering, backend, APIs, dev tools |
| 04 | **MOBILE** | Android / Kotlin + career path (3D timeline outward) |
| 05 | **WEB** | Web / React / 3D — this site as proof |
| 06 | **CLOUD** | Deploy · scale · operate |
| 07 | **AUTOMATION** | Workflows & AI automation |
| 08 | **EXPERIMENTS** | 7 floating research modules + **ASK MY PORTFOLIO** assistant |
| 09 | **PROJECTS** | 5 holographic case studies + clickable 3D architecture diagrams |
| 10 | **CONTACT** | Calm gold beacon + message form |

### Interactivity
- **Camera navigation** — click a station (or HUD/MENU) and the camera flies there; drag to orbit, scroll to zoom, ESC home
- **Keys 1–0** jump straight between worlds
- **Hover connectivity** — hovering any world lights its spoke from the core; hovering AI/DATA/SOFTWARE glows the triad + the 3D intersection nexus at the core
- **Hero world map** — 8 colored dots; hover to identify, click to travel
- Skill nodes, experiment modules, gallery panels, architecture layers and the assistant terminal are all clickable

## Customize — one file to edit

All content lives in **`src/data/portfolio.ts`** (assistant knowledge in
`src/data/knowledge.ts`). Search for `[PLACEHOLDER]` and replace with real data:

- `profile.contact` → email / GitHub / LinkedIn
- `timeline[]` → real career milestones
- `education` → institution + graduation year
- `projects[].results / demo / source` → real outcomes and links
- `worlds[]` → tweak the eight worlds' blurbs/domains
- World colors in `WORLD_HUES` (and the matching `--color-w-*` tokens in `index.css`)

## Assistant integrity

**ASK MY PORTFOLIO** is a retrieval agent over `knowledge.ts`. It scores your
question against keyword-indexed entries and answers **only** from verified
portfolio content — it cannot invent experience, projects, metrics,
certifications or achievements. No match → transparent "no verified data".

## Design notes

- **Terminal-green palette** — green-tinted near-black environment with an
  emerald accent (#2dd391), prompt markers, mono labels, subtle CRT
  scanlines and film grain. Professional coder aesthetic, not a neon template.
- **Performance** — quality tiers (mobile/low-RAM get reduced particles, no
  bloom, capped DPR), lazy-loaded WebGL scene + case study, split chunks.
- **Graceful fallback** — no WebGL? A calm 2D mode keeps all content usable.
- **Dark / light mode** — the sun/moon toggle in the HUD flips the whole UI
  between the dark terminal theme and a clean light theme (persisted in
  localStorage). The 3D lab lifts to a brighter studio look in light mode.
- **Accessibility** — reduced-motion support, keyboard navigation, focus rings,
  aria labels.

## Structure

```
src/
  components/   # HUD, loading screen, menu, fallback
  sections/     # DOM content panels per world/sector
  three/        # 3D world: camera rig, stations, particles, effects
  data/         # portfolio.ts · views.ts · knowledge.ts  ← edit these
  store/        # zustand lab state
```
