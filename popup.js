const statusEl = document.getElementById("status");

const analyzeFile = document.getElementById("analyzeFile");
const analyzeUrl = document.getElementById("analyzeUrl");
const analyzeBtn = document.getElementById("analyzeBtn");

const compareLeftFile = document.getElementById("compareLeftFile");
const compareLeftUrl = document.getElementById("compareLeftUrl");
const compareRightFile = document.getElementById("compareRightFile");
const compareRightUrl = document.getElementById("compareRightUrl");
const compareBtn = document.getElementById("compareBtn");

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#b91c1c" : "#6b645c";
}

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read file."));
    reader.readAsText(file);
  });
}

async function fetchUrlText(url) {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url} (${response.status})`);
  }
  return response.text();
}

async function resolveInput(fileInput, urlInput, label) {
  const file = fileInput.files && fileInput.files[0];
  const url = (urlInput.value || "").trim();
  if (file) {
    const text = await readFileText(file);
    return { text, name: file.name, source: "file" };
  }
  if (url) {
    const text = await fetchUrlText(url);
    return { text, name: label, source: url };
  }
  return null;
}

function createSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function openAnalyzer(payload) {
  const sessionId = createSessionId();
  await chrome.storage.local.set({ [sessionId]: payload });
  const url = chrome.runtime.getURL(`analyzer.html?session=${encodeURIComponent(sessionId)}`);
  await chrome.tabs.create({ url });
}

analyzeBtn.addEventListener("click", async () => {
  try {
    setStatus("Loading...");
    const data = await resolveInput(analyzeFile, analyzeUrl, "SharePoint file");
    if (!data) {
      setStatus("Choose a file or enter a URL first.", true);
      return;
    }
    await openAnalyzer({ mode: "analyze", left: data });
    setStatus("Opened analyzer.");
  } catch (error) {
    setStatus(error.message || "Failed to open analyzer.", true);
  }
});

compareBtn.addEventListener("click", async () => {
  try {
    setStatus("Loading comparison...");
    const left = await resolveInput(compareLeftFile, compareLeftUrl, "SharePoint left file");
    const right = await resolveInput(compareRightFile, compareRightUrl, "SharePoint right file");
    if (!left || !right) {
      setStatus("Choose both left and right sources.", true);
      return;
    }
    await openAnalyzer({ mode: "compare", left, right });
    setStatus("Opened comparison.");
  } catch (error) {
    setStatus(error.message || "Failed to open comparison.", true);
  }
});
