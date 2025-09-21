const AV = require('leancloud-storage');
const express = require('express');
const app = express();

// 设置LeanCloud
AV.init({
  appId: process.env.LEANCLOUD_APP_ID || 'YTZnYJZLrOLM1iUgi3hyF3LX-gzGzoHsz',
  appKey: process.env.LEANCLOUD_APP_KEY || 'gd1zSY9FVQdpBwdmNhn91RUT',
  masterKey: process.env.LEANCLOUD_MASTER_KEY || '0373U9YzJo3U57qpdQxWeG3p',
  serverURLs: process.env.LEANCLOUD_SERVER_URL || 'https://api.leancloud.cn'
});

// 启用MasterKey权限
AV.Cloud.useMasterKey();

// 加载云函数
require('./cloud.js');

// 设置端口
const PORT = parseInt(process.env.LEANCLOUD_APP_PORT || process.env.PORT || 3000);

app.use(express.json());

// 健康检查端点
app.get('/', (req, res) => {
  res.json({
    message: '长沙飞狐数据管理平台短信验证码服务已启动',
    timestamp: new Date().toISOString()
  });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`短信验证码服务运行在端口 ${PORT}`);
});

module.exports = app;