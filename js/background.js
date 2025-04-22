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
    { name: 'AES-CBC' },
    false,
    ['encrypt', 'decrypt']
  );
  console.log('加密密钥已生成');

  // 将密钥存储为 Base64 字符串
  chrome.storage.local.set({ encryptionKey: btoa(String.fromCharCode(...keyData)) });
}

// 初始化
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('插件已安装:', details);
  await ensureEncryptionKeyInitialized(); // 确保密钥已初始化

  // 初始化默认设置（仅在首次安装时设置默认值）
  if (details.reason === 'install') {
    chrome.storage.local.set({
      apiKey: '',
      refreshInterval: DEFAULT_INTERVAL // 默认刷新间隔为 5 分钟
    });
  }

  // 检查是否有 API Key
  const { apiKey, refreshInterval } = await chrome.storage.local.get(['apiKey', 'refreshInterval']);
  if (apiKey) {
    console.log('检测到已保存的 API Key，自动刷新余额...');
    console.log(`读取到的刷新间隔为 ${refreshInterval || DEFAULT_INTERVAL} 分钟`);
    startAutoRefresh(refreshInterval || DEFAULT_INTERVAL); // 启动定时刷新
    try {
      await fetchBalance(); // 自动刷新余额
      console.log('余额刷新成功');
    } catch (error) {
      console.error('自动刷新余额失败:', error.message);
    }
  } else {
    console.warn('未检测到 API Key，无法自动刷新余额');
  }


  // 首次安装时打开 GitHub 页面
  if (details.reason === 'install') {
    chrome.tabs.create({
      url: "https://github.com/JoWer22/deepseek-monitor.git#readme"
    });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('浏览器启动，插件初始化...');
  await ensureEncryptionKeyInitialized(); // 确保密钥已初始化

  // 检查是否有 API Key 和刷新间隔
  const { apiKey, refreshInterval } = await chrome.storage.local.get(['apiKey', 'refreshInterval']);
  if (apiKey) {
    console.log('检测到已保存的 API Key，自动刷新余额...');
    try {
      await fetchBalance(); // 自动刷新余额
      console.log('余额刷新成功');
    } catch (error) {
      console.error('自动刷新余额失败:', error.message);
    }
  } else {
    console.warn('未检测到 API Key，无法自动刷新余额');
  }

  console.log(`读取到的刷新间隔为 ${refreshInterval || DEFAULT_INTERVAL} 分钟`);
  startAutoRefresh(refreshInterval || DEFAULT_INTERVAL); // 启动定时刷新
});

// 清理旧的明文 API Key
// chrome.runtime.onStartup.addListener(() => {
//   chrome.storage.local.get(['apiKey'], (result) => {
//     if (result.apiKey && typeof result.apiKey === 'string') {
//       chrome.storage.local.remove('apiKey', () => {
//         console.log('已清理旧的明文 API Key');
//       });
//     }
//   });
// });

// 定时刷新
function startAutoRefresh(interval) {
  const refreshInterval = Math.max(1, parseInt(interval, 10) || DEFAULT_INTERVAL); // 确保最小值为 1 分钟
  chrome.alarms.clear('autoRefresh', () => {
    chrome.alarms.create('autoRefresh', {
      periodInMinutes: refreshInterval
    });
    console.log(`定时刷新已启动，间隔为 ${refreshInterval} 分钟`);
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
          // 清空旧的相关配置，包括 IV 和加密密钥
          await chrome.storage.local.remove(['encryptionKey', 'iv', 'apiKey']);
          console.log('旧的加密密钥和 IV 已清除');

          // 存储新的 API Key，尝试加载新的加载密钥
          await generateEncryptionKey();
          await storeApiKey(request.key);
         
          // 返回新的余额信息
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
  const iv = crypto.getRandomValues(new Uint8Array(16)); // 生成 16 字节随机 IV
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv },
    encryptionKey,
    new TextEncoder().encode(apiKey)
  );
  console.log('加密时生成的 IV:', iv);
  return { encrypted: new Uint8Array(encrypted), iv };
}

async function decryptApiKey(encrypted, iv) {
  if (!encryptionKey) {
    throw new Error('加密密钥未初始化');
  }
  console.log('开始解密');
  console.log('解密密钥是:', encryptionKey);
  console.log('解密时使用的 IV:', iv);
  console.log('解密时使用的加密数据:', encrypted);

  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-CBC', iv },
      encryptionKey,
      encrypted
    );
    console.log('解密成功');
    return new TextDecoder().decode(decrypted);
  } catch (error) {
    console.error('解密失败:', error);
    throw error;
  }
}

// 存储加密后的 API Key
async function storeApiKey(apiKey) {
  const { encrypted, iv } = await encryptApiKey(apiKey);

  console.log('存储前的加密数据:', encrypted);
  console.log('存储前的 IV:', iv);

  await setStorage('apiKey', btoa(String.fromCharCode(...encrypted)));
  await setStorage('iv', btoa(String.fromCharCode(...iv)));
  console.log('API Key 和 IV 已加密并存储');
}

// 获取并解密 API Key
async function getApiKey() {
  const { apiKey, iv } = await getStorage(['apiKey', 'iv']);
  console.log('加载到的加密数据:', apiKey);
  console.log('加载到的 IV:', iv);

  if (!apiKey || !iv) {
    console.error('未找到加密的 API Key 或 IV');
    return null;
  }

  try {
    await ensureEncryptionKeyInitialized(); // 确保密钥已初始化

    const encrypted = new Uint8Array(atob(apiKey).split('').map(char => char.charCodeAt(0)));
    const ivArray = new Uint8Array(atob(iv).split('').map(char => char.charCodeAt(0)));

    console.log('解密前的加密数据:', encrypted);
    console.log('解密前的 IV:', ivArray);

    const decrypted = await decryptApiKey(encrypted, ivArray);
    console.log('API Key 解密成功:', decrypted);
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
    console.warn('加密密钥未初始化，尝试从存储加载...');
    const { encryptionKey: storedKey } = await getStorage(['encryptionKey']);
    if (storedKey) {
      const keyData = new Uint8Array(atob(storedKey).split('').map(char => char.charCodeAt(0)));
      encryptionKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'AES-CBC' },
        false,
        ['encrypt', 'decrypt']
      );
      console.log('加密密钥已从存储加载');
    } else {
      console.warn('存储中未找到加密密钥，生成新的密钥...');
      await generateEncryptionKey(); // 如果没有密钥，则生成新的密钥
    }
  } else {
    console.log('加密密钥已初始化');
  }
}

async function getApiKeyWithRetry(retries = 3, delay = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await getApiKey();
    } catch (error) {
      console.warn(`获取 API Key 失败，重试第 ${attempt}/${retries} 次:`, error);
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
}

function setStorage(key, value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

function getStorage(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

