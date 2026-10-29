# Supabase

云同步用的数据库。表对外完全关闭，网页和各应用只能调用 `mc_*` 函数：网页凭同步密码，书屿、Plexus、Steamless、FoodCollection 凭配对时拿到的设备令牌。

## 执行迁移

在 Supabase Dashboard → **SQL Editor** 里，**按编号顺序**把 `migrations/` 下的文件整段粘贴运行。每个文件都可以重复运行，已经执行过的再运行一次也没关系。

| 文件 | 内容 |
|---|---|
| [001_base.sql](migrations/001_base.sql) | 收藏、同步密码、共享设置、截图（原来的 `schema.sql`） |
| [002_wish_hub.sql](migrations/002_wish_hub.sql) | 心愿中枢：接口版本、密码失败次数限制、已配对的设备、已拥有记录、应用拉取和添加心愿 |
| [003_shots.sql](migrations/003_shots.sql) | 原截图双向同步：已配对的应用凭设备令牌上传、读取心愿的原截图 |
| [004_foodcollection.sql](migrations/004_foodcollection.sql) | 可以给 FoodCollection（Mac 上的「今天吃什么」）配对：只读写「餐厅」，吃过的店回报「已拥有」 |
| [005_agent_delete.sql](migrations/005_agent_delete.sql) | 已配对的设备里可以删除已吊销的记录 |

想知道已经执行到哪一个，运行：

```sql
select * from public.mc_migrations order by name;
```

## 设置 / 修改同步密码

第一次使用时，在 SQL Editor 里**单独**运行下面这句（把中文换成你的密码，建议 12 位以上），**不要保存到仓库里的任何文件**：

```sql
insert into public.mc_secret (id, hash) values (1, extensions.crypt('你的密码', extensions.gen_salt('bf', 10)))
on conflict (id) do update set hash = excluded.hash;
```

同步密码连续输错 10 次，所有用密码的操作会锁定 15 分钟（已配对的设备不受影响）。确实是自己输错、等不及时，可以在 SQL Editor 里解锁：

```sql
select setval('public.mc_check_locked', 1);
```

## 函数一览

| 函数 | 谁用 | 作用 |
|---|---|---|
| `mc_api_version()` | 各应用 | 接口版本（现在是 2），低于应用需要的版本时提示先执行新的迁移 |
| `mc_pull` / `mc_push` | 网页 | 拉取、推送全部收藏，`updatedAt` 较新者胜出 |
| `mc_agent_create(p_pass, name, app)` | 网页 | 生成配对码（只显示这一次），`app` 是 `shuyu` / `plexus` / `steamless` |
| `mc_agent_list` / `mc_agent_revoke` | 网页 | 查看、吊销已配对的设备 |
| `mc_wishes(p_token, categories, since)` | 应用 | 增量拉取自己负责的分类（书屿：小说；Plexus：电影、电视剧；Steamless：游戏），包含已删除的条目 |
| `mc_wish_put(p_token, item)` | 应用 | 应用里「添加想看」直接写进中枢，只能写自己负责的分类 |
| `mc_fulfill_put(p_token, rows)` | 应用 | 回报「已拥有」：匹配到的东西和跳转链接 |
| `mc_agent_put_image(p_token, id, data)` | 应用 | 上传原截图（图片 data URL，最大 4 MB），心愿的 `shots` 里记它的 id |
| `mc_agent_get_image(p_token, id)` | 应用 | 读取原截图，只给自己负责的分类里心愿用到的图 |
| `mc_fulfill_pull(p_pass)` | 网页 | 读取所有「已拥有」记录 |
| `mc_fulfill_reject(p_pass, item_id, app)` | 网页 | 「不是这个」：应用以后跳过这个匹配，换成别的匹配时会重新提示 |

## 测试

迁移在 [PGlite](https://pglite.dev)（编译成 WASM 的 Postgres）里测试，不会连接任何 Supabase 项目：

```bash
npm ci
npm test
```
