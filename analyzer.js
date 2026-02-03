const { parseMessage, analyzeMessage, diffMessages, SEGMENT_LABELS, getOpcodes } = window.EdiEdifact;

const state = {
  mode: "analyze",
  left: null,
  right: null,
  leftParsed: null,
  rightParsed: null,
};

const sessionInfo = document.getElementById("sessionInfo");
const analyzeSource = document.getElementById("analyzeSource");
const compareSource = document.getElementById("compareSource");

const summarySender = document.getElementById("summarySender");
const summaryReceiver = document.getElementById("summaryReceiver");
const summaryType = document.getElementById("summaryType");
const summaryVersion = document.getElementById("summaryVersion");
const summaryDate = document.getElementById("summaryDate");
const summaryTime = document.getElementById("summaryTime");
const summarySegments = document.getElementById("summarySegments");
const rawPreview = document.getElementById("rawPreview");
const issuesTableBody = document.querySelector("#issuesTable tbody");

const detailsTree = document.getElementById("detailsTree");
const detailsSearchInputs = [
  document.getElementById("detailsSearch1"),
  document.getElementById("detailsSearch2"),
  document.getElementById("detailsSearch3"),
];

const showSegmentsBtn = document.getElementById("showSegmentsBtn");
const expandSegmentsBtn = document.getElementById("expandSegmentsBtn");
const expandElementsBtn = document.getElementById("expandElementsBtn");
const collapseAllBtn = document.getElementById("collapseAllBtn");

const compareShowAll = document.getElementById("compareShowAll");
const compareCharDiff = document.getElementById("compareCharDiff");
const compareForgiving = document.getElementById("compareForgiving");
const diffTableBody = document.querySelector("#diffTable tbody");
const leftHeader = document.getElementById("leftHeader");
const rightHeader = document.getElementById("rightHeader");

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setSummary(summary) {
  summarySender.textContent = summary.sender || "-";
  summaryReceiver.textContent = summary.receiver || "-";
  summaryType.textContent = summary.message_type || "-";
  const version = summary.message_version || "-";
  const release = summary.message_release || "";
  const agency = summary.message_agency || "";
  const versionText = `${version} ${release} ${agency}`.trim();
  summaryVersion.textContent = versionText || "-";
  summaryDate.textContent = summary.date || "-";
  summaryTime.textContent = summary.time || "-";
  summarySegments.textContent = summary.segment_count ? String(summary.segment_count) : "-";
}

