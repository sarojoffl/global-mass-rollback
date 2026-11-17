// login screen, layout from gs-steward-stats
import { createApp, ref } from 'vue';
import { CdxButton, CdxIcon, CdxMessage, icons } from './codex.js';
import { theme, toggleTheme } from './store.js';
import { SiteFooter } from './components/common.js';

const el = document.getElementById('app');
const cfg = { logo: el.dataset.logo, loginUrl: el.dataset.loginUrl, enabled: el.dataset.enabled === 'yes', source: el.dataset.source, commit: el.dataset.commit };

createApp({
  components: { CdxButton, CdxIcon, CdxMessage, SiteFooter },
  setup() {
    const busy = ref(false);
    const login = () => { busy.value = true; location.href = cfg.loginUrl; };
    return { theme, toggleTheme, busy, login, icons, cfg };
  },
  template: `
<div class="shell">
  <header class="hdr"><div class="hdr-in">
    <span class="brand"><img :src="cfg.logo" alt="">Global Mass Rollback</span>
    <div class="themesw"><cdx-button weight="quiet" :aria-label="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'" @click="toggleTheme"><cdx-icon :icon="theme === 'dark' ? icons.sun : icons.moon"/></cdx-button></div>
  </div></header>
  <main>
    <div class="hero">
      <img :src="cfg.logo" alt="">
      <h1>Global Mass Rollback</h1>
      <p>Log in with your Wikimedia account to continue.</p>
      <cdx-button v-if="cfg.enabled" action="progressive" weight="primary" size="large" :disabled="busy" @click="login"><cdx-icon :icon="icons.logIn"/> Log in</cdx-button>
      <cdx-message v-else type="error" :allow-user-dismiss="false">Login is not configured yet.</cdx-message>
    </div>
  </main>
  <site-footer :source="cfg.source" :commit="cfg.commit"/>
</div>`
}).mount('#app');
