# 公网部署说明

## 推荐：完全免费（GitHub Pages + 公共服务器打洞）
游戏网页放在 GitHub Pages（免费）。联机时用免费的公共 MQTT 服务器（EMQX 国内节点优先）配对，
双方优先 **P2P 打洞直连**；打不通时自动改由公共服务器转发，照样能玩。不需要买服务器、不需要域名。

### 步骤（一次性，约 10 分钟）
1. 注册/登录 GitHub，右上角 **+ → New repository**，名字随意（如 `sgkards`），选 **Public**，创建。
2. 把整个游戏文件夹上传进仓库：
   - 最省事：安装 **GitHub Desktop**，Clone 这个空仓库，把游戏文件夹里的所有文件复制进去，Commit → Push。
   - 或网页上传：仓库页面 **Add file → Upload files**，拖入文件（网页一次最多 100 个文件，`assets/cards` 里图片较多，分两三次拖）。
   - 注意保留文件夹结构（`index.html` 要在仓库根目录）。
3. 仓库 **Settings → Pages**：Source 选 **Deploy from a branch**，Branch 选 `main` / `(root)`，Save。
4. 等 1–2 分钟，页面顶部会显示网址：`https://你的用户名.github.io/sgkards/`。发给朋友，手机电脑直接打开即可。
5. 以后改了游戏，重新上传覆盖文件即可自动更新。

### 联机怎么用
「人人对战 → 公网联机 → 创建房间」，把房间号或邀请链接（二维码）发给朋友，对方打开即自动加入。
进入对局后若提示「已打洞成功，P2P 直连」说明是直连；没提示就是经公共服务器转发，同样可玩。

### 须知
- 公共 MQTT 服务器是免费测试服务，没有服务保障；偶尔连不上时换个时间或刷新重试。
- 经公共服务器转发的消息理论上他人可见（只含对局数据，不含任何个人信息）。
- `github.io` 在国内一般能访问，个别地区偶尔较慢。

---

## 进阶：自有服务器（可选）

游戏本身是纯网页，联机依赖 `server.js`（Node.js，无第三方依赖）提供的"房间中转"：
双方浏览器都只和服务器通信，不需要端口转发，也不依赖 P2P 打洞，手机流量下同样可用。

## 方案 A：一台轻量云服务器（推荐）
1. 买一台最低配的轻量服务器（1 核 1G 足够）。香港/海外机房免备案；国内机房若要绑定域名需 ICP 备案。
2. 安装 Node.js 18+，把整个游戏文件夹上传到服务器，例如 `/opt/sgkards`。
3. 启动：
   ```bash
   cd /opt/sgkards
   HOST=0.0.0.0 PORT=8088 node server.js
   ```
   云控制台的防火墙/安全组放行 8088 端口。朋友访问 `http://服务器IP:8088/` 即可。
4. 常驻运行（systemd 示例，保存为 `/etc/systemd/system/sgkards.service`）：
   ```ini
   [Unit]
   Description=SanGuo KARDS
   After=network.target
   [Service]
   WorkingDirectory=/opt/sgkards
   Environment=HOST=127.0.0.1 PORT=8088
   ExecStart=/usr/bin/node server.js
   Restart=always
   [Install]
   WantedBy=multi-user.target
   ```
   `systemctl enable --now sgkards`
5. （可选）有域名时用 Caddy 自动 HTTPS，Caddyfile 只需一行：
   ```
   game.example.com {
       reverse_proxy 127.0.0.1:8088
   }
   ```

## 方案 B：页面放免费静态托管 + 服务器只做中转
页面放到 Cloudflare Pages / Vercel / Netlify 等，服务器只跑 `server.js` 并设置
`CORS_ORIGIN=https://你的页面域名`。页面里「联机服务器地址」填服务器地址，
或邀请链接自动带上 `?server=...`。注意：静态页若是 https，服务器也必须是 https。

## 说明
- 房间数据只在内存里，重启服务即清空；房间 15 分钟无活动自动回收。
- 公网模式默认不公开房间列表（`ROOM_LIST=1` 可开启），只能凭房间号/邀请链接加入。
- `server.js` 只提供游戏文件，读取范围限制在游戏文件夹内，不提供服务端源码与脚本。
