class BalanceController {
  constructor() {
    this.cachedData = null;
    this.isLoading = false;
    this.initElements();
    this.initEventListeners();
    this.loadInitialData();
  }

  initElements() {
    this.elements = {
      balanceAmount: document.getElementById('balanceAmount'),
      toppedUp: document.getElementById('toppedUp'),
      granted: document.getElementById('granted'),
      updateTime: document.getElementById('updateTime'),
      refreshBtn: document.getElementById('refreshBtn'),
      settingsBtn: document.getElementById('settingsBtn'),
      settingsView: document.getElementById('settingsView'),
      apiKeyInput: document.getElementById('apiKeyInput'),
      refreshInterval: document.getElementById('refreshInterval'),
      saveBtn: document.getElementById('saveBtn'),
      backBtn: document.getElementById('backBtn'),
      settingsStatus: document.getElementById('settingsStatus')
    };
  }

  initEventListeners() {
    this.elements.refreshBtn.addEventListener('click', () => this.refreshBalance());
    this.elements.settingsBtn.addEventListener('click', () => this.showSettings());
    this.elements.backBtn.addEventListener('click', () => this.hideSettings());
    this.elements.saveBtn.addEventListener('click', () => this.saveSettings());
  }

  async loadInitialData() {
    try {
      const { balance, hasApiKey } = await this.sendMessage('getBalance');
      this.cachedData = balance || null;
      
      if (this.cachedData) {
        this.updateUI(this.cachedData);
      }
      
      if (!hasApiKey) {
        this.showError('请先设置API Key', 0);
        this.showSettings();
      } else {
        await this.refreshBalance(true);
      }
    } catch (error) {
      console.error('初始化失败:', error);
      this.showError('初始化失败: ' + error.message);
    }
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
        this.showError('请先设置API Key', 0);
        this.showSettings();
      } else {
        this.showError('刷新失败: ' + error.message);
      }
      
      if (this.cachedData) {
        this.updateUI(this.cachedData);
      }
    } finally {
      this.isLoading = false;
      this.setLoading(false);
    }
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

  async showSettings() {
    try {
      const { apiKey, refreshInterval } = await chrome.storage.local.get(['apiKey', 'refreshInterval']);
      this.elements.apiKeyInput.value = apiKey || '';
      this.elements.refreshInterval.value = refreshInterval || 5;
      this.elements.settingsView.style.display = 'block';
      document.getElementById('mainView').style.display = 'none';
    } catch (error) {
      console.error('获取设置失败:', error);
      this.showError('获取设置失败: ' + error.message);
    }
  }

  hideSettings() {
    this.elements.settingsView.style.display = 'none';
    document.getElementById('mainView').style.display = 'block';
    this.clearStatus();
  }

  async saveSettings() {
    try {
      this.setLoading(true, '保存中...');
      
      const apiKey = this.elements.apiKeyInput.value.trim();
      const refreshInterval = Math.max(1, Math.min(1440, 
        parseInt(this.elements.refreshInterval.value) || 5));
      
      if (!apiKey) {
        throw new Error('API Key不能为空');
      }
      
      await this.sendMessage('setApiKey', { key: apiKey });
      await this.sendMessage('setRefreshInterval', { interval: refreshInterval });
      
      this.showSuccess('设置保存成功', 1000);
      await this.refreshBalance();
      
      setTimeout(() => {
        this.hideSettings();
      }, 1000);
    } catch (error) {
      console.error('保存失败:', error);
      this.showError('保存失败: ' + error.message);
    } finally {
      this.setLoading(false);
    }
  }

  setLoading(isLoading, text = '加载中...') {
    const btn = this.elements.refreshBtn;
    btn.disabled = isLoading;
    btn.innerHTML = isLoading ? 
      `<span class="spin">⏳</span> ${text}` : 
      `🔁 立即刷新`;
  }

  showSuccess(message, duration = 3000) {
    const el = this.elements.settingsStatus;
    el.textContent = message;
    el.className = 'status-message success';
    if (duration > 0) {
      setTimeout(() => this.clearStatus(), duration);
    }
  }

  showError(message, duration = 5000) {
    const el = this.elements.settingsStatus;
    el.textContent = message;
    el.className = 'status-message error';
    if (duration > 0) {
      setTimeout(() => this.clearStatus(), duration);
    }
  }

  clearStatus() {
    this.elements.settingsStatus.textContent = '';
    this.elements.settingsStatus.className = 'status-message';
  }

  async sendMessage(action, data = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action, ...data },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        }
      );
    });
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  const controller = new BalanceController();
  
  // 当弹窗重新获得焦点时刷新
  window.addEventListener('focus', async () => {
    const mainView = document.getElementById('mainView');
    if (mainView && mainView.style.display !== 'none') {
      await controller.refreshBalance();
    }
  });

  // 邮箱点击复制
  const emailLink = document.querySelector('.email-link');
  if (emailLink) {
    emailLink.addEventListener('click', (e) => {
      e.preventDefault();
      navigator.clipboard.writeText('2423129650@qq.com').then(() => {
        const originalText = emailLink.innerHTML;
        emailLink.innerHTML = '✓ 已复制';
        setTimeout(() => {
          emailLink.innerHTML = originalText;
        }, 2000);
      }).catch(err => {
        console.error('复制失败:', err);
      });
    });
  }
});
