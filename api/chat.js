// LocalVault — AI Assistant client (v3)
// Robust to DOM timing & CDN caching. Includes LocalVault snapshot with user consent.

window.addEventListener('DOMContentLoaded', () => {
  const chatEl  = document.getElementById('chat');
  const inputEl = document.getElementById('input');
  const sendEl  = document.getElementById('send');
  const clearEl = document.getElementById('clearBtn');
  const shareEl = document.getElementById('shareToggle');
  const dataChip = document.getElementById('dataChip');

  if (!chatEl || !inputEl || !sendEl) {
    // If this ever logs, the script loaded before DOM; but DOMContentLoaded should prevent that.
    console.error('Chat DOM not ready.');
    return;
  }

  const CHAT_KEY = 'lv_chat_history_v1';

  // ---------- UI helpers ----------
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const scrollBottom = () => { chatEl.scrollTop = chatEl.scrollHeight; };

  function renderMessage(role, content){
    const row = el('div', 'msg ' + (role === 'user' ? 'me' : role === 'assistant' ? 'ai' : 'sys'));
    const bubble = el('div', 'bubble');
    bubble.textContent = content;
    row.appendChild(bubble);
    chatEl.appendChild(row);
    scrollBottom();
  }

  function saveHistory(){
    const rows = [...chatEl.querySelectorAll('.msg .bubble')].map((b)=>{
      const row = b.parentElement;
      const role = row.classList.contains('me') ? 'user' :
                   row.classList.contains('ai') ? 'assistant' : 'system';
      return { role, content: b.textContent };
    });
    localStorage.setItem(CHAT_KEY, JSON.stringify(rows));
  }
  function loadHistory(){
    try{
      const raw = localStorage.getItem(CHAT_KEY);
      if(!raw) return false;
      const rows = JSON.parse(raw);
      rows.forEach(m => renderMessage(m.role, m.content));
      return rows.length>0;
    }catch{ return false; }
  }

  // ---------- LocalVault snapshot ----------
  function getLVContext(){
    try{
      const s = JSON.parse(localStorage.getItem('wealthTrackerV1') || '{}');
      if (!s || typeof s !== 'object') return null;

      const toNum = v => isFinite(+v) ? +v : 0;
      const sum = (arr=[]) => arr.reduce((a,b)=> a + (toNum(b.amount)||0), 0);

      // passive monthly from categories
      const passiveMonthly = (s.passiveCats||[]).reduce(
        (acc, c) => acc + (c.items||[]).reduce((a,b)=> a + (toNum(b.amount)||0), 0)
      , 0);

      // ISA math
      const principal = toNum(s?.isa?.principal || 0);
      const rate = toNum(s?.isa?.rate || 0) / 100;
      const compound = !!(s?.settings?.compoundISA);
      const monthlyRate = compound ? (Math.pow(1+rate, 1/12)-1) : (rate/12);
      const isaMonthly = principal * monthlyRate;
      const isaYearly = principal * (compound ? (Math.pow(1+monthlyRate,12)-1) : rate);

      // recent daily P/L (last up to 30 non-zero)
      let recent = [];
      try{
        const entries = Object.entries(s.days || {});
        const sorted = entries.sort((a,b) => a[0] < b[0] ? 1 : -1);
        for(const [date, val] of sorted){
          if (recent.length >= 30) break;
          const t = toNum(val?.total || 0);
          if (t !== 0) recent.push({ date, total: t });
        }
      }catch{}

      return {
        currency: s.currency || 'GBP',
        banks: s.banks || [],
        assets: s.assets || [],
        debts: s.debts || [],
        passiveCats: s.passiveCats || [],
        subscriptions: s.subscriptions || [],
        isa: { principal: principal, rate: toNum(s?.isa?.rate || 0) },
        settings: {
          includeIsaInNet: !!s?.settings?.includeIsaInNet,
          startOnMonday: !!s?.settings?.startOnMonday
        },
        totals: {
          bank: sum(s.banks), asset: sum(s.assets), debt: sum(s.debts),
          passiveMonthly, isaMonthly, isaYearly
        },
        recentDayPL: recent
      };
    } catch {
      return null;
    }
  }

  function refreshDataChip(){
    const ctx = getLVContext();
    if (ctx) {
      dataChip.textContent = `Data detected • ${ctx.currency}`;
      dataChip.classList.remove('muted');
    } else {
      dataChip.textContent = 'No LocalVault data found';
      dataChip.classList.add('muted');
    }
  }

  // ---------- Chat logic ----------
  let sending = false;

  async function sendMessage(){
    if (sending) return;
    const text = (inputEl.value || '').trim();
    if (!text) return;

    renderMessage('user', text);
    saveHistory();
    inputEl.value = '';
    inputEl.style.height = 'auto';

    sending = true;
    sendEl.disabled = true;

    try{
      const includeData = !!shareEl.checked;
      const context = includeData ? getLVContext() : null;

      const history = [...chatEl.querySelectorAll('.msg .bubble')].map(b=>{
        const role = b.parentElement.classList.contains('me') ? 'user'
                   : b.parentElement.classList.contains('ai') ? 'assistant'
                   : 'system';
        return { role, content: b.textContent };
      });

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ messages: history, context })
      });

      const data = await res.json();

      if (!res.ok) {
        // Fallback: inline snapshot as system message if route doesn't accept `context`
        if (context) {
          const sysInline = {
            role: 'system',
            content:
`You are LocalVault's AI assistant.
Here is the user's current snapshot as JSON. Use it when answering.

USER_SNAPSHOT_JSON:
${JSON.stringify(context)}`
          };
          const res2 = await fetch('/api/chat', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ messages: [sysInline, ...history] })
          });
          const data2 = await res2.json();
          if (!res2.ok) throw new Error(JSON.stringify(data2));
          const msg2 = data2.choices?.[0]?.message?.content || '[No response]';
          renderMessage('assistant', msg2);
          saveHistory();
        } else {
          throw new Error(data?.error?.message || 'Request failed');
        }
      } else {
        const msg = data.choices?.[0]?.message?.content || '[No response]';
        renderMessage('assistant', msg);
        saveHistory();
      }
    } catch (err) {
      console.error(err);
      renderMessage('system', `Error: ${err?.message || err}`);
    } finally {
      sending = false;
      sendEl.disabled = false;
      scrollBottom();
    }
  }

  // ---------- Wire up ----------
  if (!loadHistory()) {
    renderMessage('assistant',
`Hi! I’m your LocalVault helper.
Ask me about budgeting, subscriptions, ISA math, or to analyze your balances & assets.
Tip: toggle “Include my LocalVault data” to let me use your numbers.`);
  }

  refreshDataChip();

  sendEl.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', (e)=>{
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  inputEl.addEventListener('input', ()=>{
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
  });

  clearEl.addEventListener('click', ()=>{
    chatEl.innerHTML = '';
    localStorage.removeItem(CHAT_KEY);
    renderMessage('assistant', 'Cleared. How can I help?');
  });

  shareEl.addEventListener('change', refreshDataChip);
});
