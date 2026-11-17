// fetch helpers

async function call(path, opts) {
  const r = await fetch('api/' + path, { cache: 'no-store', ...opts });
  // logged out, reload to the login screen
  if (r.status === 401) { location.reload(); throw new Error('Login required'); }
  let d;
  try { d = await r.json(); } catch (e) { throw new Error('Bad response from server'); }
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}

export const get = path => call(path);
export const post = (path, data) => call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
