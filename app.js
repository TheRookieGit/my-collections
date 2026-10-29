import Anthropic from "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.128.0/+esm";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm";

// Supabase 公开配置（publishable key 本来就是公开的；表对外关闭，只能凭同步密码通过函数读写，见 supabase/README.md）
const SUPABASE_URL = "https://lxicymhrzkuiqisuiotg.supabase.co";
const SUPABASE_KEY = "sb_publishable_KsJzV--VCz5k8WYQ-aqMLQ_rMgf-w9y";
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// ---------- 分类定义 ----------
// fulfiller：哪个应用会自动回报「已拥有」；links：可以记下载链接，送到那个应用去下载
// hue：分类的颜色；en：封面上的英文名；icon：线条图标（24×24 的 SVG 路径）
const CATS = {
  novel:      { name: "小说",     en: "Novel",      hue: "#8A4B2F", icon: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z"/><path d="M7 8h1.5M15.5 8H17"/>', fields: [{ key: "author", label: "作者" }], fulfiller: "shuyu", links: true },
  movie:      { name: "电影",     en: "Cinema",     hue: "#B8392F", icon: '<rect x="3" y="7" width="18" height="13" rx="1.5"/><path d="m3 7 3.5-3.5L9 6l2.5-2.5L14 6l2.5-2.5L20 7"/><path d="M3 11h18"/>', fields: [{ key: "year", label: "年份" }], fulfiller: "plexus", links: true },
  tv:         { name: "电视剧",   en: "Series",     hue: "#3557A8", icon: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="m9 2 3 4 3-4M8 21h8"/>', fields: [{ key: "year", label: "年份" }], fulfiller: "plexus", links: true },
  game:       { name: "游戏",     en: "Games",      hue: "#6A44D4", icon: '<path d="M7 8h10a4 4 0 0 1 3.9 4.9l-1 4.3a2.3 2.3 0 0 1-4 .8L14 16h-4l-1.9 2a2.3 2.3 0 0 1-4-.8l-1-4.3A4 4 0 0 1 7 8z"/><path d="M8 11v3M6.5 12.5h3M15.5 12h.01M17.5 13.5h.01"/>', fields: [{ key: "release", label: "发售" }], fulfiller: "steamless", links: true },
  coupon:     { name: "Coupon",   en: "Coupon",     hue: "#C08A1E", icon: '<path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z"/><path d="M14 6v12" stroke-dasharray="1.5 2"/>', fields: [{ key: "store", label: "商家" }, { key: "code", label: "券码" }, { key: "expiry", label: "到期日", type: "date" }] },
  restaurant: { name: "餐厅",     en: "Dining",     hue: "#C0502E", icon: '<path d="M6 3v7a2 2 0 0 0 4 0V3M8 3v18"/><path d="M17 21V3c-2 1.5-3 4-3 7s1 4 3 4"/>', fields: [{ key: "cuisine", label: "菜系" }, { key: "address", label: "地址" }] },
  tool:       { name: "工具",     en: "Toolkit",    hue: "#3E5566", icon: '<path d="M14.5 6.5a4 4 0 0 1 5-5l-2.5 2.5.5 2.5 2.5.5 2.5-2.5a4 4 0 0 1-5 5L8 20a2.1 2.1 0 0 1-3-3z"/>', fields: [{ key: "platform", label: "平台" }] },
  place:      { name: "想去玩",   en: "Journeys",   hue: "#1F8A80", icon: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>', fields: [{ key: "location", label: "位置" }] },
  grocery:    { name: "超市购物", en: "Pantry",     hue: "#5E8A2E", icon: '<path d="M5 8h14l-1.2 11.1a2 2 0 0 1-2 1.9H8.2a2 2 0 0 1-2-1.9z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>', fields: [{ key: "store", label: "超市" }, { key: "quantity", label: "数量" }] },
};
const ALL_ICON = '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>';
const svgIcon = (paths, cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const EXTRA_KEYS = [...new Set(Object.values(CATS).flatMap((c) => c.fields.map((f) => f.key)))];
// 小说的类型，和书屿想看清单的一样：按书名、文件夹名还是压缩包名去匹配
const KINDS = { novel: "小说文件", folder: "文件夹", zip: "ZIP 压缩包" };
// 送去下载：网盘链接放在 #links= 里，书屿 Lite 和 Plexus 的下载页会预先填好
const APPS = {
  shuyu:     { name: "书屿",      send: "https://therookiegit.github.io/shuyu/lite/" },
  plexus:    { name: "Plexus",    send: "https://therookiegit.github.io/plexus/downloads.html" },
  // Steamless 是电脑上的桌面应用：链接交给本机的 Steamless（它没开着的话打不开）
  steamless: { name: "Steamless", send: "http://localhost:5174/" },
};
// 默认隐藏「已实现」按钮的分类：小说下载到书屿就算数了
const HIDE_DONE = { novel: true };

// 条目的新字段：aliases 别名、externalIds（steamAppId / plexGuid / tmdb）、links 下载链接、kind、source（screenshot / xhs / manual / steamless）。
// 旧数据在读进来时补齐，不改 updatedAt：别的设备上的旧版页面照样能读写，云端的条目下次编辑时才换成新格式。
function normalize(i) {
  if (!i || typeof i !== "object") return i;
  const out = { ...i };
  const links = Array.isArray(out.links) ? out.links.filter(Boolean) : [];
  if (out.extra?.download) {
    const { download, ...rest } = out.extra;
    out.extra = rest;
    if (!links.includes(download)) links.unshift(download);
  }
  out.links = links;
  if (!Array.isArray(out.aliases)) out.aliases = [];
  if (!out.externalIds || typeof out.externalIds !== "object") out.externalIds = {};
  return out;
}
// Steamless 同步过来的游戏在这里也能改：名字、备注会改回 Steamless，评分、别名等留在这里。
// 它们的「已拥有」就是 Steamless 里的这款游戏本身，不会匹配错，所以没有「不是这个」
const fromSteamless = (i) => i.source === "steamless";

// ---------- 存储 ----------
const LS_DATA = "mc.items.v1";
const LS_CFG = "mc.config.v1";
const LS_FULFILL = "mc.fulfill.v1";

function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { toast("本地保存失败：" + e.message); }
}

let items = lsGet(LS_DATA, []).map(normalize);
let cfg = lsGet(LS_CFG, { apiKey: "", syncPass: "" });
// 各应用回报的「已拥有」（mc_fulfill），和收藏分开存：收藏按 updatedAt 整条覆盖，写在一起会互相冲掉
let fulfill = lsGet(LS_FULFILL, []);
const ui = { cat: "all", status: "todo", q: "", sort: "created-desc" };

const doneHidden = (cat) => !!(cfg.hideDone ?? HIDE_DONE)[cat];
const ownedRows = (i) => fulfill.filter((f) => f.itemId === i.id && f.ownedAt && !f.rejected);
// 三档：想要 → 已拥有（应用自动回报）→ 已实现（手动点）
const stateOf = (i) => (i.done ? "done" : ownedRows(i).length ? "owned" : "todo");

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
const $$ = (s) => [...document.querySelectorAll(s)];
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
// 点弹窗外面也能关掉（叠着的只关最上面那个）；在里面按下、拖到外面松开（比如选文字）不算。
// 编辑和截图识别结果里有没保存的内容，只能点按钮关
const outsideOf = (d, e) => {
  const r = d.getBoundingClientRect();
  return e.target === d && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom);
};
document.querySelectorAll("dialog:not(#dlgEdit):not(#dlgShot)").forEach((d) => {
  let downOutside = false;
  d.addEventListener("pointerdown", (e) => { downOutside = outsideOf(d, e); });
  d.addEventListener("click", (e) => {
    if (downOutside && outsideOf(d, e)) d.close();
    downOutside = false;
  });
});

// ---------- 渲染 ----------
function renderTabs() {
  const counts = {};
  const wanted = live().filter((i) => stateOf(i) === "todo");
  for (const i of wanted) counts[i.category] = (counts[i.category] || 0) + 1;
  const total = wanted.length;
  const owned = live().filter((i) => stateOf(i) === "owned").length;
  $("#summary").textContent = `${total} 个心愿${owned ? ` · ${owned} 个已拥有` : ""}`;
  const tabs = [["all", "全部", "All", "", ALL_ICON, total], ...Object.entries(CATS).map(([k, c]) => [k, c.name, c.en, c.hue, c.icon, counts[k] || 0])];
  $("#catTabs").innerHTML = tabs
    .map(([k, n, en, hue, icon, c]) => `<button data-cat="${k}" class="tile ${ui.cat === k ? "active" : ""} ${c ? "" : "zero"}"${hue ? ` style="--c:${hue}"` : ""}>
      <span class="tile-icon">${svgIcon(icon)}</span>
      <span class="tile-text"><span class="tile-name">${n}</span><span class="tile-en">${en}</span></span>
      <small>${c}</small></button>`)
    .join("");
}

function renderList() {
  const inCat = live().filter((i) => ui.cat === "all" || i.category === ui.cat);
  for (const s of ["todo", "owned", "done"]) $(`#cnt-${s}`).textContent = inCat.filter((i) => stateOf(i) === s).length;
  $("#cnt-all").textContent = inCat.length;

  const q = ui.q.trim().toLowerCase();
  let list = ui.status === "all" ? inCat : inCat.filter((i) => stateOf(i) === ui.status);
  if (q) list = list.filter((i) => [i.title, i.note, ...i.aliases, ...Object.values(i.extra || {})].join(" ").toLowerCase().includes(q));

  const [field, dir] = ui.sort.split("-");
  const key = field === "rating" ? (i) => i.rating || 0 : (i) => (ui.status === "done" && field === "created" ? i.doneAt : i.createdAt) || "";
  list.sort((a, b) => {
    const r = key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
    return (dir === "desc" ? -r : r) || (b.createdAt || "").localeCompare(a.createdAt || "");
  });

  if (!list.length) {
    const [head, sub] = ui.status === "all" ? ["这里还空着", "点下面的「添加」，或者直接 Ctrl+V 粘贴一张截图"]
      : ui.status === "done" ? ["还没有已实现的心愿", "实现了的心愿会收在这里"]
      : ui.status === "owned" ? ["还没有已拥有的", "书屿、Plexus、Steamless 配对后，下载到的会自动出现在这里"]
      : ["这里还空着", "点下面的「添加」，或者直接 Ctrl+V 粘贴一张截图"];
    $("#list").innerHTML = `<div class="empty"><p class="empty-head">${head}</p><p>${sub}</p></div>`;
    return;
  }
  $("#list").innerHTML = list.map(cardHtml).join("");
}

// 封面上标题下面那行：每个分类最想一眼看到的
function coverSub(i) {
  const x = i.extra || {};
  switch (i.category) {
    case "novel": return x.author ? `${x.author} 著` : "";
    case "movie": case "tv": return i.aliases[0] || "";
    case "game": return x.release || i.aliases[0] || "";
    case "coupon": return [x.store, x.expiry && `有效期至 ${x.expiry}`].filter(Boolean).join(" · ");
    case "restaurant": return [x.cuisine, x.address].filter(Boolean).join(" · ");
    case "tool": return x.platform || "";
    case "place": return x.location || "";
    case "grocery": return [x.store, x.quantity].filter(Boolean).join(" · ");
    default: return "";
  }
}

// 封面图：Steam 游戏用商店横幅，其余用分类自己的纹样。截图不当封面：截下来的多半是整屏，不是海报
const steamHeader = (i) => i.externalIds?.steamAppId ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${Number(i.externalIds.steamAppId)}/header.jpg` : "";

const SOURCES = { screenshot: "截图识别", xhs: "小红书", manual: "手动添加", steamless: "Steamless" };

// 卡片和详情共用的几块：封面、字段、已拥有、送去下载
function parts(i) {
  const c = CATS[i.category] || { name: i.category, en: "", hue: "#888", icon: ALL_ICON, fields: [] };
  const ext = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${text}</a>`;
  const row = (k, v) => `<div class="meta"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  const extras = c.fields
    .filter((f) => i.extra?.[f.key])
    .map((f) => row(f.label, isUrl(i.extra[f.key]) ? ext(i.extra[f.key], esc(hostOf(i.extra[f.key]))) : esc(i.extra[f.key])))
    .join("");
  const kind = i.category === "novel" && KINDS[i.kind] && i.kind !== "novel" ? row("类型", KINDS[i.kind]) : "";
  const aliases = i.aliases.length ? row("别名", i.aliases.map(esc).join("、")) : "";
  const downloads = i.links.length ? row("下载", i.links.map((l, n) => (isUrl(l) ? ext(l, `${esc(hostOf(l))}${i.links.length > 1 ? ` ${n + 1}` : ""}`) : esc(l))).join("　")) : "";
  const link = i.link ? row("链接", ext(i.link, esc(hostOf(i.link)))) : "";
  const owned = ownedRows(i).map((f) => `
    <div class="owned"><span class="owned-text">已拥有 · ${esc(APPS[f.app]?.name || f.app)}${f.title ? `：${esc(f.title)}` : ""} · ${fmtTime(f.ownedAt).slice(0, 10)}</span>
      ${isUrl(f.url) ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">查看</a>` : ""}
      ${fromSteamless(i) ? "" : `<button data-act="reject" data-app="${esc(f.app)}" class="link-btn" title="匹配错了：${esc(APPS[f.app]?.name || f.app)}以后不再把它算作这条心愿">不是这个</button>`}</div>`).join("");
  const app = APPS[c.fulfiller];
  const send = app?.send && i.links.length && !i.done && !owned
    ? `<a class="send" href="${app.send}#links=${encodeURIComponent(i.links.join("\n"))}" target="_blank" rel="noopener">送到${app.name}下载 →</a>` : "";
  const sub = coverSub(i);
  const steam = steamHeader(i);
  const year = (i.category === "movie" || i.category === "tv") && /^\d{4}$/.test(i.extra?.year || "") ? `<span class="cv-year">${i.extra.year}</span>` : "";
  const code = i.category === "coupon" && i.extra?.code ? `<span class="cv-code">${esc(i.extra.code)}</span>` : "";
  // 已拥有、已实现的在封面上盖个章，一眼看得出是哪一类。章放在封面外面，已实现的封面褪色时章不跟着褪
  const state = stateOf(i);
  const by = state === "owned" ? ownedRows(i).map((f) => APPS[f.app]?.name || f.app)[0] : "";
  const stamp = state === "owned" ? `<span class="cv-stamp"><b>已拥有</b>${by ? `<small>${esc(by)}</small>` : ""}</span>`
    : state === "done" ? `<span class="cv-stamp"><b>已实现</b><small>${fmtTime(i.doneAt).slice(5, 10)}</small></span>` : "";
  const cover = `
    <div class="cover cv-${esc(i.category)}${steam ? " has-img" : ""}">
      ${steam ? `<img class="cv-img" src="${steam}" alt="" loading="lazy" onerror="this.parentNode.classList.remove('has-img');this.remove()">` : ""}
      ${svgIcon(c.icon, "cv-mark")}${year}${code}
      <div class="cv-top">
        <span class="cv-cat">${svgIcon(c.icon)}${c.name}</span>
        <div class="stars" data-act="rate" title="点击修改等级">${[1, 2, 3, 4, 5].map((n) => `<span class="${n <= (i.rating || 0) ? "on" : ""}" data-n="${n}">★</span>`).join("")}</div>
      </div>
      <div class="cv-text">
        <h3 class="card-title">${esc(i.title)}</h3>
        ${sub ? `<p class="cv-sub">${esc(sub)}</p>` : ""}
      </div>
    </div>`;
  const doneBtn = doneHidden(i.category) && !i.done ? "" : `<button data-act="done" class="btn-done ${i.done ? "is-done" : ""}">${i.done ? "撤回" : "已实现"}</button>`;
  return { c, cover: cover + stamp, metas: extras + kind + aliases + downloads + link, owned, send, doneBtn };
}

// 卡片只放要点：备注最多三行，点卡片打开详情看全部
function cardHtml(i) {
  const { c, cover, metas, owned, send, doneBtn } = parts(i);
  return `
  <article class="card st-${stateOf(i)}" data-id="${i.id}" data-cat="${esc(i.category)}" style="--c:${c.hue}" title="点击查看详情">
    ${cover}
    <div class="card-body">
      ${i.note ? `<p class="note">${esc(i.note)}</p>` : ""}${metas ? `<div class="metas">${metas}</div>` : ""}
      ${owned}${send}
      <div class="card-foot">
        <span class="time">${i.done ? `实现于 ${fmtTime(i.doneAt).slice(0, 10)}` : `收藏于 ${fmtTime(i.createdAt).slice(0, 10)}`}</span>
        <button data-act="edit" class="text-btn">编辑</button>
        ${doneBtn}
      </div>
    </div>
  </article>`;
}

// 详情：大封面、完整的备注和字段、原截图、时间和来源
function detailHtml(i) {
  const { c, cover, metas, owned, send, doneBtn } = parts(i);
  const times = [
    ["收藏于", fmtTime(i.createdAt)],
    i.done && ["实现于", fmtTime(i.doneAt)],
    i.updatedAt && i.updatedAt !== i.createdAt && ["修改于", fmtTime(i.updatedAt)],
    SOURCES[i.source] && ["来源", SOURCES[i.source]],
  ].filter(Boolean);
  return `
  <article class="detail-card st-${stateOf(i)}" data-id="${i.id}" style="--c:${c.hue}">
    ${cover}
    <button type="button" class="detail-close" data-close aria-label="关闭">${svgIcon('<path d="M6 6l12 12M18 6 6 18"/>')}</button>
    <div class="detail-body">
      ${i.note ? `<p class="detail-note">${esc(i.note)}</p>` : ""}
      ${metas ? `<div class="metas">${metas}</div>` : ""}
      ${owned}${send}
      <div class="detail-section"><h4>原截图</h4><div class="detail-shots" data-shots>${(i.shots || []).map((id) => `<span class="shot-wrap"><button type="button" class="shot-thumb" data-act="shots" data-shot="${esc(id)}" title="查看原图"></button><button type="button" class="shot-remove" data-act="unshot" data-id="${esc(id)}" title="删掉这张截图" aria-label="删掉这张截图">${svgIcon('<path d="M6 6l12 12M18 6 6 18"/>')}</button></span>`).join("")}<button type="button" class="shot-add" data-act="addshot" title="选择图片，或者打开详情时直接粘贴">${svgIcon('<path d="M12 5v14M5 12h14"/>')}<span>添加截图</span></button></div></div>
      <dl class="detail-times">${times.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
      <div class="dlg-actions">
        ${doneBtn}
        <span class="spacer"></span>
        <button type="button" class="ghost" data-close>关闭</button>
        <button type="button" data-act="edit" class="primary">编辑</button>
      </div>
    </div>
  </article>`;
}

let detailId = null;
function openDetail(item) {
  detailId = item.id;
  renderDetail();
  if (!$("#dlgDetail").open) $("#dlgDetail").showModal();
  $("#dlgDetail").scrollTop = 0;
}
function renderDetail() {
  const item = live().find((i) => i.id === detailId);
  if (!item) { $("#dlgDetail").close(); return; }
  $("#detailBody").innerHTML = detailHtml(item);
  // 原截图缩略图：本机没有的从云端下载一次
  for (const b of $$("#detailBody [data-shot]")) {
    loadShot(b.dataset.shot).then((src) => { if (src) b.style.backgroundImage = `url("${src}")`; else b.classList.add("missing"); }).catch(() => b.classList.add("missing"));
  }
}


// 链接在卡片上只显示域名：pan.quark.cn、store.steampowered.com
function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; }
}

function render() { renderTabs(); renderList(); if ($("#dlgDetail").open) renderDetail(); }

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

function onItemClick(e, box) {
  const item = items.find((i) => i.id === box.dataset.id);
  if (!item) return;
  const star = e.target.closest("[data-n]");
  if (star) {
    const n = +star.dataset.n;
    upsert({ ...item, rating: item.rating === n ? n - 1 : n });
    return;
  }
  const actor = e.target.closest("[data-act]");
  const act = actor?.dataset.act;
  if (act === "edit") { $("#dlgDetail").close(); openEdit(item); }
  else if (act === "shots") openShots(item);
  else if (act === "addshot") { shotTarget = item.id; $("#shotAddInput").click(); }
  else if (act === "unshot") {
    if (confirm("删掉这张原截图？连接了的应用里也会一起删掉。")) upsert({ ...item, shots: (item.shots || []).filter((id) => id !== actor.dataset.id) });
  }
  else if (act === "reject") rejectFulfill(item, actor.dataset.app);
  else if (act === "done") {
    const done = !item.done;
    upsert({ ...item, done, doneAt: done ? now() : null });
    toast(done ? "🎉 已实现！可以在「已实现」里找到它" : "已移回待实现");
  } else if (!actor && box.classList.contains("card") && !e.target.closest("a, button")) openDetail(item);
}
$("#list").addEventListener("click", (e) => {
  const card = e.target.closest(".card");
  if (card) onItemClick(e, card);
});
$("#detailBody").addEventListener("click", (e) => {
  const box = e.target.closest(".detail-card");
  if (e.target.closest("[data-close]")) $("#dlgDetail").close();
  else if (box) onItemClick(e, box);
});

// ---------- 编辑弹窗 ----------
const form = $("#editForm");
let editing = null;
let editRating = 3;

$("#fCategory").innerHTML = Object.entries(CATS).map(([k, c]) => `<option value="${k}">${c.name}</option>`).join("");
$("#fKind").innerHTML = Object.entries(KINDS).map(([k, n]) => `<option value="${k}">${n}</option>`).join("");

function renderExtraFields(cat, extra = {}) {
  $("#extraFields").innerHTML = (CATS[cat]?.fields || [])
    .map((f) => `<label>${f.label}<input name="x_${f.key}" type="${f.type === "date" ? "date" : "text"}" value="${esc(extra[f.key] || "")}"></label>`)
    .join("");
  // 类型只有小说有；下载链接和别名给会自动匹配的分类，别名能帮应用认出译名、原名
  $("#fKindRow").hidden = cat !== "novel";
  $("#fLinksRow").hidden = !CATS[cat]?.links;
  $("#fAliasesRow").hidden = !CATS[cat]?.fulfiller;
}
const splitList = (s, sep) => [...new Set(s.split(sep).map((x) => x.trim()).filter(Boolean))];
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
  form.kind.value = KINDS[item?.kind] ? item.kind : "novel";
  form.links.value = (item?.links || []).join("\n");
  form.aliases.value = (item?.aliases || []).join("，");
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
  const base = editing || { id: uid(), done: false, doneAt: null, source: "manual", externalIds: {} };
  const cat = form.category.value;
  const { kind, ...rest } = base;
  upsert({
    ...rest,
    category: cat,
    title: form.title.value.trim(),
    link: form.link.value.trim(),
    note: form.note.value.trim(),
    rating: editRating,
    createdAt: form.createdAt.value ? new Date(form.createdAt.value).toISOString() : now(),
    extra: collectExtra(),
    ...(cat === "novel" ? { kind: form.kind.value } : {}),
    links: CATS[cat]?.links ? splitList(form.links.value, /\n/) : [],
    aliases: CATS[cat]?.fulfiller ? splitList(form.aliases.value, /[,，、\n]/) : [],
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
          download: { type: "string" },
          aliases: { type: "string" },
          ...Object.fromEntries(EXTRA_KEYS.map((k) => [k, { type: "string" }])),
        },
        required: ["category", "title", "note", "link", "download", "aliases", ...EXTRA_KEYS],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

const EXTRACT_PROMPT = `这是我想收藏的东西（截图，或一篇笔记的文字和配图）。请识别其中值得收藏的条目（可能有多个），并归入以下分类之一：
${Object.entries(CATS).map(([k, c]) => `- ${k}: ${c.name}${c.fields.length || c.links ? `（可填字段：${[...c.fields.map((f) => `${f.key}=${f.label}`), ...(c.links ? ["download=下载地址"] : [])].join("，")}）` : ""}`).join("\n")}

规则：
- title 用条目本身的名字（书名、片名、店名、商品名、游戏名、地名、工具名等），保持原语言。
- aliases 填图里出现的这个条目的其他名字（中文译名、原名、英文名、简称），用 / 分隔，不要重复 title；没有就填 ""。
- 电子游戏（Steam、主机、手游）归入 game。
- 只填能看到或能明确推断的信息，其它字段填空字符串 ""。
- coupon 的 expiry 用 YYYY-MM-DD 格式；download 填下载/网盘/磁力链接，提取码写在链接后面。
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

// 给已有的条目补截图：存进本机，同步时上传，条目里记下 id；配对的应用会跟着拿到
let shotTarget = null;
async function addShots(itemId, files) {
  const item = items.find((i) => i.id === itemId);
  if (!item || !files.length) return;
  try {
    const shots = await Promise.all(files.map(async (f) => ({ id: uid(), data: (await imageToBase64(f, ARCHIVE_SIDE, ARCHIVE_QUALITY)).dataUrl })));
    await storeShots(shots);
    upsert({ ...item, shots: [...(item.shots || []), ...shots.map((s) => s.id)] });
    toast(`已添加 ${shots.length} 张截图`);
  } catch (err) {
    toast("截图保存失败：" + (err.message || err));
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
      source: files.length ? "screenshot" : "xhs",
      extra: Object.fromEntries(EXTRA_KEYS.filter((k) => r[k]).map((k) => [k, r[k]])),
      links: r.download?.trim() ? [r.download.trim()] : [],
      aliases: CATS[r.category]?.fulfiller ? splitList(r.aliases || "", /\s*\/\s*/).filter((a) => a !== r.title.trim()) : [],
      externalIds: {},
      ...(shots.length ? { shots: shots.map((s) => s.id) } : {}),
      _checked: true,
    }));
    markSeen(shotResults);
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

// manual：用户主动点了按钮，同一链接也照样弹（识别失败时要能重来）；
// 自动检测（切回页面时）则每个链接只提示一次，否则每次切回来都会弹
function offerXhs(text, manual = false) {
  const link = text.match(XHS_LINK)?.[0];
  if (!link) return false;
  const seen = lsGet(LS_SEEN, []);
  if (!manual && seen.includes(link)) return false;
  lsSet(LS_SEEN, [link, ...seen.filter((l) => l !== link)].slice(0, 100));
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
    if (!offerXhs(text, fromTap) && fromTap) toast("剪贴板里没有小红书链接");
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

// 识别结果里已经收藏过的（同分类、书名或别名相同），以及同一批里重复出现的，标出来并默认不勾选
const nameKey = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const namesOf = (i) => [i.title, ...(i.aliases || [])].map(nameKey).filter(Boolean);
function markSeen(results) {
  const earlier = [];
  for (const r of results) {
    const names = namesOf(r);
    const same = (i) => i.category === r.category && namesOf(i).some((n) => names.includes(n));
    const old = live().find(same);
    r._seen = old ? `已收藏过「${old.title}」` : earlier.some(same) ? "和上面一条重复" : "";
    if (r._seen) r._checked = false;
    earlier.push(r);
  }
}

function renderShotResults() {
  $("#shotResults").innerHTML = shotResults.map((r, idx) => `
    <div class="shot-item" data-idx="${idx}">
      <div class="row">
        <input type="checkbox" data-k="_checked" ${r._checked ? "checked" : ""}>
        <select data-k="category" style="width:auto">${Object.entries(CATS).map(([k, c]) => `<option value="${k}" ${k === r.category ? "selected" : ""}>${c.name}</option>`).join("")}</select>
        <span class="stars-input">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-rate="${n}" class="${n <= r.rating ? "on" : ""}">★</button>`).join("")}</span>
      </div>
      ${r._seen ? `<div class="seen">${esc(r._seen)}，默认不保存</div>` : ""}
      <input data-k="title" value="${esc(r.title)}" placeholder="标题">
      ${CATS[r.category]?.fulfiller ? `<input data-k="aliases" value="${esc(r.aliases.join(" / "))}" placeholder="别名（译名、原名），用 / 分隔">` : ""}
      <div class="grid2">
        ${(CATS[r.category]?.fields || []).map((f) => `<input data-x="${f.key}" value="${esc(r.extra[f.key] || "")}" placeholder="${f.label}">`).join("")}
      </div>
      ${CATS[r.category]?.links ? `<input data-k="download" value="${esc(r.links[0] || "")}" placeholder="下载链接（网盘分享链接，提取码可以写在后面）">` : ""}
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
  else if (k === "download") r.links = e.target.value.trim() ? [e.target.value.trim()] : [];
  else if (k === "aliases") r.aliases = splitList(e.target.value, /\s*\/\s*/);
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
  for (const { _checked, _seen, ...r } of picked) {
    r.extra = Object.fromEntries(Object.entries(r.extra).filter(([, v]) => v && v.trim()));
    if (!CATS[r.category]?.links) r.links = [];
    if (!CATS[r.category]?.fulfiller) r.aliases = [];
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
$("#shotAddInput").addEventListener("change", (e) => {
  addShots(shotTarget, [...e.target.files]);
  e.target.value = "";
});
document.addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
  // 打开详情时粘贴的图片补到这一条
  if ($("#dlgDetail").open && !$("#dlgImg").open && files.length && !e.target.closest?.("input, textarea")) { e.preventDefault(); addShots(detailId, files); return; }
  if (document.querySelector("dialog[open]:not(#dlgShot)")) return;
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
  $("#hideDone").innerHTML = Object.entries(CATS).map(([k, c]) =>
    `<label class="check"><input type="checkbox" name="hide_${k}" ${doneHidden(k) ? "checked" : ""}>${c.name}</label>`).join("");
  $("#shuyuServer").value = shuyuServer();
  $("#pairCode").hidden = true;
  $("#dlgSettings").showModal();
  loadAgents();
  refreshNetdisk();
}
function readSettingsForm() {
  const apiKey = sform.apiKey.value.trim();
  const hideDone = Object.fromEntries(Object.keys(CATS).map((k) => [k, !!sform[`hide_${k}`]?.checked]));
  // API Key 改动后标记待上传，下次同步时推到云端，其它设备会自动拿到
  cfg = { ...cfg, apiKey, syncPass: sform.syncPass.value, hideDone, apiKeyDirty: cfg.apiKeyDirty || apiKey !== cfg.apiKey };
  lsSet(LS_CFG, cfg);
  render();
}

// ---------- 已配对的设备 ----------
// 书屿、Plexus、Steamless 粘贴配对码（设备令牌）后读取和回报心愿；令牌只在生成时显示一次，可以吊销
const fmtSeen = (iso) => (iso ? "最后在线 " + fmtTime(iso) : "还没连接过");
async function loadAgents() {
  const list = $("#agentList");
  if (!cfg.syncPass) { list.innerHTML = `<li class="muted small">填好同步密码后可以配对。</li>`; return; }
  const { data, error } = await sb.rpc("mc_agent_list", { p_pass: cfg.syncPass });
  if (error) { list.innerHTML = `<li class="muted small">${esc(syncError(error))}</li>`; return; }
  list.innerHTML = data.length ? data.map((a) => `
    <li class="${a.revoked ? "revoked" : ""}"><span><b>${esc(a.name)}</b> · ${esc(APPS[a.app]?.name || a.app)}<br>
      <span class="muted small">${a.revoked ? "已吊销" : fmtSeen(a.lastSeen)}</span></span>
      ${a.revoked ? "" : `<button type="button" class="ghost" data-revoke="${esc(a.id)}">吊销</button>`}</li>`).join("")
    : `<li class="muted small">还没有配对的设备。</li>`;
}
$("#btnPair").addEventListener("click", async () => {
  readSettingsForm();
  if (!cfg.syncPass) return toast("请先填写同步密码");
  const app = $("#pairApp").value;
  const { data, error } = await sb.rpc("mc_agent_create", { p_pass: cfg.syncPass, p_name: $("#pairName").value.trim(), p_app: app });
  if (error) return toast(syncError(error));
  $("#pairCode").hidden = false;
  $("#pairCode").innerHTML = `<p class="small">在${esc(APPS[app].name)}的设置里粘贴这个配对码（只显示这一次）：</p>
    <div class="row"><code id="pairToken">${esc(data.token)}</code><button type="button" class="ghost" id="btnCopyPair">复制</button></div>`;
  $("#pairName").value = "";
  loadAgents();
});
$("#pairCode").addEventListener("click", async (e) => {
  if (e.target.id !== "btnCopyPair") return;
  try { await navigator.clipboard.writeText($("#pairToken").textContent); toast("已复制配对码"); } catch { toast("复制失败，请手动选中复制"); }
});
$("#agentList").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-revoke]");
  if (!b || !confirm("吊销后这台设备不能再读取和回报心愿，要重新配对才行。确定吊销吗？")) return;
  const { error } = await sb.rpc("mc_agent_revoke", { p_pass: cfg.syncPass, p_id: b.dataset.revoke });
  if (error) return toast(syncError(error));
  loadAgents();
});

// ---------- 网盘账号 ----------
// 夸克、百度的登录在 Windows 电脑上，书屿和 Plexus 共用；这里通过书屿的后台（Tailscale）扫码登录、退出，cookie 不经过云端。
// 中枢和书屿网页版同在 therookiegit.github.io，直接沿用书屿网页版存的登录令牌；没有或过期了才在这里登录一次书屿，并写回同一个位置。
const SHUYU_DEFAULT = "https://windows.tailc0b5f5.ts.net";
const rawGet = (key) => { try { return localStorage.getItem(key) || ""; } catch { return ""; } };
const rawSet = (key, v) => { try { v ? localStorage.setItem(key, v) : localStorage.removeItem(key); } catch {} };
const shuyuServer = () => (cfg.shuyuServer || rawGet("shuyu-server") || SHUYU_DEFAULT).replace(/\/+$/, "");
const nd = { status: null, signing: "", timer: null, error: "" };

async function shuyu(path, data) {
  const headers = {};
  const token = rawGet("shuyu-token");
  if (token) headers.Authorization = "Bearer " + token;
  if (data !== undefined) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(shuyuServer() + path, data === undefined ? { headers } : { method: "POST", headers, body: JSON.stringify(data) });
  } catch {
    throw Object.assign(new Error("Windows 电脑没有连上，暂时不能登录网盘"), { offline: true });
  }
  // Tailscale 在电脑离线时回 502 / 503
  if (res.status >= 502) throw Object.assign(new Error("Windows 电脑没有连上，暂时不能登录网盘"), { offline: true });
  if (res.status === 401) { rawSet("shuyu-token", ""); throw Object.assign(new Error("请先登录书屿"), { login: true }); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `书屿后台出错（HTTP ${res.status}）`);
  return body;
}

