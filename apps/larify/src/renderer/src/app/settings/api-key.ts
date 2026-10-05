/**
 * 用户自带的 DeepSeek 官方 API Key。
 *
 * 存在渲染层 localStorage：配了 Key 的请求直连官方、不走 Larify 网关（见 transport.ts），
 * 主进程不落盘、不写日志。Key 只在真正发请求时由渲染层读取、临时附加到 modelConfig，
 * 不会随模型选择一起写进其他 localStorage 条目。
 */
import { createStringSetting } from './string-setting'

const setting = createStringSetting('larify.settings.apiKey')

/** 读取已保存的 Key；未配置返回空串。 */
export const readOwnApiKey = setting.read

/** 保存 Key；留空等价于清除配置（恢复走账号额度）。 */
export const saveOwnApiKey = setting.save
