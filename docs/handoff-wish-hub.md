# 交接：心愿中枢（my-collections）+ 书屿 / Plexus 共用网盘登录

你接手的是一个跨 4 个仓库的改造。方案已经和用户逐条讨论定下来了，**不要重新讨论已定的决定**；遇到这里没写到的取舍，先问用户。

## 1. 背景

四个仓库都在 D 盘根目录，都属于 GitHub 账号 `TheRookieGit`，开始时都在 `main` 上、没有未提交的改动：

| 目录 | 是什么 | 技术栈 | 现在的「想要 → 拥有」 |
|---|---|---|---|
| `D:\my-collections` | **心愿中枢**。GitHub Pages 静态页（`app.js`/`index.html`/`style.css`），8 个分类（novel/movie/tv/coupon/restaurant/tool/place/grocery），数据存在 localStorage，可选通过 Supabase 同步（`supabase/schema.sql`：单一同步密码，表对外关闭，只能调 `mc_*` RPC）。支持截图识别、小红书快捷指令（`#add=`）。 | 原生 JS | 手动点「✓ 已实现」 |
| `D:\shuyu` | 书屿（「爱妻的书屿」，用户的爱人在用，**稳定性优先**）：扫描 `Z:\老婆小说漫画`，嵌套压缩包、AI 清理、微信读书、网盘下载。本机端口 8765，Tailscale Funnel 443（`https://windows.tailc0b5f5.ts.net`），网页版是 `therookiegit.github.io/shuyu/`，另有 Lite（`/shuyu/lite/`）。 | Python 3.10+，只用标准库；PyInstaller 打包成托盘应用，GitHub Release `app-latest` 自动更新 | `wishlist.py`：扫描后按书名、文件夹名、压缩包名自动标「已到书架」 |
| `D:\plexus` | 从书屿复制出来的架构，管 Plex 影视：同步、交叉比对、网盘下载（断点续传队列在 `downloads.py`）、按 Plex 格式重命名、删除 NAS 文件（不进回收站）。端口 8766，Funnel 8443。 | 同书屿 | `wishlist.py`：按 Plex guid 或片名+年份判断「已拥有」；另有 favorites |
| `D:\steamless` | 游戏库，Electron。有自己的 Supabase 项目（和中枢不是同一个），使用账号 + RLS。状态流转 wishlist → downloaded → installed。 | Node 22 | 自动流转 |

## 2. 已定的决定

1. **my-collections 就是心愿中枢**，不新建仓库。
2. **书屿和 Plexus 共用的 Python 代码放在 my-collections 的 `collectionkit/` 包里**。书屿、Plexus 把整个 my-collections 仓库作为 git submodule 引入，然后 `import collectionkit`。（之前考虑过的独立仓库 `homekit` / `collection-kit` / `collectionkit` 都**作废**了。）
3. **书屿和 Plexus 保留各自独立的应用和网页版**，不合并成一个应用，也不需要为以后合并预留设计。
4. **网盘（夸克、百度）登录全部共用**：在中枢、书屿、Plexus 任意一处登录，其他地方都已登录；任意一处退出，全部退出。登录方式**沿用书屿现在的做法**：在 Windows 本机扫码，cookie 用 DPAPI 加密。**cookie 不上云。** 书屿和 Plexus 在同一台 Windows 上，共用本地凭证库 `%LOCALAPPDATA%\CollectionKit\netdisk.sqlite3`。中枢的「网盘账号」页面通过 Tailscale 调书屿的后台来完成登录。
5. **Steamless 不做网盘下载**，只把游戏心愿单向镜像到中枢。
6. 默认值（用户没有反对）：
   - 中枢继续使用同步密码；各应用通过「配对」拿到设备令牌，令牌可以吊销。
   - 「已拥有」（应用自动写入）和「已实现」（手动点）是两个独立的状态；「已实现」按类别可以隐藏，小说类默认隐藏。
   - 游戏心愿以 Steamless 为准，中枢只读显示。
   - 履约记录（已拥有）**单独放一张表 `mc_fulfill`，不写进 items 的 JSON**，因为 `mc_push` 是整行按 `updatedAt` 覆盖，会互相冲掉。
   - 没有配对中枢的应用退回本地模式，保持现在的行为。
7. **已作废**：在云端存网盘 cookie、Edge Function 扫码登录、`mc_nd_*` 这组 RPC、Steamless 的网盘模块。

## 3. 当前进度

