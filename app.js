import Anthropic from "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.128.0/+esm";

// ---------- 分类定义 ----------
const DOWNLOAD = { key: "download", label: "下载地址", type: "url" };
const CATS = {
  novel:      { name: "小说",     icon: "📚", fields: [{ key: "author", label: "作者" }, DOWNLOAD] },
  movie:      { name: "电影",     icon: "🎬", fields: [{ key: "year", label: "年份" }, DOWNLOAD] },
  tv:         { name: "电视剧",   icon: "📺", fields: [{ key: "year", label: "年份" }, DOWNLOAD] },
  coupon:     { name: "Coupon",   icon: "🎟️", fields: [{ key: "store", label: "商家" }, { key: "code", label: "券码" }, { key: "expiry", label: "到期日", type: "date" }] },
  restaurant: { name: "餐厅",     icon: "🍜", fields: [{ key: "cuisine", label: "菜系" }, { key: "address", label: "地址" }] },
  tool:       { name: "工具",     icon: "🧰", fields: [{ key: "platform", label: "平台" }] },
  place:      { name: "想去玩",   icon: "🗺️", fields: [{ key: "location", label: "位置" }] },
  grocery:    { name: "超市购物", icon: "🛒", fields: [{ key: "store", label: "超市" }, { key: "quantity", label: "数量" }] },
};
const EXTRA_KEYS = [...new Set(Object.values(CATS).flatMap((c) => c.fields.map((f) => f.key)))];

// ---------- 存储 ----------
const LS_DATA = "mc.items.v1";
const LS_CFG = "mc.config.v1";

function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { toast("本地保存失败：" + e.message); }
}

let items = lsGet(LS_DATA, []);
let cfg = lsGet(LS_CFG, { apiKey: "", ghToken: "", ghRepo: "", ghPath: "collections.json" });
const ui = { cat: "all", status: "todo", q: "", sort: "created-desc" };

