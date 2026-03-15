// ═══════════════════════════════════════════════════
// KUJIMAN INFINITE CHALLENGE — Data Collector v4
// - Auto-discovers ALL events
// - Fetches from BOTH item_speed AND detail API
// - Saves UR item lists per event
// - Excludes specified events
// ═══════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const API_BASE = process.env.API_BASE || "https://api.kujiman.com/api_mini_apps/reward";

// Events to SKIP (too fast, ended, or unreliable)
const EXCLUDE_POOLS = new Set([922, 974, 735]);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function unixNow() { return Math.floor(Date.now() / 1000); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function tryParseTime(timeStr) {
  if (!timeStr) return null;
  try {
    const d = new Date(timeStr.replace(" ", "T") + "+09:00");
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch { return null; }
}

// ─── API FETCHERS ───

async function fetchAllEvents() {
  const url = `${API_BASE}/reward_pool_infinite?order_type=3&infinite_type_id=0&sort=0&time=${unixNow()}&os=4&client_env=h5`;
  console.log("[events] Fetching all events...");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Events API ${res.status}`);
  const json = await res.json();
  if (json.code !== 200) throw new Error(`Events API: ${json.msg}`);
  return json.data?.reward_pool_infinite || [];
}

async function fetchMowang(poolId) {
  const url = `${API_BASE}/reward_pool_infinite_mowang?reward_pool_id=${poolId}&append_rank=1&time=${unixNow()}&os=4&client_env=h5`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`mowang ${res.status}`);
  const json = await res.json();
  if (json.code !== 200) throw new Error(`mowang: ${json.msg}`);
  return json.data;
}

// item_speed with fake high ID → returns all visible UR records in list_second
async function fetchUrHistory(poolId) {
  const url = `${API_BASE}/reward_pool_infinite_item_speed?reward_pool_id=${poolId}&reward_cur_box_num=1&append_max_num_sort=1&append_item_init=1&append_record=1&record_level=2&list_first_id=9999999999&list_first_item_type=UR&time=${unixNow()}&os=4&client_env=h5`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`item_speed ${res.status}`);
  const json = await res.json();
  if (json.code !== 200) throw new Error(`item_speed: ${json.msg}`);
  return json.data;
}

// ─── RECORD TRANSFORMER ───
function toRecord(r, poolId) {
  return {
    id: r.id,
    reward_pool_id: poolId,
    num_sort: r.num_sort,
    create_time: r.create_time || null,
    create_time_parsed: tryParseTime(r.create_time),
    uid: r.uid ? String(r.uid) : null,
    nickname: r.nickname || null,
    avatar: r.avatar || null,
    reward_item_id: r.reward_item_id || null,
    reward_item_name: r.reward_item_name || null,
    reward_item_type: r.reward_item_type || "UR",
    source: "api",
    raw_record: r,
  };
}

// ─── COLLECT ONE EVENT ───
async function collectEvent(poolId, eventName) {
  console.log(`── ${eventName} (${poolId}) ──`);

  const { data: logEntry } = await supabase
    .from("collection_log")
    .insert({ reward_pool_id: poolId, status: "running" })
    .select("id").single();
  const logId = logEntry?.id;

  let totalFound = 0, totalNew = 0;

  try {
    // ─── 1. Mowang: get max_num_sort ───
    const mowangData = await fetchMowang(poolId);
    const curMowang = mowangData.cur_mowang || {};
    const maxNumSort = curMowang.max_num_sort || null;

    console.log(`  max: ${maxNumSort} | mowang: ${curMowang.nickname || "?"} #${curMowang.num_sort || "?"}`);

    await supabase.from("event_snapshots").insert({
      reward_pool_id: poolId,
      max_num_sort: maxNumSort,
      raw_meta: { cur_mowang: curMowang },
    });

    await sleep(300);

    // ─── 2. item_speed: get UR history + UR item list ───
    const speedData = await fetchUrHistory(poolId);

    // Extract UR item list
    const rewardItems = (speedData.reward_item || []).filter(i => i.reward_item_type === "UR");
    if (rewardItems.length > 0) {
      const itemRows = rewardItems.map(item => ({
        reward_pool_id: poolId,
        reward_item_id: item.reward_item_id,
        reward_item_name: item.reward_item_name || null,
        reward_item_type: "UR",
        image_url: item.reward_item_cover || null,
        updated_at: new Date().toISOString(),
      }));
      const { error: itemErr } = await supabase
        .from("items")
        .upsert(itemRows, { onConflict: "reward_pool_id,reward_item_id" });
      if (itemErr) console.error("  Items error:", itemErr.message);
      else console.log(`  Saved ${itemRows.length} UR items`);
    }

    // Extract UR rate from infinite_rate_arr
    const rateArr = speedData.infinite_rate_arr || {};
    const urRateEntry = Object.values(rateArr).find(r => r.reward_item_type === "UR");
    const urRate = urRateEntry ? urRateEntry.infinite_rate : null;

    // Also get max_num_sort from item_speed if available
    const speedMax = speedData.max_num_sort || null;
    const bestMax = maxNumSort || speedMax || 0;

    // Collect UR records from list_second
    const listSecond = speedData.append_record?.list_second || [];
    let allApiRecords = listSecond.filter(r => r.reward_item_type === "UR");

    // Also check list_first for any UR record not in list_second
    const listFirst = speedData.append_record?.list_first || [];
    const urFromFirst = (Array.isArray(listFirst) ? listFirst : [])
      .filter(r => r.reward_item_type === "UR");

    // Merge, dedup by id
    const allRaw = [...allApiRecords, ...urFromFirst];
    const seen = new Set();
    const deduped = [];
    for (const r of allRaw) {
      if (r.id && !seen.has(r.id)) { seen.add(r.id); deduped.push(r); }
    }

    console.log(`  UR from API: ${deduped.length} (list_second: ${allApiRecords.length}, list_first: ${urFromFirst.length})`);

    totalFound = deduped.length;

    if (deduped.length > 0) {
      const records = deduped.map(r => toRecord(r, poolId));
      const ids = records.map(r => r.id);
      const { data: existing } = await supabase.from("win_records").select("id").in("id", ids);
      const existingIdSet = new Set((existing || []).map(r => r.id));
      totalNew = records.filter(r => !existingIdSet.has(r.id)).length;

      const { error: upsertErr } = await supabase
        .from("win_records")
        .upsert(records, { onConflict: "id", ignoreDuplicates: true });

      if (upsertErr) throw upsertErr;

      if (totalNew > 0) {
        console.log(`  ✓ ${totalNew} NEW`);
        records.filter(r => !existingIdSet.has(r.id))
          .forEach(r => console.log(`    #${r.num_sort} ${r.nickname} — ${r.reward_item_name}`));
      } else {
        console.log(`  ✓ No new (${records.length} exist)`);
      }
    } else {
      console.log("  No UR records in API");
    }

    // Update event metadata with UR rate
    if (urRate) {
      await supabase.from("events").update({ updated_at: new Date().toISOString() })
        .eq("reward_pool_id", poolId);
    }

    if (logId) {
      await supabase.from("collection_log").update({
        finished_at: new Date().toISOString(),
        records_found: totalFound, new_records: totalNew, status: "success",
      }).eq("id", logId);
    }
  } catch (err) {
    console.error(`  ✗ ${err.message}`);
    if (logId) {
      await supabase.from("collection_log").update({
        finished_at: new Date().toISOString(), status: "error", error_message: err.message,
      }).eq("id", logId);
    }
  }
}

// ─── MAIN ───
async function main() {
  console.log("╔═══════════════════════════════════════════════╗");
  console.log("║  KUJIMAN COLLECTOR v4                         ║");
  console.log(`║  ${new Date().toISOString()}                  ║`);
  console.log("╚═══════════════════════════════════════════════╝\n");

  if (!SUPABASE_URL || !SUPABASE_KEY) { console.error("Missing env!"); process.exit(1); }

  // Discover events
  const allEvents = await fetchAllEvents();
  const active = allEvents.filter(e => e.status === 1 && !EXCLUDE_POOLS.has(e.id));
  console.log(`Found ${allEvents.length} total, ${active.length} active (${EXCLUDE_POOLS.size} excluded)\n`);

  // Register events
  const eventRows = active.map(e => ({
    reward_pool_id: e.id,
    event_name: e.reward_pool_name,
    is_active: true,
    updated_at: new Date().toISOString(),
  }));
  if (eventRows.length > 0) {
    await supabase.from("events").upsert(eventRows, { onConflict: "reward_pool_id" });
  }

  // Mark excluded events as inactive
  for (const id of EXCLUDE_POOLS) {
    await supabase.from("events").update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("reward_pool_id", id);
  }

  // Collect each
  let collected = 0;
  for (const event of active) {
    await collectEvent(event.id, event.reward_pool_name);
    collected++;
    await sleep(600);
  }

  // Summary
  const { count } = await supabase.from("win_records").select("*", { count: "exact", head: true });
  const { count: itemCount } = await supabase.from("items").select("*", { count: "exact", head: true });

  console.log(`\n╔═══════════════════════════════════════════════╗`);
  console.log(`║  DONE — ${collected} events`);
  console.log(`║  Win records: ${count || 0} | UR items: ${itemCount || 0}`);
  console.log(`╚═══════════════════════════════════════════════╝`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
