# duskbloods.build

An unofficial compendium for *The Duskbloods*, rendered from a Google Sheet and served from Cloud Run.

Edit the sheet, and the site picks up the change within `CACHE_SECONDS` (default 60s). No redeploy needed.

**Sheet:** https://docs.google.com/spreadsheets/d/15wyNicWMxF-fM4o-_m5uUODuEoL5WFaXnoZy_VNHOaA/edit

## How the sheet maps to the site

The sheet must be shared as **Anyone with the link → Viewer**. The app downloads it as one `.xlsx` export,
so every tab is read in a single request with no API keys.

| Tab | Becomes |
| --- | --- |
| `_site` | Site settings, as `key, value` rows: `title` (header and browser tab), `tagline` (search-engine description), `release_date` (a one-line countdown at the top of the home page), `discord_url` |
| `_pages` | `Page, Description, View, Icon, Color` rows (any column order, all but `Page` optional). `Page` is `Compendium`, `Updates`, or a category tab's name. The description shows under the page title (and is the search-engine description); `View` (`grid`, `list` or `table`) overrides a category's automatic layout; `Icon`/`Color` set its badge (below) |
| `News` (or `Updates`) | "Latest updates" on the home page, plus `/updates`. Newest `Date` first |
| Any other tab | A compendium category at `/c/<tab-name>`, filterable, and each row gets its own page. Layout is automatic: a **portrait grid** if most rows have an image, a **list** if there's long text or paired abilities, otherwise a sortable **table** |
| `_anything`, hidden tabs, blank tabs | Ignored, so use them for notes and drafts |

The first non-blank row of a tab is its header row. These column names have special meaning (case-insensitive):

| Column | Use |
| --- | --- |
| `Name` / `Title` | Entry title (required; rows without one are skipped). Otherwise any `… Name` column (e.g. `Character Name`), else the first column |
| `Image` / `Picture` / `Portrait` | An image URL (`http(s)`), **or a picture placed in the row's cell** (Insert → Image → image in cell / over cells). Placed pictures are served from the site at `/media/<hash>`. Also any `… Picture`/`… Image` column, e.g. `Profile Picture` |
| `Summary` / `Description` | One line under the name in the table; italic flavour text on the entry page |
| `Body` / `Details` | Long text on the detail page (blank lines become paragraphs) |
| `Tags` / `Type` | Comma-separated values, shown as a column and a filter dropdown (labelled with your header) |
| `Date` | Shown on news posts; used for sorting |
| `Link` / `Source` | "Source ↗" button |
| `Slug` | Override the URL slug (defaults to the title) |
| `Draft` | `TRUE` hides the row |

**Paired columns:** a column `X` next to `X Description` becomes one ability, grouped by name, so `Skill 1`/`Skill 1 Description`
and `Skill 2 (Level 12)`/`Skill 2 Description` show as a **Skills** section with two titled blocks (brackets become a note: "Level 12").

Every other column becomes a labelled stat, unless its text is long on average (e.g. `Lore`), in which case it's a prose
section. All-numeric columns sort numerically and align right in tables.

**Cross-links:** an entry that shares its name with entries in other tabs (Albert in Characters, Weapons, Skills) links to
them ("Also in …"), and any cell whose whole value is another entry's name links to that entry.

**Section badges:** every category (and Updates) gets a small coloured icon wherever it's named: tabs, the compendium
index, breadcrumbs, search results, and matching headings on entry pages (a character's **Skills** heading uses the Skills
badge). It's picked from the tab name automatically; set it in `_pages` to override:

- `Icon`: `person` `sword` `flask` `bolt` `drop` `page` `map` `skull` `shield` `book` `star` `crown` `moon` `gem`,
  or an emoji / one or two characters (e.g. `🦇`, `IV`). Anything else falls back to the automatic choice.
- `Color`: `red` `amber` `green` `teal` `blue` `violet` `rose` `grey`.

Press `/` anywhere to jump to search (or to the filter, on a category page).

`templates/` has a CSV per suggested tab (`_site`, `_pages`, `News`, `Bloodsworn`, `Weapons`, `Locations`, `Enemies`).
To add one, go to **File → Import → Upload → Insert new sheet(s)**. You can also just create tabs with your own headers.

