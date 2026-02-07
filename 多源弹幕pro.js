WidgetMetadata = {
  id: "danmu.pro.online.v6",
  title: "弹幕多源 (6源增强版)",
  version: "1.2.0",
  requiredVersion: "0.0.2",
  description: "集成6个弹幕源，支持屏蔽词过滤",
  author: "User & MakkaPakka",
  
  globalParams: [
    // 6个弹幕源
    { name: "server", title: "源1 (6565n)", type: "input", value: "https://dmapi.6565n.xyz" },
    { name: "server2", title: "源2 (Logvar)", type: "input", value: "https://danmuapisteven.vercel.app" },
    { name: "server3", title: "源3 (直连)", type: "input", value: "https://logvar.steven037.top" },
    { name: "server4", title: "源4 (御坂)", type: "input", value: "http://123.206.194.65:7768/api/v1/rKWrJjNHEc6mxrQFLQ3t" },
    { name: "server5", title: "源5 (Appp)", type: "input", value: "https://danmu.appp.pp.ua/danmuapi" },
    { name: "server6", title: "源6 (Keji)", type: "input", value: "https://danmu.kejiland.ggff.net/kejiland" },
    
    // 屏蔽词参数
    { 
      name: "blockKeywords", 
      title: "🚫 屏蔽词 (逗号分隔)", 
      type: "input", 
      value: "" 
    }
  ],
  
  modules: [
    { id: "searchDanmu", title: "搜索", functionName: "searchDanmu", type: "danmu", params: [] },
    { id: "getDetail", title: "详情", functionName: "getDetailById", type: "danmu", params: [] },
    { id: "getComments", title: "弹幕", functionName: "getCommentsById", type: "danmu", params: [] }
  ]
};

// ==========================================
// 常量定义
// ==========================================
const SOURCE_KEY = "dm_source_map_v6";
const API_ENDPOINTS = {
  SEARCH: '/api/v2/search/anime',
  BANGUMI: '/api/v2/bangumi',
  COMMENT: '/api/v2/comment'
};
const DEFAULT_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": "ForwardWidgets/2.0"
};

// ==========================================
// 工具函数
// ==========================================

// 获取所有有效的服务器列表
function getActiveServers(params) {
  const serverKeys = ['server', 'server2', 'server3', 'server4', 'server5', 'server6'];
  return serverKeys
    .map(key => params[key])
    .filter(s => s?.startsWith("http"))
    .map(s => s.replace(/\/$/, ""));
}

// 统一的API请求封装
async function fetchAPI(url, options = {}) {
  try {
    const res = await Widget.http.get(url, {
      headers: { ...DEFAULT_HEADERS, ...options.headers }
    });
    return typeof res.data === "string" ? JSON.parse(res.data) : res.data;
  } catch (e) {
    console.error(`API request failed: ${url}`, e);
    return null;
  }
}

// 保存番剧/剧集ID与服务器的映射关系
async function saveSource(id, url) {
  try {
    let map = await Widget.storage.get(SOURCE_KEY);
    map = map ? JSON.parse(map) : {};
    map[id] = url;
    await Widget.storage.set(SOURCE_KEY, JSON.stringify(map));
  } catch (e) {
    console.error('Failed to save source:', e);
  }
}

// 获取番剧/剧集ID对应的服务器
async function getSource(id) {
  try {
    let map = await Widget.storage.get(SOURCE_KEY);
    return map ? JSON.parse(map)[id] : null;
  } catch (e) {
    console.error('Failed to get source:', e);
    return null;
  }
}

// 创建屏蔽词过滤器
function createBlockFilter(blockKeywords) {
  if (!blockKeywords?.trim()) return null;
  
  const keywords = blockKeywords
    .split(/[,，]/)
    .map(k => k.trim())
    .filter(k => k.length > 0);
  
  if (keywords.length === 0) return null;
  
  // 转义特殊字符并创建正则表达式
  const escaped = keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(escaped.join('|'), 'i');
}

