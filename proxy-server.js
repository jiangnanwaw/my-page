const express = require('express');
const sql = require('mssql');
const mysql = require('mysql2/promise');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const wechatLogin = require('./wechat-login');

const app = express();
const PORT = 3009;

// 启用CORS以允许前端访问
app.use(cors());
app.use(express.json());

// 托管静态文件（前端页面）
app.use(express.static(path.resolve(__dirname)));

// 日志文件路径
const LOG_FILE = path.join(__dirname, 'query-logs.txt');

// 日志函数
function logToFile(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;

    // 同时输出到控制台和文件
    console.log(message);

    // 追加到日志文件
    fs.appendFile(LOG_FILE, logMessage, (err) => {
        if (err) console.error('写入日志文件失败:', err);
    });
}

// SQL Server 数据库配置 (使用端口方式连接)
const dbConfig = {
    server: 'csfhcdz.f3322.net',
    port: 1433,
    database: 'chargingdata',
    user: 'csfh',
    password: 'fh123456',
    options: {
        encrypt: false, // SQL Server 2008 R2 不需要加密
        trustServerCertificate: true,
        enableArithAbort: true,
        connectTimeout: 30000
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    },
    requestTimeout: 60000
};

// MySQL 数据库配置 (用于未充电时长统计)
const mysqlConfig = {
    host: 'localhost',
    port: 3306,
    user: 'repair_admin',
    password: 'password123',
    database: 'module_repair_system',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 30000
};

const moduleRepairConfig = {
    baseUrl: 'https://api.csfh.asia/api',
    adminPhone: '15616000858',
    adminPassword: 'fh123456'
};

let reportAuthToken = null;
let reportAuthTokenExpiresAt = 0;

function padNumber(value) {
    return String(value).padStart(2, '0');
}

