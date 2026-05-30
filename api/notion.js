export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { databaseId } = req.body;
  if (!databaseId) return res.status(400).json({ error: 'Missing databaseId' });

  const TOKEN = process.env.NOTION_TOKEN;
  if (!TOKEN) return res.status(500).json({ error: 'Notion token not configured' });

  try {
    const allResults = [];
    let cursor = undefined;
    let hasMore = true;

    while (hasMore) {
      const body = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;

      const notionRes = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TOKEN}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      const data = await notionRes.json();

      if (!notionRes.ok) {
        // If multi-source error, try searching pages under this parent instead
        if (data.code === 'validation_error' && data.message?.includes('multiple data sources')) {
          return await fallbackSearch(TOKEN, databaseId, res);
        }
        return res.status(notionRes.status).json({ error: data.message || 'Notion API error' });
      }

      allResults.push(...(data.results || []));
      hasMore = data.has_more;
      cursor = data.next_cursor;
    }

    return res.status(200).json({ results: allResults });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function fallbackSearch(TOKEN, databaseId, res) {
  try {
    // Search for all pages that have this database as ancestor
    const searchRes = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filter: { property: 'object', value: 'page' },
        page_size: 100
      })
    });

    const searchData = await searchRes.json();
    if (!searchRes.ok) return res.status(searchRes.status).json({ error: searchData.message });

    // Filter pages whose parent is this database
    const pages = (searchData.results || []).filter(p =>
      p.parent?.type === 'database_id' &&
      p.parent.database_id.replace(/-/g, '') === databaseId.replace(/-/g, '')
    );

    return res.status(200).json({ results: pages });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