`D:\my-collections` 在本地分支 **`feat/wish-hub`**（从 `main` 切出），**全部未提交、未推送**：

```
 M README.md                          末尾新增「collectionkit（书屿、Plexus 共用的代码）」一节
?? .gitignore                         __pycache__/  *.pyc
?? .github/workflows/collectionkit.yml   windows-latest，Python 3.10 和 3.12，只在 collectionkit/** 或 tests/** 变动时运行
?? collectionkit/__init__.py          __version__ = '0.1.0'
?? collectionkit/credentials.py       共享凭证库
?? collectionkit/netdisk.py           网盘登录、转存、下载
?? collectionkit/qr_code.py           从 plexus 原样复制
?? collectionkit/secret.py            从 plexus 原样复制（DPAPI 的 protect_secret，出错抛 ValueError）
?? tests/__init__.py
?? tests/test_netdisk.py              6 个测试，本地全部通过（python -m unittest discover -s tests -t .）
?? docs/handoff-wish-hub.md           就是这份交接文档，和第 A 期一起提交
```

`D:\collectionkit` 是之前的临时目录，用户已经删掉了。书屿、Plexus、Steamless **还没有任何改动**。

### collectionkit 的设计（改之前先读代码）

- `netdisk.py` 以 **Plexus 的 `netdisk.py`** 为基础，接口为：`files(link)` → `(share, files)`；`save(share, files)` 逐个 yield `(file, ref 或错误字符串)`；`link(ref)` → `(url, headers)`；`stream(ref, start, sink)` → HTTP 状态码。去掉了 Plexus 专用的 `wanted()`。
  - `Drives(saves_to, store=None, max_files=2000)` 取代原来的 `NetDisk`，有 `drive(key)`、`status()`、`adopt(saved)`。`saves_to` 是转存到用户网盘里的文件夹名，各应用自己传（`书屿转存`、`Plexus转存`）。
  - `fetch` 中途断线抛 `Unreachable('下载中断了，请稍后再试。')`，它是 `NetDiskError` 的子类。
- `credentials.py`：`Credentials(folder=None)`。目录可以用环境变量 `COLLECTIONKIT_DIR` 覆盖，默认 `%LOCALAPPDATA%\CollectionKit`。表 `sessions(drive, value, rev, updated)`；`put()` 让 `rev` 加一；`adopt()` 只在还没有记录时写入（迁移旧登录用）。
- `Session` 的同步规则：
  - 每次 `send()` 或 `cookie()` 之前比对 `rev`，变了就从库里重新加载。
  - 扫码期间 `pinned=True`，不重新加载，避免把正在收集的 cookie 冲掉；结束后 `release()`。
  - `forget()`（退出）只在原来确实有登录时才写库。
  - 扫码中途失败：只清空本地 jar，不清库里已有的登录。
  - `expired()` 调 `forget(rev)`：如果库里已经是别的应用新登录的版本，就改用新的，不清掉。
  - **cookie 只在登录成功和退出时写库**，续期得到的新 cookie 只在内存里。这和两个应用原来的行为一致。
- `Drive.login()` 在 `qr()` 抛错时会解除 pin，原来没有这个处理。

## 4. 工作规则

- **提交、推送、建 PR、合并到 main 之前，都要先问用户。** 每个仓库都在功能分支 `feat/wish-hub` 上工作。
- 提交信息末尾加：`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`；PR 描述末尾加：`🤖 Generated with [Claude Code](https://claude.com/claude-code)`。
- 照着周围的代码写：
  - Python 是紧凑风格（一行多语句、`;` 连写），只用标准库，注释和 docstring 用英文。
  - 界面文字和 README 用中文，语气跟现有 README 一致。
  - 测试用 `unittest`；网络请求通过 patch `fetch` 来模拟。
- **测试不能碰真实的 `%LOCALAPPDATA%\CollectionKit`**：在 setUp 里设置 `COLLECTIONKIT_DIR` 指向临时目录，或者显式传 `Credentials(tmp)`。
- 不要动用户的真实数据目录：`%LOCALAPPDATA%\AiqiShuyu`、`%LOCALAPPDATA%\Plexus`、两个项目的 `.data/`、`Z:` 盘、NAS。
- my-collections 是公开仓库，**任何密钥、密码、个人数据都不能进仓库**。Supabase 的 SQL 只写成迁移文件，由用户自己去 SQL Editor 执行；不要尝试连生产数据库。
- 删除目录这类不可逆的操作先问用户（`rm -rf` 盘符根目录下的目录会被安全检查拦下）。
- 每完成一期，给用户一个简短的汇报：改了什么、测试结果、下一步需要用户做什么。

