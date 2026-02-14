// ==========================================
// 弹幕多源增强版 v1.3.0
// 作者: User & MakkaPakka
// 功能: 6源聚合 + 智能缓存 + 自动重试 + 去重优化
// ==========================================

WidgetMetadata = {
  id: "danmu.pro.online.v6",
  title: "弹幕多源 (6源增强版)",
  version: "1.3.0",
  requiredVersion: "0.0.2",
  description: "集成6个弹幕源，智能缓存、自动重试、屏蔽词过滤、高级去重",
  author: "User & MakkaPakka",
  
  globalParams: [
    // 6个弹幕源 - 用户自行配置
    { 
      name: "server", 
      title: "源1", 
      type: "input", 
      value: "" 
    },
    { 
      name: "server2", 
      title: "源2", 
      type: "input", 
      value: "" 
    },
    { 
      name: "server3", 
      title: "源3", 
      type: "input", 
      value: "" 
    },
    { 
      name: "server4", 
      title: "源4", 
      type: "input", 
      value: "" 
    },
    { 
      name: "server5", 
      title: "源5", 
      type: "input", 
      value: "" 
    },
    { 
      name: "server6", 
      title: "源6", 
      type: "input", 
      value: "" 
    },
    
    // 屏蔽词参数
    { 
      name: "blockKeywords", 
      title: "🚫 屏蔽词 (逗号分隔)", 
      type: "input", 
      value: "" 
    },
    
    // 缓存TTL配置
    {
      name: "cacheTTL",
      title: "⏰ 缓存有效期（天）",
      type: "input",
      value: "1"
    }
  ],
  
  modules: [
    { 
      id: "searchDanmu", 
      title: "搜索", 
      functionName: "searchDanmu", 
      type: "danmu", 
      params: [] 
    },
    { 
      id: "getDetail", 
      title: "详情", 
      functionName: "getDetailById", 
      type: "danmu", 
      params: [] 
    },
    { 
      id: "getComments", 
      title: "弹幕", 
      functionName: "getCommentsById", 
      type: "danmu", 
      params: [] 
    }
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
const MAX_RETRIES = 2;        // 最大重试次数
const RETRY_DELAY = 500;      // 重试延迟（毫秒）

// ==========================================
// 基础工具函数
// ==========================================

/**
 * 获取所有有效的服务器列表
 */
function getActiveServers(params) {
  const serverKeys = ['server', 'server2', 'server3', 'server4', 'server5', 'server6'];
  return serverKeys
    .map(key => params[key])
    .filter(s => s?.trim()?.startsWith("http"))
    .map(s => s.trim().replace(/\/$/, ""));
}

/**
 * 延迟函数
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 带重试的API请求（指数退避）
 */
async function fetchAPI(url, options = {}, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await Widget.http.get(url, {
        headers: { ...DEFAULT_HEADERS, ...options.headers }
      });
      return typeof res.data === "string" ? JSON.parse(res.data) : res.data;
    } catch (e) {
      console.error(`❌ API请求失败 (尝试 ${attempt + 1}/${retries + 1}): ${url}`, e);
      
      // 最后一次尝试失败
      if (attempt === retries) {
        return null;
      }
      
      // 指数退避等待后重试
      await delay(RETRY_DELAY * Math.pow(2, attempt));
    }
  }
  return null;
}

// ==========================================
// 缓存管理
// ==========================================

/**
 * 保存ID与源的映射关系（带TTL）
 */
async function saveSource(id, url, ttlDays = 7) {
  try {
    let map = await Widget.storage.get(SOURCE_KEY);
    map = map ? JSON.parse(map) : {};
    
    map[id] = {
      url: url,
      timestamp: Date.now(),
      ttl: ttlDays * 24 * 60 * 60 * 1000
    };
    
    await Widget.storage.set(SOURCE_KEY, JSON.stringify(map));
  } catch (e) {
    console.error('❌ 保存缓存失败:', e);
  }
}

/**
 * 获取ID对应的源（检查TTL）
 */