## Local development

Requires Node 22+. No dependencies to install.

```sh
npm test                                  # unit + HTTP tests
SHEET_ID=15wyNicWMxF-fM4o-_m5uUODuEoL5WFaXnoZy_VNHOaA npm run dev   # live sheet, http://localhost:8080
npm run sample && SHEET_FILE=sample.xlsx npm run dev                # placeholder data, no network
```

## Docker (local)

```sh
./deploy.sh test     # run the test suite inside the image
./deploy.sh local    # build and serve the container on http://localhost:8080 (live sheet)
SAMPLE=1 ./deploy.sh local   # ...with placeholder data instead
./deploy.sh smoke    # build, start the container, check every page type, stop it
```

## Deploy to Cloud Run

```sh
gcloud config set project <your-project>   # or PROJECT_ID=... / .env.deploy
./deploy.sh setup    # once: enable APIs, create the Artifact Registry repo, configure docker auth
./deploy.sh all      # test → build → smoke → push → deploy
```

Or run the steps separately: `./deploy.sh push` then `./deploy.sh deploy`. Set `DRY_RUN=1` to print the gcloud/docker
commands without running them. Config comes from env vars or `.env.deploy` (git-ignored):

```sh
PROJECT_ID=my-project
REGION=europe-west1
SERVICE=duskbloods
SHEET_ID=15wyNicWMxF-fM4o-_m5uUODuEoL5WFaXnoZy_VNHOaA
CACHE_SECONDS=60
```

The service is public (`--allow-unauthenticated`), scales to zero, and needs no secrets.

## CI/CD (GitHub Actions)

`.github/workflows/ci.yml` runs on every push and pull request:

- **test**: `npm test`, then `./deploy.sh smoke` (Docker build with tests inside, container smoke test on sample data
  and the live sheet).
- **deploy** (only `main`): builds and pushes the image to Artifact Registry, deploys to Cloud Run, then checks the live
  URL returns 200 for `/health`, `/`, `/compendium` and `/updates`. Deploys never overlap.

Repository secrets: `GOOGLE_CLOUD_PROJECT`, `CLOUD_RUN_NAME`, and `CLOUD_RUN_SERVICE_ACCOUNT` (the deploy account's JSON
key). Optional repository variables: `REGION` (default `europe-west1`) and `SHEET_ID`.

One-time GCP setup (already run for `duskbloods-build`):

```sh
PROJECT_ID=duskbloods-build DEPLOYER_SA=duskbloods-build-sa@duskbloods-build.iam.gserviceaccount.com ./deploy.sh setup
```

