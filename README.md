# ⭐ 我的收藏夹

个人收藏网站：小说、Coupon、餐厅、电影、电视剧、工具、想去玩的地方、超市购物清单。

在线地址：https://therookiegit.github.io/my-collections/

## 功能
- 8 个分类，每条收藏自动记录收藏时间（可修改）
- 小说 / 电影 / 电视剧有「下载地址」字段
- 1–5 星收藏等级（卡片上直接点星星修改）
- 「✓ 已实现」按钮：不会删除，移到「已实现」标签页保留（可撤回）
- 手动添加，或上传 / 直接 Ctrl+V 粘贴截图，用 Claude Haiku 5.5 自动识别并预填（可多条）
- 搜索、排序、导入导出 JSON

## 数据与隐私
本仓库是公开的（为了 GitHub Pages），**仓库里不存任何个人数据**。
- 数据默认存在浏览器 localStorage
- API Key / GitHub Token 只保存在你自己浏览器的 localStorage
- 可选：在设置中配置 GitHub 同步，把数据存到一个**私有仓库**的 JSON 文件里，实现多设备同步

### 配置 GitHub 同步
1. 新建私有仓库，如 `my-collections-data`
2. 创建 [Fine-grained token](https://github.com/settings/personal-access-tokens/new)：只选该仓库，权限 Contents: Read and write
3. 网站设置里填 Token、`TheRookieGit/my-collections-data`、`collections.json`

### 截图识别
在设置里填 [Anthropic API Key](https://console.anthropic.com/settings/keys)。请求从浏览器直接发往 Anthropic API。
