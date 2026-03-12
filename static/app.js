/* Minimal read-only UI for Creality K2 Plus CFS via Moonraker */

const $ = (id) => document.getElementById(id);
const PRINTER_SPOOL_SLOT = "SP";

function slotTitle(slotId) {
  if (slotId === PRINTER_SPOOL_SLOT) return "Printer Spool Input";
  return `Box ${slotId[0]} · Slot ${slotId[1]}`;
}

function fmtTs(ts) {
  if (!ts) return "—";
  try {
    const d = new Date(ts * 1000);
    return d.toLocaleString();
  } catch {
    return "—";
  }
}

function badge(el, text, cls) {
  el.classList.remove("ok", "bad", "warn");
  if (cls) el.classList.add(cls);
  el.textContent = text;
}

function slotEl(slotId, label, meta, isActive, printerId) {
  const wrap = document.createElement("div");
  wrap.className = "slot" + (isActive ? " active" : "");
  wrap.dataset.slotid = slotId;

  const left = document.createElement("div");
  left.className = "slotLeft";

  const sw = document.createElement("div");
  sw.className = "swatch";
  sw.style.background = meta.color || "#2a3442";
  left.appendChild(sw);

  const txt = document.createElement("div");
  txt.className = "slotText";

  const nm = document.createElement("div");
  nm.className = "slotName";
  nm.textContent = label;
  txt.appendChild(nm);

  const sub = document.createElement("div");
  sub.className = "slotSub";
  // Line 2: brand + filament name if available, else material + color
  const brandName = [meta.manufacturer, meta.name].filter(Boolean).join(' ');
  if (brandName) {
    sub.textContent = brandName;
  } else {
    const parts = [];
    if (meta.material) parts.push(meta.material);
    if (meta.color) parts.push(meta.color.toUpperCase());
    sub.textContent = parts.length ? parts.join(" · ") : "—";
  }
  txt.appendChild(sub);

  // Line 3: material type + Spoolman link indicator (only shown when line 2 has brand/name info)
  const detailParts = [];
  if (brandName && meta.material) detailParts.push(meta.material);
  if (meta.spoolman_id) detailParts.push('SP #' + meta.spoolman_id);
  if (detailParts.length) {
    const detail = document.createElement("div");
    detail.className = "slotDetail";
    detail.textContent = detailParts.join(' · ');
    txt.appendChild(detail);
  }

  left.appendChild(txt);

  const right = document.createElement("div");
  right.className = "slotRight";
  const tag = document.createElement("div");
  tag.className = "tag" + (!meta.material ? " muted" : "");
  tag.textContent = meta.present === false ? 'empty' : (isActive ? 'active' : 'ready');
  right.appendChild(tag);

  if (meta.percent != null) {
    const pct = document.createElement("div");
    pct.className = "spoolPct";
    pct.textContent = meta.percent + "%";
    right.appendChild(pct);
  }

  wrap.appendChild(left);
  wrap.appendChild(right);

  wrap.addEventListener("click", (ev) => {
    ev.preventDefault();
    openSpoolModal(slotId, meta, printerId);
  });
  return wrap;
}

function fmtMm(mm) {
  const m = (mm || 0) / 1000.0;
  if (m >= 10) return m.toFixed(1) + " m";
  return m.toFixed(2) + " m";
}

function fmtG(g) {
  if (g == null) return "0 g";
  const gg = Number(g);
  if (Number.isNaN(gg)) return "0 g";
  if (gg >= 100) return gg.toFixed(0) + " g";
  if (gg >= 10) return gg.toFixed(1) + " g";
  return gg.toFixed(2) + " g";
}

function fmtUsedFromMm(mm) {
  const m = (mm || 0) / 1000.0;
  if (m >= 10) return m.toFixed(1) + " m";
  return m.toFixed(2) + " m";
}


async function postJson(url, payload) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(txt || `HTTP ${r.status}`);
  }
  return r.json();
}

// --- Spoolman integration ---
let spoolmanConfigured = false;

// --- Spool editor modal (local only) ---
let spoolModalOpen = false;
let spoolPrevPaused = null;
let spoolSlotId = null;
let spoolPrinterId = null;

