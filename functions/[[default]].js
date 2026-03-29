addEventListener('fetch', event => {
  event.respondWith(handle(event.request));
});

const DEFAULT_TARGET = 'https://999020.xyz';

// 如果你有单独的 xhttp / httpupgrade 后端，就填这里；没有就先留空
const XHTTP_TARGET = '';
const HTTPUPGRADE_TARGET = '';

// 是否去掉前缀
const STRIP_XHTTP_PREFIX = true;
const STRIP_HTTPUPGRADE_PREFIX = true;

async function handle(request) {
  try {
    const reqUrl = new URL(request.url);

    // 健康检查，先确认函数能执行
    if (reqUrl.pathname === '/__health') {
      return new Response('ok', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      });
    }

    const route = getRoute(reqUrl.pathname);
    const targetBase = route.target || DEFAULT_TARGET;

    if (!targetBase) {
      return text('target not configured', 500);
    }

    const targetUrl = buildTargetUrl(reqUrl, targetBase, route);

    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('content-length');

    // 尽量保留 Upgrade 相关头，给 xhttp/httpupgrade 一个尝试机会
    // 非升级请求就删掉 connection，避免冲突
    if (!request.headers.get('upgrade')) {
      headers.delete('connection');
    }

    headers.set('x-forwarded-host', reqUrl.host);
    headers.set('x-forwarded-proto', reqUrl.protocol.replace(':', ''));

    const init = {
      method: request.method,
      headers: headers,
      redirect: 'manual'
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
    }

    const upstream = await fetch(targetUrl.toString(), init);

    const respHeaders = new Headers(upstream.headers);
    respHeaders.set('x-proxy-by', 'edgeone-pages');

    // 重写 3xx Location，避免跳回源站
    rewriteLocation(respHeaders, reqUrl, new URL(targetBase));

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders
    });
  } catch (e) {
    return text('proxy error:\n' + String(e && e.stack ? e.stack : e), 500);
  }
}

function getRoute(pathname) {
  if (pathname.indexOf('/xhttp') === 0) {
    return {
      target: XHTTP_TARGET || DEFAULT_TARGET,
      prefix: '/xhttp',
      stripPrefix: STRIP_XHTTP_PREFIX
    };
  }

  if (pathname.indexOf('/httpupgrade') === 0) {
    return {
      target: HTTPUPGRADE_TARGET || DEFAULT_TARGET,
      prefix: '/httpupgrade',
      stripPrefix: STRIP_HTTPUPGRADE_PREFIX
    };
  }

  return {
    target: DEFAULT_TARGET,
    prefix: '',
    stripPrefix: false
  };
}

function buildTargetUrl(reqUrl, targetBase, route) {
  const base = new URL(targetBase);
  let path = reqUrl.pathname;

  if (route.stripPrefix && route.prefix && path.indexOf(route.prefix) === 0) {
    path = path.slice(route.prefix.length) || '/';
  }

  if (path.charAt(0) !== '/') {
    path = '/' + path;
  }

  const url = new URL(base.toString());
  url.pathname = joinPath(base.pathname, path);
  url.search = reqUrl.search;
  return url;
}

function joinPath(a, b) {
  const left = (a || '').endsWith('/') ? (a || '').slice(0, -1) : (a || '');
  const right = b.charAt(0) === '/' ? b : '/' + b;
  return (left + right) || '/';
}

function rewriteLocation(headers, reqUrl, targetBaseUrl) {
  const location = headers.get('location');
  if (!location) return;

  try {
    const loc = new URL(location, targetBaseUrl.origin);
    if (loc.host === targetBaseUrl.host) {
      loc.protocol = reqUrl.protocol;
      loc.host = reqUrl.host;
      headers.set('location', loc.toString());
    }
  } catch (_) {}
}

function text(body, status) {
  return new Response(body, {
    status: status || 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8'
    }
  });
}
