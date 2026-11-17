// simple usage stats
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { get } from '../api.js';
import { CdxMessage, icons } from '../codex.js';
import { ago, num } from '../format.js';
import { store, tick } from '../store.js';
import { StatCard } from '../components/common.js';

export const StatsPage = {
  components: { CdxMessage, StatCard },
  setup() {
    const d = ref(null), err = ref('');
    let timer = null;
    async function load() {
      try { d.value = await get('stats'); err.value = ''; } catch (e) { err.value = e.message; }
    }
    onMounted(() => { load(); timer = setInterval(load, 60000); });
    onBeforeUnmount(() => clearInterval(timer));
    const lastSeen = iso => { tick.value; return ago(iso); };
    const metaUser = n => 'https://meta.wikimedia.org/wiki/User:' + encodeURIComponent(n.replace(/ /g, '_'));
    return { d, err, lastSeen, metaUser, num, store, icons };
  },
  template: `
<div>
  <div class="pagehead"><h1>Statistics</h1></div>
  <cdx-message v-if="err" type="error">{{ err }}</cdx-message>
  <div v-if="!d && !err" class="loading"><cdx-progress-indicator>Loading</cdx-progress-indicator></div>
  <template v-if="d">
    <div class="stats">
      <stat-card :value="num(d.ok)" label="Rolled back" :icon="icons.undo" tone="ok"/>
      <stat-card :value="num(d.failed)" label="Failed" :icon="icons.error" tone="err"/>
      <stat-card :value="num(d.online)" label="Online now" :icon="icons.group" tone="info"/>
    </div>
    <section class="panel">
      <h2>Users</h2>
      <p v-if="!d.users.length" class="muted">Nobody yet.</p>
      <ul class="people">
        <li v-for="u in d.users" :key="u.name">
          <span class="who">
            <a :href="metaUser(u.name)" target="_blank" rel="noopener"><b>{{ u.name }}</b></a>
            <span class="when"><template v-if="u.online"><span class="dot" aria-hidden="true"></span>Online</template><template v-else><span class="dot off" aria-hidden="true"></span>Offline · {{ lastSeen(u.last_seen) }}</template></span>
          </span>
          <span class="nums"><span class="size-add">{{ num(u.ok) }}</span> rolled back<template v-if="u.failed"> · <span class="size-rm">{{ num(u.failed) }}</span> failed</template></span>
        </li>
      </ul>
    </section>
  </template>
</div>`
};