const qrSVG = (rows) => `<svg viewBox="-4 -4 ${rows.length + 8} ${rows.length + 8}" role="img" aria-label="登录二维码" shape-rendering="crispEdges"><rect x="-4" y="-4" width="100%" height="100%" fill="#fff" stroke="none"/><path fill="#000" stroke="none" d="${rows.map((row, y) => [...row].map((c, x) => (c === "1" ? `M${x} ${y}h1v1h-1z` : "")).join("")).join("")}"/></svg>`;
const ND_BUSY = ["waiting", "scanned", "checking"];

function renderNetdisk() {
  const box = $("#ndBox");
  if (nd.error === "login") {
    box.innerHTML = `<p class="small">书屿的后台要先登录（和书屿网页版是同一个登录，登录后书屿网页版也会登录上）。</p>
      <div class="row"><input id="shuyuPass" type="password" placeholder="书屿的访问密码" autocomplete="off" style="flex:1;width:auto"><button type="button" class="ghost" data-nd="signin">登录书屿</button></div>`;
    return;
  }
  if (nd.error) { box.innerHTML = `<p class="small warn">${esc(nd.error)}</p><button type="button" class="ghost" data-nd="retry">重试</button>`; return; }
  if (!nd.status) { box.innerHTML = `<p class="muted small">正在连接书屿…</p>`; return; }
  const rows = Object.entries(nd.status).map(([key, d]) => `
    <li><span class="dot ${d.signed_in ? "on" : ""}"></span><span>${esc(d.label)}：${d.signed_in ? "已登录" + (d.name ? " · " + esc(d.name) : "") : "未登录"}</span>
      ${d.signed_in ? `<button type="button" class="ghost" data-nd="logout" data-drive="${key}">退出</button>` : `<button type="button" class="ghost" data-nd="login" data-drive="${key}">扫码登录</button>`}</li>`).join("");
  const drive = nd.status[nd.signing];
  const login = drive?.login || {};
  const shown = drive && !drive.signed_in && ["waiting", "scanned"].includes(login.state);
  const words = { waiting: `用${drive?.app}扫一扫这个二维码，然后在手机上确认登录。二维码过期后会自动换新。`, scanned: "已扫码，请在手机上确认登录。",
    checking: `正在登录${drive?.label}…`, failed: login.error || "登录没有完成，请重新获取二维码。" };
  box.innerHTML = `<ul class="nd-list">${rows}</ul>${drive && !drive.signed_in && login.state !== "idle" ? `
    <div class="nd-login">${shown ? `<div class="qr">${login.qr ? qrSVG(login.qr) : `<img src="${esc(login.image)}" alt="${esc(drive.label)}登录二维码">`}</div>` : ""}
      <p class="small">${esc(words[login.state] || "")}</p>${login.state === "failed" ? `<button type="button" class="ghost" data-nd="login" data-drive="${nd.signing}">重新获取二维码</button>` : ""}</div>` : ""}`;
}