function save() {
  lsSet(LS_DATA, items);
  render();
  scheduleSync();
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const now = () => new Date().toISOString();
const live = () => items.filter((i) => !i.deleted);

function upsert(item) {
  item.updatedAt = now();
  const idx = items.findIndex((i) => i.id === item.id);
  if (idx >= 0) items[idx] = item; else items.push(item);
  save();
}

// ---------- 工具 ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isUrl = (s) => /^https?:\/\//i.test(s || "") || /^magnet:/i.test(s || "");
const fmtTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const toLocalInput = (iso) => {
  const d = iso ? new Date(iso) : new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const stars = (n) => "★".repeat(n || 0) + "☆".repeat(5 - (n || 0));

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

document.querySelectorAll("dialog [data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));

// ---------- 渲染 ----------
function renderTabs() {
  const counts = {};
  for (const i of live()) if (!i.done) counts[i.category] = (counts[i.category] || 0) + 1;
  const total = live().filter((i) => !i.done).length;
  const tabs = [["all", "全部", "✨", total], ...Object.entries(CATS).map(([k, c]) => [k, c.name, c.icon, counts[k] || 0])];
  $("#catTabs").innerHTML = tabs
    .map(([k, n, ic, c]) => `<button data-cat="${k}" class="${ui.cat === k ? "active" : ""}">${ic} ${n}<small>${c || ""}</small></button>`)
    .join("");
}

function renderList() {
  const inCat = live().filter((i) => ui.cat === "all" || i.category === ui.cat);
  $("#cntTodo").textContent = inCat.filter((i) => !i.done).length;
  $("#cntDone").textContent = inCat.filter((i) => i.done).length;

  const q = ui.q.trim().toLowerCase();
  let list = inCat.filter((i) => (ui.status === "done" ? i.done : !i.done));
  if (q) list = list.filter((i) => [i.title, i.note, ...Object.values(i.extra || {})].join(" ").toLowerCase().includes(q));

  const [field, dir] = ui.sort.split("-");
  const key = field === "rating" ? (i) => i.rating || 0 : (i) => (ui.status === "done" && field === "created" ? i.doneAt : i.createdAt) || "";
  list.sort((a, b) => {
    const r = key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
    return (dir === "desc" ? -r : r) || (b.createdAt || "").localeCompare(a.createdAt || "");
  });

  if (!list.length) {
    $("#list").innerHTML = `<div class="empty">${ui.status === "done" ? "还没有已实现的收藏" : "这里空空的，点右下角添加一个吧～<br><span class='small'>也可以直接 Ctrl+V 粘贴截图</span>"}</div>`;
    return;
  }
  $("#list").innerHTML = list.map(cardHtml).join("");
}

function cardHtml(i) {
  const c = CATS[i.category] || { name: i.category, icon: "📌", fields: [] };
  const extras = c.fields
    .filter((f) => i.extra?.[f.key])
    .map((f) => {
      const v = i.extra[f.key];
      const val = isUrl(v) ? `<a href="${esc(v)}" target="_blank" rel="noopener">${f.key === "download" ? "⬇️ 下载" : esc(v)}</a>` : esc(v);
      return `<div class="meta">${f.label}：${val}</div>`;
    })
    .join("");
  const link = i.link ? `<div class="meta">🔗 <a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.link)}</a></div>` : "";
  const note = i.note ? `<div class="meta">${esc(i.note)}</div>` : "";
  return `
  <article class="card ${i.done ? "done" : ""}" data-id="${i.id}">
    <div class="card-head">
      <div class="card-title">${esc(i.title)}</div>
      <span class="badge">${c.icon} ${c.name}</span>
    </div>
    <div class="stars" data-act="rate" title="点击修改等级">${[1, 2, 3, 4, 5].map((n) => `<span data-n="${n}">${n <= (i.rating || 0) ? "★" : "☆"}</span>`).join("")}</div>
    ${extras}${link}${note}
    <div class="card-foot">
      <span class="time">收藏于 ${fmtTime(i.createdAt)}${i.done ? `<br>实现于 ${fmtTime(i.doneAt)}` : ""}</span>
      <button data-act="edit" class="ghost">编辑</button>
      <button data-act="done" class="btn-done ${i.done ? "is-done" : ""}">${i.done ? "↩ 撤回" : "✓ 已实现"}</button>
    </div>
  </article>`;
}

function render() { renderTabs(); renderList(); }

// ---------- 交互 ----------
$("#catTabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-cat]");
  if (!b) return;
  ui.cat = b.dataset.cat;
  render();
});
$("#statusSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-status]");
  if (!b) return;
  ui.status = b.dataset.status;
  document.querySelectorAll("#statusSeg button").forEach((x) => x.classList.toggle("active", x === b));
  renderList();
});
$("#search").addEventListener("input", (e) => { ui.q = e.target.value; renderList(); });
$("#sort").addEventListener("change", (e) => { ui.sort = e.target.value; renderList(); });

$("#list").addEventListener("click", (e) => {
  const card = e.target.closest(".card");
  if (!card) return;
  const item = items.find((i) => i.id === card.dataset.id);
  if (!item) return;
  const star = e.target.closest("[data-n]");
  if (star) {
    const n = +star.dataset.n;
    upsert({ ...item, rating: item.rating === n ? n - 1 : n });
    return;
  }
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "edit") openEdit(item);
  if (act === "done") {
    const done = !item.done;
    upsert({ ...item, done, doneAt: done ? now() : null });
    toast(done ? "🎉 已实现！可以在「已实现」里找到它" : "已移回待实现");
  }
});

// ---------- 编辑弹窗 ----------
const form = $("#editForm");
let editing = null;
let editRating = 3;

$("#fCategory").innerHTML = Object.entries(CATS).map(([k, c]) => `<option value="${k}">${c.icon} ${c.name}</option>`).join("");

function renderExtraFields(cat, extra = {}) {
  $("#extraFields").innerHTML = (CATS[cat]?.fields || [])
    .map((f) => `<label>${f.label}<input name="x_${f.key}" type="${f.type === "date" ? "date" : "text"}" value="${esc(extra[f.key] || "")}" ${f.type === "url" ? 'placeholder="网盘 / 磁力 / 网址"' : ""}></label>`)
    .join("");
}
function renderStarInput() {
  $("#fRating").innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" data-n="${n}" class="${n <= editRating ? "on" : ""}">★</button>`).join("");
}
$("#fRating").addEventListener("click", (e) => {
  const b = e.target.closest("[data-n]");
  if (!b) return;
  editRating = editRating === +b.dataset.n ? +b.dataset.n - 1 : +b.dataset.n;
  renderStarInput();
});
$("#fCategory").addEventListener("change", (e) => {
  const cur = collectExtra();
  renderExtraFields(e.target.value, cur);
});
function collectExtra() {
  const extra = {};
  form.querySelectorAll("[name^=x_]").forEach((el) => { if (el.value.trim()) extra[el.name.slice(2)] = el.value.trim(); });
  return extra;
}

