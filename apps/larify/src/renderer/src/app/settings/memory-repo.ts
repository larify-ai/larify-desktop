/**
 * 用户配置的记忆目录（知识表示）远程 Git 仓库地址。
 *
 * 与自有 API Key 一致存渲染层 localStorage：只在真正发请求时由渲染层读取、随本轮消息
 * 附带（见 transport.ts），主进程据此把它注入系统提示词，告诉模型「记忆目录的远程仓库在哪」。
 * 本应用**不做**任何自动 git 操作——这里只承载一个字符串。
 */
import { createStringSetting } from './string-setting'

const setting = createStringSetting('larify.settings.memoryRepo')

/** 读取已保存的记忆存储地址；未配置返回空串。 */
export const readMemoryRepo = setting.read

/** 保存记忆存储地址；留空等价于清除配置（不向模型注入该信息）。 */
export const saveMemoryRepo = setting.save
