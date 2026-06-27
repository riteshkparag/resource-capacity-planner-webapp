# Resource Capacity Planner

A lightweight browser-based resource capacity planning app for teams, weeks, resources, tasks, priorities, daily effort, totals, and planning notes.

## Run Locally

From this folder:

```powershell
python -m http.server 5177 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:5177/
```

## Deploy Free With Netlify Drop

This app is static, so the quickest free deployment path is Netlify Drop.

1. Open `https://app.netlify.com/drop`.
2. Drag the deploy folder into the page.
3. Netlify will publish the app and give you a public URL.
4. You can rename the Netlify site later from Site settings.

No build command is needed.

## Deploy Free With GitHub Pages

1. Create a GitHub repository.
2. Upload `index.html`, `app.js`, `styles.css`, `supabase-config.js`, `supabase-schema.sql`, `netlify.toml`, and this `README.md`.
3. Go to repository Settings > Pages.
4. Choose `Deploy from a branch`.
5. Select the `main` branch and `/root`.
6. Save and wait for GitHub to publish the site URL.

## Connect Supabase

1. Create a free Supabase project.
2. Open SQL Editor in Supabase.
3. Paste and run everything from `supabase-schema.sql`.
4. Go to Project Settings > API.
5. Copy the Project URL and anon public key.
6. Open `supabase-config.js` and fill in:

```js
window.CAPACITY_PLANNER_SUPABASE = {
  url: "https://your-project-ref.supabase.co",
  anonKey: "your-anon-public-key",
  planId: "resource-capacity-planner",
};
```

Use the anon public key only. Never put the Supabase service role key in this browser app.

## Data Storage Note

The app stores a local browser backup using `localStorage`. When Supabase is configured:

- The app loads the shared plan from Supabase when opened.
- Changes are saved to Supabase after edits.
- Other open browsers receive realtime updates.
- If Supabase is not configured or unavailable, the app continues in local-only mode.

This simple setup uses last-write-wins conflict handling. If two users edit the exact same field at the same time, the most recent save will be the value kept in Supabase.
