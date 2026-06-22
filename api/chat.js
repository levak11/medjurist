export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.YANDEX_API_KEY;
  const assistantId = 'fvt9juq9gm5ah5rpn3t8';
  const folderId = process.env.YANDEX_FOLDER_ID;

  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const BASE = 'https://rest-assistant.api.cloud.yandex.net/assistants/v1';
  const hdrs = {
    'Content-Type': 'application/json',
    'Authorization': `Api-Key ${apiKey}`
  };

  async function req_yandex(method, path, body) {
    const r = await fetch(`${BASE}/${path}`, {
      method,
      headers: hdrs,
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await r.text();
    // Берём первый JSON объект из ответа
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response: ' + text.slice(0, 200));
    return JSON.parse(match[0]);
  }

  // Рекурсивно ищем текст в любой структуре
  function extractText(obj) {
    if (!obj) return null;
    if (typeof obj === 'string') return obj;
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const t = extractText(item);
        if (t) return t;
      }
    }
    if (typeof obj === 'object') {
      // Прямые поля с текстом
      if (obj.text && typeof obj.text === 'string') return obj.text;
      if (obj.content && typeof obj.content === 'string') return obj.content;
      // Вложенные структуры Яндекса
      if (obj.text?.content) return obj.text.content;
      if (obj.content?.content) return extractText(obj.content.content);
      // Перебираем все поля
      for (const key of ['text', 'content', 'message', 'parts', 'blocks']) {
        if (obj[key]) {
          const t = extractText(obj[key]);
          if (t) return t;
        }
      }
    }
    return null;
  }

  try {
    const { messages } = req.body;
    const lastMessage = messages[messages.length - 1].content;

    // 1. Создаём тред
    const thread = await req_yandex('POST', 'threads', { folderId });
    const threadId = thread.id;
    if (!threadId) throw new Error('No thread id: ' + JSON.stringify(thread));

    // 2. Отправляем сообщение
    await req_yandex('POST', 'messages', {
      threadId,
      content: { content: [{ text: { content: lastMessage } }] },
      role: 'USER'
    });

    // 3. Запускаем агента
    const run = await req_yandex('POST', 'runs', { threadId, assistantId });
    const runId = run.id;
    if (!runId) throw new Error('No run id: ' + JSON.stringify(run));

    // 4. Ждём завершения
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const status = await req_yandex('GET', `runs/${runId}`);
      const st = status?.state?.status || status?.status;

      if (st === 'COMPLETED' || st === 'DONE') {
        // 5. Получаем все сообщения треда
        const msgsData = await req_yandex('GET', `messages?threadId=${threadId}&pageSize=20`);
        
        // Возвращаем сырой ответ для диагностики если не нашли текст
        const allMsgs = msgsData.messages || msgsData.items || [];
        
        // Ищем сообщение ассистента
        const assistantMsg = allMsgs.find(m => 
          m.author?.role === 'ASSISTANT' || 
          m.role === 'ASSISTANT' ||
          m.author?.role === 'assistant' ||
          m.role === 'assistant'
        );

        if (!assistantMsg) {
          // Отдаём полный ответ для диагностики
          return res.status(200).json({ 
            content: [{ type: 'text', text: 'DEBUG: ' + JSON.stringify(msgsData).slice(0, 500) }] 
          });
        }

        const text = extractText(assistantMsg) || 
                     'Ответ получен, структура: ' + JSON.stringify(assistantMsg).slice(0, 300);

        return res.status(200).json({ content: [{ type: 'text', text }] });
      }

      if (st === 'FAILED' || st === 'CANCELLED' || st === 'ERROR') {
        return res.status(500).json({ error: 'Run failed: ' + st });
      }
    }

    return res.status(500).json({ error: 'Timeout 60 сек' });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
