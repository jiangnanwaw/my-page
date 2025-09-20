/**
 * 简化版登录记录器 - 可直接复制到 my-page 项目中使用
 */

// 配置您的 LeanCloud 应用地址
const LEANCLOUD_APP_URL = 'https://n4kuuvf2ey8wog0sf5oddkdc.leanapp.cn'; // 替换为您的实际地址

// 记录用户登录
async function recordUserLogin(username, additionalData = {}) {
    try {
        const loginData = {
            username: username,
            loginTime: new Date().toISOString(),
            userAgent: navigator.userAgent,
            deviceInfo: getDeviceInfo(),
            page: window.location.href,
            ...additionalData
        };

        console.log('正在记录登录:', loginData);

        const response = await fetch(`${LEANCLOUD_APP_URL}/1.1/functions/recordUserLogin`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(loginData)
        });

        if (!response.ok) {
            throw new Error(`记录失败: ${response.status}`);
        }

        const result = await response.json();
        console.log('登录记录成功:', result);
        return result;

    } catch (error) {
        console.error('记录登录失败:', error);
        // 不抛出错误，避免影响正常登录流程
        return null;
    }
}

// 获取用户登录历史
async function getUserLoginHistory(username, limit = 10) {
    try {
        const response = await fetch(`${LEANCLOUD_APP_URL}/1.1/functions/getUserLoginHistory`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username: username,
                limit: limit
            })
        });

        if (!response.ok) {
            throw new Error(`获取失败: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('获取登录历史失败:', error);
        return null;
    }
}

// 获取设备信息
function getDeviceInfo() {
    const ua = navigator.userAgent;
    
    let device = 'Desktop';
    if (/Mobile|Android|iPhone|iPod|BlackBerry|IEMobile/.test(ua)) {
        device = 'Mobile';
    } else if (/Tablet|iPad/.test(ua)) {
        device = 'Tablet';
    }

    let browser = 'Unknown';
    if (ua.includes('Chrome')) browser = 'Chrome';
    else if (ua.includes('Firefox')) browser = 'Firefox';
    else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
    else if (ua.includes('Edge')) browser = 'Edge';

    return `${device} - ${browser}`;
}

// 使用示例：
// 在用户登录成功后调用
// recordUserLogin('username123');

// 查看用户登录历史
// getUserLoginHistory('username123').then(console.log);