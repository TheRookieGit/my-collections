// 代替网页读取小红书笔记（浏览器跨域读不到），返回和 iOS 快捷指令相同格式的匹配片段：
// "title":"…","desc":"…" 和 "url":"…" 各占一行，前端用 parseShare() 解析。
// 部署：Supabase Dashboard → Edge Functions → 新建 xhs-note，粘贴本文件，关闭 Verify JWT。

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const ALLOWED = /^https?:\/\/(?:xhslink\.(?:cn|com)|(?:www\.)?xiaohongshu\.com)\//;
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const PATTERN = /"title":"(?:[^"\\]|\\.)*","desc":"(?:[^"\\]|\\.)*"|"url":"http[^"]*webpic[^"]*"/g;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { url, pass } = await req.json();
    if (typeof url !== "string" || !ALLOWED.test(url)) return json({ error: "只支持小红书链接" }, 400);

    // 用同步密码校验调用者，避免被别人当成公共代理
    const check = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/mc_get_config`, {
      method: "POST",
      headers: { apikey: req.headers.get("apikey") ?? "", "Content-Type": "application/json" },
      body: JSON.stringify({ p_pass: String(pass ?? "") }),
    });
    if (!check.ok) return json({ error: "同步密码错误" }, 401);

    const page = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
    if (!ALLOWED.test(page.url)) return json({ error: "链接跳转到了非小红书页面" }, 400);
    const html = await page.text();
    const matches = html.match(PATTERN) ?? [];
    return json({ raw: matches.join("\n"), found: matches.length });
  } catch (err) {
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});