## 5. 任务

### 第 A 期：推送 collectionkit（**先征得用户同意**）

1. 在 `D:\my-collections` 再跑一次测试，提交 `feat/wish-hub`，推送到 origin。
2. CI 能不能推送 `.github/workflows/` 要看 gh 的 token 有没有 `workflow` 权限；被拒的话告诉用户，让他运行 `gh auth refresh -s workflow`。
3. 确认 `Test collectionkit` 这个 workflow 在 GitHub 上通过。
4. 书屿、Plexus 先引用这个分支上的提交；等中枢合并到 main 后，再更新到 main 上的提交，并打 tag（比如 `collectionkit-v0.1.0`）。

### 第 B 期：书屿接入 collectionkit

1. `git submodule add https://github.com/TheRookieGit/my-collections.git vendor/my-collections`，然后切到第 A 期推送的那个提交。
2. 在 `server.py` 和 `desktop_app.py` 最开头，把 `Path(__file__).parent/'vendor'/'my-collections'` 加进 `sys.path`。打包后的 exe 里要确认这样也能找到：PyInstaller 加 `--paths vendor/my-collections`。
3. `.github/workflows/windows-app.yml` 和 `pages.yml` 的 checkout 加 `with: submodules: true`。
4. `启动爱妻的书屿.bat`：启动前如果 `vendor\my-collections\collectionkit` 不存在，就提示运行 `git submodule update --init`。
5. 改写 `netdisk.py`：
   - 删掉 `fetch`、`Reply`、`Session`、`Drive`、`Quark`、`Baidu`、`links` 和那几个常量，改为从 `collectionkit.netdisk` 导入。
   - 保留书屿自己的 `wanted()`（小说、压缩包和大小限制）、`NetDisk` 的任务部分（`fetch`/`task`/`_run`/`_store`）。
   - `NetDisk` 改为基于 `Drives('书屿转存', max_files=500)`，可以继承，也可以组合。
   - 原来的 `drive.download(share, files, work)` 改成：先 `drive.save()`，对每个 ref 用 `drive.stream(ref, 0, file)` 下载到 `work/uuid` 里，检查状态码是 200 且文件大小等于 `item['size']`，失败时返回和原来一样的错误字符串（「下载失败（HTTP n）」「下载不完整，请重试」）。`Unreachable` 当作单个文件失败处理，不要让整个任务失败。
   - 原来 `except` 里的 `CleanError`：现在 `protect_secret` 抛的是 `ValueError`，已经被 `Session` 自己处理了。
6. **迁移旧登录**：`NetDisk` 初始化时，从 `library.sqlite3` 的 `settings` 表读出 `netdisk_quark`、`netdisk_baidu` 两行，调用 `drives.adopt({'quark': ..., 'baidu': ...})`。旧数据行保留不删，方便回退。
7. **百度二维码格式变了**：原来是图片 URL，现在是 `data:image/png;base64,...`。`lite/lite.js:171` 用的是 `<img src>`，可以直接显示；但还要检查 `web/` 里有没有别的地方显示百度二维码。
8. 界面：
   - 登录弹窗和网盘账号区域加一句「登录在书屿和 Plexus 之间共用」。
   - 退出时二次确认：「会同时退出 Plexus 和心愿中枢里的{网盘}」。
9. 测试：
   - `tests/test_netdisk.py` 里的 patch 目标改成 `collectionkit.netdisk.fetch` 和 `collectionkit.netdisk.POLL`，setUp 设置 `COLLECTIONKIT_DIR`。
   - 新增测试：旧的 settings 登录会被 adopt；共享库里已经有登录时，以共享库为准。
   - 全部测试都要通过，包括 `tests/frontend.cjs`、`tests/lite.cjs`，跑法以 CI 为准。
10. README：在「从网盘链接下载」一节说明登录共用、退出会全局生效；在「从源码启动」说明 clone 时要加 `--recursive`。

### 第 C 期：Plexus 接入 collectionkit

和第 B 期一样做 submodule、`sys.path`、CI、`.bat`、README。另外：

