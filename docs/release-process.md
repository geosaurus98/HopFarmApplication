# Live and Test: how changes reach the workers

The workers use the **live** app. New features and fixes are built and tried in
a separate **test** copy first, with its own data, so testing never gets in the
way of the season's work.

| | **Live** (workers) | **Test** (development) |
|---|---|---|
| Code | `main` branch | development branch (currently `claude/gallant-davinci-z71yj9`) |
| App address | https://peppy-pie-7f7463.netlify.app | the Netlify branch address, e.g. `https://claude-gallant-davinci-z71yj9--peppy-pie-7f7463.netlify.app` |
| Server (Apps Script) | the script in **Hop Farm Data** | the script in **TEST Hop Farm Data** |
| Sheets | Hop Farm Data, Users & Setup, Plant Health | TEST copies of the same three |
| Looks like | normal | orange **TEST VERSION** bar on every screen |

Built-in safeguards:

- **Default server.** The app decides which server to fill in from the address it
  was opened from. The live address gets the live server. Every other address
  gets the test server (`app/js/config.js`), never the live one.
- **Red warnings.** A test app signed in to the live server shows a red warning,
  and so does the live app signed in to a test server.
- **Separate tablet storage.** Each address keeps its own storage on the
  tablet, so test records can't end up in the live app.
- **A test script only uses test sheets.** `Hop Farm → Set up as TEST copy…`
  links the test script to the TEST sheets and refuses the live ones.

## One-off setup (about 20 minutes)

### 1. Test copies of the sheets

In Google Drive, make a copy of each of the three sheets (**File → Make a copy**),
using the same Google account. Name them:

- **TEST Hop Farm Data**
- **TEST Users & Setup**
- **TEST Plant Health**

Copying Hop Farm Data also copies its Apps Script. In the copy of Users & Setup
you can change people's access codes, so the test codes differ from the real ones.

### 2. Make the copied script a test server

1. Open **TEST Hop Farm Data** and reload it.
2. Choose **Hop Farm → Set up as TEST copy…** and paste the addresses of
   **TEST Users & Setup** and **TEST Plant Health** when asked.
3. Check with **Hop Farm → Show which sheets this script uses**. It should say
   *TEST server* and list only the TEST sheets.
4. **Extensions → Apps Script → Deploy → New deployment → Web app**. Set
   *Execute as: Me* and *Who has access: Anyone*. Copy the `/exec` address. This
   is the **test server address**; send it to me so it becomes the test app's
   default.

Also run **Show which sheets this script uses** in the live **Hop Farm Data**.
It should say *LIVE server*.

### 3. Netlify

In the Netlify site:

1. **Site configuration → Build & deploy → Branches and deploy contexts →
   Configure**.
2. Set **Production branch** to **`main`**. This is the workers' app.
3. Under **Branch deploys**, choose *Let me add individual branches* and add the
   development branch. Netlify then publishes it at its own address, shown
   under **Deploys**.

## Releasing a change to the workers

1. **Build:** changes are made and pushed to the development branch. Netlify
   updates the test address automatically.
2. **Server code (if it changed):** paste the new `Setup.gs` / `Api.gs` into the
   **TEST** Apps Script, save, and publish a new version of the test deployment
   (**Deploy → Manage deployments → ✎ → New version**).
3. **Try it** on the test address with test data, on a tablet, including offline.
4. **Release:**
   - Merge the development branch into `main`. Netlify updates the workers' app
     within a minute, and tablets show the **"new version available"** bar.
   - If the server code changed, also paste it into the **live** Apps Script,
     save, and publish a new version of the live deployment. Do this at the
     same time as the merge, ideally outside working hours.
5. **If something goes wrong:** in Netlify, **Deploys → pick the previous
   production deploy → Publish deploy** puts the old app back immediately. For
   Apps Script, **Deploy → Manage deployments → ✎ → Version** lets you pick the
   previous version.

Releases are safe for anything waiting on tablets. Unsent records are kept on
each device through app updates and upload when it next syncs.

## Rules of thumb

- Never test with the live app or the live sheets.
- Never paste test-only changes into the live Apps Script before the matching
  app release.
- If a change adds new sheet columns, run **Hop Farm → Repair / extend workbook
  structure** in the TEST sheet when testing, and in the live sheet when releasing.
