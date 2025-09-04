

import api, { route } from "@forge/api";

// ---------- Constants ----------
const THEMES = ["Feature Request", "Integration", "Bug", "Query", "Other"];
const IMPACTS = ["High", "Medium", "Low"];

// ---------- Logging ----------
const log = (level, msg, data) => {
  // Structured JSON logs for `forge logs`
  try {
    console.log(JSON.stringify({ level, msg, ...(data && typeof data === "object" ? { data } : { extra: data }) }));
  } catch (e) {
    console.log(`${level} ${msg}`);
  }
};

// ---------- ADF helpers ----------
const textFromNode = (node) => {
  if (!node) return "";
  if (node.text) return node.text;
  if (!node.content) return "";
  return node.content.map(textFromNode).join("");
};

const findNodes = (root, predicate, path = []) => {
  const found = [];
  const stack = [{ node: root, path }];
  while (stack.length) {
    const { node, path } = stack.pop();
    if (predicate(node)) found.push({ node, path });
    if (node && node.content) {
      for (let i = node.content.length - 1; i >= 0; i--) {
        stack.push({ node: node.content[i], path: [...path, i] });
      }
    }
  }
  return found;
};

const getAtPath = (root, path) => {
  let cur = root;
  for (const idx of path) cur = cur && cur.content ? cur.content[idx] : undefined;
  return cur;
};

const setAtPath = (root, path, newNode) => {
  if (!path.length) return; // no root replacement
  const parentPath = path.slice(0, -1);
  const idx = path[path.length - 1];
  const parent = getAtPath(root, parentPath);
  if (!parent || !parent.content) throw new Error("Invalid path for setAtPath");
  parent.content[idx] = newNode;
};

