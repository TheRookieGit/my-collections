import Anthropic from "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.128.0/+esm";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm";

// Supabase 公开配置（publishable key 本来就是公开的；表对外关闭，只能凭同步密码通过函数读写，见 supabase/schema.sql）
const SUPABASE_URL = "https://lxicymhrzkuiqisuiotg.supabase.co";
const SUPABASE_KEY = "sb_publishable_KsJzV--VCz5k8WYQ-aqMLQ_rMgf-w9y";
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

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
let cfg = lsGet(LS_CFG, { apiKey: "", syncPass: "" });
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
    ${extras}${link}${note}${i.shots?.length ? `<div class="meta"><button data-act="shots" class="link-btn">🖼 原截图${i.shots.length > 1 ? ` ×${i.shots.length}` : ""}</button></div>` : ""}
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
  if (act === "shots") openShots(item);
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

// ---------- 截图 / 小红书笔记识别（Claude Haiku 5.5） ----------
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

const EXTRACT_PROMPT = `这是我想收藏的东西（截图，或一篇笔记的文字和配图）。请识别其中值得收藏的条目（可能有多个），并归入以下分类之一：
${Object.entries(CATS).map(([k, c]) => `- ${k}: ${c.name}（可填字段：${c.fields.map((f) => `${f.key}=${f.label}`).join("，")}）`).join("\n")}

规则：
- title 用条目本身的名字（书名、片名、店名、商品名、地名、工具名等），保持原语言。
- 只填能看到或能明确推断的信息，其它字段填空字符串 ""。
- coupon 的 expiry 用 YYYY-MM-DD 格式；download 填下载/网盘/磁力链接。
- note 用一两句中文简述关键信息（如优惠内容、推荐理由、地址、营业时间、提取码），配图里的文字也要看。
- 笔记标题往往只是噱头（如"这片太绝了"），title 要用正文/配图里真正的名字。
- 识别不出任何条目时返回空数组。`;

let shotResults = [];
let pendingShots = []; // 本次识别的原截图，点「保存选中」后才落盘

async function imageToBase64(file, maxSide = 1568, quality = 0.88) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  return { dataUrl, data: dataUrl.split(",")[1] };
}

// ---------- 原截图存储 ----------
// 本机存 IndexedDB（localStorage 放不下图片）；开了云同步再上传到 mc_images，其它设备点开时按需下载
const shotDb = (() => {
  let dbp;
  const open = () => (dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open("mc-shots", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("images", { keyPath: "id" });
      req.result.createObjectStore("pending", { keyPath: "id" }); // 待上传的图片 id
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const run = async (store, mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = () => reject(t.error);
    });
  };
  return {
    get: (id) => run("images", "readonly", (s) => s.get(id)),
    put: (rec) => run("images", "readwrite", (s) => s.put(rec)),
    pending: () => run("pending", "readonly", (s) => s.getAllKeys()),
    addPending: (id) => run("pending", "readwrite", (s) => s.put({ id })),
    donePending: (id) => run("pending", "readwrite", (s) => s.delete(id)),
  };
})();

// 存档用的原图：比识别用的再压一点，一张手机截图大约 100–200KB
const ARCHIVE_SIDE = 1600, ARCHIVE_QUALITY = 0.72;

async function storeShots(shots) {
  for (const s of shots) {
    await shotDb.put(s);
    await shotDb.addPending(s.id);
  }
}

async function uploadPendingShots() {
  for (const id of await shotDb.pending()) {
    const rec = await shotDb.get(id);
    if (rec) {
      const { error } = await sb.rpc("mc_put_image", { p_pass: cfg.syncPass, p_id: id, p_data: rec.data });
      if (error) throw error;
    }
    await shotDb.donePending(id);
  }
}

