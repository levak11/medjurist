export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.YANDEX_API_KEY;
  const folderId = process.env.YANDEX_FOLDER_ID;

  if (!apiKey || !folderId) {
    return res.status(500).json({ error: 'API key or folder ID not configured' });
  }

  try {
    const { messages, system } = req.body;

    const yandexMessages = [
      { role: 'system', text: system },
      ...messages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      }))
    ];

    const response = await fetch('https://llm.api.cloud.yandex.net/foundationModels/v1/completion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Api-Key ${apiKey}`,
        'x-folder-id': folderId
      },
      body: JSON.stringify({
        modelUri: `gpt://${folderId}/yandexgpt/latest`,
        completionOptions: {
          stream: false,
          temperature: 0.3,
          maxTokens: "1500"
        },
        messages: yandexMessages
      })
    });

    const rawText = await response.text();
    
    let data;
    try {
      data = JSON.parse(rawText);
    } catch(e) {
      return res.status(500).json({ error: 'Invalid JSON from Yandex: ' + rawText.slice(0, 200) });
    }

    if (!response.ok) {
      const errMsg = data?.message || data?.error?.message || data?.error || rawText.slice(0, 200);
      return res.status(response.status).json({ error: errMsg });
    }

    const text = data?.result?.alternatives?.[0]?.message?.text || 'Не удалось получить ответ.';
    return res.status(200).json({ content: [{ type: 'text', text }] });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
