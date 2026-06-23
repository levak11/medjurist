export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.YANDEX_API_KEY;
  const folderId = process.env.YANDEX_FOLDER_ID;
  const assistantId = 'fvt9juq9gm5ah5rpn3t8';
  if (!apiKey || !folderId) return res.status(500).json({ error: 'API key not configured' });

  const BASE = 'https://rest-assistant.api.cloud.yandex.net/assistants/v1';
  const H = { 'Content-Type': 'application/json', 'Authorization': `Api-Key ${apiKey}` };

  async function api(method, path, body) {
    const r = await fetch(`${BASE}/${path}`, {
      method, headers: H,
      body: body ? JSON.stringify(body) : undefined
    });
    const raw = await r.text();
    // NDJSON — берём первую строку
    const line = raw.split('\n').find(l => l.trim().startsWith('{'));
    if (!line) throw new Error('No JSON: ' + raw.slice(0, 200));
    return JSON.parse(line);
  }

  try {
    const { messages } = req.body;
    const userText = messages[messages.length - 1].content;

    // 1. Создаём тред
    const thread = await api('POST', 'threads', { folderId });
    if (!thread.id) throw new Error('No thread: ' + JSON.stringify(thread));

    // 2. Отправляем сообщение пользователя
    await api('POST', 'messages', {
      threadId: thread.id,
      content: { content: [{ text: { content: userText } }] },
      role: 'USER'
    });

    // 3. Запускаем агента
    const run = await api('POST', 'runs', { threadId: thread.id, assistantId });
    if (!run.id) throw new Error('No run: ' + JSON.stringify(run));

    // 4. Ждём завершения — poll каждые 2 сек, до 60 сек
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const status = await api('GET', `runs/${run.id}`);
      const st = (status?.state?.status || status?.status || '').toUpperCase();

      if (st === 'COMPLETED' || st === 'DONE') {
        // 5. Получаем сообщения треда
        const data = await api('GET', `messages?threadId=${thread.id}&pageSize=20`);
        const msgs = data.messages || data.items || [];

        // Ищем сообщение ассистента по author.role
        const msg = msgs.find(m => m.author?.role === 'ASSISTANT');
        if (!msg) throw new Error('No assistant message');

        // Точная структура Яндекса: content.content[0].text.content
        const text = msg?.content?.content?.[0]?.text?.content
                  || msg?.content?.[0]?.text?.content
                  || msg?.content?.[0]?.text
                  || JSON.stringify(msg?.content).slice(0, 500);

        return res.status(200).json({ content: [{ type: 'text', text }] });
      }

      if (['FAILED', 'CANCELLED', 'ERROR'].includes(st)) {
        throw new Error('Run failed: ' + st);
      }
    }

    throw new Error('Timeout 60 сек');

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
