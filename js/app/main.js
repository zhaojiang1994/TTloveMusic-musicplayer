// main.js - 主入口（修复搜索、翻页、多来源）
document.addEventListener('DOMContentLoaded', function() {
    // DOM元素
    var audio = document.getElementById('audioPlayer');
    var playPauseBtn = document.getElementById('playPauseBtn');
    var prevBtn = document.getElementById('prevBtn');
    var nextBtn = document.getElementById('nextBtn');
    var progressBar = document.getElementById('progressBar');
    var currentTimeSpan = document.getElementById('currentTime');
    var durationSpan = document.getElementById('duration');
    var volumeCtrl = document.getElementById('volumeCtrl');
    var currentSongTitleSpan = document.getElementById('currentSongTitle');
    var currentSongArtistSpan = document.getElementById('currentSongArtist');
    var listContainer = document.getElementById('listContainer');
    var searchInput = document.getElementById('searchInput');
    var viewAllBtn = document.getElementById('viewAllBtn');
    var viewFolderBtn = document.getElementById('viewFolderBtn');
    var viewFavBtn = document.getElementById('viewFavBtn');
    var fontSlider = document.getElementById('fontSlider');
    var fontVal = document.getElementById('fontVal');
    var lyricsBox = document.getElementById('lyricsBox');
    var effectSelect = document.getElementById('effectSelect');
    var lyricsBg = document.getElementById('lyricsBgEffect');

    // 全局变量
    var currentPlaylist = [];
    var currentIndex = 0;
    window.currentIndex = 0;
    var currentViewMode = 'all';
    var currentFolderPath = '';
    var allSongsMaster = [];
    window.allSongsMaster = allSongsMaster;
    window.isPlaying = false;
    window.favoriteSet = new Set();
    window.playSongByIndex = null;  // 在函数定义后赋值

    // 加载收藏
    try {
        var saved = JSON.parse(localStorage.getItem('ttplayer-fav') || '[]');
        saved.forEach(function(s) { window.favoriteSet.add(s); });
    } catch(e) {}
    var favoriteSet = window.favoriteSet;

    function toggleFavorite(src, fromDom) {
        if (favoriteSet.has(src)) favoriteSet.delete(src);
        else favoriteSet.add(src);
        localStorage.setItem('ttplayer-fav', JSON.stringify(Array.from(favoriteSet)));
        // 标记收藏视图为脏，下次切换时重新渲染
        if (typeof markViewDirty === 'function') markViewDirty('fav');
        // 直接更新DOM上的图标，不刷新整个列表（卡顿原因）
        if (fromDom) {
            var icon = fromDom.querySelector('.fav-icon i');
            if (icon) {
                icon.className = favoriteSet.has(src) ? 'fas fa-heart' : 'far fa-heart';
            }
            // 收藏视图直接移除行
            if (currentViewMode === 'fav' && fromDom.parentNode) {
                fromDom.remove();
                // 检查是否为空（用已缓存的 listContainer，避免重复查询 DOM）
                var listArea = listContainer;
                if (listArea && listArea.querySelectorAll('.song-item').length === 0) {
                    listArea.innerHTML = '<div style="padding:40px;text-align:center;opacity:0.5;"><i class="fas fa-heart" style="font-size:2rem;display:block;margin-bottom:10px;"></i>还没有收藏歌曲<br>点击歌曲旁的 ♡ 添加收藏</div>';
                }
            }
        }
    }
    window.toggleFavorite = toggleFavorite;
    var searchTimer = null;

    // 懒加载
    var lazyObserver = null;
    var pendingTaskIndices = new Set();
    var debounceTimer = null;
    var isProcessingQueue = false;

    // 清理旧的 localStorage 缓存，迁移到 IndexedDB
    try { localStorage.removeItem('MUSIC_LIBRARY_CACHE'); } catch(e) {}

    // 视图容器（全部歌曲 / 文件夹各一个，切换时只隐藏/显示不重新渲染）
    var _viewContainers = {};
    function _getViewContainer(mode) {
        if (!_viewContainers[mode]) {
            var el = document.createElement('div');
            el.className = 'view-panel';
            el.style.display = 'none';
            el.style.height = '100%';
            el.style.overflowY = 'auto';   // ← 原有的
            el.style.setProperty('overflow-y', 'auto', 'important');  // ← 加这行，强制覆盖
            listContainer.appendChild(el);
            _viewContainers[mode] = el;
        }
        return _viewContainers[mode];
    }
    function _showViewContainer(mode) {
        Object.keys(_viewContainers).forEach(function(m) {
            if (_viewContainers[m]) _viewContainers[m].style.display = (m === mode) ? '' : 'none';
        });
    }
    var _dirtyViews = {};
    function markViewDirty(mode) { _dirtyViews[mode] = true; }
    window.markViewDirty = markViewDirty;

    // ----- IndexedDB 歌曲缓存（异步不卡主线程） -----
    var DB_NAME = 'MusicLibraryDB';
    var DB_VERSION = 1;
    var STORE_NAME = 'songs';
    var _db = null;

    function openDB() {
        return new Promise(function(resolve, reject) {
            if (_db) { resolve(_db); return; }
            if (!window.indexedDB) { reject(new Error('IndexedDB不支持')); return; }
            var req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = function(e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'src' });
                }
            };
            req.onsuccess = function(e) {
                _db = e.target.result;
                resolve(_db);
            };
            req.onerror = function(e) {
                reject(e.target.error);
            };
        });
    }

    function saveToCache(songs) {
        openDB().then(function(db) {
            var tx = db.transaction(STORE_NAME, 'readwrite');
            var store = tx.objectStore(STORE_NAME);
            store.clear();
            songs.forEach(function(song) { store.put(song); });
            return tx.complete;
        }).catch(function(e) {
            // IndexedDB 失败时 fallback 到 localStorage
            try { localStorage.setItem('MUSIC_LIBRARY_CACHE', JSON.stringify({ data: songs })); } catch(e2) {}
        });
    }

    function loadFromCache() {
        return new Promise(function(resolve) {
            openDB().then(function(db) {
                var tx = db.transaction(STORE_NAME, 'readonly');
                var store = tx.objectStore(STORE_NAME);
                var req = store.getAll();
                req.onsuccess = function() { resolve(req.result); };
                req.onerror = function() { resolve(null); };
            }).catch(function() {
                // fallback localStorage
                try {
                    var str = localStorage.getItem('MUSIC_LIBRARY_CACHE');
                    resolve(str ? JSON.parse(str).data : null);
                } catch(e) { resolve(null); }
            });
        });
    }

    // ----- 记忆功能：保存/恢复播放状态、字体、音量 -----
    function savePlayState() {
        try {
            var song = currentPlaylist[currentIndex];
            var state = {
                index: currentIndex,
                src: song ? song.src : '',
                currentTime: audio ? audio.currentTime : 0,
                isPlaying: window.isPlaying,
                volume: audio ? audio.volume : 0.7,
                fontSize: fontSlider ? fontSlider.value : 20,
                viewMode: currentViewMode,
                folderPath: currentFolderPath,
                allPage: _allSongsPageState ? _allSongsPageState.currentPage : 1,
                folderPage: _folderPageState ? _folderPageState.currentPage : 1,
                // 当前歌曲的全局序号和页码，用于精确恢复
                songPageNo: currentIndex + 1,
                songPage: _allSongsPageState ? _allSongsPageState.currentPage : 1
            };
            localStorage.setItem('PLAY_STATE', JSON.stringify(state));
        } catch(e) {}
    }

    function loadPlayState() {
        try {
            var str = localStorage.getItem('PLAY_STATE');
            if (!str) return null;
            return JSON.parse(str);
        } catch(e) { return null; }
    }

    // 定时保存播放状态（每5秒）
    // 列表滚动时保存
    if (listContainer) {
        listContainer.addEventListener('scroll', function() {
            clearTimeout(window._scrollSave);
            window._scrollSave = setTimeout(savePlayState, 300);
        });
    }

    // 播放状态保存（脏标记，只在有关键变化时写 localStorage）
    var _stateDirty = true;
    function _markStateDirty() { _stateDirty = true; }
    function _flushState() { if (_stateDirty) { savePlayState(); _stateDirty = false; } }
    var _flushTimer = setInterval(_flushState, 15000);
    // 播放中每 10 秒标记脏
    var _lastSavePos = 0;
    audio.addEventListener('timeupdate', function() {
        if (window.isPlaying && Math.abs(audio.currentTime - _lastSavePos) > 10) {
            _lastSavePos = audio.currentTime;
            _markStateDirty();
        }
    });
    window.addEventListener('beforeunload', function() { savePlayState(); if (_flushTimer) clearInterval(_flushTimer); });

    // 持久时长缓存（独立于 allSongsMaster，跨文件夹导航不丢失）
    var _durationCache = JSON.parse(localStorage.getItem('_durationCache') || '{}');
    function _saveDurationCache() {
        try { localStorage.setItem('_durationCache', JSON.stringify(_durationCache)); } catch(e) {}
    }

    // 更新歌曲时长的 DOM、allSongsMaster 和持久缓存
    function updateSongDurationUI(s, index) {
        _durationCache[s.src] = { duration: s.duration };
        _saveDurationCache();
        // 写 allSongsMaster（连同 _durationTried 一起持久化到 IndexedDB）
        var master = allSongsMaster.find(function(m) {
            return s._alistFilePath ? m._alistFilePath === s._alistFilePath : m.src === s.src;
        });
        if (master) { master.duration = s.duration; master._durationTried = true; }
        // 节流写回 IndexedDB（最长 3 秒一次）
        if (!window._saveTimer) {
            window._saveTimer = setTimeout(function() {
                window._saveTimer = null;
                saveToCache(allSongsMaster);
            }, 3000);
        }
        // 更新 DOM（逐级查找：data-index → data-src → 视图容器 → 全文档）
        var node = listContainer.querySelector('.song-item[data-index="' + index + '"]');
        if (!node) node = listContainer.querySelector('.song-item[data-src="' + s.src + '"]');
        if (!node) {
            for (var _vm in _viewContainers) {
                node = _viewContainers[_vm].querySelector('.song-item[data-index="' + index + '"]');
                if (node) break;
            }
        }
        if (!node) node = document.querySelector('.song-item[data-index="' + index + '"]');
        if (node) {
            var dSpan = node.querySelector('.song-duration');
            if (dSpan) dSpan.innerText = s.duration;
        }
    }

    // 一次性请求 200KB 文件头解析时长（不先试 8KB，一步到位）
    function _fetchDurationFromHead(url, totalFileSize) {
        return fetch(url, { headers: { 'Range': 'bytes=0-204799' } }).then(function(res) {
            if (res.status === 416 || !res.ok) return '--:--';
            var totalSize = totalFileSize || 0;
            var cr = res.headers.get('Content-Range');
            if (!totalSize && cr) { var m = cr.match(/\/(\d+)$/); if (m) totalSize = parseInt(m[1]); }
            return res.arrayBuffer().then(function(buf) {
                if (buf.byteLength < 4) return '--:--';
                return _parseDurationByFormat(buf, totalSize, false, url);
            });
        }).catch(function() { return '--:--'; });
    }
    // 按格式解析时长
    function _parseDurationByFormat(buf, totalFileSize, isMp4, fallbackUrl) {
        if (!fallbackUrl) return '--:--';
        if (isMp4) {
            var pm = parseAudioDuration(buf);
            if (pm && pm > 0) return formatTimeStatic(pm);
            return '--:--';
        }
        var p = parseAudioDuration(buf);
        if (p && p > 0) return formatTimeStatic(p);
        var d = _parseMp3Duration(buf, totalFileSize);
        return d >= 0 ? formatTimeStatic(d) : '--:--';
    }
    // MP3 时长解析：ID3 TLEN → Xing/Info → VBRI → 多帧平均
    function _parseMp3Duration(buf, totalFileSize) {
        // ① ID3v2 TLEN 帧（毫秒字符串）
        try {
            var view = new DataView(buf);
            if (buf.byteLength >= 10 && view.getUint8(0) === 0x49 && view.getUint8(1) === 0x44 && view.getUint8(2) === 0x33) {
                var id3Sz = ((view.getUint8(6) & 0x7F) << 21) | ((view.getUint8(7) & 0x7F) << 14) | ((view.getUint8(8) & 0x7F) << 7) | (view.getUint8(9) & 0x7F);
                var id3End = Math.min(10 + id3Sz, buf.byteLength);
                var id3Pos = 10;
                while (id3Pos + 10 <= id3End) {
                    var fid = String.fromCharCode(view.getUint8(id3Pos), view.getUint8(id3Pos+1), view.getUint8(id3Pos+2), view.getUint8(id3Pos+3));
                    var fsz = ((view.getUint8(id3Pos+4) & 0x7F) << 21) | ((view.getUint8(id3Pos+5) & 0x7F) << 14) | ((view.getUint8(id3Pos+6) & 0x7F) << 7) | (view.getUint8(id3Pos+7) & 0x7F);
                    if (fid === 'TLEN' && fsz > 0 && fsz < 32) {
                        var tlenStr = '';
                        for (var ti = 0; ti < fsz; ti++) tlenStr += String.fromCharCode(view.getUint8(id3Pos + 10 + ti));
                        var ms = parseInt(tlenStr, 10);
                        if (ms > 0) return ms / 1000;
                    }
                    id3Pos += 10 + fsz;
                }
            }
        } catch(e) {}
        // ② Xing/Info 头（已有但可能漏 CRC/备用偏移）
        var xing = parseAudioDuration(buf);
        if (xing && xing > 0) return xing;
        // ③ VBRI 头
        try {
            if (buf.byteLength >= 4) {
                var offV = 0;
                if (view.getUint8(0) === 0x49 && view.getUint8(1) === 0x44 && view.getUint8(2) === 0x33) {
                    var id3SzV = ((view.getUint8(6) & 0x7F) << 21) | ((view.getUint8(7) & 0x7F) << 14) | ((view.getUint8(8) & 0x7F) << 7) | (view.getUint8(9) & 0x7F);
                    offV = 10 + id3SzV;
                }
                while (offV + 4 < buf.byteLength) {
                    if (view.getUint8(offV) === 0xFF && (view.getUint8(offV + 1) & 0xE0) === 0xE0) break;
                    offV++;
                }
                if (offV + 36 + 8 <= buf.byteLength) {
                    var tagV = String.fromCharCode(view.getUint8(offV + 36), view.getUint8(offV + 37), view.getUint8(offV + 38), view.getUint8(offV + 39));
                    if (tagV === 'VBRI') {
                        var vbrFrames = view.getUint32(offV + 36 + 10);
                        var vbrSrIdx = view.getUint16(offV + 36 + 14); // not reliable
                        // use the first frame's sample rate
                        var hV = view.getUint32(offV);
                        var verV = (hV >> 19) & 0x3;
                        var srIdxV = (hV >> 10) & 0x3;
                        if (srIdxV !== 3) {
                            var srV = (verV === 3) ? [44100,48000,32000][srIdxV] : [22050,24000,16000][srIdxV];
                            var spfV = (verV === 3) ? 1152 : 576;
                            if (vbrFrames > 0 && srV > 0) return (vbrFrames * spfV) / srV;
                        }
                    }
                }
            }
        } catch(e) {}
        // ④ 无任何 meta 头 → 返回 -1
        return -1;
    }
    function formatTimeStatic(seconds) {
        var mins = Math.floor(seconds / 60);
        var secs = Math.floor(seconds % 60);
        return (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs;
    }

    // 重新登录 AList 并刷新 token（供 processBatchQueue 和 loadAListDir 共用）
    async function _renewAListToken(srcKey) {
        return await AListAPI.renewToken(srcKey);
    }

    // 限流并发队列
    async function processBatchQueue() {
        if (isProcessingQueue || pendingTaskIndices.size === 0) return;
        isProcessingQueue = true;
        var indices = Array.from(pendingTaskIndices);
        for (var _ri = 0; _ri < indices.length; _ri++) pendingTaskIndices.delete(indices[_ri]);
        var pool = [];

        for (var i = 0; i < indices.length; i++) {
            var idx = indices[i];
            var song = currentPlaylist[idx];
            if (!song || (song.duration && song.duration !== '--:--')) continue;
            // 检查持久缓存
            var cached = _durationCache[song.src] || _durationCache[song.source + '::' + (song._alistFilePath || '')];
            if (cached && cached.duration && cached.duration !== '--:--') {
                song.duration = cached.duration;
                song._durationTried = true;
                updateSongDurationUI(song, idx);
                continue;
            }
            if (pool.length >= 6) await Promise.race(pool);

            (function(s, index) {
                var task;
                if (s._alistFile || s._checkedFile) {
                    task = (async function() {
                        try {
                            var srcKey = s.sourceId || s.source || '';
                            var source = null;
                            var sources = typeof getMusicSources === 'function' ? getMusicSources() : [];
                            for (var si = 0; si < sources.length; si++) {
                                if (sources[si].id === srcKey || sources[si].url === srcKey) { source = sources[si]; break; }
                            }
                            if (!source || !s._alistFilePath) { s.duration = '--:--'; return; }
                            var result = await AListAPI.getFileInfo(source, s._alistFilePath);
                            if (result && result.code === 200 && result.data && result.data.raw_url) {
                                var dur = await _fetchDurationFromHead(result.data.raw_url, result.data.size);
                                s.duration = dur;
                            } else { s.duration = '--:--'; }
                        } catch(e) { s.duration = '--:--'; }
                        s._durationTried = true;
                        updateSongDurationUI(s, index);
                    })();
                } else {
                    task = _fetchDurationFromHead(s.src).then(function(dur) {
                        s.duration = dur;
                        s._durationTried = true;
                        updateSongDurationUI(s, index);
                    });
                }
                task.catch(function() {}).then(function() {
                    var ti = pool.indexOf(task);
                    if (ti >= 0) pool.splice(ti, 1);
                });
                pool.push(task);
            })(song, idx);
        }

        await Promise.all(pool);
        isProcessingQueue = false;
        saveToCache(allSongsMaster);
        if (pendingTaskIndices.size > 0) processBatchQueue();
    }

    function initLazyLoading() {
        if (lazyObserver) lazyObserver.disconnect();
        lazyObserver = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                var idx = parseInt(entry.target.dataset.index);
                if (entry.isIntersecting) {
                    var song = currentPlaylist[idx];
                    if (song && !song._durationTried && (!song.duration || song.duration === '--:--')) {
                        pendingTaskIndices.add(idx);
                    }
                } else {
                    pendingTaskIndices.delete(idx);
                }
            });
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(processBatchQueue, 400);
        }, { root: listContainer, rootMargin: '0px', threshold: 0.5 });

        listContainer.querySelectorAll('.song-item').forEach(function(item) {
            lazyObserver.observe(item);
        });
    }

    // 切歌
    function onPlayNext(direction) {
        var newIdx;
        if (direction === 'next') newIdx = (currentIndex + 1) % currentPlaylist.length;
        else newIdx = (currentIndex - 1 + currentPlaylist.length) % currentPlaylist.length;
        playSongByIndex(newIdx);
    }

    // 后台续播：页面不可见时记录待切歌，回来后再执行
    var _pendingNext = false;
    window._bgPlayNext = function() {
        // 页面可见 → 直接切
        if (!document.hidden) {
            onPlayNext('next');
            return;
        }
        // 页面不可见（后台/锁屏）→ 等用户回来
        if (_pendingNext) return;
        _pendingNext = true;
        var _onVisible = function() {
            if (document.hidden) return;
            document.removeEventListener('visibilitychange', _onVisible);
            _pendingNext = false;
            onPlayNext('next');
        };
        document.addEventListener('visibilitychange', _onVisible);
    };

    async function playSongByIndex(idx) {
        if (idx < 0 || idx >= currentPlaylist.length) return;
        // 切歌时清空歌词、重置进度条
        if (lyricsBox) lyricsBox.innerHTML = '';
        if (progressBar) { progressBar.value = 0; progressBar.style.setProperty('--pct', '0%'); }
        try { audio.currentTime = 0; } catch(e) {}
        // 监听 audio 真实时长后写回列表（处理手动解析不到时长的歌曲）
        if (window._oldDurHandler) audio.removeEventListener('durationchange', window._oldDurHandler);
        var _durHandler = function() {
            var _s = currentPlaylist[currentIndex];
            if (_s && audio.duration && isFinite(audio.duration) && audio.duration > 1) {
                var _ds = formatTimeStatic(audio.duration);
                if (_s.duration !== _ds) { _s.duration = _ds; _s._durationTried = true; updateSongDurationUI(_s, currentIndex); }
            }
        };
        window._oldDurHandler = _durHandler;
        audio.addEventListener('durationchange', _durHandler);
        var song = currentPlaylist[idx];
        // 取消上一个 MediaSource 流
        if (_msAbort) { _msAbort.abort(); _msAbort = null; }
        if (_msUrl) { try { URL.revokeObjectURL(_msUrl); } catch(e) {} _msUrl = null; }
        // 播放时暂停时长加载，释放连接给播放用（不清 pendingTaskIndices，旧 index 越界后自动跳过）
        isProcessingQueue = true;
        setTimeout(function() { isProcessingQueue = false; }, 2000);

        // AList 目录 → 查找来源信息后加载
        if (song && song._alistDir && typeof getMusicSources === 'function') {
            var _ss = getMusicSources();
            for (var _sii = 0; _sii < _ss.length; _sii++) {
                if (_ss[_sii].id === song.sourceId || _ss[_sii].url === song.source) {
                    _alistPathStack.push(song._alistPath);
                    currentFolderPath = song._alistPath.replace(/^\//, '');
                    loadAListDir(_ss[_sii], song._alistPath); break;
                }
            }
            return;
        }
        // AList 或勾选文件 → 获取直链播放
        if (song && (song._alistFile || song._checkedFile)) {
            currentIndex = idx; window.currentIndex = idx;
            currentSongTitleSpan.innerText = song.name;
            currentSongArtistSpan.innerText = song.artist || '';
            highlightCurrentSong(listContainer, allSongsMaster, currentIndex);
            // 歌词由 alistPlayFile 拿到直链后处理
            alistPlayFile(song._alistFilePath, song._checkedToken || song._alistToken, song._checkedBaseUrl || song._alistBaseUrl, song.sourceId || song.source || '');
            return;
        }

        currentIndex = idx; window.currentIndex = idx;
        song = currentPlaylist[currentIndex];

        // 先更新界面文字，不等播放成功
        currentSongTitleSpan.innerText = song.name;
        currentSongArtistSpan.innerText = song.artist;



        // 立即高亮（不等播放）
        highlightCurrentSong(listContainer, allSongsMaster, currentIndex);

        // HTTP / 本地文件也走 MediaSource 流式播放
        if (song.src && song.src.indexOf('://') > 0 && !song.src.startsWith('file://')) {
            streamPlay(song.src, song);
        } else {
            // 先清空 src 重置音频元素状态（提高后台续播成功率）
            audio.removeAttribute('src');
            audio.load();
            audio.src = song.src;
            // 不主动调 load()——让浏览器自动加载，部分浏览器绕过后台自动播放拦截
            try {
                await audio.play();
                window.isPlaying = true;
                updatePlayButton(playPauseBtn, true);
                if (typeof readEmbeddedLyrics === 'function') {
                    readEmbeddedLyrics(song, lyricsBox).then(function(lrc) {
                        if (lrc && typeof parseLrcToArray === 'function') {
                            var arr = parseLrcToArray(lrc);
                            if (arr.length > 0 && typeof displayLyrics === 'function') displayLyrics(arr, lyricsBox, audio);
                        }
                    }).catch(function() {});
                }
            } catch(e) {
                // 第一次失败 → 带 load() 重试一次
                try {
                    audio.load();
                    await audio.play();
                    window.isPlaying = true;
                    updatePlayButton(playPauseBtn, true);
                } catch(e2) {
                    console.error('播放失败:', e2);
                }
            }
        }
        savePlayState();
    }
    window.playSongByIndex = playSongByIndex;
    window.fetchRealSongMeta = fetchRealSongMeta;

    // MediaSource 统一流式播放（HTTP / AList 通用）
    function streamPlay(url, song) {
        // 清理上一个 MediaSource
        if (_msUrl) { try { URL.revokeObjectURL(_msUrl); } catch(e) {} _msUrl = null; }
        if (_msAbort) { _msAbort.abort(); _msAbort = null; }
        var ac = new AbortController();
        _msAbort = ac;
        // 下载首个 256KB 解析元数据 + 获取 Content-Range（ID3 标签一般 <100KB）
        fetch(url, { headers: { 'Range': 'bytes=0-262143' }, signal: ac.signal }).then(function(r) {
            if (!r.ok) throw new Error('fetch failed');
            var totalSize = 0;
            var cr = r.headers.get('Content-Range');
            if (cr) { var m = cr.match(/\/(\d+)$/); if (m) totalSize = parseInt(m[1]); }
            return r.arrayBuffer().then(function(buf) {
                return { buf: buf, totalSize: totalSize };
            });
        }).then(function(res) {
            if (ac.signal.aborted) return;
            var buf = res.buf;
            var totalSize = res.totalSize;
            // Content-Range 被 CORS 挡住时退回到直接播放（但仍解析元数据）
            if (!totalSize) {
                // 解析元数据
                var _meta2 = null;
                if (buf.byteLength >= 10 && typeof parseID3v2Metadata === 'function') {
                    _meta2 = parseID3v2Metadata(new Uint8Array(buf));
                }
                if (song && _meta2) {
                    console.log('🎵 ID3解析 → 歌名: ' + (_meta2.title || '无') + ' 歌手: ' + (_meta2.artist || '无'));
                    if (_meta2.title) { song.name = _meta2.title; currentSongTitleSpan.innerText = _meta2.title; }
                    if (_meta2.artist) { song.artist = _meta2.artist; currentSongArtistSpan.innerText = _meta2.artist; }
                    if (_meta2.lyrics && typeof parseLrcToArray === 'function') {
                        var _ar2 = parseLrcToArray(_meta2.lyrics);
                        if (_ar2.length > 0 && typeof displayLyrics === 'function') { displayLyrics(_ar2, lyricsBox, audio); console.log('📝 内嵌歌词: ' + (_meta2.title || song.name)); }
                    }
                }
                // 无内嵌歌词 → 用真实歌名搜索网络
                if (_meta2 && !_meta2.lyrics && typeof window.fetchLyricsFromProvider === 'function') {
                    window.fetchLyricsFromProvider(_meta2.title || (song ? song.name : ''), _meta2.artist || (song ? song.artist : '')).then(function(nl) {
                        if (nl && typeof parseLrcToArray === 'function') {
                            var _nla2 = parseLrcToArray(nl);
                            if (_nla2.length > 0 && typeof displayLyrics === 'function') { displayLyrics(_nla2, lyricsBox, audio); console.log('📝 网络歌词: ' + (_meta2.title || song.name)); }
                        }
                    }).catch(function(){});
                }
                audio.oncanplay = null; audio.onerror = null;
                audio.src = url; audio.load();
                audio.play().then(function() { window.isPlaying = true; updatePlayButton(playPauseBtn, true); }).catch(function(){});
                return;
            }
            // 解析 ID3 元数据
            var meta = null;
            var audioStart = 0;
            if (buf.byteLength >= 10) {
                var dv = new Uint8Array(buf);
                if (String.fromCharCode(dv[0],dv[1],dv[2]) === 'ID3') {
                    var id3sz = ((dv[6] & 0x7F) << 21) | ((dv[7] & 0x7F) << 14) | ((dv[8] & 0x7F) << 7) | (dv[9] & 0x7F);
                    audioStart = id3sz + 10;
                }
                if (typeof parseID3v2Metadata === 'function') meta = parseID3v2Metadata(new Uint8Array(buf));
            }
            if (meta) console.log('🎵 ID3解析 → 歌名: ' + (meta.title || '无') + ' 歌手: ' + (meta.artist || '无'));
            // 更新歌曲信息
            if (song) {
                if (meta && meta.title) { song.name = meta.title; currentSongTitleSpan.innerText = meta.title; }
                if (meta && meta.artist) { song.artist = meta.artist; currentSongArtistSpan.innerText = meta.artist; }
            }
            // 创建 MediaSource + 播放（在 ms.onsourceopen 准备好数据后再 play，避免浏览器时序问题）
            var ms = new MediaSource();
            var msUrl = URL.createObjectURL(ms);
            _msUrl = msUrl;
            audio.oncanplay = null; audio.onerror = null;
            audio.src = msUrl; audio.load();
            var sb = null;
            var fetchedBytes = 0;

            function _fallbackDirectPlay() {
                URL.revokeObjectURL(msUrl);
                audio.src = url; audio.load();
                audio.play().then(function() { window.isPlaying = true; updatePlayButton(playPauseBtn, true); }).catch(function(){});
                if (song && typeof window.fetchLyricsFromProvider === 'function') {
                    window.fetchLyricsFromProvider(song.name, song.artist || '').then(function(nl) {
                        if (nl && typeof parseLrcToArray === 'function') {
                            var _nla = parseLrcToArray(nl);
                            if (_nla.length > 0 && typeof displayLyrics === 'function') displayLyrics(_nla, lyricsBox, audio);
                        }
                    }).catch(function(){});
                }
            }

            ms.onsourceopen = function() {
                try { sb = ms.addSourceBuffer('audio/mpeg'); } catch(e) {
                    try { sb = ms.addSourceBuffer('audio/mp4'); } catch(e2) {
                        console.warn('streamPlay: MediaSource 不支持该音频格式，回退直接播放', e2);
                        _fallbackDirectPlay();
                        return;
                    }
                }
                // 根据文件总大小设 MediaSource 时长（进度条一开始就显示正确范围）
                var estDur = (totalSize - audioStart) / 16000;
                if (estDur > 10) ms.duration = estDur;
                // 去掉 ID3 头，只喂音频数据
                var audioData = audioStart > 0 ? buf.slice(audioStart) : buf;
                fetchedBytes = buf.byteLength;
                try {
                    sb.appendBuffer(audioData);
                } catch(e) {
                    console.warn('streamPlay: 初始 appendBuffer 失败，回退直接播放', e);
                    _fallbackDirectPlay();
                    return;
                }
                // 数据已入 SourceBuffer，开始播放
                audio.play().then(function() {
                    window.isPlaying = true;
                    updatePlayButton(playPauseBtn, true);
                    if (meta && meta.lyrics && typeof parseLrcToArray === 'function') {
                        var _ar = parseLrcToArray(meta.lyrics);
                        if (_ar.length > 0 && typeof displayLyrics === 'function') { displayLyrics(_ar, lyricsBox, audio); console.log('📝 内嵌歌词: ' + (meta.title || song.name)); return; }
                    }
                    var _sn = (meta && meta.title) ? meta.title : (song ? song.name : '');
                    var _sa = (meta && meta.artist) ? meta.artist : (song ? song.artist : '');
                    if (typeof window.fetchLyricsFromProvider === 'function') {
                        window.fetchLyricsFromProvider(_sn, _sa).then(function(nl) {
                            if (nl && typeof parseLrcToArray === 'function') {
                                var _nla = parseLrcToArray(nl);
                                if (_nla.length > 0 && typeof displayLyrics === 'function') { displayLyrics(_nla, lyricsBox, audio); console.log('📝 网络歌词: ' + _sn); }
                            }
                        }).catch(function(){});
                    }
                }).catch(function(err) {
                    console.warn('streamPlay: play() 失败，回退直接播放', err);
                    _fallbackDirectPlay();
                });
                sb.onupdateend = function() {
                    if (fetchedBytes >= totalSize || ac.signal.aborted) {
                        try { if (ms.readyState === 'open') ms.endOfStream(); } catch(e) {}
                        return;
                    }
                    // 继续下载剩余数据
                    var end = Math.min(fetchedBytes + 262144, totalSize);
                    fetch(url, { headers: { 'Range': 'bytes=' + fetchedBytes + '-' + (end - 1) }, signal: ac.signal }).then(function(r2) {
                        if (!r2.ok) return;
                        return r2.arrayBuffer();
                    }).then(function(chunk) {
                        if (chunk && !ac.signal.aborted) {
                            fetchedBytes = end;
                            try {
                                sb.appendBuffer(chunk);
                            } catch(e) {
                                console.warn('streamPlay: 追加分片失败，停止流式播放', e);
                            }
                        }
                    }).catch(function(err) {
                        console.warn('streamPlay: 下载分片失败', err);
                    });
                };
            };
        }).catch(function(e) {
            // fallback: 直接播放
            if (e.name === 'AbortError') return;
            audio.src = url; audio.load(); audio.play().then(function() { window.isPlaying = true; updatePlayButton(playPauseBtn, true); }).catch(function(){});
            // 歌词
            if (song && typeof window.fetchLyricsFromProvider === 'function') {
                window.fetchLyricsFromProvider(song.name, song.artist || '').then(function(nl) {
                    if (nl && typeof parseLrcToArray === 'function') {
                        var _nla = parseLrcToArray(nl);
                        if (_nla.length > 0 && typeof displayLyrics === 'function') displayLyrics(_nla, lyricsBox, audio);
                    }
                }).catch(function(){});
            }
        });
    }
    var _msAbort = null;
    var _msUrl = null;

    // 从 URL 读取文件头，获取真实歌名/歌手/内嵌歌词（所有来源通用）
    async function fetchRealSongMeta(url) {
        try {
            var _h = await fetch(url, { headers: { 'Range': 'bytes=0-9' } });
            if (!_h.ok) return null;
            var _hb = await _h.arrayBuffer();
            if (_hb.byteLength < 10) return null;
            var _hv = new Uint8Array(_hb);
            var _sig = String.fromCharCode(_hv[0],_hv[1],_hv[2],_hv[3]);
            var _need, _isFlac = false, _isMp4 = false;
            if (_sig === 'ID3') { _need = (((_hv[6] & 0x7F) << 21) | ((_hv[7] & 0x7F) << 14) | ((_hv[8] & 0x7F) << 7) | (_hv[9] & 0x7F)) + 10; }
            else if (_sig === 'fLaC') { _need = 204800; _isFlac = true; }
            else if (_hv[4]===0x66 && String.fromCharCode(_hv[4],_hv[5],_hv[6],_hv[7])==='ftyp') { _need = 409600; _isMp4 = true; }
            if (!_need || _need < 1 || _need > 2097152) return null;
            var _d = await fetch(url, { headers: { 'Range': 'bytes=0-' + (_need - 1) } });
            if (!_d.ok) return null;
            var _db = await _d.arrayBuffer();
            var _dd = new Uint8Array(_db);
            if (_isFlac && typeof parseFlacVorbisForLyrics === 'function') {
                var _l = parseFlacVorbisForLyrics(_dd);
                return { title: null, artist: null, lyrics: _l };
            }
            if (_isMp4 && typeof parseMp4ForLyrics === 'function') {
                var _l = parseMp4ForLyrics(_dd);
                return { title: null, artist: null, lyrics: _l };
            }
            if (typeof parseID3v2Metadata === 'function') {
                return parseID3v2Metadata(_dd);
            }
        } catch(e) {}
        return null;
    }

    // 刷新列表
// refreshList 函数优化版
    var _lazyLoaded = false;
    // 在函数外部定义
    var previousSearchText = '';

    async function refreshList(restoreScroll) {
        _lazyLoaded = false;
        var searchText = searchInput ? searchInput.value : '';
        var container = _getViewContainer(currentViewMode);
        var savedScroll = restoreScroll !== undefined ? restoreScroll : container.scrollTop;

        // 在这里查询search接口获取所有符合搜索的歌曲集合数据
        if (searchText !== previousSearchText) {  // ✅ 改为普通变量
            if (searchText) {
                var _searchSrc = null;
                var _allSrcs = typeof getMusicSources === 'function' ? getMusicSources() : [];
                for (var _asi = 0; _asi < _allSrcs.length; _asi++) {
                    if (_allSrcs[_asi].protocol === 'alist') {
                        _searchSrc = _allSrcs[_asi];
                        break;
                    }
                }
                if (_searchSrc) {
                    var sr = await searchAListDir(searchText, _searchSrc, '/');
                    var flistSet = new Set();
                    sr.forEach(function(item) {
                        var path = '/' + item.parent.split('/').filter(Boolean).slice(3).join('/');
                        flistSet.add(path);
                    });
                    window._alistSearchResults = Array.from(flistSet);
                }
            } else {
                window._alistSearchResults = [];  // 清空搜索时清除结果缓存
            }
            previousSearchText = searchText;  // ✅ 更新保存的搜索词
        }

        // ✅ 此时搜索已经完成，window._alistSearchResults 是最新值
        var newContent = renderList(allSongsMaster, searchText, currentViewMode, currentFolderPath, window._alistSearchResults);

        container.replaceChildren(newContent);
        _showViewContainer(currentViewMode);
        _dirtyViews[currentViewMode] = false;

        // 恢复滚动位置
        if (restoreScroll !== undefined && restoreScroll >= 0) {
            // 传入歌曲 index → 找到对应行元素滚动过去
            var scrollToSong = function() {
                var el = container.querySelector('.song-item[data-index="' + restoreScroll + '"]');
                if (el) {
                    el.scrollIntoView({ block: 'start' });
                }
            };
            scrollToSong();
            requestAnimationFrame(scrollToSong);
        } else if (restoreScroll === undefined) {
            // 普通刷新：恢复 replaceChildren 之前的滚动位置
            var setScroll = function() {
                container.scrollTop = Math.min(savedScroll, container.scrollHeight - container.clientHeight);
            };
            setScroll();
        }

        attachSongEvents(container, allSongsMaster, playSongByIndex, function(type, path, sourceUrl) {
            if (type === 'back') {
                currentFolderPath = '';
                _folderPageState.currentPage = 1;
                refreshList();
                return;
            }

            // AList 懒加载：按 ID 或 URL 匹配来源
            if (sourceUrl && typeof getMusicSources === 'function') {
                var sources = getMusicSources();
                var src = null;
                for (var si = 0; si < sources.length; si++) {
                    if (sources[si].id === sourceUrl || sources[si].url === sourceUrl) {
                        src = sources[si];
                        break;
                    }
                }
                if (src && src.protocol === 'alist') {
                    _alistPathStack.push('/' + path);
                    loadAListDir(src, '/' + path);
                    return;
                }
            }

            currentFolderPath = path;
            _folderPageState.currentPage = 1;
            refreshList();
        });

        // 每次视图切换都重新初始化懒加载（监听新视图的 song-item）
        if (container.querySelector('.song-item')) {
            initLazyLoading();
        }
        highlightCurrentSong(container, allSongsMaster, currentIndex);
    }
    // ===== AList 懒加载：只负责填充 allSongsMaster，渲染全靠 refreshList =====
    var _alistDirCache = {};  // 目录缓存：sourceKey::dirPath → {items, dirPath, folderName, newSongs}
    var _alistCacheKeys = [];  // 缓存键顺序（用于淘汰最旧条目）
    var MAX_ALIST_CACHE = 30;  // 最多缓存 30 个目录
    var _alistCurrentSource = null;
    var _globalMs = null;
    var _globalSb = null;
    var _globalMsUrl = null;
    var _globalAppendNext = null;  // 由每次新歌设置，onupdateend 调用
    var _alistPathStack = [];        // 目录浏览路径栈，用于逐层返回

    async function loadAListDir(source, dirPath) {
        _alistCurrentSource = source;
        var fc = _getViewContainer('folder');
        fc.innerHTML = '<div style="padding:40px;text-align:center;opacity:0.7;"><i class="fas fa-spinner fa-pulse" style="font-size:1.5rem;display:block;margin-bottom:10px;"></i>加载中...</div>';

        // 获取 token
        var baseUrl = source.url.replace(/\/+$/, '');
        var token = '';
        try { token = await AListAPI.getToken(source); } catch(e) { _showToast('❌ AList 连接失败'); return; }

        // 检查缓存
        var _cacheKey = (source.id || source.url || '') + '::' + dirPath;
        if (_alistDirCache[_cacheKey] && _alistDirCache[_cacheKey].items) {
            var cached = _alistDirCache[_cacheKey];
            // 直接用缓存渲染
            allSongsMaster = allSongsMaster.filter(function(s) {
                return s.source !== source.url || (!s._alistDir && !s._alistFile);
            });
            allSongsMaster = allSongsMaster.concat(cached.newSongs);
            currentPlaylist = allSongsMaster.slice();
            window.allSongsMaster = allSongsMaster;
            renderAListGrid(cached.dirPath, cached.folderName, source, cached.newSongs);
            return;
        }

        // 列目录
        var items = [];
        try {
            var result = await AListAPI.listDir(source, dirPath);
            if (!result || result.code !== 200 || !result.data || !result.data.content) {
                _showToast('❌ ' + ((result && result.message) || '加载失败'));
                return;
            }
            items = result.data.content;
        } catch(e) {
            _showToast('❌ 加载失败');
            return;
        }
        // 获取 token 用于条目存储（播放时需要）
        try { token = await AListAPI.getToken(source); } catch(e) {}

        // renderAListGrid 中会调用 _showViewContainer，此处不用重复调用
        // 转成歌曲对象，注入 allSongsMaster
        var folderName = dirPath === '/' ? '' : dirPath.split('/').filter(Boolean).pop();
        // 完整路径（去掉开头/），用于过滤匹配
        var folderPath = dirPath === '/' ? '' : dirPath.replace(/^\//, '');
        var idPrefix = source.url.replace(/[^a-zA-Z0-9]/g, '_') + '_' + (folderName || 'root');
        var newSongs = [];

        items.forEach(function(item, idx) {
            if (item.is_dir) {
                var subFolderPath = dirPath === '/' ? item.name : folderPath + '/' + item.name;
                newSongs.push({
                    name: item.name, artist: '📁', src: baseUrl + '/api/fs/get',
                    folder: item.name,
                    _fullFolderPath: subFolderPath,
                    source: source.url, sourceName: source.name, sourceId: source.id || '',
                    isDefault: false, duration: '',
                    _alistDir: true,
                    _alistPath: dirPath === '/' ? '/' + item.name : dirPath + '/' + item.name,
                    _alistToken: token,
                    _alistBaseUrl: baseUrl
                });
            } else if (item.name && item.name.match(/\.(mp3|flac|wav|aac|ogg|m4a|mp4|mkv|avi)$/i)) {
                var sn = item.name.replace(/\.[^/.]+$/, '');
                var artist = folderName || source.name;
                var title = sn;
                if (sn.indexOf(' - ') > 0) {
                    var p = sn.split(' - ');
                    // 智能判断：如果文件夹名匹配后半段 → 歌名-歌手格式
                    var p0 = p[0].trim();
                    var p1 = p.slice(1).join(' - ').trim();
                    // 常见命名规则：静夜 - 周杰伦（歌名-歌手）或 周杰伦 - 静夜（歌手-歌名）
                    // 通过文件夹名判断：若文件夹含后半段 → 歌名-歌手；含前半段 → 歌手-歌名
                    if (folderName && folderName.indexOf(p1) >= 0) {
                        title = p0; artist = p1;    // 歌名 - 歌手
                    } else if (folderName && folderName.indexOf(p0) >= 0) {
                        artist = p0; title = p1;    // 歌手 - 歌名
                    } else {
                        title = p0; artist = p1;    // 默认歌名-歌手（更常见）
                    }
                }
                newSongs.push({
                    id: idPrefix + '_' + idx, name: title, artist: artist,
                    src: 'alist://cache/' + encodeURIComponent(dirPath === '/' ? '/' + item.name : dirPath + '/' + item.name),
                    folder: folderName || 'root',
                    _fullFolderPath: folderPath || 'root',
                    source: source.url, sourceName: source.name, sourceId: source.id || '',
                    isDefault: false,
                    duration: '--:--',  // 播放后通过 audio.onloadedmetadata 获取真实时长
                    _alistFile: true,
                    _alistFilePath: dirPath === '/' ? '/' + item.name : dirPath + '/' + item.name,
                    _alistToken: token,
                    _alistBaseUrl: baseUrl
                });
            }
        });

        // 从持久时长缓存中继承（兼容 src 和 source::path 两种 key）
        newSongs.forEach(function(ns) {
            var cached = _durationCache[ns.src] || _durationCache[ns.source + '::' + ns._alistFilePath];
            if (cached && cached.duration && cached.duration !== '--:--') {
                ns.duration = cached.duration;
                ns._durationTried = true;
            }
        });

        // 注入 allSongsMaster（供切歌用），渲染走 renderAListGrid（返回受控）
        allSongsMaster = allSongsMaster.filter(function(s) {
            return s.source !== source.url || (!s._alistDir && !s._alistFile);
        });
        allSongsMaster = allSongsMaster.concat(newSongs);
        currentPlaylist = allSongsMaster.slice();
        window.allSongsMaster = allSongsMaster;
        // 写入目录缓存（下次直接使用，不重复请求 API）
        if (!_alistDirCache[_cacheKey]) {
            _alistCacheKeys.push(_cacheKey);
            // 超过上限时淘汰最旧的缓存
            if (_alistCacheKeys.length > MAX_ALIST_CACHE) {
                var oldKey = _alistCacheKeys.shift();
                delete _alistDirCache[oldKey];
            }
        }
        _alistDirCache[_cacheKey] = { items: items, dirPath: dirPath, folderName: folderName, newSongs: newSongs };
        renderAListGrid(dirPath, folderName, source, newSongs);
    }

    // AList 文件夹内部视图：子目录格子 + 文件列表
    function renderAListGrid(dirPath, folderName, source, songs) {
        var wrapper = document.createElement('div');
        wrapper.className = 'folder-view-container';

        // 导航栏
        var navBar = document.createElement('div');
        navBar.className = 'folder-navigation-bar';
        navBar.innerHTML = '<div class="folder-item back-item" data-alist="back"><i class="fas fa-chevron-left"></i> 返回</div>' +
            '<div class="folder-path-indicator">📁 ' + escapeHtml(folderName || source.name) + '</div>';
        wrapper.appendChild(navBar);

        // 子目录格子
        var dirs = songs.filter(function(s) { return s._alistDir; });
        // AList 搜索结果过滤：只显示 flist 中可达的子目录
        var flist = window._alistSearchResults;
        if (flist && flist.length > 0) {
            dirs = dirs.filter(function(s) {
                return flist.some(function(fp) { return fp.indexOf(s._alistPath) === 0; });
            });
        }
        if (dirs.length > 0) {
            var grid = document.createElement('div');
            grid.className = 'folder-grid-wrapper';
            dirs.forEach(function(s) {
                var tpl = getTemplate('template-folder-item');
                if (!tpl) return;
                var el = tpl.firstElementChild;
                el.dataset.alist = 'dir';
                el.dataset.alistPath = s._alistPath;
                el.dataset.source = source.id || source.url || '';
                var fullPath = s._alistPath.replace(/^\//, '');
                el.dataset.path = fullPath;
                tpl.querySelector('.folder-name-scroll').textContent = s.name;
                var folderKey = (source.id || source.url || '') + '::' + fullPath;
                if (window._checkedFolders && window._checkedFolders.has(folderKey)) {
                    el.classList.add('checked');
                    var cbIcon = tpl.querySelector('.folder-checkbox i');
                    if (cbIcon) cbIcon.className = 'fas fa-check-square';
                }
                grid.appendChild(tpl);
            });
            wrapper.appendChild(grid);
        }

        // 文件列表
        var files = songs.filter(function(s) { return s._alistFile; });
        // 搜索过滤：只展示匹配搜索框文字的文件
        var searchInput = document.getElementById('searchInput');
        var kw = searchInput ? searchInput.value.trim().toLowerCase() : '';
        if (kw) {
            files = files.filter(function(s) {
                return (s.name && s.name.toLowerCase().indexOf(kw) >= 0) ||
                    (s.artist && s.artist.toLowerCase().indexOf(kw) >= 0);
            });
        }
        if (files.length > 0) {
            var listEl = document.createElement('div');
            listEl.className = 'normal-songs-wrapper';
            files.forEach(function(s, fi) {
                var tpl = getTemplate('template-song-item');
                if (!tpl) return;
                var el = tpl.firstElementChild;
                el.dataset.alist = 'file';
                el.dataset.alistFile = s._alistFilePath;
                el.dataset.src = s.src;
                var _globalIdx = allSongsMaster.indexOf(s);
                if (_globalIdx < 0) {
                    for (var _z = 0; _z < allSongsMaster.length; _z++) {
                        if (allSongsMaster[_z].src === s.src) { _globalIdx = _z; break; }
                    }
                }
                if (_globalIdx >= 0) el.dataset.index = _globalIdx;
                el.querySelector('.song-index').textContent = fi + 1;
                el.querySelector('.artist-text').textContent = s.artist || '未知歌手';
                el.querySelector('.song-name').textContent = s.name;
                el.querySelector('.song-duration').textContent = s.duration || '--:--';
                // 收藏图标
                var favIcon = tpl.querySelector('.fav-icon i');
                if (favIcon && window.favoriteSet) {
                    favIcon.className = window.favoriteSet.has(s.src) ? 'fas fa-heart' : 'far fa-heart';
                }
                el.style.cursor = 'pointer';
                listEl.appendChild(tpl);
            });
            wrapper.appendChild(listEl);
        }

        if (dirs.length === 0 && files.length === 0) {
            wrapper.innerHTML += '<div class="empty-list"><i class="fas fa-folder-open"></i> 空目录</div>';
        }

        var fc = _getViewContainer('folder');
        fc.replaceChildren(wrapper);
        // 高亮当前播放的歌曲（如果在这个目录中）
        if (typeof highlightCurrentSong === 'function') {
            highlightCurrentSong(fc, allSongsMaster, currentIndex);
        }

        // 懒加载时长（靠 IntersectionObserver + processBatchQueue，滑动防抖 + 3并发）
        _lazyLoaded = false;
        initLazyLoading();

        // 事件委托
        listContainer.onclick = function(e) {
            var t = e.target;

            // 勾选框点击
            var checkboxEl = t.closest('.folder-checkbox');
            if (checkboxEl) {
                e.stopPropagation();
                var folderItem = checkboxEl.closest('[data-alist="dir"]');
                if (!folderItem) return;
                var srcKey = folderItem.dataset.source || '';
                var path = folderItem.dataset.path || '';
                var folderKey = srcKey + '::' + path;
                if (!window._checkedFolders) window._checkedFolders = new Set();

                // 7 秒防抖：只对「未勾选→勾选」生效
                if (!window._checkedFolders.has(folderKey)) {
                    if (!window._checkTimers) window._checkTimers = {};
                    var last = window._checkTimers[folderKey] || 0;
                    if (Date.now() - last < 7000) return;
                    window._checkTimers[folderKey] = Date.now();
                }

                if (window._checkedFolders.has(folderKey)) {
                    // 取消勾选 — 无限制
                    window._checkedFolders.delete(folderKey);
                    if (typeof window.saveCheckedFolders === 'function') window.saveCheckedFolders();
                    folderItem.classList.remove('checked');
                    var cbIcon = checkboxEl.querySelector('i');
                    if (cbIcon) cbIcon.className = 'far fa-square';
                    if (typeof window.onFolderCheck === 'function') {
                        window.onFolderCheck(srcKey, path, false);
                    }
                } else {
                    // 勾选
                    window._checkedFolders.add(folderKey);
                    if (typeof window.saveCheckedFolders === 'function') window.saveCheckedFolders();
                    folderItem.classList.add('checked');
                    var cbIcon = checkboxEl.querySelector('i');
                    if (cbIcon) cbIcon.className = 'fas fa-check-square';
                    if (typeof window.onFolderCheck === 'function') {
                        window.onFolderCheck(srcKey, path, true);
                    }
                    // 级联勾选：如果所有同级子目录都已勾，勾上父目录并递归向上
                    var siblingPaths = dirs.map(function(d) {
                        return d._alistPath.replace(/^\//, '');
                    });
                    _cascadeCheck(srcKey || (source.id || source.url || ''), siblingPaths);
                }
                return;
            }

            var backBtn = t.closest('[data-alist="back"]');
            if (backBtn) {
                _alistBack();
                return;
            }
            var dirItem = t.closest('[data-alist="dir"]');
            if (dirItem) {
                _alistPathStack.push(dirItem.dataset.alistPath);
                currentFolderPath = dirItem.dataset.alistPath.replace(/^\//, '');
                loadAListDir(source, dirItem.dataset.alistPath);
                return;
            }
            var fileItem = t.closest('[data-alist="file"]');
            if (fileItem && fileItem.dataset.src) {
                var _alistFp = fileItem.dataset.alistFile || '';
                // 优先按 _alistFilePath 从后往前找（最新添加的优先）
                for (var _msi = allSongsMaster.length - 1; _msi >= 0; _msi--) {
                    if (allSongsMaster[_msi]._alistFilePath === _alistFp) { playSongByIndex(_msi); break; }
                }
            }
        };
    }


    // AList 搜索：调用 AList /api/fs/search 接口
    async function searchAListDir(keyword, source, dirPath) {
        if (!source || !source.auth || !keyword) return null;
        try {
            var result = await AListAPI.search(source, dirPath, keyword);
            if (!result || result.code !== 200 || !result.data) return [];
            var items = result.data.content || result.data;
            if (!Array.isArray(items)) items = [items];
            return items;
        } catch(e) { return null; }
    }


    // AList 返回：逐层返回
    function _alistBack() {
        _alistPathStack.pop();  // 弹出当前路径
        var prevPath = _alistPathStack[_alistPathStack.length - 1];
        if (prevPath && _alistCurrentSource) {
            // 还有上层 AList 目录 → 加载上一层
            currentFolderPath = prevPath === '/' ? '' : prevPath.replace(/^\//, '');
            loadAListDir(_alistCurrentSource, prevPath);
        } else {
            // 回到根 → 从缓存恢复各来源根目录，显示多来源文件夹视图
            _alistPathStack = [];
            var src = _alistCurrentSource;
            if (src) {
                // 清理该源的子目录条目
                allSongsMaster = allSongsMaster.filter(function(s) {
                    return s.source !== src.url || (!s._alistDir && !s._alistFile);
                });
                // 从缓存恢复该来源的根目录数据
                var _rootKey = (src.id || src.url || '') + '::/';
                if (_alistDirCache[_rootKey]) {
                    allSongsMaster = allSongsMaster.concat(_alistDirCache[_rootKey].newSongs);
                }
                currentPlaylist = allSongsMaster.slice();
                window.allSongsMaster = allSongsMaster;
            }
            currentViewMode = 'folder';
            currentFolderPath = '';
            if (viewFolderBtn) viewFolderBtn.classList.add('active');
            if (viewAllBtn) viewAllBtn.classList.remove('active');
            if (viewFavBtn) viewFavBtn.classList.remove('active');
            refreshList();
        }
    }

    // AList 递归加载目录歌曲（子目录延迟1秒，过滤已勾选，歌曲去重）
    async function loadAListDirSongs(source, dirPath, onProgress) {
        var baseUrl = source.url.replace(/\/+$/, '');
        var token = '';
        try { token = await AListAPI.getToken(source); } catch(e) { return []; }

        var allSongs = [];
        var dirQueue = [dirPath];
        var srcKey = source.id || source.url || '';
        // 进度统计
        var _progFolders = 0, _progSongs = 0;
        function _reportProgress() {
            if (typeof onProgress === 'function') onProgress(_progFolders, _progSongs);
        }

        while (dirQueue.length > 0) {
            var currentDir = dirQueue.shift();
            _progFolders++;
            _reportProgress();
            try {
                var result = await AListAPI.listDir(source, currentDir);
                if (!result || result.code !== 200 || !result.data || !result.data.content) continue;

                var folderName = currentDir.split('/').filter(Boolean).pop() || '';
                var folderPath = currentDir.replace(/^\//, '') || 'root';
                var idPrefix = source.url.replace(/[^a-zA-Z0-9]/g, '_') + '_' + (folderName || 'root');

                // 该目录下已存在的 _alistFilePath 集合（本批去重用）
                var existingPaths = new Set();
                allSongs.forEach(function(s) { if (s._alistFilePath) existingPaths.add(s._alistFilePath); });

                result.data.content.forEach(function(item, idx) {
                    if (item.is_dir) {
                        // 子目录：标记为已勾选，未加入过队列才加入
                        var subDirPath = currentDir === '/' ? '/' + item.name : currentDir + '/' + item.name;
                        var subFullPath = subDirPath.replace(/^\//, '');
                        var subKey = srcKey + '::' + subFullPath;
                        if (!window._checkedFolders) window._checkedFolders = new Set();
                        if (!window._checkedFolders.has(subKey)) {
                            window._checkedFolders.add(subKey);
                            if (typeof window.saveCheckedFolders === 'function') window.saveCheckedFolders();
                            dirQueue.push(subDirPath);
                        }
                    } else if (item.name && item.name.match(/\.(mp3|flac|wav|aac|ogg|m4a|mp4|mkv|avi)$/i)) {
                        // 歌曲：去重
                        var filePath = currentDir + '/' + item.name;
                        if (existingPaths.has(filePath)) return;
                        var sn = item.name.replace(/\.[^/.]+$/, '');
                        var artist = folderName || source.name;
                        var title = sn;
                        if (sn.indexOf(' - ') > 0) { var p = sn.split(' - '); artist = p[0]; title = p.slice(1).join(' - '); }
                        allSongs.push({
                            id: idPrefix + '_' + idx, name: title, artist: artist,
                            src: 'alist://cache/' + encodeURIComponent(filePath),
                            folder: folderName || 'root',
                            _fullFolderPath: folderPath,
                            source: source.url, sourceName: source.name, sourceId: source.id || '',
                            isDefault: false,
                            duration: '--:--',
                            _checkedFile: true,
                            _alistFilePath: filePath,
                            _checkedToken: token,
                            _checkedBaseUrl: baseUrl
                        });
                        _progSongs++;
                        _reportProgress();
                        existingPaths.add(filePath);
                    }
                });

                // 延迟1秒再处理下一个目录（避免请求太频繁被拉黑）
                if (dirQueue.length > 0) {
                    await new Promise(function(r) { setTimeout(r, 1000); });
                }
            } catch(e) {
                console.warn('[加载] 目录失败:', currentDir, e);
            }
        }
        return allSongs;
    }

    // 从文件头解析音频时长（支持 MP3/FLAC/WAV/M4A）
    function parseAudioDuration(data) {
        try {
            var view = new DataView(data);
            // --- FLAC --- 由浏览器 <audio> 原生解析，不手动计算
            if (view.getUint8(0) === 0x66 && view.getUint8(1) === 0x4C && view.getUint8(2) === 0x61 && view.getUint8(3) === 0x43) {
                return null;
            }
            // --- WAV ---
            if (view.getUint8(0) === 0x52 && view.getUint8(1) === 0x49 && view.getUint8(2) === 0x46 && view.getUint8(3) === 0x46) {
                // 找 fmt 子块拿采样率、通道数、位深；找 data 子块拿数据大小
                var offset = 12;
                while (offset + 8 < data.byteLength) {
                    var chunkId = String.fromCharCode(view.getUint8(offset), view.getUint8(offset+1), view.getUint8(offset+2), view.getUint8(offset+3));
                    var chunkSize = view.getUint32(offset + 4);
                    if (chunkId === 'fmt ' && chunkSize >= 16) {
                        var audioFormat = view.getUint16(offset + 8);
                        if (audioFormat !== 1 && audioFormat !== 0xFFFE) return null; // 仅 PCM
                        var channels = view.getUint16(offset + 10);
                        var sampleRate = view.getUint32(offset + 12);
                        var bitsPerSample = view.getUint16(offset + 22);
                        if (sampleRate === 0 || channels === 0 || bitsPerSample === 0) return null;
                        var bytesPerSec = sampleRate * channels * (bitsPerSample / 8);
                        if (bytesPerSec === 0) return null;
                        // 继续找 data 块
                        var dOff = offset + 8 + chunkSize;
                        if (dOff & 1) dOff++;
                        while (dOff + 8 < data.byteLength) {
                            var dId = String.fromCharCode(view.getUint8(dOff), view.getUint8(dOff+1), view.getUint8(dOff+2), view.getUint8(dOff+3));
                            var dSize = view.getUint32(dOff + 4);
                            if (dId === 'data' && dSize > 0) return dSize / bytesPerSec;
                            dOff += 8 + dSize;
                            if (dOff & 1) dOff++;
                        }
                    }
                    offset += 8 + chunkSize;
                    if (offset & 1) offset++;
                }
                return null;
            }
            // --- MP4/M4A ---
            if ((view.getUint8(4) === 0x66 && view.getUint8(5) === 0x74 && view.getUint8(6) === 0x79 && view.getUint8(7) === 0x70)) {
                // 遍历原子找 moov → mvhd
                var pos = 0;
                while (pos + 8 < data.byteLength) {
                    var atomSize = view.getUint32(pos);
                    var atomType = String.fromCharCode(view.getUint8(pos+4), view.getUint8(pos+5), view.getUint8(pos+6), view.getUint8(pos+7));
                    if (atomType === 'moov') {
                        // 在 moov 内找 mvhd
                        var inner = pos + 8;
                        while (inner + 8 < pos + atomSize && inner + 8 < data.byteLength) {
                            var innerSize = view.getUint32(inner);
                            var innerType = String.fromCharCode(view.getUint8(inner+4), view.getUint8(inner+5), view.getUint8(inner+6), view.getUint8(inner+7));
                            if (innerType === 'mvhd' && innerSize >= 32) {
                                var version = view.getUint8(inner + 8);
                                if (version === 0) {
                                    var timescale = view.getUint32(inner + 20);
                                    var duration = view.getUint32(inner + 24);
                                    if (timescale > 0 && duration > 0) return duration / timescale;
                                } else if (version === 1) {
                                    var timescale1 = view.getUint32(inner + 28);
                                    var duration1 = view.getUint32(inner + 32) * 0x100000000 + view.getUint32(inner + 36);
                                    if (timescale1 > 0 && duration1 > 0) return duration1 / timescale1;
                                }
                            }
                            inner += innerSize || 8;
                        }
                    }
                    pos += atomSize || 8;
                }
                return null;
            }
            // --- MP3 (已有) ---
            var offset3 = 0;
            if (view.getUint8(0) === 0x49 && view.getUint8(1) === 0x44 && view.getUint8(2) === 0x33) {
                var id3Size = ((view.getUint8(6) & 0x7F) << 21) | ((view.getUint8(7) & 0x7F) << 14) | ((view.getUint8(8) & 0x7F) << 7) | (view.getUint8(9) & 0x7F);
                offset3 = 10 + id3Size;
            }
            while (offset3 + 4 < data.byteLength) {
                if (view.getUint8(offset3) === 0xFF && (view.getUint8(offset3 + 1) & 0xE0) === 0xE0) break;
                offset3++;
            }
            if (offset3 + 4 >= data.byteLength) return null;
            var header = view.getUint32(offset3);
            var version = (header >> 19) & 0x3;
            var srIndex = (header >> 10) & 0x3;
            if (srIndex === 3) return null;
            var sampleRate = (version === 3) ? [44100, 48000, 32000][srIndex] : [22050, 24000, 16000][srIndex];
            var samplesPerFrame = (version === 3) ? 1152 : 576;
            // Xing/Info 偏移：4字节同步头 + (CRC?2:0) + 边信息
            var hasCRC = ((header >> 15) & 0x1) === 0;
            var sideInfoLen = version === 3 ? 32 : 17;
            var xingOffset = offset3 + 4 + (hasCRC ? 2 : 0) + sideInfoLen;
            if (xingOffset + 8 > data.byteLength) return null;
            var tag = String.fromCharCode(view.getUint8(xingOffset), view.getUint8(xingOffset+1), view.getUint8(xingOffset+2), view.getUint8(xingOffset+3));
            if (tag !== 'Xing' && tag !== 'Info') {
                // 少数编码器在备用偏移也有 Xing
                var altOff = xingOffset + 4;
                if (altOff + 8 <= data.byteLength) {
                    var tag2 = String.fromCharCode(view.getUint8(altOff), view.getUint8(altOff+1), view.getUint8(altOff+2), view.getUint8(altOff+3));
                    if (tag2 === 'Xing' || tag2 === 'Info') xingOffset = altOff;
                    else return null;
                } else return null;
            }
            var flags = view.getUint32(xingOffset + 4);
            var frameCount = (flags & 0x1) ? view.getUint32(xingOffset + 8) : 0;
            if (frameCount > 0) return (frameCount * samplesPerFrame) / sampleRate;
        } catch(e) {}
        return null;
    }

    var _alistAbort = null;  // 用于取消旧请求

    // AList 播放：获取直链后直接播放（不经过 MediaSource）
    async function alistPlayFile(filePath, token, baseUrl, srcKey) {
        console.log('🎵 alistPlayFile 被调用');
        if (_alistAbort) { _alistAbort.abort(); _alistAbort = null; }
        var ac = new AbortController();
        _alistAbort = ac;
        try {
            var res = await fetch(baseUrl + '/api/fs/get', {
                signal: ac.signal,
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': token },
                body: JSON.stringify({ path: filePath })
            });
            var result = await res.json();
            // token 过期 → 重新登录再试一次
            if (result.code === 401 && srcKey) {
                var newTok = await _renewAListToken(srcKey);
                if (newTok) {
                    var res2 = await fetch(baseUrl + '/api/fs/get', {
                        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': newTok },
                        body: JSON.stringify({ path: filePath })
                    });
                    result = await res2.json();
                }
            }
            if (result.code !== 200 || !result.data || !result.data.raw_url) {
                console.error('[播放] AList获取直链失败:', result?.message || 'raw_url为空');
                return;
            }
            var rawUrl = result.data.raw_url;
            if (currentPlaylist[currentIndex]) {
                currentPlaylist[currentIndex].src = rawUrl;
                if (allSongsMaster[currentIndex]) allSongsMaster[currentIndex].src = rawUrl;
            }
            // 直接播放，不经过 MediaSource（避免分片流断链导致的重播）
            audio.oncanplay = null; audio.onerror = null;
            audio.src = rawUrl;
            audio.load();
            try {
                await audio.play();
                window.isPlaying = true;
                updatePlayButton(playPauseBtn, true);
                // 歌词
                var _alistSong = currentPlaylist[currentIndex];
                if (_alistSong && typeof window.fetchLyricsFromProvider === 'function') {
                    window.fetchLyricsFromProvider(_alistSong.name, _alistSong.artist || '').then(function(nl) {
                        if (nl && typeof parseLrcToArray === 'function') {
                            var _alistLrc = parseLrcToArray(nl);
                            if (_alistLrc.length > 0 && typeof displayLyrics === 'function') displayLyrics(_alistLrc, lyricsBox, audio);
                        }
                    }).catch(function(){});
                }
            } catch(e) {
                // 重试一次（带 audio.load()）
                try {
                    audio.load();
                    await audio.play();
                    window.isPlaying = true;
                    updatePlayButton(playPauseBtn, true);
                    var _alistSong2 = currentPlaylist[currentIndex];
                    if (_alistSong2 && typeof window.fetchLyricsFromProvider === 'function') {
                        window.fetchLyricsFromProvider(_alistSong2.name, _alistSong2.artist || '').then(function(nl) {
                            if (nl && typeof parseLrcToArray === 'function') {
                                var _alistLrc2 = parseLrcToArray(nl);
                                if (_alistLrc2.length > 0 && typeof displayLyrics === 'function') displayLyrics(_alistLrc2, lyricsBox, audio);
                            }
                        }).catch(function(){});
                    }
                } catch(e2) {
                    console.error('[播放] AList播放失败:', e2);
                }
            }
        } catch(e) {}
    }

    window.refreshList = refreshList;
    // 从 localStorage 恢复已勾选的文件夹，并提供一个持久化函数
    try {
        var savedChecked = JSON.parse(localStorage.getItem('_checkedFolders') || '[]');
        window._checkedFolders = new Set(savedChecked);
    } catch(e) { window._checkedFolders = new Set(); }
    window.saveCheckedFolders = function() {
        try { localStorage.setItem('_checkedFolders', JSON.stringify(Array.from(window._checkedFolders))); } catch(e) {}
        // 勾选状态变了 → 标记视图脏（下次切过去重新渲染）
        if (typeof markViewDirty === 'function') { markViewDirty('all'); markViewDirty('folder'); }
    };
    // 简易 Toast 提示（不遮挡操作）
    function _showToast(msg) {
        var t = document.createElement('div');
        t.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99999;padding:12px 24px;border-radius:8px;background:rgba(30,30,30,0.92);color:#eee;font-size:13px;text-align:center;pointer-events:none;';
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(function() { if (t.parentNode) t.remove(); }, 2000);
    }

    window.initLibrary = null;

    // ===== 级联勾选/取消工具 =====
    // 获取某个目录在 _checkedFolders 中的直系子目录列表
    function _getDirectChildren(srcKey, parentPath) {
        var prefix = srcKey + '::' + (parentPath ? parentPath + '/' : '');
        var children = [];
        if (!window._checkedFolders) return children;
        window._checkedFolders.forEach(function(fk) {
            if (fk.indexOf(prefix) === 0) {
                var rest = fk.substring(prefix.length);
                // 直系子目录：路径中不能再有 /
                if (rest.indexOf('/') === -1) {
                    children.push(rest);
                }
            }
        });
        return children;
    }
    // 取消级联：子目录取消勾选时，父目录不再「全部子目录勾选」状态，一并取消
    function _cascadeUncheck(srcKey, folderPath) {
        if (!window._checkedFolders) return;
        var parts = folderPath.split('/');
        while (parts.length > 1) {
            parts.pop();
            var parentPath = parts.join('/');
            var parentKey = srcKey + '::' + parentPath;
            if (window._checkedFolders.has(parentKey)) {
                window._checkedFolders.delete(parentKey);
            } else {
                break; // 父目录本来就没勾，停止向上
            }
        }
    }
    // 勾选级联：给定一组同级目录路径，如果全部已勾，勾上父目录并递归向上
    function _cascadeCheck(srcKey, siblingPaths) {
        if (!window._checkedFolders || siblingPaths.length === 0) return;
        // 从第一个兄弟目录推导父路径
        var sample = siblingPaths[0];
        var lastSlash = sample.lastIndexOf('/');
        if (lastSlash <= 0) return; // 已经是根级
        var parentPath = sample.substring(0, lastSlash);
        var parentKey = srcKey + '::' + parentPath;
        // 检查所有兄弟是否都已勾
        var allIn = siblingPaths.every(function(sp) {
            var ck = srcKey + '::' + sp;
            return window._checkedFolders && window._checkedFolders.has(ck);
        });
        if (!allIn) return;
        // 勾上父目录
        window._checkedFolders.add(parentKey);
        if (typeof window.saveCheckedFolders === 'function') window.saveCheckedFolders();
        // 递归向上：检查祖父的所有直系子目录是否都已勾
        var grandLastSlash = parentPath.lastIndexOf('/');
        if (grandLastSlash <= 0) return; // 父目录已是根级，无上级
        var grandparentPath = parentPath.substring(0, grandLastSlash);
        var grandSiblings = _getDirectChildren(srcKey, grandparentPath);
        if (grandSiblings.length > 0) {
            var fullGrandPaths = grandSiblings.map(function(c) { return grandparentPath + '/' + c; });
            _cascadeCheck(srcKey, fullGrandPaths);
        }
    }

    // ===== 文件夹勾选回调：处理两种协议的加载 =====
    window.onFolderCheck = function(srcKey, folderPath, isChecked) {
        var sources = typeof getMusicSources === 'function' ? getMusicSources() : [];
        var source = null;
        for (var i = 0; i < sources.length; i++) {
            if (sources[i].id === srcKey || sources[i].url === srcKey) {
                source = sources[i]; break;
            }
        }

        if (isChecked) {
            if (!source) { return; }
            if (source.protocol === 'alist') {
                loadAListDirSongs(source, '/' + folderPath, function(folders, songs) {
                    // 首次有数据时才显示 toast
                    if (folders === 1 && typeof window.showScanToast === 'function') window.showScanToast();
                    if (typeof window.updateScanToast === 'function') window.updateScanToast(folders, songs);
                }).then(function(newSongs) {
                    if (newSongs && newSongs.length > 0) {
                        var existPaths = new Set();
                        allSongsMaster.forEach(function(s) { if (s._alistFilePath) existPaths.add(s._alistFilePath); });
                        var uniqueSongs = newSongs.filter(function(s) { return !existPaths.has(s._alistFilePath); });
                        allSongsMaster = allSongsMaster.concat(uniqueSongs);
                        window.allSongsMaster = allSongsMaster;
                        currentPlaylist = allSongsMaster.slice();
                        saveToCache(allSongsMaster);
                    }
                    if (typeof window.closeScanToast === 'function') window.closeScanToast();
                    // 更新当前可见的所有文件夹勾选图标
                    var checkIcons = document.querySelectorAll('.folder-checkbox i');
                    for (var ci = 0; ci < checkIcons.length; ci++) {
                        var icon = checkIcons[ci];
                        var folderItem = icon.closest('.folder-item.grid-box');
                        if (!folderItem) continue;
                        var sk = folderItem.dataset.source || '';
                        var p = folderItem.dataset.path || '';
                        var fk = sk + '::' + p;
                        if (window._checkedFolders && window._checkedFolders.has(fk)) {
                            folderItem.classList.add('checked');
                            icon.className = 'fas fa-check-square';
                        }
                    }
                    // 级联勾选：检查父目录是否应勾选
                    var lastSlash = folderPath.lastIndexOf('/');
                    if (lastSlash > 0) {
                        var parentPath = folderPath.substring(0, lastSlash);
                        var siblings = _getDirectChildren(srcKey, parentPath);
                        if (siblings.length > 0) {
                            var fullPaths = siblings.map(function(c) { return parentPath + '/' + c; });
                            _cascadeCheck(srcKey, fullPaths);
                        }
                    }
                }).catch(function() { if (typeof window.closeScanToast === 'function') window.closeScanToast(); });
            } else {
                // HTTP：统计并显示添加数量（递归匹配子目录）
                if (typeof window.closeScanToast === 'function') window.closeScanToast();
                var httpCount = allSongsMaster.filter(function(s) {
                    var sk = s.sourceId || s.source || '';
                    var matchPath = s._fullFolderPath || s.folder || '';
                    return sk === srcKey && (matchPath === folderPath || matchPath.indexOf(folderPath + '/') === 0);
                }).length;
                var _httpToast = document.createElement('div');
                _httpToast.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99998;padding:10px 24px;border-radius:8px;background:rgba(30,30,30,0.92);box-shadow:0 4px 16px rgba(0,0,0,0.5);text-align:center;pointer-events:none;';
                var _toastTextEl = document.createElement('div');
                _toastTextEl.id = 'httpToastText';
                _toastTextEl.style.cssText = 'font-size:13px;color:#eee;';
                _toastTextEl.innerHTML = '正在读取...';
                _httpToast.appendChild(_toastTextEl);
                document.body.appendChild(_httpToast);
                // 数字递增动画（从0计数到 httpCount）
                var _cur = 0;
                var _step = Math.max(1, Math.floor(httpCount / 4));
                var _httpTimer = setInterval(function() {
                    if (!_httpToast.parentNode) { clearInterval(_httpTimer); return; }
                    _cur = Math.min(httpCount, _cur + _step);
                    if (_toastTextEl) _toastTextEl.innerHTML = '已扫描到 1 个目录，<br><span class="num-anim">' + _cur + '</span> 首歌曲';
                    if (_cur >= httpCount) {
                        clearInterval(_httpTimer);
                        setTimeout(function() {
                            if (_toastTextEl) _toastTextEl.innerHTML = '✅ 已完成 1 个目录，<br><span class="num-anim">' + httpCount + '</span> 首歌曲';
                            setTimeout(function() { if (_httpToast.parentNode) _httpToast.remove(); }, 1500);
                        }, 300);
                    }
                }, 50);
                // 级联勾选：检查父目录是否应勾选
                var lastSlash = folderPath.lastIndexOf('/');
                if (lastSlash > 0) {
                    var parentPath = folderPath.substring(0, lastSlash);
                    var siblings = _getDirectChildren(srcKey, parentPath);
                    if (siblings.length > 0) {
                        var fullPaths = siblings.map(function(c) { return parentPath + '/' + c; });
                        _cascadeCheck(srcKey, fullPaths);
                    }
                }
            }
        } else {
            // 取消勾选（递归移除子目录）
            var removedCount = 0;
            var removedFolderCount = 0;
            if (source && source.protocol === 'alist') {
                var prevLen = allSongsMaster.length;
                // 递归匹配：移除该目录及其所有子目录的歌曲（跳过虚拟文件夹骨架）
                allSongsMaster = allSongsMaster.filter(function(s) {
                    // 不碰虚拟文件夹 / AList 目录导航条目
                    if (s._virtualFolder || s._alistDir) return true;
                    var sk = s.sourceId || s.source || '';
                    var matchPath = s._fullFolderPath || s.folder || '';
                    // matchPath 以 folderPath 开头（递归匹配子目录）
                    var isMatch = sk === srcKey && (matchPath === folderPath || matchPath.indexOf(folderPath + '/') === 0);
                    return !isMatch;
                });
                removedCount = prevLen - allSongsMaster.length;
                // 清理 _checkedFolders 中的该目录、所有子目录、及父目录（不再全选）
                if (window._checkedFolders) {
                    var toRemove = [];
                    window._checkedFolders.forEach(function(fk) {
                        if (fk.indexOf(srcKey + '::') === 0) {
                            var fp = fk.substring((srcKey + '::').length);
                            if (fp === folderPath || fp.indexOf(folderPath + '/') === 0) {
                                toRemove.push(fk);
                            }
                        }
                    });
                    toRemove.forEach(function(fk) { window._checkedFolders.delete(fk); });
                    removedFolderCount = toRemove.length;
                    // 级联取消：逐级向上检查，如果父目录无子目录勾着则移除
                    _cascadeUncheck(srcKey, folderPath);
                    if (typeof window.saveCheckedFolders === 'function') window.saveCheckedFolders();
                }
                // 更新当前可见的所有文件夹勾选图标
                var checkIcons = document.querySelectorAll('.folder-checkbox i');
                for (var ci = 0; ci < checkIcons.length; ci++) {
                    var icon = checkIcons[ci];
                    var folderItem = icon.closest('.folder-item.grid-box');
                    if (!folderItem) continue;
                    var sk = folderItem.dataset.source || '';
                    var p = folderItem.dataset.path || '';
                    var fk = sk + '::' + p;
                    if (window._checkedFolders && window._checkedFolders.has(fk)) {
                        folderItem.classList.add('checked');
                        icon.className = 'fas fa-check-square';
                    } else {
                        folderItem.classList.remove('checked');
                        icon.className = 'far fa-square';
                    }
                }
                window.allSongsMaster = allSongsMaster;
                currentPlaylist = allSongsMaster.slice();
                saveToCache(allSongsMaster);
            } else {
                // HTTP：统计匹配数量（也递归匹配子目录）
                removedCount = allSongsMaster.filter(function(s) {
                    var sk = s.sourceId || s.source || '';
                    var matchPath = s._fullFolderPath || s.folder || '';
                    return sk === srcKey && (matchPath === folderPath || matchPath.indexOf(folderPath + '/') === 0);
                }).length;
            }
            // 弹出已移除提示（1.5秒自动关）
            var _rmToast = document.createElement('div');
            _rmToast.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:99998;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.4);';
            var rmMsg = removedFolderCount > 0
                ? '已移除 ' + removedFolderCount + ' 个目录，' + removedCount + ' 首歌曲'
                : '已移除 ' + removedCount + ' 首歌曲';
            _rmToast.innerHTML = '<div style="background:#2a2a3a;border-radius:10px;padding:20px 30px;text-align:center;min-width:180px;"><div style="font-size:28px;margin-bottom:8px;">🗑</div><div style="font-size:13px;color:#eee;">' + rmMsg + '</div></div>';
            document.body.appendChild(_rmToast);
            setTimeout(function() { if (_rmToast.parentNode) _rmToast.remove(); }, 1500);
        }
    };

    // 初始化音乐库
    async function initLibrary() {
        _alistDirCache = {}; // 刷新时清除目录缓存
        _alistCacheKeys = [];
        var currentSources = typeof getMusicSources === 'function' ? getMusicSources() : [];
        if (currentSources.length === 0) {
            localStorage.removeItem('MUSIC_LIBRARY_CACHE');
            allSongsMaster = window.allSongsMaster = [];
            currentPlaylist = [];
            refreshList();
            return;
        }

        // 获取当前有效的来源URL列表
        var validUrls = {};
        for (var si = 0; si < currentSources.length; si++) {
            validUrls[currentSources[si].url] = true;
        }

        var cached = await loadFromCache();
        if (cached && cached.length > 0) {
            // 过滤缓存：只保留来源仍在当前配置中的歌曲
            var validCached = [];
            for (var ci = 0; ci < cached.length; ci++) {
                if (validUrls[cached[ci].source]) {
                    validCached.push(cached[ci]);
                }
            }
            if (validCached.length > 0) {
                allSongsMaster = validCached;
                currentPlaylist = allSongsMaster.slice();
                // 不刷新——.then() 会统一渲染并恢复
            } else {
                // 缓存中的来源全部已删除，清缓存
                localStorage.removeItem('MUSIC_LIBRARY_CACHE');
                allSongsMaster = [];
                currentPlaylist = [];
            }
        } else {
            allSongsMaster = [];
            currentPlaylist = [];
        }

        try {
            var remote = await fetchRealMusicLibrary();
            if (remote && remote.length > 0) {
                remote.forEach(function(rs) {
                    var match = allSongsMaster.find(function(l) { return l.src === rs.src; });
                    if (match && match.duration !== '--:--') {
                        rs.duration = match.duration;
                        rs._durationTried = true;
                    }
                });
                // 合并远程数据：保留已有的已勾选歌曲（_alistFilePath），远程不包含它们
                var existingChecked = [];
                if (allSongsMaster && allSongsMaster.length > 0) {
                    existingChecked = allSongsMaster.filter(function(s) { return s._alistFilePath; });
                }
                allSongsMaster = remote.concat(existingChecked);
                // 从 _durationCache 恢复时长（不在 processBatchQueue 中等命中）
                allSongsMaster.forEach(function(s) {
                    if (!s.duration || s.duration === '--:--') {
                        var cached = _durationCache[s.src] || _durationCache[s.source + '::' + (s._alistFilePath || '')];
                        if (cached && cached.duration && cached.duration !== '--:--') {
                            s.duration = cached.duration;
                            s._durationTried = true;
                        }
                    }
                });
                currentPlaylist = allSongsMaster.slice();
                // 不刷新——恢复状态时会统一刷新
                saveToCache(allSongsMaster);
            } else {
                // 远程返回空，显示空列表而不是一直"正在扫描"
            }
        } catch(e) {
            console.warn('远程加载失败:', e);
            // 不刷新——恢复状态时会统一刷新
        }
    }
    window.initLibrary = initLibrary;

    // 播放控件初始化（增强版：带记忆保存）
    if (typeof initPlayerControls === 'function') {
        initPlayerControls(audio, playPauseBtn, prevBtn, nextBtn, progressBar, currentTimeSpan, durationSpan, volumeCtrl, onPlayNext);

        // 进度拖动时保存
        progressBar.addEventListener('mouseup', function() { setTimeout(savePlayState, 100); });
        // 音量变化保存
        volumeCtrl.addEventListener('change', function() { setTimeout(savePlayState, 50); });
    }

    // 歌词字体控件（带记忆）
    if (typeof initFontControl === 'function') {
        initFontControl(fontSlider, fontVal, lyricsBox);
        // 字体变化保存
        fontSlider.addEventListener('change', function() { setTimeout(savePlayState, 50); });
    }

    if (typeof initEffects === 'function') initEffects(effectSelect, lyricsBg);

    // 搜索（防抖，兼容移动端键盘行为）
    if (searchInput) {
        var _searchGen = 0;
        searchInput.addEventListener('input', function() {
            clearTimeout(searchTimer);
            var gen = ++_searchGen;
            searchTimer = setTimeout(async function() {
                if (gen !== _searchGen) return;
                try {
                    await refreshList();
                } catch(e) {
                    console.warn('搜索刷新失败:', e);
                }
            }, 300);
        });
        // 移动端键盘收起时强制刷新
        searchInput.addEventListener('blur', function() {
            setTimeout(function() {
                try { refreshList(); } catch(e) { console.warn(e); }
            }, 200);
        });
    }

    // 视图切换（容器隐藏/显示，不重新渲染）
    function switchView(mode) {
        currentViewMode = mode;
        if (mode === 'all') {
            currentFolderPath = ''; _folderPageState.currentPage = 1;
            if (viewAllBtn) viewAllBtn.classList.add('active');
            if (viewFolderBtn) viewFolderBtn.classList.remove('active');
            if (viewFavBtn) viewFavBtn.classList.remove('active');
        } else if (mode === 'folder') {
            currentFolderPath = ''; _folderPageState.currentPage = 1;
            if (viewFolderBtn) viewFolderBtn.classList.add('active');
            if (viewAllBtn) viewAllBtn.classList.remove('active');
            if (viewFavBtn) viewFavBtn.classList.remove('active');
        } else if (mode === 'fav') {
            if (viewFavBtn) viewFavBtn.classList.add('active');
            if (viewAllBtn) viewAllBtn.classList.remove('active');
            if (viewFolderBtn) viewFolderBtn.classList.remove('active');
        }
        // 如果容器已有内容且未标记脏，直接切换可见性（有搜索词时强制刷新）
        var container = _viewContainers[mode];
        var hasSearch = searchInput && searchInput.value.trim();
        if (container && container.children.length > 0 && !_dirtyViews[mode] && !hasSearch) {
            _showViewContainer(mode);
            attachSongEvents(container, allSongsMaster, playSongByIndex, function(type, path, sourceUrl) {
                if (type === 'back') { currentFolderPath = ''; _folderPageState.currentPage = 1; refreshList(); return; }
                if (sourceUrl && typeof getMusicSources === 'function') {
                    var sources = getMusicSources(), src = null;
                    for (var si = 0; si < sources.length; si++) {
                        if (sources[si].id === sourceUrl || sources[si].url === sourceUrl) { src = sources[si]; break; }
                    }
                    if (src && src.protocol === 'alist') { _alistPathStack.push('/' + path); currentFolderPath = path; loadAListDir(src, '/' + path); return; }
                }
                currentFolderPath = path; _folderPageState.currentPage = 1; refreshList();
            });
            highlightCurrentSong(container, allSongsMaster, currentIndex);
        } else {
            refreshList();
        }
        // 每次切换视图重新初始化懒加载（容器内的 .song-item 可能已变化）
        _lazyLoaded = false;
        initLazyLoading();
    }

    if (viewAllBtn) { viewAllBtn.onclick = function() { switchView('all'); }; viewAllBtn.classList.add('active'); }
    if (viewFolderBtn) { viewFolderBtn.onclick = function() { switchView('folder'); }; }
    if (viewFavBtn) { viewFavBtn.onclick = function() { switchView('fav'); }; }

    // ===== 全屏切换 =====
    var listFullscreenBtn = document.getElementById('listFullscreenBtn');
    var playerFullscreenBtn = document.getElementById('playerFullscreenBtn');
    var fsPlaylist = document.getElementById('playlistPanel');
    var fsPlayer = document.getElementById('playerCore');

    function toggleFullscreen(el, btn) {
        var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
        if (!fsEl) {
            var req = el.requestFullscreen || el.webkitRequestFullscreen;
            if (req) {
                req.call(el).then(function() {
                    el.classList.add('is-fullscreen');
                    if (btn) btn.innerHTML = '<i class="fas fa-compress"></i>';
                    if (btn) btn.title = '退出全屏';
                    // 触发特效 canvas 重算（fullscreenchange 先于类添加触发，布局未变）
                    window.dispatchEvent(new Event('resize'));
                }).catch(function(err) {
                    console.warn('全屏失败:', err);
                });
            }
        } else {
            var exit = document.exitFullscreen || document.webkitExitFullscreen;
            if (exit) exit.call(document);
        }
    }

    if (listFullscreenBtn && fsPlaylist) {
        listFullscreenBtn.onclick = function() {
            toggleFullscreen(fsPlaylist, listFullscreenBtn);
        };
    }
    if (playerFullscreenBtn && fsPlayer) {
        playerFullscreenBtn.onclick = function() {
            toggleFullscreen(fsPlayer, playerFullscreenBtn);
        };
    }

    // 全屏变化由下方 IIFE 统一处理（ESC 退出等）

    // ===== 全屏下滑动切换面板 =====
    (function() {
        var _mode = null, _sx = 0;
        var _wrapper = document.getElementById('ttApp') || document.body;
        // 注入过场动画
        var _fsStyle = document.createElement('style');
            _fsStyle.textContent = '@keyframes fsFadeIn{from{opacity:0.5;transform:scale(0.97)}to{opacity:1;transform:scale(1)}}._fsPanel{animation:fsFadeIn 0.2s ease-out}._fsMode #playlistPanel,._fsMode #playerCore{padding:0!important;margin:0!important;max-width:none!important;max-height:none!important;border-radius:0!important}._fsMode .spectrum-container{height:10vh;min-height:108px;max-height:20vh}._fsMode .lyrics-container{padding:0 16px!important}.comment-text{font-size:clamp(7px,1.3vw,13px)!important}._fsMode .lyrics-scroll-wrap{overflow-y:hidden!important}._fsMode .lyrics-container{overflow:hidden!important}._fsMode .volume-box{flex:0.8;min-width:80px}._fsMode .volume-box input{min-width:50px}';
            document.head.appendChild(_fsStyle);
        function _enterFs(firstPanel) {
            _wrapper.classList.add('_fsMode');
            _wrapper.style.overflow = 'hidden';
            // 先显示面板，让 DOM 布局就绪
            _showPanel(firstPanel || 'list');
            // 尝试浏览器全屏 API（隐藏地址栏）— 失败不影响 CSS 全屏效果
            var req = _wrapper.requestFullscreen || _wrapper.webkitRequestFullscreen;
            if (req) {
                req.call(_wrapper).catch(function() {
                    // 全屏 API 不支持/失败 → CSS _fsMode 仍在，效果不变
                });
            }
        }
        function _showPanel(which) {
            var p = document.getElementById('playlistPanel');
            var r = document.getElementById('playerCore');
            var d = document.getElementById('dividerMain');
            if (which === 'list') {
                if (p) { p.style.display = ''; p.style.width = ''; p.style.flex = '1 1 100%'; p.classList.add('_fsPanel'); setTimeout(function() { if (p) p.classList.remove('_fsPanel'); }, 300); }
                if (r) r.style.display = 'none';
                if (d) d.style.display = 'none';
                if (listFullscreenBtn) { listFullscreenBtn.innerHTML = '<i class="fas fa-compress"></i>'; listFullscreenBtn.title = '退出全屏'; }
                if (playerFullscreenBtn) { playerFullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>'; playerFullscreenBtn.title = '全屏列表'; }
                // 确保正确的视图容器可见并刷新列表
                typeof _showViewContainer === 'function' && _showViewContainer(currentViewMode);
                typeof refreshList === 'function' && refreshList();
            } else {
                if (p) p.style.display = 'none';
                if (r) { r.style.display = ''; r.style.flex = '1 1 100%'; r.classList.add('_fsPanel'); setTimeout(function() { if (r) r.classList.remove('_fsPanel'); }, 300); }
                if (d) d.style.display = 'none';
                if (playerFullscreenBtn) { playerFullscreenBtn.innerHTML = '<i class="fas fa-compress"></i>'; playerFullscreenBtn.title = '退出全屏'; }
                if (listFullscreenBtn) { listFullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>'; listFullscreenBtn.title = '全屏列表'; }
            }
            _mode = which;
            // 面板切换后触发 canvas 重算
            window.dispatchEvent(new Event('resize'));
        }
        // 统一恢复 UI：不论哪种方式退出全屏都走这里
        function _cleanupFs() {
            _wrapper.classList.remove('_fsMode');
            _wrapper.style.overflow = '';
            var p = document.getElementById('playlistPanel');
            var r = document.getElementById('playerCore');
            var d = document.getElementById('dividerMain');
            if (p) { p.style.display = ''; p.style.width = ''; p.style.flex = ''; }
            if (r) { r.style.display = ''; r.style.flex = ''; }
            if (d) d.style.display = '';
            if (listFullscreenBtn) { listFullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>'; listFullscreenBtn.title = '全屏列表'; }
            if (playerFullscreenBtn) { playerFullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>'; playerFullscreenBtn.title = '全屏播放器'; }
            _mode = null;
            // 恢复非全屏布局后触发 canvas 重算
            window.dispatchEvent(new Event('resize'));
        }
        function _onFsChange() {
            if (!document.fullscreenElement && !document.webkitFullscreenElement) {
                _cleanupFs();
            }
        }
        document.addEventListener('fullscreenchange', _onFsChange);
        document.addEventListener('webkitfullscreenchange', _onFsChange);
        // 接管全屏按钮 — 用 _mode 检测（比 document.fullscreenElement 更可靠，
        // 因为 requestFullscreen 可能失败，但 UI 已经被切换）
        function _exitFs() {
            if (document.fullscreenElement || document.webkitFullscreenElement) {
                var ex = document.exitFullscreen || document.webkitExitFullscreen;
                if (ex) ex.call(document);
                // exitFullscreen 会触发 fullscreenchange → _onFsChange → _cleanupFs
                // 所以这里不需要再调用 _cleanupFs
            } else {
                // 不在浏览器全屏中但 CSS _fsMode 在（requestFullscreen 失败的情况）
                _cleanupFs();
            }
        }
        if (listFullscreenBtn) {
            listFullscreenBtn.onclick = function() {
                if (_mode || document.fullscreenElement || document.webkitFullscreenElement) {
                    _exitFs(); return;
                }
                _enterFs('list');
            };
        }
        if (playerFullscreenBtn) {
            playerFullscreenBtn.onclick = function() {
                if (_mode || document.fullscreenElement || document.webkitFullscreenElement) {
                    _exitFs(); return;
                }
                _enterFs('player');
            };
        }
        // 滑动切换
        document.addEventListener('touchstart', function(e) {
            if (!_mode) return;
            _sx = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }, { passive: true });
        document.addEventListener('touchend', function(e) {
            if (!_sx || !_sx.y || !_mode) return;
            var dx = e.changedTouches[0].clientX - _sx.x;
            var dy = e.changedTouches[0].clientY - _sx.y;
            _sx = 0;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 2) _showPanel(_mode === 'list' ? 'player' : 'list');
        }, { passive: true });
    })();

    // ===== 歌词服务器配置弹窗 =====
    var providerBtn = document.getElementById('lyricsProviderBtn');
    if (providerBtn) {
        providerBtn.onclick = function() {
            showProviderConfigDialog();
        };
    }

    function showProviderConfigDialog() {
        var overlay = document.createElement('div');
        overlay.className = 'add-source-overlay';
        overlay.style.cssText = 'z-index:2000;';

        var builtins = window.ProviderManager.getBuiltins();
        var config = { active: 'netease', urls: {} };
        try { var raw = localStorage.getItem('LYRICS_PROVIDER_CONFIG'); if (raw) config = JSON.parse(raw); } catch(e) {}

        var optionsHtml = '';
        for (var key in builtins) {
            var info = builtins[key];
            var selected = key === config.active ? 'selected' : '';
            optionsHtml += '<option value="' + key + '" ' + selected + '>' + info.label + '</option>';
        }

        overlay.innerHTML =
            '<div class="add-source-dialog" style="max-width:380px;">' +
            '<div class="dialog-title"><i class="fas fa-microphone" style="color:#4da6ff;"></i> 歌词服务器配置</div>' +
            '<div class="dialog-body">' +
            '<label>选择平台</label>' +
            '<select id="providerSelect" style="width:100%;background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.1);color:inherit;padding:4px 8px;border-radius:4px;margin-bottom:10px;font-size:12px;">' +
            optionsHtml +
            '</select>' +
            '<label>API 地址</label>' +
            '<input type="text" id="providerUrlInput" placeholder="http://localhost:3000" value="' + (config.urls[config.active] || builtins[config.active]?.defaultUrl || '') + '" style="width:100%;">' +
            '<div class="dialog-hint" style="margin-top:6px;line-height:1.5;">' +
            '<i class="fas fa-info-circle"></i> 填入你部署的 API 服务地址<br>' +
            '网易云: <span style="color:#888;">http://localhost:3000</span><br>' +
            '其他平台需安装对应 API 服务' +
            '</div>' +
            '</div>' +
            '<div class="dialog-actions">' +
            '<button class="dialog-btn cancel" id="providerCancelBtn">取消</button>' +
            '<button class="dialog-btn confirm" id="providerSaveBtn">保存</button>' +
            '</div>' +
            '</div>';

        document.body.appendChild(overlay);

        var select = overlay.querySelector('#providerSelect');
        var urlInput = overlay.querySelector('#providerUrlInput');

        select.onchange = function() {
            var name = this.value;
            var info = builtins[name];
            urlInput.value = config.urls[name] || info.defaultUrl || '';
        };

        overlay.querySelector('#providerCancelBtn').onclick = function() { overlay.remove(); };
        overlay.querySelector('#providerSaveBtn').onclick = function() {
            var name = select.value;
            var url = urlInput.value.trim().replace(/\/+$/, '');
            if (url && !url.match(/^https?:\/\//)) {
                alert('请输入完整的 HTTP 地址（以 http:// 或 https:// 开头）');
                return;
            }
            config.active = name;
            config.urls[name] = url;
            localStorage.setItem('LYRICS_PROVIDER_CONFIG', JSON.stringify(config));
            if (window.providerManager) {
                providerManager.setUrl(name, url);
                providerManager.setActive(name);
            }
            overlay.remove();
        };
        overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    }

    // ===== 歌词 + 评论集成（4条气泡轮播） =====
    var commentsArea = document.getElementById('commentsArea');
    var commentListEl = document.getElementById('commentList');
    var commentsCount = document.getElementById('commentsCount');
    var commentsSortBar = document.getElementById('commentsSortBar');
    var currentSort = 'hot';
    var currentSongId = null;
    var _commentList = [];
    var _commentOffset = 0;
    var _commentTimer = null;
    var _commentPage = 0;
    var _commentTotal = 0;
    var _commentHasMore = false;
    var SHOW_COUNT = 4;

    // 评论排序按钮
    if (commentsSortBar) {
        commentsSortBar.addEventListener('click', function(e) {
            var btn = e.target.closest('.comments-sort-btn');
            if (!btn) return;
            var sort = btn.dataset.sort;
            if (sort === currentSort) return;
            currentSort = sort;
            commentsSortBar.querySelectorAll('.comments-sort-btn').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            if (currentSongId) loadComments(currentSongId, currentSort);
        });
    }

    function renderComments() {
        try {
            if (!commentListEl || !_commentList || _commentList.length === 0) {
                if (commentListEl) commentListEl.innerHTML = '<div class="comment-bubble"><div class="comment-text">暂无评论</div></div>';
                return;
            }
            var count = Math.min(SHOW_COUNT, _commentList.length);
            var html = '';
            for (var i = 0; i < count; i++) {
                var idx = (_commentOffset + i) % _commentList.length;
                var c = _commentList[idx];
                if (!c || !c.content) continue;
                var delay = i * 0.08;
                var cid = c.id || 0;
                var cAvatar = escapeHtml(c.avatar || '');
                var cUser = escapeHtml(c.user || '匿名');
                html += '<div class="comment-bubble" style="animation-delay:' + delay + 's" data-cid="' + cid + '" data-user="' + cUser + '" data-avatar="' + cAvatar + '" data-content="' + escapeHtml(c.content) + '" data-likes="' + (c.likes || 0) + '">' +
                    '<div class="comment-text"><span class="comment-likes"><i class="fas fa-thumbs-up"></i>' + (c.likes || 0) + '</span>' + escapeHtml(c.content) + '</div>' +
                    '</div>';
            }
            commentListEl.style.opacity = '0';
            setTimeout(function() {
                commentListEl.innerHTML = html;
                commentListEl.style.opacity = '1';
            }, 150);
        } catch(e) {}
    }

    function showCommentsArea(show) {
        if (commentsArea) {
            if (show) commentsArea.classList.add('visible');
            else commentsArea.classList.remove('visible');
        }
    }

    function loadComments(songId, sort) {
        if (!songId || !window.providerManager) {
            showCommentsArea(false);
            return;
        }
        // 重置分页
        _commentList = [];
        _commentPage = 0;
        _commentHasMore = false;
        _commentTotal = 0;
        if (_commentTimer) clearInterval(_commentTimer);
        showCommentsArea(true);
        if (commentListEl) commentListEl.innerHTML = '<div class="comment-bubble"><div class="comment-text">加载中...</div></div>';
        providerManager.getCurrent().then(function(provider) {
            if (!provider || !provider.isReady()) {
                if (commentListEl) commentListEl.innerHTML = '<div class="comment-bubble"><div class="comment-text">歌词服务未配置</div></div>';
                return;
            }
            provider.getComments(songId, sort || 'hot', _commentPage + 1).then(function(result) {
                if (result && result.list) {
                    _commentTotal = result.total || 0;
                    _commentHasMore = result.hasMore === true;
                    // 追加到列表尾部（上限 200 条，超出从头部丢弃）
                    for (var ci = 0; ci < result.list.length; ci++) {
                        _commentList.push(result.list[ci]);
                    }
                    while (_commentList.length > 200) _commentList.shift();
                    _commentPage++;
                } else {
                    if (result) {
                        for (var ci2 = 0; ci2 < result.length; ci2++) {
                            _commentList.push(result[ci2]);
                        }
                        while (_commentList.length > 200) _commentList.shift();
                    }
                }
                if (_commentTimer) clearInterval(_commentTimer);

                if (_commentList.length === 0) {
                    if (commentListEl) commentListEl.innerHTML = '<div class="comment-bubble"><div class="comment-text">暂无评论</div></div>';
                    if (commentsCount) commentsCount.textContent = '0';
                    return;
                }
                showCommentsArea(true);
                if (commentsCount) commentsCount.textContent = _commentTotal || _commentList.length;
                _commentOffset = 0;
                renderComments();
                if (_commentTimer) clearInterval(_commentTimer);
                // 每 8 秒整体刷新 4 条
                // 出现时间，刷新时间，过期时间，时间时间
                _commentTimer = setInterval(function() {
                    _commentOffset = (_commentOffset + SHOW_COUNT) % _commentList.length;
                    renderComments();
                    // 接近尾部时预加载下一页
                    if (_commentHasMore && _commentOffset > _commentList.length - SHOW_COUNT - 3) {
                        _commentHasMore = false;
                        provider.getComments(currentSongId, currentSort, _commentPage + 1).then(function(result2) {
                            if (result2 && result2.list && result2.list.length > 0) {
                                _commentTotal = result2.total || 0;
                                _commentHasMore = result2.hasMore === true;
                                for (var ci3 = 0; ci3 < result2.list.length; ci3++) {
                                    _commentList.push(result2.list[ci3]);
                                }
                                while (_commentList.length > 200) _commentList.shift();
                                _commentPage++;
                                if (commentsCount) commentsCount.textContent = _commentTotal || _commentList.length;
                            }
                        }).catch(function() {});
                    }
                }, 10000);
            }).catch(function() {
                if (commentListEl) commentListEl.innerHTML = '<div class="comment-bubble"><div class="comment-text">获取评论失败</div></div>';
            });
        }).catch(function() {
            if (commentListEl) commentListEl.innerHTML = '<div class="comment-bubble"><div class="comment-text">歌词服务连接失败</div></div>';
        });
    }

    function fetchLyricsFromProvider(songName, artistName) {
        if (!window.providerManager) return Promise.reject();
        return providerManager.getCurrent().then(function(provider) {
            if (!provider || !provider.isReady()) return null;

            return provider.search((artistName ? artistName.trim() + ' ' : '') + songName.trim()).then(function(songs) {
                // 评分函数：歌名完全 50 / 部分 30，歌手完全 50 / 部分 30，上限 100
                function score(song) {
                    var st = (song.title || song.name || '').toLowerCase().trim();
                    var sa = (song.artist || '').toLowerCase().trim();
                    var snl = songName.toLowerCase().trim();
                    var anl = (artistName || '').toLowerCase().trim();
                    // 歌名必须先匹配上，否则 0 分
                    if (st !== snl && st.indexOf(snl) < 0 && snl.indexOf(st) < 0) return 0;
                    var sc = 0;
                    if (st === snl) sc += 50;
                    else sc += 30;
                    if (anl) {
                        if (sa === anl) sc += 50;
                        else if (sa.indexOf(anl) >= 0 || anl.indexOf(sa) >= 0) sc += 30;
                    }
                    return Math.min(sc, 100);
                }

                var match = null, bestScore = -1;
                (songs || []).forEach(function(s) { var sc = score(s); if (sc > bestScore) { bestScore = sc; match = s; } });

                if (!match) { loadComments(null, currentSort); return null; }
                currentSongId = match.id;
                var commentId = match.mixsongid || match.id;
                loadComments(commentId, currentSort);
                return provider.getLyric(match.id, match).then(function(lyric) {
                    return lyric.lrc || null;
                });
            });
        }).catch(function() { return null; });
    }

    // 只加载评论 — 通过 provider 搜索当前歌曲获取 ID，不依赖残留的 currentSongId
    // ===== 评论点击查看详情 =====
    if (commentsArea) {
        commentsArea.addEventListener('click', function(e) {
            var bubble = e.target.closest('.comment-bubble');
            if (!bubble) return;
            var cid = bubble.dataset.cid;
            if (!cid || cid === '0') return;
            showCommentDetail({
                id: parseInt(cid),
                user: bubble.dataset.user || '匿名',
                avatar: bubble.dataset.avatar || '',
                content: bubble.dataset.content || '',
                likes: parseInt(bubble.dataset.likes) || 0
            });
        });
    }

    function showCommentDetail(comment) {
        if (!window.providerManager) return;
        var overlay = document.createElement('div');
        overlay.className = 'add-source-overlay';
        overlay.style.cssText = 'z-index:2000;';

        overlay.innerHTML =
            '<div class="comment-detail-dialog">' +
            '<div class="dialog-title">评论 <span class="dialog-close" id="detailClose"><i class="fas fa-times"></i></span></div>' +
            '<div class="comment-detail-main">' +
            '<img class="detail-avatar" src="' + (comment.avatar || '') + '" onerror="this.style.display=\'none\'" loading="lazy">' +
            '<div class="detail-body">' +
            '<div class="detail-user"><span class="detail-name">' + escapeHtml(comment.user) + '</span> <span class="detail-likes"><i class="fas fa-thumbs-up"></i> ' + comment.likes + '</span></div>' +
            '<div class="detail-content">' + escapeHtml(comment.content) + '</div>' +
            '</div>' +
            '</div>' +
            '<div class="detail-floor-list" id="floorList"><div class="floor-loading">加载中...</div></div>' +
            '<div class="more-reply" id="moreReplyWrap" style="display:none;">' +
            '<span class="more-line"></span>' +
            '<span class="more-text" id="moreReplyBtn"><span class="more-wave" id="moreWave">~</span> 展开更多回复 <span class="more-arrow">▾</span></span>' +
            '<span class="more-line"></span>' +
            '</div>' +
            '</div>';

        // 全屏时追加到全屏元素内，否则浏览器会遮挡弹窗
        var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
        (fsEl || document.body).appendChild(overlay);
        overlay.addEventListener('click', function() { overlay.remove(); });
        overlay.querySelector('#detailClose').addEventListener('click', function(e) { e.stopPropagation(); overlay.remove(); });

        var floorList = overlay.querySelector('#floorList');
        var moreBtn = overlay.querySelector('#moreReplyBtn');
        var moreWrap = overlay.querySelector('#moreReplyWrap');
        var floorPage = 0;

        function loadFloors(page) {
            if (!window.providerManager) return Promise.resolve();
            return providerManager.getCurrent().then(function(provider) {
                if (!provider || typeof provider.getFloorComments !== 'function') {
                    floorList.innerHTML = '<div class="floor-loading">暂不支持查看回复</div>';
                    return;
                }
                return provider.getFloorComments(comment.id, currentSongId, page || 1).then(function(res) {
                    if (!res || !res.list || res.list.length === 0) {
                        if (page === 1) floorList.innerHTML = '<div class="floor-loading">暂无回复</div>';
                        return;
                    }
                    var html = '';
                    for (var fi = 0; fi < res.list.length; fi++) {
                        var f = res.list[fi];
                        html += '<div class="floor-item">' +
                            '<img class="detail-avatar" src="' + escapeHtml(f.avatar || '') + '" onerror="this.style.display=\'none\'" loading="lazy">' +
                            '<div class="detail-body">' +
                            '<div class="detail-user"><span class="detail-name">' + escapeHtml(f.user) + '</span> <span class="detail-likes"><i class="fas fa-thumbs-up"></i> ' + (f.likes || 0) + '</span></div>' +
                            '<div class="detail-content">' + escapeHtml(f.content) + '</div>' +
                            '</div>' +
                            '</div>';
                    }
                    if (page === 1) floorList.innerHTML = html;
                    else floorList.insertAdjacentHTML('beforeend', html);

                    if (res.hasMore) {
                        moreWrap.style.display = 'flex';
                        moreBtn.onclick = function(e) { e.stopPropagation();
                            var wave = document.getElementById('moreWave');
                            if (wave) {
                                var frames = ['◐','◓','◑','◒'];
                                var fi = 0, startT = Date.now();
                                wave.textContent = frames[0];
                                var spinTimer = setInterval(function() {
                                    fi = (fi + 1) % frames.length;
                                    if (wave) wave.textContent = frames[fi];
                                }, 120);
                                loadFloors(++floorPage + 1).finally(function() {
                                    var elapsed = Date.now() - startT;
                                    setTimeout(function() {
                                        clearInterval(spinTimer);
                                        if (wave) wave.textContent = '~';
                                    }, Math.max(0, 1000 - elapsed));
                                });
                            } else {
                                loadFloors(++floorPage + 1);
                            }
                        };
                    } else {
                        moreWrap.style.display = 'none';
                    }
                });
            }).catch(function() {
                floorList.innerHTML = '<div class="floor-loading">获取回复失败</div>';
            });
        }

        loadFloors(1);
    }

    // 保存引用供 lyrics.js 调用
    window.fetchLyricsFromProvider = fetchLyricsFromProvider;

    // 音量图标点击静音切换
    var volumeIcon = document.getElementById('volumeIcon');
    var lastVolume = 0.7;
    if (volumeIcon && volumeCtrl && audio) {
        volumeIcon.onclick = function() {
            if (audio.volume > 0) {
                lastVolume = audio.volume;
                audio.volume = 0;
                volumeCtrl.value = 0;
                this.className = 'fas fa-volume-mute';
                this.title = '取消静音';
            } else {
                audio.volume = lastVolume;
                volumeCtrl.value = lastVolume;
                this.className = lastVolume > 0.5 ? 'fas fa-volume-up' : 'fas fa-volume-down';
                this.title = '点击静音';
            }
        };
        volumeCtrl.addEventListener('input', function() {
            var val = parseFloat(this.value);
            audio.volume = val;
            if (val > 0) {
                volumeIcon.className = val > 0.5 ? 'fas fa-volume-up' : 'fas fa-volume-down';
                volumeIcon.title = '点击静音';
                lastVolume = val;
            } else {
                volumeIcon.className = 'fas fa-volume-mute';
                volumeIcon.title = '取消静音';
            }
        });
    }

    // ===== 清除缓存按钮 =====
    (function initClearCache() {
        var btn = document.getElementById('clearCacheBtn');
        if (!btn) return;
        btn.onclick = function() {
            if (!confirm('确定清除所有缓存？\n\n这将会：\n• 清除音乐来源配置\n• 清除播放历史\n• 清除主题/特效设置\n• 清除所有缓存数据')) return;
            // 清除所有 localStorage
            localStorage.clear();
            // 清除音乐库缓存
            if (typeof refreshList === 'function') refreshList();
            // 刷新页面
            location.reload();
        };
    })();

    // ===== Electron模式切换（全屏无留白） =====
    (function initElectronMode() {
        if (window.electronAPI) {
            // 切换body
            document.body.classList.add('electron-body');
            // 切换app容器
            var app = document.getElementById('ttApp');
            if (app) app.classList.add('electron-mode');
            // 显示窗口按钮
            var winCtrls = document.getElementById('windowControls');
            if (winCtrls) winCtrls.style.display = 'flex';
            // 绑定窗口控制
            var minBtn = document.getElementById('winMinBtn');
            var maxBtn = document.getElementById('winMaxBtn');
            var closeBtn = document.getElementById('winCloseBtn');
            if (minBtn) minBtn.onclick = function() { window.electronAPI.minimize(); };
            if (maxBtn) maxBtn.onclick = function() { window.electronAPI.maximize(); };
            if (closeBtn) closeBtn.onclick = function() { window.electronAPI.close(); };
        }
    })();

    // ===== 拖拽分区 =====
    (function initDragDivider() {
        var dividerMain = document.getElementById('dividerMain');
        var dividerLyrics = document.getElementById('dividerLyrics');
        var playlistPanel = document.getElementById('playlistPanel');
        var playerCore = document.getElementById('playerCore');
        var nowPlaying = document.getElementById('nowPlayingCard');
        var lyricsContainer = document.querySelector('.lyrics-container');
        if (!dividerMain || !playlistPanel) return;

        var isDragging = false;

        // 拖拽期间暂停特效动画，避免争抢渲染帧
        function pauseFx() {
            if (typeof window._stopFx === 'function') window._stopFx();
        }
        function resumeFx() {
            if (typeof window._resumeFx === 'function') window._resumeFx();
        }

        // 垂直分割线（左右：playlist ↔ player-core，使用Pointer Events避免事件泄漏）
        dividerMain.addEventListener('pointerdown', function(e) {
            isDragging = true;
            pauseFx();
            this.classList.add('active');
            this.setPointerCapture(e.pointerId);
            var startX = e.clientX;
            var startW = playlistPanel.offsetWidth;

            function onMove(ev) {
                if (!isDragging) return;
                var newW = startW + (ev.clientX - startX);
                newW = Math.max(180, Math.min(500, newW));
                playlistPanel.style.width = newW + 'px';
            }

            function onUp() {
                if (!isDragging) return;
                isDragging = false;
                dividerMain.classList.remove('active');
                window.dispatchEvent(new Event('resize'));
                resumeFx();
                dividerMain.removeEventListener('pointermove', onMove);
                dividerMain.removeEventListener('pointerup', onUp);
                dividerMain.removeEventListener('pointercancel', onUp);
            }

            dividerMain.addEventListener('pointermove', onMove);
            dividerMain.addEventListener('pointerup', onUp);
            dividerMain.addEventListener('pointercancel', onUp);
            e.preventDefault();
        });

        // 水平分割线（上下：now-playing ↔ lyrics，使用Pointer Events避免事件泄漏）
        if (dividerLyrics && nowPlaying && lyricsContainer) {
            dividerLyrics.addEventListener('pointerdown', function(e) {
                isDragging = true;
                pauseFx();
                this.classList.add('active');
                this.setPointerCapture(e.pointerId);
                var startY = e.clientY;
                var startH = nowPlaying.offsetHeight;
                var parentH = playerCore ? playerCore.clientHeight : 600;

                function onMove(ev) {
                    if (!isDragging) return;
                    var newH = startH + (ev.clientY - startY);
                    newH = Math.max(120, Math.min(parentH - 100, newH));
                    nowPlaying.style.flex = 'none';
                    nowPlaying.style.height = newH + 'px';
                    lyricsContainer.style.flex = '1';
                }

                function onUp() {
                    if (!isDragging) return;
                    isDragging = false;
                    dividerLyrics.classList.remove('active');
                    window.dispatchEvent(new Event('resize'));
                    resumeFx();
                    dividerLyrics.removeEventListener('pointermove', onMove);
                    dividerLyrics.removeEventListener('pointerup', onUp);
                    dividerLyrics.removeEventListener('pointercancel', onUp);
                }

                dividerLyrics.addEventListener('pointermove', onMove);
                dividerLyrics.addEventListener('pointerup', onUp);
                dividerLyrics.addEventListener('pointercancel', onUp);
                e.preventDefault();
            });
        }
    })();

    // 全屏功能已移除

    // 添加按钮已移至文件夹导航栏（#addSourceBtn）

    // 皮肤切换（同时刷新歌词颜色缓存）
    document.querySelectorAll('.style-btn').forEach(function(btn) {
        btn.onclick = function() {
            document.body.setAttribute('data-theme', btn.dataset.style);
            requestAnimationFrame(function() {
                if (typeof window.refreshLyricsColors === 'function') window.refreshLyricsColors();
            });
        };
    });

    // 音频事件（AList 文件也能更新时长）
    if (audio) {
        audio.addEventListener('loadedmetadata', function() {
            var seconds = audio.duration;
            if (!isNaN(seconds) && seconds !== Infinity) {
                var mins = Math.floor(seconds / 60);
                var secs = Math.floor(seconds % 60);
                var durStr = (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs;
                if (currentPlaylist[currentIndex]) {
                    currentPlaylist[currentIndex].duration = durStr;
                    // currentPlaylist 是 allSongsMaster 的浅拷贝，更新同一个对象
                    if (allSongsMaster[currentIndex]) {
                        allSongsMaster[currentIndex].duration = durStr;
                    }
                    saveToCache(allSongsMaster);
                    // 同步更新列表中对应行的时长显示
                    var _node = listContainer.querySelector('.song-item[data-index="' + currentIndex + '"]');
                    if (_node) {
                        var _dSpan = _node.querySelector('.song-duration');
                        if (_dSpan) _dSpan.innerText = durStr;
                    }
                }
            }
        });
    }

    // 启动后尝试恢复上次的状态
    initLibrary().then(function() {
        var saved = loadPlayState();

        if (saved) {
            // 恢复音量
            if (saved.volume !== undefined && audio) {
                audio.volume = saved.volume;
                if (volumeCtrl) volumeCtrl.value = saved.volume;
            }
            // 恢复字体大小
            if (saved.fontSize && fontSlider && lyricsBox) {
                fontSlider.value = saved.fontSize;
                lyricsBox.style.fontSize = saved.fontSize + 'px';
                if (fontVal) fontVal.innerText = saved.fontSize + 'px';
            }

            // 恢复分页
            if (saved.viewMode === 'folder') {
                if (saved.folderPage) _folderPageState.currentPage = saved.folderPage;
            } else {
                if (saved.allPage) _allSongsPageState.currentPage = saved.allPage;
            }

            // 按页面 + 页内序号定位（songPageNo = 全局第N首，1-based）
            var restoreIdx = -1;
            if (saved.songPageNo && allSongsMaster.length > 0) {
                restoreIdx = saved.songPageNo - 1;
                if (restoreIdx < 0 || restoreIdx >= allSongsMaster.length) restoreIdx = -1;
            }
            // 页面+序号找不到，fallback 到 index
            if (restoreIdx < 0 && saved.index !== undefined && saved.index < allSongsMaster.length) {
                restoreIdx = saved.index;
            }

            if (restoreIdx >= 0) {
                currentIndex = restoreIdx; window.currentIndex = restoreIdx;
                var restoreSong = allSongsMaster[restoreIdx];
                currentSongTitleSpan.innerText = restoreSong.name;
                currentSongArtistSpan.innerText = restoreSong.artist;

                // 先刷新列表（无参数，避免 0 作为滚动值被误处理）
                refreshList();
                // 从 songPage 恢复分页
                if (saved.viewMode !== 'folder' && saved.songPage) {
                    _allSongsPageState.currentPage = saved.songPage;
                }
                // 手动滚动到目标歌曲并高亮
                var _container = _viewContainers[currentViewMode];
                if (_container) {
                    var _el = _container.querySelector('.song-item[data-index="' + restoreIdx + '"]');
                    if (_el) {
                        _el.scrollIntoView({ block: 'start' });
                        // 高亮可能被 refreshList 重置，重新高亮
                        if (typeof highlightCurrentSong === 'function') {
                            highlightCurrentSong(_container, allSongsMaster, currentIndex);
                        }
                    }
                }

                // 加载音频并恢复位置（AList 歌曲跳过，src 是 alist://cache 无效协议）
                var _restoreSong = allSongsMaster[restoreIdx];
                if (_restoreSong && (_restoreSong._alistFile || _restoreSong._alistDir)) { /* 跳过 */ }
                else setTimeout(function() {
                    var song = allSongsMaster[restoreIdx];
                    if (!song) return;
                    audio.src = song.src;
                    audio.load();
                    var doSeek = function() {
                        // 先清除 player.js 的 loadedmetadata 重置影响
                        if (progressBar) {
                            progressBar.value = 0;
                            progressBar.style.setProperty('--pct', '0%');
                        }
                        if (saved.currentTime > 0 && saved.currentTime < audio.duration) {
                            audio.currentTime = saved.currentTime;
                        }
                        // 强制同步进度条 UI
                        var syncBar = function() {
                            if (progressBar && audio.duration) {
                                var pct = audio.currentTime / audio.duration;
                                progressBar.value = pct;
                                progressBar.style.setProperty('--pct', (pct * 100) + '%');
                            }
                            if (currentTimeSpan && audio.duration) {
                                currentTimeSpan.textContent = formatTime(audio.currentTime);
                            }
                            if (durationSpan && audio.duration) {
                                durationSpan.textContent = formatTime(audio.duration);
                            }
                            // 再高亮一次确保选中（refreshList 可能因分页问题丢失高亮）
                            var container = _viewContainers[currentViewMode];
                            if (container && typeof highlightCurrentSong === 'function') {
                                highlightCurrentSong(container, allSongsMaster, currentIndex);
                            }
                        };
                        // currentTime 需要等音频 ready 才能生效
                        setTimeout(syncBar, 50);
                        audio.removeEventListener('loadedmetadata', doSeek);
                    };
                    audio.addEventListener('loadedmetadata', doSeek);
                    // 不自动播放——等待用户点击播放按钮
                    // 但保留 isPlaying 标记方便 UI 恢复
                    if (saved.isPlaying) {
                        updatePlayButton(playPauseBtn, true);
                    }
                }, 300);
            } else {
                // 没有可恢复的歌曲，至少恢复分页
                refreshList(-1);
            }
        } else {
            // 没有保存的状态，渲染默认列表
            refreshList(-1);
        }
    });

    // 没有记忆时的默认音量
    if (!loadPlayState() && audio) {
        audio.volume = 0.7;
        if (volumeCtrl) volumeCtrl.value = 0.7;
    }
    // 模拟一次用户操作，确保 --pct 被正确初始化
    if (progressBar) {
        progressBar.value = 0;
        progressBar.dispatchEvent(new Event('input'));
    }

    // ===== 歌词/评论隐字切换 =====
    (function() {
        var lyc = document.getElementById('lyricsContainer');
        var toggleCommentsBtn = document.getElementById('toggleCommentsBtn');
        var toggleLyricsBtn = document.getElementById('toggleLyricsBtn');
        if (!lyc || !toggleCommentsBtn || !toggleLyricsBtn) return;

        // 恢复上次状态
        try {
            var state = JSON.parse(localStorage.getItem('tt-lyrics-toggle') || '{}');
            if (state.commentsHidden) lyc.classList.add('comments-hidden');
            if (state.lyricsHidden) lyc.classList.add('lyrics-hidden');
        } catch(e) {}

        function saveState() {
            try {
                localStorage.setItem('tt-lyrics-toggle', JSON.stringify({
                    commentsHidden: lyc.classList.contains('comments-hidden'),
                    lyricsHidden: lyc.classList.contains('lyrics-hidden')
                }));
            } catch(e) {}
        }

        toggleCommentsBtn.addEventListener('click', function() {
            lyc.classList.toggle('comments-hidden');
            saveState();
        });
        toggleLyricsBtn.addEventListener('click', function() {
            lyc.classList.toggle('lyrics-hidden');
            saveState();
        });
    })();
});