function closeSpoolModal() {
  const m = $('spoolModal');
  if (m) m.style.display = 'none';
  spoolModalOpen = false;
  spoolSlotId = null;
  spoolPrinterId = null;
  if (spoolPrevPaused !== null) {
    refreshPaused = spoolPrevPaused;
    spoolPrevPaused = null;
    applyRefreshTimer();
  }
}

function openSpoolModal(slotId, meta, printerId) {
  // Only open if modal exists (older builds)
  const m = $('spoolModal');
  if (!m) return;
  spoolModalOpen = true;
  spoolSlotId = slotId;
  spoolPrinterId = printerId || null;

  // Pause auto-refresh while editing so nothing collapses
  if (spoolPrevPaused === null) spoolPrevPaused = refreshPaused;
  refreshPaused = true;
  applyRefreshTimer();

  const title = $('spoolTitle');
  const sub = $('spoolSub');
  if (title) title.textContent = slotTitle(slotId);
  if (sub) sub.textContent = `${meta.material || '—'} · ${(meta.color || '').toUpperCase() || '—'}`;

  // New roll input stays empty by default
  const startEl = $('spoolStart');
  if (startEl) startEl.value = '';

  // --- Spoolman section ---
  const smSec = $('spoolmanSection');
  if (smSec) {
    if (spoolmanConfigured) {
      smSec.style.display = '';
      const bdg = $('spoolmanBadge');
      const notLinked = $('spoolmanNotLinked');
      const linked = $('spoolmanLinked');
      const info = $('spoolmanInfo');
      const smId = meta.spoolman_id;
      if (smId) {
        if (bdg) { bdg.textContent = 'linked'; bdg.classList.remove('muted'); bdg.classList.add('ok'); }
        if (notLinked) notLinked.style.display = 'none';
        if (linked) linked.style.display = 'flex';
        if (info) {
          info.textContent = 'Loading spool data…';
          // Fetch live remaining from Spoolman
          fetch(`/api/ui/spoolman/spool_detail?slot=${encodeURIComponent(slotId)}&printer_id=${encodeURIComponent(printerId || '')}`, { cache: 'no-store' })
            .then(r => r.json())
            .then(data => {
              if (data.spool) {
                const fil = data.spool.filament || {};
                const vendor = (fil.vendor || {}).name || meta.manufacturer || meta.vendor || '';
                const name = fil.name || meta.name || '';
                const material = (fil.material || '').toUpperCase();
                const remaining = data.spool.remaining_weight != null ? fmtG(data.spool.remaining_weight) : '—';
                info.textContent = [vendor, name, material, remaining].filter(Boolean).join(' · ');
              } else {
                info.textContent = data.error ? 'Spoolman unreachable' : `Spool #${smId}`;
              }
            })
            .catch(() => {
              info.textContent = 'Spoolman unreachable';
            });
        }
      } else {
        if (bdg) { bdg.textContent = 'not linked'; bdg.classList.add('muted'); bdg.classList.remove('ok'); }
        if (notLinked) notLinked.style.display = 'flex';
        if (linked) linked.style.display = 'none';
        loadSpoolmanDropdown(slotId, printerId);
      }
    } else {
      smSec.style.display = 'none';
    }
  }

  m.style.display = 'block';
}

