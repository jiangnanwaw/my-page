const router = require('express').Router();
const AV = require('leanengine');

// 创建登录记录
router.post('/login', async function(req, res) {
  try {
    const { username, password, deviceInfo } = req.body;
    
    if (!username) {
      return res.status(400).json({
        success: false,
        error: '用户名不能为空'
      });
    }
    
    // 这里可以添加实际的用户验证逻辑
    // 现在只是简单记录登录
    
    const LoginRecord = AV.Object.extend('LoginRecord');
    const loginRecord = new LoginRecord();
    
    const userAgent = req.get('User-Agent') || 'Unknown';
    const ipAddress = req.ip || req.connection.remoteAddress || '127.0.0.1';
    
    loginRecord.set('username', username);
    loginRecord.set('loginTime', new Date());
    loginRecord.set('userAgent', userAgent);
    loginRecord.set('ipAddress', ipAddress);
    loginRecord.set('deviceInfo', deviceInfo || 'Web Browser');
    loginRecord.set('loginSuccess', true);
    
    const savedRecord = await loginRecord.save();
    
    res.json({
      success: true,
      message: '登录成功',
      data: {
        recordId: savedRecord.id,
        username: username,
        loginTime: savedRecord.get('loginTime'),
        ipAddress: ipAddress
      }
    });
  } catch (error) {
    console.error('记录登录失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 获取登录记录列表
router.get('/records', async function(req, res) {
  try {
    const { username, limit = 20, skip = 0, startDate, endDate } = req.query;
    
    const query = new AV.Query('LoginRecord');
    
    // 按用户名筛选
    if (username) {
      query.equalTo('username', username);
    }
    
    // 按日期范围筛选
    if (startDate) {
      query.greaterThan('loginTime', new Date(startDate));
    }
    if (endDate) {
      query.lessThan('loginTime', new Date(endDate));
    }
    
    query.descending('loginTime');
    query.limit(parseInt(limit));
    query.skip(parseInt(skip));
    
    const records = await query.find();
    const totalCount = await query.count();
    
    const loginRecords = records.map(record => ({
      id: record.id,
      username: record.get('username'),
      loginTime: record.get('loginTime'),
      userAgent: record.get('userAgent'),
      ipAddress: record.get('ipAddress'),
      deviceInfo: record.get('deviceInfo'),
      loginSuccess: record.get('loginSuccess'),
      createdAt: record.get('createdAt')
    }));
    
    res.json({
      success: true,
      data: loginRecords,
      pagination: {
        total: totalCount,
        limit: parseInt(limit),
        skip: parseInt(skip),
        hasMore: totalCount > (parseInt(skip) + parseInt(limit))
      }
    });
  } catch (error) {
    console.error('获取登录记录失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 获取用户登录统计
router.get('/stats', async function(req, res) {
  try {
    const { period = '7d' } = req.query;
    
    let startDate;
    const now = new Date();
    
    switch (period) {
      case '1d':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }
    
    const query = new AV.Query('LoginRecord');
    query.greaterThan('loginTime', startDate);
    
    const totalLogins = await query.count();
    
    // 获取成功登录数
    const successQuery = new AV.Query('LoginRecord');
    successQuery.greaterThan('loginTime', startDate);
    successQuery.equalTo('loginSuccess', true);
    const successLogins = await successQuery.count();
    
    // 获取所有记录用于计算唯一用户
    const allRecordsQuery = new AV.Query('LoginRecord');
    allRecordsQuery.greaterThan('loginTime', startDate);
    const allRecords = await allRecordsQuery.find();
    
    const uniqueUsers = new Set(allRecords.map(record => record.get('username')));
    
    // 按日期分组统计
    const dailyStats = {};
    allRecords.forEach(record => {
      const date = record.get('loginTime').toISOString().split('T')[0];
      if (!dailyStats[date]) {
        dailyStats[date] = { date, count: 0, users: new Set() };
      }
      dailyStats[date].count++;
      dailyStats[date].users.add(record.get('username'));
    });
    
    const dailyData = Object.values(dailyStats).map(day => ({
      date: day.date,
      loginCount: day.count,
      uniqueUsers: day.users.size
    })).sort((a, b) => a.date.localeCompare(b.date));
    
    res.json({
      success: true,
      period: period,
      timeRange: {
        start: startDate,
        end: now
      },
      stats: {
        totalLogins,
        successLogins,
        uniqueUsers: uniqueUsers.size,
        successRate: totalLogins > 0 ? ((successLogins / totalLogins) * 100).toFixed(2) + '%' : '0%',
        avgLoginsPerUser: uniqueUsers.size > 0 ? (totalLogins / uniqueUsers.size).toFixed(2) : 0
      },
      dailyStats: dailyData
    });
  } catch (error) {
    console.error('获取登录统计失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 获取特定用户的登录历史
router.get('/user/:username', async function(req, res) {
  try {
    const { username } = req.params;
    const { limit = 10, skip = 0 } = req.query;
    
    const query = new AV.Query('LoginRecord');
    query.equalTo('username', username);
    query.descending('loginTime');
    query.limit(parseInt(limit));
    query.skip(parseInt(skip));
    
    const records = await query.find();
    const totalCount = await query.count();
    
    const userLoginHistory = records.map(record => ({
      id: record.id,
      loginTime: record.get('loginTime'),
      userAgent: record.get('userAgent'),
      ipAddress: record.get('ipAddress'),
      deviceInfo: record.get('deviceInfo'),
      loginSuccess: record.get('loginSuccess')
    }));
    
    // 获取最近一次登录时间
    const lastLoginQuery = new AV.Query('LoginRecord');
    lastLoginQuery.equalTo('username', username);
    lastLoginQuery.equalTo('loginSuccess', true);
    lastLoginQuery.descending('loginTime');
    lastLoginQuery.limit(1);
    
    const lastLoginRecord = await lastLoginQuery.first();
    const lastLoginTime = lastLoginRecord ? lastLoginRecord.get('loginTime') : null;
    
    res.json({
      success: true,
      username: username,
      lastLoginTime: lastLoginTime,
      totalLogins: totalCount,
      data: userLoginHistory,
      pagination: {
        limit: parseInt(limit),
        skip: parseInt(skip),
        hasMore: totalCount > (parseInt(skip) + parseInt(limit))
      }
    });
  } catch (error) {
    console.error('获取用户登录历史失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 删除登录记录
router.delete('/records/:id', async function(req, res) {
  try {
    const { id } = req.params;
    
    const query = new AV.Query('LoginRecord');
    const record = await query.get(id);
    
    await record.destroy();
    
    res.json({
      success: true,
      message: '登录记录已删除'
    });
  } catch (error) {
    console.error('删除登录记录失败:', error);
    if (error.code === 101) {
      res.status(404).json({
        success: false,
        error: '登录记录不存在'
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
});

module.exports = router;