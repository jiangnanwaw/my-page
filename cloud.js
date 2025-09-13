const AV = require('leanengine');

// 定义一个简单的云函数
AV.Cloud.define('hello', function(request) {
  return 'Hello from LeanEngine! Time: ' + new Date();
});

// 定义一个带参数的云函数
AV.Cloud.define('add', function(request) {
  const { a, b } = request.params;
  const result = (parseFloat(a) || 0) + (parseFloat(b) || 0);
  return {
    a: a,
    b: b,
    result: result,
    message: `${a} + ${b} = ${result}`
  };
});

// 用户登录记录云函数
AV.Cloud.define('recordUserLogin', async function(request) {
  const { username, userAgent, ip, deviceInfo } = request.params;
  
  if (!username) {
    throw new AV.Cloud.Error('用户名不能为空');
  }
  
  try {
    // 创建登录记录
    const LoginRecord = AV.Object.extend('LoginRecord');
    const loginRecord = new LoginRecord();
    
    loginRecord.set('username', username);
    loginRecord.set('loginTime', new Date());
    loginRecord.set('userAgent', userAgent || request.meta.remoteAddress);
    loginRecord.set('ipAddress', ip || request.meta.remoteAddress);
    loginRecord.set('deviceInfo', deviceInfo || 'Unknown');
    loginRecord.set('sessionId', request.sessionToken || 'anonymous');
    
    const savedRecord = await loginRecord.save();
    
    return {
      success: true,
      recordId: savedRecord.id,
      loginTime: savedRecord.get('loginTime'),
      message: '登录记录已保存'
    };
  } catch (error) {
    throw new AV.Cloud.Error('保存登录记录失败: ' + error.message);
  }
});

// 获取用户登录历史
AV.Cloud.define('getUserLoginHistory', async function(request) {
  const { username, limit = 10, skip = 0 } = request.params;
  
  if (!username) {
    throw new AV.Cloud.Error('用户名不能为空');
  }
  
  try {
    const query = new AV.Query('LoginRecord');
    query.equalTo('username', username);
    query.descending('loginTime');
    query.limit(parseInt(limit));
    query.skip(parseInt(skip));
    
    const records = await query.find();
    const totalCount = await query.count();
    
    const loginHistory = records.map(record => ({
      id: record.id,
      loginTime: record.get('loginTime'),
      userAgent: record.get('userAgent'),
      ipAddress: record.get('ipAddress'),
      deviceInfo: record.get('deviceInfo'),
      sessionId: record.get('sessionId')
    }));
    
    return {
      success: true,
      username: username,
      total: totalCount,
      records: loginHistory,
      pagination: {
        limit: parseInt(limit),
        skip: parseInt(skip),
        hasMore: totalCount > (parseInt(skip) + parseInt(limit))
      }
    };
  } catch (error) {
    throw new AV.Cloud.Error('获取登录历史失败: ' + error.message);
  }
});

// 获取登录统计信息
AV.Cloud.define('getLoginStats', async function(request) {
  const { timeRange = '7d' } = request.params;
  
  try {
    let startDate;
    const now = new Date();
    
    switch (timeRange) {
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
    
    // 获取唯一用户数
    const uniqueUsersQuery = new AV.Query('LoginRecord');
    uniqueUsersQuery.greaterThan('loginTime', startDate);
    const allRecords = await uniqueUsersQuery.find();
    const uniqueUsers = new Set(allRecords.map(record => record.get('username')));
    
    // 获取最近登录的用户
    const recentQuery = new AV.Query('LoginRecord');
    recentQuery.descending('loginTime');
    recentQuery.limit(5);
    const recentRecords = await recentQuery.find();
    
    const recentLogins = recentRecords.map(record => ({
      username: record.get('username'),
      loginTime: record.get('loginTime'),
      ipAddress: record.get('ipAddress')
    }));
    
    return {
      success: true,
      timeRange: timeRange,
      period: {
        start: startDate,
        end: now
      },
      stats: {
        totalLogins: totalLogins,
        uniqueUsers: uniqueUsers.size,
        avgLoginsPerUser: uniqueUsers.size > 0 ? (totalLogins / uniqueUsers.size).toFixed(2) : 0
      },
      recentLogins: recentLogins
    };
  } catch (error) {
    throw new AV.Cloud.Error('获取登录统计失败: ' + error.message);
  }
});

// 数据 Hook 示例 - 在保存 Todo 对象之前执行
AV.Cloud.beforeSave('Todo', function(request) {
  const todo = request.object;
  
  // 自动设置创建时间
  if (!todo.get('createdAt')) {
    todo.set('createdAt', new Date());
  }
  
  // 验证标题不能为空
  const title = todo.get('title');
  if (!title || title.trim().length === 0) {
    throw new AV.Cloud.Error('标题不能为空');
  }
  
  // 自动设置完成状态
  if (todo.get('completed') === undefined) {
    todo.set('completed', false);
  }
  
  console.log('即将保存 Todo:', todo.toJSON());
});

// 数据 Hook 示例 - 在保存 Todo 对象之后执行
AV.Cloud.afterSave('Todo', function(request) {
  const todo = request.object;
  console.log('Todo 已保存:', todo.toJSON());
  
  // 这里可以添加保存后的逻辑，比如发送通知等
});

// 定义一个获取统计信息的云函数
AV.Cloud.define('getTodoStats', async function(request) {
  try {
    const query = new AV.Query('Todo');
    const totalCount = await query.count();
    
    const completedQuery = new AV.Query('Todo');
    completedQuery.equalTo('completed', true);
    const completedCount = await completedQuery.count();
    
    return {
      total: totalCount,
      completed: completedCount,
      pending: totalCount - completedCount,
      completionRate: totalCount > 0 ? (completedCount / totalCount * 100).toFixed(2) + '%' : '0%'
    };
  } catch (error) {
    throw new AV.Cloud.Error('获取统计信息失败: ' + error.message);
  }
});