const headerCell = (text) => ({
  type: "tableHeader",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const ensureHeaderCols = (table) => {
  const rows = table.content || [];
  if (rows.length === 0) throw new Error("Table has no rows");
  const headerRow = rows[0];
  const headerCells = headerRow.content || [];
  const colNames = headerCells.map((c) => textFromNode(c).trim().toLowerCase());

  const subjectCol = colNames.findIndex((n) => n === "subject");
  const descriptionCol = colNames.findIndex((n) => n === "description");
  let themeCol = colNames.findIndex((n) => n === "theme");
  let impactCol = colNames.findIndex((n) => n === "impact");

  if (subjectCol === -1 || descriptionCol === -1) {
    throw new Error("Required columns 'Subject' and 'Description' not found in first table header");
  }

  let mutated = false;
  if (themeCol === -1) {
    headerRow.content.push(headerCell("Theme"));
    themeCol = headerRow.content.length - 1;
    mutated = true;
  }
  if (impactCol === -1) {
    headerRow.content.push(headerCell("Impact"));
    impactCol = headerRow.content.length - 1;
    mutated = true;
  }

  if (mutated) {
    // pad data rows to match new header length
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      row.content = row.content || [];
      while (row.content.length < headerRow.content.length) {
        row.content.push({ type: "tableCell", content: [{ type: "paragraph" }] });
      }
    }
  }

  return { subjectCol, descriptionCol, themeCol, impactCol };
};

const cellText = (row, col) => {
  const cell = (row.content || [])[col];
  return textFromNode(cell).trim();
};

const setCellText = (row, col, text) => {
  const para = { type: "paragraph", content: text ? [{ type: "text", text }] : [] };
  const existing = (row.content || [])[col];
  if (!existing) {
    row.content[col] = { type: "tableCell", content: [para] };
  } else {
    row.content[col] = { type: existing.type || "tableCell", content: [para] };
  }
};

// ---------- Confluence REST helpers ----------
async function getPageADF(pageId) {
  const res = await api.asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}?body-format=atlas_doc_format`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text();
    log("ERROR", "Fetch page failed", { status: res.status, body });
    throw new Error(`Fetch page failed: ${res.status}`);
  }
  const page = await res.json();
  const raw = page?.body?.atlas_doc_format;
  const adf = raw?.value ? JSON.parse(raw.value) : raw; // v2 may wrap as { value }
  if (!adf || adf.type !== "doc") throw new Error("Unexpected ADF structure");
  return { page, adf };
}

async function putPageADF(pageId, title, versionNumber, adf) {
  const body = {
    id: pageId,
    status: "current",
    title,
    body: { representation: "atlas_doc_format", value: JSON.stringify(adf) },
    version: { number: (versionNumber || 1) + 1 },
  };
  const res = await api.asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    log("ERROR", "Update page failed", { status: res.status, text });
    throw new Error(`Update page failed: ${res.status}`);
  }
}

// ---------- Normalizers removed: use LLM-provided values as-is ----------

// ---------- Rovo Actions ----------
async function getNextRows(payload, context) {
  const pageId = payload?.context?.confluence?.contentId;
  const batchSize = Math.min(Number(payload?.batchSize) || 20, 20);
  if (!pageId) {
    log("ERROR", "Invocation missing contentId", { payload });
    throw new Error("No contentId in payload context");
  }
  log("INFO", "getNextRows invoked", { pageId, batchSize });

  const { page, adf } = await getPageADF(pageId);

  // Find first table containing Subject & Description headers
  const tables = findNodes(adf, (n) => n.type === "table");
  if (!tables.length) throw new Error("No table found on page");

  let selected; let header;
  for (const t of tables) {
    try {
      const cols = ensureHeaderCols(t.node);
      const names = (t.node.content?.[0]?.content || []).map((c) => textFromNode(c).trim().toLowerCase());
      if (names.includes("subject") && names.includes("description")) {
        selected = t; header = cols; break;
      }
    } catch (e) { /* continue searching */ }
  }
  if (!selected || !header) throw new Error("No feedback table with 'Subject' and 'Description' found");

  const table = selected.node;
  const rows = (table.content || []).slice(1); // exclude header
  const unlabeled = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const hasTheme = !!cellText(r, header.themeCol);
    const hasImpact = !!cellText(r, header.impactCol);
    if (!hasTheme || !hasImpact) {
      unlabeled.push({ rowIndex: i, subject: cellText(r, header.subjectCol), description: cellText(r, header.descriptionCol) });
      if (unlabeled.length >= batchSize) break;
    }
  }

  // If headers were added in ensureHeaderCols, persist them immediately (non-fatal if this fails)
  try {
    const hdr = table.content?.[0];
    const themeLabel = textFromNode(hdr?.content?.[header.themeCol]).trim();
    const impactLabel = textFromNode(hdr?.content?.[header.impactCol]).trim();
    if (themeLabel !== "Theme" || impactLabel !== "Impact") {
      setAtPath(adf, selected.path, table);
      await putPageADF(page.id, page.title, page.version?.number || 1, adf);
    }
  } catch (e) {
    log("WARN", "Header ensure/update failed (non-fatal)", { error: String(e) });
  }

  log("INFO", "getNextRows complete", { pageId, count: unlabeled.length });
  return { pageId, tablePath: selected.path, header, rows: unlabeled, totalRows: rows.length, batchSize };
}

async function applyLabels(payload, context) {
  const pageId = payload?.context?.confluence?.contentId;
  if (!pageId) throw new Error("No contentId in payload context");

  let items = [];
  try {
    items = JSON.parse(payload?.labels);
    if (!Array.isArray(items)) throw new Error("labels must be a JSON array");
  } catch (e) {
    log("ERROR", "labels parse fail", { error: String(e), sample: payload?.labels?.slice?.(0, 200) });
    throw new Error("Invalid labels payload; expected JSON array string");
  }

  log("INFO", "applyLabels invoked", { pageId, count: items.length });
  const { page, adf } = await getPageADF(pageId);

  const tables = findNodes(adf, (n) => n.type === "table");
  if (!tables.length) throw new Error("No table found on page");

  let selected; let header;
  for (const t of tables) {
    try {
      const cols = ensureHeaderCols(t.node);
      const names = (t.node.content?.[0]?.content || []).map((c) => textFromNode(c).trim().toLowerCase());
      if (names.includes("subject") && names.includes("description")) { selected = t; header = cols; break; }
    } catch (e) { /* continue */ }
  }
  if (!selected || !header) throw new Error("No feedback table located during update");

  const table = selected.node;
  const dataRows = (table.content || []).slice(1);
  let updated = 0;

  for (const item of items) {
    const idx = item.rowIndex;
    if (typeof idx !== "number" || idx < 0 || idx >= dataRows.length) continue;

    const row = dataRows[idx];
    const theme = item.theme;
    const impact = item.impact;

    if (!cellText(row, header.themeCol)) { setCellText(row, header.themeCol, theme); updated++; }
    if (!cellText(row, header.impactCol)) { setCellText(row, header.impactCol, impact); updated++; }
  }

  setAtPath(adf, selected.path, table);
  await putPageADF(page.id, page.title, page.version?.number || 1, adf);
  log("INFO", "applyLabels complete", { pageId, updated });
  return { updated };
}

// Confluence byline dynamic props (shows quick status/action hint)
async function bylineDynamic(payload, context) {
  try {
    const pageId = payload?.extension?.content?.id;
    if (!pageId) return { title: "Label next 20 rows", tooltip: "Invoke the Feedback Labeller agent from Rovo chat" };
    const result = await getNextRows({ context: { confluence: { contentId: pageId } }, batchSize: 1 }, {});
    const remaining = result?.rows?.length || 0;
    return remaining
      ? { title: `Label next ${Math.min(20, result.totalRows)} rows`, tooltip: "Open Rovo and run: 'Label the next 20 feedback rows on this page'" }
      : { title: "All rows labeled", tooltip: "No unlabeled rows detected" };
  } catch (e) {
    log("WARN", "bylineDynamic failed", { error: String(e) });
    return { title: "Label next 20 rows", tooltip: "Start the Feedback Labeller agent from Rovo chat" };
  }
}

exports.getNextRows = getNextRows;
exports.applyLabels = applyLabels;
exports.bylineDynamic = bylineDynamic;
