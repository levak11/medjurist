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

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Api-Key ${apiKey}`
  };

  async function yandex(method, path, body) {
    const r = await fetch(`https://rest-assistant.api.cloud.yandex.net/assistants/v1/${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await r.text();
    // Яндекс иногда возвращает несколько JSON объектов подряд - берём первый
    const firstJson = text.split('\n').find(l => l.trim().startsWith('{'));
    try {
      return JSON.parse(firstJson || text);
    } catch(e) {
      throw new Error('JSON parse error: ' + text.slice(0, 300));
    }
  }

  try {
    const { messages } = req.body;
    const lastMessage = messages[messages.length - 1].content;

    // 1. Создаём тред
    const thread = await yandex('POST', 'threads', { folderId });
    if (!thread.id) throw new Error('No thread id: ' + JSON.stringify(thread));
    const threadId = thread.id;

    // 2. Отправляем сообщение
    await yandex('POST', 'messages', {
      threadId,
      content: { content: [{ text: { content: lastMessage } }] },
      role: 'USER'
    });

    // 3. Запускаем агента
    const run = await yandex('POST', 'runs', { threadId, assistantId });
    if (!run.id) throw new Error('No run id: ' + JSON.stringify(run));
    const runId = run.id;

    // 4. Ждём завершения (poll каждые 2 сек, до 60 сек)
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));

      const status = await yandex('GET', `runs/${runId}`);
      const st = status?.state?.status || status?.status;

      if (st === 'COMPLETED' || st === 'DONE') {
        // 5. Получаем сообщения из треда
        const msgsData = await yandex('GET', `messages?threadId=${threadId}&pageSize=10`);
        const allMsgs = msgsData.messages || [];
        
        // Ищем последнее сообщение ассистента
        const assistantMsg = allMsgs.find(m => 
          m.author?.role === 'ASSISTANT' || m.role === 'ASSISTANT'
        );

        const text = assistantMsg?.content?.content?.[0]?.text?.content
                  || assistantMsg?.content?.[0]?.text?.content
                  || assistantMsg?.content?.[0]?.text
                  || assistantMsg?.text
                  || 'Ответ получен, но не удалось извлечь текст.';

        return res.status(200).json({ content: [{ type: 'text', text }] });
      }

      if (st === 'FAILED' || st === 'CANCELLED' || st === 'ERROR') {
        return res.status(500).json({ error: 'Run failed with status: ' + st });
      }
    }

    return res.status(500).json({ error: 'Timeout: агент не ответил за 60 секунд' });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
