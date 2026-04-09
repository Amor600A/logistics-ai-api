require('dotenv').config();

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const XLSX = require('xlsx'); // 添加xlsx库支持

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

app.get('/', (req, res) => {
    res.status(200).json({
        code: 200,
        message: 'Logistics AI API 运行正常',
        data: {
            service: 'logistics-ai-api',
            version: '1.0.0',
            port: 3001
        }
    });
});

app.post(`${API_PREFIX}/extract-logistics`, async (req, res) => {
    const body = req.body;
    const result = await callAI(body);
    res.send(result);
});

app.listen(PORT, () => {
    console.log(`Example app listening at http://localhost:${PORT}`);
});

async function callAI(body) {
    const result = { code: 401, data: null, msg: null };

    // 解析输入内容
    let content = '';
    if (body.text) {
        content = `请从以下文本提取单号、重量、收件人、电话：${body.text}`;
    } else if (body.filePath) {
        // 文件解析功能
        try {
            const fs = require('fs');
            const path = require('path');
            
            // 检查文件扩展名
            const fileExt = path.extname(body.filePath).toLowerCase();
            
            if (fileExt === '.xlsx' || fileExt === '.xls') {
                // 解析Excel文件
                const workbook = XLSX.readFile(body.filePath);
                let excelContent = '';
                
                // 遍历所有工作表
                workbook.SheetNames.forEach(sheetName => {
                    const worksheet = workbook.Sheets[sheetName];
                    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                    
                    excelContent += `工作表 "${sheetName}":\n`;
                    jsonData.forEach((row, rowIndex) => {
                        excelContent += `第${rowIndex + 1}行: ${JSON.stringify(row)}\n`;
                    });
                    excelContent += '\n';
                });
                
                content = `请从以下Excel文件内容提取单号、重量、收件人、电话：${excelContent}`;
            } else {
                // 解析文本文件
                const fileContent = fs.readFileSync(body.filePath, 'utf8');
                content = `请从以下文件内容提取单号、重量、收件人、电话：${fileContent}`;
            }
        } catch (fileErr) {
            result.msg = `文件读取失败: ${fileErr.message}`;
            return result;
        }
    } else {
        result.msg = '缺少必要的输入参数:text 或 filePath';
        return result;
    }

    // 重试机制（最多3次）
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`第 ${attempt} 次尝试调用AI接口...`);

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

            result.code = 200;
            result.data = response.data.choices[0].message.content;
            console.log(`第 ${attempt} 次尝试成功:`, result);
            return result; // 成功则直接返回

        } catch (err) {
            lastError = err;
            result.msg = `第 ${attempt} 次尝试失败: ${err.message}`;
            result.code = err.response?.status || 500;
            result.data = err.response?.data;
            console.error(`第 ${attempt} 次尝试失败:`, result);

            // 如果不是最后一次尝试，等待一段时间后重试
            if (attempt < maxRetries) {
                const delay = Math.pow(2, attempt) * 1000; // 指数退避：2秒、4秒、8秒
                console.log(`等待 ${delay / 1000} 秒后重试...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    // 所有重试都失败
    result.msg = `所有 ${maxRetries} 次尝试均失败，最后一次错误: ${lastError?.message}`;
    return result;
}