async function loadSpoolmanDropdown(slotId, printerId) {
  const list = $('spoolmanSelect');
  if (!list) return;
  list.innerHTML = '';
  const ph = document.createElement('div');
  ph.className = 'spoolmanListItem muted';
  ph.textContent = 'Loading spools…';
  list.appendChild(ph);

  try {
    const r = await fetch(`/api/ui/spoolman/spools?slot=${encodeURIComponent(slotId)}&printer_id=${encodeURIComponent(printerId || '')}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    const spools = data.spools || [];
    list.innerHTML = '';

    if (!spools.length) {
      const o = document.createElement('div');
      o.className = 'spoolmanListItem muted';
      o.textContent = 'No spools found';
      list.appendChild(o);
      return;
    }

    for (const sp of spools) {
      const item = document.createElement('div');
      item.className = 'spoolmanListItem';
      item.dataset.id = String(sp.id);

      const swatch = document.createElement('span');
      swatch.className = 'spoolmanListSwatch';
      const col = sp.color_hex ? (sp.color_hex.startsWith('#') ? sp.color_hex : '#' + sp.color_hex) : null;
      if (col) swatch.style.background = col;

      const label = document.createElement('span');
      const remaining = sp.remaining_weight != null ? fmtG(sp.remaining_weight) : '?';
      label.textContent = `#${sp.id} ${sp.vendor || ''} ${sp.filament_name || ''} · ${sp.material || ''} · ${remaining}`;

      item.appendChild(swatch);
      item.appendChild(label);
      item.addEventListener('click', () => {
        for (const el of list.querySelectorAll('.spoolmanListItem')) el.classList.remove('selected');
        item.classList.add('selected');
      });
      list.appendChild(item);
    }
  } catch (e) {
    list.innerHTML = '';
    const o = document.createElement('div');
    o.className = 'spoolmanListItem muted';
    o.textContent = `Spoolman error: ${e.message || String(e)}`;
    list.appendChild(o);
  }
}

function initSpoolModal() {
  const m = $('spoolModal');
  if (!m) return;
  const closeBtn = $('spoolClose');
  const back = $('spoolBackdrop');
  // IMPORTANT: stop event bubbling so a click does not "fall through" to the
  // underlying slot card and immediately re-open the modal.
  if (closeBtn) closeBtn.onclick = (ev) => {
    if (ev) { ev.preventDefault(); ev.stopPropagation(); }
    closeSpoolModal();
  };
  if (back) back.onclick = (ev) => {
    if (ev) { ev.preventDefault(); ev.stopPropagation(); }
    closeSpoolModal();
  };

  // Esc closes the modal
  document.addEventListener('keydown', (ev) => {
    if (!spoolModalOpen) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closeSpoolModal();
    }
  });

  const saveStart = $('spoolSaveStart');

  if (saveStart) {
    saveStart.onclick = async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!spoolSlotId || !spoolPrinterId) return;
      // Rollwechsel: new epoch + auto-unlink Spoolman
      await postJson('/api/ui/spool/set_start', { printer_id: spoolPrinterId, slot: spoolSlotId });
      closeSpoolModal();
      await tick();
    };
  }

  // --- Spoolman button handlers ---
  const smLink = $('spoolmanLink');
  const smUnlink = $('spoolmanUnlink');
  const smRefresh = $('spoolmanRefresh');

  if (smLink) {
    smLink.onclick = async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!spoolSlotId || !spoolPrinterId) return;
      const list = $('spoolmanSelect');
      const selected = list && list.querySelector('.spoolmanListItem.selected');
      const id = selected ? Number(selected.dataset.id) : 0;
      if (!id) return;
      await postJson('/api/ui/spoolman/link', { printer_id: spoolPrinterId, slot: spoolSlotId, spoolman_id: id });
      closeSpoolModal();
      await tick();
    };
  }

  if (smUnlink) {
    smUnlink.onclick = async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!spoolSlotId || !spoolPrinterId) return;
      await postJson('/api/ui/spoolman/unlink', { printer_id: spoolPrinterId, slot: spoolSlotId });
      closeSpoolModal();
      await tick();
    };
  }

  if (smRefresh) {
    smRefresh.onclick = async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!spoolSlotId || !spoolPrinterId) return;
      // Re-fetch spool detail from Spoolman
      const info = $('spoolmanInfo');
      try {
        if (info) info.textContent = 'Loading spool data…';
        const r = await fetch(`/api/ui/spoolman/spool_detail?slot=${encodeURIComponent(spoolSlotId)}&printer_id=${encodeURIComponent(spoolPrinterId)}`, { cache: 'no-store' });
        const data = await r.json();
        if (data.spool) {
          const fil = data.spool.filament || {};
          const vendor = (fil.vendor || {}).name || '';
          const name = fil.name || '';
          const material = (fil.material || '').toUpperCase();
          const remaining = data.spool.remaining_weight != null ? fmtG(data.spool.remaining_weight) : '—';
          if (info) info.textContent = [vendor, name, material, remaining].filter(Boolean).join(' · ');
        } else {
          if (info) info.textContent = data.error ? 'Spoolman unreachable' : '—';
        }
      } catch (e) {
        if (info) info.textContent = `Spoolman error: ${e.message || String(e)}`;
      }
    };
  }
}