function formatDateForApi(date) {
    return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`;
}

function formatDateForDisplay(dateStr) {
    const datePart = String(dateStr || '').split(' ')[0];
    const parts = datePart.split('-');
    if (parts.length >= 3) {
        return `${padNumber(parts[1])}-${padNumber(parts[2])}`;
    }
    return datePart;
}

function parseNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

function getCurrentMonthRange() {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
        month: `${now.getFullYear()}-${padNumber(now.getMonth() + 1)}`,
        startDate: formatDateForApi(startDate),
        endDate: formatDateForApi(now)
    };
}

function createApiUrl(pathname, params = {}) {
    const url = new URL(pathname, moduleRepairConfig.baseUrl + '/');
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, String(value));
        }
    });
    return url;
}

function apiRequest(method, pathname, { headers = {}, body = null, params = {} } = {}) {
    const url = createApiUrl(pathname, params);
    return new Promise((resolve, reject) => {
        const request = https.request(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...headers
            }
        }, (response) => {
            let rawData = '';
            response.on('data', chunk => {
                rawData += chunk;
            });
            response.on('end', () => {
                let parsedData = null;
                try {
                    parsedData = rawData ? JSON.parse(rawData) : null;
                } catch (parseError) {
                    return reject(new Error(`解析接口响应失败: ${parseError.message}`));
                }

                if (response.statusCode >= 200 && response.statusCode < 300) {
                    resolve(parsedData);
                } else {
                    const message = parsedData?.message || parsedData?.error || `HTTP ${response.statusCode}`;
                    const error = new Error(message);
                    error.statusCode = response.statusCode;
                    error.response = parsedData;
                    reject(error);
                }
            });
        });

        request.on('error', reject);
        request.setTimeout(30000, () => {
            request.destroy(new Error('请求超时'));
        });

        if (body) {
            request.write(JSON.stringify(body));
        }
        request.end();
    });
}

async function getReportAuthToken(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && reportAuthToken && now < reportAuthTokenExpiresAt) {
        return reportAuthToken;
    }

    logToFile('[历史数据] 正在获取报表接口认证令牌');
    const loginResult = await apiRequest('POST', 'auth/admin-login', {
        body: {
            phone: moduleRepairConfig.adminPhone,
            password: moduleRepairConfig.adminPassword
        }
    });

    const token = loginResult?.data?.token;
    if (!token) {
        throw new Error('报表接口登录成功但未返回token');
    }

    reportAuthToken = token;
    reportAuthTokenExpiresAt = now + 50 * 60 * 1000;
    return reportAuthToken;
}

async function fetchStationHistory(station, token, range) {
    return apiRequest('GET', 'reports/history-detail', {
        headers: {
            Authorization: `Bearer ${token}`
        },
        params: {
            station,
            startDate: range.startDate,
            endDate: range.endDate,
            limit: 100,
            offset: 0,
            sortBy: 'date',
            sortOrder: 'desc'
        }
    });
}

function mapStationName(source) {
    const lowerSource = String(source || '').toLowerCase();
    if (lowerSource === 'didi') return '长沙飞狐四方坪站';
    if (lowerSource === 'teld') return '长沙飞狐高岭站';
    return source || '';
}

function normalizeHistoryRows(rows) {
    return rows.map(item => ({
        rawDate: String(item.date || '').split(' ')[0],
        date: formatDateForDisplay(item.date),
        stationKey: item.source || '',
        station: mapStationName(item.source),
        charge: parseNumber(item.electricity),
        totalIncome: parseNumber(item.totalAmount),
        income: parseNumber(item.serviceFee),
        orders: parseNumber(item.count)
    })).filter(item => item.rawDate);
}

function sortHistoryRows(rows) {
    return rows.sort((a, b) => {
        if (a.rawDate === b.rawDate) {
            if (a.stationKey === b.stationKey) return 0;
            if (a.stationKey === 'didi') return -1;
            if (b.stationKey === 'didi') return 1;
            return a.station.localeCompare(b.station, 'zh-CN');
        }
        return b.rawDate.localeCompare(a.rawDate);
    });
}

// 创建连接池
let pool = null;
let mysqlPool = null;

// 初始化SQL Server数据库连接池
async function initializePool() {
    try {
        if (pool) {
            await pool.close();
        }
        pool = await sql.connect(dbConfig);
        logToFile('✓ SQL Server数据库连接池已建立');
        return pool;
    } catch (err) {
        logToFile('✗ SQL Server数据库连接失败: ' + err.message);
        throw err;
    }
}

// 初始化MySQL数据库连接池
async function initializeMySQLPool() {
    try {
        if (mysqlPool) {
            await mysqlPool.end();
        }
        mysqlPool = mysql.createPool(mysqlConfig);
        logToFile('✓ MySQL数据库连接池已建立');
        return mysqlPool;
    } catch (err) {
        logToFile('✗ MySQL数据库连接失败: ' + err.message);
        throw err;
    }
}

// 处理SQL查询请求
app.post('/', async (req, res) => {
    const startTime = Date.now();

    try {
        const { query } = req.body;

        if (!query) {
            return res.status(400).json({
                error: 'Missing query parameter',
                message: '请求体中缺少query参数'
            });
        }

        logToFile(`\n收到查询请求`);
        logToFile('SQL: ' + query.substring(0, 200) + (query.length > 200 ? '...' : ''));

        // 确保连接池存在
        if (!pool || !pool.connected) {
            logToFile('重新建立数据库连接...');
            await initializePool();
        }

        // 执行查询
        const result = await pool.request().query(query);

        const duration = Date.now() - startTime;
        logToFile(`✓ 查询成功 (${duration}ms), 返回 ${result.recordset.length} 条记录`);

        // 返回结果 (使用与腾讯云函数相同的格式)
        res.json({
            success: true,
            results: result.recordset,  // 前端期望的字段名是 results，不是 data
            rowCount: result.recordset.length,
            duration: duration
        });

    } catch (err) {
        const duration = Date.now() - startTime;
        logToFile(`✗ 查询失败 (${duration}ms): ${err.message}`);

        // 如果是连接错误，尝试重新连接
        if (err.message.includes('Connection') || err.message.includes('ECONNRESET')) {
            logToFile('检测到连接错误，尝试重新建立连接...');
            try {
                await initializePool();
            } catch (reconnectErr) {
                logToFile('重新连接失败: ' + reconnectErr.message);
            }
        }

        res.status(500).json({
            error: err.message,
            code: err.code,
            state: err.state,
            message: '数据库查询失败: ' + err.message
        });
    }
});

// 健康检查端点
app.get('/health', async (req, res) => {
    try {
        if (!pool || !pool.connected) {
            return res.status(503).json({
                status: 'unhealthy',
                message: '数据库连接未建立'
            });
        }

        // 测试查询
        await pool.request().query('SELECT 1 as test');

        res.json({
            status: 'healthy',
            message: '服务运行正常',
            database: 'connected'
        });
    } catch (err) {
        res.status(503).json({
            status: 'unhealthy',
            message: err.message
        });
    }
});

// 查看日志端点
app.get('/logs', (req, res) => {
    const lines = parseInt(req.query.lines) || 100;

    fs.readFile(LOG_FILE, 'utf8', (err, data) => {
        if (err) {
            return res.status(404).json({
                error: '日志文件不存在',
                message: '请先执行一些查询以生成日志'
            });
        }

        const logLines = data.split('\n').filter(line => line.trim());
        const recentLogs = logLines.slice(-lines);

        res.json({
            total: logLines.length,
            showing: recentLogs.length,
            logs: recentLogs
        });
    });
});

// 本月历史充电数据接口
app.get('/api/local/monthly-charge-history', async (req, res) => {
    const startTime = Date.now();
    const range = getCurrentMonthRange();

    try {
        logToFile(`[历史数据] 开始拉取本月数据 ${range.startDate} ~ ${range.endDate}`);

        let token = await getReportAuthToken();
        let didiResult;
        let teldResult;

        try {
            [didiResult, teldResult] = await Promise.all([
                fetchStationHistory('didi', token, range),
                fetchStationHistory('teld', token, range)
            ]);
        } catch (error) {
            if (error.statusCode === 401) {
                logToFile('[历史数据] 认证令牌失效，正在刷新后重试');
                token = await getReportAuthToken(true);
                [didiResult, teldResult] = await Promise.all([
                    fetchStationHistory('didi', token, range),
                    fetchStationHistory('teld', token, range)
                ]);
            } else {
                throw error;
            }
        }

        const didiRows = Array.isArray(didiResult?.data) ? didiResult.data : [];
        const teldRows = Array.isArray(teldResult?.data) ? teldResult.data : [];
        const data = sortHistoryRows(normalizeHistoryRows([...didiRows, ...teldRows]));
        const duration = Date.now() - startTime;

        logToFile(`[历史数据] 本月数据拉取成功 (${duration}ms), 共 ${data.length} 条`);
        res.json({
            success: true,
            month: range.month,
            startDate: range.startDate,
            endDate: range.endDate,
            data
        });
    } catch (err) {
        const duration = Date.now() - startTime;
        logToFile(`[历史数据] 本月数据拉取失败 (${duration}ms): ${err.message}`);
        res.status(500).json({
            success: false,
            message: err.message || '加载本月历史数据失败'
        });
    }
});

// 实时汇总数据接口（本月、本年度充电数据）
app.get('/api/local/realtime-summary', async (req, res) => {
    const startTime = Date.now();
    const scope = req.query.scope || 'all'; // 从查询参数获取站点，默认为 'all'
    const detailDate = req.query.detailDate; // 可选：指定日期获取小时明细 (yyyy-mm-dd)

    try {
        logToFile(`[实时汇总] 开始拉取实时汇总数据 (站点: ${scope}, 日期: ${detailDate || '今日'})`);

        let token = await getReportAuthToken();
        let result;

        const params = { scope: scope };
        if (detailDate) {
            params.detailDate = detailDate;
        }

        try {
            result = await apiRequest('GET', 'reports/realtime-summary', {
                headers: {
                    Authorization: `Bearer ${token}`
                },
                params: params
            });
        } catch (error) {
            if (error.statusCode === 401) {
                logToFile('[实时汇总] 认证令牌失效，正在刷新后重试');
                token = await getReportAuthToken(true);
                result = await apiRequest('GET', 'reports/realtime-summary', {
                    headers: {
                        Authorization: `Bearer ${token}`
                    },
                    params: params
                });
            } else {
                throw error;
            }
        }

        const duration = Date.now() - startTime;
        logToFile(`[实时汇总] 数据拉取成功 (${duration}ms, 站点: ${scope}, 日期: ${detailDate || '今日'})`);

        res.json({
            success: true,
            data: result.data
        });
    } catch (err) {
        const duration = Date.now() - startTime;
        logToFile(`[实时汇总] 数据拉取失败 (${duration}ms, 站点: ${scope}, 日期: ${detailDate || '今日'}): ${err.message}`);
        res.status(500).json({
            success: false,
            message: err.message || '加载实时汇总数据失败'
        });
    }
});

// 获取指定日期的小时明细数据（用于用户充电行为分析）
app.get('/api/local/hourly-details', async (req, res) => {
    const startTime = Date.now();
    const scope = req.query.scope || 'all';
    const date = req.query.date; // yyyy-mm-dd 格式

    try {
        if (!date) {
            return res.status(400).json({
                success: false,
                message: '缺少日期参数'
            });
        }

        logToFile(`[小时明细] 开始拉取小时明细数据 (站点: ${scope}, 日期: ${date})`);

        let token = await getReportAuthToken();

        // 使用 history-detail API 获取指定日期的数据
        const startDate = date;
        const endDate = date;

        let result;
        try {
            result = await apiRequest('GET', 'reports/history-detail', {
                headers: {
                    Authorization: `Bearer ${token}`
                },
                params: {
                    station: scope === 'all' ? undefined : scope,
                    startDate: startDate,
                    endDate: endDate,
                    limit: 100,
                    offset: 0,
                    sortBy: 'date',
                    sortOrder: 'desc'
                }
            });
        } catch (error) {
            if (error.statusCode === 401) {
                logToFile('[小时明细] 认证令牌失效，正在刷新后重试');
                token = await getReportAuthToken(true);
                result = await apiRequest('GET', 'reports/history-detail', {
                    headers: {
                        Authorization: `Bearer ${token}`
                    },
                    params: {
                        station: scope === 'all' ? undefined : scope,
                        startDate: startDate,
                        endDate: endDate,
                        limit: 100,
                        offset: 0,
                        sortBy: 'date',
                        sortOrder: 'desc'
                    }
                });
            } else {
                throw error;
            }
        }

        const duration = Date.now() - startTime;
        logToFile(`[小时明细] 数据拉取成功 (${duration}ms, 站点: ${scope}, 日期: ${date})`);

        // 返回数据
        res.json({
            success: true,
            date: date,
            scope: scope,
            data: result.data || []
        });
    } catch (err) {
        const duration = Date.now() - startTime;
        logToFile(`[小时明细] 数据拉取失败 (${duration}ms, 站点: ${scope}, 日期: ${date}): ${err.message}`);
        res.status(500).json({
            success: false,
            message: err.message || '加载小时明细数据失败'
        });
    }
});

// ==================== 微信小程序扫码登录接口 ====================
// 设置日志函数
wechatLogin.setLogger(logToFile);

// 生成登录二维码
app.get('/api/wechat/qrcode', wechatLogin.generateQRCode);

// 小程序扫码登录
app.post('/api/wechat/scan-login', wechatLogin.scanLogin);

// 查询登录状态
app.get('/api/wechat/login-status', wechatLogin.checkLoginStatus);

// 扫码跳转页面
app.get('/wechat-scan', wechatLogin.scanPage);

// ==================== 未充电时长统计接口 ====================
// 获取未充电终端列表
app.get('/api/local/uncharged-terminals', async (req, res) => {
    const startTime = Date.now();

    try {
        logToFile('[未充电时长统计] 开始查询未充电终端数据');

        // 确保MySQL连接池存在
        if (!mysqlPool) {
            logToFile('初始化MySQL数据库连接...');
            await initializeMySQLPool();
        }

        // SQL查询：合并 didi 和 teld 两个表的数据
        const query = `
            SELECT
                station_name AS stationName,
                gun_id AS terminalName,
                MAX(charge_end_time) AS lastEndTime,
                NOW() AS currentTime
            FROM didi_order_detail_3days
            WHERE charge_end_time IS NOT NULL
            GROUP BY station_name, gun_id

            UNION ALL

            SELECT
                '长沙飞狐高岭站' AS stationName,
                terminal_name AS terminalName,
                last_charge_end_time AS lastEndTime,
                NOW() AS currentTime
            FROM teld_terminal_last_charge
            WHERE last_charge_end_time IS NOT NULL

            ORDER BY stationName, terminalName
        `;

        const [rows] = await mysqlPool.query(query);

        // 处理数据：计算未充电时长
        const data = rows.map(row => {
            const lastEndTime = row.lastEndTime ? new Date(row.lastEndTime) : null;
            const currentTime = new Date(row.currentTime);

            // 计算时长（小时）
            let duration = 0;
            if (lastEndTime) {
                duration = (currentTime - lastEndTime) / (1000 * 60 * 60);
            }

            // 格式化日期时间为 yyyy-mm-dd hh:mm:ss
            const formatDateTime = (date) => {
                if (!date) return '';
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                const hours = String(date.getHours()).padStart(2, '0');
                const minutes = String(date.getMinutes()).padStart(2, '0');
                const seconds = String(date.getSeconds()).padStart(2, '0');
                return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
            };

            return {
                stationName: row.stationName || '',
                terminalName: row.terminalName || '',
                lastEndTime: formatDateTime(lastEndTime),
                stillUnchargedTime: formatDateTime(currentTime),
                duration: Math.max(0, duration)
            };
        });

        const duration = Date.now() - startTime;
        logToFile(`[未充电时长统计] 查询成功 (${duration}ms), 返回 ${data.length} 条记录`);

        res.json({
            success: true,
            data: data,
            count: data.length,
            duration: duration
        });

    } catch (err) {
        const duration = Date.now() - startTime;
        logToFile(`[未充电时长统计] 查询失败 (${duration}ms): ${err.message}`);

        // 如果是连接错误，尝试重新连接
        if (err.message.includes('Connection') || err.code === 'PROTOCOL_CONNECTION_LOST') {
            logToFile('检测到MySQL连接错误，尝试重新建立连接...');
            try {
                await initializeMySQLPool();
            } catch (reconnectErr) {
                logToFile('MySQL重新连接失败: ' + reconnectErr.message);
            }
        }

        res.status(500).json({
            success: false,
            message: err.message || '查询未充电终端数据失败',
            error: err.message
        });
    }
});

// 获取经营效率分析可用日期列表
app.get('/api/local/efficiency-available-dates', async (req, res) => {
    const startTime = Date.now();

    try {
        logToFile(`[经营效率分析] 开始查询可用日期列表`);

        // 查询两个表中都有数据的日期（取交集）
        const [rows] = await mysqlPool.query(
            `SELECT DISTINCT t.date
            FROM teld_history_summary t
            INNER JOIN didi_history_summary d ON t.date = d.date
            WHERE t.date IS NOT NULL
            ORDER BY t.date DESC
            LIMIT 90`
        );

        const dates = rows.map(row => row.date);

        const duration = Date.now() - startTime;
        logToFile(`[经营效率分析] 可用日期查询成功 (${duration}ms, 共${dates.length}天)`);

        res.json({
            success: true,
            dates: dates
        });
    } catch (err) {
        const duration = Date.now() - startTime;
        logToFile(`[经营效率分析] 可用日期查询失败 (${duration}ms): ${err.message}`);

        res.status(500).json({
            success: false,
            message: err.message || '查询可用日期失败',
            error: err.message
        });
    }
});

// 获取经营效率分析数据（日数据）
app.get('/api/local/efficiency-analysis-daily', async (req, res) => {
    const startTime = Date.now();
    const date = req.query.date; // yyyy-mm-dd 格式

    try {
        if (!date) {
            return res.status(400).json({
                success: false,
                message: '缺少date参数'
            });
        }

        logToFile(`[经营效率分析-日数据] 开始查询数据 (日期: ${date})`);

        // 查询高岭站数据 (teld_history_summary)
        const [teldRows] = await mysqlPool.query(
            `SELECT
                total_count,
                total_electricity,
                total_service_fee,
                total_duration
            FROM teld_history_summary
            WHERE date = ?`,
            [date]
        );

        // 查询四方坪站数据 (didi_history_summary)
        const [didiRows] = await mysqlPool.query(
            `SELECT
                order_count,
                electricity,
                service_fee,
                duration_text
            FROM didi_history_summary
            WHERE date = ?`,
            [date]
        );

        const teldData = teldRows[0] || {};
        const didiData = didiRows[0] || {};

        // 四方坪站：将duration_text转换为分钟
        let didiTotalMinutes = 0;
        if (didiData.duration_text) {
            // 格式：342小时1分9秒
            const match = didiData.duration_text.match(/(\d+)小时(\d+)分(\d+)秒/);
            if (match) {
                const hours = parseInt(match[1]) || 0;
                const minutes = parseInt(match[2]) || 0;
                const seconds = parseInt(match[3]) || 0;
                didiTotalMinutes = hours * 60 + minutes + seconds / 60;
            }
        }

        // 高岭站计算 (36个充电枪)
        const teldDailyDuration = (teldData.total_duration || 0) / 36;
        const teldDailyUtilization = (teldDailyDuration / 1440).toFixed(4);  // 返回小数，前端会乘100
        const teldDailyElectricity = ((teldData.total_electricity || 0) / 36).toFixed(2);
        const teldDailyRevenue = ((teldData.total_service_fee || 0) / 36).toFixed(2);
        const teldTotalDuration = teldData.total_duration || 0;
        const teldAvgPower = teldTotalDuration > 0 ? ((teldData.total_electricity || 0) / (teldTotalDuration / 60)).toFixed(2) : '0.00';
        const teldDailyOrders = ((teldData.total_count || 0) / 36).toFixed(2);

        // 四方坪站计算 (142个充电枪)
        const didiDailyDuration = didiTotalMinutes / 142;
        const didiDailyUtilization = (didiDailyDuration / 1440).toFixed(4);  // 返回小数，前端会乘100
        const didiDailyElectricity = ((didiData.electricity || 0) / 142).toFixed(2);
        const didiDailyRevenue = ((didiData.service_fee || 0) / 142).toFixed(2);
        const didiAvgPower = didiTotalMinutes > 0 ? ((didiData.electricity || 0) / (didiTotalMinutes / 60)).toFixed(2) : '0.00';
        const didiDailyOrders = ((didiData.order_count || 0) / 142).toFixed(2);

        const duration = Date.now() - startTime;
        logToFile(`[经营效率分析-日数据] 数据查询成功 (${duration}ms, 日期: ${date})`);

        res.json({
            success: true,
            data: {
                gaolin: {
                    dailyDuration: teldDailyDuration.toFixed(2),
                    dailyUtilization: teldDailyUtilization,
                    dailyElectricity: teldDailyElectricity,
                    dailyRevenue: teldDailyRevenue,
                    avgPower: teldAvgPower,
                    dailyOrders: teldDailyOrders
                },
                sifangping: {
                    dailyDuration: didiDailyDuration.toFixed(2),
                    dailyUtilization: didiDailyUtilization,
                    dailyElectricity: didiDailyElectricity,
                    dailyRevenue: didiDailyRevenue,
                    avgPower: didiAvgPower,
                    dailyOrders: didiDailyOrders
                }
            }
        });
    } catch (err) {
        const duration = Date.now() - startTime;
        logToFile(`[经营效率分析-日数据] 数据查询失败 (${duration}ms): ${err.message}`);

        res.status(500).json({
            success: false,
            message: err.message || '查询经营效率分析日数据失败',
            error: err.message
        });
    }
});

// 获取经营效率分析数据（月数据）
app.get('/api/local/efficiency-analysis', async (req, res) => {
    const startTime = Date.now();
    const month = req.query.month; // yyyy-mm 格式

    try {
        if (!month) {
            return res.status(400).json({
                success: false,
                message: '缺少month参数'
            });
        }

        logToFile(`[经营效率分析] 开始查询数据 (月份: ${month})`);

        // 计算当月天数
        const [year, monthNum] = month.split('-').map(Number);
        const daysInMonth = new Date(year, monthNum, 0).getDate();

        // 查询高岭站数据 (teld_history_summary)
        const [teldRows] = await mysqlPool.query(
            `SELECT
                SUM(total_count) as total_count,
                SUM(total_electricity) as total_electricity,
                SUM(total_service_fee) as total_service_fee,
                SUM(total_duration) as total_duration
            FROM teld_history_summary
            WHERE DATE_FORMAT(date, '%Y-%m') = ?`,
            [month]
        );

        // 查询四方坪站数据 (didi_history_summary)
        const [didiRows] = await mysqlPool.query(
            `SELECT
                SUM(order_count) as order_count,
                SUM(electricity) as electricity,
                SUM(service_fee) as service_fee,
                SUM(
                    CAST(SUBSTRING_INDEX(duration_text, '小时', 1) AS UNSIGNED) * 60 +
                    CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(duration_text, '分', 1), '小时', -1) AS UNSIGNED) +
                    CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(duration_text, '秒', 1), '分', -1) AS UNSIGNED) / 60
                ) as total_duration_minutes
            FROM didi_history_summary
            WHERE DATE_FORMAT(date, '%Y-%m') = ?`,
            [month]
        );

        const teldData = teldRows[0] || {};
        const didiData = didiRows[0] || {};

        // 高岭站计算 (36个充电枪)
        const teldDailyDuration = (teldData.total_duration || 0) / daysInMonth / 36;
        const teldDailyUtilization = (teldDailyDuration / 1440).toFixed(4);  // 返回小数，前端会乘100
        const teldDailyElectricity = ((teldData.total_electricity || 0) / daysInMonth / 36).toFixed(2);
        const teldDailyRevenue = ((teldData.total_service_fee || 0) / daysInMonth / 36).toFixed(2);
        const teldTotalDuration = teldData.total_duration || 0;
        const teldAvgPower = teldTotalDuration > 0 ? ((teldData.total_electricity || 0) / (teldTotalDuration / 60)).toFixed(2) : '0.00';
        const teldDailyOrders = ((teldData.total_count || 0) / daysInMonth / 36).toFixed(2);

        // 四方坪站计算 (142个充电枪)
        const didiTotalMinutes = didiData.total_duration_minutes || 0;
        const didiDailyDuration = didiTotalMinutes / daysInMonth / 142;
        const didiDailyUtilization = (didiDailyDuration / 1440).toFixed(4);  // 返回小数，前端会乘100
        const didiDailyElectricity = ((didiData.electricity || 0) / daysInMonth / 142).toFixed(2);
        const didiDailyRevenue = ((didiData.service_fee || 0) / daysInMonth / 142).toFixed(2);
        const didiAvgPower = didiTotalMinutes > 0 ? ((didiData.electricity || 0) / (didiTotalMinutes / 60)).toFixed(2) : '0.00';
        const didiDailyOrders = ((didiData.order_count || 0) / daysInMonth / 142).toFixed(2);

        const duration = Date.now() - startTime;
        logToFile(`[经营效率分析] 数据查询成功 (${duration}ms, 月份: ${month})`);

        res.json({
            success: true,
            data: {
                gaolin: {
                    dailyDuration: teldDailyDuration.toFixed(2),
                    dailyUtilization: teldDailyUtilization,
                    dailyElectricity: teldDailyElectricity,
                    dailyRevenue: teldDailyRevenue,
                    avgPower: teldAvgPower,
                    dailyOrders: teldDailyOrders
                },
                sifangping: {
                    dailyDuration: didiDailyDuration.toFixed(2),
                    dailyUtilization: didiDailyUtilization,
                    dailyElectricity: didiDailyElectricity,
                    dailyRevenue: didiDailyRevenue,
                    avgPower: didiAvgPower,
                    dailyOrders: didiDailyOrders
                }
            }
        });
    } catch (err) {
        const duration = Date.now() - startTime;
        logToFile(`[经营效率分析] 数据查询失败 (${duration}ms): ${err.message}`);

        res.status(500).json({
            success: false,
            message: err.message || '查询经营效率分析数据失败',
            error: err.message
        });
    }
});

// 获取指定日期和时间的历史数据（用于今日vs昨日同时刻对比）
app.get('/api/local/history-same-time', async (req, res) => {
    const startTime = Date.now();
    const { date, scope } = req.query; // date: yyyy-mm-dd, scope: all/didi/teld

    try {
        if (!date) {
            return res.status(400).json({
                success: false,
                message: '缺少date参数'
            });
        }

        // 获取当前时间的小时
        const now = new Date();
        const currentHour = now.getHours();

        logToFile(`[历史同时刻数据] 开始查询数据库 (日期: ${date}, 截止小时: ${currentHour}, 站点: ${scope || 'all'})`);

        let totalCount = 0;
        let totalElectricity = 0;
        let totalElectricityFee = 0;
        let totalServiceFee = 0;
        let totalIncome = 0;
        let totalDuration = 0;

        // 根据站点参数决定查询哪些数据源
        const shouldQueryTeld = !scope || scope === 'all' || scope === 'teld';
        const shouldQueryDidi = !scope || scope === 'all' || scope === 'didi';

        // 查询特来电站小时快照数据（从0点到当前小时）
        if (shouldQueryTeld) {
            const [teldRows] = await mysqlPool.query(
                `SELECT
                    SUM(total_count) as total_count,
                    SUM(total_electricity) as total_electricity,
                    SUM(total_electricity_fee) as total_electricity_fee,
                    SUM(total_service_fee) as total_service_fee,
                    SUM(total_income) as total_income,
                    SUM(total_duration) as total_duration
                FROM teld_hourly_snapshot
                WHERE date = ? AND hour < ?`,
                [date, currentHour]
            );

            if (teldRows && teldRows[0]) {
                totalCount += teldRows[0].total_count || 0;
                totalElectricity += teldRows[0].total_electricity || 0;
                totalElectricityFee += teldRows[0].total_electricity_fee || 0;
                totalServiceFee += teldRows[0].total_service_fee || 0;
                totalIncome += teldRows[0].total_income || 0;
                totalDuration += teldRows[0].total_duration || 0;
            }
        }

        // 查询滴滴站小时快照数据（从0点到当前小时）
        if (shouldQueryDidi) {
            const [didiRows] = await mysqlPool.query(
                `SELECT
                    SUM(total_count) as total_count,
                    SUM(total_electricity) as total_electricity,
                    SUM(total_electricity_fee) as total_electricity_fee,
                    SUM(total_service_fee) as total_service_fee,
                    SUM(total_income) as total_income,
                    SUM(total_duration) as total_duration
                FROM didi_hourly_snapshot
                WHERE date = ? AND hour < ?`,
                [date, currentHour]
            );

            if (didiRows && didiRows[0]) {
                totalCount += didiRows[0].total_count || 0;
                totalElectricity += didiRows[0].total_electricity || 0;
                totalElectricityFee += didiRows[0].total_electricity_fee || 0;
                totalServiceFee += didiRows[0].total_service_fee || 0;
                totalIncome += didiRows[0].total_income || 0;
                totalDuration += didiRows[0].total_duration || 0;
            }
        }

        const duration = Date.now() - startTime;
        logToFile(`[历史同时刻数据] 数据查询成功 (${duration}ms, 日期: ${date}, 截止小时: ${currentHour}, 站点: ${scope || 'all'})`);

        // 构造与实时汇总接口相同的数据格式
        const rangeEnd = `${date} ${String(currentHour - 1).padStart(2, '0')}:59:59`;
        res.json({
            success: true,
            data: {
                scope: scope || 'all',
                rangeEnd: rangeEnd,
                day: {
                    rangeStart: `${date} 00:00:00`,
                    rangeEnd: rangeEnd,
                    totalCount: totalCount,
                    totalElectricityFee: totalElectricityFee,
                    totalServiceFee: totalServiceFee,
                    totalIncome: totalIncome,
                    totalElectricity: totalElectricity,
                    totalDuration: totalDuration
                }
            }
        });

    } catch (err) {
        const duration = Date.now() - startTime;
        logToFile(`[历史同时刻数据] 数据查询失败 (${duration}ms): ${err.message}`);

        res.status(500).json({
            success: false,
            message: err.message || '加载历史同时刻数据失败'
        });
    }
});

// 获取指定日期的历史数据（用于今日vs昨日对比）
app.get('/api/local/history-by-date', async (req, res) => {
    const startTime = Date.now();
    const { date, scope } = req.query; // date: yyyy-mm-dd, scope: all/didi/teld

    try {
        if (!date) {
            return res.status(400).json({
                success: false,
                message: '缺少date参数'
            });
        }

        logToFile(`[历史数据查询] 开始查询 (日期: ${date}, 站点: ${scope || 'all'})`);

        let totalCount = 0;
        let totalElectricity = 0;
        let totalElectricityFee = 0;
        let totalServiceFee = 0;
        let totalIncome = 0;
        let totalDuration = 0;

        // 根据站点参数决定查询哪些数据源
        const shouldQueryTeld = !scope || scope === 'all' || scope === 'teld';
        const shouldQueryDidi = !scope || scope === 'all' || scope === 'didi';

        // 查询特来电站数据
        if (shouldQueryTeld) {
            const [teldRows] = await mysqlPool.query(
                `SELECT
                    SUM(total_count) as total_count,
                    SUM(total_electricity) as total_electricity,
                    SUM(total_electricity_fee) as total_electricity_fee,
                    SUM(total_service_fee) as total_service_fee,
                    SUM(total_income) as total_income,
                    SUM(total_duration) as total_duration
                FROM teld_history_summary
                WHERE date = ?`,
                [date]
            );

            if (teldRows && teldRows[0]) {
                totalCount += teldRows[0].total_count || 0;
                totalElectricity += parseFloat(teldRows[0].total_electricity || 0);
                totalElectricityFee += parseFloat(teldRows[0].total_electricity_fee || 0);
                totalServiceFee += parseFloat(teldRows[0].total_service_fee || 0);
                totalIncome += parseFloat(teldRows[0].total_income || 0);
                totalDuration += parseFloat(teldRows[0].total_duration || 0);
            }
        }

        // 查询滴滴站数据
        if (shouldQueryDidi) {
            const [didiRows] = await mysqlPool.query(
                `SELECT
                    SUM(order_count) as order_count,
                    SUM(electricity) as electricity,
                    SUM(electricity_fee) as electricity_fee,
                    SUM(service_fee) as service_fee,
                    SUM(electricity_fee + service_fee) as total_income,
                    SUM(
                        CAST(SUBSTRING_INDEX(duration_text, '小时', 1) AS UNSIGNED) * 60 +
                        CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(duration_text, '分', 1), '小时', -1) AS UNSIGNED) +
                        CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(duration_text, '秒', 1), '分', -1) AS UNSIGNED) / 60
                    ) as total_duration_minutes
                FROM didi_history_summary
                WHERE date = ?`,
                [date]
            );

            if (didiRows && didiRows[0]) {
                totalCount += didiRows[0].order_count || 0;
                totalElectricity += parseFloat(didiRows[0].electricity || 0);
                totalElectricityFee += parseFloat(didiRows[0].electricity_fee || 0);
                totalServiceFee += parseFloat(didiRows[0].service_fee || 0);
                totalIncome += parseFloat(didiRows[0].total_income || 0);
                totalDuration += parseFloat(didiRows[0].total_duration_minutes || 0);
            }
        }

        const duration = Date.now() - startTime;
        logToFile(`[历史数据查询] 查询成功 (${duration}ms, 日期: ${date}, 站点: ${scope || 'all'})`);

        res.json({
            success: true,
            date: date,
            scope: scope || 'all',
            data: {
                totalCount: totalCount,
                totalElectricity: totalElectricity,
                totalElectricityFee: totalElectricityFee,
                totalServiceFee: totalServiceFee,
                totalIncome: totalIncome,
                totalDuration: totalDuration
            }
        });

    } catch (err) {
        const duration = Date.now() - startTime;
        logToFile(`[历史数据查询] 查询失败 (${duration}ms): ${err.message}`);

        res.status(500).json({
            success: false,
            message: err.message || '查询历史数据失败',
            error: err.message
        });
    }
});

// 获取充电数据看板表格数据
app.get('/api/local/charging-board-table', async (req, res) => {
    const startTime = Date.now();
    const { year, site } = req.query; // year: 年份, site: 站点 (all/gaolin/sifangping)

    try {
        if (!year) {
            return res.status(400).json({
                success: false,
                message: '缺少year参数'
            });
        }

        logToFile(`[充电数据看板] 开始查询表格数据 (年份: ${year}, 站点: ${site || 'all'})`);

        let tableData = [];

        // 根据站点参数决定查询哪些数据源
        const shouldQueryTeld = !site || site === 'all' || site === 'gaolin';
        const shouldQueryDidi = !site || site === 'all' || site === 'sifangping';

        // 查询高岭站数据 (teld_history_summary)
        if (shouldQueryTeld) {
            const [teldRows] = await mysqlPool.query(
                `SELECT
                    DATE_FORMAT(date, '%Y-%m') as month,
                    '高岭站' as site,
                    '特来电' as platform,
                    SUM(total_count) as order_count,
                    SUM(total_electricity) as electricity,
                    SUM(total_electricity_fee) as electricity_fee,
                    SUM(total_service_fee) as service_fee,
                    SUM(total_duration) as duration_minutes
                FROM teld_history_summary
                WHERE YEAR(date) = ? AND date IS NOT NULL
                GROUP BY DATE_FORMAT(date, '%Y-%m')
                HAVING month IS NOT NULL AND month LIKE CONCAT(?, '-%')
                ORDER BY month`,
                [year, year]
            );
            tableData = tableData.concat(teldRows);
        }

        // 查询四方坪站数据 (didi_history_summary)
        if (shouldQueryDidi) {
            const [didiRows] = await mysqlPool.query(
                `SELECT
                    DATE_FORMAT(date, '%Y-%m') as month,
                    '四方坪站' as site,
                    '滴滴' as platform,
                    SUM(order_count) as order_count,
                    SUM(electricity) as electricity,
                    SUM(electricity_fee) as electricity_fee,
                    SUM(service_fee) as service_fee,
                    SUM(
                        CAST(SUBSTRING_INDEX(duration_text, '小时', 1) AS UNSIGNED) * 60 +
                        CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(duration_text, '分', 1), '小时', -1) AS UNSIGNED) +
                        CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(duration_text, '秒', 1), '分', -1) AS UNSIGNED) / 60
                    ) as duration_minutes
                FROM didi_history_summary
                WHERE YEAR(date) = ? AND date IS NOT NULL
                GROUP BY DATE_FORMAT(date, '%Y-%m')
                HAVING month IS NOT NULL AND month LIKE CONCAT(?, '-%')
                ORDER BY month`,
                [year, year]
            );
            tableData = tableData.concat(didiRows);
        }

        // 按月份排序
        tableData.sort((a, b) => a.month.localeCompare(b.month));

        const queryTime = Date.now() - startTime;
        logToFile(`[充电数据看板] 查询完成，耗时: ${queryTime}ms，返回 ${tableData.length} 条记录`);

        res.json({
            success: true,
            data: tableData,
            queryTime: queryTime
        });

    } catch (error) {
        const queryTime = Date.now() - startTime;
        logToFile(`[充电数据看板] 查询失败: ${error.message}，耗时: ${queryTime}ms`);
        res.status(500).json({
            success: false,
            message: '查询失败',
            error: error.message,
            queryTime: queryTime
        });
    }
});

// 获取充电数据年度汇总（用于图表显示）
app.get('/api/local/charging-yearly-summary', async (req, res) => {
    const startTime = Date.now();
    const { year } = req.query;

    try {
        if (!year) {
            return res.status(400).json({
                success: false,
                message: '缺少year参数'
            });
        }

        logToFile(`[充电数据年度汇总] 开始查询 (年份: ${year})`);

        // 查询高岭站年度汇总
        const [teldResult] = await mysqlPool.query(
            `SELECT
                SUM(total_electricity) as total_charge,
                SUM(total_service_fee) as total_service
            FROM teld_history_summary
            WHERE YEAR(date) = ? AND date IS NOT NULL`,
            [year]
        );

        // 查询四方坪站年度汇总
        const [didiResult] = await mysqlPool.query(
            `SELECT
                SUM(electricity) as total_charge,
                SUM(service_fee) as total_service
            FROM didi_history_summary
            WHERE YEAR(date) = ? AND date IS NOT NULL`,
            [year]
        );

        // 合并两个站点的数据
        const totalCharge = (Number(teldResult[0]?.total_charge) || 0) + (Number(didiResult[0]?.total_charge) || 0);
        const totalService = (Number(teldResult[0]?.total_service) || 0) + (Number(didiResult[0]?.total_service) || 0);

        const queryTime = Date.now() - startTime;
        logToFile(`[充电数据年度汇总] 查询完成，耗时: ${queryTime}ms，年份: ${year}, 充电量: ${totalCharge.toFixed(2)}, 服务费: ${totalService.toFixed(2)}`);

        res.json({
            success: true,
            year: parseInt(year),
            data: {
                charge: totalCharge,
                service: totalService
            },
            queryTime: queryTime
        });

    } catch (error) {
        const queryTime = Date.now() - startTime;
        logToFile(`[充电数据年度汇总] 查询失败: ${error.message}，耗时: ${queryTime}ms`);
        res.status(500).json({
            success: false,
            message: '查询失败',
            error: error.message,
            queryTime: queryTime
        });
    }
});

// 启动服务器
async function startServer() {
    try {
        // 初始化SQL Server数据库连接
        await initializePool();

        // 初始化MySQL数据库连接
        await initializeMySQLPool();

        // 启动HTTP服务器 - 监听所有网络接口(0.0.0.0)以允许外网访问
        app.listen(PORT, '0.0.0.0', () => {
            logToFile('\n========================================');
            logToFile('🚀 SQL Server 代理服务器已启动');
            logToFile(`📡 监听端口: ${PORT}`);
            logToFile(`🗄️  SQL Server: ${dbConfig.server}/${dbConfig.database}`);
            logToFile(`🗄️  MySQL: ${mysqlConfig.host}/${mysqlConfig.database}`);
            logToFile(`🔗 本地访问: http://localhost:${PORT}`);
            logToFile(`🌐 外网访问: http://csfhcdz.f3322.net:${PORT}`);
            logToFile(`💚 健康检查: http://csfhcdz.f3322.net:${PORT}/health`);
            logToFile(`📋 查看日志: http://csfhcdz.f3322.net:${PORT}/logs`);
            logToFile(`📁 日志文件: ${LOG_FILE}`);
            logToFile('========================================\n');
        });

    } catch (err) {
        logToFile('服务器启动失败: ' + err);
        process.exit(1);
    }
}

// 优雅关闭
process.on('SIGINT', async () => {
    logToFile('\n正在关闭服务器...');
    if (pool) {
        await pool.close();
        logToFile('SQL Server数据库连接已关闭');
    }
    if (mysqlPool) {
        await mysqlPool.end();
        logToFile('MySQL数据库连接已关闭');
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logToFile('\n正在关闭服务器...');
    if (pool) {
        await pool.close();
        logToFile('SQL Server数据库连接已关闭');
    }
    if (mysqlPool) {
        await mysqlPool.end();
        logToFile('MySQL数据库连接已关闭');
    }
    process.exit(0);
});

// 启动服务器
startServer();
