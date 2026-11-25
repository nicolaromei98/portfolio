# Portfolio repo: instructions for Claude

This repo belongs to Nicola Romei's portfolio, built in Webflow.

Everything in it is public: the GitHub repo is public and Cloudflare Pages serves every file, this one included. Never put credentials, tokens, private keys or personal data in it.

## Infrastructure

- GitHub repository: `nicolaromei98/portfolio`
- Production branch: `main`
- Hosting: Cloudflare Pages, deployed automatically on every push to `main`
- Production URL: https://portfolio-2t0.pages.dev
  - Files are served at their repo path, e.g. https://portfolio-2t0.pages.dev/bundle.js.
  - The root URL returns 404, because there is no `index.html`. That is expected.
- Frontend: Webflow

## Responsibilities

1. Inspect the repository and understand the existing codebase.
2. Identify the purpose of each JavaScript and CSS file.
3. Preserve the existing file names and paths, because they are referenced directly in Webflow.
4. Before modifying any code:
   - Synchronize the repository with GitHub: `git fetch` and compare with `origin/main`.
   - Check for uncommitted changes.
5. Analyze the actual cause of each issue before implementing a solution.
6. Preserve existing functionality and avoid unnecessary refactoring.
7. Check for:
   - JavaScript syntax errors
   - GSAP conflicts
   - duplicate event listeners
   - memory leaks
   - performance issues
8. Maintain compatibility with Webflow, GSAP, ScrollTrigger, Lenis and any existing dependencies.
9. Do not introduce additional dependencies unless necessary.
10. After completing a requested change, review the diff and create a descriptive Git commit.
11. Push to `main` only after Nicola's approval.
12. After a deployment, verify that the updated files are publicly accessible through Cloudflare Pages.
13. Never expose credentials, private API keys or access tokens.

Do not modify the Cloudflare configuration or the Webflow integration unless explicitly requested.

## How the site loads this repo (verified 2026-11-25)

Check these facts again before relying on them.

### global-code.js

`global-code.js` is the site's only JavaScript file:
- It holds every animation, the Barba page transitions, the preloader and the WebGL effects.
- Webflow loads it in Site settings > Custom code > Footer code, on staging (`nicolas-top-notch-site-eb51e8.webflow.io`) and on production (`nicolaromei.com`, `www.nicolaromei.com`):
  ```html
  <script type="module" src="https://portfolio-2t0.pages.dev/global-code.js"></script>
  ```
- That tag comes after Lenis 1.3.15, three.js r109 (Webflow-hosted), Howler 2.2.4 and Barba 2.10.3. GSAP 3.15 and its plugins come from Webflow's GSAP integration.
- Keep `type="module"`: the file relies on module scope and strict mode.
- Slater was removed on 2026-11-25. Before the switch, the staging and production sites were tested page by page with this file (Chrome, WebKit, phone): zero errors.

### Every push to `main` goes live at once

- The URL above is not pinned to a commit, and Cloudflare serves it with `cache-control: public, max-age=0, must-revalidate`.
- So every push to `main` changes the production site as soon as Cloudflare finishes deploying.
- Test before pushing: open the staging site with the `global-code.js` request routed to the local file (for example with Playwright), and check every page for errors.

### Media

Media in this repo are used through jsDelivr URLs pinned to a commit. Today these are referenced:

| File | Commit | Where it is used |
|---|---|---|
| `grain-noise.gif` | `f9f1b8b` | every page |
| `videos/vid1.mp4`, `videos/vid2.mp4` | `505e3b9` | home |
| `videos/paper.mp4` | `0e6af98` | `/works/salesforce` |
| `videos/vid3.mp4` | `5134e5b` | `/works/salesforce` |
| `click.mp3` | `945abc7` | inside `global-code.js` |

Changing one of these files on `main` does not change the site until the URL points to the new commit.

### Legacy files

These files are not loaded anywhere today. They come from the site before the move to one file: Webflow loaded them through jsDelivr, and the old tags are saved in `~/code/portfolio-slater/backup-webflow-custom-code/`. Keep them, because old pinned URLs may still point at them.

| File | What it was |
|---|---|
| `bundle.js` | The old sitewide script: the home WebGL drag grid, Lenis, sliders and the project page features. |
| `loader.js` | The old preloader and page transitions, plus the heading and text reveals. |
| `home.js` | The old home's letter-by-letter button labels and its HLS background video player. |
| `about.js` | The old Profile page's heading reveal and the blinking text. |
| `archive.js` | The old Archive page's directional hover tiles and image reveal. |
| `about-badge.js` | An ES module for the WebGL ID badge, once on The Profile. It was removed in the 2026-11-24 Profile rebuild. |

Part of their features now live in `global-code.js`. The rest belonged to pages or sections that are gone (the old Archive and the old home, now drafts in Webflow).

### Other notes

- The repo has no CSS files. The site's CSS lives in Webflow, in its styles and in HTML embeds.
- The root URL https://portfolio-2t0.pages.dev returns 404, because there is no `index.html`. That is expected.
