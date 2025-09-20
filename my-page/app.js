// LeanEngine Demo - 通用部署版本
// 可部署到 LeanCloud、Vercel、Heroku 等平台

// 环境变量加载（仅在本地开发时需要）
if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config();
  } catch (e) {
    console.log('dotenv not available, using environment variables');
  }
}

const express = require('express');
const path = require('path');

// 检查是否有LeanCloud环境
const hasLeanCloud = process.env.LEANCLOUD_APP_ID;
let AV = null;

if (hasLeanCloud) {
  try {
    AV = require('leanengine');
    // 初始化 LeanEngine
    AV.init({
      appId: process.env.LEANCLOUD_APP_ID,
      appKey: process.env.LEANCLOUD_APP_KEY,
      masterKey: process.env.LEANCLOUD_APP_MASTER_KEY,
      serverURL: process.env.LEANCLOUD_SERVER_URL || 'https://api.leancloud.cn'
    });
    console.log('✅ LeanCloud 初始化成功');
  } catch (error) {
    console.log('⚠️ LeanCloud 不可用，使用独立模式');
    hasLeanCloud = false;
  }
}

const app = express();

// 内存数据存储（独立模式使用）
let todos = [
  { id: '1', title: '欢迎使用 LeanEngine Demo', completed: false, createdAt: new Date(), updatedAt: new Date() },
  { id: '2', title: '测试云函数功能', completed: true, createdAt: new Date(), updatedAt: new Date() },
  { id: '3', title: '体验 REST API', completed: false, createdAt: new Date(), updatedAt: new Date() }
];
let nextId = 4;

// 设置视图引擎
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'html');
app.engine('html', require('ejs').renderFile);

// 解析JSON请求体
app.use(express.json());

// 如果有LeanCloud，加载中间件
if (hasLeanCloud && AV) {
  app.use(AV.express());
  app.enable('trust proxy');
  app.use(AV.Cloud.HttpsRedirect());
  
  // 加载云函数定义
  try {
    require('./cloud');
    console.log('✅ 云函数加载成功');
  } catch (error) {
    console.log('⚠️ 云函数加载失败:', error.message);
  }
}

// 可以将一类的路由单独保存在一个文件中
if (hasLeanCloud) {
  try {
    app.use('/todos', require('./routes/todos'));
    app.use('/login-records', require('./routes/login-records'));
    console.log('✅ LeanCloud 路由加载成功');
  } catch (error) {
    console.log('⚠️ LeanCloud 路由加载失败，使用独立模式');
  }
}

// 云函数端点（兼容模式）
app.post('/1.1/functions/hello', (req, res) => {
  const result = `Hello from LeanEngine Demo! Time: ${new Date().toISOString()}`;
  res.json(hasLeanCloud ? { result } : { result });
});

app.post('/1.1/functions/add', (req, res) => {
  const { a = 0, b = 0 } = req.body;
  const numA = parseFloat(a) || 0;
  const numB = parseFloat(b) || 0;
  const result = {
    a: numA,
    b: numB,
    result: numA + numB,
    message: `${numA} + ${numB} = ${numA + numB}`
  };
  res.json(hasLeanCloud ? { result } : { result });
});

app.post('/1.1/functions/getTodoStats', async (req, res) => {
  try {
    let totalCount, completedCount;
    
    if (hasLeanCloud && AV) {
      // 使用LeanCloud数据
      const query = new AV.Query('Todo');
      totalCount = await query.count();
      
      const completedQuery = new AV.Query('Todo');
      completedQuery.equalTo('completed', true);
      completedCount = await completedQuery.count();
    } else {
      // 使用内存数据
      totalCount = todos.length;
      completedCount = todos.filter(todo => todo.completed).length;
    }
    
    const result = {
      total: totalCount,
      completed: completedCount,
      pending: totalCount - completedCount,
      completionRate: totalCount > 0 ? (completedCount / totalCount * 100).toFixed(2) + '%' : '0%'
    };
    
    res.json(hasLeanCloud ? { result } : { result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Todo API端点

// 独立模式的Todo API
app.get('/todos', (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const skip = parseInt(req.query.skip) || 0;
  const paginatedTodos = todos.slice(skip, skip + limit);
  
  res.json({
    success: true,
    data: paginatedTodos,
    pagination: { limit, skip, total: todos.length }
  });
});

app.post('/todos', (req, res) => {
  const { title, completed = false } = req.body;
  
  if (!title || title.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: '标题不能为空'
    });
  }
  
  const newTodo = {
    id: String(nextId++),
    title: title.trim(),
    completed: completed,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  
  todos.push(newTodo);
  res.status(201).json({ success: true, data: newTodo });
});

app.get('/todos/:id', (req, res) => {
  const todo = todos.find(t => t.id === req.params.id);
  if (!todo) {
    return res.status(404).json({ success: false, error: 'Todo 不存在' });
  }
  res.json({ success: true, data: todo });
});

app.put('/todos/:id', (req, res) => {
  const { title, completed } = req.body;
  const todo = todos.find(t => t.id === req.params.id);
  
  if (!todo) {
    return res.status(404).json({ success: false, error: 'Todo 不存在' });
  }
  
  if (title !== undefined) {
    if (!title || title.trim().length === 0) {
      return res.status(400).json({ success: false, error: '标题不能为空' });
    }
    todo.title = title.trim();
  }
  
  if (completed !== undefined) {
    todo.completed = completed;
  }
  
  todo.updatedAt = new Date();
  res.json({ success: true, data: todo });
});

app.delete('/todos/:id', (req, res) => {
  const todoIndex = todos.findIndex(t => t.id === req.params.id);
  if (todoIndex === -1) {
    return res.status(404).json({ success: false, error: 'Todo 不存在' });
  }
  
  todos.splice(todoIndex, 1);
  res.json({ success: true, message: 'Todo 已删除' });
});

// 根路由
app.get('/', function(req, res) {
  const mode = hasLeanCloud ? 'LeanCloud 模式' : '独立模式';
  res.render('index', { 
    currentTime: new Date().toLocaleString('zh-CN'),
    appName: `LeanEngine Demo (${mode})`
  });
});

// 健康检查路由
app.get('/health', function(req, res) {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    mode: hasLeanCloud ? 'leancloud' : 'standalone',
    todosCount: todos.length
  });
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
  console.log(`🚀 LeanEngine Demo 运行在端口: ${PORT}`);
  console.log(`📱 访问 http://localhost:${PORT} 查看应用`);
  console.log(`🔧 运行模式: ${hasLeanCloud ? 'LeanCloud' : '独立模式'}`);
  if (!hasLeanCloud) {
    console.log('💾 使用内存存储，重启后数据会丢失');
  }
});

module.exports = app;