1. `netdisk.py` 只留下 `wanted()`（视频、字幕）和 `NetDisk = Drives('Plexus转存')` 这层封装。`downloads.py` 第 18 行 `from netdisk import NetDiskError, Unreachable, links, wanted` 要继续能用，可以在 `netdisk.py` 里重新导出。
2. 迁移旧登录的方式同 B-6。Plexus 的 settings 表结构一样（`settings(key, value)`）。
3. **其他应用退出时，正在进行的下载**：会收到带 `login` 的 `NetDiskError`。确认 `downloads.py` 会把批次转成「等待登录」或类似可恢复的状态，而不是判失败；重新登录后能从断点继续。加一个测试覆盖这种情况。
4. `tests/test_netdisk.py` 的 patch 目标同 B-9；其中文件夹断言 `'/Plexus转存'` 要保持成立。
5. **写一个跨应用的测试**：两个 `Drives` 指向同一个临时 `Credentials`，模拟书屿和 Plexus（collectionkit 里已经有类似的测试，这里是在 Plexus 的 `NetDisk` 这一层再验证一次）。

### 第 D 期：真实账号验证（需要用户配合，B、C 都完成后做）

请用户在 Windows 本机上同时运行书屿和 Plexus：

1. 在书屿里扫码登录夸克 → Plexus 不用扫码就能读取分享并下载。
2. 两边同时各下载一个夸克文件，持续 20～30 分钟，看夸克的 `__puus` 续期后，另一边会不会被踢掉。百度同样测一次。
3. 在 Plexus 里退出 → 书屿也显示已退出。

如果第 2 步出现互踢，再设计「续期后写回共享库」的方案（按 `rev` 做比较交换），**先和用户讨论**。

### 第 E 期：中枢后端（`D:\my-collections\supabase`）

1. 把 `schema.sql` 拆成编号的迁移文件：`supabase/migrations/001_base.sql`（现有内容）、`002_...sql`……
   - 要能重复执行。
   - 加一张 `mc_migrations` 表，记录执行过哪些迁移。
   - 原来 `schema.sql` 里「单独设置同步密码」的说明保留。
2. `mc_api_version()`：返回整数，各应用启动时检查。
3. `mc_check` 加失败次数限制，比如每个来源 IP 或全局，连续失败 N 次后锁定一段时间。
4. `mc_agents`：id、名称、应用（hub/shuyu/plexus/steamless）、令牌哈希（bcrypt 或 sha256）、创建时间、最后在线时间、是否吊销。
   - RPC：`mc_agent_create(p_pass, name, app)`（返回明文令牌，只返回这一次）、`mc_agent_list(p_pass)`、`mc_agent_revoke(p_pass, id)`。
   - 内部用的 `mc_agent_check(token)` 同时更新最后在线时间。
5. `mc_fulfill`：item_id、应用、ref、跳转链接、owned_at、rejected（布尔）、updated_at，主键 (item_id, app)。
   - RPC：`mc_fulfill_put(p_token, rows)`；`mc_fulfill_pull(p_pass)`，或者扩展 `mc_pull` 一起返回。
   - 中枢的「不是这个」由 `mc_fulfill_reject(p_pass, item_id, app)` 写入 rejected。
6. `mc_wishes(p_token, categories text[], since timestamptz)`：增量拉取，包含已删除（`deleted`）的条目，让应用能同步删除。
   `mc_wish_put(p_token, item jsonb)`：应用里的「添加想看」直接写进中枢，沿用 `updatedAt` 较新者胜出的规则。
7. 所有新函数照现有写法：`security definer set search_path = ''`，先 `revoke ... from public` 再 `grant ... to anon, authenticated`。
8. 写完给用户一份「请按顺序在 SQL Editor 执行」的清单。

### 第 F 期：中枢前端（`app.js`、`index.html`、`style.css`）

1. **数据模型**：条目新增 `aliases[]`、`externalIds{steamAppId, plexGuid, tmdb}`、`links[]`、`kind`（小说的 novel/folder/zip，对应书屿想看清单的 KINDS）、`source`（screenshot/xhs/manual）。
   - 旧数据迁移：`extra.download` 迁成 `links[0]`；`done`/`doneAt` 保持原意，不转成已拥有。
   - 迁移要幂等，旧版页面读到新数据也不能出错。
2. `CATS` 增加 `game`（只读，来自 Steamless），以及每个分类的 `fulfiller`：novel→shuyu，movie/tv→plexus，game→steamless。
   小说类隐藏「已实现」按钮。
