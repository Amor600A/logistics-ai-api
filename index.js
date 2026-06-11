// 1. 导入核心依赖
const express = require('express');
const dotenv = require('dotenv');
const axios = require('axios');
const cors = require('cors');
const XLSX = require('xlsx'); // 添加xlsx库支持
const multer = require('multer'); // 添加multer库支持文件上传
const path = require('path');
const fs = require('fs');
const mammoth = require('mammoth'); // 添加docx文件解析支持
const pdf = require('pdf-parse'); // 添加pdf文件解析支持

// 2. 加载环境变量
dotenv.config();
// 3. 创建 Express 实例
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

// 配置multer文件上传
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // 创建临时上传目录
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // 生成唯一文件名
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

// 文件过滤器
const fileFilter = (req, file, cb) => {
    const allowedTypes = ['.txt', '.doc', '.docx', '.pdf', '.xlsx', '.xls'];
    const fileExt = path.extname(file.originalname).toLowerCase();

    if (allowedTypes.includes(fileExt)) {
        cb(null, true);
    } else {
        cb(new Error(`不支持的文件类型: ${fileExt}，仅支持: ${allowedTypes.join(', ')}`), false);
    }
};

// 配置multer实例
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024, // 限制文件大小为5MB
        files: 1 // 限制每次只能上传一个文件
    }
});

// 跨域
app.use(cors({
    origin: 'http://localhost:8080', // 仅允许前端地址，更安全
    methods: ['POST', 'GET'], // 允许POST和GET请求
    allowedHeaders: ['Content-Type', 'Authorization'] // 允许的请求头
}));
app.use(express.json({ limit: '10mb' })); // 解析 JSON，增加JSON请求体大小限制

// 根路径接口（解决 Cannot GET /）
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

// 文本解析接口
app.post(`${API_PREFIX}/extract-logistics`, async (req, res) => {
    const body = req.body;
    const result = await callAI(body);
    res.send(result);
});

// 文件上传解析接口
app.post(`${API_PREFIX}/upload-extract`, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                code: 400,
                msg: '请选择要上传的文件'
            });
        }

        console.log('文件上传成功:', req.file);

        // 调用AI解析文件
        const result = await callAI({ filePath: req.file.path });

        // 清理临时文件
        try {
            fs.unlinkSync(req.file.path);
            console.log('临时文件已清理:', req.file.path);
        } catch (cleanupErr) {
            console.warn('临时文件清理失败:', cleanupErr.message);
        }

        res.send(result);

    } catch (error) {
        console.error('文件上传处理错误:', error);

        // 清理临时文件（如果存在）
        if (req.file && fs.existsSync(req.file.path)) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (cleanupErr) {
                console.warn('临时文件清理失败:', cleanupErr.message);
            }
        }

        res.status(500).json({
            code: 500,
            msg: `文件处理失败: ${error.message}`
        });
    }
});

// 健康检查接口
app.get(`${API_PREFIX}/health`, (req, res) => {
    res.status(200).json({
        code: 200,
        message: '服务运行正常',
        data: {
            service: 'logistics-ai-api',
            version: '1.0.0',
            uploadSupport: true,
            maxFileSize: '5MB',
            supportedFormats: ['.txt', '.doc', '.docx', '.pdf', '.xlsx', '.xls']
        }
    });
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
            } else if (fileExt === '.docx' || fileExt === '.doc') {
                // 解析Word文档
                const result = await mammoth.extractRawText({ path: body.filePath });
                const docxContent = result.value; // 提取的文本内容
                const messages = result.messages; // 解析过程中的消息

                if (messages.length > 0) {
                    console.warn('Word文档解析警告:', messages);
                }

                content = `请从以下Word文档内容提取单号、重量、收件人、电话：${docxContent}`;
            } else if (fileExt === '.pdf') {
                // 解析PDF文档
                const dataBuffer = fs.readFileSync(body.filePath);
                const pdfData = await pdf(dataBuffer);

                content = `请从以下PDF文档内容提取单号、重量、收件人、电话：${pdfData.text}`;
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

