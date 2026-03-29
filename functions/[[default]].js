const CONFIG = {
  // 默认反代目标
  defaultTarget: 'https://999020.xyz',

  // xhttp 后端，留空就走 defaultTarget
  xhttpTarget: '',

  // httpupgrade 后端，留空就走 defaultTarget
  httpUpgradeTarget: '',

  // 是否去掉前缀
  stripXhttpPrefix: false,
  stripHttpUpgradePrefix: false,
};

export async function onRequest(context) {
  const request = context.request;

  try {
    const reqUrl = new URL(request.url);

    // 调试用：先访问 /__health 看函数是否正常
    if (reqUrl.pathname === '/__health') {
      return json({
        ok: true,
        pathname: reqUrl.pathname,
        method: request.method,
        upgrade: request.headers.get('upgrade') || '',
      });
    }

    const route = pickRoute(reqUrl.pathname);
    const target = route.target || CONFIG.defaultTarget;

    if (!target) {
      return text('target not configured', 500);
    }

    const upstreamUrl = buildUpstreamUrl(reqUrl, target, route);

    const headers = new Headers(request.headers);

    // 清理容易冲突的头
    headers.delete('host');
    headers.delete('content-length');

    // 普通请求删掉 connection，升级请求尽量保留
    if (!request.headers.get('upgrade')) {
      headers.delete('connection');
    }

    headers.set('x-forwarded-host', reqUrl.host);
    headers.set('x-forwarded-proto', reqUrl.protocol.replace(':', ''));

    const init = {
      method: request.method,
      headers,
      redirect: 'manual',
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
    }

    // 关键：尽量直接透传，少做处理
    const upstream = await fetch(upstreamUrl.toString(), init);

    return upstream;
  } catch (err) {
    return text('proxy error\n\n' + (err && err.stack ? err.stack : String(err)), 500);
  }
}

function pickRoute(pathname) {
  if (pathname.startsWith('/xhttp')) {
    return {
      prefix: '/xhttp',
      target: CONFIG.xhttpTarget,
      stripPrefix: CONFIG.stripXhttpPrefix,
    };
  }

  if (pathname.startsWith('/httpupgrade')) {
    return {
      prefix: '/httpupgrade',
      target: CONFIG.httpUpgradeTarget,
      stripPrefix: CONFIG.stripHttpUpgradePrefix,
    };
  }

  return {
    prefix: '',
    target: CONFIG.defaultTarget,
    stripPrefix: false,
  };
}

function buildUpstreamUrl(reqUrl, target, route) {
  const base = new URL(target);
  let path = reqUrl.pathname;

  if (route.stripPrefix && route.prefix && path.startsWith(route.prefix)) {
    path = path.slice(route.prefix.length) || '/';
  }

  if (!path.startsWith('/')) {
    path = '/' + path;
  }

  const url = new URL(base.toString());
  url.pathname = joinPath(base.pathname, path);
  url.search = reqUrl.search;

  return url;
}

function joinPath(a, b) {
  const left = (a || '').endsWith('/') ? (a || '').slice(0, -1) : (a || '');
  const right = b.startsWith('/') ? b : '/' + b;
  return (left + right) || '/';
}

function text(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
    },
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  });
}
