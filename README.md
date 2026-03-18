# Kujiman Infinite Challenge — Auto Collector

Automatically discovers and collects UR win records from all active Kujiman Infinite Challenge events, storing them in Supabase.

## Architecture

```
GitHub Actions (every 10 min)
    → Auto-discovers all active events via API
    → Excludes configured pools (EXCLUDE_POOLS in index.js)
    → For each event:
        1. Fetches mowang → saves snapshot + max_num_sort
        2. Fetches item_speed → saves UR items, UR rate, win records
        3. Updates events table with ur_rate, price, ur_item_count
    → Deduplicates records by ID
    → Stores everything in Supabase Postgres
```

## What Gets Collected

| Table | Data | Frequency |
|-------|------|-----------|
| `events` | Event metadata, ur_rate, price, ur_item_count | Every run |
| `event_snapshots` | max_num_sort + full mowang response | Every run |
| `win_records` | All UR wins with gaps, nicknames, items | Every run (deduped) |
| `items` | UR item list per event with recovery_price | Every run (upserted) |
| `collection_log` | Run status, timing, record counts | Every run |

## Excluded Pools

The exclusion list lives in **one place only**: `EXCLUDE_POOLS` in `collector/index.js`. The collector automatically marks excluded pools as `is_active = false` in the database. Do NOT manually edit the DB or migration for exclusions — update `index.js` only.

Currently excluded: 922, 974, 735, 427, 481, 684, 702, 722, 744, 800, 950

## Setup Guide

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a free project
2. In **SQL Editor**, run `supabase/schema.sql` then `supabase/migration_v2.sql`
3. Go to **Settings → API** and copy your **Project URL** and **anon key**

### 2. Push to GitHub

```powershell
cd path\to\kujiman-collector
git init
git add .
git commit -m "Initial collector setup"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/kujiman-collector.git
git push -u origin main
```

### 3. Add GitHub Secrets

In your repo → **Settings → Secrets → Actions**, add:

| Name | Value |
|------|-------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_KEY` | Your Supabase anon key |
| `API_BASE` | `https://api.kujiman.com/api_mini_apps/reward` |

### 4. Test

- Go to **Actions** tab → **Kujiman Collector** → **Run workflow**
- Or locally: `cd collector && node test-local.js`
- Full local run: `node test-local.js --full`

### 5. Done

The collector runs automatically every 10 minutes. Events are auto-discovered — no manual configuration needed.

## Local Testing

```bash
cd collector
node test-local.js          # API + Supabase connectivity test
node test-local.js --full   # Full collection run locally
```

The test script uses the same API parameters as production to ensure identical response shapes.

## Useful Queries

```sql
-- UR wins with gaps
SELECT * FROM ur_wins_with_gaps WHERE reward_pool_id = 898;

-- Recent collection runs
SELECT * FROM collection_log ORDER BY started_at DESC LIMIT 20;

-- Event metadata check
SELECT reward_pool_id, event_name, ur_rate, price, ur_item_count, is_active
FROM events ORDER BY reward_pool_id;

-- UR item frequency per event
SELECT * FROM ur_item_frequency WHERE reward_pool_id = 898;
```

## Free Tier Limits

- **GitHub Actions**: 2,000 min/month → ~500 min used at hourly intervals ✓
- **Supabase**: 500MB storage, 50,000 rows → way more than enough ✓
