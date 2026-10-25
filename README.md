# FarawayFound

The personal site of David Chui: a landing page that points to the portfolio (davidchui.work) and the **FarawayFound travel
blog**. It is a plain static site. `Public_html/` is what gets published; the HTML in it is **generated** from the story files in
`content/` by a small Node script with no dependencies.

```
content/site.json         all site-level copy (the owner's words, verbatim) + hero/photo-break tuning
content/posts/*.json      one file per story (any number)
templates/                the markup: layout.js, landing.js, blog-index.js, post.js, parts.js
scripts/build-site.js     the generator (+ scripts/lib/: images, content, dots, media, util)
Public_html/              the site: generated pages + assets (css, js, images, data, clips)
tests/                    browser regression suite (Playwright) - optional, not needed to build or deploy
```

## Everyday use

```bash
node scripts/build-site.js            # validate the content, make missing image derivatives, write Public_html/
node tests/serve.js --port 8765       # preview at http://127.0.0.1:8765  (case-sensitive, like the Raspberry Pi)
# or: python3 -m http.server 8765 -d Public_html     (works too, but a Mac/Windows disk hides letter-case mistakes)
```

Then deploy exactly as before (`bash scripts/deploy-on-pi.sh` on the Pi). The build never deploys, commits or pushes.
Building twice produces identical files, so a diff only shows what really changed.

Options: `--check` (validate only), `--no-images` (never run an encoder), `--force-images` (rebuild every derivative),
`--site-url https://...` (see "Sharing" below), `--content <dir>` / `--out <dir>` (build somewhere else), `--keep-going`.
A **hard error** (unreadable JSON, a missing image, a bad date, a duplicate slug) stops the build before anything is written
and exits with code 1. Warnings (letter-case fixes, w/h that disagree with the file, duplicate photos ...) are printed and do not stop it.

### Add a story

Drop `content/posts/<slug>.json` next to the others and its photos under `Public_html/assets/images/<slug>/`, then build.
The story appears in the index (grouped by year, newest first), on the map, on the landing page strip and in everyone's
previous/next links. Nothing else needs editing.

```jsonc
{
  "slug": "north-cascades",                 // file name of the page: blog/pages/<slug>.html
  "title": "North Cascades NP",
  "cardTitle": "North Cascades NP",         // optional: shorter title for tiles (falls back to title)
  "subtitle": "…",                          // optional: one line under the title on the story page
  "date": "2018-07",                        // YYYY-MM or YYYY-MM-DD; "dateLabel" ("July 2018") is optional
  "location": "North Cascades National Park, Washington",
  "region": "Pacific Northwest",            // optional: shown in the facts list
  "country": "United States",               // counted in the "countries" total
  "coords": [48.7, -121.2],                 // coarse [lat, lon]; the only place data the site publishes
  "tags": ["national-park", "mountains"],   // filter chips; any lowercase words joined by "-"
  "sectionTitle": "American Alps",
  "paragraphs": ["…", "…"],
  "scrollCue": "memories below",            // optional (this is the default)
  "cover": "assets/images/north-cascades/cover.webp",
  "coverPosition": "57% 30%",               // optional CSS object-position for the cover everywhere it is cropped
  "card": "assets/images/north-cascades/thumbs/349e4e96.webp",   // the tile photo (its full-size twin one folder up is used)
  "photos": [
    { "src": "assets/images/north-cascades/0328eb04.webp", "w": 2048, "h": 1365,   // w/h optional: read from the file
      "caption": "Window Seat", "alt": "Sunset seen from an airplane window …",      // alt optional (falls back to caption + place)
      "featured": true }                                                              // optional: prefer this for a full-bleed photo break
  ],
  "hero": true,                              // optional: force (true) / forbid (false) this cover in the blog hero slideshow
  "legacy": false
}
```

Paths are relative to `Public_html/`. Spelling the folder with the wrong letter case (`rainiernp` for `rainierNP`) is
fixed automatically at build time and reported as a warning; a path that does not exist at all is a hard error.
Do not hand-edit the generated pages; edit the story file, `content/site.json` or a file in `templates/`.

### Images (and why `assets/images/derived/` exists)

The photos on disk are large (covers up to 4.4 MB, legacy gallery thumbnails are 600x392 crops). The pages never use them
directly. The build creates aspect-preserving **WebP derivatives** next to the originals and every `<img>` uses `srcset`:

