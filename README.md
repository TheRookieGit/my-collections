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
- Anthropic API Key 只保存在你自己浏览器的 localStorage
- 同步密码同样只保存在本机浏览器
- 可选：云同步（Supabase）。数据表对外完全关闭，只能凭同步密码通过数据库函数读写，实现多设备同步

### 配置 Supabase
1. SQL Editor 里运行 [supabase/schema.sql](supabase/schema.sql)
2. 再单独运行文件末尾那句设置同步密码的 SQL（填你自己的密码，不要提交到仓库）
3. 网站设置里填同步密码

### 截图识别
在设置里填 [Anthropic API Key](https://console.anthropic.com/settings/keys)。请求从浏览器直接发往 Anthropic API。
