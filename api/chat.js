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
    const line = raw.split('\n').find(l => l.trim().startsWith('{'));
    if (!line) throw new Error('No JSON: ' + raw.slice(0, 200));
    return JSON.parse(line);
  }

  try {
    const { messages } = req.body;
    const userText = messages[messages.length - 1].content;

    const thread = await api('POST', 'threads', { folderId });
    if (!thread.id) throw new Error('No thread: ' + JSON.stringify(thread));

    await api('POST', 'messages', {
      threadId: thread.id,
      content: { content: [{ text: { content: userText } }] },
      role: 'USER'
    });

    const run = await api('POST', 'runs', { threadId: thread.id, assistantId });
    if (!run.id) throw new Error('No run: ' + JSON.stringify(run));

    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const status = await api('GET', `runs/${run.id}`);
      const st = (status?.state?.status || status?.status || '').toUpperCase();

      if (st === 'COMPLETED' || st === 'DONE') {
        const data = await api('GET', `messages?threadId=${thread.id}&pageSize=20`);
        const msgs = data.messages || data.items || [];

        // Берём ПОСЛЕДНЕЕ сообщение — оно и есть ответ ассистента
        const msg = msgs[0];
        if (!msg) throw new Error('No messages at all');

        // Пробуем все возможные пути к тексту
        const text = msg?.content?.content?.[0]?.text?.content
                  || msg?.content?.[0]?.text?.content
                  || msg?.content?.[0]?.text
                  || msg?.content?.text?.content
                  || msg?.content?.text
                  || msg?.text?.content
                  || msg?.text
                  || 'Структура: ' + JSON.stringify(msg).slice(0, 600);

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