3. 卡片显示三档状态「想要 / 已拥有 / 已实现」。「已拥有」显示来源和日期，可以点击跳到对应网页版的详情页（具体用 `mc_fulfill` 里的跳转链接）。
   「不是这个」调用 `mc_fulfill_reject`。
4. 「送到书屿下载」「送到 Plexus 下载」：带上 links 跳到书屿 Lite 的网盘链接页 / Plexus 的下载页。
   需要在书屿 Lite、Plexus 下载页加上从 URL hash 读取预填链接的功能，这部分属于第 G 期，两边约定一个参数名，比如 `#links=`。
5. 设置里的「已配对的设备」：生成配对码（就是 `mc_agent_create` 返回的令牌）、查看列表、吊销。
6. 设置里的「网盘账号」：
   - 通过书屿的后台（默认 `https://windows.tailc0b5f5.ts.net`，可以修改）调用 `GET` 网盘状态的接口（在 `shuyu/server.py` 里找具体路由；POST 是 `/api/netdisk/login` 和 `/api/netdisk/logout`，参数 `{drive}`）。
   - 中枢和书屿网页版是同一个来源（`therookiegit.github.io`），书屿后台的 `--allow-origin` 已经放行，**但书屿后台要求登录**：先查清书屿网页版怎么保存登录状态（cookie 还是 localStorage 里的 token），再决定是复用还是在中枢里单独登录一次书屿，**方案定了先问用户**。
   - 二维码显示：夸克返回的是 `qr` 矩阵，用 lite.js 的 `qrSVG` 那种写法；百度返回 `image` 数据。要轮询登录状态。
   - 电脑离线时显示「Windows 电脑没有连上，暂时不能登录网盘」。
7. 截图识别时同时识别类别；游戏要能匹配到 Steam AppID（可以参考 `steamless/shared/match.js`、`steam-store.js`，注意 Steam 不允许网页跨域访问，Steamless 网页版是通过云函数转发的）。这一项可以放到最后做，先问用户要不要。
8. README 更新「功能」和「数据与隐私」两节。

### 第 G 期：书屿、Plexus 的想看清单接入中枢

1. `collectionkit/hub.py`：用 `urllib` 调 Supabase RPC，URL 和 publishable key 跟 `app.js` 第 5、6 行一样。
   - 设备令牌用 `collectionkit.secret.protect_secret` 加密，存在 `%LOCALAPPDATA%\CollectionKit\hub.json`，书屿和 Plexus 共用。
   - 方法：`pair(token)`、`unpair()`、`wishes(categories, since)`、`put_wish(item)`、`fulfill(rows)`、`api_version()`。
   - 网络错误不能影响应用本身：离线时排队，联网后补推。
2. 书屿 `wishlist.py`：
   - 已配对时，想看清单从中枢拉取 `['novel']`，存进本地缓存表。`match()`、`keys()` 的匹配逻辑不变；匹配成功后调用 `fulfill`；跳过 rejected 的匹配。
   - 第一次配对时，把本地 `wishlist` 表上传到中枢（按书名+作者去重），本地表保留只读。
   - `book_links` 的下载地址保持本地，不上云。
3. Plexus `wishlist.py`：同样处理，拉取 `['movie','tv']`，show 对应 tv，guid、thumb、summary 一起上传；favorites 不动。
4. 两个应用的设置里加「连接心愿中枢」：粘贴配对码、显示状态、断开连接。
5. 书屿 Lite、Plexus 下载页支持 `#links=` 预填链接（对应 F-4）。
6. 测试覆盖：拉取、匹配后回写、rejected 被跳过、离线排队、首次上传去重。

### 第 H 期：Steamless 镜像游戏心愿

1. 设置里「连接心愿中枢」（配对令牌，和 Steamless 自己的账号无关）。
2. 把 `wishlist`/`downloaded`/`installed` 状态的游戏推送到中枢的 `game` 类：名字、steamAppId、`favoritedAt`、发售信息、状态；`downloaded` 和 `installed` 都算已拥有。
3. 只让一台电脑负责推送，比如最近一次扫描的那台，避免多台电脑重复写。
4. 写一个 JS 版的 hub 客户端（Node 端），不要去 import Python 包。

## 6. 推荐顺序

A → B → C → D（用户验证）→ E → F（可以和 G 交叉进行）→ G → H。
每一期结束都停下来汇报，等用户确认再进入下一期。书屿最先接入，是因为它的使用者最在意稳定，要先在它身上把共享登录跑稳。
