// shared bits
import { CdxCard } from '../codex.js';

// outlined tag from gs-steward-stats
export const GsTag = {
  props: { status: { type: String, default: 'notice' } },
  template: `<span class="gs-tag" :class="'is-' + status"><slot/></span>`
};

export const StatCard = {
  props: { label: String, value: [String, Number], icon: Object, tone: { type: String, default: 'info' }, hint: String },
  components: { CdxCard },
  template: `<cdx-card class="stat" :class="'tone-' + tone" :icon="icon"><template #title>{{ value }}</template><template #description>{{ label }}</template><template v-if="hint" #supporting-text>{{ hint }}</template></cdx-card>`
};

export const SiteFooter = {
  props: { source: String, commit: String },
  template: `
<footer class="footer">
  <p>Made by <a href="https://meta.wikimedia.org/wiki/User:Saroj">Saroj</a></p>
  <p>Powered by <a href="https://wikitech.wikimedia.org/wiki/Portal:Toolforge">Toolforge</a> &middot; <a href="https://meta.wikimedia.org/wiki/User_talk:Saroj">Report an issue</a> &middot; <a href="https://meta.wikimedia.org/wiki/Global_Mass_Rollback">Documentation</a></p>
  <p v-if="source"><a :href="source">Source</a><template v-if="commit"> (<a class="mono" :href="source + '/commit/' + commit">{{ commit.slice(0, 7) }}</a>)</template></p>
</footer>`
};
