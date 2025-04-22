class BalanceController {
  constructor() {
    this.elements = {
      apiKeyInput: document.getElementById('apiKeyInput'),
      apiKeyStatus: document.getElementById('apiKeyStatus'),
      refreshInterval: document.getElementById('refreshInterval'),
      saveBtn: document.getElementById('saveBtn'),
      refreshBtn: document.getElementById('refreshBtn'),
      settingsStatus: document.getElementById('settingsStatus'),
      balanceAmount: document.getElementById('balanceAmount'),
      toppedUp: document.getElementById('toppedUp'),
      granted: document.getElementById('granted'),
      updateTime: document.getElementById('updateTime'),
      mainView: document.getElementById('mainView'),
      settingsView: document.getElementById('settingsView'),
    };

    // 检查是否有未找到的元素
    for (const [key, value] of Object.entries(this.elements)) {
      if (!value) {
        console.error(`元素未找到: ${key}`);
      }
    }
  }

  async init() {
    try {
      console.log('初始化开始'); // 调试日志

      // 从本地存储读取 API Key 和刷新间隔
      const { apiKey, refreshInterval } = await chrome.storage.local.get(['apiKey', 'refreshInterval']);

      // 设置刷新间隔输入框的值
      const interval = refreshInterval || 5; // 如果本地存储没有值，默认为 5
      this.elements.refreshInterval.value = interval;

      if (!apiKey) {
        this.showApiKeyStatus('API Key 未设置', 'error');
        this.elements.refreshBtn.disabled = true; // 禁用刷新按钮
        this.updateUI(null); // 清空余额显示
      } else {
        this.showApiKeyStatus('API Key 已设置', 'success');
        this.elements.refreshBtn.disabled = false; // 启用刷新按钮

        // 自动刷新余额
        console.log('检测到已保存的 API Key，自动刷新余额...');
        await this.refreshBalance(true); // 初始化时刷新余额
      }

      console.log('初始化完成'); // 调试日志
    } catch (error) {
      console.error('初始化失败:', error);
      this.showError('初始化失败: ' + error.message);
    }
  }

  switchView(view) {
    const views = [this.elements.mainView, this.elements.settingsView];
    views.forEach(v => v.style.display = 'none');
    view.style.display = 'block';
  }

  showSettings() {
    this.switchView(this.elements.settingsView);
  }

  showMainView() {
    this.switchView(this.elements.mainView);
  }

  async refreshBalance(isInitialLoad = false) {
    if (this.isLoading) return;

    try {
      this.isLoading = true;
      this.setLoading(true);

      const balance = await this.sendMessage('forceRefresh');
      this.cachedData = balance;
      this.updateUI(balance);

      if (!isInitialLoad) {
        this.showSuccess('刷新成功', 2000);
      }
    } catch (error) {
      console.error('刷新失败:', error);

      if (error.message.includes('API Key未设置')) {
        this.showError('请先设置 API Key', 0);
        this.showSettings();
      } else if (error.message.includes('网络错误')) {
        this.showError('网络错误，请检查网络连接');
      } else {
        this.showError('刷新失败: ' + error.message);
      }

      // 显示缓存数据（如果存在）
      if (this.cachedData) {
        this.updateUI(this.cachedData);
      }
    } finally {
      this.isLoading = false;
      this.setLoading(false);
    }
  }

  async saveSettings() {
    console.log('保存设置按钮被点击'); // 调试日志
    const apiKey = this.elements.apiKeyInput.value.trim();
    let refreshInterval = parseInt(this.elements.refreshInterval.value, 10);

    if (isNaN(refreshInterval) || refreshInterval < 1 || refreshInterval > 1440) {
      this.showError('刷新间隔必须在 1 到 1440 分钟之间');
      return;
    }

    this.elements.saveBtn.disabled = true;

    try {
      // 如果用户输入了 API Key，则验证并保存
      if (apiKey) {
        const response = await this.sendMessage('validateApiKey', { apiKey });
        if (!response.success) {
          throw new Error('API Key 无效，请检查后重试');
        }

        // 保存 API Key
        await this.sendMessage('setApiKey', { key: apiKey });

        // 清空旧的余额显示
        this.updateUI(null);
        this.showApiKeyStatus('API Key 已设置', 'success');
      }

      // 保存刷新间隔
      await this.sendMessage('setRefreshInterval', { interval: refreshInterval });

      this.showSuccess('设置已保存');

      // 如果 API Key 被设置，刷新余额
      if (apiKey) {
        this.showMainView();
        await this.refreshBalance();
      }
    } catch (error) {
      console.error('保存设置失败:', error);
      this.showError('保存设置失败: ' + error.message);
    } finally {
      this.elements.saveBtn.disabled = false;
    }
  }

  showApiKeyStatus(message, type) {
    this.elements.apiKeyStatus.textContent = message;
    this.elements.apiKeyStatus.className = `status-message ${type}`;
  }

  updateUI(balance) {
    if (!balance || !balance.total) {
      this.elements.balanceAmount.textContent = '--.--';
      this.elements.toppedUp.textContent = '--.--';
      this.elements.granted.textContent = '--.--';
      this.elements.updateTime.textContent = '最后更新: --';
      return;
    }

    this.elements.balanceAmount.textContent = balance.total;
    this.elements.toppedUp.textContent = balance.toppedUp;
    this.elements.granted.textContent = balance.granted;
    this.elements.updateTime.textContent = 
      `最后更新: ${new Date(balance.lastUpdated).toLocaleTimeString()}`;
  }

  setLoading(isLoading, text = '加载中...') {
    this.elements.refreshBtn.disabled = isLoading;
    this.elements.refreshBtn.textContent = isLoading ? text : '立即刷新';
  }

  async sendMessage(action, data = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action, ...data }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  showError(message, duration = 5000) {
    const el = this.elements.settingsStatus;
    el.textContent = message;
    el.className = 'status-message error';
    if (duration > 0) {
      setTimeout(() => {
        el.textContent = '';
        el.className = 'status-message';
      }, duration);
    }
  }

  showSuccess(message, duration = 3000) {
    const el = this.elements.settingsStatus;
    el.textContent = message;
    el.className = 'status-message success';
    if (duration > 0) {
      setTimeout(() => {
        el.textContent = '';
        el.className = 'status-message';
      }, duration);
    }
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  const controller = new BalanceController();
  controller.init();

  // 使用箭头函数绑定事件，确保 `this` 指向正确的实例
  document.getElementById('saveBtn').addEventListener('click', () => controller.saveSettings());
  document.getElementById('refreshBtn').addEventListener('click', () => controller.refreshBalance());
  document.getElementById('settingsBtn').addEventListener('click', () => controller.showSettings());
  document.getElementById('backBtn').addEventListener('click', () => controller.showMainView());

  const emailLink = document.querySelector('.email-link');

  emailLink.addEventListener('click', (event) => {
    event.preventDefault(); // 阻止默认跳转行为

    const email = emailLink.getAttribute('data-email');
    if (!email) return;

    // 将邮箱地址复制到剪贴板
    navigator.clipboard.writeText(email).then(() => {
      // 添加动画效果
      emailLink.classList.add('copied');
      emailLink.textContent = 'copied！';

      // 恢复原始状态
      setTimeout(() => {
        emailLink.classList.remove('copied');
        emailLink.innerHTML = `
          <svg class="footer-icon" viewBox="0 0 24 24">
            <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
          </svg>
           Email
        `;
      }, 2000); // 2秒后恢复
    }).catch((error) => {
      console.error('复制失败:', error);
    });
  });
});