| use | widths |
| --- | --- |
| slideshow photos (landing) | 1280, 1920 (+ the 2560 original) |
| story covers / blog hero / big tiles | 960, 1600, 2560 |
| story thumbnails (tiles, strip, previous/next, map card) | 480, 960, 1600 |
| gallery photos | 480, 960 (lightbox: 1600 WebP when the original is a heavy JPEG, else the original) |
| link previews | `assets/images/derived/og/<slug>.jpg`, 1200x630, cropped around `coverPosition` |

Derived files are created only when missing (`--force-images` rebuilds them) and **must be committed** - the Pi only rsyncs
`Public_html/`. Encoders: `cwebp` (package `webp`; preferred) or an ffmpeg that includes libwebp, and ffmpeg for the JPEG link
previews and the clip. Without an encoder the build still works when the derivatives already exist; otherwise it says exactly
what to install and falls back to the originals. The landing clip `assets/clips/tinySnowboarding.mp4` (10.5 MB) is left alone;
the page uses `tinySnowboarding-480.mp4/.webm` (about 1.5 MB each, no audio) and a poster frame, and the video is only
requested when its card scrolls into view (never under reduced motion or Save-Data).

**Landing slideshow photos** live in `assets/images/Landing/` (originals, 6000 px) and `Landing/web/<name>.webp` (optimised 2560 px,
what the slideshow actually uses). Make the optimised file with
`cwebp -quiet -q 82 -m 6 -sharp_yuv -resize 2560 0 "Landing/<name>.jpg" -o "Landing/web/<name>.webp"` (cwebp drops all EXIF/GPS by default),
then run the build - it picks the `web/` version up on its own (without one it falls back to widths derived from the 6000 px original).
`content/site.json -> hero` names the first photo and which photos pad the blog hero (landscapes without people only).
The originals in `Landing/*.jpg` are not used by any page; they are 8-35 MB each, so keep them out of the commit if you can.

**Hero legibility.** There are no dark patches behind the small hero words. Instead every hero photo gets one flat, neutral layer
(`--shade`, 0 to 0.34) that the build **measures**: `scripts/lib/tone.js` decodes each cover with ffmpeg, looks at how bright it is
where the title, date line and cue sit, and darkens only as much as white text needs (dark and mid photos get 0). The numbers are kept
in `assets/data/hero-tone.json` (so a build without ffmpeg reuses them). Override per story with `"heroShade": 0.3` in the story file or
`content/site.json -> hero.shade { "<slug>": 0.3 }`; `hero.coverPositions { "<slug>": "50% 40%" }` sets a cover's crop for a story whose
JSON you do not edit; `titleTags { "<slug>": "Aspen" }` keeps an original browser-tab title.

### Privacy: photo metadata

Camera files carry EXIF (camera and lens serial numbers, owner / artist names, sometimes **GPS coordinates**), XMP, IPTC and comments, and
the site links the original JPEGs from the lightbox. The generated WebP files are clean; the originals are not unless you strip them:

```bash
node scripts/strip-metadata.js            # report (exit 1 when anything carries metadata)
node scripts/strip-metadata.js --write    # strip in place - lossless: no re-encode, colours and rotation are kept
node scripts/build-site.js --strict       # before deploying: a photo with metadata (or an empty site.url) is a hard error
```

The normal build only **warns** (and says how many files, how many with GPS / an e-mail address). Run the strip once after adding photos
from a camera and before committing.

### Site copy (`content/site.json`)

Everything the owner wrote on the original pages is in `landing`, `blog` and the story files, **verbatim, typos included**
(`tests/verbatim.js` checks every string against the original pages in git history). Three edits were agreed and are the only
differences: the "Sorry, this hasn't been updated in a while..." sentence was dropped from the blog card, the "Get in touch"
button points to https://davidchui.work/ (it pointed to google.com), and the dead social icons were removed. `ui` holds the
neutral interface words ("All stories", "Map", "Filter" ...).

**Sharing:** set `site.url` (for example `https://example.com`, no trailing slash) in `content/site.json` once the public address is
decided. The build then writes `canonical` links, absolute `og:image` / `og:url` addresses, `sitemap.xml` and `robots.txt`.
Until then it prints a loud warning and leaves those out (relative `og:image` paths are not usable by link previews); `--strict` turns it into an error.

### What the pages do (rules worth knowing)

