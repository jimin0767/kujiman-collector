# Kujiman Infinite Challenge — Auto Collector

Automatically collects UR win records from Kujiman H5 every 15 minutes and stores them in Supabase.

## Architecture

```
GitHub Actions (every 15 min)
    → Fetches Kujiman API (mowang + item_speed)
    → Deduplicates by record id
    → Stores in Supabase Postgres
```

## Setup Guide

### Step 1: Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign up (free)
2. Click **New Project**
3. Set a name (e.g. `kujiman`) and a database password — **save this password**
4. Choose the region closest to you (e.g. Northeast Asia)
5. Wait for the project to finish setting up

### Step 2: Create Database Tables

1. In your Supabase dashboard, go to **SQL Editor** (left sidebar)
2. Click **New Query**
3. Copy the entire contents of `supabase/schema.sql` and paste it
4. Click **Run**
5. You should see the tables created under **Table Editor** (left sidebar)

### Step 3: Get Supabase Credentials

1. In Supabase dashboard, go to **Settings** → **API**
2. Copy these two values:
   - **Project URL** (looks like `https://xxxxx.supabase.co`)
   - **anon / public** key (the long string under "Project API keys")

### Step 4: Find Your API Base URL

1. Open the Kujiman page in Chrome:
   `https://h5.kujiman.com/details/plus_goods/plus_goods?id=957&boxIndex=1`
2. Press **F12** → **Network** tab
3. Filter by `mowang`
4. Click on the request → look at the **Request URL**
5. The base URL is everything before `reward_pool_infinite_mowang`
   - For example, if the full URL is:
     `https://h5.kujiman.com/api/reward_pool_infinite_mowang?...`
     then your API_BASE is `https://h5.kujiman.com/api`
   - If the full URL is:
     `https://h5.kujiman.com/reward_pool_infinite_mowang?...`
     then your API_BASE is `https://h5.kujiman.com`

### Step 5: Push to GitHub

1. Create a **new private repository** on GitHub (e.g. `kujiman-collector`)
2. In PowerShell, navigate to this project folder and run:

```powershell
cd path\to\kujiman-collector
git init
git add .
git commit -m "Initial collector setup"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/kujiman-collector.git
git push -u origin main
```

### Step 6: Add GitHub Secrets

1. In your GitHub repo, go to **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret** and add these three:

| Name | Value |
|------|-------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_KEY` | Your Supabase anon/public key |
| `API_BASE` | The base URL from Step 4 |

### Step 7: Test It

1. In your GitHub repo, go to **Actions** tab
2. Click **Kujiman Collector** on the left
3. Click **Run workflow** → **Run workflow** (green button)
4. Watch the logs — you should see records being collected
5. Check your Supabase **Table Editor** → `win_records` to see the data

### Step 8: Done!

The collector now runs automatically every 15 minutes. Check the **Actions** tab anytime to see recent runs.

## Adding More Events

Edit `collector/index.js` and add entries to `TRACKED_EVENTS`:

```js
const TRACKED_EVENTS = [
  { reward_pool_id: 957, name: "브릭 월드 컬렉션" },
  { reward_pool_id: 123, name: "새로운 이벤트" },  // ← add like this
];
```

Then also insert the event in Supabase SQL Editor:
```sql
INSERT INTO events (reward_pool_id, event_name) 
VALUES (123, '새로운 이벤트')
ON CONFLICT DO NOTHING;
```

## Useful Queries

Check all UR wins with gaps:
```sql
SELECT * FROM ur_wins_with_gaps WHERE reward_pool_id = 957;
```

Latest collection runs:
```sql
SELECT * FROM collection_log ORDER BY started_at DESC LIMIT 20;
```

Current stats:
```sql
SELECT 
  reward_pool_id,
  COUNT(*) as total_records,
  COUNT(*) FILTER (WHERE reward_item_type = 'UR') as ur_wins,
  MIN(num_sort) as first_recorded,
  MAX(num_sort) as last_recorded
FROM win_records
GROUP BY reward_pool_id;
```

## Free Tier Limits

- **GitHub Actions**: 2,000 min/month → ~720 min used at 15-min intervals ✓
- **Supabase**: 500MB storage, 50,000 rows → way more than enough ✓