function openEdit(item) {
  editing = item || null;
  const cat = item?.category || (ui.cat !== "all" ? ui.cat : "novel");
  $("#editTitle").textContent = item ? "编辑收藏" : "添加收藏";
  form.reset();
  form.category.value = cat;
  form.title.value = item?.title || "";
  form.link.value = item?.link || "";
  form.note.value = item?.note || "";
  form.createdAt.value = toLocalInput(item?.createdAt);
  editRating = item?.rating ?? 3;
  renderStarInput();
  renderExtraFields(cat, item?.extra);
  $("#btnDelete").hidden = !item;
  $("#dlgEdit").showModal();
  form.title.focus();
}

form.addEventListener("submit", (e) => {
  if (e.submitter?.value !== "ok") return;
  const base = editing || { id: uid(), done: false, doneAt: null };
  upsert({
    ...base,
    category: form.category.value,
    title: form.title.value.trim(),
    link: form.link.value.trim(),
    note: form.note.value.trim(),
    rating: editRating,
    createdAt: form.createdAt.value ? new Date(form.createdAt.value).toISOString() : now(),
    extra: collectExtra(),
  });
  toast(editing ? "已保存" : "已收藏 ⭐");
});
$("#btnDelete").addEventListener("click", () => {
  if (!editing) return;
  // 软删除：保留墓碑，便于多设备同步
  upsert({ ...editing, deleted: true });
  $("#dlgEdit").close();
  toast("已删除");
});
$("#btnAdd").addEventListener("click", () => openEdit(null));

// ---------- 截图识别（Claude Haiku 5.5） ----------
const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string", enum: Object.keys(CATS) },
          title: { type: "string" },
          note: { type: "string" },
          link: { type: "string" },
          ...Object.fromEntries(EXTRA_KEYS.map((k) => [k, { type: "string" }])),
        },
        required: ["category", "title", "note", "link", ...EXTRA_KEYS],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

const EXTRACT_PROMPT = `这是我想收藏的东西的截图。请识别截图里值得收藏的条目（可能有多个），并归入以下分类之一：
${Object.entries(CATS).map(([k, c]) => `- ${k}: ${c.name}（可填字段：${c.fields.map((f) => `${f.key}=${f.label}`).join("，")}）`).join("\n")}

规则：
- title 用条目本身的名字（书名、片名、店名、商品名、地名、工具名等），保持原语言。
- 只填截图里能看到或能明确推断的信息，其它字段填空字符串 ""。
- coupon 的 expiry 用 YYYY-MM-DD 格式；download 填截图里的下载/网盘/磁力链接。
- note 用一句话中文简述关键信息（如优惠内容、推荐理由、提取码）。
- 识别不出任何条目时返回空数组。`;

let shotResults = [];

async function imageToBase64(file, maxSide = 1568) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
  return { dataUrl, data: dataUrl.split(",")[1] };
}