function fmtRelative(ts) {
  if (!ts) return '—';
  const secs = Math.floor(Date.now() / 1000 - ts);
  if (secs < 60) return 'just now';
  if (secs < 3600) return Math.floor(secs / 60) + 'm ago';
  if (secs < 86400) return Math.floor(secs / 3600) + 'h ago';
  if (secs < 86400 * 30) return Math.floor(secs / 86400) + 'd ago';
  return Math.floor(secs / (86400 * 30)) + 'mo ago';
}

function renderCfsStats(state, wrap) {
  if (!wrap) return;
  wrap.innerHTML = '';

  const stats = state.cfs_stats || {};

  const boxesMeta = (state.cfs_slots || {})['_boxes'] || {};
  const activeBoxIds = Object.keys(boxesMeta).map(Number).filter(n => n >= 1 && n <= 4).sort();
  const boxIds = activeBoxIds.length ? activeBoxIds : [1, 2, 3, 4];

  for (const b of boxIds) {
    const slotIds = ['A', 'B', 'C', 'D'].map(l => `${b}${l}`);

    let boxMeters = 0, boxKg = 0;
    for (const sid of slotIds) {
      const s = stats[sid];
      if (s) { boxMeters += s.total_meters || 0; boxKg += s.total_kg || 0; }
    }

    const boxDiv = document.createElement('div');
    boxDiv.className = 'cfsBox';

    const head = document.createElement('div');
    head.className = 'cfsBoxHead';
    const headLabel = document.createElement('span');
    headLabel.textContent = `Box ${b}`;
    const headTotals = document.createElement('span');
    headTotals.className = 'cfsBoxTotals';
    headTotals.textContent = `${boxMeters.toFixed(1)} m  ·  ${fmtG(boxKg * 1000)}`;
    head.appendChild(headLabel);
    head.appendChild(headTotals);
    boxDiv.appendChild(head);

    for (const sid of slotIds) {
      const s = stats[sid] || {};
      const row = document.createElement('div');
      row.className = 'cfsSlotRow';

      const label = document.createElement('span');
      label.className = 'cfsSlotLabel';
      label.textContent = sid;

      const meters = document.createElement('span');
      meters.className = 'cfsSlotMeters';
      meters.textContent = ((s.total_meters || 0)).toFixed(1) + ' m';

      const kg = document.createElement('span');
      kg.className = 'cfsSlotKg';
      kg.textContent = fmtG((s.total_kg || 0) * 1000);

      const last = document.createElement('span');
      last.className = 'cfsSlotLast';
      last.textContent = fmtRelative(s.last_used_at || null);

      row.appendChild(label);
      row.appendChild(meters);
      row.appendChild(kg);
      row.appendChild(last);
      boxDiv.appendChild(row);
    }

    wrap.appendChild(boxDiv);
  }
}

function hexBrightness(hex) {
  const h = (hex || '').replace('#', '');
  if (h.length !== 6) return 128;
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000;
}

