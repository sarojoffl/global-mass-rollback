// shared state, theme and hash router
import { reactive, ref, watch } from 'vue';
import { lsSet } from './format.js';

export const store = reactive({ me: null });

// ticks so "x min ago" stays fresh
export const tick = ref(Date.now());
setInterval(() => { tick.value = Date.now(); }, 60000);

export function parseHash() {
  const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
  return { name: path.split('/')[0] || 'rollback', query: Object.fromEntries(new URLSearchParams(qs || '')) };
}
export const route = ref(parseHash());
window.addEventListener('hashchange', () => { route.value = parseHash(); window.scrollTo(0, 0); });

export function setQuery(q) {
  const clean = Object.fromEntries(Object.entries(q).filter(([, v]) => v));
  const qs = new URLSearchParams(clean).toString();
  history.replaceState(null, '', '#/' + (route.value.name === 'rollback' ? '' : route.value.name) + (qs ? '?' + qs : ''));
  route.value = parseHash();
}

export const theme = ref(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
watch(theme, t => {
  document.documentElement.dataset.theme = t;
  const l = document.getElementById('gmr-dark');
  if (l) l.media = t === 'dark' ? 'all' : 'not all';
  lsSet('gmr-theme', t);
});
export const toggleTheme = () => { theme.value = theme.value === 'dark' ? 'light' : 'dark'; };
