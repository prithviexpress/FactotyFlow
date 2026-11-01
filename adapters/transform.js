'use strict';
/*
 * Declarative field mapping so a vendor JSON can be adapted without code.
 *   root:   dot path to the data inside the response, e.g. "data.items" ("" = whole response)
 *   fields: { contractField: "vendor.path" | { path, mul } }   (contract field may be dotted: "pending.ref")
 * Arrays are mapped item by item. With no fields the (rooted) payload is passed through unchanged.
 */
function getPath(o, path) {
  if (path === undefined || path === null || path === '') return o;
  let cur = o;
  for (const k of String(path).split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[k];
  }
  return cur;
}
function setPath(o, path, v) {
  const ks = path.split('.');
  let cur = o;
  for (let i = 0; i < ks.length - 1; i++) cur = cur[ks[i]] || (cur[ks[i]] = {});
  cur[ks[ks.length - 1]] = v;
}
function mapOne(it, fields) {
  const out = {};
  for (const k of Object.keys(fields)) {
    const f = fields[k];
    let v;
    if (typeof f === 'string') v = getPath(it, f);
    else if (f && typeof f === 'object') {
      v = getPath(it, f.path);
      if (typeof v === 'string' && v.trim() !== '' && !isNaN(v)) v = Number(v);
      if (typeof v === 'number' && typeof f.mul === 'number') v *= f.mul;
      if (typeof v === 'number' && typeof f.div === 'number' && f.div !== 0) v /= f.div;
    } else continue;
    if (v !== undefined) setPath(out, k, v);
  }
  return out;
}
function transform(json, spec) {
  spec = spec || {};
  const d = getPath(json, spec.root);
  if (d === undefined) throw new Error('root path "' + spec.root + '" not found in response');
  const fields = spec.fields && typeof spec.fields === 'object' ? spec.fields : null;
  if (!fields || !Object.keys(fields).length) return d;
  return Array.isArray(d) ? d.map((x) => mapOne(x, fields)) : mapOne(d, fields);
}
module.exports = { transform, getPath };
