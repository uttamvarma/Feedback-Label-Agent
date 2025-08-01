import api, { storage } from "@forge/api";
import crypto from "crypto";

/**************** Configuration ****************/ 
const ROW_LIMIT_MAX = 20;
const THEME_SET = new Set(["Feature Request", "Integration", "Bug", "Query", "Other"]);
const IMPACT_SET = new Set(["High", "Medium", "Low"]);

/**************** Utilities ****************/ 
const nowIso = () => new Date().toISOString();
const rid = () => crypto.randomUUID();
const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
const eqi = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();
const inci = (a, b) => norm(a).toLowerCase().includes(norm(b).toLowerCase());

/**************** Logging ****************/ 
async function logCritical(event, details, correlationId, contentId) {
  const rec = { ts: nowIso(), event, correlationId, contentId: contentId ?? null, details };
  console.error(`[${rec.ts}] [${event}] [${correlationId}]`, JSON.stringify(details).slice(0, 4000));
  try {
    await storage.set(`logs/${correlationId}/${rec.ts}`, rec);
  } catch (e) {
    console.error("LOG_WRITE_FAIL", String(e));
  }
}

/**************** Confluence REST v2 helpers (ADF) ****************/ 
async function getPageADF(contentId) {
  const res = await api.asApp().requestConfluence(
    `/wiki/api/v2/pages/${encodeURIComponent(contentId)}?body-format=atlas_doc_format&include-version=true`,
    { method: "GET", headers: { Accept: "application/json" } }
  );
  if (!res.ok) throw new Error(`FETCH_FAIL: ${res.status} ${res.statusText}`);
  const json = await res.json();
  const adf = json?.body?.atlas_doc_format?.value;
  const version = json?.version?.number;
  const title = json?.title;
  if (!adf || typeof version !== "number" || !title) throw new Error("PARSE_FAIL: Missing ADF body, version, or title");
  return { adf: typeof adf === "string" ? JSON.parse(adf) : adf, version, title };
}

