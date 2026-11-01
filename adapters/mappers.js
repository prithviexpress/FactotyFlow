'use strict';
/*
 * Mappers translate a vendor payload into the dashboard contract (docs/DATA-CONTRACT.md).
 * Reference them by name from adapters.config.json ("mapper": "wms-stock").
 * signature: (payload, ctx) -> contract payload   ctx = { topic, segments }
 *
 * The two vendor-specific ones below are EXAMPLES: check field names against your actual systems.
 */
module.exports = {
  identity: (p) => p,

  /** VDA 5050 AGV "state" message -> amr.unit  (topic e.g. uagv/v2/<manufacturer>/<serial>/state) */
  'vda5050-state': (p) => {
    const bs = p.batteryState || {};
    const charging = !!bs.charging;
    const busy = !charging && (p.driving === true || (typeof p.orderId === 'string' && p.orderId !== ''));
    return { id: p.serialNumber, battery: bs.batteryCharge, state: charging ? 'charging' : busy ? 'busy' : 'idle' };
  },

  /** Example WMS stock export -> parts.  Input rows: { material, description, bin, shop, onHand, hourlyUsage, inbound?:{asn, etaAt, qty} } */
  'wms-stock': (rows) => (Array.isArray(rows) ? rows : rows.items || []).map((r) => ({
    id: r.material, name: r.description, loc: r.bin, shop: r.shop,
    stock: r.onHand, rate: (r.hourlyUsage || 0) / 60,
    pending: r.inbound ? { ref: r.inbound.asn, etaAt: r.inbound.etaAt, qty: r.inbound.qty } : null
  }))
};