async function getSource(id) {
  try {
    let map = await Widget.storage.get(SOURCE_KEY);
    if (!map) return null;
    
    map = JSON.parse(map);
    const cache = map[id];
    
    if (!cache) return null;
    
    // 检查是否过期
    if (Date.now() - cache.timestamp > cache.ttl) {
      console.log(`⏰ 缓存已过期: ${id}`);
      delete map[id];
      await Widget.storage.set(SOURCE_KEY, JSON.stringify(map));
      return null;
    }
    
    return cache.url;
  } catch (e) {
    console.error('❌ 读取缓存失败:', e);
    return null;
  }
}

/**
 * 清理所有过期缓存
 */
async function cleanExpiredCache() {
  try {
    let map = await Widget.storage.get(SOURCE_KEY);
    if (!map) return;
    
    map = JSON.parse(map);
    const now = Date.now();
    let cleaned = 0;
    
    for (const [id, cache] of Object.entries(map)) {
      if (now - cache.timestamp > cache.ttl) {
        delete map[id];
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      await Widget.storage.set(SOURCE_KEY, JSON.stringify(map));
      console.log(`🧹 已清理 ${cleaned} 条过期缓存`);
    }
  } catch (e) {
    console.error('❌ 清理缓存失败:', e);
  }
}

// ==========================================
// 内容处理工具
// ==========================================

/**
 * 创建屏蔽词过滤器
 */
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

/**
 * 中文数字转换
 */
function convertChineseNumber(str) {
  const map = {
    '零': 0, '一': 1, '二': 2, '三': 3, '四': 4,
    '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10
  };
  
  let result = 0, current = 0, lastUnit = 1;
  
  for (let char of str) {
    if (map[char] !== undefined && map[char] < 10) {
      current = map[char];
    } else if (map[char] !== undefined) {
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

/**
 * 提取干净的标题（去除年份、类型标记、来源）
 */
function extractCleanTitle(animeTitle) {
  return animeTitle
    .replace(/\(?\d{4}\)?/g, '')           // 去除年份
    .replace(/【.*?】/g, '')                // 去除【】标记
    .replace(/\s+from\s+\w+$/i, '')        // 去除 "from xxx"
    .replace(/\s+第[一二三四五六七八九十\d]+季/g, '')  // 去除季度
    .replace(/\s+Season\s*\d+/gi, '')      // 去除 Season X
    .trim();
}

/**
 * 提取年份
 */
function extractYear(animeTitle) {
  const match = animeTitle.match(/\((\d{4})\)|\b(\d{4})\b/);
  return match ? parseInt(match[1] || match[2]) : 0;
}

/**
 * 提取季度
 */
function extractSeason(animeTitle) {
  const patterns = [
    /第([一二三四五六七八九十]+)季/,
    /Season\s*(\d+)/i,
    /S(\d+)(?:\s|$)/i
  ];
  
  for (const pattern of patterns) {
    const match = animeTitle.match(pattern);
    if (match) {
      const seasonStr = match[1];
      // 如果是数字直接返回
      if (/^\d+$/.test(seasonStr)) {
        return parseInt(seasonStr);
      }
      // 如果是中文数字，转换
      return convertChineseNumber(seasonStr);
    }
  }
  
  return 1; // 默认第一季
}

/**
 * 基础去重（根据animeId）
 */
function deduplicateAnimes(animes) {
  const seen = new Set();
  return animes.filter(anime => {
    if (seen.has(anime.animeId)) {
      return false;
    }
    seen.add(anime.animeId);
    return true;
  });
}

/**
 * 高级去重（处理同一内容的不同版本）
 * 例如：《黑镜：潘达斯奈基(2018)》和《黑镜：潘达斯奈基(2019)》
 */
function advancedDeduplication(animes) {
  const grouped = new Map();
  
  for (const anime of animes) {
    const cleanTitle = extractCleanTitle(anime.animeTitle);
    const season = extractSeason(anime.animeTitle);
    const year = extractYear(anime.animeTitle);
    
    const key = `${cleanTitle}_S${season}`;
    
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push({ ...anime, _year: year });
  }
  
  // 每组保留年份最新的
  const result = [];
  for (const [key, items] of grouped) {
    items.sort((a, b) => b._year - a._year);
    const best = items[0];
    delete best._year;
    result.push(best);
  }
  
  return result;
}

/**
 * 清理剧集标题
 * 去除【renren】等前缀和"第X集："等格式
 */
function cleanEpisodeTitle(title) {
  return title
    .replace(/【\w+】\s*/g, '')              // 去除【renren】等
    .replace(/^第\d+集[：:]\s*/g, '')       // 去除"第X集："
    .replace(/^Episode\s*\d+[：:]\s*/i, '') // 去除"Episode X:"
    .trim();
}

/**
 * 格式化剧集对象
 */
function formatEpisode(episode) {
  return {
    ...episode,
    episodeTitle: cleanEpisodeTitle(episode.episodeTitle),
    originalTitle: episode.episodeTitle  // 保留原标题
  };
}

// ==========================================
// 核心功能模块
// ==========================================

/**
 * 搜索番剧/剧集
 * @param {Object} params - 参数对象
 * @param {string} params.title - 标题
 * @param {number} params.season - 季度（可选）
 * @param {string} params.cacheTTL - 缓存有效期（天）
 * @returns {Promise<Object>} - { animes: [...] }
 */
async function searchDanmu(params) {
  const { title, season, cacheTTL = "7" } = params;
  const servers = getActiveServers(params);
  const ttlDays = parseInt(cacheTTL) || 7;
  
  if (!servers.length) {
    console.warn('⚠️ 未配置任何有效的弹幕源，请在设置中添加');
    return { animes: [] };
  }

  // 清理过期缓存
  cleanExpiredCache();

  console.log(`🔍 开始搜索: "${title}"${season ? ` 第${season}季` : ''}`);
  console.log(`📡 使用 ${servers.length} 个弹幕源`);

  // 并发请求所有源（带重试）
  const tasks = servers.map(async (server, index) => {
    const url = `${server}${API_ENDPOINTS.SEARCH}?keyword=${encodeURIComponent(title)}`;
    console.log(`📤 源${index + 1} 请求中...`);
    
    const data = await fetchAPI(url);
    
    if (data?.success && data.animes?.length > 0) {
      console.log(`✅ 源${index + 1} 返回 ${data.animes.length} 条结果`);
      return { server, animes: data.animes };
    }
    
    console.log(`❌ 源${index + 1} 无结果`);
    return null;
  });

  const results = await Promise.all(tasks);
  let finalAnimes = [];

  // 合并所有源的结果
  for (const result of results) {
    if (result) {
      // 记录每个番剧ID对应的服务器（带TTL）
      for (const anime of result.animes) {
        await saveSource(anime.animeId, result.server, ttlDays);
      }
      finalAnimes = finalAnimes.concat(result.animes);
    }
  }

  if (finalAnimes.length === 0) {
    console.warn('⚠️ 所有源均无结果');
    return { animes: [] };
  }

  console.log(`📊 合并前: ${finalAnimes.length} 条结果`);

  // 第一步：基础去重（animeId）
  finalAnimes = deduplicateAnimes(finalAnimes);
  console.log(`🔹 基础去重后: ${finalAnimes.length} 条`);
  
  // 第二步：高级去重（处理同内容不同版本）
  finalAnimes = advancedDeduplication(finalAnimes);
  console.log(`🔹 高级去重后: ${finalAnimes.length} 条`);

  // 按季度过滤
  if (season) {
    const beforeFilter = finalAnimes.length;
    finalAnimes = finalAnimes.filter(anime => {
      return extractSeason(anime.animeTitle) === season;
    });
    console.log(`🔹 季度过滤后: ${finalAnimes.length} 条 (过滤掉 ${beforeFilter - finalAnimes.length} 条)`);
  }
  
  // 按年份降序排序（最新的在前）
  finalAnimes.sort((a, b) => {
    const yearA = extractYear(a.animeTitle);
    const yearB = extractYear(b.animeTitle);
    return yearB - yearA;
  });

  console.log(`✅ 搜索完成: 最终返回 ${finalAnimes.length} 条结果`);
  return { animes: finalAnimes };
}

/**
 * 获取番剧详情（剧集列表）
 * @param {Object} params - 参数对象
 * @param {string} params.animeId - 番剧ID
 * @param {string} params.cacheTTL - 缓存有效期（天）
 * @returns {Promise<Array>} - 剧集列表
 */
async function getDetailById(params) {
  const { animeId, cacheTTL = "7" } = params;
  const ttlDays = parseInt(cacheTTL) || 7;
  
  if (!animeId) {
    console.error('❌ 缺少 animeId 参数');
    return [];
  }
  
  console.log(`📖 获取详情: animeId=${animeId}`);
  
  // 优先从缓存中查找该ID属于哪个服务器
  let server = await getSource(animeId);
  
  if (!server) {
    // 缓存未命中，尝试所有可用源
    const servers = getActiveServers(params);
    if (!servers.length) {
      console.warn('⚠️ 未配置任何有效的弹幕源');
      return [];
    }
    server = servers[0];
    console.log(`⚠️ 缓存未命中，使用默认源: ${server}`);
  } else {
    console.log(`✅ 使用缓存源: ${server}`);
  }
  
  const url = `${server}${API_ENDPOINTS.BANGUMI}/${animeId}`;
  const data = await fetchAPI(url);
  
  if (data?.bangumi?.episodes) {
    // 清理并格式化剧集信息
    const episodes = data.bangumi.episodes.map(formatEpisode);
    
    // 保存每个剧集ID的映射
    for (const episode of episodes) {
      await saveSource(episode.episodeId, server, ttlDays);
    }
    
    console.log(`✅ 获取到 ${episodes.length} 个剧集`);
    return episodes;
  }
  
  console.error('❌ 未获取到剧集数据');
  return [];
}

/**
 * 获取弹幕列表
 * @param {Object} params - 参数对象
 * @param {string} params.commentId - 剧集ID
 * @param {string} params.blockKeywords - 屏蔽词（逗号分隔）
 * @param {string} params.cacheTTL - 缓存有效期（天）
 * @returns {Promise<Object>} - 弹幕数据
 */
async function getCommentsById(params) {
  const { commentId, blockKeywords, cacheTTL = "7" } = params;
  const ttlDays = parseInt(cacheTTL) || 7;
  
  if (!commentId) {
    console.error('❌ 缺少 commentId 参数');
    return null;
  }

  console.log(`💬 获取弹幕: commentId=${commentId}`);

  // 优先从缓存中查找该ID属于哪个服务器
  let server = await getSource(commentId);
  
  if (!server) {
    // 缓存未命中，尝试所有可用源
    const servers = getActiveServers(params);
    if (!servers.length) {
      console.warn('⚠️ 未配置任何有效的弹幕源');
      return null;
    }
    server = servers[0];
    console.log(`⚠️ 缓存未命中，使用默认源: ${server}`);
  } else {
    console.log(`✅ 使用缓存源: ${server}`);
  }
  
  const url = `${server}${API_ENDPOINTS.COMMENT}/${commentId}?withRelated=true&chConvert=0`;
  const data = await fetchAPI(url);
  
  if (!data?.comments) {
    console.error('❌ 未获取到弹幕数据');
    return data;
  }

  const originalCount = data.comments.length;
  console.log(`📊 原始弹幕数: ${originalCount}`);

  // 应用屏蔽词过滤
  const blockFilter = createBlockFilter(blockKeywords);
  if (blockFilter) {
    data.comments = data.comments.filter(comment => {
      const message = comment.m || comment.message || "";
      return !blockFilter.test(message);
    });
    
    const filteredCount = originalCount - data.comments.length;
    if (filteredCount > 0) {
      console.log(`🚫 已过滤 ${filteredCount} 条弹幕（屏蔽词生效）`);
    }
  }
  
  console.log(`✅ 最终弹幕数: ${data.comments.length}`);
  return data;
}