async function putPageADF(contentId, title, currentVersion, adf) {
  const body = {
    id: String(contentId),
    status: "current",
    title,
    body: { representation: "atlas_doc_format", value: adf },
    version: { number: currentVersion + 1, message: "Rovo: feedback labels update" }
  };
  const res = await api.asApp().requestConfluence(`/wiki/api/v2/pages/${encodeURIComponent(contentId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`UPDATE_FAIL: ${res.status} ${res.statusText} :: ${txt?.slice(0, 500)}`);
  }
}

/**************** ADF helpers ****************/ 
function traverse(node, cb) {
  if (!node) return;
  cb(node);
  if (Array.isArray(node.content)) node.content.forEach((c) => traverse(c, cb));
}

function extractText(cell) {
  let text = "";
  traverse(cell, (n) => {
    if (n.type === "text" && n.text) text += n.text;
  });
  return norm(text);
}

function findFirstFeedbackTable(doc) {
  let result = null;
  traverse(doc, (n) => {
    if (result) return;
    if (n.type === "table" && Array.isArray(n.content) && n.content.length) {
      const headerRow = n.content[0];
      if (headerRow.type !== "tableRow") return;
      const headers = headerRow.content || [];
      let subjectIdx = -1, descriptionIdx = -1, themeIdx = null, impactIdx = null;
      headers.forEach((cell, idx) => {
        const t = extractText(cell);
        if (subjectIdx === -1 && (eqi(t, "subject") || inci(t, "subject"))) subjectIdx = idx;
        if (descriptionIdx === -1 && (eqi(t, "description") || inci(t, "description"))) descriptionIdx = idx;
        if (themeIdx === null && (eqi(t, "theme") || inci(t, "theme"))) themeIdx = idx;
        if (impactIdx === null && (eqi(t, "impact") || inci(t, "impact"))) impactIdx = idx;
      });
      if (subjectIdx !== -1 && descriptionIdx !== -1) {
        result = {
          table: n,
          meta: {
            hasTheme: themeIdx !== null,
            hasImpact: impactIdx !== null,
            subjectCol: subjectIdx,
            descriptionCol: descriptionIdx,
            themeCol: themeIdx,
            impactCol: impactIdx
          }
        };
      }
    }
  });
  return result;
}

function rowsForClassification(table, meta, limit) {
  const rows = [];
  for (let r = 1; r < table.content.length && rows.length < limit; r++) {
    const row = table.content[r];
    if (row.type !== "tableRow") continue;
    const cells = row.content;
    const subject = extractText(cells[meta.subjectCol]);
    const description = extractText(cells[meta.descriptionCol]);
    const themeTxt = meta.hasTheme ? extractText(cells[meta.themeCol]) : "";
    const impactTxt = meta.hasImpact ? extractText(cells[meta.impactCol]) : "";
    if ((subject || description) && !themeTxt && !impactTxt) {
      rows.push({ rowIndex: r - 1, subject, description });
    }
  }
  return rows;
}

function addColumnsIfMissing(table, meta) {
  const header = table.content[0];
  if (!meta.hasTheme) {
    header.content.push({ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Theme" }] }] });
    meta.themeCol = header.content.length - 1;
    table.content.slice(1).forEach((row) => row.content.push({ type: "tableCell", content: [{ type: "paragraph", content: [] }] }));
    meta.hasTheme = true;
  }
  if (!meta.hasImpact) {
    header.content.push({ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Impact" }] }] });
    meta.impactCol = header.content.length - 1;
    table.content.slice(1).forEach((row) => row.content.push({ type: "tableCell", content: [{ type: "paragraph", content: [] }] }));
    meta.hasImpact = true;
  }
  return meta;
}

function setCellText(cell, text) {
  cell.content = [{ type: "paragraph", content: [{ type: "text", text }] }];
}

function applyUpdates(table, meta, updates) {
  const byRow = new Map();
  updates.forEach((u) => {
    const th = THEME_SET.has(u.theme) ? u.theme : "Other";
    const im = IMPACT_SET.has(u.impact) ? u.impact : "Low";
    byRow.set(u.rowIndex, { th, im });
  });
  for (let r = 1; r < table.content.length; r++) {
    const up = byRow.get(r - 1);
    if (!up) continue;
    const cells = table.content[r].content;
    if (!extractText(cells[meta.themeCol])) setCellText(cells[meta.themeCol], up.th);
    if (!extractText(cells[meta.impactCol])) setCellText(cells[meta.impactCol], up.im);
  }
}

/**************** Helper: contentId from Rovo payload ****************/ 
function getContentId(payload) {
  const id = payload?.context?.confluence?.contentId;
  if (!id) throw new Error("Missing contentId in context");
  return String(id);
}

/**************** Public Actions ****************/ 
export async function extractFeedbackTable(payload) {
  const correlationId = rid();
  try {
    const contentId = getContentId(payload);
    const limit = Math.min(payload?.rowsLimit || ROW_LIMIT_MAX, ROW_LIMIT_MAX);
    const { adf } = await getPageADF(contentId);
    const found = findFirstFeedbackTable(adf);
    if (!found) return { message: "Table not found" };
    const rows = rowsForClassification(found.table, found.meta, limit);
    return { contentId, tableMeta: found.meta, rowsForClassification: rows };
  } catch (err) {
    await logCritical("extract_fail", { error: String(err) }, correlationId);
    throw err;
  }
}

export async function applyFeedbackLabels(payload) {
  const correlationId = rid();
  let envelope;
  try {
    envelope = JSON.parse(payload.updatesJson);
  } catch {
    throw new Error("updatesJson must be valid JSON");
  }

  const contentId = envelope.contentId || getContentId(payload);
  try {
    const { adf, version, title } = await getPageADF(contentId);
    const found = findFirstFeedbackTable(adf);
    if (!found) throw new Error("Table not found");
    const metaWithCols = addColumnsIfMissing(found.table, found.meta);
    const updates = envelope.updates
      .filter(u => Number.isInteger(u.rowIndex))
      .slice(0, ROW_LIMIT_MAX)
      .map(u => ({
        ...u,
        theme: THEME_SET.has(u.theme) ? u.theme : "Other",
        impact: IMPACT_SET.has(u.impact) ? u.impact : "Low"
      }));
    applyUpdates(found.table, metaWithCols, updates);
    await putPageADF(contentId, title, version, adf);
    return { message: `Updated ${updates.length} row(s)`, correlationId, contentId };
  } catch (err) {
    await logCritical("update_fail", { error: String(err) }, correlationId, contentId);
    throw err;
  }
}