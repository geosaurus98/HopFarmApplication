# Setup Guide

About 30 minutes, no programming needed. You need a Google account. This is the
account that owns the data, so use a farm account rather than a personal one if
you can.

```
 Tablet / laptop (the app)  ──HTTPS──▶  Apps Script web app  ──▶  Google Sheet  (+ Drive for photos)
   works offline, queues changes          checks sign-in, validates     the database you can open,
   in the browser's storage               and saves                     filter and download
```

## 1. Create the Google Sheet (5 min)

1. Go to <https://sheets.new> and name the sheet **Hop Farm Data**.
2. **Extensions → Apps Script**. Delete the sample code in `Code.gs`.
3. Create three files with the contents from this repository:
   - `Setup.gs` ← [`apps-script/Setup.gs`](../apps-script/Setup.gs) (rename `Code.gs` to `Setup`)
   - `Api.gs` ← [`apps-script/Api.gs`](../apps-script/Api.gs) (click **+ → Script**, name it `Api`)
   - `appsscript.json` ← [`apps-script/appsscript.json`](../apps-script/appsscript.json)
     (⚙ **Project Settings** → tick *Show "appsscript.json" manifest file*, then paste).
     This sets the time zone to `Pacific/Auckland`.
4. Click **Save**, choose `setupHopFarmWorkbook` in the function list, and click **Run**.
   Approve the permission prompts. Google warns that the app is unverified because
   you wrote it yourself: click *Advanced → Go to …*.
5. Back in the sheet you will see the tabs **Users, BlockVarieties, Samples,
   LeafAnalysis, AuditLog, HelpReference**, and a pop-up with **your access code**.
   You are already set up as the Administrator.

## 2. Enter the farm's data (10 min)

**BlockVarieties**: delete the five example rows and enter one row per block and
variety:

| BlockVarietyID | Block | Variety | AreaHa | Active |
|---|---|---|---|---|
| A1-CASCADE | A1 | Cascade | 7.84 | TRUE |

- `BlockVarietyID` is any short unique code. **Never change it once samples use it.**
- `AreaHa` is in hectares and must be above 0. The app works out the number of
  leaves to collect from it.
- To retire a block, set `Active` to `FALSE`. Don't delete it, because old
  samples still refer to it.
- If an area changes later, edit `AreaHa`. Samples already collected keep the
  area and leaf target they were collected with.

**Users**: one row per person.

| UserEmail | UserName | Role | Active | AccessCode |
|---|---|---|---|---|
| sam@nelsonlakeshops.co.nz | Sam | Collector | TRUE | 482913 |

- `Role` is **Collector** (field samples only), **Analyst** (leaf analysis and
  exports) or **Administrator** (everything, including corrections to completed
  samples).
- `AccessCode` is the code that person types to sign in. Make each one different;
  six random digits is fine. Only people who can open this spreadsheet can see
  the codes.
- To remove someone's access, set `Active` to `FALSE` or change their code.

**HelpReference**: starter identification and how-to text is already filled in.
Edit it to match the farm's own posters. To add a picture, put an `https://` image
link in `Image`.

## 3. Publish the API (3 min)

In the Apps Script editor: **Deploy → New deployment → ⚙ → Web app**

- *Execute as*: **Me**
- *Who has access*: **Anyone**

Click **Deploy** and copy the **Web app URL** (it ends in `/exec`). This is the
**server address** that staff enter once when they first sign in.

> "Anyone" only means the address can be reached. Every request must still carry
> a valid email and access code from the Users tab, and the script checks what
> that person's role allows. Without a code, nobody can read or change anything.

**After changing the script later:** use **Deploy → Manage deployments → ✎ →
Version: New version → Deploy**. This keeps the same address. A *New deployment*
creates a new address.

## 4. Put the app online (5 min)

The app is the [`app/`](../app) folder: plain files with no build step. It must be
served over **HTTPS** for offline mode and "install" to work. Any free static
host works. Pick one:

- **Netlify Drop** (easiest): go to <https://app.netlify.com/drop> and drag the
  `app` folder onto the page. You get an address like
  `https://hopfarm-xyz.netlify.app`. To update, drag the folder again on the
  site's *Deploys* page.
- **GitHub Pages**: *Settings → Pages → Deploy from a branch*, then choose the
  branch and the `/app` folder. This needs a public repository or a paid GitHub
  plan.
- **Cloudflare Pages**: connect the repository and set the build output
  directory to `app`.

Optional: put the server address from step 3 into
[`app/js/config.js`](../app/js/config.js) (`DEFAULT_API_URL`) before uploading,
so staff don't have to type it.

## 5. Install on each tablet (2 min per device)

1. On the tablet, open the app address in **Chrome** (Android) or **Safari** (iPad).
2. Sign in with the person's email and access code. Under **Server address**,
   paste the `/exec` address if it isn't pre-filled.
3. Install it:
   - Android Chrome: **⋮ → Add to Home screen / Install app**.
   - iPad Safari: **Share → Add to Home Screen**.
4. Open it from the home-screen icon once while on Wi-Fi and wait for **All synced**.
   From then on it opens and works with no signal.

## 6. Day-to-day use

| Who | Routine |
|---|---|
| Field collector | Open the app on Wi-Fi before going out (it syncs). Record each bag with **New Mite Sample**. Back in range, changes upload by themselves; the badge at the top shows anything still waiting. |
| Analyst | **Analyse Samples → choose the bag → Start analysis**. Enter the five counts and press **Save & next leaf** (or Enter on the last box). **Save & stop** pauses; **Resume at leaf N** continues. Finish with **Complete analysis**. |
| Administrator | Maintain blocks and users in the sheet. Correct completed samples in the app (every change is logged in **AuditLog**). Run **Hop Farm → Run data quality report** from time to time. |

**Don't** sign out, clear browser data or uninstall the app while the badge
shows changes waiting to upload.

## 7. Getting the data into Excel and seeing trends

From the app: **Reports and Exports**, choose a season and/or block (or leave
them as *All*), then:

- **Leaf results CSV**: one row per leaf, with the sample details on every row.
  Use this for detailed analysis.
- **Sample summary CSV**: one row per sample, with totals, averages per leaf,
  predator : pest ratio, and the share of leaves with mites. Use this for trends.

From the sheet: **Hop Farm → Build leaf results export** or **Build sample
summary** creates a tab. Then **File → Download → Microsoft Excel (.xlsx)** or
**CSV**.

Example trend in Excel, average two-spotted mites per leaf by week for each block:

1. Open `hopfarm_sample_summary_….csv` and choose **Insert → PivotTable**.
2. Rows: **WeekStarting**. Columns: **Block**. Values: **AvgTwoSMPerLeaf**, set
   to *Average*.
3. **Insert → PivotChart → Line**.

Swap **AvgTwoSMPerLeaf** for **AvgPPPerLeaf** (predators) or
**PctLeavesWithTwoSM**, or use **Season** as the filter to compare years. For an
average weighted by leaves rather than by samples, use the leaf file and average
**TetranychusCount**.

The app's **Trend by block** chart shows the same thing for a single block
directly on the tablet.

## 8. Backups

Google keeps the Sheet's version history automatically (**File → Version
history**). For an extra copy, download the sheet as `.xlsx` at the end of each
season. Photos are in the Drive folder **Hop Farm Photos**.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Email or access code not recognised" | Check the Users row: email spelling, `Active` = TRUE, and the code (no spaces). |
| "Could not reach the server" when online | Check the server address ends in `/exec`, and that the deployment's access is set to *Anyone*. |
| A change shows "need attention" on the Sync screen | The server refused it, for example because the sample was completed on another device. The message says why. Fix the cause (an admin can **Reopen analysis**) and press **Sync now**, or discard that change. |
| Script changes have no effect | You need a **new version** of the existing deployment (see step 3). |
| Tablet shows old blocks | Open the app on Wi-Fi and wait for **All synced**. |
