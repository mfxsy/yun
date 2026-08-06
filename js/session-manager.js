// js/session-manager.js
(function() {
    'use strict';

    const APP_PREFIX = 'CHAT_APP_V3_';
    let sessionList = [];
    let currentSessionId = null;

    // ========== 增强的存储读写（增加 localStorage 双备份） ==========
    async function loadSessionList() {
        try {
            // 1. 优先从 IndexedDB (localforage) 读取
            const data = await localforage.getItem(APP_PREFIX + 'sessionList');
            if (data && Array.isArray(data)) {
                sessionList = data;
                // 同步备份到 localStorage
                try {
                    localStorage.setItem(APP_PREFIX + 'sessionList_backup', JSON.stringify(sessionList));
                } catch (e) {}
                return;
            }
        } catch (e) {
            // IndexedDB 读取失败，忽略
        }

        // 2. 若 IndexedDB 无数据或失败，尝试从 localStorage 备份恢复
        try {
            const backup = localStorage.getItem(APP_PREFIX + 'sessionList_backup');
            if (backup) {
                const parsed = JSON.parse(backup);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    sessionList = parsed;
                    // 将恢复的数据写回 IndexedDB，重建连接
                    await localforage.setItem(APP_PREFIX + 'sessionList', sessionList);
                    return;
                }
            }
        } catch (e) {}

        // 3. 完全无数据
        sessionList = [];
    }

    async function saveSessionList() {
        try {
            await localforage.setItem(APP_PREFIX + 'sessionList', sessionList);
            // 同时备份到 localStorage
            try {
                localStorage.setItem(APP_PREFIX + 'sessionList_backup', JSON.stringify(sessionList));
            } catch (e) {}
        } catch (e) {
            // 降级：仅保存到 localStorage
            try {
                localStorage.setItem(APP_PREFIX + 'sessionList_backup', JSON.stringify(sessionList));
            } catch (e2) {}
        }
    }

    async function loadLastSessionId() {
        // 从 IndexedDB 读取
        try {
            const id = await localforage.getItem(APP_PREFIX + 'lastSessionId');
            if (id) return id;
        } catch (e) {}
        // 从 localStorage 备份读取
        try {
            return localStorage.getItem(APP_PREFIX + 'lastSessionId_backup');
        } catch (e) {}
        return null;
    }

    async function saveLastSessionId(id) {
        try {
            await localforage.setItem(APP_PREFIX + 'lastSessionId', id);
            localStorage.setItem(APP_PREFIX + 'lastSessionId_backup', id);
        } catch (e) {
            localStorage.setItem(APP_PREFIX + 'lastSessionId_backup', id);
        }
    }

    // ========== 会话操作核心函数 ==========
    async function createNewSession(name) {
        const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
        const newSession = {
            id: id,
            name: name || ('会话 ' + (sessionList.length + 1)),
            createdAt: Date.now()
        };
        sessionList.push(newSession);
        await saveSessionList();
        return id;
    }

    const sessionManager = {
        /**
         * 初始化会话（增强版）：
         * 1. 从强韧的双备份存储中恢复列表和上次ID
         * 2. 严格按优先级决定当前会话，绝不自动新建（除非列表为空）
         */
        async initializeSession() {
            await loadSessionList();

            // 1) URL Hash 优先
            const hash = window.location.hash.substring(1);
            if (hash && sessionList.some(s => s.id === hash)) {
                currentSessionId = hash;
                if (window.location.hash !== '#' + currentSessionId) {
                    history.replaceState(null, '', '#' + currentSessionId);
                }
                await saveLastSessionId(currentSessionId);
                return currentSessionId;
            }

            // 2) 恢复最后使用的会话 ID（带备份）
            const lastId = await loadLastSessionId();
            if (lastId && sessionList.some(s => s.id === lastId)) {
                currentSessionId = lastId;
                if (window.location.hash !== '#' + currentSessionId) {
                    history.replaceState(null, '', '#' + currentSessionId);
                }
                await saveLastSessionId(currentSessionId);
                return currentSessionId;
            }

            // 3) 取列表第一个（存在且有数据的场景）
            if (sessionList.length > 0) {
                currentSessionId = sessionList[0].id;
                if (window.location.hash !== '#' + currentSessionId) {
                    history.replaceState(null, '', '#' + currentSessionId);
                }
                await saveLastSessionId(currentSessionId);
                return currentSessionId;
            }

            // 4) 完全无会话 → 新建（仅在新浏览器/新设备首次使用时触发）
            const newId = await createNewSession('我的会话');
            currentSessionId = newId;
            if (window.location.hash) {
                history.replaceState(null, '', window.location.pathname + window.location.search);
            }
            history.replaceState(null, '', '#' + currentSessionId);
            await saveLastSessionId(currentSessionId);
            return currentSessionId;
        },

        async switchSession(sessionId) {
            if (sessionId === currentSessionId) return;
            currentSessionId = sessionId;
            window.location.hash = sessionId;
            await saveLastSessionId(sessionId);
            document.dispatchEvent(new CustomEvent('sessionChanged', { detail: { sessionId } }));
        },

        async createNewSession(name) {
            return await createNewSession(name);
        },

        async createAndSwitch(name) {
            const newId = await createNewSession(name);
            await this.switchSession(newId);
            return newId;
        },

        async deleteSession(sessionId) {
            if (sessionList.length <= 1) {
                throw new Error('至少保留一个会话');
            }
            const keys = await localforage.keys();
            const prefix = APP_PREFIX + sessionId + '_';
            const toRemove = keys.filter(k => k.startsWith(prefix));
            for (const k of toRemove) {
                await localforage.removeItem(k);
            }
            sessionList = sessionList.filter(s => s.id !== sessionId);
            await saveSessionList();
            if (sessionId === currentSessionId) {
                const first = sessionList[0];
                if (first) {
                    await this.switchSession(first.id);
                }
            }
        },

        async renameSession(sessionId, newName) {
            const session = sessionList.find(s => s.id === sessionId);
            if (session) {
                session.name = newName.trim() || session.name;
                await saveSessionList();
                return true;
            }
            return false;
        },

        getCurrentSessionId() {
            return currentSessionId;
        },

        getSessionList() {
            return sessionList;
        },

        renderSessionList(containerId) {
            // ... (此部分可保持原样，无需改动) ...
            const container = document.getElementById(containerId);
            if (!container) return;
            if (sessionList.length === 0) {
                container.innerHTML = `<div class="card-empty"><p>暂无会话</p></div>`;
                return;
            }
            let html = '';
            sessionList.forEach(s => {
                const active = s.id === currentSessionId ? 'active' : '';
                html += `
                    <div class="card-item" data-id="${s.id}" style="${active ? 'border-color:var(--wechat-green);background:rgba(var(--wechat-green-rgb),0.05);' : ''}">
                        <span class="card-text" style="font-weight:${active ? '600' : '400'};">${s.name}</span>
                        <div class="card-actions">
                            ${active ? `<span style="font-size:11px;color:var(--wechat-green);font-weight:600;">当前</span>` : `<button class="switch-session-btn" data-id="${s.id}" style="background:none;border:none;color:var(--wechat-green);cursor:pointer;font-size:13px;">切换</button>`}
                            <button class="rename-session-btn" data-id="${s.id}" style="background:none;border:none;color:var(--wechat-text-secondary);cursor:pointer;font-size:13px;" title="重命名"><i class="fas fa-pen"></i></button>
                            <button class="del-session-btn" data-id="${s.id}" style="background:none;border:none;color:#fa5151;cursor:pointer;font-size:13px;"><i class="fas fa-trash-alt"></i></button>
                        </div>
                    </div>
                `;
            });
            container.innerHTML = html;
            // ... (事件绑定部分可保持原样) ...
        }
    };

    window.sessionManager = sessionManager;
})();