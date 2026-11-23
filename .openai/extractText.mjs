// openai/extractText.mjs
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  // 如果你用国内模型或代理，取消下面这行的注释并填入你的 URL
  // baseURL: process.env.OPENAI_BASE_URL, 
});

export async function extractInventoryFromText(text) {
  if (!process.env.OPENAI_API_KEY) {
    const err = new Error('AI 服务未配置');
    err.code = 'NO_API_KEY';
    throw err;
  }

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini', // 或 deepseek-chat / qwen-turbo 等
    response_format: { type: 'json_object' }, // 强制 JSON 输出
    messages: [
      {
        role: 'system',
        content: `你是一个库存管理助手。请从用户的自然语言中提取物品信息，严格按以下 JSON 格式返回：
{
  "itemName": "物品名称",
  "quantity": 数量(数字),
  "unit": "单位(如:斤、个、瓶)",
  "location": "存放位置",
  "action": "操作类型(买/用/存/移出)",
  "recordTime": "时间描述"
}
未提及的字段严格返回 null，不要编造任何信息。`,
      },
      { role: 'user', content: text },
    ],
    temperature: 0.1, // 低温度，减少随机性
  });

  const raw = completion.choices[0].message.content;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('AI 返回格式异常，请重试或手动录入');
  }
}