async function refreshNetdisk() {
  clearTimeout(nd.timer);
  if (!$("#dlgSettings").open) return;
  try {
    nd.status = await shuyu("/api/netdisk");
    nd.error = "";
    const drive = nd.status[nd.signing];
    if (drive?.signed_in) { toast(`${drive.label}已登录`); nd.signing = ""; }
    if (drive && ND_BUSY.includes(drive.login?.state)) nd.timer = setTimeout(refreshNetdisk, 2000);
  } catch (err) {
    nd.status = null;
    nd.error = err.login ? "login" : err.message;
  }
  renderNetdisk();
}

$("#ndBox").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-nd]");
  if (!b) return;
  const act = b.dataset.nd, key = b.dataset.drive;
  try {
    if (act === "retry") { nd.error = ""; renderNetdisk(); return refreshNetdisk(); }
    if (act === "signin") {
      const res = await shuyu("/api/login", { password: $("#shuyuPass").value });
      rawSet("shuyu-token", res.token);
      nd.error = "";
      return refreshNetdisk();
    }
    if (act === "login") {
      nd.signing = key;
      nd.status[key] = await shuyu("/api/netdisk/login", { drive: key });
      renderNetdisk();
      clearTimeout(nd.timer);
      nd.timer = setTimeout(refreshNetdisk, 2000);
    }
    if (act === "logout") {
      const label = nd.status?.[key]?.label || "网盘";
      if (!confirm(`会同时退出书屿和 Plexus 里的${label}，确定退出吗？`)) return;
      await shuyu("/api/netdisk/logout", { drive: key });
      refreshNetdisk();
    }
  } catch (err) {
    if (err.login || err.offline) { nd.error = err.login ? "login" : err.message; renderNetdisk(); } else toast(err.message);
  }
});
$("#shuyuServer").addEventListener("change", (e) => {
  cfg = { ...cfg, shuyuServer: e.target.value.trim() };
  lsSet(LS_CFG, cfg);
  nd.status = null; nd.error = "";
  renderNetdisk();
  refreshNetdisk();
});
$("#ndBox").addEventListener("keydown", (e) => {
  // 在设置表单里按回车会关掉设置，这里改成登录书屿
  if (e.key === "Enter" && e.target.id === "shuyuPass") { e.preventDefault(); $('[data-nd="signin"]').click(); }
});
$("#dlgSettings").addEventListener("close", () => clearTimeout(nd.timer));
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
  return [...map.values()].map(normalize);
}

