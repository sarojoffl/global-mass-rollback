import { createApp, ref, computed, onMounted } from 'vue';
import {
  CdxButton, CdxCheckbox, CdxDialog, CdxField,
  CdxIcon, CdxMessage, CdxProgressIndicator, CdxTextInput,
  icons,
} from './codex.js';

// ── Wiki helper functions ─────────────────────────────────────────────────────
const specialWikis = {
  commonswiki:      'commons.wikimedia.org',
  incubatorwiki:    'incubator.wikimedia.org',
  mediawikiwiki:    'www.mediawiki.org',
  metawiki:         'meta.wikimedia.org',
  specieswiki:      'species.wikimedia.org',
  wikidatawiki:     'www.wikidata.org',
  wikifunctionswiki:'www.wikifunctions.org',
  wikimaniawiki:    'wikimania.wikimedia.org',
};
const mainProjects = ['wiktionary', 'wikibooks', 'wikinews', 'wikiquote', 'wikisource', 'wikiversity', 'wikivoyage'];

function getWikiDomain(wiki) {
  if (specialWikis[wiki]) return specialWikis[wiki];
  for (const proj of mainProjects) {
    if (wiki.endsWith(proj)) {
      const lang = wiki.slice(0, -proj.length);
      return `${lang}.${proj}.org`;
    }
  }
  const lang = wiki.slice(0, -4).replace(/_/g, '-');
  return `${lang}.wikipedia.org`;
}

function getDiffUrl(wiki, revid)  { return `https://${getWikiDomain(wiki)}/w/index.php?diff=${revid}`; }
function getHistUrl(wiki, title)  { return `https://${getWikiDomain(wiki)}/w/index.php?title=${encodeURIComponent(title)}&action=history`; }

