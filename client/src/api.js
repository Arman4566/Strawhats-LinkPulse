// Small fetch wrapper plus the signed-in session. The token lives in localStorage; the server re-checks the role on every call.
const KEY = 'lp_session';
export const TZ = -new Date().getTimezoneOffset();   // minutes east of UTC, so charts group by the viewer's own day

let session = null;
try { session = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { session = null; }
const listeners = new Set();
export const getSession = () => session;
export function setSession(s) {
  session = s;
  try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* private mode */ }
  listeners.forEach((fn) => fn(session));
}
export const onSession = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export class ApiError extends Error {
  constructor(status, body) { super((body && body.error) || 'Request failed'); this.status = status; this.body = body || {}; }
}

export async function api(method, path, body, opts = {}) {
  const headers = {};
  if (session) headers.Authorization = 'Bearer ' + session.token;
  let payload;
  if (body !== undefined) { headers['Content-Type'] = opts.raw ? 'text/csv' : 'application/json'; payload = opts.raw ? body : JSON.stringify(body); }
  let res;
  try { res = await fetch(path, { method, headers, body: payload, signal: opts.signal }); }
  catch (e) { if (e.name === 'AbortError') throw e; throw new ApiError(0, { error: 'Cannot reach the server. Check your connection.' }); }
  if (opts.blob && res.ok) return res.blob();
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (res.status === 401 && session && !path.startsWith('/api/auth')) { setSession(null); throw new ApiError(401, { error: 'Please sign in again' }); }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
export const get = (p, o) => api('GET', p, undefined, o);
export const post = (p, b, o) => api('POST', p, b ?? {}, o);
export const patch = (p, b) => api('PATCH', p, b);
export const del = (p) => api('DELETE', p);