// 中文数字转换
function convertChineseNumber(str) {
  const map = {
    '零': 0, '一': 1, '二': 2, '三': 3, '四': 4,
    '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10
  };
  
  let result = 0, current = 0, lastUnit = 1;
  
  for (let char of str) {
    if (map[char] < 10) {
      current = map[char];
    } else {
      const unit = map[char];
      if (current === 0) current = 1;
      if (unit >= lastUnit) {
        result = current * unit;
      } else {
        result += current * unit;
      }
      lastUnit = unit;
      current = 0;
    }
  }
  
  return result + current;
}

// 过滤番剧列表（按季度匹配）
function filterAnimesBySeason(animes, title, season) {
  if (!season) return animes;
  
  return animes.filter(anime => {
    if (!anime.animeTitle.includes(title)) return false;
    
    const parts = anime.animeTitle.split(" ");
    for (let part of parts) {
      // 匹配阿拉伯数字
      const numMatch = part.match(/\d+/);
      if (numMatch && parseInt(numMatch[0]) === season) return true;
      
      // 匹配中文数字
      const cnMatch = part.match(/[一二三四五六七八九十]+/);
      if (cnMatch && convertChineseNumber(cnMatch[0]) === season) return true;
    }
    
    // 完全匹配且第一季
    return anime.animeTitle.trim() === title.trim() && season === 1;
  });
}

// ==========================================
// 核心功能
// ==========================================

async function searchDanmu(params) {
  const { title, season } = params;
  const servers = getActiveServers(params);
  
  if (!servers.length) {
    console.warn('No valid servers configured');
    return { animes: [] };
  }

  // 并发请求所有源
  const tasks = servers.map(async (server) => {
    const url = `${server}${API_ENDPOINTS.SEARCH}?keyword=${encodeURIComponent(title)}`;
    const data = await fetchAPI(url);
    
    if (data?.success && data.animes?.length > 0) {
      return { server, animes: data.animes };
    }
    return null;
  });

  const results = await Promise.all(tasks);
  let finalAnimes = [];

  // 合并所有源的结果
  for (const result of results) {
    if (result) {
      // 记录每个番剧ID对应的服务器
      for (const anime of result.animes) {
        await saveSource(anime.animeId, result.server);
      }
      finalAnimes = finalAnimes.concat(result.animes);
    }
  }

  // 按季度过滤
  if (finalAnimes.length > 0 && season) {
    const matched = filterAnimesBySeason(finalAnimes, title, season);
    if (matched.length > 0) {
      finalAnimes = matched;
    }
  }

  return { animes: finalAnimes };
}

async function getDetailById(params) {
  const { animeId } = params;
  
  if (!animeId) {
    console.error('Missing animeId parameter');
    return [];
  }
  
  // 优先从缓存中查找该ID属于哪个服务器
  let server = await getSource(animeId) || params.server;
  
  const url = `${server}${API_ENDPOINTS.BANGUMI}/${animeId}`;
  const data = await fetchAPI(url);
  
  if (data?.bangumi?.episodes) {
    // 记录每个剧集ID对应的服务器
    for (const episode of data.bangumi.episodes) {
      await saveSource(episode.episodeId, server);
    }
    return data.bangumi.episodes;
  }
  
  return [];
}

async function getCommentsById(params) {
  const { commentId, blockKeywords } = params;
  
  if (!commentId) {
    console.error('Missing commentId parameter');
    return null;
  }

  // 优先从缓存中查找该ID属于哪个服务器
  let server = await getSource(commentId) || params.server;
  
  const url = `${server}${API_ENDPOINTS.COMMENT}/${commentId}?withRelated=true&chConvert=0`;
  const data = await fetchAPI(url);
  
  if (!data?.comments) return data;

  // 应用屏蔽词过滤
  const blockFilter = createBlockFilter(blockKeywords);
  if (blockFilter) {
    data.comments = data.comments.filter(comment => {
      const message = comment.m || comment.message || "";
      return !blockFilter.test(message);
    });
  }
  
  return data;
}