async function loadShot(id) {
  const local = await shotDb.get(id).catch(() => null);
  if (local) return local.data;
  if (!cfg.syncPass) return null;
  const { data, error } = await sb.rpc("mc_get_image", { p_pass: cfg.syncPass, p_id: id });
  if (error) throw error;
  if (data) shotDb.put({ id, data }).catch(() => {});
  return data;
}

async function openShots(item) {
  const box = $("#imgView");
  box.innerHTML = `<div class="muted">加载中…</div>`;
  $("#dlgImg").showModal();
  const html = await Promise.all(item.shots.map(async (id) => {
    try {
      const src = await loadShot(id);
      return src ? `<img src="${src}" alt="原截图">` : `<div class="muted small">这张图还没上传到云端（在原设备上打开网站同步一下）</div>`;
    } catch (err) {
      return `<div class="muted small">加载失败：${esc(err.message || err)}</div>`;
    }
  }));
  box.innerHTML = html.join("");
}

const MAX_NOTE_IMAGES = 9;

// 小红书图片有防盗链：带外站 Referer 会 403，不带则允许跨域读取
async function fetchImage(url) {
  const res = await fetch(url, { referrerPolicy: "no-referrer" });
  if (!res.ok) throw new Error(`图片下载失败 ${res.status}`);
  return res.blob();
}

// files：本地截图；imageUrls：笔记配图；text：笔记文字；link：识别结果没给链接时用它
async function ensureApiKey() {
  if (!cfg.apiKey && cfg.syncPass) await sync();
  if (cfg.apiKey) return true;
  toast(cfg.syncPass ? "云端还没有 API Key，请在设置里填写" : "在设置里填同步密码即可自动获取 API Key（或直接填 API Key）");
  openSettings();
  return false;
}

async function recognize({ files = [], imageUrls = [], text = "", link = "" }) {
  if (!files.length && !imageUrls.length && !text) return;
  if (!(await ensureApiKey())) return;
  const dlg = $("#dlgShot");
  shotResults = [];
  pendingShots = [];
  $("#shotResults").innerHTML = "";
  $("#btnShotSave").disabled = true;
  $("#shotState").textContent = imageUrls.length ? `正在下载 ${imageUrls.length} 张配图…` : "正在用 Claude Haiku 5.5 识别…";
  $("#shotPreview").innerHTML = "";
  if (!dlg.open) dlg.showModal();

  try {
    // 单张配图下载失败（如链接过期）不影响其它内容
    const remote = await Promise.all(imageUrls.map((u) => fetchImage(u).catch((e) => (console.warn(u, e), null))));
    const images = await Promise.all([...files, ...remote.filter(Boolean)].map((f) => imageToBase64(f)));
    // 用户上传的截图另存一份压缩版，保存收藏时一起存下来
    const shots = await Promise.all(files.map(async (f) => ({ id: uid(), data: (await imageToBase64(f, ARCHIVE_SIDE, ARCHIVE_QUALITY)).dataUrl })));
    $("#shotPreview").innerHTML = images.map((im) => `<img src="${im.dataUrl}" alt="图片">`).join("");
    $("#shotState").textContent = "正在用 Claude Haiku 5.5 识别…";

    const client = new Anthropic({ apiKey: cfg.apiKey, dangerouslyAllowBrowser: true });
    const response = await client.messages.create({
      model: "claude-haiku-5-5",
      max_tokens: 16000,
      output_config: { effort: "low", format: { type: "json_schema", schema: EXTRACT_SCHEMA } },
      messages: [{
        role: "user",
        content: [
          ...images.map((im) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: im.data } })),
          ...(text ? [{ type: "text", text: `<note>\n${text}\n</note>` }] : []),
          { type: "text", text: EXTRACT_PROMPT },
        ],
      }],
    });

    if (response.stop_reason === "refusal") throw new Error("模型拒绝了这次请求" + (response.stop_details?.explanation ? "：" + response.stop_details.explanation : ""));
    if (response.stop_reason === "max_tokens") throw new Error("输出被截断，请减少截图数量再试");
    const out = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const parsed = JSON.parse(out);

    const ts = now();
    shotResults = (parsed.items || []).filter((r) => r.title?.trim()).map((r) => ({
      id: uid(),
      category: CATS[r.category] ? r.category : "novel",
      title: r.title.trim(),
      note: r.note || "",
      link: r.link || link,
      rating: 3,
      createdAt: ts,
      done: false,
      doneAt: null,
      extra: Object.fromEntries(EXTRA_KEYS.filter((k) => r[k]).map((k) => [k, r[k]])),
      ...(shots.length ? { shots: shots.map((s) => s.id) } : {}),
      _checked: true,
    }));
    pendingShots = shots;
    $("#shotState").textContent = shotResults.length ? `识别到 ${shotResults.length} 条，确认/修改后保存：` : "没有识别到可收藏的条目，可以手动添加。";
    renderShotResults();
  } catch (err) {
    console.error(err);
    const msg = err?.status === 401 ? "API Key 无效" : err?.message || String(err);
    $("#shotState").textContent = "识别失败：" + msg;
  }
}