* **Story index** (`blog/index.html`): hero slideshow (newest non-legacy covers + curated landscapes, with a story teaser and a
  pause button), the map, then a sticky **timeline** (year histogram with counts and scroll-spy; a chip bar under the header on
  phones), tag filters with faceted counts, and one tile group per year. Tile sizes come from `planGroup()`
  (`assets/js/plan-group.js`, shared by the build and the browser): 1 story = banner, 2 = halves, 4 = 2x2, otherwise a big tile
  beside two small ones then rows of three - always complete rows, re-planned after every filter.
  Filters live in the address (`#year=2016&tag=snow`), so a link can point at a filtered view.
* **Map**: a dot matrix drawn from `assets/data/world-dots.json` (no tiles, no network). Zoomed in, the land is re-sampled on a finer
  dot lattice so it still reads as land. Stories merge into clusters sized by sqrt(count); hover/tap shows a photo card, a cluster zooms
  or opens a list (a bottom sheet on phones); region chips are built from the stories you have, and the map opens on the region that
  holds 75% of the stories (North America today) with the World chip one tap away.
* **Story page**: cover, text with a sticky locator (drawn at build time, coarse coordinates only), full-bleed **photo breaks**
  (stories with 3+ paragraphs and 12+ photos get 1-3: `featured` photos first, otherwise the widest frames, never a portrait, never the
  cover, never a frame whose alt/caption mentions people; `content/site.json -> photoBreaks` can name frames for legacy stories; a break
  keeps the photo's own proportions, it is never cropped), a **justified gallery** (`ff.js` plans all the rows together, so every row -
  the last one too - is full and close to one height; plain CSS rows are the fallback without JavaScript), the viewer, previous/next.
* **Viewer**: opening a photo adds ONE history entry (`#photo-N`); changing photos only replaces it, so the phone's Back
  closes the viewer and stays on the page. `#photo-N` links open it. Keys: arrows, Home/End, Esc, Tab stays inside; swipe left/right, drag down to close.
* **Motion**: everything animated (slideshow, Ken Burns, title drawing, reveals, count-up, terminal, map zoom, page crossfade)
  is off under `prefers-reduced-motion`; every auto-advancing slideshow has a pause button. Without JavaScript the pages are
  complete (first slide, all tiles, plain-link gallery).

## Tests

```bash
cd tests && npm install && node run-all.js        # about 3 minutes; needs Chrome/Chromium (CHROME_PATH=...)
node crawl.js --quick                              # 360 + 1440 px for every page (full 320-2560 range for the key pages without --quick)
node flow.js lightbox history                      # a single scenario
```

`generator` (build errors, new-style story in a throw-away copy) - `links` (every file exists with the exact letter case) -
`verbatim` (the owner's text) - `crawl` (no console errors / 404 / broken images / overflow, sized images, one h1) - `flow`
(slideshow + pause, reduced motion, no-JS, clip loading, map, timeline, filters + deep links, planGroup rows, lightbox keys/swipe/focus/history, previous/next) -
`a11y` (landmarks, names, focus rings, AA contrast, touch targets) - `perf` (page-weight budgets) - `hero` (the scrim is measured:
brightness kept and text contrast over all 30 slideshow photos).
The preview server answers 404 for a wrong-case path, which is how the Pi behaves.

## Deploy checklist

1. `node scripts/strip-metadata.js` (clean?) and set `site.url`, then `node scripts/build-site.js --strict` (twice: the second run must say `0 changed`).
2. Commit everything, **including `assets/images/derived/`, `assets/data/` and `assets/clips/*-480.*`** - the Pi only rsyncs `Public_html/`. The tree is
   large (about 900 MB of images): consider keeping `Landing/*.jpg` and `assets/images/resized/` out of the commit, or Git LFS.
3. After deploying, check the web server sends the right types: `curl -sI https://<site>/assets/images/derived/zion/cover-960.webp | grep -i content-type`
   (`image/webp`), the `.webm` clip (`video/webm`) and `assets/css/stars.svg` (`image/svg+xml`); older Apache / nginx configs may lack them.
   Turn on gzip / brotli for html, css, js and json.

## Notes

* Old template files (`assets/css/style.css`, `bootstrap.css`, jQuery plugins ...) are still on disk but no longer referenced.
  `blog/pages/aspen copy.html` and `portfolio-single.html` are unlinked leftovers; the build leaves them alone.
* `landing-images.js` is still written by the sync scripts for compatibility; the build calls the same sync code itself, so a new landing
  photo only needs a build.
* Derived images (`assets/images/derived/`) are created once and then reused: after **replacing a photo under the same name**, or changing a
  `coverPosition`, run the build with `--force-images` (or delete that photo's derived files) to refresh them.
* Cross-document page crossfades (`@view-transition`) are a progressive extra for Chrome/Safari; links are plain links.
