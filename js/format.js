// dates and numbers, all in utc

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const p2 = n => String(n).padStart(2, '0');

export const fmtTs = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  return p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ', ' + d.getUTCDate() + ' ' + months[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
};
export const fmtDay = iso => { const d = new Date(iso); return d.getUTCDate() + ' ' + months[d.getUTCMonth()].slice(0, 3); };
export const num = v => (v == null ? 0 : Number(v)).toLocaleString('en');
export const plural = (n, one, many) => num(n) + ' ' + (Number(n) === 1 ? one : (many || one + 's'));
export const signed = n => (n == null ? '' : n > 0 ? '+' + num(n) : num(n));

export const ago = iso => {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = s / 60; if (m < 60) return Math.floor(m) + ' min ago';
  const h = m / 60; if (h < 24) return Math.floor(h) + ' h ago';
  const d = h / 24; if (d < 60) return Math.floor(d) + ' d ago';
  return Math.floor(d / 30) + ' mo ago';
};

export const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
