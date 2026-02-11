(() => {
  const specialWikis = {
    'commonswiki': 'commons.wikimedia.org',
    'incubatorwiki': 'incubator.wikimedia.org',
    'mediawikiwiki': 'www.mediawiki.org',
    'metawiki': 'meta.wikimedia.org',
    'specieswiki': 'species.wikimedia.org',
    'wikidatawiki': 'www.wikidata.org',
    'wikifunctionswiki': 'www.wikifunctions.org',
    'wikimaniawiki': 'wikimania.wikimedia.org'
  };
  const mainProjects = ['wiktionary', 'wikibooks', 'wikinews', 'wikiquote', 'wikisource', 'wikiversity', 'wikivoyage'];
  let currentEdits = [];
  let nextUccontinueMap = {};

  function getWikiDomain(wiki) {
    if (specialWikis[wiki]) return specialWikis[wiki];
    for (let proj of mainProjects) {
      if (wiki.endsWith(proj)) {
        const lang = wiki.slice(0, -proj.length);
        return `${lang}.${proj}.org`;
      }
    }
    let lang = wiki.slice(0, -4).replace(/_/g, '-');
    return `${lang}.wikipedia.org`;
  }

  function getDiffUrl(wiki, revid) {
    return `https://${getWikiDomain(wiki)}/w/index.php?diff=${revid}`;
  }

  function getHistUrl(wiki, title) {
    return `https://${getWikiDomain(wiki)}/w/index.php?title=${encodeURIComponent(title)}&action=history`;
  }

  // ---------------- Load Global Contribs ----------------
  window.loadGlobalContribs = async function() {
    const username = document.getElementById("username").value.trim();
    if (!username) return alert("Please enter a username.");

    const tbody = document.getElementById("contribList");
    const card = document.getElementById("contribCard");
    const spinner = document.getElementById("spinner");
    const noEdits = document.getElementById("noEdits");
    const rollbackAllBtn = document.getElementById("rollbackAllBtn");
    const loadMoreWrapper = document.getElementById("loadMoreWrapper");

    spinner.classList.remove("d-none");
    card.classList.add("d-none");
    noEdits.classList.add("d-none");
    tbody.innerHTML = "";
    rollbackAllBtn.disabled = false;
    rollbackAllBtn.innerText = "Rollback All";
    loadMoreWrapper.classList.add("d-none"); // hide initially

    nextUccontinueMap = {}; // reset on new search

    try {
      const response = await fetch("/get_global_contribs", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "username=" + encodeURIComponent(username)
      });
      const data = await response.json();
      spinner.classList.add("d-none");

      if (!data.edits || data.edits.length === 0) {
        noEdits.classList.remove("d-none");
        currentEdits = [];
        return;
      }

      currentEdits = data.edits;
      nextUccontinueMap = data.next_uccontinue_map || {};
      card.classList.remove("d-none");

      data.edits.forEach(addEditRow);

      // Show Load More if there is more data
      if (Object.keys(nextUccontinueMap).length > 0) {
        loadMoreWrapper.classList.remove("d-none");
      }

    } catch (err) {
      spinner.classList.add("d-none");
      alert("Error fetching edits. Try again.");
      console.error(err);
    }
  }

  // ---------------- Helper to add a row ----------------
  function addEditRow(edit) {
    const tbody = document.getElementById("contribList");
    const tr = document.createElement("tr");
    tr.id = `edit-${edit.revid}`;
    tr.innerHTML = `
      <td>${edit.timestamp}</td>
      <td>${edit.wiki}</td>
      <td>${edit.title}</td>
      <td>${edit.comment || ''}</td>
      <td>${edit.sizediff > 0 ? '+' + edit.sizediff : edit.sizediff}</td>
      <td id="status-${edit.revid}">
        <a href="${getDiffUrl(edit.wiki, edit.revid)}" target="_blank" class="btn btn-sm btn-outline-secondary mb-1">Diff</a>
        <a href="${getHistUrl(edit.wiki, edit.title)}" target="_blank" class="btn btn-sm btn-outline-info mb-1">Hist</a>
        <span class="badge bg-warning">Pending</span>
      </td>
    `;
    tbody.appendChild(tr);
  }

  // ---------------- Load More Edits ----------------
  window.loadMoreEdits = async function() {
    const username = document.getElementById("username").value.trim();
    const loadMoreBtn = document.getElementById("loadMoreBtn");
    const spinner = document.getElementById("spinner");

    loadMoreBtn.disabled = true;
    loadMoreBtn.innerText = "Loading...";
    spinner.classList.remove("d-none");

    try {
      const formData = new URLSearchParams();
      formData.append("username", username);
      formData.append("uccontinue_map", JSON.stringify(nextUccontinueMap));

      const response = await fetch("/get_global_contribs", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString()
      });
      const data = await response.json();

      if (data.edits && data.edits.length > 0) {
        currentEdits = currentEdits.concat(data.edits);
        data.edits.forEach(addEditRow);
        nextUccontinueMap = data.next_uccontinue_map || {};
      }

      // Hide Load More if no more edits
      if (!nextUccontinueMap || Object.keys(nextUccontinueMap).length === 0) {
        document.getElementById("loadMoreWrapper").classList.add("d-none");
      }

    } catch (err) {
      console.error(err);
      alert("Error loading more edits.");
    }

    spinner.classList.add("d-none");
    loadMoreBtn.disabled = false;
    loadMoreBtn.innerText = "Load More";
  }

  // ---------------- Confirmation for Rollback All ----------------
  window.confirmRollbackAll = function() {
    if (currentEdits.length === 0) return;
    if (confirm("Are you sure you want to rollback all listed edits?")) {
      rollbackAll();
    }
  }

  window.rollbackAll = async function() {
    const rollbackAllBtn = document.getElementById("rollbackAllBtn");
    rollbackAllBtn.disabled = true;
    rollbackAllBtn.innerText = "Rolling back...";

    for (let edit of currentEdits) {
      try {
        const response = await fetch("/rollback_all", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ edits: [edit] })
        });
        const result = await response.json();
        if (result.success && result.results.length > 0) {
          const res = result.results[0];
          const statusTd = document.getElementById(`status-${res.revid}`);
          if (!statusTd) continue;

          let badge = statusTd.querySelector(".badge");
          if (!badge) {
            badge = document.createElement("span");
            statusTd.appendChild(badge);
          }
          badge.className = `badge bg-${res.status === "success" ? "success" : "danger"}`;
          badge.innerText = res.status;
        }
      } catch (err) {
        console.error(err);
      }
      await new Promise(r => setTimeout(r, 500));
    }

    rollbackAllBtn.innerText = "Rollback complete";
    rollbackAllBtn.classList.remove("btn-danger");
    rollbackAllBtn.classList.add("btn-success");
  }

})();
