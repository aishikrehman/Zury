# Zury event matrix

What each kind of Wikimedia event needs from Zury, what Zury already does, and
what is missing. Use it to decide what to build next and to check that a new
event type fits the model.

## 1. The model

Every event in Zury is built from the same parts. An event type is a choice of
which parts it uses and how.

| Part | What it is | Where in Zury |
|---|---|---|
| **Scope** | One wiki, or several wikis under one address (`/wam/2026/bn`) | Event, wikis |
| **People** | Organizers, jury, participants, viewers; per event or per wiki | People |
| **Entries** | Things people submit: articles, files, items, proofread pages | Submissions |
| **Contributions** | Things Zury finds by itself: edits, uploads, tagged edits | Tracking |
| **Sessions** | Meetings people register for and attend | Sessions |
| **Rules** | Automatic checks on entries (size, date, category…) | Type settings, validation |
| **Judging** | People deciding on entries: accept, reject, score | Review (Phase 6) |
| **Scoring** | Turning entries, marks and contributions into points and ranks | Missing |
| **Outputs** | Results, certificates, reports, exports | Partly |

## 2. Event types × parts

● needed and built · ◐ needed, partly built · ○ needed, not built · – not needed

| Event type | Entries | Contributions | Sessions | Rules | Judging | Scoring | Outputs |
|---|---|---|---|---|---|---|---|
| Writing contest (WAM, CEE Spring) | ● articles | ◐ | – | ● size, words, created in period | ○ marks | ○ points per article | ○ results, leaderboard |
| Photo contest (WLM, WLE) | ● files | ◐ category | – | ● resolution, category, upload date | ○ rounds, ratings | ○ jury score | ○ winners, export |
| Data contest (Wikidata) | ● items | ◐ | – | ● properties, statements | ○ | ○ per item | ○ |
| Edit-a-thon | – | ● participants' edits, hashtag | ◐ optional | ◐ min bytes | – | ○ edits, bytes | ◐ report |
| **Proofread-a-thon (Wikisource)** | ○ Page: namespace | ○ proofread/validated pages | – | ○ quality level, index | – | ○ points per level | ○ |
| **GLAM partnership** | ○ uploads from a collection | ○ category, usage | ◐ | ○ licence, source, category | ○ curation | – | ○ usage report |
| **Scanning and digitization** | ○ scans uploaded | ○ category | ● scanning sessions | ○ format, resolution, metadata | ○ quality check | ○ pages scanned | ○ progress report |
| Workshop | – | ● participants' edits | ● | – | – | – | ● certificate |
| Training | – | ● participants' edits | ● course | – | – | – | ● certificate |
| Photowalk | ● files | ● category | ● walks | ● photo rules | – | – | ◐ |

## 3. The three new types

### Proofread-a-thon (Wikisource)
- **Entry:** a page in the `Page:` namespace of a Wikisource.
- **Automatic check:** its proofreading level from the wiki (`prop=proofread`):
  0 without text, 1 not proofread, 2 problematic, 3 proofread, 4 validated.
- **Rules:** which books (Index pages) count; minimum level; the participant
  must have made the change to that level during the event.
- **Points:** separate points for proofreading (level 3) and validating
  (level 4); validation of one's own proofreading doesn't count.
- **Tracking:** participants' edits in the `Page:` namespace.

### GLAM partnership
- **Entry:** a file uploaded from a partner's collection.
- **Fields:** partner institution, collection, licence, the batch category.
- **Rules:** file in the batch category, a free licence, source given.
- **Outputs:** how many files, and where they are used on wikis (GlobalUsage).

### Scanning and digitization
- **Sessions:** scanning days at a library or archive, with attendance.
- **Entry:** scanned files (PDF, DjVu, TIFF, JPEG) on Commons.
- **Fields:** holding institution, target number of pages, file formats,
  minimum resolution (DPI), whether an Index page on Wikisource is expected.
- **Outputs:** pages scanned against the target; books made ready for
  proofreading.

## 4. Fountain, compared

Fountain is the editathon tool many communities use for article contests.

| Fountain feature | Zury now | Plan |
|---|---|---|
| Rules checked when an article is added | ● preview checks every entry | Keep |
| Rule severity (must pass / only warn) | ○ all rules are hard | Add a "warn only" choice per rule |
| Marks set by organizers (e.g. "Accepted", "Quality: 0–3") with points | ○ | Marking scheme in the wizard |
| Jury marks each article; consensus or single jury | ○ | Phase 6 jury screen |
| Leaderboard by points | ○ | From marks and type points |
| Article list per participant | ● | Keep |
| Several wikis in one event | ● under one address | Keep |
| Workshops, trainings, photowalks | – | ● Zury only |

## 5. Moving events

A single event can later become part of a bigger one in two ways.

**Join a series** (WAM Bangla 2026 becomes `/wam/2026`):
change "Part of" and "Edition" in its settings. Nothing is copied. Its entries,
people and history stay; only the address changes, and the old address
redirects to the new one.

**Merge into a multi-wiki event** (a separate Bangla WAM becomes `/wam/2026/bn`
of the global WAM): "Move into another event" in the danger zone.
Its wiki is added to the target event; entries, participants, sessions,
tracked edits and history move with it; its organizers and jury become
organizers and jury of that wiki only. The old event is closed and its
address redirects to the wiki's page. Copy-then-delete is not used: it would
create a second history, break links, and risk losing data between the copy
and the delete.

## 6. Order of work

1. The three new types (this change): types, fields, rules, wizard text.
2. Move into another event (this change).
3. Marking scheme and rule severity in the wizard (this change: settings only).
4. Jury screen with marks, consensus and a leaderboard (Phase 6).
5. GLAM usage and digitization progress reports.