async function recognize(files) {
  if (!files.length) return;
  if (!cfg.apiKey) {
    toast("请先在设置里填写 Anthropic API Key");
    openSettings();
    return;
  }
  const dlg = $("#dlgShot");
  shotResults = [];
  $("#shotResults").innerHTML = "";
  $("#btnShotSave").disabled = true;
  $("#shotState").textContent = "正在用 Claude Haiku 5.5 识别…";
  $("#shotPreview").innerHTML = "";
  if (!dlg.open) dlg.showModal();

  try {
    const images = await Promise.all(files.map((f) => imageToBase64(f)));
    $("#shotPreview").innerHTML = images.map((im) => `<img src="${im.dataUrl}" alt="截图">`).join("");

    const client = new Anthropic({ apiKey: cfg.apiKey, dangerouslyAllowBrowser: true });
    const response = await client.messages.create({
      model: "claude-haiku-5-5",
      max_tokens: 16000,
      output_config: { effort: "low", format: { type: "json_schema", schema: EXTRACT_SCHEMA } },
      messages: [{
        role: "user",
        content: [
          ...images.map((im) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: im.data } })),
          { type: "text", text: EXTRACT_PROMPT },
        ],
      }],
    });

    if (response.stop_reason === "refusal") throw new Error("模型拒绝了这次请求" + (response.stop_details?.explanation ? "：" + response.stop_details.explanation : ""));
    if (response.stop_reason === "max_tokens") throw new Error("输出被截断，请减少截图数量再试");
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const parsed = JSON.parse(text);

    const ts = now();
    shotResults = (parsed.items || []).filter((r) => r.title?.trim()).map((r) => ({
      id: uid(),
      category: CATS[r.category] ? r.category : "novel",
      title: r.title.trim(),
      note: r.note || "",
      link: r.link || "",
      rating: 3,
      createdAt: ts,
      done: false,
      doneAt: null,
      extra: Object.fromEntries(EXTRA_KEYS.filter((k) => r[k]).map((k) => [k, r[k]])),
      _checked: true,
    }));
    $("#shotState").textContent = shotResults.length ? `识别到 ${shotResults.length} 条，确认/修改后保存：` : "没有识别到可收藏的条目，可以手动添加。";
    renderShotResults();
  } catch (err) {
    console.error(err);
    const msg = err?.status === 401 ? "API Key 无效" : err?.message || String(err);
    $("#shotState").textContent = "识别失败：" + msg;
  }
}

function renderShotResults() {
  $("#shotResults").innerHTML = shotResults.map((r, idx) => `
    <div class="shot-item" data-idx="${idx}">
      <div class="row">
        <input type="checkbox" data-k="_checked" ${r._checked ? "checked" : ""}>
        <select data-k="category" style="width:auto">${Object.entries(CATS).map(([k, c]) => `<option value="${k}" ${k === r.category ? "selected" : ""}>${c.icon} ${c.name}</option>`).join("")}</select>
        <span class="stars-input">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-rate="${n}" class="${n <= r.rating ? "on" : ""}">★</button>`).join("")}</span>
      </div>
      <input data-k="title" value="${esc(r.title)}" placeholder="标题">
      <div class="grid2">
        ${(CATS[r.category]?.fields || []).map((f) => `<input data-x="${f.key}" value="${esc(r.extra[f.key] || "")}" placeholder="${f.label}">`).join("")}
      </div>
      <input data-k="link" value="${esc(r.link)}" placeholder="链接">
      <input data-k="note" value="${esc(r.note)}" placeholder="备注">
    </div>`).join("");
  $("#btnShotSave").disabled = !shotResults.some((r) => r._checked);
}

$("#shotResults").addEventListener("input", (e) => {
  const box = e.target.closest(".shot-item");
  if (!box) return;
  const r = shotResults[+box.dataset.idx];
  const k = e.target.dataset.k, x = e.target.dataset.x;
  if (k === "_checked") r._checked = e.target.checked;
  else if (k) r[k] = e.target.value;
  else if (x) r.extra[x] = e.target.value;
  if (k === "category") renderShotResults();
  $("#btnShotSave").disabled = !shotResults.some((r) => r._checked);
});
$("#shotResults").addEventListener("click", (e) => {
  const b = e.target.closest("[data-rate]");
  if (!b) return;
  const r = shotResults[+b.closest(".shot-item").dataset.idx];
  r.rating = r.rating === +b.dataset.rate ? +b.dataset.rate - 1 : +b.dataset.rate;
  renderShotResults();
});
$("#btnShotSave").addEventListener("click", () => {
  const picked = shotResults.filter((r) => r._checked && r.title.trim());
  const ts = now();
  for (const { _checked, ...r } of picked) {
    r.extra = Object.fromEntries(Object.entries(r.extra).filter(([, v]) => v && v.trim()));
    items.push({ ...r, updatedAt: ts });
  }
  save();
  $("#dlgShot").close();
  toast(`已收藏 ${picked.length} 条 ⭐`);
});

$("#btnShot").addEventListener("click", () => $("#shotInput").click());
$("#shotInput").addEventListener("change", (e) => {
  recognize([...e.target.files]);
  e.target.value = "";
});
document.addEventListener("paste", (e) => {
  if (document.querySelector("dialog[open]:not(#dlgShot)")) return;
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
  if (files.length) { e.preventDefault(); recognize(files); }
});

// ---------- 设置 ----------
const sform = $("#settingsForm");
function openSettings() {
  sform.apiKey.value = cfg.apiKey || "";
  sform.ghToken.value = cfg.ghToken || "";
  sform.ghRepo.value = cfg.ghRepo || "";
  sform.ghPath.value = cfg.ghPath || "collections.json";
  $("#dlgSettings").showModal();
}
function readSettingsForm() {
  cfg = {
    apiKey: sform.apiKey.value.trim(),
    ghToken: sform.ghToken.value.trim(),
    ghRepo: sform.ghRepo.value.trim().replace(/^https:\/\/github\.com\//, "").replace(/\/$/, ""),
    ghPath: sform.ghPath.value.trim() || "collections.json",
  };
  lsSet(LS_CFG, cfg);
}
$("#btnSettings").addEventListener("click", openSettings);
sform.addEventListener("submit", () => { readSettingsForm(); toast("设置已保存"); sync(); });
$("#btnSyncNow").addEventListener("click", () => { readSettingsForm(); sync(true); });

$("#btnExport").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ version: 1, items }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `collections-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$("#btnImport").addEventListener("click", () => $("#importInput").click());
$("#importInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const incoming = Array.isArray(data) ? data : data.items;
    if (!Array.isArray(incoming)) throw new Error("格式不对");
    items = mergeItems(items, incoming);
    save();
    toast(`已导入 ${incoming.length} 条`);
  } catch (err) {
    toast("导入失败：" + err.message);
  }
});

