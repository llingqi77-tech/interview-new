import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { writeFileSync, readFileSync, existsSync } from 'fs';

// 插件：在构建后创建 .nojekyll 文件
const nojekyllPlugin = () => {
  return {
    name: 'nojekyll',
    closeBundle() {
      try {
        writeFileSync(path.resolve(__dirname, 'dist/.nojekyll'), '');
      } catch (error) {
        // 忽略错误，文件可能已经存在
      }
    },
  };
};

export default defineConfig(({ mode }) => {
    // 加载环境变量
    const env = loadEnv(mode, process.cwd(), '');
    
    // 直接读取 .env.local 文件以确保 DEEPSEEK_API_KEY 被加载
    let deepseekApiKey = '';
    const envLocalPath = path.resolve(process.cwd(), '.env.local');
    if (existsSync(envLocalPath)) {
      const envContent = readFileSync(envLocalPath, 'utf-8');
      const match = envContent.match(/DEEPSEEK_API_KEY=(.+)/);
      if (match) {
        deepseekApiKey = match[1].trim();
      }
    }
    
    // 如果 .env.local 中没有，尝试从 loadEnv 加载
    if (!deepseekApiKey) {
      deepseekApiKey = env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY || '';
    }
    
    // 从环境变量获取 base 路径，如果没有则使用默认值 '/'
    // 如果仓库名是 username.github.io，base 应该是 '/'
    // 否则 base 应该是 '/repo-name/'
    const base = env.VITE_BASE_PATH || '/';
    
    // 调试：输出环境变量加载情况
    console.log('DEEPSEEK_API_KEY loaded:', deepseekApiKey ? 'Yes' : 'No');
    if (deepseekApiKey) {
      console.log('DEEPSEEK_API_KEY length:', deepseekApiKey.length);
    }
    
    return {
      base,
      server: {
        port: 3000,
        host: '0.0.0.0',
        fs: {
          strict: false,
        },
      },
      plugins: [react(), nojekyllPlugin()],
      define: {
        'process.env.DEEPSEEK_API_KEY': JSON.stringify(deepseekApiKey || '')
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        rollupOptions: {
          input: {
            main: path.resolve(__dirname, 'index.html'),
            app: path.resolve(__dirname, 'app.html'),
          },
          output: {
            manualChunks: undefined,
          },
        },
      },
    };
});
