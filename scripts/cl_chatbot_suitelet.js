/**
 * cl_chatbot_suitelet.js
 * NetSuite AI Chatbot — Standalone Suitelet
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * DEPLOYMENT NOTES:
 *   - Available Without Login: NO (security — user must be authenticated)
 *   - Audience: Roles that should access the chatbot (e.g., CFO, Controller, Admin)
 *
 * Single-file design:
 *   - GET request  → renders the full chat UI as an HTML page
 *   - POST request → handles questions, calls Claude API, returns JSON
 *
 * SETUP REQUIRED — API key is stored in a Custom Record:
 *   1) Custom Record Type: customrecord_chatbot_settings
 *   2) Field: custrecord_claude_api_key (Long Text)
 *   3) Create one record instance with your Anthropic API key in that field.
 */
define(['N/https', 'N/query', 'N/runtime', 'N/log', 'N/search'],
(https, query, runtime, log, search) => {

    // ─── Config ─────────────────────────────────────────────────────────────────
    const CLAUDE_MODEL = 'claude-sonnet-4-5';
    const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
    const CLAUDE_API_VERSION = '2023-06-01';
    const MAX_TOKENS = 2048;
    const HTTPS_TIMEOUT_MS = 45000;
    const MAX_ROWS_TO_CLAUDE = 75;
    const MAX_DATA_CHARS = 15000;

    const SETTINGS_RECORD_TYPE = 'customrecord_chatbot_settings';
    const SETTINGS_FIELD_API_KEY = 'custrecord_claude_api_key';

    // ─── Entry Point ────────────────────────────────────────────────────────────

    const onRequest = (context) => {
        if (context.request.method === 'GET') {
            return renderChatPage(context);
        }
        if (context.request.method === 'POST') {
            return handleQuestion(context);
        }

        context.response.setHeader({ name: 'Content-Type', value: 'application/json' });
        context.response.write(JSON.stringify({ success: false, answer: 'Invalid request method.' }));
    };

    // ─── GET: Render Chat Page ──────────────────────────────────────────────────

    const renderChatPage = (context) => {
        context.response.setHeader({ name: 'Content-Type', value: 'text/html; charset=utf-8' });
        context.response.write(buildChatPage());
    };

    const buildChatPage = () => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>NetSuite AI Assistant</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; height: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f3f4f6; }
  #app { display: flex; flex-direction: column; height: 100vh; max-width: 900px; margin: 0 auto; background: #fff; box-shadow: 0 0 24px rgba(0,0,0,0.06); }
  #header { background: #1a3a6b; color: #fff; padding: 14px 22px; display: flex; align-items: center; gap: 10px; }
  #header-title { font-size: 16px; font-weight: 600; flex: 1; }
  #header-account { background: rgba(255,255,255,0.15); font-size: 12px; padding: 3px 10px; border-radius: 12px; }
  #suggestions { display: flex; flex-wrap: wrap; gap: 8px; padding: 14px 22px 8px; border-bottom: 1px solid #e5e7eb; background: #fafbfc; }
  .chip { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; border-radius: 16px; padding: 6px 14px; font-size: 13px; cursor: pointer; }
  .chip:hover { background: #dbeafe; }
  #messages { flex: 1; overflow-y: auto; padding: 22px; display: flex; flex-direction: column; gap: 14px; }
  .msg { max-width: 78%; padding: 12px 16px; border-radius: 16px; font-size: 14px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
  .msg.user { align-self: flex-end; background: #0f62fe; color: #fff; border-bottom-right-radius: 4px; }
  .msg.bot { align-self: flex-start; background: #f3f4f6; color: #1a1a1a; border-bottom-left-radius: 4px; }
  .msg.thinking { align-self: flex-start; background: #f3f4f6; color: #6b7280; font-style: italic; }
  #input-row { display: flex; gap: 10px; padding: 14px 22px; border-top: 1px solid #e5e7eb; background: #fff; }
  #input { flex: 1; padding: 11px 16px; border: 1px solid #d1d5db; border-radius: 22px; font-size: 14px; outline: none; }
  #input:focus { border-color: #0f62fe; }
  #send { background: #0f62fe; color: #fff; border: none; border-radius: 22px; padding: 11px 24px; font-size: 14px; font-weight: 600; cursor: pointer; }
  #send:hover { background: #0353e9; }
  #send:disabled { background: #9ca3af; cursor: not-allowed; }
</style>
</head>
<body>
<div id="app">
  <div id="header">
    <span id="header-title">✦ NetSuite AI Assistant</span>
    <span id="header-account">Squire Enterprises</span>
  </div>
  <div id="suggestions">
    <span class="chip" data-q="Show open invoices over 90 days">AR over 90 days</span>
    <span class="chip" data-q="What are our top 10 vendors by spend this year?">Top vendors by spend</span>
    <span class="chip" data-q="Show me recent vendor bills over $10,000">Large vendor bills</span>
    <span class="chip" data-q="Find cost saving opportunities in our vendor spend">Cost savings</span>
    <span class="chip" data-q="What is our current open AP balance?">Open AP balance</span>
  </div>
  <div id="messages">
    <div class="msg bot">👋 Hi! I'm your NetSuite AI assistant. Ask me anything about your financial data — invoices, vendors, customers, spend analysis, or cost saving opportunities.</div>
  </div>
  <div id="input-row">
    <input id="input" type="text" placeholder="Ask about your NetSuite data..." autocomplete="off" />
    <button id="send" type="button">Send</button>
  </div>
</div>

<script>
(function() {
  // Post back to this same Suitelet URL (same page, different HTTP method)
  var SUITELET_URL = window.location.pathname + window.location.search;

  function appendMessage(text, role) {
    var msgs = document.getElementById('messages');
    var div = document.createElement('div');
    div.className = 'msg ' + role;
    div.textContent = text;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }

  function send(presetQuestion) {
    var input = document.getElementById('input');
    var btn = document.getElementById('send');
    var question = (presetQuestion || input.value || '').trim();
    if (!question) return;

    input.value = '';
    btn.disabled = true;
    btn.textContent = '...';

    appendMessage(question, 'user');
    var thinking = appendMessage('Thinking...', 'thinking');

    fetch(SUITELET_URL, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: question })
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      thinking.remove();
      appendMessage(data.answer || 'No response received.', 'bot');
    })
    .catch(function() {
      thinking.remove();
      appendMessage('Connection error. Please try again.', 'bot');
    })
    .then(function() {
      btn.disabled = false;
      btn.textContent = 'Send';
      input.focus();
    });
  }

  document.getElementById('send').addEventListener('click', function() { send(); });
  document.getElementById('input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') send();
  });

  var chips = document.querySelectorAll('.chip');
  for (var i = 0; i < chips.length; i++) {
    chips[i].addEventListener('click', function(e) {
      send(e.currentTarget.getAttribute('data-q'));
    });
  }

  document.getElementById('input').focus();
})();
</script>
</body>
</html>`;

    // ─── POST: Handle Question ──────────────────────────────────────────────────

    const handleQuestion = (context) => {
        context.response.setHeader({ name: 'Content-Type', value: 'application/json' });

        let question = '';
        try {
            const body = JSON.parse(context.request.body || '{}');
            question = (body.question || '').trim();
        } catch (e) {
            context.response.write(JSON.stringify({ success: false, answer: 'Could not parse request.' }));
            return;
        }

        if (!question) {
            context.response.write(JSON.stringify({ success: false, answer: 'Please ask a question.' }));
            return;
        }

        try {
            const answer = processQuestion(question);
            context.response.write(JSON.stringify({ success: true, answer }));
        } catch (e) {
            log.error({ title: 'Chatbot Error', details: e.toString() });
            context.response.write(JSON.stringify({
                success: false,
                answer: 'Sorry, I ran into an error. Please try rephrasing your question.'
            }));
        }
    };

    // ─── API Key Loader ──────────────────────────────────────────────────────────

    const loadApiKey = () => {
        const results = search.create({
            type: SETTINGS_RECORD_TYPE,
            columns: [
                search.createColumn({ name: SETTINGS_FIELD_API_KEY }),
                search.createColumn({ name: 'lastmodified', sort: search.Sort.DESC })
            ]
        }).run().getRange({ start: 0, end: 1 });

        if (!results || results.length === 0) {
            throw new Error('No AI Chatbot Settings record found. Create one with your API key.');
        }

        const apiKey = results[0].getValue({ name: SETTINGS_FIELD_API_KEY });
        if (!apiKey) {
            throw new Error('AI Chatbot Settings record exists, but the API key field is empty.');
        }

        return apiKey;
    };

    // ─── Main Logic ─────────────────────────────────────────────────────────────

    const processQuestion = (question) => {
        const apiKey = loadApiKey();
        const queryPlan = generateSuiteQL(apiKey, question);
        log.debug({ title: 'Query Plan', details: JSON.stringify(queryPlan) });

        let queryResults = '';
        if (queryPlan.sql) {
            queryResults = runSuiteQL(queryPlan.sql);
        }

        return interpretResults(apiKey, question, queryPlan, queryResults);
    };

    // ─── Step 1: Generate SuiteQL ────────────────────────────────────────────────

    const generateSuiteQL = (apiKey, question) => {
        const systemPrompt = `You are a NetSuite SuiteQL expert for Squire Enterprises.
Given a business question, generate the best SuiteQL query to retrieve the relevant data.

AVAILABLE TABLES & KEY FIELDS:
- transaction (alias t): id, type, trandate, tranid, entity, foreigntotal, foreignamountunpaid, status, postingperiod, subsidiary, memo
- transactionline (alias tl): transaction, account, foreignamount, debitforeignamount, creditforeignamount, department, class, location, memo, mainline
- customer (alias c): id, entityid, companyname, email, phone, balance, salesrep, subsidiary, isinactive
- vendor (alias v): id, entityid, companyname, email, phone, balance, category, subsidiary, isinactive
- account (alias a): id, accttype, acctnumber, fullname, description
- item (alias i): id, itemid, displayname, salesdescription, type, isinactive
- department: id, name, fullname
- subsidiary: id, name, fullname
- classification: id, name, fullname
- location: id, name, fullname

TRANSACTION TYPES (exact values for t.type):
'CustInvc' = Invoice | 'CustPymt' = Customer Payment | 'CustCred' = Credit Memo
'VendBill' = Vendor Bill | 'VendPymt' = Vendor Payment | 'VendCred' = Vendor Credit
'Journal' = Journal Entry | 'PurchOrd' = Purchase Order | 'SalesOrd' = Sales Order

KEY RULES (NetSuite SuiteQL quirks):
- Always use ROWNUM <= ${MAX_ROWS_TO_CLAUDE} for list queries to avoid timeout/oversized results
- Use TO_CHAR(t.trandate, 'MM/DD/YYYY') for readable dates
- For current month: WHERE TO_CHAR(t.trandate,'YYYY-MM') = TO_CHAR(SYSDATE,'YYYY-MM')
- For current year: WHERE EXTRACT(YEAR FROM t.trandate) = EXTRACT(YEAR FROM SYSDATE)
- For OPEN invoices/bills: WHERE t.foreignamountunpaid > 0 (preferred over status field)
- For AR aging: WHERE t.type = 'CustInvc' AND t.foreignamountunpaid > 0
- For AP aging: WHERE t.type = 'VendBill' AND t.foreignamountunpaid > 0
- For fuzzy name searches: WHERE UPPER(c.companyname) LIKE UPPER('%search%')
- When summing transactionline amounts, filter tl.mainline = 'F' to exclude summary lines, or = 'T' to include only summary
- Always alias every table

COMMON COST SAVINGS PATTERNS:
- Duplicate vendor names: SELECT companyname, COUNT(*) FROM vendor GROUP BY companyname HAVING COUNT(*) > 1
- Top vendor spend: SELECT v.companyname, SUM(t.foreigntotal) FROM transaction t JOIN vendor v ON t.entity = v.id WHERE t.type = 'VendBill' GROUP BY v.companyname ORDER BY 2 DESC
- Spend by department/class: JOIN transactionline tl ... GROUP BY tl.department

Return ONLY a raw JSON object (no markdown, no backticks, no preamble):
{"sql":"SELECT ...","description":"plain English description of what this query does"}

If the question doesn't need SQL (greeting, capabilities question, etc.), return:
{"sql":null,"description":"plain English answer to the question"}`;

        const response = callClaude(apiKey, systemPrompt, question);

        try {
            const cleaned = response.replace(/```json|```/g, '').trim();
            const parsed = JSON.parse(cleaned);
            return {
                sql: parsed.sql || null,
                description: parsed.description || ''
            };
        } catch (e) {
            log.error({ title: 'SQL Parse Error', details: response });
            return { sql: null, description: response };
        }
    };

    // ─── Step 2: Run SuiteQL ─────────────────────────────────────────────────────

    const runSuiteQL = (sql) => {
        try {
            const resultSet = query.runSuiteQL({ query: sql });
            const rows = resultSet.asMappedResults();

            if (!rows || rows.length === 0) return 'No results found.';

            const trimmed = rows.slice(0, MAX_ROWS_TO_CLAUDE);
            let json = JSON.stringify(trimmed);

            if (json.length > MAX_DATA_CHARS) {
                json = json.substring(0, MAX_DATA_CHARS) + '... [results truncated for size]';
            }
            return json;
        } catch (e) {
            log.error({ title: 'SuiteQL Error', details: `SQL: ${sql} | Error: ${e.toString()}` });
            return `Query error: ${e.message}. The query may need adjustment.`;
        }
    };

    // ─── Step 3: Interpret Results ───────────────────────────────────────────────

    const interpretResults = (apiKey, question, queryPlan, data) => {
        const systemPrompt = `You are a smart, friendly NetSuite financial assistant for Squire Enterprises.
Your job is to analyze NetSuite data and give clear, actionable answers to business questions.

GUIDELINES:
- Format dollar amounts with $ and commas (e.g. $12,450.00)
- Present lists in a clean, readable way (use line breaks, not raw JSON)
- If you see cost saving opportunities in the data, proactively call them out with a 💡 prefix
- If data is empty or missing, say so clearly and suggest what to check
- Keep answers concise — lead with the key insight, then support with details
- Do not mention SuiteQL, JSON, queries, or other technical terms in your answer
- If the question was about a specific record, lead with the most relevant info`;

        const userMessage = [
            `User question: ${question}`,
            queryPlan.description ? `Query description: ${queryPlan.description}` : '',
            queryPlan.sql ? `Data returned from NetSuite:\n${data}` : ''
        ].filter(Boolean).join('\n\n');

        return callClaude(apiKey, systemPrompt, userMessage);
    };

    // ─── Claude API Call ─────────────────────────────────────────────────────────

    const callClaude = (apiKey, systemPrompt, userMessage) => {
        if (!apiKey) throw new Error('Claude API key not loaded.');

        let response;
        try {
            response = https.post({
                url: CLAUDE_API_URL,
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': CLAUDE_API_VERSION
                },
                body: JSON.stringify({
                    model: CLAUDE_MODEL,
                    max_tokens: MAX_TOKENS,
                    system: systemPrompt,
                    messages: [{ role: 'user', content: userMessage }]
                }),
                timeout: HTTPS_TIMEOUT_MS
            });
        } catch (e) {
            throw new Error(`Network error calling Claude API: ${e.message}`);
        }

        if (response.code !== 200) {
            log.error({ title: 'Claude API Error', details: `Status: ${response.code} | Body: ${response.body}` });
            throw new Error(`Claude API returned status ${response.code}`);
        }

        let parsed;
        try {
            parsed = JSON.parse(response.body);
        } catch (e) {
            throw new Error('Could not parse Claude response.');
        }

        if (!parsed.content || !parsed.content[0] || !parsed.content[0].text) {
            log.error({ title: 'Empty Claude Response', details: JSON.stringify(parsed) });
            throw new Error('Claude returned an empty response.');
        }

        return parsed.content[0].text;
    };

    return { onRequest };
});
