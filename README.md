# 🎵 天天爱听 · 南岭典藏版，音乐播放软件，支持alist，本地，http曲库

一款功能丰富的 Web 音乐播放器，支持本地音乐库、**AList 远程存储、等多种来源。可浏览器直接运行**，也可通过 Electron 打包为桌面应用。

<img src="https://i.postimg.cc/pr99XLWm/1.jpg" width="300" style="zoom: 300%;" >
<img src="https://i.postimg.cc/yYT80RDm/2.jpg" width="300" style="zoom:300%;" >
<img src="https://i.postimg.cc/CL4xb8RH/3.jpg" width="300" style="zoom:300%;" >
<img src="https://i.postimg.cc/c4cLf3vX/4.jpg" width="300" style="zoom:300%;" >
<img src="https://i.postimg.cc/Z5KKHq3q/5.jpg" width="300" style="zoom:300%;" >
<img src="https://i.postimg.cc/MpPZF8bK/6.jpg" width="300" style="zoom:300%;" >

<img src="https://i.postimg.cc/50wHHNDn/1000008697.jpg" width="300" style="zoom:150%;" >
<img src="https://i.postimg.cc/Y9144qT8/1000008698.jpg" width="300" style="zoom:150%;" >
<img src="https://i.postimg.cc/264qq8gG/1000008699.jpg" width="300" style="zoom:150%;" >







# 🏷架构设计

[![213.jpg](https://i.postimg.cc/bNFvwtd3/213.jpg)](https://postimg.cc/nCBxdM4D)



## ✨ 

### 🎶 多来源播放
- **HTTP 文件目录** — 直接扫描 Nginx / Apache 等静态文件服务
- **AList 存储** — 对接 AList 网盘聚合，支持目录浏览与搜索
- **本地文件** —本地目录可以直接添加目录播放

### 🎤 歌词支持
- **多平台搜索** — 网易云音乐，目前只支持这个
- **内嵌歌词** — 自动解析 MP3 (ID3v2)、FLAC、M4A 文件中的内嵌歌词
- **歌词评论区** — 查看歌曲热门评论与回复

### 🎨 主题系统
内置 30+ 主题，涵盖经典 Winamp、iTunes、网易云、QQ 音乐等风格

### ✨ 视觉效果
- **频谱可视化** — 多种频谱样式（柱状、光柱、纹理、声纹等）
- **动态特效** — 樱花飘落、雪花、星空、深海、极光等 16+ 特效
- 全支持背景透明叠加，不影响歌词阅读

### 📱 响应式设计
同时支持桌面端与移动端布局

## 🚀 快速开始

### 浏览器直接打开

```bash
# 克隆仓库
git clone https://github.com/zhaojiang1994/TTloveMusic.git
cd ttplayer-nanling

# 用任意 HTTP 服务器托管
# Python
python3 -m http.server 8080

# Node.js (npx)
npx serve .

# 浏览器打开 http://localhost:8080/mc.html
```

### 安卓版
使用根目录的js,css,mg.html，放入安卓打包目录中,注意！apk省电行为要设置为无限制或者高优先级，不然会导致后台无法播放
```bash
npm run build
```


### Electron 桌面版

```bash
npm install
npm start         # 启动开发版
npm run build     # 打包为 exe / dmg
```

### 添加音乐来源

1. 点击左下角 ⚙️ **管理来源**
2. 添加：
   - **HTTP 目录**：输入文件服务器的根 URL（需开启目录列表）                http://192.xx.xx.xx/mm/
   - **AList**：选择协议为 `alist`，输入 AList 地址、用户名和密码          http://192.xx.xx.xx/mm/
   
### 配置歌词服务

1. 点击顶栏 🎤 **歌词服务** 按钮
2. 选择歌词提供平台（现在使用的,）
3. 配置 API 地址（可使用公共 API 或自行部署）

> 默认网易云 API：`http://fn.xiaom.xxxx:3066`
> 可替换为自行部署的 [NeteaseCloudMusicApi服务仓库](https://github.com/neteasecloudmusicapienhanced/api-enhanced)

>docker方式部署，这是一个开源项目，目前只支持一种歌词方案

```yaml
services:
  alist:
    image: xhofe/alist:v3.39.1
    container_name: alist
    restart: always
    ports:
      - "5244:5244"
    volumes:
      - ./:/opt/alist/data
    environment:
      - TZ=Asia/Shanghai
```

>这里是alist [alist开源仓库](https://github.com/AlistGo/alist)
```yaml


version: '3.8'

services:
  ncm-api:
    image: moefurina/ncm-api:latest
    container_name: netease-music-api
    restart: always
    ports:
      - "3066:3066"                    # 映射到宿主机的3066
    environment:
      - NODE_ENV=production
      - PORT=3066                      # 关键：告诉容器内部用3066端口
      - DISABLE_AUTH=true              # 禁用认证（如果有）
    volumes:
      - ./data:/app/data
```


## 📁 项目结构

```
ttplayer-nanling/
├── mc.html                 # 主页面
├── electron.js             # Electron 入口
├── preload.js              # Electron preload
├── package.json
├── css/
│   ├── base/               # 基础样式（reset、变量、布局）
│   ├── components/         # 组件样式（播放器、歌词、列表等）
│   └── themes/             # 30+ 主题样式
├── js/
│   ├── app/
│   │   ├── main.js         # 主入口逻辑
│   │   ├── player.js       # 播放器控制
│   │   ├── musicLibrary.js # 音乐库管理
│   │   ├── lyrics.js       # 歌词解析与渲染
│   │   ├── ui.js           # 列表渲染与事件
│   │   ├── themeLoader.js  # 主题加载
│   │   └── mobile.js       # 移动端适配
│   ├── lyrics-providers/   # 歌词搜索引擎
│   │   ├── netease.js      # 网易云音乐
│   │   ├── kugou.js        # 酷狗音乐
│   │   ├── qqmusic.js      # QQ 音乐
│   │   ├── qishui.js       # 汽水音乐
│   │   ├── provider-base.js
│   │   └── provider-manager.js
│   ├── effects/            # 视觉特效
│   │   ├── fx-sakura.js    # 樱花
│   │   ├── fx-snow.js      # 雪花
│   │   ├── fx-starField.js # 星空
│   │   └── ...             # 更多特效
│   └── spectrum/           # 频谱可视化
└── README.md
```

## ⚙️ 技术栈

- 原生 JavaScript（无框架依赖）
- HTML5 Audio + MediaSource API（流式播放）
- IndexedDB（歌曲库缓存）
- CSS3 变量（动态主题切换）
- Electron（桌面打包）
- Canvas（频谱与特效渲染）

## 🐛 常见问题
待收集


### Q: 如何更换歌词 API？




## 📜 许可

MIT
