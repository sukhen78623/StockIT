// StockIt API Worker (Phase 1)
// - Loads NSE end-of-day bhavcopy into Neon
// - Read API: /api/status, /api/search, /api/prices
// Secrets needed (Worker > Settings > Variables and Secrets):
//   DATABASE_URL  (Neon connection string)
//   ADMIN_KEY     (any long random text, protects /api/load)

const NSE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'text/csv,*/*',
  Referer: 'https://www.nseindia.com/',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// ---------- Database (Neon HTTP SQL, no npm needed) ----------
async function sql(env, query, params = []) {
  const dbUrl = String(env.DATABASE_URL || '').trim();
  const m = dbUrl.match(/@([^\/:?]+)/);
  if (!m) throw new Error('DATABASE_URL secret missing or wrong (length ' + dbUrl.length + ')');
  const host = m[1];
  const res = await fetch(`https://${host}/sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Neon-Connection-String': dbUrl,
    },
    body: JSON.stringify({ query, params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || 'Database error ' + res.status);
  return body;
}

// ---------- Date helpers ----------
function istToday() {
  return new Date(Date.now() + 19800000).toISOString().slice(0, 10);
}
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function isWeekend(iso) {
  const w = new Date(iso + 'T00:00:00Z').getUTCDay();
  return w === 0 || w === 6;
}
function ddmmyyyy(iso) {
  const [y, m, d] = iso.split('-');
  return d + m + y;
}

// ---------- SQL that parses the CSV inside the database (keeps Worker CPU tiny) ----------
const num = (i) => `nullif(nullif(trim(f[${i}]),'-'),'')::numeric`;
const SPLIT_LINES = `regexp_split_to_table($1::text, '\\r?\\n')`;

const INSTRUMENTS_SQL = `
with raw as (
  select regexp_split_to_array(line, ',') as f
  from ${SPLIT_LINES} as line
  where line <> '' and line !~* '^\\s*SYMBOL'
)
insert into instruments (exchange, symbol, series)
select distinct on (trim(f[1])) 'NSE', trim(f[1]), trim(f[2])
from raw
where trim(f[2]) in ('EQ','BE')
order by trim(f[1])
on conflict (exchange, symbol) do nothing`;

const PRICES_SQL = `
with raw as (
  select regexp_split_to_array(line, ',') as f
  from ${SPLIT_LINES} as line
  where line <> '' and line !~* '^\\s*SYMBOL'
),
p as (
  select trim(f[1]) as sym,
         to_date(trim(f[3]), 'DD-Mon-YYYY') as d,
         ${num(4)} as prev,
         ${num(5)} as o,
         ${num(6)} as h,
         ${num(7)} as l,
         ${num(9)} as c,
         (${num(11)})::bigint as vol,
         ${num(12)} * 100000 as turn
  from raw
  where trim(f[2]) in ('EQ','BE')
)
insert into price_daily
  (instrument_id, trade_date, open, high, low, close, prev_close, volume, turnover, source_id, data_status, retrieved_at)
select distinct on (i.id, p.d)
  i.id, p.d, p.o, p.h, p.l, p.c, p.prev, p.vol, p.turn,
  (select id from data_sources where name = 'NSE Bhavcopy (EOD)'),
  'end_of_day', now()
from p
join instruments i on i.exchange = 'NSE' and i.symbol = p.sym
order by i.id, p.d
on conflict (instrument_id, trade_date) do update set
  open = excluded.open, high = excluded.high, low = excluded.low,
  close = excluded.close, prev_close = excluded.prev_close,
  volume = excluded.volume, turnover = excluded.turnover,
  retrieved_at = now()`;

const NAMES_SQL = `
with raw as (
  select regexp_split_to_array(line, ',(?=(?:[^"]*"[^"]*")*[^"]*$)') as f
  from ${SPLIT_LINES} as line
  where line <> '' and line !~* '^\\s*SYMBOL'
)
update instruments i
set name = trim(both '" ' from r.f[2]), isin = trim(r.f[7])
from raw r
where i.exchange = 'NSE' and i.symbol = trim(r.f[1])`;

// ---------- Loaders ----------
// NSE sometimes drops a request, so try up to 3 times before giving up.
async function fetchNse(url) {
  let last = null;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: NSE_HEADERS });
      if (res.status === 404) return res;
      if (res.ok) return res;
      last = new Error('NSE returned HTTP ' + res.status);
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 700 * (i + 1)));
  }
  throw last || new Error('NSE request failed');
}

async function loadDay(env, iso, force = false) {
  if (isWeekend(iso)) return { date: iso, status: 'skipped_weekend' };

  // Already in the database? Skip (makes re-running the loader fast).
  if (!force) {
    const have = await sql(
      env,
      `select count(*)::int as n from price_daily where trade_date = $1::date`,
      [iso]
    );
    if ((have.rows[0] && have.rows[0].n) >= 1000) return { date: iso, status: 'already_loaded' };
  }

  const url = `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${ddmmyyyy(iso)}.csv`;
  const res = await fetchNse(url);
  if (res.status === 404) return { date: iso, status: 'no_file (holiday, or not published yet)' };
  const csv = await res.text();
  const head = csv.slice(0, 400).toUpperCase();
  if (!head.includes('CLOSE_PRICE') || !head.includes('TURNOVER_LACS')) {
    throw new Error('NSE file format looks changed. Loader needs an update.');
  }
  await sql(env, INSTRUMENTS_SQL, [csv]);
  const r = await sql(env, PRICES_SQL, [csv]);
  const rows = r.rowCount ?? 0;
  await sql(
    env,
    `insert into data_jobs (job_name, source_id, status, rows_loaded, finished_at)
     values ('nse_eod_' || $1::text, (select id from data_sources where name = 'NSE Bhavcopy (EOD)'), 'success', $2::int, now())`,
    [iso, String(rows)]
  );
  return { date: iso, status: 'loaded', rows };
}

async function loadNames(env) {
  const res = await fetchNse('https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv');
  if (!res.ok) throw new Error(`NSE returned HTTP ${res.status} for company list`);
  const csv = await res.text();
  const r = await sql(env, NAMES_SQL, [csv]);
  return { status: 'names_updated', rows: r.rowCount ?? 0 };
}

async function logFailure(env, name, message) {
  try {
    await sql(
      env,
      `insert into data_jobs (job_name, status, message, finished_at) values ($1::text, 'failed', $2::text, now())`,
      [name, String(message).slice(0, 500)]
    );
  } catch (e) {}
}

// ---------- Admin page (/admin): one-click history loader for phone ----------
// One day per request, auto-retry, never stops on a problem day, safe to re-run.
const ADMIN_HTML = String.raw`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>StockIt Admin</title>
<style>
body{font-family:system-ui,sans-serif;background:#0b1220;color:#e6edf3;padding:16px;max-width:600px;margin:auto}
input,button{width:100%;padding:12px;margin:6px 0;font-size:16px;border-radius:8px;border:1px solid #334;background:#111a2e;color:#e6edf3;box-sizing:border-box}
button{background:#10b981;color:#04130d;font-weight:700;border:0}
pre{white-space:pre-wrap;background:#111a2e;padding:10px;border-radius:8px;font-size:13px}
#st{font-weight:700;color:#10b981;margin:8px 0}
.bar{height:10px;background:#1b2740;border-radius:6px;overflow:hidden}
#pb{height:10px;width:0;background:#10b981}
</style></head><body>
<h2>StockIt Admin</h2>
<label>Admin key</label><input id="k" type="password">
<label>From date</label><input id="f" type="date">
<label>To date</label><input id="t" type="date">
<button id="go">Load price history</button>
<button id="names" style="background:#3b82f6;color:#fff">Load company names</button>
<div id="st">Ready.</div>
<div class="bar"><div id="pb"></div></div>
<pre id="log">Screen on rakho jotokkhon load hocche. Beshi problem hole abar button tipo, agey load howa din skip hobe.</pre>
<script>
var $=function(i){return document.getElementById(i)};
function addDays(s,n){var d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
function isWeekend(s){var w=new Date(s+'T00:00:00Z').getUTCDay();return w===0||w===6}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms)})}
var now=new Date();
$('t').value=now.toISOString().slice(0,10);
$('f').value=new Date(now.getTime()-365*86400000).toISOString().slice(0,10);
try{var sk=localStorage.getItem('stockit_key');if(sk)$('k').value=sk}catch(e){}
function log(m){var l=$('log');l.textContent+='\n'+m;l.scrollTop=l.scrollHeight}
var running=false,wake=null;
async function callDay(key,d){
  var lastErr='';
  for(var a=1;a<=3;a++){
    try{
      var ctl=new AbortController();
      var tm=setTimeout(function(){ctl.abort()},60000);
      var r=await fetch('/api/load?key='+encodeURIComponent(key)+'&date='+d+'&to='+d,{signal:ctl.signal});
      clearTimeout(tm);
      var j=await r.json();
      if(j.error){return {status:'fatal',message:j.error}}
      var x=j.results[0];
      if(x.status==='error'){lastErr=x.message}else{return x}
    }catch(e){lastErr='Network: '+e.message}
    await sleep(3000*a);
  }
  return {status:'error',message:lastErr};
}
$('go').onclick=async function(){
  if(running)return; running=true;
  var key=$('k').value.trim(),cur=$('f').value,end=$('t').value;
  if(!key||!cur||!end){log('Key and both dates are needed');running=false;return}
  try{localStorage.setItem('stockit_key',key)}catch(e){}
  try{if(navigator.wakeLock)wake=await navigator.wakeLock.request('screen')}catch(e){}
  var total=0,t=cur;while(t<=end){if(!isWeekend(t))total++;t=addDays(t,1)}
  var done=0,loaded=0,already=0,skipped=0,problems=[];
  while(cur<=end){
    if(isWeekend(cur)){cur=addDays(cur,1);continue}
    var x=await callDay(key,cur);
    if(x.status==='fatal'){log('Stopped at '+cur+': '+x.message);break}
    if(x.status==='loaded')loaded++;
    else if(x.status==='already_loaded')already++;
    else if(x.status==='error'){problems.push(cur+': '+x.message);log('Problem '+cur+': '+x.message)}
    else skipped++;
    done++;
    $('st').textContent=cur+' | '+done+'/'+total+' | loaded '+loaded+', already '+already+', holiday '+skipped+', problems '+problems.length;
    $('pb').style.width=Math.round(done*100/Math.max(total,1))+'%';
    cur=addDays(cur,1);
  }
  log('Finished. Loaded '+loaded+', already there '+already+', holidays '+skipped+', problems '+problems.length+'.');
  if(problems.length){log('Problem din gulo:\n'+problems.join('\n')+'\nAbar button tipo, shudhu eigulo abar try hobe.')}
  try{if(wake)wake.release()}catch(e){}
  running=false;
};
$('names').onclick=async function(){
  var key=$('k').value.trim();
  if(!key){log('Admin key needed');return}
  try{var r=await fetch('/api/load-names?key='+encodeURIComponent(key));log(await r.text())}
  catch(e){log('Network error: '+e.message)}
};
</script></body></html>`;

// ---------- Worker ----------
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    const q = url.searchParams;
    const isAdmin = env.ADMIN_KEY && q.get('key') === env.ADMIN_KEY;

    try {
      switch (url.pathname) {
        case '/api/status': {
          const r = await sql(
            env,
            `select (select count(*) from instruments)::int as instruments,
                    (select max(trade_date)::text from price_daily) as latest_date,
                    (select count(*) from price_daily
                       where trade_date = (select max(trade_date) from price_daily))::int as rows_on_latest_date`
          );
          return json({ ok: true, ...r.rows[0] });
        }

        case '/api/search': {
          const term = (q.get('q') || '').trim();
          if (term.length < 1) return json({ results: [] });
          const r = await sql(
            env,
            `select symbol, name, isin from instruments
             where is_active and (symbol ilike $1::text || '%' or name ilike '%' || $1::text || '%')
             order by (symbol ilike $1::text || '%') desc, symbol
             limit 10`,
            [term]
          );
          return json({ results: r.rows });
        }

        case '/api/prices': {
          const symbol = (q.get('symbol') || '').trim().toUpperCase();
          const days = Math.min(parseInt(q.get('days') || '365', 10) || 365, 3650);
          if (!symbol) return json({ error: 'symbol required' }, 400);
          const r = await sql(
            env,
            `select p.trade_date::text as time, p.open::float8 as open, p.high::float8 as high,
                    p.low::float8 as low, p.close::float8 as close, p.volume::float8 as volume
             from price_daily p join instruments i on i.id = p.instrument_id
             where i.exchange = 'NSE' and i.symbol = $1::text
               and p.trade_date >= current_date - $2::int
             order by p.trade_date`,
            [symbol, String(days)]
          );
          return json({
            symbol,
            exchange: 'NSE',
            data_status: 'End of Day',
            source: 'NSE Bhavcopy',
            candles: r.rows,
          });
        }

        case '/admin':
          return new Response(ADMIN_HTML, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });

        case '/api/load': {
          if (!isAdmin) return json({ error: 'forbidden' }, 403);
          const from = q.get('date') || istToday();
          const to = q.get('to') || from;
          const results = [];
          let d = from;
          for (let i = 0; i < 5 && d <= to; i++) {
            try {
              results.push(await loadDay(env, d));
            } catch (e) {
              results.push({ date: d, status: 'error', message: String(e.message || e) });
            }
            d = addDays(d, 1);
          }
          return json({ results, note: 'max 5 days per call' });
        }

        case '/api/load-names': {
          if (!isAdmin) return json({ error: 'forbidden' }, 403);
          return json(await loadNames(env));
        }

        default:
          return new Response('StockIt API is running.', { headers: CORS });
      }
    } catch (e) {
      return json({ error: String(e.message || e) }, 500);
    }
  },

  // Daily automatic load (cron in wrangler.jsonc: 30 14 * * * = 8:00 PM IST)
  async scheduled(event, env, ctx) {
    const day = istToday();
    ctx.waitUntil(
      loadDay(env, day, true).catch((e) => logFailure(env, 'nse_eod_' + day, e.message))
    );
  },
};
