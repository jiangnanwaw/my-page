// LeanCloud 云函数 - 短信验证码功能
const AV = require('leancloud-storage');

// 初始化LeanCloud（使用您提供的腾讯云短信应用信息）
AV.init({
  appId: process.env.LEANCLOUD_APP_ID || 'YTZnYJZLrOLM1iUgi3hyF3LX-gzGzoHsz',
  appKey: process.env.LEANCLOUD_APP_KEY || 'gd1zSY9FVQdpBwdmNhn91RUT',
  masterKey: process.env.LEANCLOUD_MASTER_KEY || '0373U9YzJo3U57qpdQxWeG3p',
  serverURLs: process.env.LEANCLOUD_SERVER_URL || 'https://api.leancloud.cn'
});

// 启用MasterKey权限
AV.Cloud.useMasterKey();

/**
 * 发送短信验证码
 * @param {String} mobilePhoneNumber 手机号码
 * @returns {Object} 验证码发送结果
 */
AV.Cloud.define('sendSMSCode', async function(request) {
  const { mobilePhoneNumber } = request.params;
  
  // 验证手机号格式
  if (!mobilePhoneNumber || !/^1[3-9]\d{9}$/.test(mobilePhoneNumber)) {
    throw new AV.Cloud.Error('手机号格式不正确', { code: 400 });
  }
  
  try {
    // 发送短信验证码
    const smsResult = await AV.Cloud.requestSmsCode({
      mobilePhoneNumber: mobilePhoneNumber,
      template: process.env.TENCENT_SMS_TEMPLATE_ID || '2525131', // 短信模板ID
      sign: process.env.TENCENT_SMS_SIGN || '长沙飞狐', // 短信签名
      name: '长沙飞狐数据管理平台', // 应用名称
      ttl: 10 // 验证码有效期（分钟）
    });
    
    console.log('短信验证码发送成功:', mobilePhoneNumber);
    return {
      success: true,
      message: '验证码已发送，请注意查收'
    };
  } catch (error) {
    console.error('短信验证码发送失败:', error);
    throw new AV.Cloud.Error('验证码发送失败: ' + error.message, { code: 500 });
  }
});

/**
 * 验证短信验证码并登录
 * @param {String} mobilePhoneNumber 手机号码
 * @param {String} smsCode 短信验证码
 * @returns {Object} 登录结果和用户信息
 */
AV.Cloud.define('verifySMSCodeAndLogin', async function(request) {
  const { mobilePhoneNumber, smsCode } = request.params;
  
  // 验证参数
  if (!mobilePhoneNumber || !/^1[3-9]\d{9}$/.test(mobilePhoneNumber)) {
    throw new AV.Cloud.Error('手机号格式不正确', { code: 400 });
  }
  
  if (!smsCode || !/^\d{6}$/.test(smsCode)) {
    throw new AV.Cloud.Error('验证码格式不正确', { code: 400 });
  }
  
  try {
    // 验证短信验证码
    await AV.Cloud.verifySmsCode(smsCode, mobilePhoneNumber);
    
    // 查找或创建用户
    let userQuery = new AV.Query('_User');
    userQuery.equalTo('mobilePhoneNumber', mobilePhoneNumber);
    let user = await userQuery.first({ useMasterKey: true });
    
    // 如果用户不存在，则创建新用户
    if (!user) {
      user = new AV.User();
      user.setUsername('user_' + mobilePhoneNumber);
      user.setPassword('sms_login_' + Date.now()); // 生成随机密码
      user.setMobilePhoneNumber(mobilePhoneNumber);
      
      // 设置ACL权限
      const acl = new AV.ACL();
      acl.setPublicReadAccess(false);
      acl.setPublicWriteAccess(false);
      acl.setReadAccess(user, true);
      acl.setWriteAccess(user, true);
      user.setACL(acl);
      
      await user.signUp(null, { useMasterKey: true });
    } else {
      // 如果用户存在，更新最后登录时间
      user.set('lastLoginAt', new Date());
      await user.save(null, { useMasterKey: true });
    }
    
    // 生成登录token
    const sessionToken = user.getSessionToken();
    
    console.log('用户通过短信验证码登录成功:', mobilePhoneNumber);
    return {
      success: true,
      message: '登录成功',
      sessionToken: sessionToken,
      userId: user.id,
      username: user.getUsername(),
      mobilePhoneNumber: user.getMobilePhoneNumber()
    };
  } catch (error) {
    console.error('短信验证码验证失败:', error);
    if (error.code === 1) {
      throw new AV.Cloud.Error('验证码错误或已过期', { code: 400 });
    }
    throw new AV.Cloud.Error('登录失败: ' + error.message, { code: 500 });
  }
});

/**
 * 检查手机号是否已授权
 * @param {String} mobilePhoneNumber 手机号码
 * @returns {Object} 授权检查结果
 */
AV.Cloud.define('checkMobileAuthorization', async function(request) {
  const { mobilePhoneNumber } = request.params;
  
  // 验证手机号格式
  if (!mobilePhoneNumber || !/^1[3-9]\d{9}$/.test(mobilePhoneNumber)) {
    throw new AV.Cloud.Error('手机号格式不正确', { code: 400 });
  }
  
  try {
    // 这里可以连接到您的授权用户表进行检查
    // 示例：检查AuthorizedUsers表中是否存在该手机号
    const query = new AV.Query('AuthorizedUsers');
    query.equalTo('mobilePhoneNumber', mobilePhoneNumber);
    const results = await query.find({ useMasterKey: true });
    
    const isAuthorized = results.length > 0;
    
    return {
      success: true,
      isAuthorized: isAuthorized
    };
  } catch (error) {
    console.error('检查手机号授权失败:', error);
    return {
      success: true, // 仍然返回成功，但标记为未授权
      isAuthorized: false,
      message: '检查授权时出现错误'
    };
  }
});

module.exports = AV;