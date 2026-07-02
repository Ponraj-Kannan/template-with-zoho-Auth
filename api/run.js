// Vercel Serverless Function — proxies Java code execution to the remote VM
// ES module format — package.json has "type": "module"

export default async function handler(req, res) {
  // Handle CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { code, input, language = 'java' } = req.body

  const apiUrl = process.env.VITE_EXECUTION_API_URL
  const apiKey = process.env.VITE_EXECUTION_API_KEY

  if (!apiUrl || !apiKey) {
    return res.status(500).json({ success: false, error: 'API configuration missing on server.' })
  }

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      body: JSON.stringify({ code, input: input || '', language })
    })

    const rawText = await response.text()
    let data;
    try {
      data = JSON.parse(rawText)
    } catch (e) {
      // The server returned HTML or plain text instead of JSON
      return res.status(response.status).json({
        success: false,
        error: `Execution server returned HTTP ${response.status} non-JSON response: ${rawText.slice(0, 200)}...`
      })
    }

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: data?.error || data?.output || 'Execution server error'
      })
    }

    return res.status(200).json({ success: true, data })
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message })
  }
}
