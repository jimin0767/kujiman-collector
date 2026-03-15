-- ═══════════════════════════════════════════════════
-- KUJIMAN INFINITE CHALLENGE — Database Schema
-- Run this in Supabase SQL Editor (one time setup)
-- ═══════════════════════════════════════════════════

-- 1. EVENTS: Tracked events/pools
CREATE TABLE IF NOT EXISTS events (
  reward_pool_id  INTEGER PRIMARY KEY,
  event_name      TEXT NOT NULL,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 2. EVENT_SNAPSHOTS: Periodic state of each event
CREATE TABLE IF NOT EXISTS event_snapshots (
  id              BIGSERIAL PRIMARY KEY,
  reward_pool_id  INTEGER NOT NULL REFERENCES events(reward_pool_id),
  max_num_sort    INTEGER,                -- current max sales number
  collected_at    TIMESTAMPTZ DEFAULT NOW(),
  raw_meta        JSONB                   -- full mowang response (optional, for debugging)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_pool_time 
  ON event_snapshots(reward_pool_id, collected_at DESC);

-- 3. ITEMS: Reward items per event
CREATE TABLE IF NOT EXISTS items (
  id                BIGSERIAL PRIMARY KEY,
  reward_pool_id    INTEGER NOT NULL REFERENCES events(reward_pool_id),
  reward_item_id    INTEGER NOT NULL,
  reward_item_name  TEXT,
  reward_item_type  TEXT,                  -- UR, SSR, R, N
  image_url         TEXT,
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(reward_pool_id, reward_item_id)
);

-- 4. WIN_RECORDS: Individual win records (the core table)
CREATE TABLE IF NOT EXISTS win_records (
  id                BIGINT PRIMARY KEY,    -- kujiman record id (natural key, dedup)
  reward_pool_id    INTEGER NOT NULL REFERENCES events(reward_pool_id),
  num_sort          INTEGER NOT NULL,      -- draw/sales number position
  create_time       TEXT,                  -- original timestamp string from API
  create_time_parsed TIMESTAMPTZ,          -- parsed version for querying
  uid               TEXT,                  -- user internal id
  nickname          TEXT,
  avatar            TEXT,
  reward_item_id    INTEGER,
  reward_item_name  TEXT,
  reward_item_type  TEXT,                  -- UR, SSR, R, N
  source            TEXT DEFAULT 'api',    -- 'api' or 'manual'
  collected_at      TIMESTAMPTZ DEFAULT NOW(),
  raw_record        JSONB                  -- full original record for safety
);

CREATE INDEX IF NOT EXISTS idx_records_pool_type_numsort 
  ON win_records(reward_pool_id, reward_item_type, num_sort DESC);

CREATE INDEX IF NOT EXISTS idx_records_pool_numsort 
  ON win_records(reward_pool_id, num_sort DESC);

CREATE INDEX IF NOT EXISTS idx_records_type 
  ON win_records(reward_item_type);

-- 5. COLLECTION_LOG: Track each collection run
CREATE TABLE IF NOT EXISTS collection_log (
  id              BIGSERIAL PRIMARY KEY,
  reward_pool_id  INTEGER NOT NULL REFERENCES events(reward_pool_id),
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  records_found   INTEGER DEFAULT 0,
  new_records     INTEGER DEFAULT 0,
  status          TEXT DEFAULT 'running',  -- running, success, error
  error_message   TEXT
);

CREATE INDEX IF NOT EXISTS idx_log_pool_time 
  ON collection_log(reward_pool_id, started_at DESC);

-- 6. Insert the first event: Brick World Collection
INSERT INTO events (reward_pool_id, event_name) 
VALUES (957, '브릭 월드 컬렉션')
ON CONFLICT (reward_pool_id) DO NOTHING;

-- ═══════════════════════════════════════════════════
-- HELPER VIEW: UR wins with gaps calculated
-- ═══════════════════════════════════════════════════
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
