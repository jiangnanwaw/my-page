// 加载环境变量（仅在本地开发时需要）
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const AV = require('leanengine');
const express = require('express');
const path = require('path');

// 初始化 LeanEngine
AV.init({
  appId: process.env.LEANCLOUD_APP_ID,
  appKey: process.env.LEANCLOUD_APP_KEY,
  masterKey: process.env.LEANCLOUD_APP_MASTER_KEY,
  serverURL: process.env.LEANCLOUD_SERVER_URL || 'https://api.leancloud.cn'
});

const app = express();

// 设置视图引擎
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'html');
app.engine('html', require('ejs').renderFile);

// 加载云引擎中间件
app.use(AV.express());

// 启用 HTTPS 重定向，确保用户访问的是 HTTPS 协议
app.enable('trust proxy');
app.use(AV.Cloud.HttpsRedirect());

// 加载云函数定义，你可以将云函数定义在 cloud.js 中
require('./cloud');

// 可以将一类的路由单独保存在一个文件中
app.use('/todos', require('./routes/todos'));

// 根路由
app.get('/', function(req, res) {
  res.render('index', { 
    currentTime: new Date().toLocaleString('zh-CN'),
    appName: 'LeanEngine Demo'
  });
});

// 健康检查路由
app.get('/health', function(req, res) {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 处理
app.use(function(req, res, next) {
  res.status(404).json({ error: 'Not Found' });
});

// 错误处理
app.use(function(err, req, res, next) {
  console.error('Error:', err);
  res.status(500).json({ 
    error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message 
  });
});

const PORT = parseInt(process.env.LEANCLOUD_APP_PORT || process.env.PORT || 3000);

app.listen(PORT, function () {
  console.log('LeanEngine app is running on port:', PORT);
});

// 最后，必须有这行代码来使 express 响应 LeanEngine 的请求
module.exports = app;