// ---------- GitHub 同步 ----------
function mergeItems(a, b) {
  const map = new Map();
  for (const i of [...a, ...b]) {
    const cur = map.get(i.id);
    if (!cur || (i.updatedAt || "") > (cur.updatedAt || "")) map.set(i.id, i);
  }
  return [...map.values()];
}
const b64encode = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

function ghFetch(method, body) {
  const path = cfg.ghPath.split("/").map(encodeURIComponent).join("/");
  return fetch(`https://api.github.com/repos/${cfg.ghRepo}/contents/${path}`, {
    method,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${cfg.ghToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

let syncing = false, syncAgain = false, syncTimer;
function setSyncStatus(s) { $("#syncStatus").textContent = s; }
function scheduleSync() {
  if (!cfg.ghToken || !cfg.ghRepo) return;
  clearTimeout(syncTimer);
  setSyncStatus("● 待同步");
  syncTimer = setTimeout(() => sync(), 1500);
}

async function sync(manual = false) {
  if (!cfg.ghToken || !cfg.ghRepo) {
    setSyncStatus("");
    if (manual) toast("请先填写 GitHub Token 和仓库");
    return;
  }
  if (syncing) { syncAgain = true; return; }
  syncing = true;
  setSyncStatus("⟳ 同步中…");
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await ghFetch("GET");
      let sha, remote = [];
      if (res.ok) {
        const j = await res.json();
        sha = j.sha;
        remote = JSON.parse(b64decode(j.content || "") || "{}").items || [];
      } else if (res.status !== 404) {
        throw new Error(`读取失败 ${res.status}`);
      }
      const merged = mergeItems(items, remote);
      const changedLocal = JSON.stringify(merged) !== JSON.stringify(items);
      items = merged;
      lsSet(LS_DATA, items);
      if (changedLocal) render();

      const canon = (arr) => JSON.stringify([...arr].sort((x, y) => (x.id < y.id ? -1 : 1)));
      if (sha && canon(mergeItems([], remote)) === canon(merged)) break; // 远端已是最新

      const put = await ghFetch("PUT", {
        message: `sync ${new Date().toISOString()}`,
        content: b64encode(JSON.stringify({ version: 1, items: merged }, null, 1)),
        ...(sha ? { sha } : {}),
      });
      if (put.ok) break;
      if (put.status === 409 || put.status === 422) continue; // 有冲突，重新拉取合并
      throw new Error(`写入失败 ${put.status}`);
    }
    setSyncStatus("✓ 已同步 " + fmtTime(now()).slice(11));
    if (manual) toast("同步完成");
  } catch (err) {
    console.error(err);
    setSyncStatus("⚠ 同步失败");
    toast("GitHub 同步失败：" + err.message);
  } finally {
    syncing = false;
    if (syncAgain) { syncAgain = false; sync(); }
  }
}

document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sync(); });

render();
sync();
