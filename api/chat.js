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
  const hdrs = { 'Content-Type': 'application/json', 'Authorization': `Api-Key ${apiKey}` };

  // Парсим NDJSON — берём первую непустую строку с JSON
  async function yandex(method, path, body) {
    const r = await fetch(`${BASE}/${path}`, {
      method, headers: hdrs,
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await r.text();
    const lines = text.split('\n').filter(l => l.trim().startsWith('{'));
    if (!lines.length) throw new Error('No JSON lines: ' + text.slice(0, 200));
    return JSON.parse(lines[0]);
  }

  // Рекурсивно ищем строку в любой вложенной структуре
  function findText(obj, depth = 0) {
    if (depth > 10 || !obj) return null;
    if (typeof obj === 'string' && obj.length > 5) return obj;
    if (Array.isArray(obj)) {
      for (const item of obj) { const t = findText(item, depth+1); if (t) return t; }
    }
    if (typeof obj === 'object') {
      for (const key of ['text', 'content', 'value', 'message', 'result']) {
        const t = findText(obj[key], depth+1);
        if (t) return t;
      }
    }
    return null;
  }

  try {
    const { messages } = req.body;
    const lastMessage = messages[messages.length - 1].content;

    // 1. Тред
    const thread = await yandex('POST', 'threads', { folderId });
    const threadId = thread.id;
    if (!threadId) throw new Error('No threadId: ' + JSON.stringify(thread));

    // 2. Сообщение
    await yandex('POST', 'messages', {
      threadId,
      content: { content: [{ text: { content: lastMessage } }] },
      role: 'USER'
    });

    // 3. Запуск
    const run = await yandex('POST', 'runs', { threadId, assistantId });
    const runId = run.id;
    if (!runId) throw new Error('No runId: ' + JSON.stringify(run));

    // 4. Ждём
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const status = await yandex('GET', `runs/${runId}`);
      const st = status?.state?.status || status?.status;

      if (st === 'COMPLETED' || st === 'DONE') {
        // 5. Получаем сообщения
        const msgsData = await yandex('GET', `messages?threadId=${threadId}&pageSize=20`);
        const allMsgs = msgsData.messages || msgsData.items || [];

        const assistantMsg = allMsgs.find(m =>
          (m.author?.role || m.role || '').toUpperCase() === 'ASSISTANT'
        );

        if (!assistantMsg) {
          return res.status(200).json({
            content: [{ type: 'text', text: 'DEBUG msgs: ' + JSON.stringify(msgsData).slice(0, 600) }]
          });
        }

        const text = findText(assistantMsg.content)
                  || findText(assistantMsg)
                  || 'DEBUG структура: ' + JSON.stringify(assistantMsg).slice(0, 400);

        return res.status(200).json({ content: [{ type: 'text', text }] });
      }

      if (['FAILED','CANCELLED','ERROR'].includes(st)) {
        return res.status(500).json({ error: 'Run status: ' + st });
      }
    }

    return res.status(500).json({ error: 'Timeout 60 сек' });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
