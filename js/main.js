// app shell: header, router, footer. layout from gs-steward-stats
import { computed, createApp, onMounted } from 'vue';
import { get } from './api.js';
import { CdxButton, CdxIcon, CdxProgressIndicator, CdxTooltip, icons } from './codex.js';
import { route, store, theme, toggleTheme } from './store.js';
import { GsTag, SiteFooter } from './components/common.js';
import { RollbackPage } from './pages/rollback.js';
import { StatsPage } from './pages/stats.js';

// back to where you were before logging in
try {
  const h = sessionStorage.getItem('gmr-after-login');
  if (h) { sessionStorage.removeItem('gmr-after-login'); if (!location.hash || location.hash === '#/') location.hash = h; }
} catch (e) {}

async function loadMe() {
  try { store.me = await get('me'); } catch (e) { store.me = store.me || { username: null, authorized: false }; }
}
// keeps the online status fresh
setInterval(() => { if (document.visibilityState === 'visible') loadMe(); }, 2 * 60 * 1000);

const App = {
  components: { RollbackPage, StatsPage, CdxButton, CdxIcon, SiteFooter },
  setup() {
    onMounted(loadMe);
    const nav = [['rollback', 'Rollback', icons.undo], ['stats', 'Statistics', icons.chart]];
    const current = computed(() => route.value.name);
    const { logo, source, commit } = document.getElementById('app').dataset;
    return { nav, current, route, store, theme, toggleTheme, icons, logo, source, commit };
  },
  template: `
<div class="shell">
  <header class="hdr"><div class="hdr-in">
    <a class="brand" href="#/"><img :src="logo" alt=""><span class="brand-title">Global Mass Rollback</span></a>
    <nav class="nav"><a v-for="n in nav" :key="n[0]" :href="'#/' + (n[0] === 'rollback' ? '' : n[0])" :class="{ on: current === n[0] }"><cdx-icon :icon="n[2]" size="small"/>{{ n[1] }}</a></nav>
    <div class="acct" v-if="store.me && store.me.username">
      <span class="who" v-tooltip="'Logged in as ' + store.me.username"><cdx-icon :icon="icons.user" size="small"/><span class="who-name">{{ store.me.username }}</span></span>
      <a class="cdx-button cdx-button--fake-button cdx-button--fake-button--enabled cdx-button--weight-quiet cdx-button--size-medium" href="logout" aria-label="Log out"><cdx-icon :icon="icons.logOut"/><span class="logout-label">Log out</span></a>
    </div>
    <div class="themesw"><cdx-button weight="quiet" :aria-label="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'" v-tooltip="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'" @click="toggleTheme"><cdx-icon :icon="theme === 'dark' ? icons.sun : icons.moon"/></cdx-button></div>
  </div></header>
  <main>
    <!-- v-show so a running rollback keeps going -->
    <rollback-page v-show="route.name !== 'stats'"/>
    <stats-page v-if="route.name === 'stats'"/>
  </main>
  <site-footer :source="source" :commit="commit"/>
</div>`
};

const app = createApp(App);
app.component('GsTag', GsTag);
app.component('CdxProgressIndicator', CdxProgressIndicator);
app.directive('tooltip', CdxTooltip);
app.mount('#app');
