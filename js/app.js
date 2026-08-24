// 应用启动入口

document.addEventListener('DOMContentLoaded', async function() {
    try {
        // 1. 初始化会话（确保 SESSION_ID 永不丢失）
        const sessionId = await window.sessionManager.initializeSession();
        window.SESSION_ID = sessionId;
        console.log('[app] 已获取会话ID:', window.SESSION_ID);

        // 2. 加载各模块设置（容错加载）
        if (window.frequencyManager) {
            await window.frequencyManager.load();
        }
        if (window.quoteManager && typeof window.quoteManager.loadSettings === 'function') {
            await window.quoteManager.loadSettings();
        }
        await loadTimestampSetting();
        await loadNoReplySetting();
        await loadNotificationSetting();

        // 3. 加载数据（使用安全存储）
        const hasData = await loadMessages();
        if (!hasData) {
            window.messages = [];
        }

        // 4. 刷新各管理器
        if (window.avatarManager && typeof window.avatarManager.reload === 'function') {
            await window.avatarManager.reload();
        }
        if (window.emojiManager && typeof window.emojiManager.reload === 'function') {
            await window.emojiManager.reload();
        }
        if (window.cardManager && typeof window.cardManager.reload === 'function') {
            await window.cardManager.reload();
        }
        if (window.callManager && typeof window.callManager.checkCallInterruption === 'function') {
            await window.callManager.checkCallInterruption();
        }

        // 5. 应用主题
        if (window.isDark) {
            document.documentElement.setAttribute('data-theme', 'dark');
            if (DOM.themeToggle) DOM.themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
        }

        // =========================================================
        // ★★★ 重点：在此处加入懒加载状态初始化配置 ★★★
        // =========================================================
        window.loadedBatchCount = 1;
        window._currentRenderedCount = 0;
        window._hasLoadedAll = false;
        // =========================================================

        // 6. 更新界面
        if (DOM.contactName) DOM.contactName.textContent = window.partnerName;
        renderMessages();

        // 7. 启动主动发送定时器
        if (window.frequencyManager) {
            window.frequencyManager.startActiveTimer(() => {
                window.triggerReply(true);
            });
        }

        // 8. 更新底部留白
        updateChatPadding();

        // ★ 新增：检查并补发主动发送欠下的消息
        catchUpActiveSends();

        // 9. 键盘滚动优化
        let prevInnerHeight = window.innerHeight;
        window.addEventListener('resize', function() {
            if (window.innerHeight > prevInnerHeight) {
                requestAnimationFrame(() => {
                    updateChatPadding();
                    scrollToBottom();
                });
            }
            prevInnerHeight = window.innerHeight;
        });
        if (window.visualViewport) {
            let prevViewportHeight = window.visualViewport.height;
            window.visualViewport.addEventListener('resize', function() {
                const currentHeight = window.visualViewport.height;
                if (currentHeight > prevViewportHeight) {
                    requestAnimationFrame(() => {
                        updateChatPadding();
                        scrollToBottom();
                    });
                }
                prevViewportHeight = currentHeight;
            });
        }

        // 10. 定时保存与页面退出保存
        setInterval(() => saveMessages(), 30000);
        window.addEventListener('beforeunload', () => saveMessages());

        // 11. 聚焦输入框
        if (DOM.msgInput) DOM.msgInput.focus();

        console.log('✅ 应用启动完成，会话ID:', window.SESSION_ID);

    } catch (e) {
        console.error('严重初始化错误，但应用仍可降级运行', e);
        renderMessages();
        showToast('启动时遇到问题，但基本功能可用', 'warning', 4000);
    } finally {
        // ★ 极其关键：不论前面的代码有没有报错，都必须强行绑定所有按钮事件，保证不出现“按键失灵”
        if (typeof setupEventListeners === 'function') {
            setupEventListeners();
            console.log('✅ 事件绑定安全执行完成');
        }
    }
});

// ★ 新增：补发主动发送欠下的消息（修复 window.settings 未定义报错）
function catchUpActiveSends() {
    // 获取 frequencyManager 实例
    const fm = window.frequencyManager;
    if (!fm) return;

    // ★ 修复：获取 frequencyManager 中保存的主动发送设置
    const fmSettings = fm.getSettings();
    if (!fmSettings.activeEnabled) return;

    const lastTime = fm.getLastActiveSendTime();
    const interval = fmSettings.activeInterval * 60 * 1000; // 转毫秒
    if (!lastTime || Date.now() - lastTime < interval) return; // 不足一个周期，无需补发

    // 计算错过次数，最多补发5条
    let missedCount = Math.floor((Date.now() - lastTime) / interval);
    missedCount = Math.min(missedCount, 5);

    // 依次补发，每条间隔1秒
    for (let i = 0; i < missedCount; i++) {
        setTimeout(() => {
            if (typeof window.triggerReply === 'function') {
                window.triggerReply(true); // 使用主动模式触发回复
            }
        }, i * 1000);
    }

    // 更新上次发送时间为当前时间（避免重复补发）
    fm.setLastActiveSendTime(Date.now());
}