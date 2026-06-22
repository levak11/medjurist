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

  try {
    const { messages } = req.body;
    const lastMessage = messages[messages.length - 1].content;

    // 1. Создаём тред (диалог)
    const threadRes = await fetch('https://rest-assistant.api.cloud.yandex.net/assistants/v1/threads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Api-Key ${apiKey}`
      },
      body: JSON.stringify({ folderId })
    });
    const threadData = await threadRes.json();
    if (!threadRes.ok) {
      return res.status(500).json({ error: 'Thread error: ' + JSON.stringify(threadData) });
    }
    const threadId = threadData.id;

    // 2. Отправляем сообщение пользователя в тред
    const msgRes = await fetch('https://rest-assistant.api.cloud.yandex.net/assistants/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Api-Key ${apiKey}`
      },
      body: JSON.stringify({
        threadId,
        content: { content: [{ text: { content: lastMessage } }] },
        role: 'USER'
      })
    });
    if (!msgRes.ok) {
      const errData = await msgRes.json();
      return res.status(500).json({ error: 'Message error: ' + JSON.stringify(errData) });
    }

    // 3. Запускаем агента на этом треде
    const runRes = await fetch('https://rest-assistant.api.cloud.yandex.net/assistants/v1/runs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Api-Key ${apiKey}`
      },
      body: JSON.stringify({ threadId, assistantId })
    });
    const runData = await runRes.json();
    if (!runRes.ok) {
      return res.status(500).json({ error: 'Run error: ' + JSON.stringify(runData) });
    }
    const runId = runData.id;

    // 4. Ждём пока агент закончит думать (poll каждые 1.5 сек, до 45 сек)
    let finalText = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1500));

      const statusRes = await fetch(
        `https://rest-assistant.api.cloud.yandex.net/assistants/v1/runs/${runId}`,
        { headers: { 'Authorization': `Api-Key ${apiKey}` } }
      );
      const statusData = await statusRes.json();
      const status = statusData?.state?.status || statusData?.status;

      if (status === 'COMPLETED' || status === 'DONE') {
        // 5. Получаем последнее сообщение ассистента из треда
        const msgsRes = await fetch(
          `https://rest-assistant.api.cloud.yandex.net/assistants/v1/messages?threadId=${threadId}&pageSize=5`,
          { headers: { 'Authorization': `Api-Key ${apiKey}` } }
        );
        const msgsData = await msgsRes.json();
        const assistantMsg = (msgsData.messages || []).find(m => m.author?.role === 'ASSISTANT' || m.role === 'ASSISTANT');

        finalText = assistantMsg?.content?.content?.[0]?.text?.content
                 || assistantMsg?.content?.[0]?.text
                 || 'Не удалось извлечь текст ответа.';
        break;
      }

      if (status === 'FAILED' || status === 'CANCELLED') {
        return res.status(500).json({ error: 'Run failed: ' + JSON.stringify(statusData) });
      }
    }

    if (!finalText) {
      return res.status(500).json({ error: 'Timeout: агент не ответил за 45 секунд' });
    }

    return res.status(200).json({ content: [{ type: 'text', text: finalText }] });

  } catch (error) {
    return res.status(500).json({ error: 'Server error: ' + error.message });
  }
}