// ── App ───────────────────────────────────────────────────────────────────────
const App = {
  components: { CdxButton, CdxCheckbox, CdxDialog, CdxField, CdxIcon, CdxMessage, CdxProgressIndicator, CdxTextInput },

  setup() {
    // Read server-rendered state from data-* attributes on #app
    const el = document.getElementById('app');
    const loggedIn      = el.dataset.loggedIn === 'true';
    const username      = el.dataset.username || '';
    const isAuthorized  = el.dataset.isAuthorized === 'true';
    const logo          = el.dataset.logo || '';

    // Theme
    const theme = ref(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
    function toggleTheme() {
      theme.value = theme.value === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = theme.value;
      const darkLink = document.getElementById('gmr-dark');
      if (darkLink) darkLink.media = theme.value === 'dark' ? 'all' : 'not all';
      try { localStorage.setItem('gmr-theme', theme.value); } catch (e) {}
    }

    // Form state
    const searchUsername  = ref('');
    const markbot         = ref(false);

    // Data state
    const isLoading       = ref(false);
    const edits           = ref([]);
    const nextUccMap      = ref({});
    const noEdits         = ref(false);
    const loadingMore     = ref(false);

    // Rollback state
    const rollbackStatus  = ref({}); // revid → { status: 'pending'|'success'|'failed'|'running', error? }
    const isRollingBack   = ref(false);
    const rollbackDone    = ref(false);
    const confirmOpen     = ref(false);

    const hasEdits = computed(() => edits.value.length > 0);
    const hasMore  = computed(() => Object.keys(nextUccMap.value).length > 0);

    // ── Search ──────────────────────────────────────────────────────────────
    async function search() {
      const name = searchUsername.value.trim();
      if (!name) return;

      isLoading.value = true;
      edits.value = [];
      rollbackStatus.value = {};
      rollbackDone.value = false;
      noEdits.value = false;
      nextUccMap.value = {};

      try {
        const res = await fetch('/get_global_contribs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'username=' + encodeURIComponent(name),
        });
        const data = await res.json();
        if (!data.edits || data.edits.length === 0) {
          noEdits.value = true;
        } else {
          edits.value = data.edits;
          nextUccMap.value = data.next_uccontinue_map || {};
          initStatus();
        }
      } catch (err) {
        console.error(err);
      } finally {
        isLoading.value = false;
      }
    }

    function initStatus() {
      const s = {};
      for (const e of edits.value) s[e.revid] = { status: 'pending' };
      rollbackStatus.value = s;
    }

    // ── Load More ───────────────────────────────────────────────────────────
    async function loadMore() {
      loadingMore.value = true;
      try {
        const res = await fetch('/get_global_contribs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'username=' + encodeURIComponent(searchUsername.value.trim()) +
                '&uccontinue_map=' + encodeURIComponent(JSON.stringify(nextUccMap.value)),
        });
        const data = await res.json();
        if (data.edits && data.edits.length > 0) {
          edits.value = data.edits;
          nextUccMap.value = data.next_uccontinue_map || {};
          initStatus();
          rollbackDone.value = false;
        }
      } catch (err) {
        console.error(err);
      } finally {
        loadingMore.value = false;
      }
    }

    // ── Rollback ────────────────────────────────────────────────────────────
    function openConfirm() {
      if (!hasEdits.value || isRollingBack.value) return;
      confirmOpen.value = true;
    }

    async function rollbackAll() {
      confirmOpen.value = false;
      isRollingBack.value = true;
      rollbackDone.value = false;

      for (const edit of edits.value) {
        rollbackStatus.value[edit.revid] = { status: 'running' };
        try {
          const res = await fetch('/rollback_all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ edits: [edit], markbot: markbot.value }),
          });
          const result = await res.json();
          if (result.success && result.results.length > 0) {
            const r = result.results[0];
            rollbackStatus.value[r.revid] = { status: r.status, error: r.error };
          }
        } catch (err) {
          rollbackStatus.value[edit.revid] = { status: 'failed', error: String(err) };
        }
        await new Promise(r => setTimeout(r, 500));
      }

      isRollingBack.value = false;
      rollbackDone.value = true;
    }

    // Size diff helper
    function fmtDiff(n) {
      if (n === undefined || n === null) return '';
      return n > 0 ? `+${n}` : String(n);
    }
    function diffClass(n) {
      if (n > 0) return 'size-add';
      if (n < 0) return 'size-rm';
      return 'size-zero';
    }

    return {
      loggedIn, username, isAuthorized, logo,
      theme, toggleTheme,
      searchUsername, markbot,
      isLoading, edits, nextUccMap, noEdits, loadingMore,
      hasEdits, hasMore,
      rollbackStatus, isRollingBack, rollbackDone, confirmOpen,
      search, loadMore, openConfirm, rollbackAll,
      fmtDiff, diffClass,
      getDiffUrl, getHistUrl,
      icons,
    };
  },

  template: `
<div class="shell">

  <!-- ── Header ─────────────────────────────────────────────────────────── -->
  <header class="hdr">
    <div class="hdr-in">
      <a class="brand" href="#">
        <img :src="logo" alt="" width="28" height="28">
        Global Mass Rollback
      </a>
      <div class="acct" v-if="loggedIn">
        <cdx-icon :icon="icons.user" size="small"/>
        <span class="who">{{ username }}</span>
        <a class="cdx-button cdx-button--fake-button cdx-button--fake-button--enabled cdx-button--weight-quiet cdx-button--size-medium" href="/logout">
          <cdx-icon :icon="icons.logOut"/> Log out
        </a>
      </div>
      <div class="themesw">
        <cdx-button weight="quiet"
          :aria-label="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
          @click="toggleTheme">
          <cdx-icon :icon="theme === 'dark' ? icons.sun : icons.moon"/>
        </cdx-button>
      </div>
    </div>
  </header>

  <!-- ── Main ───────────────────────────────────────────────────────────── -->
  <main>

    <!-- Not logged in -->
    <template v-if="!loggedIn">
      <div class="login-card">
        <img :src="logo" alt="Global Mass Rollback" width="64" height="64" class="login-logo">
        <h1 class="login-title">Global Mass Rollback</h1>
        <p class="login-sub">Authenticate with Wikimedia OAuth to use this tool.</p>
        <a class="cdx-button cdx-button--fake-button cdx-button--fake-button--enabled cdx-button--weight-primary cdx-button--action-progressive cdx-button--size-large login-btn" href="/login">
          <cdx-icon :icon="icons.logIn"/> Login with Wikimedia
        </a>
      </div>
    </template>

    <!-- Logged in but not authorised -->
    <template v-else-if="!isAuthorized">
      <cdx-message type="error" class="auth-err">
        <strong>Access denied.</strong> This tool is only available to
        <strong>global rollbackers</strong>, <strong>stewards</strong>, and
        <strong>global sysops</strong>.<br>
        <small>If you have these rights, try logging out and back in.</small>
      </cdx-message>
    </template>

    <!-- Authorised view -->
    <template v-else>

      <!-- Search panel -->
      <div class="panel">
        <div class="search-row">
          <cdx-field class="search-field" label="Username to roll back" hide-label>
            <cdx-text-input
              v-model="searchUsername"
              placeholder="Enter username"
              @keyup.enter="search"
              :disabled="isLoading || isRollingBack"
            >
              <template #suffix>
                <cdx-icon :icon="icons.user"/>
              </template>
            </cdx-text-input>
          </cdx-field>
          <cdx-button
            weight="primary"
            action="progressive"
            :disabled="!searchUsername.trim() || isLoading || isRollingBack"
            @click="search">
            <cdx-icon :icon="icons.search"/> Search
          </cdx-button>
        </div>
        <cdx-checkbox v-model="markbot" :disabled="isRollingBack">
          <cdx-icon :icon="icons.robot" size="small"/> Mark edits as bot edits
        </cdx-checkbox>
      </div>

      <!-- Spinner -->
      <div v-if="isLoading" class="loading">
        <cdx-progress-indicator/> Loading contributions…
      </div>

      <!-- No edits -->
      <cdx-message v-if="noEdits && !isLoading" type="warning" class="mt">
        No recent top edits found for this user.
      </cdx-message>

      <!-- Results -->
      <div v-if="hasEdits && !isLoading" class="panel p0">
        <!-- Panel header -->
        <div class="panelhead">
          <h2>Latest edits</h2>
          <div class="actions-row">
            <cdx-button
              v-if="hasMore"
              weight="quiet"
              :disabled="loadingMore || isRollingBack"
              @click="loadMore">
              <cdx-icon :icon="icons.clock"/>
              {{ loadingMore ? 'Loading…' : 'Load more' }}
            </cdx-button>
            <cdx-button
              weight="primary"
              action="destructive"
              :disabled="isRollingBack || rollbackDone"
              @click="openConfirm">
              <cdx-icon :icon="icons.undo"/>
              {{ isRollingBack ? 'Rolling back…' : rollbackDone ? 'Complete' : 'Rollback all' }}
            </cdx-button>
          </div>
        </div>

        <!-- Table -->
        <div class="table-wrap">
          <table class="cdx-table__table gmr-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Project</th>
                <th>Page</th>
                <th>Summary</th>
                <th>Size</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="edit in edits" :key="edit.revid">
                <td class="ts nw">{{ edit.timestamp }}</td>
                <td class="nw">{{ edit.wiki }}</td>
                <td>{{ edit.title }}</td>
                <td class="cmt">{{ edit.comment || '' }}</td>
                <td class="nw" :class="diffClass(edit.sizediff)">{{ fmtDiff(edit.sizediff) }}</td>
                <td class="nw">
                  <span v-if="rollbackStatus[edit.revid]">
                    <span v-if="rollbackStatus[edit.revid].status === 'pending'"
                          class="gs-tag">Pending</span>
                    <span v-else-if="rollbackStatus[edit.revid].status === 'running'"
                          class="gs-tag is-progressive">Rolling back…</span>
                    <span v-else-if="rollbackStatus[edit.revid].status === 'success'"
                          class="gs-tag is-success">
                      <cdx-icon :icon="icons.check" size="small"/> Done
                    </span>
                    <span v-else class="gs-tag is-error"
                          :title="rollbackStatus[edit.revid].error || ''">
                      <cdx-icon :icon="icons.error" size="small"/> Failed
                    </span>
                  </span>
                </td>
                <td class="nw">
                  <a :href="getDiffUrl(edit.wiki, edit.revid)" target="_blank" class="cdx-button cdx-button--fake-button cdx-button--fake-button--enabled cdx-button--weight-quiet cdx-button--size-small">
                    <cdx-icon :icon="icons.ext" size="small"/> Diff
                  </a>
                  <a :href="getHistUrl(edit.wiki, edit.title)" target="_blank" class="cdx-button cdx-button--fake-button cdx-button--fake-button--enabled cdx-button--weight-quiet cdx-button--size-small">
                    <cdx-icon :icon="icons.clock" size="small"/> Hist
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

    </template>
  </main>

  <!-- ── Footer ─────────────────────────────────────────────────────────── -->
  <footer class="footer">
    <p>Made by <a href="https://meta.wikimedia.org/wiki/User:Saroj" target="_blank">Saroj</a></p>
    <p>Powered by <a href="https://wikitech.wikimedia.org/wiki/Portal:Toolforge" target="_blank">Toolforge</a>
       &middot; <a href="https://meta.wikimedia.org/wiki/User_talk:Saroj" target="_blank">Report an issue</a></p>
  </footer>

  <!-- ── Confirm rollback dialog ────────────────────────────────────────── -->
  <cdx-dialog
    v-model:open="confirmOpen"
    title="Confirm rollback"
    :primary-action="{ label: 'Rollback all', actionType: 'destructive' }"
    :default-action="{ label: 'Cancel' }"
    @primary="rollbackAll"
    @default="confirmOpen = false">
    <template #default>
      Are you sure you want to roll back all <strong>{{ edits.length }}</strong> listed edits?
      This action cannot be undone.
    </template>
  </cdx-dialog>

</div>
`,
};

createApp(App).mount('#app');
