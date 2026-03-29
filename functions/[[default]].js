const CONFIG = {
  // 默认反代目标
  defaultTarget: 'https://999020.xyz',

  // xhttp 目标，不填就走 defaultTarget
  xhttpTarget: '',

  // 是否去掉 /xhttp 前缀
  stripXhttpPrefix: false,

  // 是否开启 CORS
  enableCors: true,

  // 是否替换文本内容里的源站域名
  rewriteText: true,
};

export async function onRequest({ request }) {
  const incomingUrl = new URL(request.url);

  // 预检
  if (request.method === 'OPTIONS') {
    return handleOptions(request);
  }

  // Pages 不适合真正 Upgrade
  if (request.headers.get('upgrade')) {
    return new Response('HTTP Upgrade is not supported in EdgeOne Pages proxy.', {
      status: 501,
      headers: textHeaders(),
    });
  }

  const route = getRoute(incomingUrl.pathname);
  const targetOrigin = new URL(route.target);

  const targetUrl = new URL(incomingUrl.toString());
  targetUrl.protocol = targetOrigin.protocol;
  targetUrl.host = targetOrigin.host;

  if (route.stripPrefix) {
    const p = incomingUrl.pathname.replace(/^\/xhttp/, '') || '/';
    targetUrl.pathname = p.startsWith('/') ? p : '/' + p;
  }

  const reqHeaders = new Headers(request.headers);

  // 清理容易冲突的头
  reqHeaders.delete('host');
  reqHeaders.delete('connection');
  reqHeaders.delete('content-length');

  reqHeaders.set('x-forwarded-host', incomingUrl.host);
  reqHeaders.set('x-forwarded-proto', incomingUrl.protocol.replace(':', ''));

  // 如果有 origin / referer，尽量改成目标站
  const origin = reqHeaders.get('origin');
  if (origin) reqHeaders.set('origin', targetOrigin.origin);

  const referer = reqHeaders.get('referer');
  if (referer) {
    try {
      const ref = new URL(referer);
      ref.protocol = targetOrigin.protocol;
      ref.host = targetOrigin.host;
      reqHeaders.set('referer', ref.toString());
    } catch (_) {}
  }

  const init = {
    method: request.method,
    headers: reqHeaders,
    redirect: 'manual',
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
  }

  let upstream;
  try {
    upstream = await fetch(targetUrl.toString(), init);
  } catch (err) {
    return new Response(`Upstream fetch failed: ${String(err)}`, {
      status: 502,
      headers: textHeaders(),
    });
  }

  const respHeaders = new Headers(upstream.headers);
  respHeaders.set('x-proxy-by', 'edgeone-pages');

  if (CONFIG.enableCors) {
    respHeaders.set('access-control-allow-origin', '*');
    respHeaders.set('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    respHeaders.set('access-control-allow-headers', '*');
  }

  // 重写 3xx Location
  rewriteLocation(respHeaders, incomingUrl, targetOrigin);

  const contentType = respHeaders.get('content-type') || '';

  // 默认站点才做文本替换
  if (CONFIG.rewriteText && route.name === 'default' && isTextContent(contentType)) {
    let text = await upstream.text();

    const proxyOrigin = `${incomingUrl.protocol}//${incomingUrl.host}`;
    text = text
      .replaceAll(targetOrigin.origin, proxyOrigin)
      .replaceAll(`//${targetOrigin.host}`, `//${incomingUrl.host}`)
      .replaceAll(targetOrigin.host, incomingUrl.host);

    respHeaders.delete('content-length');

    return new Response(text, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

function getRoute(pathname) {
  if (pathname.startsWith('/xhttp')) {
    return {
      name: 'xhttp',
      target: CONFIG.xhttpTarget || CONFIG.defaultTarget,
      stripPrefix: CONFIG.stripXhttpPrefix,
    };
  }

  return {
    name: 'default',
    target: CONFIG.defaultTarget,
    stripPrefix: false,
  };
}

function rewriteLocation(headers, incomingUrl, targetOrigin) {
  const location = headers.get('location');
  if (!location) return;

  try {
    const loc = new URL(location, targetOrigin.origin);
    if (loc.host === targetOrigin.host) {
      loc.protocol = incomingUrl.protocol;
      loc.host = incomingUrl.host;
      headers.set('location', loc.toString());
    }
  } catch (_) {}
}

function isTextContent(contentType) {
  return (
    contentType.includes('text/html') ||
    contentType.includes('text/css') ||
    contentType.includes('text/javascript') ||
    contentType.includes('application/javascript') ||
    contentType.includes('application/json')
  );
}

function handleOptions(request) {
  const headers = new Headers();

  if (CONFIG.enableCors) {
    headers.set('access-control-allow-origin', '*');
    headers.set('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    headers.set(
      'access-control-allow-headers',
      request.headers.get('access-control-request-headers') || '*'
    );
    headers.set('access-control-max-age', '86400');
  }

  return new Response(null, { status: 204, headers });
}

function textHeaders() {
  return new Headers({
    'content-type': 'text/plain; charset=utf-8',
  });
}
