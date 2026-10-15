# duskbloods.build

An unofficial compendium for *The Duskbloods*, rendered from a Google Sheet and served from Cloud Run.

Edit the sheet, and the site picks up the change within `CACHE_SECONDS` (default 60s). No redeploy needed.

**Sheet:** https://docs.google.com/spreadsheets/d/15wyNicWMxF-fM4o-_m5uUODuEoL5WFaXnoZy_VNHOaA/edit

## How the sheet maps to the site

The sheet must be shared as **Anyone with the link → Viewer**. The app downloads it as one `.xlsx` export,
so every tab is read in a single request with no API keys.

| Tab | Becomes |
| --- | --- |
| `_site` | Site settings, as `key, value` rows: `title`, `tagline`, `release_date` (shows a countdown), `hero_image`, `discord_url` |
| `News` (or `Updates`) | "Latest updates" on the home page, plus `/updates`. Newest `Date` first |
| Any other tab | A compendium category at `/c/<tab-name>`: a sortable, filterable table. Each row is an entry with its own page |
| `_anything`, hidden tabs, blank tabs | Ignored, so use them for notes and drafts |

The first non-blank row of a tab is its header row. These column names have special meaning (case-insensitive):

| Column | Use |
| --- | --- |
| `Name` / `Title` | Entry title (required; rows without one are skipped). If neither exists, the first column is used |
| `Image` | Image URL: a thumbnail in the table and the picture on the entry page (`http(s)` only) |
| `Summary` / `Description` | One line under the name in the table; italic flavour text on the entry page |
| `Body` / `Details` | Long text on the detail page (blank lines become paragraphs) |
| `Tags` / `Type` | Comma-separated values, shown as a column and a filter dropdown (labelled with your header) |
| `Date` | Shown on news posts; used for sorting |
| `Link` / `Source` | "Source ↗" button |
| `Slug` | Override the URL slug (defaults to the title) |
| `Draft` | `TRUE` hides the row |

Every other column (e.g. `Role`, `Damage`, `Weakness`) becomes a table column (first five) and a labelled stat on the entry's page. All-numeric columns sort numerically and align right.

`templates/` has a CSV per suggested tab (`_site`, `News`, `Bloodsworn`, `Weapons`, `Locations`, `Enemies`).
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

## Endpoints

`/` home · `/compendium` · `/c/:category` · `/c/:category/:entry` · `/updates` · `/updates/:post` · `/search?q=` ·
`/api/content` (everything as JSON) · `/healthz` (last refresh time and error, if any)

If a sheet refresh fails, the last good copy keeps being served and the error is reported on `/healthz` and in the logs.
