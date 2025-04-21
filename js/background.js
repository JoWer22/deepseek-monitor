console.log('Service Worker 启动');
chrome.runtime.onInstalled.addListener((details) => {
  console.log('扩展已安装:', details);
});
chrome.runtime.onStartup.addListener(() => {
  console.log('扩展已启动');
});

const API_URL = "https://api.deepseek.com/user/balance";
const DEFAULT_INTERVAL = 5; // 默认5分钟刷新一次

// 状态管理
let currentBalance = {
  total: null,
  toppedUp: null,
  granted: null,
  lastUpdated: null
};

let encryptionKey = null;

// 动态生成加密密钥
async function generateEncryptionKey() {
  const keyData = crypto.getRandomValues(new Uint8Array(32)); // 生成 32 字节随机密钥
  encryptionKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
  console.log('加密密钥已生成');
}

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

chrome.runtime.onStartup.addListener(async () => {
  console.log('扩展启动，重新初始化...');
  await generateEncryptionKey();
  startAutoRefresh();
});

// 清理旧的明文 API Key
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get(['apiKey'], (result) => {
    if (result.apiKey && typeof result.apiKey === 'string') {
      chrome.storage.local.remove('apiKey', () => {
        console.log('已清理旧的明文 API Key');
      });
    }
  });
});

// 定时刷新
function startAutoRefresh() {
  chrome.storage.local.get('refreshInterval', ({ refreshInterval }) => {
    const interval = Math.max(1, refreshInterval || DEFAULT_INTERVAL); // 确保最小值为1
    chrome.alarms.clear('autoRefresh', () => {
      chrome.alarms.create('autoRefresh', {
        periodInMinutes: interval
      });
    });
  });
}

// 消息处理
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handleRequest = async () => {
    try {
      switch (request.action) {
        case 'forceRefresh':
          return await fetchBalance();
        case 'validateApiKey': {
          const isValid = await validateApiKey(request.apiKey);
          return { success: isValid };
        }
        case 'getBalance': {
          const apiKey = await getApiKey();
          return {
            balance: currentBalance,
            hasApiKey: !!apiKey
          };
        }
        case 'setApiKey':
          await storeApiKey(request.key);
          return await fetchBalance();
        case 'setRefreshInterval':
          await chrome.storage.local.set({ refreshInterval: request.interval });
          startAutoRefresh();
          return true;
        default:
          console.error('[onMessage] 未知的请求类型:', request.action);
          throw new Error(`未知的请求类型: ${request.action}`);
      }
    } catch (error) {
      console.error('[onMessage] 消息处理失败:', error);
      return { error: error.message };
    }
  };

  handleRequest().then(sendResponse).catch((error) => {
    sendResponse({ error: error.message });
  });
  return true; // 保持消息通道开放
});

async function validateApiKey(apiKey) {
  try {
    const response = await fetch(API_URL, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('无效的 API Key');
      }
      throw new Error(`API 请求失败，状态码: ${response.status}`);
    }
    return true;
  } catch (error) {
    console.error('验证 API Key 失败:', error);
    throw new Error('网络错误，无法验证 API Key');
  }
}

// 获取余额
async function fetchBalance() {
  try {
    const apiKey = await getApiKey();
    if (!apiKey) {
      updateBadge('NO KEY');
      throw new Error('API Key 未设置');
    }

    const response = await fetch(API_URL, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    if (!response.ok) {
      throw new Error(`API 请求失败，状态码: ${response.status}`);
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
    console.error('[fetchBalance] 获取余额失败:', error.message || error);
    updateBadge(error.message.includes('未设置') ? 'NO KEY' : 'ERR');

    // 通知前台错误信息
    chrome.runtime.sendMessage({
      action: 'balanceError',
      error: error.message
    });

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
  if (isNaN(balanceNum)) {
    console.error('无效的余额状态:', state);
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setTitle({ title: '无效的余额状态' });
    return;
  }

  let displayText;
  if (balanceNum >= 1000) {
    displayText = Math.round(balanceNum / 1000) + 'k';
  } else if (state.toString().length <= 4) {
    displayText = state.toString();
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
chrome.alarms.create('keepAlive', { periodInMinutes: 4 }); // 每4分钟触发一次

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    chrome.storage.local.get(null, () => {
      if (chrome.runtime.lastError) {
        console.error('保持活跃失败:', chrome.runtime.lastError.message);
      }
    });
  }
});

// 定时刷新处理
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'autoRefresh') {
    fetchBalance().catch(console.error);
  }
});

chrome.storage.local.get('apiKey', (result) => {
  if (chrome.runtime.lastError) {
    console.error('获取存储失败:', chrome.runtime.lastError.message);
    return;
  }
  if (result.apiKey) {
    console.log('API Key 已成功加载'); // 不打印具体的 API Key
  } else {
    console.warn('API Key 未设置');
  }
});

// 在加密和解密时使用内存中的密钥
async function encryptApiKey(apiKey) {
  if (!encryptionKey) {
    throw new Error('加密密钥未初始化');
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    encryptionKey,
    new TextEncoder().encode(apiKey)
  );
  return { encrypted: new Uint8Array(encrypted), iv };
}

async function decryptApiKey(encrypted, iv) {
  if (!encryptionKey) {
    throw new Error('加密密钥未初始化');
  }
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    encryptionKey,
    encrypted
  );
  return new TextDecoder().decode(decrypted);
}

// 存储加密后的 API Key
async function storeApiKey(apiKey) {
  const { encrypted, iv } = await encryptApiKey(apiKey);
  chrome.storage.local.set({
    apiKey: Array.from(encrypted), // 确保存储为数组格式
    iv: Array.from(iv) // 确保存储为数组格式
  });
  console.log('API Key 已加密并存储');
}

// 获取并解密 API Key
async function getApiKey() {
  const { apiKey, iv } = await chrome.storage.local.get(['apiKey', 'iv']);
  if (!apiKey || !iv) {
    console.error('未找到加密的 API Key 或 IV');
    return null;
  }

  try {
    await ensureEncryptionKeyInitialized(); // 确保密钥已初始化
    const decrypted = await decryptApiKey(new Uint8Array(apiKey), new Uint8Array(iv));
    // console.log('API Key 解密成功:', decrypted);
    return decrypted;
  } catch (error) {
    console.error('解密 API Key 失败:', error);
    return null;
  }
}

async function sendMessage(action, data = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action, ...data }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response && response.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}

async function ensureEncryptionKeyInitialized() {
  if (!encryptionKey) {
    console.warn('加密密钥未初始化，正在生成...');
    await generateEncryptionKey();
  }
}

generateEncryptionKey();

