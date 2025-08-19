// 导入所需模块
const axios = require('axios');

module.exports = async (req, res) => {
  try {
    // 从查询参数获取code
    const code = req.query.code;
    
    if (!code) {
      return res.status(400).json({ error: '缺少code参数' });
    }
    
    // 配置GitHub OAuth参数
    const params = {
      client_id: process.env.Ov23li4nGgpMNfpUd7n6,
      client_secret: process.env.6fb7b9f8e812ce7f2a2fd2ae1a08902614b4065c,
      code: code
    };
    
    // 设置请求头
    const headers = {
      Accept: 'application/json'
    };
    
    // 向GitHub请求access token
    const response = await axios.post(
      'https://github.com/login/oauth/access_token',
      params,
      { headers }
    );
    
    const data = response.data;
    
    if (data.error) {
      return res.status(400).json({ 
        error: 'GitHub token交换失败',
        message: data.error_description 
      });
    }
    
    // 使用access token获取用户信息
    const userResponse = await axios.get('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${data.access_token}`
      }
    });
    
    // 返回用户信息给前端
    res.json({
      access_token: data.access_token,
      user: userResponse.data
    });
    
  } catch (error) {
    console.error('Token交换错误:', error);
    res.status(500).json({ 
      error: '服务器错误',
      details: error.message 
    });
  }
};