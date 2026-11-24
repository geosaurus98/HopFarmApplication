# Moving to another Google account

How to move the sheets and server from a personal Google account to a work
account. Workers don't sign in with Google, so nothing changes for them. Their
names, codes and set-up tablets move with the Users & Setup sheet.

What moves: the six sheets (live and TEST copies of Hop Farm Data, Users & Setup
and Plant Health) and the two Apps Script servers.
What doesn't: Netlify and GitHub are separate accounts and stay as they are.

Google doesn't let you hand a sheet from a personal account to a work account,
so each sheet is **copied** into the work account. A copy of Hop Farm Data comes
with its script, but **not** its settings, its web app deployment or its weekly
backup. The steps below set those up again.

## A. Before you start (10 min, any time)

1. **Check the work account can publish the server.** Signed in as the work
   account, create a blank Google Sheet, then **Extensions → Apps Script →
   Deploy → New deployment → ⚙ Web app**. Open **Who has access**:
   - If **Anyone** is in the list, you're fine. Cancel and delete the blank sheet.
   - If it only offers *Anyone within [your company]*, **stop**. The tablets
     couldn't reach the server. Ask whoever manages the company's Google account
     to allow web apps to be shared with *Anyone*, or tell me and we'll look at
     other options.
2. **Share with the work account.** Signed in as the personal account, share
   these with the work account as **Editor**: the six sheets, and the Drive
   folders **Hop Farm Photos** and **Hop Farm Backups**.

## B. Practise on TEST first (30 min)

Signed in as the **work** account:

1. Open each of the three TEST sheets and choose **File → Make a copy**. Give each
   copy the same name without "Copy of", e.g. **TEST Hop Farm Data**.
2. Open the new **TEST Hop Farm Data**, then **Extensions → Apps Script**. Replace
   `Setup.gs` and `Api.gs` with the latest versions from GitHub (`develop`
   branch) and save. Reload the sheet.
3. **Hop Farm → Set up as TEST copy…** and paste the addresses of the new TEST
   Users & Setup and TEST Plant Health copies. Check with **Show which sheets
   this script uses**. It should say *TEST server* and list the new copies.
4. **Deploy → New deployment → Web app**, *Execute as: Me*, *Who has access:
   Anyone*. Allow the permissions Google asks for.
5. Send me the new `/exec` address. I'll update the test app so test tablets
   move to it by themselves, without being set up again.
6. Try the test app: pick a name, save a sample, sync, open Needs Attention.

## C. Move the live sheets (about 30 min, outside working hours)

1. **Everyone syncs.** Check each tablet shows **All synced**.
2. **Pause the old server.** In the old (personal) live **Hop Farm Data**:
   **Extensions → Apps Script → Deploy → Manage deployments → ✎**, set **Who has
   access** to **Only myself**, then **Deploy**. From now on tablets keep new records safely on the tablet until the new
   server is ready. Nothing can be written to the old sheets, so nothing gets
   left behind.
3. As the **work** account, copy the three live sheets (**File → Make a copy**).
   Name them **Hop Farm Data**, **Hop Farm - Users & Setup** and
   **Hop Farm - Plant Health**.
4. In the new **Hop Farm Data**: **Extensions → Apps Script**. Replace `Setup.gs`
   and `Api.gs` with the latest versions and save. Reload the sheet.
5. **Hop Farm → Link copied sheets (moving Google account)…** and paste the
   addresses of the new Users & Setup and Plant Health copies. It checks you
   haven't picked an old or TEST sheet. **Show which sheets this script uses**
   should say *LIVE server* and list only the new copies.
6. **Deploy → New deployment → Web app**, *Execute as: Me*, *Who has access:
   Anyone*. Send me the `/exec` address.
7. I update the app. You then merge `develop` into `main`
   (see [release-process.md](release-process.md)). Tablets show the
   **new version** bar. After updating they use the new server and upload
   anything they kept. Workers can still pick their names; no tablet needs
   setting up again.
8. **Hop Farm → Turn on weekly backup** in the new Hop Farm Data. Backups and
   new photos now go to the work account's Drive.
9. **Check:** on a tablet, pick a name, sync, and open **Needs Attention** as an
   admin.

## D. Afterwards

- In the old personal **Hop Farm Data**, choose **Hop Farm → Turn off weekly
  backup**.
- Keep the old sheets for a month or so as a fallback, then delete them.
- **Old photos** stay in the personal account's **Hop Farm Photos** folder. The
  photo links in the sheets keep working for anyone the folder is shared with,
  as long as the personal account and folder exist. To keep them for good, copy
  the folder into the work account's Drive before closing the personal account.
- After a week or two with no problems, archive the old deployment
  (**Manage deployments → Archive**).
- If anything goes wrong in step C, set the old deployment back to **Anyone**
  and tell me. Tablets carry on with the old server until it's sorted.
