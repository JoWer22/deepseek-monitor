const API_URL = "https://api.deepseek.com/user/balance";
const DEFAULT_INTERVAL = 5; // 默认5分钟刷新一次

// 状态管理
let currentBalance = {
  total: null,
  toppedUp: null,
  granted: null,
  lastUpdated: null
};

// 初始化
chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.local.set({
    apiKey: '',
    refreshInterval: DEFAULT_INTERVAL
  });
  
  // 首次安装时打开GitHub页面
  if (details.reason === 'install') {
    chrome.tabs.create({
      url: "https://github.com/JoWer22/deepseek-monitor.git#readme"
    });
  }
  
  startAutoRefresh();
});

// 定时刷新
function startAutoRefresh() {
  chrome.storage.local.get('refreshInterval', ({ refreshInterval }) => {
    chrome.alarms.create('autoRefresh', {
      periodInMinutes: refreshInterval || DEFAULT_INTERVAL
    });
  });
}

// 消息处理
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handleRequest = async () => {
    switch (request.action) {
      case 'forceRefresh':
        return await fetchBalance();
      case 'getBalance':
        const { apiKey } = await chrome.storage.local.get('apiKey');
        return { 
          balance: currentBalance,
          hasApiKey: !!apiKey
        };
      case 'getCache':
        return currentBalance;
      case 'setApiKey':
        await chrome.storage.local.set({ apiKey: request.key });
        return await fetchBalance();
      case 'setRefreshInterval':
        await chrome.storage.local.set({ refreshInterval: request.interval });
        startAutoRefresh();
        return true;
    }
  };

  handleRequest().then(sendResponse);
  return true; // 保持消息端口开放
});

// 获取余额
async function fetchBalance() {
  try {
    const { apiKey } = await chrome.storage.local.get('apiKey');
    if (!apiKey) {
      updateBadge('NO KEY');
      throw new Error('API Key未设置');
    }

    const response = await fetch(API_URL, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    
    if (!response.ok) {
      throw new Error(`API请求失败: ${response.status}`);
    }

    const data = await response.json();
    const cnyBalance = data.balance_infos.find(b => b.currency === "CNY") || {};

    currentBalance = {
      total: parseFloat(cnyBalance.total_balance || 0).toFixed(2),
      toppedUp: parseFloat(cnyBalance.topped_up_balance || 0).toFixed(2),
      granted: parseFloat(cnyBalance.granted_balance || 0).toFixed(2),
      lastUpdated: new Date().toISOString()
    };

    updateBadge(currentBalance.total);
    return currentBalance;
  } catch (error) {
    console.error('获取余额失败:', error);
    updateBadge(error.message.includes('未设置') ? 'NO KEY' : 'ERR');
    throw error;
  }
}

// 更新徽章显示
function updateBadge(state) {
  if (state === 'NO KEY') {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#FFA500' });
    chrome.action.setTitle({ title: '未设置API Key' });
    return;
  }

  if (state === 'ERR') {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setTitle({ title: '获取余额失败' });
    return;
  }

  const balanceNum = parseFloat(state);
  let displayText;
  
  if (balanceNum >= 1000) {
    displayText = Math.round(balanceNum / 1000) + 'k';
  } else if (state.length <= 4) {
    displayText = state;
  } else {
    displayText = balanceNum.toFixed(1);
  }

  chrome.action.setBadgeText({ text: displayText });
  chrome.action.setBadgeBackgroundColor({
    color: balanceNum < 10 ? '#FF6B6B' : '#4ECDC4'
  });
  chrome.action.setTitle({ 
    title: `余额: ${state} CNY | 最后更新: ${new Date().toLocaleTimeString()}`
  });
}

// 保持Service Worker活跃
setInterval(() => {
  chrome.storage.local.get('apiKey', () => {});
}, 1000 * 30); // 每30秒唤醒一次

// 定时刷新处理
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'autoRefresh') {
    fetchBalance().catch(console.error);
  }
});
