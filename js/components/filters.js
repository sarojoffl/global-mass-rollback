// search form, filter grid like gs-steward-stats
import { computed, ref } from 'vue';
import { get } from '../api.js';
import { CdxButton, CdxField, CdxIcon, CdxLookup, CdxMultiselectLookup, CdxSelect, CdxTextInput, icons } from '../codex.js';

export const blankForm = () => ({ username: '', limit: 50, wikis: [], comment: '', title: '', namespace: 'any', tag: '', from: '', to: '' });

const namespaces = [
  ['any', 'Any'], ['0', '(Main)'], ['1', 'Talk'], ['2', 'User'], ['3', 'User talk'], ['4', 'Project'], ['5', 'Project talk'],
  ['6', 'File'], ['8', 'MediaWiki'], ['10', 'Template'], ['12', 'Help'], ['14', 'Category'], ['118', 'Draft'], ['828', 'Module']
].map(([value, label]) => ({ value, label }));


const limits = [50, 100, 250, 500].map(n => ({ value: n, label: String(n) }));

let projectList = null;
function loadProjects() {
  if (!projectList) projectList = get('wikis').then(d => d.wikis).catch(() => { projectList = null; return []; });
  return projectList;
}

export const SearchForm = {
  props: { modelValue: Object, disabled: Boolean, busy: Boolean },
  emits: ['update:modelValue', 'search'],
  components: { CdxButton, CdxField, CdxIcon, CdxLookup, CdxMultiselectLookup, CdxSelect, CdxTextInput },
  setup(props, { emit }) {
    const f = computed(() => props.modelValue);
    const all = ref([]);
    const query = ref('');
    const more = ref(false);

    // username suggestions from meta, idea from upstream 674fd6c
    const userPick = ref(null);
    const userItems = ref([]);
    let timer = null, asked = '';
    function onUserInput(v) {
      clearTimeout(timer);
      userPick.value = null;
      const q = (v || '').trim();
      if (q.length < 2) { userItems.value = []; return; }
      timer = setTimeout(async () => {
        asked = q;
        const p = new URLSearchParams({ action: 'query', list: 'globalallusers', aguprefix: q[0].toUpperCase() + q.slice(1), agulimit: '8', format: 'json', formatversion: '2', origin: '*' });
        try {
          const d = await (await fetch('https://meta.wikimedia.org/w/api.php?' + p)).json();
          if (asked === q) userItems.value = ((d.query && d.query.globalallusers) || []).map(u => ({ value: u.name, label: u.name }));
        } catch (e) { userItems.value = []; }
      }, 250);
    }
    function onUserPick(v) {
      if (!v) return;
      emit('update:modelValue', { ...f.value, username: v });
      userItems.value = [];
      setTimeout(() => emit('search'));
    }
    // wait a tick so a picked suggestion lands first
    const onEnter = () => setTimeout(() => emit('search'));
    const chips = ref(f.value.wikis.map(w => ({ value: w })));
    loadProjects().then(w => { all.value = w; });

    const host = url => url.replace(/^https?:\/\//, '');
    const projectItems = computed(() => {
      const q = query.value.trim().toLowerCase();
      if (!q) return [];
      return all.value.filter(w => w.db.includes(q) || host(w.url).includes(q)).slice(0, 30)
        .map(w => ({ value: w.db, label: w.db, description: host(w.url) }));
    });
    const set = (k, v) => emit('update:modelValue', { ...f.value, [k]: v });
    const reset = () => { chips.value = []; query.value = ''; emit('update:modelValue', { ...blankForm(), username: f.value.username }); };

    return { f, chips, query, more, userPick, userItems, onUserInput, onUserPick, onEnter, projectItems, set, reset, namespaces, limits, icons };
  },
  template: `
<div>
  <div class="filters" :class="{ open: more }">
    <cdx-field class="full"><template #label>Username</template>
      <cdx-lookup v-model:selected="userPick" :input-value="f.username" @update:input-value="set('username', $event)" :menu-items="userItems" :menu-config="{ visibleItemLimit: 8 }"
        :start-icon="icons.user" placeholder="Username" :disabled="disabled" @input="onUserInput" @update:selected="onUserPick" @keydown.enter="onEnter"/>
    </cdx-field>
    <cdx-field class="wide"><template #label>Projects</template>
      <cdx-multiselect-lookup v-model:input-chips="chips" :selected="f.wikis" @update:selected="set('wikis', $event)" :menu-items="projectItems"
        :menu-config="{ visibleItemLimit: 8 }" :disabled="disabled" placeholder="All projects" @input="query = $event || ''">
        <template #no-results>No projects found.</template>
      </cdx-multiselect-lookup>
    </cdx-field>
    <cdx-field class="extra"><template #label>Summary</template><cdx-text-input :model-value="f.comment" @update:model-value="set('comment', $event)" :disabled="disabled" clearable placeholder="Contains"/></cdx-field>
    <cdx-field class="extra"><template #label>Page title</template><cdx-text-input :model-value="f.title" @update:model-value="set('title', $event)" :disabled="disabled" clearable placeholder="Contains"/></cdx-field>
    <cdx-field class="extra"><template #label>Namespace</template><cdx-select :selected="f.namespace" @update:selected="set('namespace', $event)" :menu-items="namespaces" :disabled="disabled"/></cdx-field>
    <cdx-field class="extra"><template #label>From (UTC)</template><cdx-text-input input-type="date" :model-value="f.from" @update:model-value="set('from', $event)" :disabled="disabled"/></cdx-field>
    <cdx-field class="extra"><template #label>To (UTC)</template><cdx-text-input input-type="date" :model-value="f.to" @update:model-value="set('to', $event)" :disabled="disabled"/></cdx-field>
    <cdx-field class="extra"><template #label>Tag</template><cdx-text-input :model-value="f.tag" @update:model-value="set('tag', $event)" :disabled="disabled" clearable placeholder="Any"/></cdx-field>
    <cdx-field class="extra"><template #label>Edits</template><cdx-select :selected="f.limit" @update:selected="set('limit', $event)" :menu-items="limits" :disabled="disabled"/></cdx-field>
  </div>
  <div class="toolbar">
    <cdx-button weight="primary" action="progressive" :disabled="disabled || !f.username.trim()" @click="$emit('search')"><cdx-icon :icon="icons.search"/> {{ busy ? 'Searching…' : 'Search' }}</cdx-button>
    <cdx-button class="mob-only" weight="quiet" @click="more = !more"><cdx-icon :icon="icons.filter"/> {{ more ? 'Fewer filters' : 'More filters' }}</cdx-button>
    <cdx-button :disabled="disabled" @click="reset"><cdx-icon :icon="icons.clear"/> Reset</cdx-button>
  </div>
</div>`
};