function makeSpoolSvg(meta) {
  const present = meta.present !== false;
  const rawColor = meta.color || '';
  const hasColor = present && rawColor && rawColor !== '#2a3442' && rawColor.length >= 4;

  if (!hasColor) {
    // Empty slot — dark disk with diagonal slash
    return `<svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="40" cy="40" r="36" fill="#1e2230" stroke="#141720" stroke-width="3"/>
      <line x1="22" y1="58" x2="58" y2="22" stroke="#484d5a" stroke-width="4" stroke-linecap="round"/>
    </svg>`;
  }

  const c = rawColor.startsWith('#') ? rawColor : '#' + rawColor;
  const bright = hexBrightness(c);
  const tick  = bright > 145 ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.18)';

  // Filament fill radius: area-proportional so it matches how a real spool empties.
  // At 100% the colored disk reaches the outer rim (r=36); at 0% it shrinks to the hub (r=10).
  const pct = (meta.percent != null) ? Math.max(0, Math.min(100, meta.percent)) / 100 : 1.0;
  const R_OUTER = 36, R_CORE = 10;
  const filR = Math.round(Math.sqrt(R_CORE * R_CORE + (R_OUTER * R_OUTER - R_CORE * R_CORE) * pct) * 10) / 10;
  const filamentDisk = filR > R_CORE + 0.5 ? `<circle cx="40" cy="40" r="${filR}" fill="${c}"/>` : '';

  return `<svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="40" cy="40" r="36" fill="#1e2230" stroke="#141720" stroke-width="3"/>
    ${filamentDisk}
    <circle cx="40" cy="40" r="20" fill="none" stroke="${tick}" stroke-width="1.5"/>
    <line x1="40" y1="22" x2="40" y2="29" stroke="${tick}" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="40" y1="51" x2="40" y2="58" stroke="${tick}" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="22" y1="40" x2="29" y2="40" stroke="${tick}" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="51" y1="40" x2="58" y2="40" stroke="${tick}" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="40" cy="40" r="10" fill="#1e2230" stroke="#2e3346" stroke-width="1.5"/>
    <circle cx="40" cy="40" r="3.5" fill="#50576a"/>
  </svg>`;
}

