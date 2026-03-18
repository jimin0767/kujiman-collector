// ═══════════════════════════════════════════════════
// LOCAL TEST v5 — Matches production API params exactly
//
// Usage:
//   cd collector
//   node test-local.js          (API-only test)
//   node test-local.js --full   (full collection run)
// ═══════════════════════════════════════════════════

// ▼▼▼ FILL THESE IN ▼▼▼
const SUPABASE_URL = "https://nfvysrkghikjtefrxivr.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5mdnlzcmtnaGlranRlZnJ4aXZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyOTg2MzYsImV4cCI6MjA4ODg3NDYzNn0.BAtN6CUIz4-0gpMjNMnMiX85cmt4-CDhRwTgR-xHRSo";
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

  // ─── Test 2: Mowang API (first active event) ───
  console.log("\n═══ Test 2: Mowang API ═══");
  const testPool = events.find(e => e.status === 1) || { id: 957, reward_pool_name: "fallback" };
  try {
    const url = `${API_BASE}/reward_pool_infinite_mowang?reward_pool_id=${testPool.id}&append_rank=1&time=${ts}&os=4&client_env=h5`;
    const res = await fetch(url);
    const json = await res.json();

    if (json.code === 200) {
      const cur = json.data.cur_mowang;
      console.log(`✓ ${testPool.reward_pool_name}`);
      console.log(`  max_num_sort: ${cur.max_num_sort}`);
      console.log(`  Mowang: ${cur.nickname} at #${cur.num_sort}`);
      console.log(`  Full response keys: ${Object.keys(json.data).join(", ")}`);
    }
  } catch (err) {
    console.error("✗ Error:", err.message);
  }

  // ─── Test 3: UR History — MATCHES PRODUCTION PARAMS ───
  console.log("\n═══ Test 3: UR History (production-aligned params) ═══");
  try {
    // This URL now matches fetchUrHistory() in index.js exactly
    const url = `${API_BASE}/reward_pool_infinite_item_speed?reward_pool_id=${testPool.id}&reward_cur_box_num=1&append_max_num_sort=1&append_item_init=1&append_record=1&record_level=2&list_first_id=9999999999&list_first_item_type=UR&time=${ts}&os=4&client_env=h5`;
    const res = await fetch(url);
    const json = await res.json();

    if (json.code === 200) {
      const data = json.data;

      // UR records
      const listSecond = data.append_record?.list_second || [];
      const listFirst = data.append_record?.list_first || [];
      const urSecond = listSecond.filter(r => r.reward_item_type === "UR");
      const urFirst = (Array.isArray(listFirst) ? listFirst : []).filter(r => r.reward_item_type === "UR");
      console.log(`✓ ${testPool.reward_pool_name}`);
      console.log(`  UR records: ${urSecond.length} (list_second) + ${urFirst.length} (list_first)`);
      urSecond.slice(0, 3).forEach((r, i) => {
        console.log(`  ${i + 1}. #${r.num_sort} — ${r.nickname} — ${r.reward_item_name}`);
      });
      if (urSecond.length > 3) console.log(`  ... and ${urSecond.length - 3} more`);

      // UR items
      const urItems = (data.reward_item || []).filter(i => i.reward_item_type === "UR");
      console.log(`  UR items: ${urItems.length}`);
      urItems.slice(0, 3).forEach((it, i) => {
        console.log(`    ${i + 1}. ${it.reward_item_name} — recovery: ${it.recovery_price}`);
      });

      // UR rate
      const rateArr = data.infinite_rate_arr || {};
      const urRateEntry = Object.values(rateArr).find(r => r.reward_item_type === "UR");
      console.log(`  UR rate: ${urRateEntry?.infinite_rate ?? "not found"}`);

      // max_num_sort from speed
      console.log(`  max_num_sort (speed): ${data.max_num_sort ?? "not in response"}`);
    }
  } catch (err) {
    console.error("✗ Error:", err.message);
  }

  // ─── Test 4: Supabase Connection ───
  console.log("\n═══ Test 4: Supabase Connection ═══");
  if (SUPABASE_URL.includes("YOUR_")) {
    console.log("⚠ Skipped — fill in SUPABASE_URL and SUPABASE_KEY");
  } else {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
      const { data, error } = await supabase.from("events").select("reward_pool_id,event_name,is_active,ur_rate,price,ur_item_count").eq("is_active", true);
      if (error) throw error;
      console.log(`✓ Connected — ${data.length} active events in DB`);
      data.slice(0, 5).forEach(e => {
        console.log(`  [${e.reward_pool_id}] ${e.event_name} — rate:${e.ur_rate ?? "?"} price:${e.price ?? "?"} items:${e.ur_item_count ?? "?"}`);
      });

      const { count } = await supabase.from("win_records").select("*", { count: "exact", head: true });
      const { count: itemCount } = await supabase.from("items").select("*", { count: "exact", head: true });
      console.log(`  Win records: ${count || 0} | UR items: ${itemCount || 0}`);
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
