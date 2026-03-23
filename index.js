require('dotenv').config();

const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();

const PORT = process.env.PORT || 3001; // 兜底值：如果没配置PORT，默认用3001
const ZHIPU_API_URL = process.env.ZHIPU_API_URL;
const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY;
const AI_MODEL = process.env.AI_MODEL || 'glm-4';
const API_PREFIX = process.env.API_PREFIX;

// 验证环境变量是否加载成功
if (!ZHIPU_API_KEY) {
    console.error('❌ 错误：请在.env文件中配置ZHIPU_API_KEY！');
    process.exit(1); // 终止程序运行
}

app.use(cors({
    origin: 'http://localhost:8080', // 仅允许前端地址，更安全
    methods: ['POST'], // 仅允许POST请求
    allowedHeaders: ['Content-Type'] // 允许的请求头
}));
app.use(express.json());

app.post(`${API_PREFIX}/extract-logistics`, async (req, res) => {
    const body = req.body;
    const result = await callAI(body);
    res.send(result);
});

app.listen(PORT, () => {
    console.log(`Example app listening at http://localhost:${PORT}`);
});

async function callAI(body) {
    const result = { status: 401, data: null, msg: null };
    try {
        const content = `请从以下文本提取单号、重量、收件人、电话：${body.text}`;
        const response = await axios.post(ZHIPU_API_URL,
            {
                model: AI_MODEL,
                messages: [
                    {
                        role: 'user',
                        content
                    }
                ],
                temperature: 0.1, // 取值0-1，越小返回结果越稳定，适合数据提取
                response_format: { type: 'json_object' } // 额外指定返回JSON格式（智谱新版支持）
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${ZHIPU_API_KEY}`
                },
                // 超时设置，避免卡请求
                timeout: 10000
            });
        result.status = 200;
        result.data = response.data.choices[0].message.content;
        console.log('Success:', result);
    } catch (err) {
        result.msg = err.message;
        result.status = err.response?.status;
        result.data = err.response?.data;
        console.error('Fail:', result);
    }
    return result;
}