function renderPrinter(printerId, state) {
  const block = document.createElement("section");
  block.className = "printerBlock";
  if (printerId) block.dataset.printerId = printerId;

  const head = document.createElement("div");
  head.className = "printerHead";

  const titleWrap = document.createElement("div");
  titleWrap.className = "printerTitleWrap";
  const nameEl = document.createElement("div");
  nameEl.className = "printerName";
  nameEl.textContent = state.printer_name || printerId || "Printer";
  const metaEl = document.createElement("div");
  metaEl.className = "printerMeta";
  metaEl.textContent = [printerId, state.printer_firmware].filter(Boolean).join(" · ");
  titleWrap.appendChild(nameEl);
  titleWrap.appendChild(metaEl);
  head.appendChild(titleWrap);

  const badges = document.createElement("div");
  badges.className = "printerBadges";
  const pBadge = document.createElement("div");
  pBadge.className = "badge";
  const cfsBadge = document.createElement("div");
  cfsBadge.className = "badge";
  const printerOk = !!state.printer_connected;
  badge(pBadge, printerOk ? "Printer: connected" : "Printer: disconnected", printerOk ? "ok" : "bad");
  if (!printerOk && state.printer_last_error) {
    pBadge.textContent += " (" + state.printer_last_error + ")";
  }
  const cfsOk = !!state.cfs_connected;
  badge(
    cfsBadge,
    cfsOk ? `CFS: detected · ${fmtTs(state.cfs_last_update)}` : "CFS: —",
    cfsOk ? "ok" : "warn"
  );
  badges.appendChild(pBadge);
  badges.appendChild(cfsBadge);
  head.appendChild(badges);
  block.appendChild(head);

  const layout = document.createElement("div");
  layout.className = "layout";

  const leftCol = document.createElement("div");
  leftCol.className = "leftCol";
  const boxesGrid = document.createElement("section");
  boxesGrid.className = "grid";
  leftCol.appendChild(boxesGrid);

  const activeCard = document.createElement("section");
  activeCard.className = "card";
  activeCard.style.marginTop = "16px";
  const activeHead = document.createElement("div");
  activeHead.className = "cardHead";
  const activeTitle = document.createElement("div");
  activeTitle.className = "cardTitle";
  activeTitle.textContent = "Active";
  const activeMeta = document.createElement("div");
  activeMeta.className = "cardMeta";
  activeMeta.textContent = "—";
  activeHead.appendChild(activeTitle);
  activeHead.appendChild(activeMeta);
  activeCard.appendChild(activeHead);
  const activeRow = document.createElement("div");
  activeRow.className = "activeRow";
  activeCard.appendChild(activeRow);
  const activeLive = document.createElement("div");
  activeLive.className = "activeLive";
  activeLive.style.display = "none";
  activeCard.appendChild(activeLive);
  leftCol.appendChild(activeCard);

  const rightCol = document.createElement("aside");
  rightCol.className = "rightCol";
  const statsCard = document.createElement("section");
  statsCard.className = "card";
  const statsHead = document.createElement("div");
  statsHead.className = "cardHead";
  const statsTitle = document.createElement("div");
  statsTitle.className = "cardTitle";
  statsTitle.textContent = "CFS Stats";
  const statsMeta = document.createElement("div");
  statsMeta.className = "cardMeta";
  statsHead.appendChild(statsTitle);
  statsHead.appendChild(statsMeta);
  statsCard.appendChild(statsHead);
  const history = document.createElement("div");
  history.className = "history";
  statsCard.appendChild(history);
  rightCol.appendChild(statsCard);

  layout.appendChild(leftCol);
  layout.appendChild(rightCol);
  block.appendChild(layout);

  // We prefer Creality CFS slots (state.cfs_slots). Fallback to local slots if not present.
  const localSlots = state.slots || {};
  const slots = (state.cfs_slots && Object.keys(state.cfs_slots).length) ? state.cfs_slots : localSlots;
  const active = state.cfs_active_slot || null;

  // Determine which CFS boxes are actually connected.
  const boxesInfo = (slots && slots._boxes) ? slots._boxes : {};
  const connectedBoxes = [];
  for (const n of ["1", "2", "3", "4"]) {
    const bi = boxesInfo[n];
    if (bi && bi.connected === true) connectedBoxes.push(n);
  }
  // Fallback: if firmware doesn't provide box connection metadata, show Box 1 & 2.
  if (!connectedBoxes.length) connectedBoxes.push("1", "2");

  const metaFor = (sid) => {
    // We render slots primarily from Creality CFS data (state.cfs_slots),
    // BUT spool tracking (remaining/consumed + reference points) lives in state.slots.
    // Therefore we must merge both.
    const m = (slots && slots[sid]) ? slots[sid] : {};
    const local = (localSlots && localSlots[sid]) ? localSlots[sid] : {};
    const defaultPresent = sid === PRINTER_SPOOL_SLOT ? false : true;

    // normalize fields from either cfs_slots or local slots
    const out = {
      present: (m.present ?? local.present ?? defaultPresent),
      material: ((m.material ?? local.material) || "").toString().toUpperCase(),
      color: ((m.color ?? m.color_hex ?? local.color ?? local.color_hex) || "").toString().toLowerCase(),

      // spool epoch (for roll-change tracking)
      spool_epoch: (local.spool_epoch ?? null),

      // Spoolman
      spoolman_id: (local.spoolman_id ?? null),
      name: (local.name ?? ''),
      manufacturer: (local.manufacturer ?? local.vendor ?? ''),

      // CFS percent remaining from WS data
      percent: (m.percent != null ? m.percent : null),
    };
    return out;
  };

  function makeSlotPod(sid, m, isAct) {
    const pod = document.createElement("div");
    pod.className = "slotPod" + (isAct ? " active" : "");
    pod.dataset.slotid = sid;

    // Slot ID badge
    const idBadge = document.createElement("div");
    idBadge.className = "slotPodId";
    idBadge.textContent = sid;
    pod.appendChild(idBadge);

    // Spool graphic
    const spoolWrap = document.createElement("div");
    spoolWrap.className = "slotPodSpool";
    spoolWrap.innerHTML = makeSpoolSvg(m);
    pod.appendChild(spoolWrap);

    // Material — only shown when slot is occupied
    const matEl = document.createElement("div");
    matEl.className = "slotPodMaterial";
    matEl.textContent = m.present === false ? "" : (m.material || "—");
    pod.appendChild(matEl);

    // Percent remaining (if available from CFS/WS)
    if (m.present !== false && m.percent != null) {
      const pctEl = document.createElement("div");
      pctEl.className = "slotPodPct";
      pctEl.textContent = m.percent + "%";
      pod.appendChild(pctEl);
    }

    // Spoolman link indicator dot
    const linkDot = document.createElement("div");
    linkDot.className = "slotPodLink" + (m.spoolman_id ? " linked" : "");
    linkDot.title = m.spoolman_id ? "Linked to Spoolman #" + m.spoolman_id : "Not linked to Spoolman";
    pod.appendChild(linkDot);

    pod.addEventListener("click", (ev) => {
      ev.preventDefault();
      openSpoolModal(sid, m, printerId);
    });

    return pod;
  }

  function makeBoxCard(boxNum) {
    const row = document.createElement("div");
    row.className = "boxRow";

    // Left: box header showing box number + env data
    const header = document.createElement("div");
    header.className = "boxHeader";

    const hTitle = document.createElement("div");
    hTitle.className = "boxHeaderTitle";
    hTitle.textContent = `Box ${boxNum}`;
    header.appendChild(hTitle);

    const bi = boxesInfo[boxNum] || {};
    const tC = bi.temperature_c;
    const rh = bi.humidity_pct;
    if (typeof tC === "number" && !Number.isNaN(tC)) {
      const chip = document.createElement("div");
      chip.className = "boxEnvChip";
      chip.textContent = `🌡 ${Math.round(tC)}°C`;
      header.appendChild(chip);
    }
    if (typeof rh === "number" && !Number.isNaN(rh)) {
      const chip = document.createElement("div");
      chip.className = "boxEnvChip";
      chip.textContent = `💧 ${Math.round(rh)}%`;
      header.appendChild(chip);
    }
    row.appendChild(header);

    // Right: 4 slot pods
    const slotsWrap = document.createElement("div");
    slotsWrap.className = "boxSlots";

    for (const letter of ["A", "B", "C", "D"]) {
      const sid = `${boxNum}${letter}`;
      const m = metaFor(sid);
      const isAct = sid === active;
      slotsWrap.appendChild(makeSlotPod(sid, m, isAct));
    }

    row.appendChild(slotsWrap);
    return row;
  }

  function makeSpoolInputCard() {
    const row = document.createElement("div");
    row.className = "boxRow";

    const header = document.createElement("div");
    header.className = "boxHeader";
    const hTitle = document.createElement("div");
    hTitle.className = "boxHeaderTitle";
    hTitle.textContent = "Spool";
    header.appendChild(hTitle);
    row.appendChild(header);

    const slotsWrap = document.createElement("div");
    slotsWrap.className = "boxSlots boxSlotsSingle";
    const m = metaFor(PRINTER_SPOOL_SLOT);
    const isAct = PRINTER_SPOOL_SLOT === active;
    slotsWrap.appendChild(makeSlotPod(PRINTER_SPOOL_SLOT, m, isAct));
    row.appendChild(slotsWrap);
    return row;
  }

  for (const b of connectedBoxes) {
    boxesGrid.appendChild(makeBoxCard(b));
  }
  boxesGrid.appendChild(makeSpoolInputCard());

  // Right-side CFS stats panel
  renderCfsStats(state, history);

  // Active card
  if (active && (slots[active] || localSlots[active])) {
    const m = metaFor(active);
    activeRow.appendChild(slotEl(active, slotTitle(active), m, true, printerId));
    activeMeta.textContent = m.material ? (m.material + " · " + (m.color ? m.color.toUpperCase() : "")) : "—";
  } else {
    activeMeta.textContent = "—";
  }

  return block;
}

