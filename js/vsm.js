/**
 * Value Stream Studio — live value stream map simulation.
 *
 * Structure:
 *   DEFAULTS      sample current/future state data (edit to model your own line)
 *   calc()        takt, effective cycle time, inventory days, lead time, PCE
 *   render*()     KPI strip, SVG map, line-balance chart, findings, editor
 *   Live sim      discrete-time simulation: arrivals at takt, random downtime
 *                 sized to each process's uptime, FIFO/supermarket WIP caps
 *
 * No dependencies. MIT licensed.
 */
(function () {
  "use strict";
  const DEFAULTS = {
    settings: { demand: 920, shifts: 2, minPerShift: 450 },
    current: {
      procs: [
        { name: "Receiving",   ct: 22,  co: 0,  up: 99, stations: 1, ops: 1, va: false, wip: 2300, buf: "push" },
        { name: "Machining",   ct: 112, co: 30, up: 85, stations: 2, ops: 2, va: true,  wip: 1150, buf: "push" },
        { name: "Deburr",      ct: 41,  co: 10, up: 90, stations: 1, ops: 1, va: true,  wip: 980,  buf: "push" },
        { name: "Inspection",  ct: 35,  co: 0,  up: 95, stations: 1, ops: 1, va: false, wip: 460,  buf: "push" },
        { name: "Packaging",   ct: 28,  co: 5,  up: 98, stations: 1, ops: 1, va: false, wip: 320,  buf: "push" },
        { name: "Shipping",    ct: 18,  co: 0,  up: 99, stations: 1, ops: 1, va: false, wip: 690,  buf: "push" }
      ]
    },
    future: {
      procs: [
        { name: "Receiving",   ct: 22,  co: 0, up: 99, stations: 1, ops: 1, va: false, wip: 920, buf: "market", kz: "" },
        { name: "Machining",   ct: 98,  co: 8, up: 93, stations: 2, ops: 2, va: true,  wip: 460, buf: "market", kz: "SMED + TPM" },
        { name: "Deburr",      ct: 38,  co: 4, up: 94, stations: 1, ops: 1, va: true,  wip: 120, buf: "fifo", kz: "Cell" },
        { name: "Inspection",  ct: 30,  co: 0, up: 97, stations: 1, ops: 1, va: false, wip: 60,  buf: "fifo", kz: "In-line gauge" },
        { name: "Packaging",   ct: 28,  co: 2, up: 98, stations: 1, ops: 1, va: false, wip: 60,  buf: "fifo", kz: "" },
        { name: "Shipping",    ct: 18,  co: 0, up: 99, stations: 1, ops: 1, va: false, wip: 230, buf: "market", kz: "" }
      ]
    }
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  let model = clone(DEFAULTS);
  let view = "current";
  let basis = "work";
  let selected = 1;

  const $ = (id) => document.getElementById(id);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const f = (n, d = 1) => Number.isFinite(n) ? n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–";
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function calc(stateKey) {
    const s = model.settings;
    const st = model[stateKey || view];
    const avail = Math.max(1, s.shifts * s.minPerShift * 60);
    const demand = Math.max(1, s.demand);
    const takt = avail / demand;
    const procs = st.procs.map((p) => {
      const eff = p.ct / Math.max(0.01, p.stations * p.up / 100);
      const load = eff / takt;
      const status = load > 1 ? "bad" : load > 0.85 ? "warn" : "ok";
      return Object.assign({}, p, { eff, load, status, invDays: p.wip / demand });
    });
    const invDays = sum(procs.map((p) => p.invDays));
    const procSec = sum(procs.map((p) => p.ct));
    const vaSec = sum(procs.filter((p) => p.va).map((p) => p.ct));
    const dayLen = basis === "work" ? avail : 86400;
    const ltDays = invDays + procSec / avail;
    const pce = vaSec / (invDays * dayLen + procSec);
    const pceAllVA = procSec / (invDays * dayLen + procSec);
    let bi = 0; procs.forEach((p, i) => { if (p.load > procs[bi].load) bi = i; });
    let wi = 0; procs.forEach((p, i) => { if (p.wip > procs[wi].wip) wi = i; });
    const capacity = avail / procs[bi].eff;
    return { avail, demand, takt, procs, invDays, ltDays, procSec, vaSec, pce, pceAllVA, bi, wi, capacity, totalWip: sum(procs.map((p) => p.wip)) };
  }

  /* ---------- KPIs ---------- */
  function renderKpis(c) {
    const other = view === "future" ? calc("current") : null;
    const ltDelta = other ? `<span class="delta-good">−${f((1 - c.ltDays / other.ltDays) * 100, 0)}%</span> vs current` : "queue time dominates";
    const b = c.procs[c.bi];
    const items = [
      { k: "Takt time", v: f(c.takt, 1), u: "s", d: `${f(c.avail / 3600, 1)} h ÷ ${c.demand.toLocaleString()} pcs` },
      { k: "Lead time", v: f(c.ltDays, 2), u: "days", d: ltDelta, hot: true },
      { k: "Value-added", v: f(c.vaSec, 0), u: "s", d: `${f(c.procSec, 0)} s total processing` },
      { k: "PCE", v: c.pce < 0.001 ? f(c.pce * 100, 3) : f(c.pce * 100, 2), u: "%", d: basis === "work" ? "working-time basis" : "calendar 24 h basis" },
      { k: "Constraint", v: esc(b.name), u: "", d: `${f(b.load * 100, 0)}% of takt`, hot: b.status === "bad" },
      { k: "Total WIP", v: c.totalWip.toLocaleString(), u: "pcs", d: `largest queue: ${esc(c.procs[c.wi].name)}` }
    ];
    $("kpis").innerHTML = items.map((it) => `<div class="kpi${it.hot ? " hot" : ""}"><div class="k">${it.k}</div><div class="v">${it.v}${it.u ? `<small>${it.u}</small>` : ""}</div><div class="d">${it.d}</div></div>`).join("");
  }

  /* ---------- Map ---------- */
  const PX0 = 140, STEP = 170, PW = 120, PY = 236;
  const pxOf = (i) => PX0 + i * STEP;
  const bufX = (i) => i === 0 ? 92 : pxOf(i) - 25;

  function truck(x, y) {
    return `<g transform="translate(${x},${y})"><rect x="0" y="0" width="30" height="18" class="m-box"/><path d="M30 6 h10 l6 6 v6 h-16z" class="m-box"/><circle cx="8" cy="20" r="3.5" class="m-head"/><circle cx="38" cy="20" r="3.5" class="m-head"/></g>`;
  }
  function factory(x, y, w, title, sub) {
    return `<g><rect x="${x}" y="${y}" width="${w}" height="72" class="m-box"/>
      <path d="M${x} ${y} l18 -14 v14 l18 -14 v14 l18 -14 v14" class="m-box"/>
      <text x="${x + w / 2}" y="${y + 32}" text-anchor="middle" class="m-big">${title}</text>
      <text x="${x + w / 2}" y="${y + 52}" text-anchor="middle" class="m-mut">${sub}</text></g>`;
  }
  function zig(x1, x2, y) {
    const mid = (x1 + x2) / 2;
    return `<path d="M${x1} ${y} H${mid + 10} l-12 10 l12 -2 l-12 10 H${x2}" class="m-zig"/><path d="M${x2} ${y + 18} l9 -5 v10z" fill="var(--flow)"/>`;
  }
  function arrowHead(x, y, cls) { return `<path d="M${x} ${y} l-10 -6 v12z" class="${cls || "m-head-arrow"}"/>`; }

  function bufferGlyph(p, i, x) {
    const y = 318;
    const qty = `<text id="q${i}" x="${x}" y="${y + 34}" text-anchor="middle" class="m-txt">${p.wip.toLocaleString()}</text><text id="qd${i}" x="${x}" y="${y + 48}" text-anchor="middle" class="m-mut">${f(p.invDays, 2)} d</text>`;
    if (p.buf === "market") {
      return `<g><path d="M${x - 17} ${y - 18} h34 v34 h-34" fill="none" stroke="var(--flow)" stroke-width="2"/>
        <path d="M${x - 17} ${y - 7} h26 M${x - 17} ${y + 4} h26" stroke="var(--flow)" stroke-width="2"/>${qty}</g>`;
    }
    if (p.buf === "fifo") {
      return `<g><rect x="${x - 22}" y="${y - 8}" width="44" height="16" fill="none" stroke="var(--flow)" stroke-width="1.6"/>
        <text x="${x}" y="${y + 4}" text-anchor="middle" style="fill:var(--flow);font:600 9.5px var(--mono)">FIFO</text>${qty}</g>`;
    }
    return `<g><path d="M${x} ${y - 20} l17 30 h-34z" class="m-tri"/><text x="${x}" y="${y + 6}" text-anchor="middle" class="m-tritxt">I</text>${qty}</g>`;
  }

  function renderMap(c) {
    const fut = view === "future";
    const s = [];
    const d = model.settings.demand;
    // Supplier, production control, customer
    s.push(factory(20, 34, 150, "Supplier", "Steel bar · 2×/week"));
    s.push(`<rect x="510" y="20" width="180" height="62" class="m-box"/><rect x="510" y="20" width="180" height="22" class="m-head"/>
      <text x="600" y="36" text-anchor="middle" class="m-headtxt">Production Control</text>
      <text x="600" y="60" text-anchor="middle" class="m-txt">ERP / MRP</text>
      <text x="600" y="74" text-anchor="middle" class="m-mut">${fut ? "pacemaker schedule" : "daily push schedule"}</text>`);
    s.push(factory(1030, 34, 150, "Customer", `OEM · ${d.toLocaleString()} pcs/day`));
    s.push(zig(1030, 690, 48));
    s.push(`<text x="860" y="38" text-anchor="middle" class="m-mut">30/60/90-day forecast · daily orders</text>`);
    s.push(zig(510, 170, 48));
    s.push(`<text x="340" y="38" text-anchor="middle" class="m-mut">weekly releases</text>`);

    // Schedule lines
    if (fut) {
      const cx = pxOf(1) + PW / 2;
      s.push(`<path d="M600 82 V150 H${cx} V${PY - 8}" class="m-info"/>` + `<path d="M${cx} ${PY - 2} l-5 -9 h10z" fill="var(--muted)"/>`);
      s.push(`<text x="${(600 + cx) / 2}" y="144" text-anchor="middle" class="m-mut">load-levelled pitch to pacemaker</text>`);
      s.push(`<path d="M600 82 V150 H${pxOf(5) + PW / 2} V${PY - 8}" class="m-info" stroke-dasharray="4 3"/>`);
      s.push(`<text x="${pxOf(4) + 60}" y="144" text-anchor="middle" class="m-mut">ship schedule</text>`);
    } else {
      c.procs.forEach((p, i) => {
        const cx = pxOf(i) + PW / 2;
        s.push(`<path d="M600 82 L${cx} ${PY - 8}" class="m-info"/><path d="M${cx} ${PY - 2} l-4 -9 h8z" fill="var(--muted)"/>`);
      });
      s.push(`<text x="600" y="128" text-anchor="middle" class="m-mut" style="paint-order:stroke;stroke:var(--sheet);stroke-width:4px">daily schedule to every process</text>`);
    }

    // Inbound truck and flow
    s.push(`<path d="M95 106 V${PY + 40}" class="m-push m-flowanim" style="stroke-width:3;stroke-dasharray:2 4"/>`);
    s.push(truck(70, 150));
    // Outbound
    const shipR = pxOf(5) + PW;
    s.push(`<path d="M${shipR} ${PY + 14} H1160 V106" class="m-push m-flowanim" style="stroke-width:3;stroke-dasharray:2 4"/>`);
    s.push(truck(1138, 160));
    s.push(`<text x="1160" y="200" text-anchor="middle" class="m-mut">daily</text>`);

    // Processes
    c.procs.forEach((p, i) => {
      const x = pxOf(i);
      // flow arrow from previous
      if (i > 0) {
        const x1 = pxOf(i - 1) + PW + 2, x2 = x - 2;
        if (p.buf === "push") s.push(`<path d="M${x1} ${PY + 14} H${x2 - 8}" class="m-push m-flowanim"/>` + arrowHead(x2, PY + 14));
        else s.push(`<path d="M${x1} ${PY + 14} H${x2 - 8}" class="m-pull"/>` + `<path d="M${x2} ${PY + 14} l-10 -6 v12z" fill="var(--flow)"/>`);
      }
      s.push(bufferGlyph(p, i, bufX(i)));
      const sel = i === selected;
      const st = p.status;
      s.push(`<g class="m-proc" data-i="${i}" tabindex="0" role="button" aria-label="Edit ${esc(p.name)}">
        <rect x="${x}" y="${PY}" width="${PW}" height="30" class="m-head"/>
        <text x="${x + PW / 2}" y="${PY + 19}" text-anchor="middle" class="m-headtxt">${esc(p.name)}</text>
        <rect x="${x}" y="${PY + 30}" width="${PW}" height="104" class="m-box${sel ? " m-sel" : ""}"/>
        ${row(x, PY + 47, "C/T", f(p.ct, 0) + " s")}
        ${row(x, PY + 63, "C/O", f(p.co, 0) + " min")}
        ${row(x, PY + 79, "Uptime", f(p.up, 0) + "%")}
        ${row(x, PY + 95, "Stations", p.stations + " · " + p.ops + " op")}
        <rect x="${x + 1}" y="${PY + 104}" width="${PW - 2}" height="29" class="m-${st}bg"/>
        <text x="${x + 8}" y="${PY + 122}" class="m-mut" style="fill:var(--${st})">Eff C/T</text>
        <text x="${x + PW - 8}" y="${PY + 122}" text-anchor="end" class="m-txt" style="fill:var(--${st});font-weight:600">${f(p.eff, 1)} s</text>
        ${p.va ? `<text x="${x + PW - 6}" y="${PY + 19}" text-anchor="end" style="fill:var(--accent);font:600 9.5px var(--mono)">VA</text>` : ""}
        ${sel ? `<rect x="${x - 4}" y="${PY - 4}" width="${PW + 8}" height="142" fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="5 3"/>` : ""}
      </g>`);
      if (fut && p.kz) s.push(kaizen(x + PW / 2, PY - 30, p.kz));
    });

    // Timeline ladder
    const HI = 430, LO = 468;
    let path = `M60 ${HI}`;
    const labels = [];
    c.procs.forEach((p, i) => {
      const segL = i === 0 ? 60 : pxOf(i - 1) + PW;
      const segR = pxOf(i);
      path += ` H${segR} V${LO} H${segR + PW} V${HI}`;
      labels.push(`<text x="${(segL + segR) / 2}" y="${HI - 8}" text-anchor="middle" class="m-txt">${f(p.invDays, 2)} d</text>`);
      labels.push(`<text x="${segR + PW / 2}" y="${LO + 16}" text-anchor="middle" class="m-txt" style="${p.va ? "fill:var(--accent);font-weight:600" : ""}">${f(p.ct, 0)} s${p.va ? " VA" : ""}</text>`);
    });
    s.push(`<text x="20" y="${HI + 4}" class="m-mut">Queue</text><text x="20" y="${LO + 4}" class="m-mut">Process</text>`);
    s.push(`<path d="${path}" class="m-ladder"/>` + labels.join(""));
    // Totals
    const tx = 1124;
    s.push(`<rect x="${tx}" y="${HI - 34}" width="68" height="104" class="m-box" style="stroke:var(--accent);stroke-width:2"/>
      <text x="${tx + 34}" y="${HI - 18}" text-anchor="middle" class="m-mut">Lead time</text>
      <text x="${tx + 34}" y="${HI + 2}" text-anchor="middle" class="m-big" style="fill:var(--accent)">${f(c.ltDays, 2)} d</text>
      <text x="${tx + 34}" y="${HI + 24}" text-anchor="middle" class="m-mut">VA time</text>
      <text x="${tx + 34}" y="${HI + 42}" text-anchor="middle" class="m-big">${f(c.vaSec, 0)} s</text>
      <text x="${tx + 34}" y="${HI + 62}" text-anchor="middle" class="m-mut">PCE ${c.pce < 0.001 ? f(c.pce * 100, 3) : f(c.pce * 100, 2)}%</text>`);
    s.push(`<text x="60" y="520" class="m-mut">Takt ${f(c.takt, 1)} s · ${model.settings.shifts} shift${model.settings.shifts > 1 ? "s" : ""} × ${model.settings.minPerShift} net min · demand ${d.toLocaleString()} pcs/day</text>`);
    s.push('<g id="pulses" style="pointer-events:none"></g><g id="live" style="pointer-events:none"></g>');
    $("map").innerHTML = s.join("");
    liveEl = $("live"); pulseEl = $("pulses");
  }
  function row(x, y, k, v) {
    return `<text x="${x + 8}" y="${y}" class="m-mut">${k}</text><text x="${x + PW - 8}" y="${y}" text-anchor="end" class="m-txt">${v}</text>`;
  }
  function kaizen(cx, cy, text) {
    const w = Math.max(64, text.length * 6.6 + 18);
    const pts = [];
    const n = 14;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const r = k % 2 ? 0.82 : 1;
      pts.push(`${(cx + Math.cos(a) * (w / 2) * r).toFixed(1)},${(cy + Math.sin(a) * 14 * r).toFixed(1)}`);
    }
    return `<g><polygon points="${pts.join(" ")}" class="m-kaizen"/><text x="${cx}" y="${cy + 3.5}" text-anchor="middle" style="fill:#15211f;font:600 9.5px var(--mono)">${esc(text)}</text></g>`;
  }

  /* ---------- Line balance chart ---------- */
  function niceStep(max) {
    const raw = max / 5, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  }
  function renderBalance(c) {
    const W = 600, H = 290, L = 44, R = 16, T = 18, B = 46;
    const maxV = Math.max(c.takt * 1.25, ...c.procs.map((p) => p.eff)) * 1.08;
    const step = niceStep(maxV);
    const top = Math.ceil(maxV / step) * step;
    const y = (v) => T + (H - T - B) * (1 - v / top);
    const n = c.procs.length, bw = (W - L - R) / n;
    const s = [];
    for (let v = 0; v <= top + 0.001; v += step) {
      s.push(`<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="c-axis"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="c-txt">${Math.round(v)}</text>`);
    }
    c.procs.forEach((p, i) => {
      const x = L + i * bw + bw * 0.2, w = bw * 0.6;
      const ideal = p.ct / p.stations;
      s.push(`<rect x="${x}" y="${y(p.eff)}" width="${w}" height="${y(0) - y(p.eff)}" fill="var(--${p.status})" opacity="${i === selected ? 1 : 0.85}"/>`);
      s.push(`<line x1="${x}" x2="${x + w}" y1="${y(ideal)}" y2="${y(ideal)}" stroke="var(--sheet)" stroke-width="2" stroke-dasharray="3 2"/>`);
      s.push(`<text x="${x + w / 2}" y="${y(p.eff) - 6}" text-anchor="middle" class="c-val">${f(p.eff, 1)}</text>`);
      s.push(`<text x="${x + w / 2}" y="${H - B + 16}" text-anchor="middle" class="c-lbl">${esc(p.name.length > 10 ? p.name.slice(0, 9) + "…" : p.name)}</text>`);
      s.push(`<text x="${x + w / 2}" y="${H - B + 31}" text-anchor="middle" class="c-txt">${f(p.load * 100, 0)}%</text>`);
    });
    s.push(`<line x1="${L}" x2="${W - R}" y1="${y(c.takt)}" y2="${y(c.takt)}" class="c-takt"/>`);
    s.push(`<text x="${W - R}" y="${y(c.takt) - 6}" text-anchor="end" class="c-taktlbl">TAKT ${f(c.takt, 1)} s</text>`);
    s.push(`<line x1="${L}" x2="${L}" y1="${T}" y2="${y(0)}" class="c-axis"/>`);
    $("balance").innerHTML = s.join("");
  }

  /* ---------- Findings ---------- */
  function renderFindings(c) {
    const b = c.procs[c.bi], w = c.procs[c.wi];
    const items = [];
    if (b.status === "bad") {
      const short = c.demand - c.capacity;
      items.push({ t: "bad", h: `${esc(b.name)} cannot meet takt`, p: `Effective C/T ${f(b.eff, 1)} s against takt ${f(c.takt, 1)} s. Capacity is about ${Math.round(c.capacity).toLocaleString()} pcs/day, short ${Math.round(short).toLocaleString()} pcs. The gap is covered by overtime or by the WIP piled up around it.` });
    } else if (b.status === "warn") {
      items.push({ t: "warn", h: `${esc(b.name)} is tight at ${f(b.load * 100, 0)}% of takt`, p: `It meets demand on paper, but one bad changeover or an uptime dip puts it over. Hold uptime at or above ${f(b.up, 0)}% and keep changeovers short.` });
    } else {
      items.push({ t: "ok", h: "Every process runs under takt", p: `The slowest step, ${esc(b.name)}, loads to ${f(b.load * 100, 0)}% of takt. Capacity is no longer the problem; queue time is.` });
    }
    const queueShare = (c.invDays) / c.ltDays;
    items.push({ t: "warn", h: `${f(queueShare * 100, 1)}% of lead time is waiting`, p: `${c.totalWip.toLocaleString()} pcs of WIP equals ${f(c.invDays, 2)} days of demand. The largest queue is in front of ${esc(w.name)} at ${w.wip.toLocaleString()} pcs (${f(w.invDays, 2)} d).` });
    items.push({ t: c.pce > 0.05 ? "ok" : "bad", h: `PCE ${c.pce < 0.001 ? f(c.pce * 100, 3) : f(c.pce * 100, 2)}% (${basis === "work" ? "working time" : "calendar"})`, p: `Only ${c.procs.filter((p) => p.va).map((p) => esc(p.name)).join(" and ") || "no steps"} add value: ${f(c.vaSec, 0)} s per piece. If every step counted as VA, PCE would read ${f(c.pceAllVA * 100, 2)}%, which overstates it.` });
    const coProc = c.procs.reduce((a, p) => (p.co > a.co ? p : a), c.procs[0]);
    if (coProc.co > 0) {
      const lossPct = (coProc.co * 60) / c.avail * 100;
      items.push({ t: coProc.co > 15 ? "warn" : "ok", h: `${esc(coProc.name)} changeover is ${f(coProc.co, 0)} min`, p: `One changeover per day costs ${f(lossPct, 1)}% of available time. Long changeovers force big batches, and big batches build the queues above.` });
    }
    if (view === "future") {
      const cur = calc("current");
      items.unshift({ t: "ok", h: `Lead time ${f(cur.ltDays, 2)} → ${f(c.ltDays, 2)} days`, p: `WIP drops from ${cur.totalWip.toLocaleString()} to ${c.totalWip.toLocaleString()} pcs. Supermarkets feed the pacemaker and FIFO lanes cap the queues downstream.` });
    }
    $("findings").innerHTML = items.map((it) => `<li><span class="bar" style="background:var(--${it.t})"></span><div><b>${it.h}</b><p>${it.p}</p></div></li>`).join("");
  }

  /* ---------- Editor ---------- */
  const FIELDS = [
    ["ct", "C/T s", 1], ["co", "C/O min", 1], ["up", "Uptime %", 1], ["stations", "Stations", 1], ["ops", "Operators", 1], ["wip", "WIP in queue", 10]
  ];
  function renderEditor() {
    const st = model[view];
    $("editor").innerHTML = st.procs.map((p, i) => `
      <div class="pcard${i === selected ? " sel" : ""}" data-i="${i}">
        <h4>${esc(p.name)} <span class="pill" id="pill${i}"></span></h4>
        <div class="fields">
          ${FIELDS.map(([k, lbl, step]) => `<div class="ctl"><label for="p${i}_${k}">${lbl}</label><input type="number" id="p${i}_${k}" data-i="${i}" data-k="${k}" min="${k === "stations" || k === "ops" ? 1 : 0}" ${k === "up" ? 'max="100"' : ""} step="${step}" value="${p[k]}"></div>`).join("")}
        </div>
        <label class="chk"><input type="checkbox" id="p${i}_va" data-i="${i}" data-k="va" ${p.va ? "checked" : ""}> Value-added step</label>
      </div>`).join("");
  }
  function updatePills(c) {
    c.procs.forEach((p, i) => {
      const el = $("pill" + i);
      if (!el) return;
      el.className = "pill " + p.status;
      el.textContent = p.status === "bad" ? "Over takt" : p.status === "warn" ? "Tight" : "OK";
    });
    document.querySelectorAll(".pcard").forEach((el) => el.classList.toggle("sel", +el.dataset.i === selected));
  }

  /* ---------- Orchestration ---------- */
  function renderAll(withEditor) {
    const c = calc();
    $("mapTitle").textContent = view === "future" ? "Future state" : "Current state";
    $("tbRev").textContent = view === "future" ? "B" : "A";
    $("tbSheet").textContent = view === "future" ? "2 of 2" : "1 of 2";
    renderKpis(c);
    renderMap(c);
    renderBalance(c);
    renderFindings(c);
    if (withEditor) renderEditor();
    updatePills(c);
  }
  function syncGlobals() {
    $("gDemand").value = model.settings.demand;
    $("gShifts").value = model.settings.shifts;
    $("gMin").value = model.settings.minPerShift;
  }
  function setSeg(id, v) {
    $(id).querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === v)));
  }

  $("segState").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    view = b.dataset.v; setSeg("segState", view); renderAll(true); resetSim();
  });
  $("segBasis").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    basis = b.dataset.v; setSeg("segBasis", basis); renderAll(false); syncSim();
  });
  [["gDemand", "demand"], ["gShifts", "shifts"], ["gMin", "minPerShift"]].forEach(([id, k]) => {
    $(id).addEventListener("input", (e) => {
      const v = parseFloat(e.target.value);
      if (Number.isFinite(v) && v > 0) { model.settings[k] = v; renderAll(false); syncSim(); }
    });
  });
  $("btnReset").addEventListener("click", () => { model = clone(DEFAULTS); syncGlobals(); renderAll(true); resetSim(); });
  $("editor").addEventListener("input", (e) => {
    const t = e.target; const i = +t.dataset.i, k = t.dataset.k;
    if (!k) return;
    const p = model[view].procs[i];
    if (k === "va") p.va = t.checked;
    else {
      let v = parseFloat(t.value);
      if (!Number.isFinite(v)) return;
      if (k === "up") v = Math.min(100, Math.max(1, v));
      if (k === "stations" || k === "ops") v = Math.max(1, Math.round(v));
      p[k] = Math.max(0, v);
    }
    selected = i;
    renderAll(false);
    syncSim();
  });
  $("editor").addEventListener("focusin", (e) => {
    const card = e.target.closest(".pcard"); if (!card) return;
    if (+card.dataset.i !== selected) { selected = +card.dataset.i; renderAll(false); }
  });
  function pickProc(e) {
    const g = e.target.closest(".m-proc"); if (!g) return;
    selected = +g.dataset.i; renderAll(false);
    const card = document.querySelector(`.pcard[data-i="${selected}"]`);
    if (card) card.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
  }
  $("map").addEventListener("click", pickProc);
  $("map").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickProc(e); } });

  /* ---------- Live simulation ---------- */
  let liveEl = null, pulseEl = null;
  let speed = 240, playing = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  let sim = null;
  const TRANSIT = 0.75;             // real seconds a part takes to move between points
  const MEAN_DOWN = 900;            // sim seconds per breakdown
  const expo = (mean) => -Math.log(1 - Math.random()) * mean;
  const upMean = (p) => p.up >= 99.9 ? 1e9 : MEAN_DOWN * (p.up / 100) / (1 - p.up / 100);
  const mkStation = (p) => ({ busy: false, rem: 0, dur: 1, down: false, downRem: 0, upRem: expo(upMean(p)), blocked: false });

  function resetSim() {
    const c = calc();
    sim = {
      t: 0, shipped: 0, acc: 0, pulseAcc: 0, c,
      q: c.procs.map((p) => p.wip),
      st: c.procs.map((p) => Array.from({ length: p.stations }, () => mkStation(p))),
      caps: c.procs.map((p, i) => (view === "future" && i > 0 && p.buf !== "push") ? Math.max(1, p.wip) : Infinity),
      transit: [], pulses: []
    };
    spawnPulse();
  }
  function syncSim() {
    if (!sim) return resetSim();
    const c = calc();
    sim.c = c;
    c.procs.forEach((p, i) => {
      const arr = sim.st[i];
      while (arr.length < p.stations) arr.push(mkStation(p));
      while (arr.length > p.stations) arr.pop();
    });
  }
  const qPt = (i) => [bufX(i), 300];
  const inPt = (i) => [pxOf(i) - 2, PY + 14];
  const outPt = (i) => [pxOf(i) + PW, PY + 14];
  function move(a, b, target) { sim.transit.push({ a, b, k: 0, target }); }
  const pending = (i) => sim.transit.filter((t) => t.target === i).length;

  function release(i) {
    const n = sim.c.procs.length;
    if (i === n - 1) { move(outPt(i), [1160, 170], "ship"); return true; }
    if (sim.q[i + 1] + pending(i + 1) >= sim.caps[i + 1]) return false;
    move(outPt(i), qPt(i + 1), i + 1);
    return true;
  }
  function stepSim(h) {
    const c = sim.c;
    sim.t += h;
    sim.acc += h;
    while (sim.acc >= c.takt) { sim.acc -= c.takt; move([95, 176], qPt(0), 0); }
    c.procs.forEach((p, i) => {
      sim.st[i].forEach((s) => {
        if (s.down) {
          s.downRem -= h;
          if (s.downRem <= 0) { s.down = false; s.upRem = expo(upMean(p)); }
          return;
        }
        s.upRem -= h;
        if (s.upRem <= 0) { s.down = true; s.downRem = expo(MEAN_DOWN); return; }
        if (s.busy) {
          s.rem -= h;
          if (s.rem <= 0) { s.busy = false; s.blocked = !release(i); }
        } else if (s.blocked) {
          s.blocked = !release(i);
        }
        if (!s.busy && !s.blocked && sim.q[i] > 0) {
          sim.q[i]--; s.busy = true;
          s.dur = s.rem = p.ct * (0.9 + Math.random() * 0.2);
          move(qPt(i), inPt(i), null);
        }
      });
    });
  }
  function spawnPulse() {
    const paths = [[[1030, 48], [690, 48]], [[510, 48], [170, 48]]];
    const fut = view === "future";
    sim.c.procs.forEach((p, i) => {
      if (fut && i !== 1 && i !== 5) return;
      paths.push([[600, 82], [pxOf(i) + PW / 2, PY - 6]]);
    });
    paths.forEach((pts, j) => sim.pulses.push({ a: pts[0], b: pts[1], k: -j * 0.12 }));
  }

  function draw() {
    if (!liveEl || !sim) return;
    const c = sim.c, out = [];
    // stations
    c.procs.forEach((p, i) => {
      const x = pxOf(i), arr = sim.st[i], w = (PW - 2) / arr.length;
      let down = 0, blk = 0, busy = 0;
      arr.forEach((s, k) => {
        const col = s.down ? "var(--bad)" : s.blocked ? "var(--warn)" : s.busy ? "var(--ok)" : "var(--line)";
        const frac = s.down || s.blocked ? 1 : s.busy ? 1 - Math.max(0, s.rem) / s.dur : 0;
        out.push(`<rect x="${x + 1 + k * w}" y="${PY + 31}" width="${w - 1}" height="5" fill="var(--grid)"/>`);
        out.push(`<rect x="${x + 1 + k * w}" y="${PY + 31}" width="${Math.max(0, (w - 1) * frac)}" height="5" fill="${col}"/>`);
        if (s.down) down++; else if (s.blocked) blk++; else if (s.busy) busy++;
      });
      const dcol = down ? "var(--bad)" : blk ? "var(--warn)" : busy ? "var(--ok)" : "var(--muted)";
      out.push(`<circle cx="${x + 10}" cy="${PY + 15}" r="${busy && !down ? 4 + Math.sin(performance.now() / 160) * 1.2 : 4}" fill="${dcol}"/>`);
      if (down) out.push(`<text x="${x + PW / 2}" y="${PY + 150}" text-anchor="middle" class="m-down">● DOWN${arr.length > 1 ? ` ${down}/${arr.length}` : ""}</text>`);
      else if (blk) out.push(`<text x="${x + PW / 2}" y="${PY + 150}" text-anchor="middle" class="m-blk">■ BLOCKED</text>`);
      // live queue text
      const q = sim.q[i], qe = $("q" + i), qd = $("qd" + i);
      if (qe) { qe.textContent = Math.round(q).toLocaleString(); qe.style.fill = q > p.wip * 1.15 + 5 ? "var(--bad)" : q < p.wip * 0.85 - 5 ? "var(--ok)" : ""; }
      if (qd) qd.textContent = f(q / c.demand, 2) + " d";
    });
    // parts in motion
    sim.transit.forEach((t) => {
      const e = t.k < 0.5 ? 2 * t.k * t.k : 1 - Math.pow(-2 * t.k + 2, 2) / 2;
      const x = t.a[0] + (t.b[0] - t.a[0]) * e, y = t.a[1] + (t.b[1] - t.a[1]) * e;
      out.push(`<rect x="${x - 4}" y="${y - 4}" width="8" height="8" rx="1.5" class="m-part"/>`);
    });
    liveEl.innerHTML = out.join("");
    pulseEl.innerHTML = sim.pulses.filter((p) => p.k >= 0).map((p) => {
      const x = p.a[0] + (p.b[0] - p.a[0]) * p.k, y = p.a[1] + (p.b[1] - p.a[1]) * p.k;
      return `<circle cx="${x}" cy="${y}" r="5" class="m-pulse" opacity="${1 - p.k * 0.5}"/><circle cx="${x}" cy="${y}" r="${5 + p.k * 6}" fill="none" stroke="var(--flow)" opacity="${0.6 - p.k * 0.6}"/>`;
    }).join("");
    // stats
    const hrs = sim.t / 3600;
    const inProc = sum(sim.st.map((a) => a.filter((s) => s.busy || s.blocked).length));
    const wip = sum(sim.q) + inProc + sim.transit.filter((t) => t.target !== null && t.target !== "ship").length;
    const rate = hrs > 0.05 ? sim.shipped / hrs : 0;
    const need = c.demand / (c.avail / 3600);
    const hh = String(Math.floor(hrs)).padStart(2, "0"), mm = String(Math.floor((sim.t % 3600) / 60)).padStart(2, "0");
    $("liveStats").innerHTML = `<span><span class="livedot"></span>Shift clock <b>${hh}:${mm}</b></span>
      <span>Shipped <b>${sim.shipped.toLocaleString()}</b></span>
      <span>Output <b style="color:${rate && rate < need * 0.97 ? "var(--bad)" : "var(--ink)"}">${rate ? f(rate, 0) : "–"}</b> / ${f(need, 0)} pcs/h needed</span>
      <span>Live WIP <b>${Math.round(wip).toLocaleString()}</b> = <b>${f(wip / c.demand, 2)} d</b></span>`;
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (playing && sim) {
      let simDt = dt * speed;
      const hMax = Math.max(0.5, Math.min(5, sim.c.takt / 4));
      while (simDt > 0) { const h = Math.min(hMax, simDt); stepSim(h); simDt -= h; }
      sim.transit.forEach((t) => { t.k += dt / TRANSIT; });
      sim.transit = sim.transit.filter((t) => {
        if (t.k < 1) return true;
        if (t.target === "ship") sim.shipped++;
        else if (t.target !== null) sim.q[t.target]++;
        return false;
      });
      sim.pulses.forEach((p) => { p.k += dt / 1.4; });
      sim.pulses = sim.pulses.filter((p) => p.k < 1);
      sim.pulseAcc += dt;
      if (sim.pulseAcc > 4) { sim.pulseAcc = 0; spawnPulse(); }
    }
    draw();
    requestAnimationFrame(frame);
  }

  $("btnPlay").addEventListener("click", () => {
    playing = !playing;
    $("btnPlay").textContent = playing ? "Pause" : "Play";
    $("livebar").classList.toggle("paused", !playing);
  });
  $("segSpeed").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    speed = +b.dataset.v; setSeg("segSpeed", b.dataset.v);
  });

  syncGlobals();
  renderAll(true);
  resetSim();
  if (!playing) { $("btnPlay").textContent = "Play"; $("livebar").classList.add("paused"); }
  requestAnimationFrame(frame);
})();
