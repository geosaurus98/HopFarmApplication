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
   You are already set up as the Owner. Your username is the part of
   your email before the @; change it and your FullName in the Users tab if
   you like.

> **Already set up with an earlier version?** Paste in the new `Setup.gs` and
> `Api.gs`, then in the sheet run **Hop Farm → Repair / extend workbook
> structure**. It adds `Username` and `FullName` to the Users tab and fills them
> from the email and the old `UserName` column. Check the result, then you can
> delete the old `UserName` column. Finally publish a new version (step 3).

## 2. Enter the farm's data (10 min)

**BlockVarieties**: a new sheet starts with the farm's 39 blocks and areas
already filled in. If your sheet was created earlier with example rows, load
the real list: download
[`templates/BlockVarieties.csv`](../templates/BlockVarieties.csv) (on GitHub,
open it and use the **Download raw file** button), open the
**BlockVarieties** tab, and use **File → Import → Upload → Replace current
sheet**. Each row is one block and variety:

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

**Users**: one row per person. After this first setup, owners add and change
people from inside the app (**Manage Users** on the home screen), and workers
can add themselves on a set-up tablet. You rarely need to edit this tab by hand.

| UserEmail | Username | FullName | Role | Sections | Active | AccessCode |
|---|---|---|---|---|---|---|
| sam@nelsonlakeshops.co.nz | sam | Sam Wilson | User | | TRUE | |

- `UserEmail`: identifies the person behind the scenes and links their records.
  Don't change it once they've recorded data. People who add themselves on a
  tablet without an email get an ID like `sam.wilson@workers.hopfarm`.
- `Username`: for signing in with a code; must be unique.
- `FullName`: their real name, shown in the app, the name list and exports.
- `Role`: the person's level, lowest first:
  - **Trainee**: new starters. Mite Monitoring only (collect and analyse samples;
    reopens their own analyses for 31 days). Taps their name on a set-up tablet;
    no code needed. People who add themselves with **I'm new here** start as
    Trainees. The owner moves them up to User when they're ready.
  - **User**: collects and analyses samples and does plant checks. Reopens their
    own analyses for 31 days. Taps their name on a set-up tablet; no code needed.
  - **Admin**: everything a User does, plus all completed samples, all samples,
    reports, exports and correcting any sample. Signs in with a code.
  - **Owner**: everything an Admin does, plus people, access codes and tablets.
    Signs in with a code. Other owners are view-only in the app.

  Older names are upgraded automatically: Collector and Analyst become User,
  Administrator becomes Owner.
- `Sections`: `Mites`, `Plant Health`, or both. Blank means both.
- `AccessCode`: needed for Admins and Owners; optional for Users.
- To remove someone's access, set `Active` to `FALSE`.

**Devices**: the tablets an admin or owner has set up so workers can tap their
name. Owners can remove a tablet in **Manage Users → Tablets**.

**HelpReference**: starter identification and how-to text is already filled in.
Edit it to match the farm's own posters. The "Mite control in hops" poster is
built into the app's Help screen and works offline.

To add a picture to a help item:
1. Upload the photo to Google Drive.
2. Right-click it, choose **Share**, and set General access to **Anyone with the
   link**.
3. Copy the link and paste it into the `Image` cell.

Drive pictures need internet to show; the built-in poster does not. To replace
the poster, swap `app/help/mite-control-poster.webp` and publish the app again.

## 2b. Keep users in their own sheet (recommended)

This keeps everyone's access codes out of the data sheet, so you can share the
mite results with people without showing them the codes. The app doesn't change;
staff won't notice anything.

| Sheet | Holds |
|---|---|
| **Hop Farm Data** (the one the script is attached to) | Mite monitoring: Samples, LeafAnalysis, AuditLog, exports |
| **Hop Farm – Users & Setup** (new) | Users (with access codes), BlockVarieties, HelpReference, and a log of user changes |
| **Hop Farm – Plant Health** (later) | Plant health data, when that section is built |

1. Create a new, empty Google Sheet with the **same Google account** that owns
   the script, and name it **Hop Farm – Users & Setup**. Copy its address from
   the browser address bar.
2. In **Hop Farm Data**, choose **Hop Farm → Connect Users & Setup sheet…** and
   paste the address. (Google may ask you to approve one more permission, to let
   the script open the other sheet.)
3. The script copies the Users, BlockVarieties and HelpReference tabs across and
   checks every value matches. Only then does it switch the app over. If anything
   doesn't match, nothing is switched and it tells you why.
4. The old tabs in Hop Farm Data are renamed **OLD … (moved – delete)** and
   hidden. Open the new sheet and check it looks right, then delete those three
   old tabs (**View → Hidden sheets** to show them first). Until you delete them,
   the old copy of the access codes is still in Hop Farm Data.
5. Share each sheet only with the people who need it. Keep **Users & Setup** to
   yourself and other administrators.

From then on, edit users and blocks in **Hop Farm – Users & Setup**, or use
**Manage Users** in the app.

### Plant Health sheet

Plant checks get their own sheet in the same way:

1. Create a new, empty Google Sheet (same Google account) called
   **Hop Farm – Plant Health** and copy its address.
