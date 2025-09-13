# My Page - LeanCloud 云引擎登录记录系统

这是一个集成了 LeanCloud 云引擎的个人页面项目，具备完整的用户登录记录追踪功能。

## 🚀 功能特性

### 📱 原有功能
- 个人主页展示
- 数据可视化
- 图片展示等

### 🔐 新增登录记录功能
- ✅ **用户登录记录**：记录每次登录的详细信息
- ✅ **登录时间追踪**：精确到秒的登录时间戳
- ✅ **设备信息记录**：浏览器、设备类型、操作系统
- ✅ **IP地址追踪**：记录登录来源IP
- ✅ **登录统计分析**：按时间段统计登录趋势
- ✅ **用户活跃度分析**：独特用户数、平均登录频率

## 🛠️ 技术栈

- **前端**：HTML, CSS, JavaScript
- **后端**：Node.js + Express
- **云服务**：LeanCloud 云引擎
- **数据库**：LeanCloud 数据存储
- **部署**：LeanCloud 云引擎 + GitHub

## 📦 项目结构

```
my-page/
├── index.html                 # 原有主页
├── app.js                     # LeanCloud 云引擎主应用
├── server.js                  # 标准 LeanCloud 服务器
├── cloud.js                   # 云函数定义
├── package.json               # 项目配置
├── leanengine.yaml           # LeanCloud 部署配置
├── .env                      # 环境变量
├── routes/                   # API 路由
│   ├── todos.js             # Todo API
│   └── login-records.js     # 登录记录 API
├── views/                    # 模板文件
│   └── index.html           # 测试页面模板
├── simple-login-tracker.js  # 简化版登录追踪器
└── integration-guide.md     # 集成指南
```

## 🔧 本地开发

### 1. 安装依赖
```bash
npm install
```

### 2. 配置环境变量
复制 `.env` 文件并配置您的 LeanCloud 应用信息：
```env
LEANCLOUD_APP_ID=your_app_id
LEANCLOUD_APP_KEY=your_app_key
LEANCLOUD_APP_MASTER_KEY=your_master_key
```

### 3. 启动开发服务器
```bash
# 启动完整版（LeanCloud模式）
npm start

# 或启动通用版（自适应模式）
npm run universal

# 或启动独立版（内存存储模式）
npm run standalone
```

### 4. 访问应用
- 原有主页：http://localhost:3000/index.html
- 云引擎测试页面：http://localhost:3000/

## 🚀 部署到 LeanCloud

### 1. 在 LeanCloud 控制台配置
1. 登录 https://console.leancloud.cn/
2. 进入您的应用
3. 云引擎 → 部署 → Git 部署
4. 设置仓库地址：`https://github.com/jiangnanwaw/my-page.git`
5. 分支：`master`
6. 点击"部署"

### 2. 环境变量自动配置
LeanCloud 会自动配置以下环境变量：
- `LEANCLOUD_APP_ID`
- `LEANCLOUD_APP_KEY`
- `LEANCLOUD_APP_MASTER_KEY`

## 📱 使用登录记录功能

### 在原有页面中集成
1. **引入登录追踪器**
```html
<script src="./simple-login-tracker.js"></script>
```

2. **在登录成功后记录**
```javascript
// 在您的登录成功函数中添加
async function onLoginSuccess(username) {
    // 原有登录逻辑...
    
    // 记录登录
    await recordUserLogin(username);
}
```

### API 端点

#### 云函数
- `POST /1.1/functions/recordUserLogin` - 记录用户登录
- `POST /1.1/functions/getUserLoginHistory` - 获取用户登录历史
- `POST /1.1/functions/getLoginStats` - 获取登录统计

#### REST API
- `POST /login-records/login` - 模拟登录并记录
- `GET /login-records/records` - 获取所有登录记录
- `GET /login-records/stats` - 获取登录统计
- `GET /login-records/user/:username` - 获取特定用户登录历史

### 查看登录数据

#### 在 LeanCloud 控制台
1. 数据存储 → 结构化数据
2. 查看 `LoginRecord` 表
3. 可以看到所有登录记录的详细信息

#### 通过 API
```javascript
// 获取用户登录历史
const history = await getUserLoginHistory('username', 10);

// 获取登录统计
const stats = await getLoginStats('7d');
```

## 📊 登录记录包含的信息

每条登录记录包含：
- **用户名**：登录的用户标识
- **登录时间**：精确的时间戳
- **IP地址**：来源IP地址
- **用户代理**：浏览器和操作系统信息
- **设备信息**：设备类型（Mobile/Desktop/Tablet）
- **页面信息**：登录时的页面URL
- **登录状态**：成功/失败状态

## 🔒 安全性

- 不记录密码等敏感信息
- 使用 HTTPS 加密传输
- LeanCloud 提供企业级数据安全保障
- 支持数据访问权限控制

## 📈 统计分析

系统提供丰富的登录统计分析：
- 按时间段统计（1天/7天/30天）
- 用户活跃度分析
- 登录成功率统计
- 设备类型分布
- 登录时间趋势

## 🆘 故障排除

### 常见问题
1. **部署失败**：检查 package.json 和 leanengine.yaml 配置
2. **登录记录失败**：确认 LeanCloud 应用配置正确
3. **跨域问题**：在 LeanCloud 控制台配置跨域设置

### 调试方法
```javascript
// 启用调试模式
window.loginTracker.debug = true;

// 手动测试登录记录
recordUserLogin('test_user').then(console.log).catch(console.error);
```

## 📞 支持

如有问题，请查看：
1. `integration-guide.md` - 详细集成指南
2. LeanCloud 官方文档
3. 项目 Issues

## 📄 许可证

MIT License