function updateIssues(issues) {
  issuesTableBody.innerHTML = "";
  if (!issues.length) {
    const row = document.createElement("tr");
    row.innerHTML = "<td colspan=\"4\">No issues detected.</td>";
    issuesTableBody.appendChild(row);
    return;
  }
  for (const issue of issues) {
    const segLabel = issue.segment_raw
      ? issue.segment_raw
      : issue.segment_tag
      ? `${issue.segment_tag}${issue.segment_index ? ` #${issue.segment_index}` : ""}`
      : "";
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(issue.severity || "")}</td>
      <td>${escapeHtml(issue.code || "")}</td>
      <td>${escapeHtml(issue.message || "")}</td>
      <td title="${escapeHtml(issue.segment_raw || "")}">${escapeHtml(segLabel)}</td>
    `;
    issuesTableBody.appendChild(row);
  }
}

function buildDetails(parsed) {
  detailsTree.innerHTML = "";
  if (!parsed || !parsed.segments || !parsed.segments.length) {
    detailsTree.textContent = "No message loaded.";
    return;
  }
  parsed.segments.forEach((seg) => {
    const segDetails = document.createElement("details");
    segDetails.className = "seg";
    segDetails.open = true;
    const segSummary = document.createElement("summary");
    const segLabel = SEGMENT_LABELS[seg.tag] || "Segment";
    segSummary.innerHTML = `
      <span class="label">${escapeHtml(`${seg.tag} - ${segLabel}`)}</span>
      <span class="value" data-value>${escapeHtml(seg.raw)}</span>
    `;
    segDetails.appendChild(segSummary);
    seg.elements.forEach((element, eidx) => {
      const elemDetails = document.createElement("details");
      elemDetails.className = "element";
      elemDetails.open = true;
      const elemSummary = document.createElement("summary");
      const elemValue = element.every((comp) => comp === "") ? "<Empty>" : element.join(":");
      elemSummary.innerHTML = `
        <span class="label">${escapeHtml(`Element ${eidx + 1}`)}</span>
        <span class="value" data-value>${escapeHtml(elemValue)}</span>
      `;
      elemDetails.appendChild(elemSummary);
      element.forEach((component, cidx) => {
        const compRow = document.createElement("div");
        compRow.className = "component";
        compRow.innerHTML = `
          <span class="label">${escapeHtml(`Component ${cidx + 1}`)}</span>
          <span class="value" data-value>${escapeHtml(component)}</span>
        `;
        elemDetails.appendChild(compRow);
      });
      segDetails.appendChild(elemDetails);
    });
    detailsTree.appendChild(segDetails);
  });
  applyDetailsSearch();
}

function applyDetailsSearch() {
  const needles = detailsSearchInputs.map((input) => (input.value || "").trim().toLowerCase());
  const values = detailsTree.querySelectorAll("[data-value]");
  values.forEach((node) => {
    node.classList.remove("match-1", "match-2", "match-3");
    const text = (node.textContent || "").toLowerCase();
    needles.forEach((needle, idx) => {
      if (needle && text.includes(needle)) {
        node.classList.add(`match-${idx + 1}`);
      }
    });
  });
}

function setDetailsExpansion({ openSegments, openElements }) {
  const segs = detailsTree.querySelectorAll("details.seg");
  segs.forEach((seg) => {
    seg.open = openSegments;
  });
  const elements = detailsTree.querySelectorAll("details.element");
  elements.forEach((element) => {
    element.open = openElements;
  });
}

function diffToHtml(left, right, charLevel) {
  if (!left && !right) return ["", ""];
  if (!left) return ["", wrapInsert(right)];
  if (!right) return [wrapDelete(left), ""];
  if (charLevel) {
    const leftChars = Array.from(left);
    const rightChars = Array.from(right);
    const opcodes = getOpcodes(leftChars, rightChars);
    const leftParts = [];
    const rightParts = [];
    opcodes.forEach((op) => {
      const lseg = leftChars.slice(op.i1, op.i2).join("");
      const rseg = rightChars.slice(op.j1, op.j2).join("");
      if (op.tag === "equal") {
        leftParts.push(escapeHtml(lseg));
        rightParts.push(escapeHtml(rseg));
      } else if (op.tag === "delete") {
        leftParts.push(wrapDelete(lseg));
      } else if (op.tag === "insert") {
        rightParts.push(wrapInsert(rseg));
      } else {
        leftParts.push(wrapChange(lseg));
        rightParts.push(wrapChange(rseg));
      }
    });
    return [leftParts.join(""), rightParts.join("")];
  }

  const leftParts = [];
  const rightParts = [];
  const leftElements = left.split("+");
  const rightElements = right.split("+");
  const maxLen = Math.max(leftElements.length, rightElements.length);
  for (let i = 0; i < maxLen; i += 1) {
    if (i > 0) {
      leftParts.push(escapeHtml("+"));
      rightParts.push(escapeHtml("+"));
    }
    const leftElem = leftElements[i] || "";
    const rightElem = rightElements[i] || "";
    if (leftElem.includes(":") || rightElem.includes(":")) {
      const leftComps = leftElem.split(":");
      const rightComps = rightElem.split(":");
      const maxComps = Math.max(leftComps.length, rightComps.length);
      for (let j = 0; j < maxComps; j += 1) {
        const leftComp = leftComps[j] || "";
        const rightComp = rightComps[j] || "";
        if (j > 0) {
          if (leftComp || j < leftComps.length) leftParts.push(escapeHtml(":"));
          if (rightComp || j < rightComps.length) rightParts.push(escapeHtml(":"));
        }
        if (leftComp === rightComp) {
          leftParts.push(escapeHtml(leftComp));
          rightParts.push(escapeHtml(rightComp));
        } else if (leftComp && rightComp) {
          leftParts.push(wrapChange(leftComp));
          rightParts.push(wrapChange(rightComp));
        } else if (leftComp) {
          leftParts.push(wrapDelete(leftComp));
        } else if (rightComp) {
          rightParts.push(wrapInsert(rightComp));
        }
      }
    } else {
      if (leftElem === rightElem) {
        leftParts.push(escapeHtml(leftElem));
        rightParts.push(escapeHtml(rightElem));
      } else if (leftElem && rightElem) {
        leftParts.push(wrapChange(leftElem));
        rightParts.push(wrapChange(rightElem));
      } else if (leftElem) {
        leftParts.push(wrapDelete(leftElem));
      } else if (rightElem) {
        rightParts.push(wrapInsert(rightElem));
      }
    }
  }
  return [leftParts.join(""), rightParts.join("")];
}

function wrapDelete(text) {
  return `<span class="diff-del">${escapeHtml(text)}</span>`;
}

function wrapInsert(text) {
  return `<span class="diff-ins">${escapeHtml(text)}</span>`;
}

function wrapChange(text) {
  return `<span class="diff-chg">${escapeHtml(text)}</span>`;
}

function renderCompare() {
  diffTableBody.innerHTML = "";
  if (!state.leftParsed || !state.rightParsed) {
    compareSource.textContent = "No comparison loaded.";
    return;
  }
  const includeEqual = compareShowAll.checked;
  const forgiving = compareForgiving.checked;
  const charLevel = compareCharDiff.checked;
  const diffs = diffMessages(state.leftParsed, state.rightParsed, includeEqual, forgiving);
  if (!diffs.length) {
    const row = document.createElement("tr");
    row.innerHTML = "<td colspan=\"4\">No differences found.</td>";
    diffTableBody.appendChild(row);
    return;
  }
  diffs.forEach((diffItem) => {
    const row = document.createElement("tr");
    const [leftHtml, rightHtml] = diffToHtml(diffItem.left || "", diffItem.right || "", charLevel);
    row.innerHTML = `
      <td>${escapeHtml(diffItem.type || "")}</td>
      <td>${escapeHtml(diffItem.segment || "")}</td>
      <td class="diff-cell">${leftHtml}</td>
      <td class="diff-cell">${rightHtml}</td>
    `;
    diffTableBody.appendChild(row);
  });
}

function setTabs() {
  const tabButtons = document.querySelectorAll(".tab-btn");
  const panels = document.querySelectorAll(".tab-panel");
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.tab;
      tabButtons.forEach((btn) => btn.classList.toggle("is-active", btn === button));
      panels.forEach((panel) => {
        panel.classList.toggle("is-active", panel.id === `tab-${target}`);
      });
    });
  });
}

function loadAnalyze() {
  if (!state.left) {
    analyzeSource.textContent = "No message loaded.";
    rawPreview.value = "";
    setSummary({});
    updateIssues([]);
    detailsTree.textContent = "No message loaded.";
    return;
  }
  const name = state.left.name || "Message";
  analyzeSource.textContent = `Loaded from ${name}`;
  const parsed = parseMessage(state.left.text || "");
  state.leftParsed = parsed;
  rawPreview.value = state.left.text || "";
  const analysis = analyzeMessage(parsed);
  setSummary(analysis.summary || {});
  updateIssues(analysis.issues || []);
  buildDetails(parsed);
}

function loadCompare() {
  if (!state.right) return;
  const leftName = state.left?.name || "Left";
  const rightName = state.right?.name || "Right";
  leftHeader.textContent = leftName;
  rightHeader.textContent = rightName;
  compareSource.textContent = `${leftName} vs ${rightName}`;
  state.rightParsed = parseMessage(state.right.text || "");
  renderCompare();
}

function wireEvents() {
  detailsSearchInputs.forEach((input) => {
    input.addEventListener("input", applyDetailsSearch);
  });
  showSegmentsBtn.addEventListener("click", () => setDetailsExpansion({ openSegments: true, openElements: false }));
  expandSegmentsBtn.addEventListener("click", () => setDetailsExpansion({ openSegments: true, openElements: false }));
  expandElementsBtn.addEventListener("click", () => setDetailsExpansion({ openSegments: true, openElements: true }));
  collapseAllBtn.addEventListener("click", () => setDetailsExpansion({ openSegments: false, openElements: false }));
  compareShowAll.addEventListener("change", renderCompare);
  compareCharDiff.addEventListener("change", renderCompare);
  compareForgiving.addEventListener("change", renderCompare);
}

async function loadSession() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get("session");
  if (!sessionId) {
    sessionInfo.textContent = "No session data found.";
    return;
  }
  const stored = await chrome.storage.local.get(sessionId);
  const payload = stored[sessionId];
  if (!payload) {
    sessionInfo.textContent = "Session data missing or expired.";
    return;
  }
  await chrome.storage.local.remove(sessionId);
  state.mode = payload.mode || "analyze";
  state.left = payload.left || null;
  state.right = payload.right || null;
  sessionInfo.textContent = `Session loaded: ${state.mode}`;
  loadAnalyze();
  if (state.mode === "compare") {
    loadCompare();
  }
}

setTabs();
wireEvents();
loadSession();