function render(ui) {
  const printers = (ui && ui.printers) ? ui.printers : [];

  // Spoolman external link
  const smExtLink = $("spoolmanExtLink");
  if (smExtLink) {
    if (ui && ui.spoolman_url) {
      smExtLink.href = ui.spoolman_url;
      smExtLink.style.display = '';
    } else {
      smExtLink.style.display = 'none';
    }
  }

  // Update heading / title
  const printerTitle = $("printerTitle");
  if (printerTitle) printerTitle.textContent = "CFSync";
  document.title = printers.length ? `CFSync · ${printers.length} printers` : "CFSync";
  const sub = $("printerSubtitle");
  if (sub) {
    sub.textContent = printers.length ? `${printers.length} printer${printers.length === 1 ? "" : "s"} configured` : "No printers configured";
  }

  const printerBadge = $("printerBadge");
  const cfsBadge = $("cfsBadge");
  const total = printers.length;
  const connected = printers.filter(p => (p.state || p).printer_connected).length;
  const cfsOk = printers.filter(p => (p.state || p).cfs_connected).length;

  if (printerBadge) {
    if (!total) {
      badge(printerBadge, "Printers: —", "warn");
    } else {
      const cls = connected === total ? "ok" : (connected > 0 ? "warn" : "bad");
      badge(printerBadge, `Printers: ${connected}/${total} online`, cls);
    }
  }
  if (cfsBadge) {
    if (!total) {
      badge(cfsBadge, "CFS: —", "warn");
    } else {
      badge(cfsBadge, `CFS: ${cfsOk}/${total} detected`, cfsOk > 0 ? "ok" : "warn");
    }
  }

  const wrap = $("printersWrap");
  if (!wrap) return;
  wrap.innerHTML = "";
  if (!printers.length) {
    const empty = document.createElement("div");
    empty.className = "emptyState";
    empty.textContent = "No printers configured. Set printer_urls (or printers) in data/config.json and reload.";
    wrap.appendChild(empty);
    return;
  }

  for (const p of printers) {
    const pid = p.id || p.printer_id || p.host || "";
    const st = p.state || p;
    wrap.appendChild(renderPrinter(pid, st));
  }
}