2. In Hop Farm Data choose **Hop Farm → Connect Plant Health sheet…** and paste it.
3. Delete the hidden **OLD PlantChecks (moved – delete)** tab afterwards, if one
   was created.
4. Share it with whoever needs the plant data.

In **Manage Users**, tick what each person **Can use**: Mite Monitoring, Plant
Health, or both. Existing users have both.

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

## 5. Set up each tablet (2 min per tablet)

1. On the tablet, open the app address in **Chrome** (Android) or **Safari** (iPad).
2. An **admin or owner** signs in with their username and access code. Leave
   **Set up this tablet so workers can just tap their name** ticked and give the
   tablet a name, e.g. *Field tablet 1*.
3. Install it:
   - Android Chrome: **⋮ → Add to Home screen / Install app**.
   - iPad Safari: **Share → Add to Home Screen**.
4. Open it from the home-screen icon once while on Wi-Fi and wait for
   **All synced**. From then on it works with no signal.
5. Tap **Change person** (top right). The tablet now shows **Who's using the
   app?**:
   - workers tap their name, with no password;
   - someone new taps **I'm new here** and enters their name (this needs Wi-Fi);
   - admins and owners use **Sign in with your access code** underneath.

Each record saves who did it, so several people can share one tablet and their
work uploads under their own names. If a tablet is lost, an owner removes it in
**Manage Users → Tablets**.

## 6. Day-to-day use

| Who | Routine |
|---|---|
| Collecting (any Trainee or User) | Open the app on Wi-Fi before going out and check it says **All synced**. Tap your name, then **Mite Monitoring → New Mite Sample**: enter the bag number, choose the block and tap **Continue**. Collect the leaves shown, seal the bag and check it's clearly labelled. Back in range, everything uploads by itself. |
| Analysing (any Trainee or User) | **Mite Monitoring → Analyse Samples → choose the bag → Start analysis**. Every count starts at 0, so change only what you see, then tap **Next leaf**. Tap **? Help** for identification photos. When the bag is done tap **Sample finished**, then **Complete analysis**; finishing early needs a reason. You can reopen your own analyses for 31 days. |
| Admin | Everything above, plus **Completed Samples** (all), **All Samples**, **Mite Reports** / **Plant Reports** and exports. Correct any sample; every change to a completed one is logged in **AuditLog**. Check **Needs Attention** on the home screen. |
| Owner | Everything above, plus **Manage Users**: add people, set their level and sections, give admins and owners codes, and remove tablets. |

**Don't** clear the browser data or uninstall the app while the badge shows
changes waiting to upload.

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

**Turn on the weekly backup once** (2 min, on a computer): open **Hop Farm Data**,
choose **Hop Farm → Turn on weekly backup** and allow the permissions Google asks
for (the backup needs to read your sheets and save files to your Drive). A first
backup is made straight away.

From then on, every Sunday at about 2am, an Excel (`.xlsx`) copy of **Hop Farm
Data**, **Users & Setup** and **Plant Health** is saved to the Drive folder
**Hop Farm Backups**, named with the date. The last 12 weeks are kept; older
copies go to the Drive bin (recoverable for 30 days). **Hop Farm → Back up now**
makes an extra copy any time, for example before a big change. **Turn off weekly
backup** stops it and keeps the copies already made.

To restore, open the backup in Excel, or upload it to Drive and open it with
Google Sheets, then copy back the rows you need.

Google also keeps each sheet's version history (**File → Version history**).
Photos are in the Drive folder **Hop Farm Photos**.

Set up the weekly backup in the **live** Hop Farm Data only. The TEST copy
doesn't need one.

## 9. Needs Attention (admins and owners)

The **Needs Attention** button on the home screen shows how many things need a
look. It turns amber when there are any. Tap it to see them, most urgent first:

- **This tablet: uploads refused** — changes the server would not accept. Open
  **Sync** to see why.
- **Backup** — red flag if the weekly backup is off, failed, or hasn't run for
  more than 8 days.
- **Fix these** — wrong or missing data, e.g. a leaf number entered twice from two
  tablets, a blank count, or a sample marked complete with no leaves.
- **Check these** — e.g. a bag waiting more than 3 days for analysis, an analysis
  started but not finished for a week, or a bag number used twice in a season.
- **For information** — e.g. samples finished below target, with the reason given.
  These don't count towards the number on the button.

Tap an item to open its sample. The check needs internet. Offline, the screen
shows the last result. **Check again** re-runs it. It's the same check as
**Hop Farm → Run data quality report** in the sheet.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Username or access code not recognised" | Check the Users row: `Username` spelling, `Active` = TRUE, and the code (no spaces). |
| "Two people share the username" | Give each person a different `Username`. They can still sign in with their email meanwhile. |
| "Could not reach the server" when online | Check the server address ends in `/exec`, and that the deployment's access is set to *Anyone*. |
| A change shows "need attention" on the Sync screen | The server refused it, for example because the sample was completed on another device. The message says why. Fix the cause (an admin can **Reopen analysis**) and press **Sync now**, or discard that change. |
| Script changes have no effect | You need a **new version** of the existing deployment (see step 3). |
| Tablet shows old blocks | Open the app on Wi-Fi and wait for **All synced**. |
