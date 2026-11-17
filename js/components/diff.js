// diff of one edit, loaded from the wiki api when opened
import { onMounted, ref } from 'vue';
import { CdxMessage } from '../codex.js';

const cache = new Map();

async function loadDiff(edit) {
  const key = edit.wiki + ':' + edit.revid;
  if (cache.has(key)) return cache.get(key);
  const q = new URLSearchParams({ action: 'compare', fromrev: edit.revid, torelative: 'prev', prop: 'diff|ids', difftype: 'table', format: 'json', formatversion: '2', origin: '*' });
  const r = await fetch(edit.wiki_api + '?' + q);
  const d = await r.json();
  if (d.error) {
    if (edit.new) return { html: '', note: 'New page, nothing to compare.' };
    throw new Error(d.error.info || d.error.code);
  }
  const out = { html: d.compare && d.compare.body || '', note: '' };
  if (!out.html) out.note = 'No change.';
  cache.set(key, out);
  return out;
}

export const DiffView = {
  props: { edit: Object },
  components: { CdxMessage },
  setup(props) {
    const d = ref(null), err = ref('');
    onMounted(async () => {
      try { d.value = await loadDiff(props.edit); } catch (e) { err.value = 'Could not load the diff: ' + e.message; }
    });
    return { d, err };
  },
  template: `
<div class="diffbox">
  <cdx-message v-if="err" type="error" inline>{{ err }}</cdx-message>
  <div v-else-if="!d" class="loading small"><cdx-progress-indicator>Loading diff</cdx-progress-indicator> Loading diff…</div>
  <template v-else>
    <p v-if="d.note" class="muted small">{{ d.note }}</p>
    <div v-if="d.html" class="diffscroll">
      <table class="diff">
        <colgroup><col class="diff-marker"><col class="diff-content"><col class="diff-marker"><col class="diff-content"></colgroup>
        <tbody v-html="d.html"></tbody>
      </table>
    </div>
  </template>
</div>`
};
