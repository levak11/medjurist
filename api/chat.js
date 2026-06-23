export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.YANDEX_API_KEY;
  const folderId = process.env.YANDEX_FOLDER_ID;
  if (!apiKey || !folderId) return res.status(500).json({ error: 'API key not configured' });

  try {
    const { messages, system } = req.body;
    const userText = messages[messages.length - 1].content;

    const response = await fetch('https://rest-assistant.api.cloud.yandex.net/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Api-Key ${apiKey}`,
        'x-folder-id': folderId
      },
      body: JSON.stringify({
        model: `gpt://${folderId}/yandexgpt-pro`,
        instructions: system,
        input: [{ role: 'user', content: userText }],
        temperature: 0.2,
        max_output_tokens: 2000,
        tools: [{ type: 'web_search' }]
      })
    });

    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); }
    catch(e) { throw new Error('JSON error: ' + raw.slice(0, 300)); }

    if (!response.ok) throw new Error(data?.error?.message || data?.message || raw.slice(0, 200));

    const text = data?.output_text
              || data?.output?.[0]?.content?.[0]?.text
              || data?.output?.[0]?.text
              || data?.choices?.[0]?.message?.content
              || JSON.stringify(data).slice(0, 500);

    return res.status(200).json({ content: [{ type: 'text', text }] });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
