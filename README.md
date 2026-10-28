# ⭐ 我的心愿单

个人收藏网站：小说、电影、电视剧、游戏、Coupon、餐厅、工具、想去玩的地方、超市购物清单。也是书屿、Plexus、Steamless 共用的心愿中枢：在这里记下想看的书和影视，下载到了会自动标成「已拥有」。

在线地址：https://therookiegit.github.io/my-collections/

## 功能
- 9 个分类，每条收藏自动记录收藏时间（可修改）
- 三档状态：**想要**、**已拥有**、**已实现**
  - 已拥有由应用自动回报：书屿下载到的小说、Plexus 里有了的电影电视剧、Steamless 里下载或安装了的游戏。卡片上显示来源和日期，点「查看」跳到对应网页版；匹配错了点「不是这个」，那个应用以后会换别的去匹配
  - 「✓ 已实现」是手动点的，不会删除，移到「已实现」标签页保留（可撤回）。可以按分类隐藏这个按钮，小说默认隐藏：下载到书屿就算数
- 小说 / 电影 / 电视剧可以记网盘下载链接和别名；有链接时点「送到书屿下载」「送到 Plexus 下载」，链接会预先填进书屿 Lite 或 Plexus 的下载页。小说还可以选类型（小说文件 / 文件夹 / ZIP 压缩包），和书屿想看清单一样
- 游戏以 Steamless 为准：Steamless 同步过来的游戏在这里只能看；在这里截图识别、手动加的游戏，由 Steamless 自己去匹配 Steam
- 1–5 星收藏等级（卡片上直接点星星修改）
- 手动添加，或上传 / 直接 Ctrl+V 粘贴截图，用 Claude Haiku 5.5 自动识别分类并预填（可多条）
- 设置里的 **已配对的设备**：给书屿、Plexus、Steamless 生成配对码，查看最后在线时间，随时吊销
- 设置里的 **网盘账号**：通过 Windows 电脑上书屿的后台扫码登录、退出夸克和百度网盘，和书屿、Plexus 共用同一个登录
- 搜索、排序、导入导出 JSON

## 数据与隐私
本仓库是公开的（为了 GitHub Pages），**仓库里不存任何个人数据**。
- 数据默认存在浏览器 localStorage
- 同步密码只保存在本机浏览器
- Anthropic API Key 开启云同步后会存到云端（同样受同步密码保护），所有设备共用，只需填一次
- 可选：云同步（Supabase）。数据表对外完全关闭，只能凭同步密码通过数据库函数读写，实现多设备同步。同步密码连续输错 10 次锁定 15 分钟
- 书屿、Plexus、Steamless 凭配对码（设备令牌）读写心愿，只能碰自己负责的分类：书屿管小说，Plexus 管电影和电视剧，Steamless 管游戏。云端只存令牌的哈希，吊销后立刻失效
- 「已拥有」记录（应用里对应的书名或片名、跳转链接）存在云端单独一张表里
- **网盘登录不上云**：夸克、百度的 cookie 加密保存在 Windows 电脑上（`%LOCALAPPDATA%\CollectionKit`），只有书屿和 Plexus 在本机读取。设置里的「网盘账号」是通过 Tailscale 直接连到书屿的后台扫码，沿用书屿网页版的登录；书屿下载地址也只留在书屿里

### 配置 Supabase
1. SQL Editor 里按编号顺序运行 [supabase/migrations](supabase/migrations) 下的文件，详见 [supabase/README.md](supabase/README.md)
2. 再单独运行设置同步密码的 SQL（填你自己的密码，不要提交到仓库）
3. 网站设置里填同步密码

### 截图识别
在设置里填 [Anthropic API Key](https://console.anthropic.com/settings/keys)。请求从浏览器直接发往 Anthropic API。

### 小红书快捷指令（iPhone）
在小红书分享笔记 → 快捷指令自动读取笔记正文和配图 → 网站用 Claude 识别 → 确认后保存。

在「快捷指令」App 新建「存到收藏夹」，详细信息里打开「在共享表单中显示」，接收「文本、URL」，「如果没有输入」选「获取剪贴板」，然后依次添加：

1. **从输入中获取 URL**：输入选「快捷指令输入」
2. **从列表中获取项目**：第一项
3. **获取 URL 内容**：URL 选上一步的「项目」
4. **设定名称**：名称填 `page.txt`（让后面按纯文本处理网页源码）
5. **匹配文本**：在「重命名的项目」中匹配下面的正则
   ```
   "title":"(?:[^"\\]|\\.)*","desc":"(?:[^"\\]|\\.)*"|"url":"http[^"]*webpic[^"]*"
   ```
6. **合并文本**：合并「匹配项」，分隔符选「换行符」
7. **文本**：先插入「快捷指令输入」，回车换行，再插入「合并的文本」
8. **URL 编码**：编码上一步的「文本」
9. **文本**：`https://therookiegit.github.io/my-collections/#add=` 后面接「URL 编码后的文本」
10. **打开 URL**：打开上一步的「文本」

用法：笔记里点「分享」选「存到收藏夹」；或「复制链接」后运行快捷指令（推荐绑定「设置 → 辅助功能 → 触控 → 轻点背面」）。
匹配不到正文时（如小红书改版），网站会退回到只按分享文字识别。

## collectionkit（书屿、Plexus 共用的代码）

`collectionkit/` 是书屿和 Plexus 共用的 Python 代码，和网页本身无关。两个应用把这个仓库作为 git submodule 引入，然后 `import collectionkit`，只用到 Python 标准库。

- **网盘登录全部应用共用**：夸克、百度的登录保存在这台电脑的 `%LOCALAPPDATA%\CollectionKit\netdisk.sqlite3`（cookie 用 Windows DPAPI 加密，不上传）。在书屿或 Plexus 里扫码登录，另一个应用立即可以用；在任何一个里退出，或者网盘提示登录已过期，所有应用都需要重新扫码。
- 各应用转存到自己网盘里的文件夹不同（`书屿转存`、`Plexus转存`），下载什么、放到哪里由各应用自己决定。
- 测试：`python -m unittest discover -s tests -t .`，改动 `collectionkit/` 或 `tests/` 后由 `.github/workflows/collectionkit.yml` 在 Windows 上用 Python 3.10 和 3.12 运行。
- 应用通过 submodule 固定使用某个版本，改动后需要在各应用里分别更新 submodule。
