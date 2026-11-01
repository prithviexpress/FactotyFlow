'use strict';
/* MQTT helpers. The subscriber itself lives in manager.js (needs the optional `mqtt` package: npm i mqtt). */

/** MQTT topic filter match with + and # wildcards */
function topicMatches(filter, topic) {
  const f = filter.split('/'), t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

module.exports = { topicMatches };
