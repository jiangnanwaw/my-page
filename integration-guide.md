# 登录记录追踪集成指南

## 概述
将 LeanCloud 登录记录功能集成到您的 my-page 项目中。

## 集成方式

### 方式一：使用独立 JavaScript 库（推荐）

1. **下载并引入 login-tracker.js**
```html
<!-- 在您的 HTML 文件中添加 -->
<script src="./login-tracker.js"></script>
```

2. **配置 LeanCloud 应用地址**
```javascript
// 替换为您的 LeanCloud 应用地址
window.loginTracker = new LoginTracker({
    leancloudUrl: 'https://你的应用ID.leanapp.cn', // 替换为实际地址
    debug: true, // 开发时启用
    autoTrack: true
});
```

3. **在登录成功后记录**
```javascript
// 方式1：自动记录（推荐）
// login-tracker.js 会自动检测登录表单并记录

// 方式2：手动记录
async function onLoginSuccess(username) {
    try {
        await recordLogin(username, {
            loginMethod: 'manual',
            source: 'my-page'
        });
        console.log('登录记录成功');
    } catch (error) {
        console.error('登录记录失败:', error);
    }
}
```

### 方式二：直接 API 调用

```javascript
// 直接调用 LeanCloud 云函数
async function recordUserLogin(username) {
    try {
        const response = await fetch('https://你的应用ID.leanapp.cn/1.1/functions/recordUserLogin', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username: username,
                userAgent: navigator.userAgent,
                deviceInfo: getDeviceInfo()
            })
        });
        
        const result = await response.json();
        console.log('登录记录成功:', result);
        return result;
    } catch (error) {
        console.error('登录记录失败:', error);
    }
}

function getDeviceInfo() {
    const ua = navigator.userAgent;
    if (/Mobile|Android|iPhone/.test(ua)) return 'Mobile';
    if (/Tablet|iPad/.test(ua)) return 'Tablet';
    return 'Desktop';
}
```

### 方式三：在现有登录函数中集成

```javascript
// 假设您现有的登录函数
async function userLogin(username, password) {
    try {
        // 原有的登录逻辑
        const loginResult = await authenticate(username, password);
        
        if (loginResult.success) {
            // 登录成功后记录
            await recordUserLogin(username);
            
            // 跳转或其他逻辑
            window.location.href = '/dashboard';
        }
    } catch (error) {
        console.error('登录失败:', error);
    }
}
```

## 查看登录记录

### 在 LeanCloud 控制台查看
1. 登录 https://console.leancloud.cn/
2. 进入应用：leanengine-demo
3. 数据存储 → 结构化数据 → LoginRecord 表

### 通过 API 查看
```javascript
// 获取用户登录历史
async function viewUserLoginHistory(username) {
    try {
        const history = await getUserLoginHistory(username, 20);
        console.log('登录历史:', history);
        return history;
    } catch (error) {
        console.error('获取登录历史失败:', error);
    }
}

// 获取登录统计
async function viewLoginStats() {
    try {
        const stats = await getLoginStats('7d'); // 7天内的统计
        console.log('登录统计:', stats);
        return stats;
    } catch (error) {
        console.error('获取登录统计失败:', error);
    }
}
```

## 完整集成示例

```html
<!DOCTYPE html>
<html>
<head>
    <title>我的登录页面</title>
</head>
<body>
    <form id="loginForm">
        <input type="text" name="username" placeholder="用户名" required>
        <input type="password" name="password" placeholder="密码" required>
        <button type="submit">登录</button>
    </form>

    <!-- 引入登录追踪器 -->
    <script src="./login-tracker.js"></script>
    
    <script>
        // 配置追踪器
        window.loginTracker = new LoginTracker({
            leancloudUrl: 'https://n4kuuvf2ey8wog0sf5oddkdc.leanapp.cn', // 您的实际地址
            debug: true,
            autoTrack: true
        });

        // 处理登录表单
        document.getElementById('loginForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            const username = formData.get('username');
            const password = formData.get('password');
            
            try {
                // 这里是您的登录验证逻辑
                const loginSuccess = await verifyLogin(username, password);
                
                if (loginSuccess) {
                    // 手动记录登录（如果需要额外数据）
                    await recordLogin(username, {
                        loginMethod: 'form_login',
                        source: 'my-page',
                        timestamp: new Date().toISOString()
                    });
                    
                    alert('登录成功！');
                    // 跳转逻辑
                } else {
                    alert('登录失败！');
                }
            } catch (error) {
                console.error('登录过程出错:', error);
            }
        });

        // 模拟登录验证函数
        async function verifyLogin(username, password) {
            // 这里应该是您的实际登录验证逻辑
            return username && password; // 简化示例
        }
    </script>
</body>
</html>
```

## 获取 LeanCloud 应用地址

1. 登录 LeanCloud 控制台
2. 进入您的应用：leanengine-demo
3. 云引擎 → 设置 → 域名绑定
4. 复制默认域名，格式类似：`https://应用ID.leanapp.cn`

## 注意事项

1. **跨域问题**：确保 LeanCloud 应用允许跨域请求
2. **错误处理**：在生产环境中添加适当的错误处理
3. **隐私保护**：避免记录敏感信息如密码
4. **性能优化**：考虑批量提交或异步处理

## 故障排除

### 常见问题
- **网络错误**：检查 LeanCloud 应用地址是否正确
- **CORS 错误**：在 LeanCloud 控制台配置跨域设置
- **数据未保存**：检查 LeanCloud 应用是否正常运行

### 调试方法
```javascript
// 启用调试模式
window.loginTracker.debug = true;

// 手动测试
recordLogin('test_user').then(console.log).catch(console.error);
```