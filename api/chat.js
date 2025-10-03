// /api/chat.js
// Serverless endpoint that proxies to OpenAI Chat Completions.
// Set OPENAI_API_KEY in Vercel > Project > Settings > Environment Variables.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
  }

  try {
    const { messages = [], context = null } = req.body || {};

    // If context was provided, prepend a system message with the snapshot.
    const sys = context ? [{
      role: 'system',
      content:
        `You are LocalVault's AI assistant. Use the following JSON snapshot of the user's finances (banks, assets, debts, subscriptions, ISA, totals, recentDayPL) when answering.

USER_SNAPSHOT_JSON:
${JSON.stringify(context)}`
    }] : [];

    const body = {
      model: "gpt-4o-mini",
      messages: [...sys, ...messages],
      temperature: 0.3
    };

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify(body)
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json(data);
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