function syncError(err) {
  if (err?.code === "28P01") return "同步密码错误";
  if (err?.code === "MC429") return `同步密码错误次数太多，请 ${Math.ceil((+err.hint || 900) / 60)} 分钟后再试`;
  if (err?.code === "PGRST202") return "云端还没执行最新的迁移，见 supabase/README.md";
  return "同步失败：" + (err?.message || err);
}

// 各应用回报的「已拥有」；云端还没执行 002 迁移时（PGRST202）跳过
async function pullFulfill() {
  const { data, error } = await sb.rpc("mc_fulfill_pull", { p_pass: cfg.syncPass });
  if (error) throw error;
  fulfill = data || [];
  lsSet(LS_FULFILL, fulfill);
}

async function rejectFulfill(item, app) {
  if (!cfg.syncPass) return toast("需要先在设置里填同步密码");
  const { error } = await sb.rpc("mc_fulfill_reject", { p_pass: cfg.syncPass, p_item_id: item.id, p_app: app });
  if (error) return toast(syncError(error));
  fulfill = fulfill.map((f) => (f.itemId === item.id && f.app === app ? { ...f, rejected: true } : f));
  lsSet(LS_FULFILL, fulfill);
  render();
  toast(`已标记「不是这个」，${APPS[app]?.name || app}以后会换别的去匹配`);
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
    const before = JSON.stringify(fulfill);
    await pullFulfill().catch((e) => { if (e?.code !== "PGRST202") throw e; console.warn("跳过已拥有记录：", e.message); });
    if (JSON.stringify(merged) !== JSON.stringify(items) || JSON.stringify(fulfill) !== before) {
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
    toast(syncError(err));
  }
}

document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sync(); });

render();
sync();
handleShareHash();
checkClipboard();
