export function sendJson(res, statusCode, payload) {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(statusCode).json(payload);
  }

  if (typeof res.statusCode === 'number') {
    res.statusCode = statusCode;
  } else {
    res.statusCode = statusCode;
  }

  if (payload === undefined) {
    if (typeof res.end === 'function') {
      res.end();
    }
    return res;
  }

  const body = JSON.stringify(payload);
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Length', Buffer.byteLength(body));
  }

  if (typeof res.end === 'function') {
    res.end(body);
  }

  return res;
}

export function methodNotAllowed(res, allowed) {
  if (typeof res.setHeader === 'function' && allowed) {
    res.setHeader('Allow', Array.isArray(allowed) ? allowed.join(', ') : String(allowed));
  }
  return sendJson(res, 405, { error: 'Method Not Allowed' });
}
