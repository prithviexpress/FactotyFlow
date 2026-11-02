/* Plant block layout (central flow): blocks in the plant's arrangement + sequenced-material flows (AMR / tow truck).
 * FFMap.render(S, ctx) -> { flows, nodes } SVG strings for the 1152 x 384 map.  Geometry below mirrors the plant sketch. */
(function () {
  'use strict';
  const Sim = window.FactorySim;
  const X = (s) => String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const tx = (x, y, s, cls, extra) => '<text x="' + x + '" y="' + y + '" class="' + (cls || '') + '" ' + (extra || '') + '>' + X(s) + '</text>';
  const STFILL = { ok: 'var(--ok)', watch: 'var(--watch)', low: 'var(--low)', none: 'rgba(255,255,255,.24)' };
  const STINK = { ok: '#06210f', watch: '#2a1d00', low: '#ffffff', none: '#ffffff' };

  /* ---- geometry (viewBox 1152 x 384) ---- */
  const R1 = { y: 8, h: 178 }, R2B = { y: 214, h: 77 }, R2A = { y: 299, h: 77 };
  const G = {
    jv: { x: 8, y: R1.y, w: 275, h: R1.h }, yard: { x: 291, y: R1.y, w: 282, h: R1.h }, egtm: { x: 581, y: R1.y, w: 90, h: R1.h },
    top1: { x: 679, y: R1.y, w: 210, h: 90 }, imma: { x: 679, y: 104, w: 210, h: 82 }, top2: { x: 897, y: R1.y, w: 120, h: R1.h }, top3: { x: 1025, y: R1.y, w: 119, h: R1.h },
    press: { x: 8, y: R2B.y, w: 134, h: 162 }, weldB: { x: 160, y: R2B.y, w: 123, h: R2B.h }, weldA: { x: 160, y: R2A.y, w: 123, h: R2A.h },
    paintB: { x: 291, y: R2B.y, w: 282, h: R2B.h }, paintA: { x: 291, y: R2A.y, w: 282, h: R2A.h },
    asmB: { x: 581, y: R2B.y, w: 563, h: R2B.h }, asmA: { x: 581, y: R2A.y, w: 563, h: R2A.h }
  };
  const BUS_Y = 200, A_X = 1148;
  const ROUTES = {                       // sequenced-material paths; B = into assembly B top, A = around the right edge into assembly A
    'jv-b': 'M230,186 V' + BUS_Y + ' H600 V214', 'jv-a': 'M230,186 V' + BUS_Y + ' H' + A_X + ' V337 H1144',
    'eg-b': 'M626,186 V' + BUS_Y + ' H700 V214', 'eg-a': 'M626,186 V' + BUS_Y + ' H' + A_X + ' V337 H1144',
    'im-b': 'M784,186 V' + BUS_Y + ' H860 V214', 'im-a': 'M784,186 V' + BUS_Y + ' H' + A_X + ' V337 H1144',
    'pr-wb': 'M142,252 H158', 'pr-wa': 'M142,337 H158'
  };
  const approxLen = (d) => { const n = (d.match(/-?\d+(\.\d+)?/g) || []).map(Number); let x = 0, y = 0, len = 0, i = 0; const cmds = d.match(/[MHV][^MHV]*/g) || []; cmds.forEach((c) => { const t = c[0], v = parseFloat(c.slice(1)); if (t === 'M') { const m = c.slice(1).split(','); x = +m[0]; y = +m[1]; } else if (t === 'H') { len += Math.abs(v - x); x = v; } else { len += Math.abs(v - y); y = v; } }); return len || (n.length ? 1 : 1); };

  const fit = (s, w, px) => { s = String(s === undefined || s === null ? '' : s); const max = Math.max(3, Math.floor(w / (px || 9))); return s.length > max ? s.slice(0, max - 1) + '\u2026' : s; };
  const cls = (g) => (g.h >= 140 && g.w >= 240 ? 'large' : g.h >= 140 ? 'tall' : 'wide');          // widgets adapt to the block they are placed in
  const status = (v) => Sim.bufferStatus(v);
  const hh = (h) => (h === null || h === undefined ? '' : (h < 10 ? h.toFixed(1) : Math.round(h)) + ' h');

  function pill(x, y, s, st, anchor) {
    const w = Math.max(32, String(s).length * 6.7 + 14), x0 = anchor === 'end' ? x - w : x;
    return '<rect x="' + x0 + '" y="' + y + '" width="' + w + '" height="17" rx="8.5" fill="' + STFILL[st] + '"/>' +
      '<text x="' + (x0 + w / 2) + '" y="' + (y + 12.2) + '" class="pl" text-anchor="middle" fill="' + STINK[st] + '">' + X(s) + '</text>';
  }
  function tag(x, y, s, late) {
    const w = String(s).length * 5.9 + 12;
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="15" rx="7.5" fill="' + (late ? 'var(--low)' : 'rgba(255,255,255,.2)') + '" stroke="rgba(255,255,255,.35)" stroke-width=".8"/>' +
      '<text x="' + (x + w / 2) + '" y="' + (y + 10.7) + '" class="tg" text-anchor="middle">' + X(s) + '</text>';
  }
  function block(o) {
    const cls = 'nd blk k-' + o.kind + (o.sel ? ' sel' : '') + (o.dim ? ' dim' : '') + (o.st === 'low' ? ' problem' : '');
    return '<g class="' + cls + '" data-node="' + o.id + '" data-href="' + (o.href || '') + '"' + (o.fleet ? ' data-fleet="jv"' : '') + ' data-shop="' + (o.family || '') + '">' +
      '<rect class="bk" x="' + o.x + '" y="' + o.y + '" width="' + o.w + '" height="' + o.h + '" rx="10" fill="url(#g-' + o.kind + ')"/>' +
      '<rect class="gl" x="' + o.x + '" y="' + o.y + '" width="' + o.w + '" height="' + o.h + '" rx="10" fill="url(#g-gloss)"/>' + (o.inner || '') + '</g>';
  }
  function bar(x, y, w, pct, st) {
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="5" rx="2.5" fill="rgba(255,255,255,.22)"/><rect x="' + x + '" y="' + y + '" width="' + Math.max(0, Math.min(w, (w * pct) / 100)).toFixed(1) + '" height="5" rx="2.5" fill="' + STFILL[st === 'none' ? 'ok' : st] + '"/>';
  }

  function render(S, c) {
    const { T, f0, ui } = c, SL = S.setup.slots, IV = c.IV, y = S.yard;
    const wip = {}; IV.wip.forEach((w) => { wip[w.id] = w; });
    const sel = (fam) => !!fam && ui.shop === fam, dim = (fam) => !!fam && ui.shop !== 'all' && ui.shop !== fam;
    const label = (slot, fallback) => (SL[slot] && SL[slot].label) || fallback;
    const out = [];

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
      const ax = g.x + 10, ay = g.y + 36, aw = g.w - 20, ah = g.h - 36 - 28, tw = (aw - (cols - 1) * 8) / cols, th = (ah - (rows - 1) * 8) / rows;
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
          tx(tx0 + 9, ty0 + 17, nm, 't1') + pill(tx0 + tw - 7, ty0 + 5, f0(j.buf) + '%', bst, 'end') +
          '<text x="' + (tx0 + 9) + '" y="' + (ty0 + th - 20) + '" class="sm">' + X(w && w.hours !== null ? hh(w.hours) : '') +
          (rp !== null ? '<tspan style="font-weight:800;fill:' + (rst === 'ok' ? '#9bf0bf' : rst === 'watch' ? '#ffe08a' : '#ffb0b0') + '">' + (w && w.hours !== null ? ' · ' : '') + f0(rp) + '% on time</tspan>' : '') + '</text>' +
          bar(tx0 + 9, ty0 + th - 11, tw - 18, j.buf, bst) + '</g>';
      });
      out.push(block({ id: 'jvzone', kind: 'jv', x: g.x, y: g.y, w: g.w, h: g.h, st: worst === 'low' ? 'none' : worst, inner:
        tx(g.x + 14, g.y + 25, label('jv', 'JV'), 'bt') + tx(g.x + 14 + String(label('jv', 'JV')).length * 11 + 12, g.y + 24, n + ' site' + (n === 1 ? '' : 's') + ' · sequenced supply', 'sm') + tiles +
        srcTag('jv', g.x + 12, g.y + g.h - 21) }));
    }

    /* ---- yard: truck parking + bays ---- */
    function yardInner(g, title) {
      const waiting = Math.max(0, y.arrived - y.docked), rows = [['parked', y.expected], ['arrived', y.arrived], [T('atBay').toLowerCase(), y.docked], ['received', y.received]], k = cls(g);
      const full = y.occupied >= y.docks, st = full ? 'low' : waiting >= 6 || y.occupied / y.docks > 0.92 ? 'watch' : 'ok';
      const wp = pill(g.x + g.w - 10, g.y + 8, waiting + ' waiting', waiting >= 6 ? 'low' : waiting >= 3 ? 'watch' : 'ok', 'end');
      const bays = y.occupied + ' / ' + y.docks + ' ' + T('bays').toLowerCase();
      if (k === 'large') {
        let cells = '';
        const cx0 = g.x + g.w - 14 - 7 * 15, cy0 = g.y + 46;
        for (let i = 0; i < y.docks; i++) { const cc = i % 7, cr = Math.floor(i / 7); cells += '<rect x="' + (cx0 + cc * 15) + '" y="' + (cy0 + cr * 15) + '" width="12" height="12" rx="3" fill="' + (i < y.occupied ? 'rgba(255,255,255,.92)' : 'rgba(255,255,255,.16)') + '"/>'; }
        return { st, inner: tx(g.x + 14, g.y + 25, fit(title, g.w - 98, 8.4), 'bt') + wp + rows.map((r, i) => tx(g.x + 16, g.y + 62 + i * 25, r[1], 'bn') + tx(g.x + 58, g.y + 62 + i * 25, r[0], 'sm')).join('') +
          cells + tx(cx0, cy0 + 4 * 15 + 12, bays, 'bn2') + tx(g.x + 16, g.y + g.h - 12, 'gate → ' + T('bay').toLowerCase() + ' ' + f0(y.g2d) + ' min', 'sm') };
      }
      if (k === 'tall') {
        return { st, inner: tx(g.x + 12, g.y + 24, fit(title, g.w - 20, 8.4), 'bt') + pill(g.x + 12, g.y + 34, waiting + ' waiting', waiting >= 6 ? 'low' : waiting >= 3 ? 'watch' : 'ok') +
          tx(g.x + 12, g.y + 84, y.occupied + ' / ' + y.docks, 'bn') + tx(g.x + 12, g.y + 100, T('bays').toLowerCase() + ' in use', 'sm') +
          rows.map((r, i) => tx(g.x + 12, g.y + 124 + i * 14, r[1] + ' ' + r[0], 'sm')).join('') };
      }
      return { st, inner: tx(g.x + 14, g.y + 24, fit(title, g.w - 98, 8.4), 'bt') + wp + tx(g.x + 14, g.y + 58, y.occupied + ' / ' + y.docks, 'bn') + tx(g.x + 14 + String(y.occupied + ' / ' + y.docks).length * 12, g.y + 57, T('bays').toLowerCase() + ' in use', 'sm') +
        tx(g.x + 14, g.y + g.h - 10, y.arrived + ' arrived · ' + y.docked + ' ' + T('atBay').toLowerCase() + ' · ' + y.received + ' received', 'sm') };
    }
    function motorInner(g, slot) {
      const f = S.finished, st = f.onTime >= 90 ? 'ok' : f.onTime >= 85 ? 'watch' : 'low', h = IV.finished.hours, k = cls(g), nm = label(slot, '') || T('motorpool').toUpperCase();
      if (k === 'wide') {
        return { st, inner: tx(g.x + 14, g.y + 24, fit(nm, g.w - 110, 8.4), 'bt') + pill(g.x + g.w - 10, g.y + 8, f0(f.onTime) + '% on time', st, 'end') +
          tx(g.x + 14, g.y + 60, f0(f.units), 'bn') + tx(g.x + 14 + String(f0(f.units)).length * 13 + 8, g.y + 59, 'vehicles' + (h !== null ? ' · ' + hh(h) + ' of stock' : ''), 'sm') +
          tx(g.x + 14, g.y + g.h - 10, 'dispatch ' + (f.shipRate || 0).toFixed(1) + ' / min', 'sm') };
      }
      return { st, inner: tx(g.x + 12, g.y + 24, fit(nm, g.w - 20, 8.4), 'bt') + pill(g.x + 12, g.y + 34, f0(f.onTime) + '% on time', st) +
        tx(g.x + 12, g.y + 84, f0(f.units), 'bn') + tx(g.x + 12, g.y + 100, 'vehicles', 'sm') + tx(g.x + 12, g.y + 124, h !== null ? hh(h) + ' of stock' : '', 'sm') + tx(g.x + 12, g.y + 140, (f.shipRate || 0).toFixed(1) + ' / min dispatch', 'sm') };
    }
    function shipInner(g, slot) {
      const so = S.finished.shipOnTime, st = so >= 90 ? 'ok' : so >= 85 ? 'watch' : 'low', k = cls(g), nm = label(slot, 'SHIPMENT');
      const ring = (cx, cy, r) => { const C = 2 * Math.PI * r; return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="8"/>' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + STFILL[st] + '" stroke-width="8" stroke-linecap="round" stroke-dasharray="' + (C * Math.min(1, so / 100)).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"/>' + tx(cx, cy + 5, f0(so) + '%', k === 'wide' ? 'bn2' : 'bn', 'text-anchor="middle"'); };
      if (k === 'wide') return { st, inner: tx(g.x + 14, g.y + 24, fit(nm, g.w - 20, 8.4), 'bt') + ring(g.x + 46, g.y + 58, 20) + tx(g.x + 84, g.y + 56, 'on-time shipments', 'sm') + tx(g.x + 84, g.y + 72, 'today', 'sm') };
      const cx = g.x + g.w / 2, cy = g.y + 82;
      return { st, inner: tx(g.x + 14, g.y + 24, fit(nm, g.w - 20, 8.4), 'bt') + ring(cx, cy, 34) + tx(cx, g.y + 142, 'on-time', 'sm', 'text-anchor="middle"') + tx(cx, g.y + 158, 'shipments', 'sm', 'text-anchor="middle"') };
    }
    function lightSlot(slot, bind, g) {
      const lbl = (SL[slot] && SL[slot].label) || '';
      let r;
      if (bind === 'yard') r = yardInner(g, lbl || (T('parking') + ' & ' + T('bays')).toUpperCase());
      else if (bind === 'motorpool') r = motorInner(g, slot);
      else if (bind === 'shipment') r = shipInner(g, slot);
      else {
        out.push('<g class="nd blk k-empty"><rect class="bk" x="' + g.x + '" y="' + g.y + '" width="' + g.w + '" height="' + g.h + '" rx="10"/>' + tx(g.x + g.w / 2, g.y + g.h / 2 + 4, lbl || 'unassigned', 'sm', 'text-anchor="middle"') + '</g>');
        return;
      }
      const href = { yard: '#/inbound', motorpool: '#/inventory', shipment: '#/shop/assembly' }[bind];
      out.push(block({ id: slot, kind: 'light', x: g.x, y: g.y, w: g.w, h: g.h, st: r.st, href, inner: r.inner }));
    }
    lightSlot('yard', SL.yard.bind, G.yard); lightSlot('top1', SL.top1.bind, G.top1); lightSlot('top2', SL.top2.bind, G.top2); lightSlot('top3', SL.top3.bind, G.top3);

    /* ---- shop-style blocks ---- */
    function shop(slot, key, family, src, fallbackLabel, href) {
      const g = G[slot], s = S.shops[key], st = status(s.buf), w = wip[key], tall = g.h > 120;
      const nm = label(slot, fallbackLabel);
      let inner;
      if (tall) {
        inner = tx(g.x + 12, g.y + 24, fit(nm, g.w - 18, 8.4), 'bt') + pill(g.x + 12, g.y + 34, f0(s.buf) + '%', st) +
          tx(g.x + 12, g.y + 70, 'Buffer', 'sm') + tx(g.x + 12, g.y + 88, w && w.hours !== null ? hh(w.hours) : '—', 'bn2') + tx(g.x + 12, g.y + 103, 'of stock', 'sm') +
          bar(g.x + 12, g.y + g.h - (src ? 34 : 14), g.w - 24, s.buf, st) + (src ? srcTag(src, g.x + 10, g.y + g.h - 24) : '');
      } else {
        inner = tx(g.x + 12, g.y + 21, fit(nm, g.w - 66, 8.4), 'bt') + pill(g.x + g.w - 9, g.y + 6, f0(s.buf) + '%', st, 'end') +
          tx(g.x + 12, g.y + g.h - 24, 'Buffer' + (w && w.hours !== null ? ' · ' + hh(w.hours) : ''), 'sm') + bar(g.x + 12, g.y + g.h - 14, g.w - 24, s.buf, st);
      }
      out.push(block({ id: slot, kind: 'prod', x: g.x, y: g.y, w: g.w, h: g.h, st, family, href, sel: sel(family), dim: dim(family), inner }));
    }
    shop('egtm', 'engine', 'engine', 'egtm', 'EGTM');
    shop('imma', 'bumper', 'bumper', 'imma', 'IMM-A');
    // press feeds both weld lines
    {
      const g = G.press, s = S.shops.press, st = status(s.buf), w = wip.press;
      out.push(block({ id: 'press', kind: 'prod', x: g.x, y: g.y, w: g.w, h: g.h, st, family: 'press', sel: sel('press'), dim: dim('press'), inner:
        tx(g.x + 12, g.y + 24, fit(label('press', 'PRESS A/B'), g.w - 18, 8.4), 'bt') + pill(g.x + 12, g.y + 34, f0(s.buf) + '%', st) + tx(g.x + 12, g.y + 70, 'Buffer', 'sm') +
        tx(g.x + 12, g.y + 88, w && w.hours !== null ? hh(w.hours) : '—', 'bn2') + tx(g.x + 12, g.y + 103, 'of stock', 'sm') +
        bar(g.x + 12, g.y + g.h - 34, g.w - 24, s.buf, st) + srcTag('press', g.x + 10, g.y + g.h - 24) }));
    }
    shop('weldB', 'weldB', 'weld', null, 'WELD B'); shop('weldA', 'weldA', 'weld', null, 'WELD A');
    shop('paintB', 'paintB', 'paint', null, 'PAINT B'); shop('paintA', 'paintA', 'paint', null, 'PAINT A');

    /* ---- assembly lines A / B ---- */
    const ls = Sim.lineSplit(S), stopped = S.line.stopped;
    [['asmB', 'B'], ['asmA', 'A']].forEach(([slot, L]) => {
      const g = G[slot], d = ls[L], pct = d.plan ? (d.actual / d.plan) * 100 : 0, st = stopped ? 'low' : 'ok';
      out.push(block({ id: slot, kind: 'asm', x: g.x, y: g.y, w: g.w, h: g.h, st, family: 'assembly', href: '#/shop/assembly', sel: sel('assembly'), dim: dim('assembly'), inner:
        tx(g.x + 16, g.y + 24, label(slot, 'ASSEMBLY ' + L), 'bt') + pill(g.x + 16 + String(label(slot, 'ASSEMBLY ' + L)).length * 9.4 + 14, g.y + 10, stopped ? 'STOPPED' : 'RUNNING', stopped ? 'low' : 'ok') +
        tx(g.x + 16, g.y + 58, f0(d.actual), 'bn') + tx(g.x + 16 + String(f0(d.actual)).length * 13 + 6, g.y + 58, '/ ' + d.plan + ' vehicles' + (ls.derived ? ' (half of total)' : ''), 'sm') +
        '<rect x="' + (g.x + 250) + '" y="' + (g.y + 46) + '" width="' + (g.w - 330) + '" height="9" rx="4.5" fill="rgba(255,255,255,.22)"/><rect x="' + (g.x + 250) + '" y="' + (g.y + 46) + '" width="' + Math.max(0, Math.min(g.w - 330, ((g.w - 330) * pct) / 100)).toFixed(1) + '" height="9" rx="4.5" fill="' + STFILL[st] + '"/>' +
        pill(g.x + g.w - 12, g.y + 41, f0(pct) + '%', st, 'end') }));
    });

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
      seg('M230,186 V' + BUS_Y) + seg('M626,186 V' + BUS_Y) + seg('M784,186 V' + BUS_Y) +                                   // source drops
      seg('M230,' + BUS_Y + ' H' + A_X + ' V337 H1144', true) +                                                          // the bus -> assembly A (right edge)
      seg('M600,' + BUS_Y + ' V214', true) + seg('M700,' + BUS_Y + ' V214', true) + seg('M860,' + BUS_Y + ' V214', true) +  // drops into assembly B
      seg('M142,252 H158', true) + seg('M142,337 H158', true) + carriers;
    return { flows, nodes: out.join('') };
  }

  window.FFMap = { render };
})();
