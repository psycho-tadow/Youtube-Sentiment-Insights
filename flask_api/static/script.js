// ---------------------------------------------------------------
// Signal — YouTube comment sentiment UI
// Talks to the Flask backend in this same project (Youtube-Sentiment.py)
// ---------------------------------------------------------------

const videoUrlInput = document.getElementById('videoUrl');
const apiKeyInput = document.getElementById('apiKey');
const maxCommentsSelect = document.getElementById('maxComments');
const analyzeBtn = document.getElementById('analyzeBtn');
const statusEl = document.getElementById('status');

const resultsEl = document.getElementById('results');
const summaryEl = document.getElementById('summary');
const chartImg = document.getElementById('chartImg');
const wordcloudImg = document.getElementById('wordcloudImg');
const trendSection = document.getElementById('trendSection');
const trendImg = document.getElementById('trendImg');
const commentsBody = document.getElementById('commentsBody');
const filterRow = document.getElementById('filterRow');

// Remember the API key locally so the user doesn't retype it every time.
apiKeyInput.value = localStorage.getItem('yt_api_key') || '';

let lastResults = []; // [{comment, sentiment, timestamp}]

analyzeBtn.addEventListener('click', runAnalysis);

filterRow.addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-pill');
  if (!btn) return;
  [...filterRow.children].forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  renderComments(lastResults, btn.dataset.filter);
});

function setStatus(message, kind) {
  statusEl.textContent = message || '';
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtu\.be\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  // Fall back: maybe the user just pasted the raw 11-char ID
  if (/^[A-Za-z0-9_-]{11}$/.test(url.trim())) return url.trim();
  return null;
}

async function fetchComments(videoId, apiKey, maxCount) {
  const items = [];
  let pageToken = '';

  while (items.length < maxCount) {
    const url = new URL('https://www.googleapis.com/youtube/v3/commentThreads');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('videoId', videoId);
    url.searchParams.set('maxResults', '100');
    url.searchParams.set('order', 'relevance');
    url.searchParams.set('textFormat', 'plainText');
    url.searchParams.set('key', apiKey);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error?.message || `YouTube API error (${res.status})`);
    }
    const data = await res.json();

    for (const item of data.items || []) {
      const top = item.snippet.topLevelComment.snippet;
      items.push({
        text: top.textDisplay,
        timestamp: top.publishedAt
      });
      if (items.length >= maxCount) break;
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return items;
}

async function runAnalysis() {
  const videoUrl = videoUrlInput.value.trim();
  const apiKey = apiKeyInput.value.trim();
  const maxCount = parseInt(maxCommentsSelect.value, 10);

  if (!videoUrl) { setStatus('Paste a YouTube video URL first.', 'error'); return; }
  if (!apiKey) { setStatus('Add your YouTube Data API key.', 'error'); return; }

  const videoId = extractVideoId(videoUrl);
  if (!videoId) { setStatus("Couldn't find a video ID in that URL.", 'error'); return; }

  localStorage.setItem('yt_api_key', apiKey);
  analyzeBtn.disabled = true;
  resultsEl.hidden = true;

  try {
    setStatus('Pulling comments from YouTube…', 'working');
    const rawComments = await fetchComments(videoId, apiKey, maxCount);

    if (rawComments.length === 0) {
      setStatus('No comments found on that video.', 'error');
      return;
    }

    setStatus(`Scoring ${rawComments.length} comments…`, 'working');
    const predictRes = await fetch('/predict_with_timestamps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments: rawComments })
    });
    if (!predictRes.ok) {
      const err = await predictRes.json().catch(() => ({}));
      throw new Error(err.error || `Prediction failed (${predictRes.status})`);
    }
    const results = await predictRes.json(); // [{comment, sentiment, timestamp}]
    lastResults = results;

    setStatus('Building charts…', 'working');
    await Promise.all([
      loadChart(results),
      loadWordcloud(results),
      loadTrend(results)
    ]);

    renderSummary(results);
    renderComments(results, 'all');
    [...filterRow.children].forEach(c => c.classList.remove('active'));
    filterRow.querySelector('[data-filter="all"]').classList.add('active');

    resultsEl.hidden = false;
    setStatus(`Done — analyzed ${results.length} comments.`, 'done');
  } catch (err) {
    console.error(err);
    setStatus(err.message || 'Something went wrong.', 'error');
  } finally {
    analyzeBtn.disabled = false;
  }
}

function countSentiments(results) {
  const counts = { '1': 0, '0': 0, '-1': 0 };
  for (const r of results) {
    if (counts[r.sentiment] !== undefined) counts[r.sentiment]++;
  }
  return counts;
}

function renderSummary(results) {
  const counts = countSentiments(results);
  const total = results.length;
  const pct = (n) => total ? Math.round((n / total) * 100) : 0;

  summaryEl.innerHTML = `
    <div class="stat positive">
      <div class="stat-label">Positive</div>
      <div class="stat-value">${pct(counts['1'])}%</div>
    </div>
    <div class="stat neutral">
      <div class="stat-label">Neutral</div>
      <div class="stat-value">${pct(counts['0'])}%</div>
    </div>
    <div class="stat negative">
      <div class="stat-label">Negative</div>
      <div class="stat-value">${pct(counts['-1'])}%</div>
    </div>
  `;
}

async function loadChart(results) {
  const counts = countSentiments(results);
  const res = await fetch('/generate_chart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sentiment_counts: counts })
  });
  if (!res.ok) return;
  chartImg.src = URL.createObjectURL(await res.blob());
}

async function loadWordcloud(results) {
  const res = await fetch('/generate_wordcloud', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comments: results.map(r => r.comment) })
  });
  if (!res.ok) return;
  wordcloudImg.src = URL.createObjectURL(await res.blob());
}

async function loadTrend(results) {
  const res = await fetch('/generate_trend_graph', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sentiment_data: results.map(r => ({ timestamp: r.timestamp, sentiment: r.sentiment }))
    })
  });
  if (!res.ok) { trendSection.hidden = true; return; }
  trendImg.src = URL.createObjectURL(await res.blob());
  trendSection.hidden = false;
}

function sentimentBadge(sentiment) {
  const map = {
    '1': ['pos', 'Positive'],
    '0': ['neu', 'Neutral'],
    '-1': ['neg', 'Negative']
  };
  const [cls, label] = map[sentiment] || ['neu', sentiment];
  return `<span class="sentiment-badge ${cls}">${label}</span>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderComments(results, filter) {
  const rows = results.filter(r => filter === 'all' || r.sentiment === filter);

  if (rows.length === 0) {
    commentsBody.innerHTML = `<tr><td colspan="2">No comments in this category.</td></tr>`;
    return;
  }

  commentsBody.innerHTML = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.comment)}</td>
      <td>${sentimentBadge(r.sentiment)}</td>
    </tr>
  `).join('');
}