// 解析快捷指令传来的内容：小红书分享文字 + 从笔记网页里匹配出的 "title/desc" 和 "url" 片段
const XHS_LINK = /https?:\/\/(?:xhslink\.(?:cn|com)|(?:www\.)?xiaohongshu\.com)\/[^\s"，。]+/;
const JSON_STR = String.raw`"(?:[^"\\]|\\.)*"`;
const jsonStr = (q) => { try { return JSON.parse(q); } catch { return ""; } };

function parseShare(raw) {
  const link = raw.match(XHS_LINK)?.[0] || "";
  const noteM = raw.match(new RegExp(`"title":(${JSON_STR}),"desc":(${JSON_STR})`));

  // 同一张图有多种版本，按文件 id 去重；prv 是高压缩预览图，图里的字会糊，优先用 1080 / dft 版
  const rank = (u) => (/!h5_1080/.test(u) ? 3 : /_dft_/.test(u) ? 2 : /_prv_/.test(u) ? 0 : 1);
  const byId = new Map();
  for (const m of raw.matchAll(new RegExp(`"url":(${JSON_STR})`, "g"))) {
    const u = jsonStr(m[1]).replace(/^http:/, "https:");
    if (!/xhscdn\.com\//.test(u)) continue;
    const id = u.split("/").pop().split("!")[0];
    if (!byId.has(id) || rank(u) > rank(byId.get(id))) byId.set(id, u);
  }
  const imageUrls = [...byId.values()].slice(0, MAX_NOTE_IMAGES);

  // 没匹配到笔记内容时，退回到分享文字本身
  const text = noteM
    ? `标题：${jsonStr(noteM[1])}\n正文：${jsonStr(noteM[2])}`
    : raw.split(/"(?:title|url)":/)[0].trim();
  return { text, imageUrls, link };
}

function handleShareHash() {
  const m = location.hash.match(/^#add=([\s\S]*)$/);
  if (!m) return;
  history.replaceState(null, "", location.pathname + location.search);
  let raw;
  try { raw = decodeURIComponent(m[1]); } catch { raw = m[1]; }
  if (raw.trim()) recognize(parseShare(raw));
}
window.addEventListener("hashchange", handleShareHash);

// 网页跨域读不到小红书，由 Supabase 云函数 xhs-note 代读笔记正文和配图地址
async function recognizeXhs(shareText) {
  if (!(await ensureApiKey())) return;
  let raw = "";
  if (cfg.syncPass) {
    $("#shotResults").innerHTML = "";
    $("#shotPreview").innerHTML = "";
    $("#btnShotSave").disabled = true;
    $("#shotState").textContent = "正在读取小红书笔记…";
    if (!$("#dlgShot").open) $("#dlgShot").showModal();
    const link = shareText.match(XHS_LINK)?.[0];
    const { data, error } = await sb.functions.invoke("xhs-note", { body: { url: link, pass: cfg.syncPass } });
    if (error || data?.error || !data?.found) {
      console.warn("xhs-note", error || data);
      const status = error?.context?.status;
      const why = status === 404 ? "云函数 xhs-note 还没部署"
        : status === 401 ? (await error.context.json().catch(() => ({}))).error || "云函数拒绝访问（检查是否关闭了 Verify JWT）"
        : data?.error || (data && !data.found ? "小红书没返回正文（可能要求登录）" : error?.message || "未知错误");
      toast(`没读到笔记正文（${why}），只按分享文字识别`);
    } else raw = data.raw;
  }
  recognize(parseShare(raw ? `${shareText}\n${raw}` : shareText));
}

// ---------- 剪贴板里的小红书链接 ----------
// 电脑 Chrome 授权后可在回到页面时自动读取；iOS Safari 只允许点击后读取，所以读不到时显示一个按钮
const LS_SEEN = "mc.xhsSeen.v1";
let clipBusy = false;

function offerXhs(text) {
  const link = text.match(XHS_LINK)?.[0];
  if (!link) return false;
  const seen = lsGet(LS_SEEN, []);
  if (seen.includes(link) || live().some((i) => i.link === link)) return false;
  lsSet(LS_SEEN, [link, ...seen].slice(0, 100)); // 每个链接只提示一次
  $("#clipText").textContent = text.split(link)[0].trim() || link;
  $("#dlgClip").dataset.text = text;
  $("#dlgClip").showModal();
  return true;
}

async function checkClipboard(fromTap = false) {
  if (clipBusy || !navigator.clipboard?.readText || document.querySelector("dialog[open]")) return;
  clipBusy = true;
  try {
    const text = await navigator.clipboard.readText();
    $("#btnClip").hidden = true;
    if (!offerXhs(text) && fromTap) toast("剪贴板里没有新的小红书链接");
  } catch {
    // 没有权限（如 iOS 未点击时）：显示按钮，点一下再读
    $("#btnClip").hidden = false;
  } finally {
    clipBusy = false;
  }
}

$("#btnClip").addEventListener("click", () => checkClipboard(true));
$("#btnClipGo").addEventListener("click", () => {
  $("#dlgClip").close();
  recognizeXhs($("#dlgClip").dataset.text || "");
});
window.addEventListener("focus", () => checkClipboard());
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkClipboard(); });

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
$("#btnShotSave").addEventListener("click", async () => {
  const picked = shotResults.filter((r) => r._checked && r.title.trim());
  const ts = now();
  if (picked.some((r) => r.shots) && pendingShots.length) {
    try { await storeShots(pendingShots); } catch (err) { toast("原截图保存失败：" + err.message); }
  }
  pendingShots = [];
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
  recognize({ files: [...e.target.files] });
  e.target.value = "";
});
document.addEventListener("paste", (e) => {
  if (document.querySelector("dialog[open]:not(#dlgShot)")) return;
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
  if (files.length) { e.preventDefault(); recognize({ files }); return; }
  // 在页面空白处粘贴小红书分享文字
  const text = e.clipboardData?.getData("text") || "";
  if (!e.target.closest?.("input, textarea") && XHS_LINK.test(text)) { e.preventDefault(); recognizeXhs(text); }
});

// ---------- 设置 ----------
const sform = $("#settingsForm");
function openSettings() {
  sform.apiKey.value = cfg.apiKey || "";
  sform.syncPass.value = cfg.syncPass || "";
  $("#dlgSettings").showModal();
}
function readSettingsForm() {
  const apiKey = sform.apiKey.value.trim();
  // API Key 改动后标记待上传，下次同步时推到云端，其它设备会自动拿到
  cfg = { ...cfg, apiKey, syncPass: sform.syncPass.value, apiKeyDirty: cfg.apiKeyDirty || apiKey !== cfg.apiKey };
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

// ---------- Supabase 同步 ----------
function mergeItems(a, b) {
  const map = new Map();
  for (const i of [...a, ...b]) {
    const cur = map.get(i.id);
    if (!cur || (i.updatedAt || "") > (cur.updatedAt || "")) map.set(i.id, i);
  }
  return [...map.values()];
}

async function pullAll() {
  const { data, error } = await sb.rpc("mc_pull", { p_pass: cfg.syncPass });
  if (error) throw error;
  return data || [];
}

// 跨设备共享的设置：目前只有 Anthropic API Key
async function syncConfig() {
  if (cfg.apiKeyDirty) {
    const { error } = await sb.rpc("mc_set_config", { p_pass: cfg.syncPass, p_data: { apiKey: cfg.apiKey } });
    if (error) throw error;
    cfg.apiKeyDirty = false;
    lsSet(LS_CFG, cfg);
    return;
  }
  const { data, error } = await sb.rpc("mc_get_config", { p_pass: cfg.syncPass });
  if (error) throw error;
  if (data?.apiKey && data.apiKey !== cfg.apiKey) {
    cfg.apiKey = data.apiKey;
    lsSet(LS_CFG, cfg);
    if (!$("#dlgSettings").open) sform.apiKey.value = cfg.apiKey;
  } else if (!data?.apiKey && cfg.apiKey) {
    cfg.apiKeyDirty = true;
    return syncConfig();
  }
}

let syncing = null, syncAgain = false, syncTimer;
function setSyncStatus(s) { $("#syncStatus").textContent = s; }
function scheduleSync() {
  if (!cfg.syncPass) return;
  clearTimeout(syncTimer);
  setSyncStatus("● 待同步");
  syncTimer = setTimeout(() => sync(), 1500);
}

// 返回本轮同步的 Promise；正在同步时返回进行中的那一轮
function sync(manual = false) {
  if (syncing) { syncAgain = true; return syncing; }
  syncing = doSync(manual).finally(() => {
    syncing = null;
    if (syncAgain) { syncAgain = false; sync(); }
  });
  return syncing;
}

async function doSync(manual) {
  if (!cfg.syncPass) {
    setSyncStatus("");
    if (manual) toast("请先填写同步密码");
    return;
  }
  setSyncStatus("⟳ 同步中…");
  try {
    // 云端还没建 mc_config 相关函数时（PGRST202）跳过设置同步，不影响收藏同步
    await syncConfig().catch((e) => { if (e?.code !== "PGRST202") throw e; console.warn("跳过设置同步：", e.message); });
    const remote = await pullAll();
    const remoteAt = new Map(remote.map((r) => [r.id, r.updatedAt || ""]));
    const merged = mergeItems(items, remote);
    if (JSON.stringify(merged) !== JSON.stringify(items)) {
      items = merged;
      lsSet(LS_DATA, items);
      render();
    }
    const dirty = items.filter((i) => !remoteAt.has(i.id) || (i.updatedAt || "") > remoteAt.get(i.id));
    for (let k = 0; k < dirty.length; k += 500) {
      const { error } = await sb.rpc("mc_push", { p_pass: cfg.syncPass, p_items: dirty.slice(k, k + 500) });
      if (error) throw error;
    }
    // 云端还没建 mc_put_image 时（PGRST202）先留在本机，下次再传
    await uploadPendingShots().catch((e) => { if (e?.code !== "PGRST202") throw e; console.warn("跳过原图上传：", e.message); });
    setSyncStatus("✓ 已同步 " + fmtTime(now()).slice(11));
    if (manual) toast("同步完成");
  } catch (err) {
    console.error(err);
    setSyncStatus("⚠ 同步失败");
    toast(err?.code === "28P01" ? "同步密码错误" : "同步失败：" + (err.message || err));
  }
}

document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sync(); });

render();
sync();
handleShareHash();
checkClipboard();
