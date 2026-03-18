-- ═══════════════════════════════════════════════════
-- Migration v2: Metadata columns + exclusion sync
-- Run this in Supabase SQL Editor
--
-- NOTE: The collector's EXCLUDE_POOLS in index.js is the
-- single source of truth. This migration just ensures the
-- DB columns exist. The collector marks pools inactive at
-- runtime from EXCLUDE_POOLS automatically.
-- ═══════════════════════════════════════════════════

-- Add metadata columns to events (if not exist)
DO $$ BEGIN ALTER TABLE events ADD COLUMN ur_rate NUMERIC(8,4);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE events ADD COLUMN price INTEGER;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE events ADD COLUMN ur_item_count INTEGER DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Add recovery_price to items (if not exist)
DO $$ BEGIN ALTER TABLE items ADD COLUMN recovery_price NUMERIC(12,2);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Ensure items table exists
CREATE TABLE IF NOT EXISTS items (
  id                BIGSERIAL PRIMARY KEY,
  reward_pool_id    INTEGER NOT NULL REFERENCES events(reward_pool_id),
  reward_item_id    INTEGER NOT NULL,
  reward_item_name  TEXT,
  reward_item_type  TEXT,
  image_url         TEXT,
  recovery_price    NUMERIC(12,2),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(reward_pool_id, reward_item_id)
);

-- Mark excluded events inactive
-- (Matches EXCLUDE_POOLS in collector/index.js — update both together)
UPDATE events SET is_active = false
WHERE reward_pool_id IN (922, 974, 735, 427, 481, 684, 702, 722, 744, 800, 950);

-- Views
CREATE OR REPLACE VIEW ur_item_frequency AS
SELECT 
  w.reward_pool_id, w.reward_item_id, w.reward_item_name,
  COUNT(*) as win_count,
  MAX(w.num_sort) as last_won_at,
  MAX(w.create_time) as last_won_time
FROM win_records w WHERE w.reward_item_type = 'UR'
GROUP BY w.reward_pool_id, w.reward_item_id, w.reward_item_name
ORDER BY w.reward_pool_id, win_count DESC;

CREATE OR REPLACE VIEW ur_wins_with_gaps AS
SELECT 
  wr.*,
  LAG(wr.num_sort) OVER (PARTITION BY wr.reward_pool_id ORDER BY wr.num_sort) AS prev_num_sort,
  wr.num_sort - LAG(wr.num_sort) OVER (PARTITION BY wr.reward_pool_id ORDER BY wr.num_sort) AS gap
FROM win_records wr WHERE wr.reward_item_type = 'UR'
ORDER BY wr.reward_pool_id, wr.num_sort;
