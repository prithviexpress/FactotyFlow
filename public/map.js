/* Plant block layout (central flow): blocks in the plant's arrangement + sequenced-material flows (AMR / tow truck).
 * FFMap.render(S, ctx) -> { flows, nodes } SVG strings for the 1152 x 384 map.
 * The block grid mirrors the plant drawing. Truck parking & bays, motorpool and shipment are NOT in that drawing, so by default they are
 * shown in a separate "logistics areas" strip (not positioned); a block can be assigned to one under Interfaces -> Plant layout. */
(function () {
  'use strict';
  const Sim = window.FactorySim;
  const X = (s) => String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const tx = (x, y, s, cls, extra) => '<text x="' + x + '" y="' + y + '" class="' + (cls || '') + '" ' + (extra || '') + '>' + X(s) + '</text>';

  /* ---- geometry (viewBox 1152 x 384) ---- */
  const R1 = { y: 6, h: 132 }, R2B = { y: 164, h: 56 }, R2A = { y: 226, h: 56 };
  const G = {
    jv: { x: 8, y: R1.y, w: 275, h: R1.h }, yard: { x: 291, y: R1.y, w: 282, h: R1.h }, egtm: { x: 581, y: R1.y, w: 90, h: R1.h },
    top1: { x: 679, y: R1.y, w: 210, h: 62 }, imma: { x: 679, y: 76, w: 210, h: 62 }, top2: { x: 897, y: R1.y, w: 120, h: R1.h }, top3: { x: 1025, y: R1.y, w: 119, h: R1.h },
    press: { x: 8, y: R2B.y, w: 134, h: 118 }, weldB: { x: 160, y: R2B.y, w: 123, h: R2B.h }, weldA: { x: 160, y: R2A.y, w: 123, h: R2A.h },
    paintB: { x: 291, y: R2B.y, w: 282, h: R2B.h }, paintA: { x: 291, y: R2A.y, w: 282, h: R2A.h },
    asmB: { x: 581, y: R2B.y, w: 563, h: R2B.h }, asmA: { x: 581, y: R2A.y, w: 563, h: R2A.h }
  };
  const BUS_Y = 151, CH_X = 577, A_BOT = 294;      // top bus lane; the gap between paint and assembly; the lane under assembly A (mirror of the bus above B)
  const ROUTES = {                                  // sequenced-material paths. B: along the bus, drop into assembly B from the TOP.
                                                    // A: along the bus, down the gap between paint and assembly, then along the lane UNDER assembly A and up into it (mirror of B).
    'jv-b': 'M230,138 V' + BUS_Y + ' H600 V164', 'jv-a': 'M230,138 V' + BUS_Y + ' H' + CH_X + ' V' + A_BOT + ' H600 V282',
    'eg-b': 'M626,138 V' + BUS_Y + ' H700 V164', 'eg-a': 'M626,138 V' + BUS_Y + ' H' + CH_X + ' V' + A_BOT + ' H700 V282',
    'im-b': 'M784,138 V' + BUS_Y + ' H860 V164', 'im-a': 'M784,138 V' + BUS_Y + ' H' + CH_X + ' V' + A_BOT + ' H860 V282',
    'pr-wb': 'M142,192 H158', 'pr-wa': 'M142,254 H158'
  };
  const approxLen = (d) => { let x = 0, y = 0, len = 0; (d.match(/[MHV][^MHV]*/g) || []).forEach((c) => { const t = c[0], v = parseFloat(c.slice(1)); if (t === 'M') { const m = c.slice(1).split(','); x = +m[0]; y = +m[1]; } else if (t === 'H') { len += Math.abs(v - x); x = v; } else { len += Math.abs(v - y); y = v; } }); return len || 1; };

  const fit = (s, w, px) => { s = String(s === undefined || s === null ? '' : s); const max = Math.max(3, Math.floor(w / (px || 9))); return s.length > max ? s.slice(0, max - 1) + '…' : s; };
  const cls = (g) => (g.h >= 120 && g.w >= 240 ? 'large' : g.h >= 120 ? 'tall' : 'wide');          // widgets adapt to the block they are placed in
  const status = (v) => Sim.bufferStatus(v);
  const hh = (h) => (h === null || h === undefined ? '' : (h < 10 ? h.toFixed(1) : Math.round(h)) + ' h');

  const TINT = { ok: 'var(--ok)', watch: 'var(--watch)', low: 'var(--low)', none: 'var(--ink3)' };
  function pill(x, y, s, st, anchor) {              // soft status chip: tinted background, coloured text, hairline border
    const w = Math.max(32, String(s).length * 6.7 + 14), x0 = anchor === 'end' ? x - w : x;
    return '<rect x="' + x0 + '" y="' + y + '" width="' + w + '" height="17" rx="8.5" fill="' + TINT[st] + '" fill-opacity=".16" stroke="' + TINT[st] + '" stroke-opacity=".55" stroke-width="1"/>' +
      '<text x="' + (x0 + w / 2) + '" y="' + (y + 12.2) + '" class="pl" text-anchor="middle" style="fill:' + TINT[st] + '">' + X(s) + '</text>';
  }
  function tag(x, y, s, late) {
    const w = String(s).length * 5.9 + 12;
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="15" rx="7.5" fill="' + (late ? 'var(--low)' : 'var(--card2)') + '" fill-opacity="' + (late ? '.16' : '1') + '" stroke="' + (late ? 'var(--low)' : 'var(--cardline)') + '" stroke-width="1"/>' +
      '<text x="' + (x + w / 2) + '" y="' + (y + 10.7) + '" class="tg" text-anchor="middle" style="fill:' + (late ? 'var(--low)' : 'var(--ink2)') + '">' + X(s) + '</text>';
  }
  /** flat card with a status accent on the left edge. A widget the user placed in a block that is not confirmed gets the dashed ASSUMED POSITION look. */
  function block(o) {
    const assumed = o.kind === 'light' && !o.confirmed;
    const c = 'nd blk k-' + o.kind + (assumed ? ' assumed' : '') + (o.sel ? ' sel' : '') + (o.dim ? ' dim' : '') + (o.st === 'low' ? ' problem' : '');
    const accent = o.st && o.st !== 'none' ? TINT[o.st] : 'var(--cyan)';
    const tw = 112;
    return '<g class="' + c + '" data-node="' + o.id + '" data-href="' + (o.href || '') + '"' + (o.fleet ? ' data-fleet="jv"' : '') + ' data-shop="' + (o.family || '') + '"' + (o.tip ? ' data-tip="' + X(o.tip).replace(/"/g, '&quot;') + '"' : '') + '>' +
      '<rect class="bk" x="' + o.x + '" y="' + o.y + '" width="' + o.w + '" height="' + o.h + '" rx="12"/>' +
      (assumed ? '<rect class="hatch" x="' + o.x + '" y="' + o.y + '" width="' + o.w + '" height="' + o.h + '" rx="12" fill="url(#hatch)"/>' : '') +
      '<rect class="ac" x="' + (o.x + 1) + '" y="' + (o.y + 12) + '" width="4" height="' + Math.max(8, o.h - 24) + '" rx="2" fill="' + accent + '"/>' + (o.inner || '') +
      (assumed ? '<rect x="' + (o.x + o.w - tw - 8) + '" y="' + (o.y - 6) + '" width="' + tw + '" height="14" rx="7" class="asm-tag"/><text x="' + (o.x + o.w - tw / 2 - 8) + '" y="' + (o.y + 4) + '" class="asm-txt" text-anchor="middle">ASSUMED POSITION</text>' : '') + '</g>';
  }
  function bar(x, y, w, pct, st) {
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="4" rx="2" style="fill:var(--track)"/><rect x="' + x + '" y="' + y + '" width="' + Math.max(0, Math.min(w, (w * pct) / 100)).toFixed(1) + '" height="4" rx="2" fill="' + TINT[st === 'none' ? 'ok' : st] + '"/>';
  }

  function render(S, c) {
    const { T, f0, ui } = c, SL = S.setup.slots, IV = c.IV, y = S.yard;
    const wip = {}; IV.wip.forEach((w) => { wip[w.id] = w; });
    const sel = (fam) => !!fam && ui.shop === fam, dim = (fam) => !!fam && ui.shop !== 'all' && ui.shop !== fam;
    const label = (slot, fallback) => (SL[slot] && SL[slot].label) || fallback;
    const out = [];
    const split = Sim.lineSplit(S);
    const TIPS = {
      egtm: 'EGTM · shows the Engine shop buffer and the Engine → Assembly transfer route. Mapping EGTM to the engine shop is an assumption; confirm it matches your plant.',
      imma: 'IMM-A · shows the Bumper shop buffer and the Bumper → Assembly transfer route. Mapping IMM-A to the bumper shop is an assumption; confirm it matches your plant.',
      press: 'Press A/B · press buffer. Feeds weld lines A and B (sequenced, tow truck by default).',
      weldA: 'Weld line A · weld A buffer', weldB: 'Weld line B · weld B buffer', paintA: 'Paint line A · paint A buffer', paintB: 'Paint line B · paint B buffer',
      asmA: 'Assembly line A · built vs plan' + (split.derived ? ' (half of the total until per-line counts are pushed)' : '') + '. JV / EGTM / IMM-A material reaches it through the gap between paint and assembly, then up into it from underneath (mirror of the drops into B).',
      asmB: 'Assembly line B · built vs plan' + (split.derived ? ' (half of the total until per-line counts are pushed)' : '') + '. Sequenced material drops in from the top.',
      jv: 'JV zone · one tile per JV (names in Plant setup): buffer hours and route on-time.'
    };
    const LIGHT_TIP = { yard: 'Truck parking & bays', motorpool: 'Motorpool', shipment: 'Shipment' };

    /* carriers / transfer status per sequence source */
    const tr = (id) => S.transfers.find((t) => t.id === id);
    const pctOf = (t) => (t ? (t.q.reduce((a, b) => a + b, 0) / t.q.length) * 100 : null);
    const jvPct = S.jv.routes.length ? S.jv.routes.reduce((a, r) => a + r.ema * 100, 0) / S.jv.routes.length : null;
    const jvLate = S.jv.routes.some((r) => Sim.routeStatus(r.ema * 100) === 'low');
    const SRC = {
      jv: { mode: (SL.jv.carrier || 'tow'), pct: jvPct, late: jvLate },
      egtm: { mode: (SL.egtm.carrier || 'amr'), pct: pctOf(tr('eng')), late: pctOf(tr('eng')) < 78 },
      imma: { mode: (SL.imma.carrier || 'amr'), pct: pctOf(tr('bmp')), late: pctOf(tr('bmp')) < 78 },
      press: { mode: (SL.press.carrier || 'tow'), pct: null, late: false }
    };
    const srcTag = (k, x, yy) => tag(x, yy, SRC[k].mode.toUpperCase() + (SRC[k].pct === null ? '' : ' · ' + Math.round(SRC[k].pct) + '%') + (SRC[k].late ? ' LATE' : ''), SRC[k].late);

    /* ---- JV zone with one tile per JV ---- */
    {
      const g = G.jv, n = S.jvSites.length, cols = n <= 2 ? n : n <= 4 ? 2 : 3, rows = Math.ceil(n / cols);
      const ax = g.x + 10, ay = g.y + 30, aw = g.w - 20, ah = g.h - 30 - 8, tw = (aw - (cols - 1) * 8) / cols, th = (ah - (rows - 1) * 8) / rows;
      let tiles = '', worst = 'ok';
      S.jvSites.forEach((j, i) => {
        const col = i % cols, row = Math.floor(i / cols), tx0 = ax + col * (tw + 8), ty0 = ay + row * (th + 8);
        const r = S.jv.routes.find((q) => (q.key || '').toLowerCase() === j.name.toLowerCase() || q.name.toLowerCase().indexOf(j.name.toLowerCase() + ' ') === 0);
        const rp = r ? r.ema * 100 : null, rst = rp === null ? 'ok' : Sim.routeStatus(rp), bst = status(j.buf);
        const st = rst === 'low' || bst === 'low' ? 'low' : rst === 'watch' || bst === 'watch' ? 'watch' : 'ok';
        if (st === 'low') worst = 'low'; else if (st === 'watch' && worst === 'ok') worst = 'watch';
        const mx = Math.max(4, Math.floor((tw - 56) / 7)), nm = j.name.length > mx ? j.name.slice(0, mx - 1) + '…' : j.name;
        const w = wip['jv:' + j.name];
        tiles += '<g class="nd jvt' + (st === 'low' ? ' problem' : '') + '" data-node="jv' + i + '" data-href="#/amr" data-fleet="jv" data-shop="">' +
          '<rect class="tile" x="' + tx0 + '" y="' + ty0 + '" width="' + tw + '" height="' + th + '" rx="7"/>' +
          tx(tx0 + 9, ty0 + 15, nm, 't1') + pill(tx0 + tw - 6, ty0 + 3, f0(j.buf) + '%', bst, 'end') +
          '<text x="' + (tx0 + 9) + '" y="' + (ty0 + th - 14) + '" class="sm">' + X(w && w.hours !== null ? hh(w.hours) : '') +
          (rp !== null ? '<tspan style="font-weight:700;fill:' + TINT[rst] + '">' + (w && w.hours !== null ? ' · ' : '') + f0(rp) + '% on time</tspan>' : '') + '</text>' +
          bar(tx0 + 9, ty0 + th - 8, tw - 18, j.buf, bst) + '</g>';
      });
      const t = SRC.jv.mode.toUpperCase() + (SRC.jv.pct === null ? '' : ' · ' + Math.round(SRC.jv.pct) + '%') + (SRC.jv.late ? ' LATE' : '');
      out.push(block({ id: 'jvzone', kind: 'jv', tip: TIPS.jv, x: g.x, y: g.y, w: g.w, h: g.h, st: worst === 'low' ? 'none' : worst, inner:
        tx(g.x + 14, g.y + 21, fit(label('jv', 'JV'), 60, 9), 'bt') + tx(g.x + 18 + Math.min(String(label('jv', 'JV')).length, 6) * 9.5, g.y + 21, n + ' site' + (n === 1 ? '' : 's') + ' · sequenced supply', 'sm') + tiles +
        srcTag('jv', g.x + g.w - (t.length * 5.9 + 12) - 10, g.y + 7) }));
    }

    /* ---- logistics widgets: truck parking & bays, motorpool, shipment ---- */
    function yardInner(g, title) {
      const waiting = Math.max(0, y.arrived - y.docked), rows = [['parked', y.expected], ['arrived', y.arrived], [T('atBay').toLowerCase(), y.docked], ['received', y.received]], k = cls(g);
      const full = y.occupied >= y.docks, st = full ? 'low' : waiting >= 6 || y.occupied / y.docks > 0.92 ? 'watch' : 'ok';
      const wst = waiting >= 6 ? 'low' : waiting >= 3 ? 'watch' : 'ok', bays = y.occupied + ' / ' + y.docks + ' ' + T('bays').toLowerCase();
      if (k === 'large') {
        let cells = '';
        const cx0 = g.x + g.w - 14 - 7 * 15, cy0 = g.y + 34;
        for (let i = 0; i < y.docks; i++) { const cc = i % 7, cr = Math.floor(i / 7); cells += '<rect x="' + (cx0 + cc * 15) + '" y="' + (cy0 + cr * 14) + '" width="12" height="11" rx="3" style="fill:' + (i < y.occupied ? 'var(--cyan)' : 'var(--track)') + '"/>'; }
        return { st, inner: tx(g.x + 14, g.y + 22, fit(title, g.w - 98, 8.4), 'bt') + pill(g.x + g.w - 10, g.y + 7, waiting + ' waiting', wst, 'end') +
          rows.map((r, i) => tx(g.x + 16, g.y + 48 + i * 19, r[1], 'bn2') + tx(g.x + 54, g.y + 48 + i * 19, r[0], 'sm')).join('') + cells + tx(cx0, cy0 + 4 * 14 + 12, bays, 'bn2') +
          tx(g.x + 16, g.y + g.h - 9, 'gate → ' + T('bay').toLowerCase() + ' ' + f0(y.g2d) + ' min', 'sm') };
      }
      if (k === 'tall') {
        return { st, inner: tx(g.x + 12, g.y + 22, fit(title, g.w - 20, 8.4), 'bt') + pill(g.x + 12, g.y + 30, waiting + ' waiting', wst) +
          tx(g.x + 12, g.y + 78, y.occupied + ' / ' + y.docks, 'bn') + tx(g.x + 12, g.y + 93, T('bays').toLowerCase() + ' in use', 'sm') + tx(g.x + 12, g.y + 116, y.arrived + ' arrived · ' + y.received + ' done', 'sm') };
      }
      return { st, inner: tx(g.x + 14, g.y + 20, fit(title, g.w - 100, 8.4), 'bt') + pill(g.x + g.w - 10, g.y + 4, waiting + ' waiting', wst, 'end') + tx(g.x + 14, g.y + 45, y.occupied + ' / ' + y.docks, 'bn2') + tx(g.x + 70, g.y + 45, T('bays').toLowerCase() + ' in use', 'sm') };
    }
    function motorInner(g, slot) {
      const f = S.finished, st = f.onTime >= 90 ? 'ok' : f.onTime >= 85 ? 'watch' : 'low', h = IV.finished.hours, k = cls(g), nm = label(slot, '') || T('motorpool').toUpperCase();
      if (k === 'wide') return { st, inner: tx(g.x + 14, g.y + 20, fit(nm, g.w - 110, 8.4), 'bt') + pill(g.x + g.w - 10, g.y + 4, f0(f.onTime) + '% on time', st, 'end') + tx(g.x + 14, g.y + 46, f0(f.units), 'bn2') + tx(g.x + 14 + String(f0(f.units)).length * 9 + 6, g.y + 46, 'vehicles' + (h !== null ? ' · ' + hh(h) + ' of stock' : ''), 'sm') };
      return { st, inner: tx(g.x + 12, g.y + 22, fit(nm, g.w - 20, 8.4), 'bt') + pill(g.x + 12, g.y + 30, f0(f.onTime) + '% on time', st) + tx(g.x + 12, g.y + 78, f0(f.units), 'bn') + tx(g.x + 12, g.y + 93, 'vehicles', 'sm') + tx(g.x + 12, g.y + 112, h !== null ? hh(h) + ' of stock' : '', 'sm') };
    }
    function shipInner(g, slot) {
      const so = S.finished.shipOnTime, st = so >= 90 ? 'ok' : so >= 85 ? 'watch' : 'low', k = cls(g), nm = label(slot, 'SHIPMENT');
      const ring = (cx, cy, r, sw) => { const C = 2 * Math.PI * r; return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" style="stroke:var(--track)" stroke-width="' + sw + '"/>' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + TINT[st] + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-dasharray="' + (C * Math.min(1, so / 100)).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"/>' + tx(cx, cy + 5, f0(so) + '%', k === 'wide' ? 'pl' : 'bn2', 'text-anchor="middle"'); };
      if (k === 'wide') return { st, inner: tx(g.x + 14, g.y + 20, fit(nm, g.w - 20, 8.4), 'bt') + ring(g.x + 34, g.y + 41, 14, 5) + tx(g.x + 62, g.y + 44, 'on-time shipments', 'sm') };
      return { st, inner: tx(g.x + 14, g.y + 22, fit(nm, g.w - 20, 8.4), 'bt') + ring(g.x + g.w / 2, g.y + 70, 30, 7) + tx(g.x + g.w / 2, g.y + 118, 'on-time shipments', 'sm', 'text-anchor="middle"') };
    }
    const HREF = { yard: '#/inbound', motorpool: '#/inventory', shipment: '#/shop/assembly' };
    const innerOf = (bind, g, slot) => (bind === 'yard' ? yardInner(g, label(slot, '') || (T('parking') + ' & ' + T('bays')).toUpperCase()) : bind === 'motorpool' ? motorInner(g, slot) : shipInner(g, slot));

    /* ---- movement-health overlays (AMR fleets, kanban). Drawn as transparent instrument panels, NOT as cards, so they are not mistaken for shops of the layout ---- */
    function overlay(id, g, title, st, href, tip, inner) {
      const hd = 20, c = 'nd ovl' + (st === 'low' ? ' problem' : '');
      return '<g class="' + c + '" data-node="' + id + '" data-href="' + href + '" data-shop="" data-tip="' + X(tip).replace(/"/g, '&quot;') + '">' +
        '<rect class="obk" x="' + g.x + '" y="' + g.y + '" width="' + g.w + '" height="' + g.h + '" rx="3"/>' +
        '<path class="ohd" d="M' + g.x + ' ' + g.y + ' h' + g.w + ' v' + hd + ' h-' + g.w + ' z"/>' +
        '<circle cx="' + (g.x + 12) + '" cy="' + (g.y + 10) + '" r="3.5" fill="' + TINT[st] + '"/>' +
        '<text x="' + (g.x + 22) + '" y="' + (g.y + 14) + '" class="otl">' + X(title) + '</text>' +
        '<text x="' + (g.x + g.w - 8) + '" y="' + (g.y + 14) + '" class="otr" text-anchor="end">' + (g.w >= 270 ? 'OVERLAY · NOT A SHOP' : 'OVERLAY') + '</text>' + inner + '</g>';
    }
    const seg3 = (x, y2, w, a, b, c3) => { const t = Math.max(1, a + b + c3), wa = (w * a) / t, wb = (w * b) / t; return '<rect x="' + x + '" y="' + y2 + '" width="' + w + '" height="7" rx="3.5" style="fill:var(--track)"/><rect x="' + x + '" y="' + y2 + '" width="' + wa.toFixed(1) + '" height="7" rx="3.5" fill="var(--ok)"/><rect x="' + (x + wa).toFixed(1) + '" y="' + y2 + '" width="' + wb.toFixed(1) + '" height="7" fill="var(--cyan)"/><rect x="' + (x + wa + wb).toFixed(1) + '" y="' + y2 + '" width="' + ((w * c3) / t).toFixed(1) + '" height="7" rx="3.5" fill="var(--watch)"/>'; };
    const ringO = (cx, cy, r, pctv, st, main, sub) => { const C = 2 * Math.PI * r; return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" style="stroke:var(--track)" stroke-width="5"/><circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + TINT[st] + '" stroke-width="5" stroke-linecap="round" stroke-dasharray="' + (C * Math.max(0, Math.min(1, pctv / 100))).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"/>' + tx(cx, cy + 3, main, 'on', 'text-anchor="middle"') + tx(cx, cy + 14, sub, 'os', 'text-anchor="middle"'); };
    const chip = (x, y2, w, label2, val, st) => '<rect x="' + x + '" y="' + y2 + '" width="' + w + '" height="16" rx="2" fill="none" stroke="' + TINT[st] + '" stroke-opacity=".6"/>' + tx(x + 6, y2 + 11.5, label2, 'os') + tx(x + w - 6, y2 + 11.5, val, 'on2', 'text-anchor="end" style="fill:' + TINT[st] + '"');
    function amrOverlay(g) {
      const H = Sim.amrHealth(S), ind = H.rows[0], jv = H.rows[1], bst = ind.battery >= 50 ? 'ok' : ind.battery >= 30 ? 'watch' : 'low';
      const row = (r, label2, y2) => tx(g.x + 10, y2 + 7, label2, 'os') + seg3(g.x + 56, y2, 112, r.avail, r.busy, r.charging) + tx(g.x + 176, y2 + 7, (r.avail + r.busy) + '/' + r.total, 'on2');
      const lowAll = ind.low + jv.low, late = ind.late + jv.late, utilTxt = f0(ind.util) + '%';
      return overlay('amrhealth', g, 'AMR FLEET HEALTH', H.status, '#/amr', 'AMR fleet health · indoor and JV fleets: units available or busy (green + blue) vs charging (amber), average battery, low-battery units, utilisation and late routes. Red: a late route, 3+ low batteries or under 60% available. Overlay on the plant map; it is not a shop.',
        row(ind, 'INDOOR', g.y + 32) + row(jv, 'JV', g.y + 52) +
        '<g class="lg">' + '<rect x="' + (g.x + 56) + '" y="' + (g.y + 68) + '" width="6" height="6" fill="var(--ok)"/>' + tx(g.x + 65, g.y + 74, 'idle', 'os') + '<rect x="' + (g.x + 90) + '" y="' + (g.y + 68) + '" width="6" height="6" fill="var(--cyan)"/>' + tx(g.x + 99, g.y + 74, 'busy', 'os') + '<rect x="' + (g.x + 126) + '" y="' + (g.y + 68) + '" width="6" height="6" fill="var(--watch)"/>' + tx(g.x + 135, g.y + 74, 'charging', 'os') + '</g>' +
        ringO(g.x + g.w - 40, g.y + 56, 22, ind.battery, bst, f0(ind.battery) + '%', 'batt') +
        chip(g.x + 10, g.y + 96, 80, 'LOW BATT', String(lowAll), lowAll >= 3 ? 'low' : lowAll >= 1 ? 'watch' : 'ok') + chip(g.x + 96, g.y + 96, 80, 'LATE RTE', String(late), late ? 'low' : 'ok') + chip(g.x + 182, g.y + 96, 90, 'UTIL', utilTxt, ind.util > 85 ? 'watch' : 'ok') +
        tx(g.x + 10, g.y + 124, 'missions ' + ind.done + '/' + ind.planned + ' indoor · ' + jv.done + '/' + jv.planned + ' JV', 'os'));
    }
    function kanbanOverlay(g) {
      const k = S.kanban, st = Sim.kanbanStatus(k), wide = g.w >= 200;
      const lanes = S.lineside.slice(0, 5);
      if (!wide) {
        return overlay('kanbanhealth', g, 'KANBAN', st, '#/lineside', 'Kanban transfer health (narrow view)', ringO(g.x + g.w / 2, g.y + 52, 24, k.onTimePct, st, f0(k.onTimePct) + '%', 'on time') + tx(g.x + 10, g.y + 100, 'open ' + f0(k.open), 'on2') + tx(g.x + 10, g.y + 116, 'overdue ' + f0(k.overdue), 'on2', 'style="fill:' + TINT[k.overdue >= 4 ? 'low' : k.overdue >= 2 ? 'watch' : 'ok'] + '"'));
      }
      const lw = (g.w - 20 - (lanes.length - 1) * 4) / lanes.length;
      return overlay('kanbanhealth', g, 'KANBAN TRANSFERS', st, '#/lineside', 'Kanban transfer health · pull signals: on-time rate, open and overdue signals, average wait; lanes = key line-side materials coloured by their stock status. Red: 4+ overdue or on-time under 85%. Overlay on the plant map; it is not a shop.',
        ringO(g.x + 44, g.y + 56, 24, k.onTimePct, st, f0(k.onTimePct) + '%', 'on time') +
        [['OPEN SIGNALS', f0(k.open), 'ok'], ['OVERDUE', f0(k.overdue), k.overdue >= 4 ? 'low' : k.overdue >= 2 ? 'watch' : 'ok'], ['AVG WAIT', f0(k.avgWaitMin) + ' min', k.avgWaitMin > 30 ? 'watch' : 'ok'], ['CARDS IN LOOP', f0(k.cards), 'ok']].map((r, i) =>
          tx(g.x + 84, g.y + 36 + i * 16, r[0], 'os') + tx(g.x + g.w - 10, g.y + 36 + i * 16, r[1], 'on2', 'text-anchor="end" style="fill:' + TINT[r[2]] + '"')).join('') +
        lanes.map((l, i) => { const ls2 = Sim.linesideStatus(l), lx = g.x + 10 + i * (lw + 4); return '<rect x="' + lx + '" y="' + (g.y + 98) + '" width="' + lw + '" height="22" rx="2" fill="' + TINT[ls2] + '" fill-opacity=".14" stroke="' + TINT[ls2] + '" stroke-opacity=".7"/>' + tx(lx + lw / 2, g.y + 112, fit(l.name.replace(/\s*\(.*$/, '').split(' ')[0], lw - 4, 5.6).toUpperCase(), 'os', 'text-anchor="middle" style="fill:' + TINT[ls2] + '"'); }).join(''));
    }

    /* the four light blocks of the drawing: unnamed there. They hold an overlay or a logistics widget only if you assign one; otherwise they stay placeholders. */
    const placed = new Set(); let top3Taken = false;
    ['yard', 'top1', 'top2', 'top3'].forEach((slot) => {
      if (slot === 'top3' && top3Taken) return;
      let g = G[slot];
      const bind = (SL[slot] && SL[slot].bind) || 'none', lbl = (SL[slot] && SL[slot].label) || '';
      if (bind === 'amr') { out.push(amrOverlay(g)); return; }
      if (bind === 'kanban') {
        if (slot === 'top2' && (!SL.top3 || SL.top3.bind === 'none' || SL.top3.bind === undefined)) { g = { x: G.top2.x, y: G.top2.y, w: G.top3.x + G.top3.w - G.top2.x, h: G.top2.h }; top3Taken = true; }
        out.push(kanbanOverlay(g)); return;
      }
      if (!HREF[bind]) {
        out.push('<g class="nd blk k-empty" data-tip="Not named in the plant drawing. You can name it or put truck parking & bays / motorpool / shipment / AMR health / kanban health here under Interfaces → Plant setup → Plant layout."><rect class="bk" x="' + g.x + '" y="' + g.y + '" width="' + g.w + '" height="' + g.h + '" rx="12"/>' +
          tx(g.x + g.w / 2, g.y + g.h / 2 + (lbl ? 0 : -3), lbl || 'unnamed block', 'bt', 'text-anchor="middle"') + (lbl ? '' : tx(g.x + g.w / 2, g.y + g.h / 2 + 12, 'not in drawing', 'sm', 'text-anchor="middle"')) + '</g>');
        return;
      }
      placed.add(bind);
      const r = innerOf(bind, g, slot), cf = !!(SL[slot] && SL[slot].confirmed);
      out.push(block({ id: slot, kind: 'light', confirmed: cf, tip: LIGHT_TIP[bind] + ' · ' + (cf ? 'position confirmed.' : 'you placed this here; it is marked as assumed until you tick "confirmed" under Interfaces → Plant setup → Plant layout.'), x: g.x, y: g.y, w: g.w, h: g.h, st: r.st, href: HREF[bind], inner: r.inner }));
    });

    /* ---- shop-style blocks ---- */
    function shop(slot, key, family, src, fallbackLabel) {
      const g = G[slot], s = S.shops[key], st = status(s.buf), w = wip[key], tall = g.h > 100, nm = label(slot, fallbackLabel);
      let inner;
      if (tall) {
        inner = tx(g.x + 12, g.y + 22, fit(nm, g.w - 18, 8.4), 'bt') + pill(g.x + 12, g.y + 30, f0(s.buf) + '%', st) + tx(g.x + 12, g.y + 66, 'Buffer stock', 'sm') + tx(g.x + 12, g.y + 83, w && w.hours !== null ? hh(w.hours) : '—', 'bn2') +
          bar(g.x + 12, g.y + g.h - 30, g.w - 24, s.buf, st) + (src ? srcTag(src, g.x + 10, g.y + g.h - 22) : '');
      } else {
        inner = tx(g.x + 12, g.y + 19, fit(nm, g.w - 66, 8.4), 'bt') + pill(g.x + g.w - 9, g.y + 4, f0(s.buf) + '%', st, 'end') + tx(g.x + 12, g.y + g.h - 21, 'Buffer' + (w && w.hours !== null ? ' · ' + hh(w.hours) : ''), 'sm') + bar(g.x + 12, g.y + g.h - 11, g.w - 24, s.buf, st);
      }
      out.push(block({ id: slot, kind: 'prod', tip: TIPS[slot], x: g.x, y: g.y, w: g.w, h: g.h, st, family, sel: sel(family), dim: dim(family), inner }));
    }
    shop('egtm', 'engine', 'engine', 'egtm', 'EGTM');
    shop('imma', 'bumper', 'bumper', 'imma', 'IMM-A');
    {
      const g = G.press, s = S.shops.press, st = status(s.buf), w = wip.press;
      out.push(block({ id: 'press', kind: 'prod', tip: TIPS.press, x: g.x, y: g.y, w: g.w, h: g.h, st, family: 'press', sel: sel('press'), dim: dim('press'), inner:
        tx(g.x + 12, g.y + 22, fit(label('press', 'PRESS A/B'), g.w - 18, 8.4), 'bt') + pill(g.x + 12, g.y + 30, f0(s.buf) + '%', st) + tx(g.x + 12, g.y + 66, 'Buffer stock', 'sm') +
        tx(g.x + 12, g.y + 83, w && w.hours !== null ? hh(w.hours) : '—', 'bn2') + bar(g.x + 12, g.y + g.h - 30, g.w - 24, s.buf, st) + srcTag('press', g.x + 10, g.y + g.h - 22) }));
    }
    shop('weldB', 'weldB', 'weld', null, 'WELD B'); shop('weldA', 'weldA', 'weld', null, 'WELD A');
    shop('paintB', 'paintB', 'paint', null, 'PAINT B'); shop('paintA', 'paintA', 'paint', null, 'PAINT A');

    /* ---- assembly lines A / B ---- */
    const stopped = S.line.stopped;
    [['asmB', 'B'], ['asmA', 'A']].forEach(([slot, L]) => {
      const g = G[slot], d = split[L], pct = d.plan ? (d.actual / d.plan) * 100 : 0, st = stopped ? 'low' : 'ok', nm = label(slot, 'ASSEMBLY ' + L), bw = g.w - 330;
      out.push(block({ id: slot, kind: 'asm', tip: TIPS[slot], x: g.x, y: g.y, w: g.w, h: g.h, st, family: 'assembly', href: '#/shop/assembly', sel: sel('assembly'), dim: dim('assembly'), inner:
        tx(g.x + 16, g.y + 22, fit(nm, 190, 9), 'bt') + pill(g.x + 16 + Math.min(String(nm).length, 21) * 9 + 14, g.y + 8, stopped ? 'STOPPED' : 'RUNNING', stopped ? 'low' : 'ok') +
        tx(g.x + 16, g.y + 47, f0(d.actual), 'bn') + tx(g.x + 16 + String(f0(d.actual)).length * 13 + 6, g.y + 46, '/ ' + d.plan + ' vehicles' + (split.derived ? ' (half of total)' : ''), 'sm') +
        '<rect x="' + (g.x + 250) + '" y="' + (g.y + 32) + '" width="' + bw + '" height="8" rx="4" style="fill:var(--track)"/><rect x="' + (g.x + 250) + '" y="' + (g.y + 32) + '" width="' + Math.max(0, Math.min(bw, (bw * pct) / 100)).toFixed(1) + '" height="8" rx="4" fill="' + TINT[st] + '"/>' +
        pill(g.x + g.w - 12, g.y + 27, f0(pct) + '%', st, 'end') }));
    });

    /* ---- logistics areas: not part of the plant drawing, so shown apart from it ---- */
    const strip = ['yard', 'motorpool', 'shipment'].filter((b) => !placed.has(b));
    if (strip.length) {
      const zx = 4, zy = 304, zw = 1144, zh = 76, n = strip.length, cw = (zw - 16 - (n - 1) * 8) / n, cy = zy + 22, ch = 48;
      let cards = '';
      strip.forEach((b, i) => {
        const g = { x: zx + 8 + i * (cw + 8), y: cy, w: cw, h: ch }, id = 'logi-' + b;
        let inner, st, nm;
        if (b === 'yard') {
          const waiting = Math.max(0, y.arrived - y.docked), full = y.occupied >= y.docks;
          st = full ? 'low' : waiting >= 6 || y.occupied / y.docks > 0.92 ? 'watch' : 'ok'; nm = (SL.yard.label || (T('parking') + ' & ' + T('bays'))).toUpperCase();
          inner = tx(g.x + 16, g.y + 17, fit(nm, g.w - 150, 8.4), 'bt') + pill(g.x + g.w - 10, g.y + 3, waiting + ' waiting', waiting >= 6 ? 'low' : waiting >= 3 ? 'watch' : 'ok', 'end') +
            tx(g.x + 16, g.y + 31, y.expected + ' parked · ' + y.arrived + ' arrived · ' + y.docked + ' ' + T('atBay').toLowerCase() + ' · ' + y.received + ' received', 'sm') +
            bar(g.x + 16, g.y + g.h - 9, g.w - 150, (y.occupied / Math.max(1, y.docks)) * 100, st) + tx(g.x + g.w - 12, g.y + g.h - 5, y.occupied + ' / ' + y.docks + ' ' + T('bays').toLowerCase(), 'bn2', 'text-anchor="end"');
        } else if (b === 'motorpool') {
          const f = S.finished, h = IV.finished.hours; st = f.onTime >= 90 ? 'ok' : f.onTime >= 85 ? 'watch' : 'low'; nm = T('motorpool').toUpperCase();
          inner = tx(g.x + 16, g.y + 17, fit(nm, g.w - 120, 8.4), 'bt') + pill(g.x + g.w - 10, g.y + 3, f0(f.onTime) + '% on time', st, 'end') +
            tx(g.x + 16, g.y + 39, f0(f.units), 'bn2') + tx(g.x + 16 + String(f0(f.units)).length * 9 + 6, g.y + 39, 'vehicles' + (h !== null ? ' · ' + hh(h) + ' of stock' : '') + ' · dispatch ' + (f.shipRate || 0).toFixed(1) + ' / min', 'sm');
        } else {
          const so = S.finished.shipOnTime; st = so >= 90 ? 'ok' : so >= 85 ? 'watch' : 'low'; nm = 'SHIPMENT';
          inner = tx(g.x + 16, g.y + 17, nm, 'bt') + pill(g.x + g.w - 10, g.y + 3, f0(so) + '% on time', st, 'end') + tx(g.x + 16, g.y + 39, f0(so) + '%', 'bn2') + bar(g.x + 60, g.y + 33, g.w - 76, so, st);
        }
        cards += block({ id: id, kind: 'logi', st, href: HREF[b], tip: nm + ' · not part of the plant drawing, so it is not drawn at a position. Assign it to a block under Interfaces → Plant setup → Plant layout if you want it there.', x: g.x, y: g.y, w: g.w, h: g.h, inner });
      });
      out.push('<g class="logi-zone"><rect class="zone" x="' + zx + '" y="' + zy + '" width="' + zw + '" height="' + zh + '" rx="14"/>' +
        '<text x="' + (zx + 14) + '" y="' + (zy + 15) + '" class="zl">LOGISTICS AREAS</text><text x="' + (zx + 132) + '" y="' + (zy + 15) + '" class="zs">not positioned: these are not in the plant drawing</text>' + cards + '</g>');
    }

    /* ---- flows: dotted sequence lines + carriers ---- */
    const stop = S.line.stopped ? ' stopped' : '';
    const seg = (d, arrow) => '<path class="seqbg" d="' + d + '"/><path class="seq' + stop + '" d="' + d + '"' + (arrow ? ' marker-end="url(#ah-seq)"' : '') + '/>';
    const busy = Sim.fleetView(S.amr).busy, jbusy = Sim.fleetView(S.jv).busy;
    const count = { jv: Math.max(1, Math.min(3, Math.round(jbusy / 1.5))), egtm: Math.max(1, Math.min(3, Math.round(busy * 0.25))), imma: Math.max(1, Math.min(2, Math.round(busy * 0.15))) };
    let carriers = '';
    function carrier(routeId, n, speed, mode, late, phase) {
      const len = approxLen(ROUTES[routeId]), dur = Math.max(2, len / speed);
      for (let k = 0; k < n; k++) {
        const shape = mode === 'tow' ? '<rect x="-7" y="-3.6" width="10" height="7.2" rx="1.8" class="cr' + (late ? ' late' : '') + '"/><rect x="3.5" y="-2.6" width="6.5" height="5.2" rx="1.4" class="cr2' + (late ? ' late' : '') + '"/>' : '<circle r="5" class="cr' + (late ? ' late' : '') + '"/><circle r="2" class="cr2' + (late ? ' late' : '') + '"/>';
        carriers += '<g class="carrier">' + shape + (stop ? '' : '<animateMotion dur="' + dur.toFixed(1) + 's" begin="-' + ((dur * (k + phase)) / n).toFixed(2) + 's" repeatCount="indefinite" rotate="auto"><mpath href="#rt-' + routeId + '"/></animateMotion>') + '</g>';
      }
    }
    const speed = (late) => (late ? 38 : 62);
    carrier('jv-b', Math.max(1, Math.ceil(count.jv / 2)), speed(SRC.jv.late), SRC.jv.mode, SRC.jv.late, 0); carrier('jv-a', Math.max(1, Math.floor(count.jv / 2) || 1), speed(SRC.jv.late), SRC.jv.mode, SRC.jv.late, 0.5);
    carrier('eg-b', 1, speed(SRC.egtm.late), SRC.egtm.mode, SRC.egtm.late, 0); carrier('eg-a', Math.max(1, count.egtm - 1), speed(SRC.egtm.late), SRC.egtm.mode, SRC.egtm.late, 0.5);
    carrier('im-b', 1, speed(SRC.imma.late), SRC.imma.mode, SRC.imma.late, 0.2); carrier('im-a', Math.max(1, count.imma - 1), speed(SRC.imma.late), SRC.imma.mode, SRC.imma.late, 0.7);
    const defs = '<defs>' + Object.keys(ROUTES).map((id) => '<path id="rt-' + id + '" d="' + ROUTES[id] + '" fill="none"/>').join('') + '</defs>';
    const flows = defs +
      seg('M230,138 V' + BUS_Y) + seg('M626,138 V' + BUS_Y) + seg('M784,138 V' + BUS_Y) +                                   // source drops onto the bus
      seg('M230,' + BUS_Y + ' H860') +                                                                                     // the sequence bus
      seg('M600,' + BUS_Y + ' V164', true) + seg('M700,' + BUS_Y + ' V164', true) + seg('M860,' + BUS_Y + ' V164', true) +  // drops into assembly B
      seg('M' + CH_X + ',' + BUS_Y + ' V' + A_BOT + ' H860') +                                                             // down the gap between paint and assembly, then along the lane under assembly A
      seg('M600,' + A_BOT + ' V282', true) + seg('M700,' + A_BOT + ' V282', true) + seg('M860,' + A_BOT + ' V282', true) +    // up into assembly A: mirror of the three drops into B
      seg('M142,192 H158', true) + seg('M142,254 H158', true) + carriers;
    return { flows, nodes: out.join('') };
  }

  window.FFMap = { render };
})();
