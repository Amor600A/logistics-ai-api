# 基础镜像：选择和项目兼容的 Node.js 版本（比如 18-alpine，轻量且稳定）
FROM node:20-alpine

# 设置工作目录（容器内的项目目录）
WORKDIR /app

# 复制依赖文件（先复制 package.json 可利用 Docker 缓存，加快构建）
COPY package*.json ./

# 安装依赖（--production 只装生产依赖，减小镜像体积）
RUN npm install --production

# 复制项目所有代码到容器工作目录
COPY . .

# 暴露 API 端口（根据你的项目端口改，比如 3000/8080）
EXPOSE 3001

# 启动命令（指定入口文件，比如 app.js）
CMD ["node", "index.js"]
