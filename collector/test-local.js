// ═══════════════════════════════════════════════════
// LOCAL TEST v3 — With auto event discovery
//
// Usage:
//   cd collector
//   node test-local.js          (API-only test)
//   node test-local.js --full   (full collection run)
// ═══════════════════════════════════════════════════

// ▼▼▼ FILL THESE IN ▼▼▼
const SUPABASE_URL = "YOUR_SUPABASE_URL_HERE";
const SUPABASE_KEY = "YOUR_SUPABASE_ANON_KEY_HERE";
const API_BASE = "https://api.kujiman.com/api_mini_apps/reward";
// ▲▲▲ FILL THESE IN ▲▲▲

import { createClient } from "@supabase/supabase-js";

const fullRun = process.argv.includes("--full");

async function test() {
  const ts = Math.floor(Date.now() / 1000);

  // ─── Test 1: Event Discovery API ───
  console.log("═══ Test 1: Event Discovery API ═══");
  let events = [];
  try {
    const url = `${API_BASE}/reward_pool_infinite?order_type=3&infinite_type_id=0&sort=0&time=${ts}&os=4&client_env=h5`;
    const res = await fetch(url);
    const json = await res.json();

    if (json.code === 200) {
      events = json.data?.reward_pool_infinite || [];
      const active = events.filter((e) => e.status === 1);
      console.log(`✓ Found ${events.length} total events (${active.length} active)\n`);
      active.forEach((e, i) => {
        console.log(`  ${i + 1}. [${e.id}] ${e.reward_pool_name} — ₩${e.reward_price_1}/draw`);
      });
    } else {
      console.log(`✗ API returned code ${json.code}: ${json.msg}`);
    }
  } catch (err) {
    console.error("✗ Error:", err.message);
  }

  // ─── Test 2: Mowang API (first event) ───
  console.log("\n═══ Test 2: Mowang API (first event) ═══");
  const testPool = events.length > 0 ? events[0] : { id: 957, reward_pool_name: "브릭 월드 컬렉션" };
  try {
    const url = `${API_BASE}/reward_pool_infinite_mowang?reward_pool_id=${testPool.id}&append_rank=1&time=${ts}&os=4&client_env=h5`;
    const res = await fetch(url);
    const json = await res.json();

    if (json.code === 200) {
      const cur = json.data.cur_mowang;
      console.log(`✓ ${testPool.reward_pool_name}`);
      console.log(`  max_num_sort: ${cur.max_num_sort}`);
      console.log(`  Mowang: ${cur.nickname} at #${cur.num_sort}`);
    }
  } catch (err) {
    console.error("✗ Error:", err.message);
  }

  // ─── Test 3: UR History (first event) ───
  console.log("\n═══ Test 3: UR History (first event) ═══");
  try {
    const url = `${API_BASE}/reward_pool_infinite_item_speed?reward_pool_id=${testPool.id}&reward_cur_box_num=1&append_record=1&record_level=2&list_first_id=9999999999&list_first_item_type=UR&time=${ts}&os=4&client_env=h5`;
    const res = await fetch(url);
    const json = await res.json();

    if (json.code === 200) {
      const records = json.data.append_record?.list_second || [];
      console.log(`✓ ${records.length} UR records for ${testPool.reward_pool_name}`);
      records.slice(0, 3).forEach((r, i) => {
        console.log(`  ${i + 1}. #${r.num_sort} — ${r.nickname} — ${r.reward_item_name}`);
      });
      if (records.length > 3) console.log(`  ... and ${records.length - 3} more`);
    }
  } catch (err) {
    console.error("✗ Error:", err.message);
  }

  // ─── Test 4: Supabase ───
  console.log("\n═══ Test 4: Supabase Connection ═══");
  if (SUPABASE_URL.includes("YOUR_")) {
    console.log("⚠ Skipped — fill in SUPABASE_URL and SUPABASE_KEY");
  } else {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
      const { data, error } = await supabase.from("events").select("*");
      if (error) throw error;
      console.log(`✓ Connected — ${data.length} events in DB`);

      const { count } = await supabase
        .from("win_records")
        .select("*", { count: "exact", head: true });
      console.log(`  Win records in DB: ${count || 0}`);
    } catch (err) {
      console.error("✗ Error:", err.message);
    }
  }

  // ─── Test 5: Full collection (optional) ───
  if (fullRun) {
    console.log("\n═══ Test 5: Full Collection Run ═══");
    if (SUPABASE_URL.includes("YOUR_")) {
      console.log("⚠ Skipped — need Supabase credentials");
      return;
    }
    process.env.SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_KEY = SUPABASE_KEY;
    process.env.API_BASE = API_BASE;
    await import("./index.js");
  } else {
    console.log("\n─── Run with --full flag to do a full collection: node test-local.js --full ───");
  }
}

test().catch(console.error);
