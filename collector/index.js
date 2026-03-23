import { createClient } from "@supabase/supabase-js";

// ─── Config ───
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const API_BASE =
  process.env.API_BASE || "https://api.kujiman.com/api_mini_apps/reward";

// ─── Centralized exclusion list (SINGLE SOURCE OF TRUTH) ───
const EXCLUDE_POOLS = new Set([
  974, // 원피스 카드 컬렉션 시리즈 2 - 6% UR, too fast
  735, // 트레이너즈 아레나 Ⅱ - 3% UR, too fast
]);

const TYPE_ORDER = {
  UR: 1,
  SSR: 2,
  SR: 3,
  R: 4,
  N: 5,
};

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Helpers ───
function unixNow() {
  return Math.floor(Date.now() / 1000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tryParseTime(timeStr) {
  if (!timeStr) return null;
  try {
    const d = new Date(timeStr.replace(" ", "T") + "+09:00");
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;

  const cleaned = String(value)
    .replace(/,/g, "")
    .replace(/%/g, "")
    .trim();

  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function normalizeType(value) {
  if (!value) return "UNKNOWN";
  return String(value).trim().toUpperCase();
}

function typeSortOrder(type, fallback = 999) {
  return TYPE_ORDER[type] ?? fallback;
}

function buildRateSnapshot(rateRows) {
  const out = {};
  for (const row of rateRows) {
    out[row.reward_item_type] = row.infinite_rate;
  }
  return out;
}

function buildItemTypeCounts(itemRows) {
  const counts = {};
  for (const item of itemRows) {
    counts[item.reward_item_type] = (counts[item.reward_item_type] || 0) + 1;
  }
  return counts;
}

function formatRateSummary(rateRows) {
  return rateRows
    .map((r) => `${r.reward_item_type}=${r.infinite_rate ?? "?"}%`)
    .join(" | ");
}

function formatCountSummary(typeCounts) {
  return Object.entries(typeCounts)
    .sort((a, b) => typeSortOrder(a[0]) - typeSortOrder(b[0]))
    .map(([type, count]) => `${type}:${count}`)
    .join(" | ");
}

// ─── API Fetchers ───
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

async function fetchItemSpeed(poolId, listFirstItemType = "UR") {
  const url =
    `${API_BASE}/reward_pool_infinite_item_speed` +
    `?reward_pool_id=${poolId}` +
    `&reward_cur_box_num=1` +
    `&append_max_num_sort=1` +
    `&append_item_init=1` +
    `&append_record=1` +
    `&record_level=2` +
    `&list_first_id=9999999999` +
    `&list_first_item_type=${encodeURIComponent(listFirstItemType)}` +
    `&time=${unixNow()}` +
    `&os=4` +
    `&client_env=h5`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`item_speed ${res.status}`);

  const json = await res.json();
  if (json.code !== 200) throw new Error(`item_speed: ${json.msg}`);

  return json.data;
}

async function fetchAllEventPageData(poolId) {
  // Primary UR call:
  // - keeps UR records
  // - often exposes the full rarity section list
  const urData = await fetchItemSpeed(poolId, "UR");

  const rateRowsRaw = Array.isArray(urData.infinite_rate_arr)
    ? urData.infinite_rate_arr
    : Object.values(urData.infinite_rate_arr || {});

  const discoveredTypes = [
    ...new Set(
      rateRowsRaw
        .map((row) => normalizeType(row.reward_item_type))
        .filter(Boolean)
    ),
  ];

  const extraTypes = discoveredTypes.filter((t) => t !== "UR");

  const allItemResponses = [{ type: "UR", data: urData }];

  for (const rarityType of extraTypes) {
    try {
      const data = await fetchItemSpeed(poolId, rarityType);
      allItemResponses.push({ type: rarityType, data });
      await sleep(150);
    } catch (err) {
      console.warn(
        `  ! Failed to fetch ${rarityType} items for pool ${poolId}: ${err.message}`
      );
    }
  }

  const mergedItems = [];
  const seenItemIds = new Set();

  for (const entry of allItemResponses) {
    for (const item of entry.data.reward_item || []) {
      const itemId = item.reward_item_id;
      if (!itemId || seenItemIds.has(itemId)) continue;
      seenItemIds.add(itemId);
      mergedItems.push(item);
    }
  }

  return {
    primary: urData,                // use this for UR records
    allItems: mergedItems,          // use this for items table
    allRates: rateRowsRaw,          // use this for event_rate_sections
    discoveredTypes,
  };
}

// ─── Normalizers ───
function normalizeRateRows(rateArr, poolId) {
  const rawRows = Array.isArray(rateArr) ? rateArr : Object.values(rateArr || {});

  return rawRows.map((row, index) => {
    const rewardItemType = normalizeType(
      row.reward_item_type || row.item_type || row.type
    );

    const parsedRate =
      toNumber(row.infinite_rate) ??
      toNumber(row.rate) ??
      toNumber(row.reward_rate);

    return {
      reward_pool_id: poolId,
      reward_item_type: rewardItemType,
      section_label:
        row.reward_item_type_name ||
        row.reward_item_name ||
        row.title ||
        rewardItemType,
      infinite_rate: parsedRate,
      sort_order: toNumber(row.sort) ?? typeSortOrder(rewardItemType, index + 1),
      raw_rate: row,
      updated_at: new Date().toISOString(),
    };
  });
}

function normalizeItemRows(rawItems, poolId, rateByType) {
  const itemCounts = {};

  for (const item of rawItems || []) {
    const type = normalizeType(item.reward_item_type);
    itemCounts[type] = (itemCounts[type] || 0) + 1;
  }

  return (rawItems || []).map((item, index) => {
    const rewardItemType = normalizeType(item.reward_item_type);
    const linkedRate = rateByType.get(rewardItemType);

    return {
      reward_pool_id: poolId,
      reward_item_id: item.reward_item_id,
      reward_item_name: item.reward_item_name || null,
      reward_item_type: rewardItemType,
      image_url: item.reward_item_cover || null,
      recovery_price: toNumber(item.recovery_price),
      section_rate: linkedRate?.infinite_rate ?? null,
      section_item_count: itemCounts[rewardItemType] || 0,
      display_order: toNumber(item.sort) ?? index + 1,
      raw_item: item,
      updated_at: new Date().toISOString(),
    };
  });
}

// ─── Record Transformer ───
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
    reward_item_type: normalizeType(r.reward_item_type),
    source: "api",
    raw_record: r,
  };
}

async function collectUrWinRecords(poolId, speedData) {
  const listSecond = (speedData.append_record?.list_second || []).filter(
    (r) => normalizeType(r.reward_item_type) === "UR"
  );

  const listFirst = Array.isArray(speedData.append_record?.list_first)
    ? speedData.append_record.list_first
    : [];

  const urFromFirst = listFirst.filter(
    (r) => normalizeType(r.reward_item_type) === "UR"
  );

  const seen = new Set();
  const deduped = [];

  for (const r of [...listSecond, ...urFromFirst]) {
    if (r.id && !seen.has(r.id)) {
      seen.add(r.id);
      deduped.push(r);
    }
  }

  console.log(
    ` UR records: ${deduped.length} (second: ${listSecond.length}, first: ${urFromFirst.length})`
  );

  if (deduped.length === 0) {
    return { totalFound: 0, totalNew: 0 };
  }

  const records = deduped.map((r) => toRecord(r, poolId));
  const ids = records.map((r) => r.id);

  const { data: existing, error: existingErr } = await supabase
    .from("win_records")
    .select("id")
    .in("id", ids);

  if (existingErr) throw existingErr;

  const existingIdSet = new Set((existing || []).map((r) => r.id));
  const totalNew = records.filter((r) => !existingIdSet.has(r.id)).length;

  const { error: upsertErr } = await supabase
    .from("win_records")
    .upsert(records, { onConflict: "id", ignoreDuplicates: true });

  if (upsertErr) throw upsertErr;

  if (totalNew > 0) {
    console.log(` ✓ ${totalNew} NEW UR records`);
    records
      .filter((r) => !existingIdSet.has(r.id))
      .forEach((r) =>
        console.log(` #${r.num_sort} ${r.nickname} — ${r.reward_item_name}`)
      );
  } else {
    console.log(` ✓ No new UR records (${records.length} already exist)`);
  }

  return {
    totalFound: records.length,
    totalNew,
  };
}

// ─── Collect One Event ───
async function collectEvent(poolId, eventName, eventMeta) {
  console.log(`── ${eventName} (${poolId}) ──`);

  const { data: logEntry, error: logInsertErr } = await supabase
    .from("collection_log")
    .insert({ reward_pool_id: poolId, status: "running" })
    .select("id")
    .single();

  if (logInsertErr) {
    throw new Error(`collection_log insert failed: ${logInsertErr.message}`);
  }

  const logId = logEntry?.id;
  let totalFound = 0;
  let totalNew = 0;

  try {
    // 1) Mowang snapshot
    const mowangData = await fetchMowang(poolId);
    const curMowang = mowangData.cur_mowang || {};
    const maxNumSort = curMowang.max_num_sort || null;

    console.log(
      ` max: ${maxNumSort} | mowang: ${curMowang.nickname || "?"} #${curMowang.num_sort || "?"}`
    );

    await sleep(300);

    // 2) Event-page data: all sections + all items + append_record
    const eventPage = await fetchAllEventPageData(poolId);

    const rateRows = normalizeRateRows(eventPage.allRates, poolId);
    const rateByType = new Map(rateRows.map((row) => [row.reward_item_type, row]));

    const itemRows = normalizeItemRows(eventPage.allItems || [], poolId, rateByType);
    const itemTypeCounts = buildItemTypeCounts(itemRows);
    const rateSnapshot = buildRateSnapshot(rateRows);

    const speedData = eventPage.primary; // keep UR source for append_record

    // Save richer snapshot
    const snapshotPayload = {
      mowang: mowangData,
      item_speed: {
        max_num_sort: speedData.max_num_sort ?? null,
        infinite_rate_arr: speedData.infinite_rate_arr ?? null,
        reward_item: speedData.reward_item ?? null,
      },
    };

    const { error: snapshotErr } = await supabase.from("event_snapshots").insert({
      reward_pool_id: poolId,
      max_num_sort: maxNumSort,
      raw_meta: snapshotPayload,
    });

    if (snapshotErr) throw snapshotErr;

    // 3) Save all rarity section rates
    if (rateRows.length > 0) {
      const { error: rateErr } = await supabase
        .from("event_rate_sections")
        .upsert(rateRows, { onConflict: "reward_pool_id,reward_item_type" });

      if (rateErr) throw rateErr;

      console.log(` Saved ${rateRows.length} section-rate rows`);
      console.log(` Rates: ${formatRateSummary(rateRows)}`);
    } else {
      console.log(" No section-rate rows found");
    }

    // 4) Save all event-page items
    if (itemRows.length > 0) {
      const { error: itemErr } = await supabase
        .from("items")
        .upsert(itemRows, { onConflict: "reward_pool_id,reward_item_id" });

      if (itemErr) throw itemErr;

      console.log(` Saved ${itemRows.length} items`);
      console.log(` Item counts: ${formatCountSummary(itemTypeCounts)}`);
    } else {
      console.log(" No items found");
    }

    // 5) Update event metadata
    const price = toNumber(eventMeta?.reward_price_1);

    const eventUpdate = {
      updated_at: new Date().toISOString(),
      price: price,
      ur_rate: rateSnapshot.UR ?? null,
      ur_item_count: itemTypeCounts.UR || 0,
      rate_snapshot: rateSnapshot,
      item_type_counts: itemTypeCounts,
    };

    const { error: eventErr } = await supabase
      .from("events")
      .update(eventUpdate)
      .eq("reward_pool_id", poolId);

    if (eventErr) throw eventErr;

    console.log(
      ` Meta: price=₩${price ?? "?"}, UR=${rateSnapshot.UR ?? "?"}%, items=${itemRows.length}`
    );

    // 6) Collect UR win records only
    const recordResult = await collectUrWinRecords(poolId, speedData);
    totalFound = recordResult.totalFound;
    totalNew = recordResult.totalNew;

    if (logId) {
      const { error: logUpdateErr } = await supabase
        .from("collection_log")
        .update({
          finished_at: new Date().toISOString(),
          records_found: totalFound,
          new_records: totalNew,
          status: "success",
        })
        .eq("id", logId);

      if (logUpdateErr) {
        console.error(" collection_log update error:", logUpdateErr.message);
      }
    }
  } catch (err) {
    console.error(` ✗ ${err.message}`);

    if (logId) {
      await supabase
        .from("collection_log")
        .update({
          finished_at: new Date().toISOString(),
          status: "error",
          error_message: err.message,
        })
        .eq("id", logId);
    }
  }
}

// ─── Main ───
async function main() {
  console.log("╔═══════════════════════════════════════════════╗");
  console.log("║ KUJIMAN COLLECTOR v6                         ║");
  console.log(`║ ${new Date().toISOString()} ║`);
  console.log(`║ Excluded pools: ${EXCLUDE_POOLS.size}                       ║`);
  console.log("╚═══════════════════════════════════════════════╝\n");

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_KEY");
    process.exit(1);
  }

  const allEvents = await fetchAllEvents();
  const active = allEvents.filter((e) => e.status === 1 && !EXCLUDE_POOLS.has(e.id));

  console.log(
    `Found ${allEvents.length} total, ${active.length} active (${EXCLUDE_POOLS.size} excluded)\n`
  );

  const nowIso = new Date().toISOString();

  // Register active events
  // This also re-activates events that were previously excluded,
  // as long as they still exist in the live event API.
  const eventRows = active.map((e) => ({
    reward_pool_id: e.id,
    event_name: e.reward_pool_name,
    is_active: true,
    price: toNumber(e.reward_price_1),
    updated_at: nowIso,
  }));

  if (eventRows.length > 0) {
    const { error: upsertEventsErr } = await supabase
      .from("events")
      .upsert(eventRows, { onConflict: "reward_pool_id" });

    if (upsertEventsErr) throw upsertEventsErr;
  }

  // Mark excluded pools inactive
  if (EXCLUDE_POOLS.size > 0) {
    const { error: excludeErr } = await supabase
      .from("events")
      .update({ is_active: false, updated_at: nowIso })
      .in("reward_pool_id", [...EXCLUDE_POOLS]);

    if (excludeErr) throw excludeErr;
  }

  // Mark ended events inactive (not in API response anymore)
  // Data remains in DB; only visibility/active status changes.
  const allApiIds = new Set(allEvents.map((e) => e.id));

  const { data: dbEvents, error: dbEventsErr } = await supabase
    .from("events")
    .select("reward_pool_id")
    .eq("is_active", true);

  if (dbEventsErr) throw dbEventsErr;

  const endedIds = (dbEvents || [])
    .map((e) => e.reward_pool_id)
    .filter((id) => !allApiIds.has(id) && !EXCLUDE_POOLS.has(id));

  if (endedIds.length > 0) {
    const { error: endedErr } = await supabase
      .from("events")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .in("reward_pool_id", endedIds);

    if (endedErr) throw endedErr;

    console.log(`Marked ${endedIds.length} ended events inactive: ${endedIds.join(", ")}`);
  }

  // Collect each active event
  let collected = 0;
  for (const event of active) {
    await collectEvent(event.id, event.reward_pool_name, event);
    collected++;
    await sleep(600);
  }

  const { count: recordCount } = await supabase
    .from("win_records")
    .select("*", { count: "exact", head: true });

  const { count: itemCount } = await supabase
    .from("items")
    .select("*", { count: "exact", head: true });

  const { count: sectionCount } = await supabase
    .from("event_rate_sections")
    .select("*", { count: "exact", head: true });

  console.log(`\n╔═══════════════════════════════════════════════╗`);
  console.log(`║ DONE — ${collected} events collected`);
  console.log(
    `║ UR win records: ${recordCount || 0} | Items: ${itemCount || 0} | Section rates: ${sectionCount || 0}`
  );
  console.log(`╚═══════════════════════════════════════════════╝`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});