async function tick() {
  try {
    const r = await fetch("/api/ui/state", { cache: "no-store" });
    const j = await r.json();
    const st = j.result || j;
    spoolmanConfigured = !!st.spoolman_configured;
    render(st);
  } catch (e) {
    const pb = $("printerBadge");
    const cb = $("cfsBadge");
    if (pb) badge(pb, 'Printers: —', "warn");
    if (cb) badge(cb, 'CFS: —', "warn");
  }
}

// --- Refresh control (client-side only) ---
let refreshTimer = null;
let refreshMs = Number(localStorage.getItem('refreshMs') || 10000);
if (!Number.isFinite(refreshMs) || refreshMs < 2000) refreshMs = 10000;
let refreshPaused = localStorage.getItem('refreshPaused') === '1';

function applyRefreshTimer() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  if (!refreshPaused) refreshTimer = setInterval(tick, refreshMs);

  const sel = $('refreshSelect');
  const btn = $('refreshToggle');
  if (sel) sel.value = String(refreshMs);
  if (btn) {
    btn.textContent = refreshPaused ? '▶' : '⏸';
    btn.classList.toggle('paused', refreshPaused);
  }
}

function initRefreshControls() {
  const sel = $('refreshSelect');
  const btn = $('refreshToggle');
  if (sel) {
    sel.value = String(refreshMs);
    sel.onchange = () => {
      refreshMs = Number(sel.value || 10000);
      if (!Number.isFinite(refreshMs) || refreshMs < 2000) refreshMs = 10000;
      localStorage.setItem('refreshMs', String(refreshMs));
      applyRefreshTimer();
    };
  }
  if (btn) {
    btn.onclick = () => {
      refreshPaused = !refreshPaused;
      localStorage.setItem('refreshPaused', refreshPaused ? '1' : '0');
      if (!refreshPaused) tick();
      applyRefreshTimer();
    };
  }
  applyRefreshTimer();
}

function initFluiddBookmarklet() {
  const origin = window.location.origin;
  const code = "javascript:(function(){window.CFSYNC_URL='" + origin + "';" +
    "var s=document.createElement('script');" +
    "s.src='" + origin + "/static/fluidd-panel.js?v=1&t='+Date.now();" +
    "document.head.appendChild(s);})();";

  const link = document.getElementById('fluiddBookmarklet');
  if (link) link.href = code;

  const btn = document.getElementById('fluiddCopyBtn');
  if (btn) {
    btn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(code);
        const prev = btn.textContent;
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = prev; }, 2000);
      } catch (_) {
        prompt('Copy this bookmarklet URL and save it as a browser bookmark:', code);
      }
    };
  }
}

function boot() {
  initSpoolModal();
  initRefreshControls();
  initFluiddBookmarklet();
  tick();
}

// app.js may be loaded before some HTML (e.g. the spool modal) in certain
// templates. Ensure we wire up DOM-dependent handlers only after DOM is ready.
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
