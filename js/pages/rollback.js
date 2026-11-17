// search a user's top edits and roll them back
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { post } from '../api.js';
import { CdxButton, CdxCheckbox, CdxDialog, CdxField, CdxIcon, CdxMessage, CdxProgressBar, CdxTextInput, CdxToggleButton, icons } from '../codex.js';
import { fmtTs, num, plural, signed } from '../format.js';
import { route, setQuery, store } from '../store.js';
import { DiffView } from '../components/diff.js';
import { SearchForm, blankForm } from '../components/filters.js';

const keyOf = e => e.wiki + ':' + e.revid;
const pageUrl = e => e.wiki_url + '/wiki/' + encodeURIComponent(e.title.replace(/ /g, '_')).replace(/%2F/g, '/').replace(/%3A/g, ':');
const histUrl = e => e.wiki_url + '/w/index.php?title=' + encodeURIComponent(e.title) + '&action=history';
const diffUrl = e => e.wiki_url + '/w/index.php?diff=' + e.revid;
const contribsUrl = e => e.wiki_url + '/wiki/Special:Contributions/' + encodeURIComponent(e.user);
const sizeClass = n => (n > 0 ? 'size-add' : n < 0 ? 'size-rm' : 'size-zero');

export const RollbackPage = {
  components: { CdxButton, CdxCheckbox, CdxDialog, CdxField, CdxIcon, CdxTextInput, CdxMessage, CdxProgressBar, CdxToggleButton, DiffView, SearchForm },
  setup() {
    const authorized = computed(() => store.me.authorized);

    const form = ref({ ...blankForm(), username: route.value.query.user || '' });
    const searched = ref('');
    const filtered = ref(false);
    const loading = ref(false), loadingMore = ref(false), err = ref(''), note = ref('');

    const edits = ref([]);
    const next = ref({});
    const status = reactive({});  // key -> { s, code, info }
    const open = reactive({});
    const selecting = ref(false);
    const picked = reactive(new Set());

    const markbot = ref(false);
    const summary = ref('');
    const confirmOpen = ref(false);
    const running = ref(false);
    const stopAsked = ref(false);
    const queue = ref([]);

    const wikiCount = computed(() => new Set(edits.value.map(e => e.wiki)).size);
    const hasMore = computed(() => Object.keys(next.value).length > 0);
    const isDone = e => status[keyOf(e)] && status[keyOf(e)].s === 'success';
    // picked edits in select mode, else all not done
    const targets = computed(() => edits.value.filter(e => !isDone(e) && (!selecting.value || picked.has(keyOf(e)))));
    const counts = computed(() => {
      const c = { ok: 0, failed: 0 };
      for (const k of queue.value) { const s = status[k]; if (s && s.s === 'success') c.ok++; else if (s && s.s === 'failed') c.failed++; }
      return c;
    });
    const targetWikis = computed(() => new Set(targets.value.map(e => e.wiki)).size);

    function sendFilters(src = form.value) {
      const { username, limit, ...f } = src;
      if (f.namespace === 'any') f.namespace = '';
      if (f.kind === 'any') f.kind = '';
      return f;
    }

    async function search() {
      const name = form.value.username.trim();
      if (!name || loading.value || running.value) return;
      loading.value = true; err.value = ''; note.value = '';
      edits.value = []; next.value = {}; queue.value = [];
      for (const k of Object.keys(status)) delete status[k];
      for (const k of Object.keys(open)) delete open[k];
      picked.clear();
      setQuery({ user: name });
      try {
        const f = sendFilters();
        const d = await post('contribs', { username: name, limit: form.value.limit, filters: f });
        searched.value = name;
        filtered.value = JSON.stringify(f) !== JSON.stringify(sendFilters(blankForm()));
        edits.value = d.edits;
        next.value = d.next || {};
        if (d.failed_wikis && d.failed_wikis.length) note.value = 'Some projects did not answer: ' + d.failed_wikis.join(', ');
      } catch (e) { err.value = e.message; }
      finally { loading.value = false; }
    }

    async function loadMore() {
      loadingMore.value = true; err.value = '';
      try {
        const d = await post('contribs', { username: searched.value, limit: form.value.limit, filters: sendFilters(), next: next.value });
        const have = new Set(edits.value.map(keyOf));
        edits.value = edits.value.concat(d.edits.filter(e => !have.has(keyOf(e))));
        next.value = d.next || {};
      } catch (e) { err.value = e.message; }
      finally { loadingMore.value = false; }
    }

    function toggleSelecting(v) { selecting.value = v; if (!v) picked.clear(); }
    const togglePick = e => { const k = keyOf(e); picked.has(k) ? picked.delete(k) : picked.add(k); };
    const selectable = computed(() => edits.value.filter(e => !isDone(e)));
    const allPicked = computed(() => selectable.value.length > 0 && selectable.value.every(e => picked.has(keyOf(e))));
    const somePicked = computed(() => picked.size > 0 && !allPicked.value);
    const pickAll = v => { picked.clear(); if (v) for (const e of selectable.value) picked.add(keyOf(e)); };

    const toggleDiff = e => { const k = keyOf(e); open[k] = !open[k]; };

    function askRollback() { if (targets.value.length && !running.value) confirmOpen.value = true; }

    async function rollback() {
      confirmOpen.value = false;
      const list = targets.value.slice();
      if (!list.length) return;
      running.value = true; stopAsked.value = false;
      queue.value = list.map(keyOf);
      for (const e of list) {
        if (stopAsked.value) break;
        const k = keyOf(e);
        status[k] = { s: 'running' };
        try {
          const r = await post('rollback', { edit: e, markbot: markbot.value, summary: summary.value.trim() });
          status[k] = r.ok ? { s: 'success' } : { s: 'failed', code: r.code, info: r.info };
        } catch (x) {
          status[k] = { s: 'failed', code: 'request-failed', info: x.message };
        }
      }
      queue.value = queue.value.filter(k => status[k] && status[k].s !== 'running');
      running.value = false;
      if (selecting.value) for (const k of [...picked]) if (status[k] && status[k].s === 'success') picked.delete(k);
    }

    const retryFailed = () => {
      selecting.value = true; picked.clear();
      for (const e of edits.value) if (status[keyOf(e)] && status[keyOf(e)].s === 'failed') picked.add(keyOf(e));
      askRollback();
    };

    onMounted(() => { if (form.value.username && authorized.value) search(); });
    watch(() => route.value.name, () => { confirmOpen.value = false; });

    return {
      authorized, form, searched, filtered, loading, loadingMore, err, note,
      edits, hasMore, wikiCount, status, open, selecting, picked, allPicked, somePicked, markbot, summary, confirmOpen, running, stopAsked,
      queue, counts, targets, targetWikis,
      search, loadMore, toggleSelecting, togglePick, pickAll, toggleDiff, askRollback, rollback, retryFailed,
      keyOf, pageUrl, histUrl, diffUrl, contribsUrl, sizeClass, fmtTs, num, plural, signed, icons
    };
  },
  template: `
<div>
  <cdx-message v-if="!authorized" type="error" :allow-user-dismiss="false">
    <strong>Access denied.</strong> This tool is only for <strong>global rollbackers</strong>, <strong>stewards</strong> and <strong>global sysops</strong>.
    If you have one, log out and back in.
  </cdx-message>

  <template v-else>
    <section class="panel">
      <search-form v-model="form" :disabled="loading || running" :busy="loading" @search="search"/>
    </section>

    <cdx-message v-if="err" type="error" class="mb">{{ err }}</cdx-message>
    <cdx-message v-if="note" type="warning" class="mb">{{ note }}</cdx-message>
    <div v-if="loading" class="loading"><cdx-progress-indicator>Loading</cdx-progress-indicator> Loading</div>
    <cdx-message v-else-if="searched && !edits.length && !err" type="notice">No top edits found for {{ searched }}{{ filtered ? ' with these filters' : '' }}.</cdx-message>

    <section v-if="edits.length && !loading" class="panel p0 results">
      <div class="panelhead">
        <div>
          <h2>Latest edits by <a :href="'https://meta.wikimedia.org/wiki/Special:CentralAuth/' + encodeURIComponent(searched)" target="_blank" rel="noopener">{{ searched }}</a></h2>
          <p class="sub small">{{ plural(edits.length, 'edit') }} on {{ plural(wikiCount, 'project') }}</p>
        </div>
        <div class="grp">
          <cdx-toggle-button :model-value="selecting" :disabled="running" @update:model-value="toggleSelecting"><cdx-icon :icon="icons.checkAll"/> Select</cdx-toggle-button>
          <cdx-button v-if="hasMore" :disabled="loadingMore || running" @click="loadMore"><cdx-icon :icon="icons.more"/> {{ loadingMore ? 'Loading…' : 'Load more' }}</cdx-button>
        </div>
      </div>

      <div class="rbbar">
        <div class="grp">
          <cdx-checkbox v-model="markbot" :disabled="running" inline>Mark as bot edits</cdx-checkbox>
          <cdx-text-input v-model="summary" class="desk-only summary" :disabled="running" clearable placeholder="Rollback summary (optional)" aria-label="Rollback summary"/>
          <cdx-checkbox v-if="selecting" class="mob-only" :model-value="allPicked" :indeterminate="somePicked" :disabled="running" inline @update:model-value="pickAll">Select all</cdx-checkbox>
        </div>
        <div class="grp">
          <cdx-button v-if="running" @click="stopAsked = true" :disabled="stopAsked"><cdx-icon :icon="icons.stop"/> {{ stopAsked ? 'Stopping…' : 'Stop' }}</cdx-button>
          <cdx-button v-else-if="counts.failed" @click="retryFailed"><cdx-icon :icon="icons.reload"/> Retry<span class="desk-only"> failed</span></cdx-button>
          <cdx-button weight="primary" action="destructive" :disabled="running || !targets.length" @click="askRollback">
            <cdx-icon :icon="icons.undo"/>
            <template v-if="running">Rolling back…</template><template v-else>Rollback <span class="desk-only">{{ selecting ? 'selected' : 'all' }}</span> ({{ targets.length }})</template>
          </cdx-button>
        </div>
      </div>
      <div v-if="queue.length" class="rbprogress">
        <cdx-progress-bar v-if="running" inline aria-label="Rolling back"/>
        <span class="small"><b>{{ counts.ok + counts.failed }}</b> of {{ queue.length }} done ·
          <span class="size-add">{{ num(counts.ok) }} rolled back</span> ·
          <span :class="counts.failed ? 'size-rm' : 'muted'">{{ num(counts.failed) }} failed</span></span>
      </div>

      <div class="edits-head" :class="{ selecting }">
        <span v-if="selecting" class="c-check"><cdx-checkbox :model-value="allPicked" :indeterminate="somePicked" :disabled="running" @update:model-value="pickAll" aria-label="Select all"/></span>
        <span>Time (UTC)</span><span>Project</span><span>Page and summary</span><span class="r">Size</span><span>Status</span><span></span>
      </div>
      <ul class="edits">
        <li v-for="e in edits" :key="keyOf(e)" :class="{ selecting, done: status[keyOf(e)] && status[keyOf(e)].s === 'success', picked: picked.has(keyOf(e)) }">
          <div class="erow">
            <span v-if="selecting" class="c-check"><cdx-checkbox :model-value="picked.has(keyOf(e))" :disabled="running || (status[keyOf(e)] && status[keyOf(e)].s === 'success')" @update:model-value="togglePick(e)" :aria-label="'Select ' + e.title"/></span>
            <span class="c-time ts">{{ fmtTs(e.timestamp) }}</span>
            <span class="c-wiki"><a class="wtag" :href="contribsUrl(e)" target="_blank" rel="noopener">{{ e.wiki }}</a></span>
            <span class="c-main">
              <a class="page-link" :href="pageUrl(e)" target="_blank" rel="noopener">{{ e.title }}</a>
              <span v-if="e.new" class="flag" title="This edit created the page">N</span><span v-if="e.minor" class="flag" title="Minor edit">m</span>
              <span v-if="e.comment" class="cmt">{{ e.comment }}</span>
              <span v-if="e.tags && e.tags.length" class="etags"><span v-for="t in e.tags" :key="t" class="gs-tag small">{{ t }}</span></span>
            </span>
            <span class="c-size r" :class="sizeClass(e.sizediff)">{{ signed(e.sizediff) }}</span>
            <span class="c-status">
              <template v-if="status[keyOf(e)]">
                <gs-tag v-if="status[keyOf(e)].s === 'running'" status="progressive">Rolling back…</gs-tag>
                <gs-tag v-else-if="status[keyOf(e)].s === 'success'" status="success">Rolled back</gs-tag>
                <gs-tag v-else status="error" v-tooltip="status[keyOf(e)].info || status[keyOf(e)].code">Failed</gs-tag>
              </template>
              <gs-tag v-else-if="queue.includes(keyOf(e))">Waiting</gs-tag>
            </span>
            <span class="c-act">
              <cdx-button size="small" weight="quiet" :aria-expanded="!!open[keyOf(e)]" @click="toggleDiff(e)"><cdx-icon :icon="open[keyOf(e)] ? icons.collapse : icons.expand" size="small"/> Diff</cdx-button>
              <a class="cdx-button cdx-button--fake-button cdx-button--fake-button--enabled cdx-button--weight-quiet cdx-button--size-small" :href="histUrl(e)" target="_blank" rel="noopener" v-tooltip="'Page history'"><cdx-icon :icon="icons.history" size="small"/><span class="sr">History</span></a>
            </span>
          </div>
          <p v-if="status[keyOf(e)] && status[keyOf(e)].s === 'failed'" class="errline">{{ status[keyOf(e)].code }}<template v-if="status[keyOf(e)].info">: {{ status[keyOf(e)].info }}</template></p>
          <div v-if="open[keyOf(e)]" class="ediff">
            <div class="ediff-links small"><a :href="diffUrl(e)" target="_blank" rel="noopener">Open on {{ e.wiki }} <cdx-icon :icon="icons.ext" size="x-small"/></a></div>
            <diff-view :edit="e"/>
          </div>
        </li>
      </ul>
      <div v-if="hasMore" class="more"><cdx-button :disabled="loadingMore || running" @click="loadMore"><cdx-icon :icon="icons.more"/> {{ loadingMore ? 'Loading…' : 'Load more edits' }}</cdx-button></div>
    </section>
  </template>

  <cdx-dialog v-model:open="confirmOpen" title="Confirm rollback" :use-close-button="true"
    :primary-action="{ label: 'Rollback ' + targets.length, actionType: 'destructive' }" :default-action="{ label: 'Cancel' }"
    @primary="rollback" @default="confirmOpen = false">
    <p>Rollback <strong>{{ plural(targets.length, 'edit') }}</strong> by <strong>{{ searched }}</strong> on
      <strong>{{ plural(targetWikis, 'project') }}</strong>?</p>
    <p>All their consecutive edits on each page get reverted.</p>
    <cdx-field class="mb"><template #label>Summary</template>
      <cdx-text-input v-model="summary" clearable placeholder="Default rollback summary"/>
    </cdx-field>
    <cdx-checkbox v-model="markbot">Mark edits as bot edits</cdx-checkbox>
  </cdx-dialog>
</div>`
};