This enables the APIs, creates the `duskbloods` image repo, a `duskbloods-runtime` account with **no roles** for the
site to run as, and the page view sink to BigQuery (see [Analytics](#analytics); pass `SERVICE=duskbloods-build-web`), and gives the deploy account only `run.admin`, write access to that one repo, and permission to run
services as `duskbloods-runtime`.

## SEO

Every page gets a unique title and meta description built from the sheet, an absolute canonical URL, Open Graph and
Twitter cards, and JSON-LD (WebSite + VideoGame, BreadcrumbList, CollectionPage/ItemList, ItemPage, BlogPosting).
`/sitemap.xml` lists every indexable canonical page (with portraits as image entries), and `/robots.txt` points to it.

- **Duplicates:** an entry whose content is a subset of a fuller entry with the same name (Albert in Skills vs
  Characters) declares the fuller page canonical and is left out of the sitemap.
- **Placeholders:** text like `TODO` in the sheet is never shown or used as a description; descriptions are built
  from the entries instead. Fill those cells in for the best results.
- **Search and 404 pages** are `noindex, follow`. Trailing-slash URLs 301 to the version without.
- **Performance:** brotli/gzip, fingerprinted static assets cached for a year, self-hosted fonts, LCP image preloaded.
- **Domain:** set `SITE_URL` (CI repository variable, or env for `./deploy.sh deploy`) to the public origin, e.g.
  `https://duskbloods.build`. Without it, canonical URLs use the host the request came in on.

Audit a running copy with the `seo-max` skill's crawler:
`python3 -I ~/.claude/skills/seo-max/scripts/seo_audit.py http://localhost:8080 --fail-on warn`.

## Problem reports

Every page has a **Report a problem with this page** form. Submissions go to a Google Form, so they land as rows in
its linked Google Sheet, with the page URL and entry name (e.g. `Items › Goldblood Stake`) filled in automatically.
Visitors never leave the site, and it works with JavaScript off. It's anonymous, with a hidden spam trap and a limit
of 5 reports per visitor per 10 minutes.

Setup (once):
1. Create a Google Form with three **short answer / paragraph** questions: `Page`, `Entry`, `What's wrong?`.
   In Settings, make sure it does **not** require sign-in or collect email addresses.
2. Responses → **Link to Sheets** (and, if you like, ⋮ → *Get email notifications for new responses*).
3. ⋮ → **Get pre-filled link**. Type `PAGE`, `ENTRY` and `MESSAGE` into the three questions, then *Get link* → *Copy link*.
4. Set that link as the `FEEDBACK_FORM_URL` GitHub repository **variable** (not a secret; the form is public), or
   as an env var for `./deploy.sh deploy`. Without it, the form is hidden.

## Analytics

Page views are counted on the server, with no cookies, no client script and no third party. Each page a person loads
(not static files, feeds, `/health`, redirects, `HEAD`, browser prefetches or bots) writes one log line:

```json
{"severity":"INFO","message":"pageview","pageview":{"path":"/search","status":200,"ref":"reddit.com","device":"mobile","q":"blood blade","results":0}}
```

`ref` is only the hostname of another site that linked here; `q`/`results` appear only on searches. IPs, user agents,
query strings and anything that links one visit to another are never recorded (see `src/analytics.js` and `/privacy`).

`./deploy.sh setup` creates a log sink that copies these lines into BigQuery (`analytics.run_googleapis_com_stdout`,
partitioned by day, partitions deleted after 400 days). Run it with the **live service name**, or the sink matches nothing:

```sh
PROJECT_ID=duskbloods-build SERVICE=duskbloods-build-web ./deploy.sh setup
```

Rows only start arriving after the first page view following setup. Example queries
(`bq query --use_legacy_sql=false '…'`, or the BigQuery console):

```sql
-- Top pages, last 30 days
SELECT jsonPayload.pageview.path, COUNT(*) AS views
FROM `duskbloods-build.analytics.run_googleapis_com_stdout`
WHERE timestamp > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY) AND jsonPayload.pageview.status = 200
GROUP BY 1 ORDER BY views DESC LIMIT 50;

-- Searches that found nothing: what to add to the sheet next
SELECT jsonPayload.pageview.q, COUNT(*) AS searches
FROM `duskbloods-build.analytics.run_googleapis_com_stdout`
WHERE jsonPayload.pageview.results = 0
GROUP BY 1 ORDER BY searches DESC LIMIT 50;

-- Views per day, by device; referrers; and broken inbound links (404s)
SELECT DATE(timestamp) AS day, jsonPayload.pageview.device, COUNT(*) FROM `duskbloods-build.analytics.run_googleapis_com_stdout` GROUP BY 1, 2 ORDER BY 1 DESC;
SELECT jsonPayload.pageview.ref, COUNT(*) AS views FROM `duskbloods-build.analytics.run_googleapis_com_stdout` WHERE jsonPayload.pageview.ref != '' GROUP BY 1 ORDER BY 2 DESC;
SELECT jsonPayload.pageview.path, COUNT(*) AS hits FROM `duskbloods-build.analytics.run_googleapis_com_stdout` WHERE jsonPayload.pageview.status = 404 GROUP BY 1 ORDER BY 2 DESC;
```

Counts are page views, not people: there are no unique-visitor numbers by design. Browsers may re-show a page from
their cache for up to 60s without asking the server, so very quick back-and-forth navigation can be undercounted.

## Endpoints

`POST /report` problem reports · `/` home · `/compendium` · `/c/:category` · `/c/:category/:entry` · `/updates` · `/updates/:post` · `/search?q=` ·
`/api/content` (everything as JSON) · `/health` (last refresh time and error, if any)

If a sheet refresh fails, the last good copy keeps being served and the error is reported on `/health` and in the logs.
