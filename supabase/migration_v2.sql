-- ═══════════════════════════════════════════════════
-- Migration v2: Add UR rate tracking + ensure items table
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════

-- Add ur_rate column to events (if not exists)
DO $$ BEGIN
  ALTER TABLE events ADD COLUMN ur_rate NUMERIC(8,4);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE events ADD COLUMN price INTEGER;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE events ADD COLUMN ur_item_count INTEGER DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Ensure items table exists (should already from v1 schema)
CREATE TABLE IF NOT EXISTS items (
  id                BIGSERIAL PRIMARY KEY,
  reward_pool_id    INTEGER NOT NULL REFERENCES events(reward_pool_id),
  reward_item_id    INTEGER NOT NULL,
  reward_item_name  TEXT,
  reward_item_type  TEXT,
  image_url         TEXT,
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(reward_pool_id, reward_item_id)
);

-- Mark excluded events as inactive
UPDATE events SET is_active = false WHERE reward_pool_id IN (922, 974, 735);

-- Delete win records for excluded events (optional, saves space)
-- DELETE FROM win_records WHERE reward_pool_id IN (922, 974, 735);

-- View: UR item win frequency per event
CREATE OR REPLACE VIEW ur_item_frequency AS
SELECT 
  w.reward_pool_id,
  w.reward_item_id,
  w.reward_item_name,
  COUNT(*) as win_count,
  MAX(w.num_sort) as last_won_at,
  MAX(w.create_time) as last_won_time
FROM win_records w
WHERE w.reward_item_type = 'UR'
GROUP BY w.reward_pool_id, w.reward_item_id, w.reward_item_name
ORDER BY w.reward_pool_id, win_count DESC;

-- View: UR wins with gaps (updated)
CREATE OR REPLACE VIEW ur_wins_with_gaps AS
SELECT 
  wr.*,
  LAG(wr.num_sort) OVER (
    PARTITION BY wr.reward_pool_id 
    ORDER BY wr.num_sort
  ) AS prev_num_sort,
  wr.num_sort - LAG(wr.num_sort) OVER (
    PARTITION BY wr.reward_pool_id 
    ORDER BY wr.num_sort
  ) AS gap
FROM win_records wr
WHERE wr.reward_item_type = 'UR'
ORDER BY wr.reward_pool_id, wr.num_sort;
