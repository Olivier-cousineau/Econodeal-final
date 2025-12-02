export async function readJsonBody(req) {
  if (!req) {
    return {};
  }

  const existing = req.body;
  if (existing !== undefined) {
    if (typeof existing === 'string') {
      try {
        return JSON.parse(existing);
      } catch (error) {
        return {};
      }
    }
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer?.(existing)) {
      try {
        return JSON.parse(existing.toString('utf8'));
      } catch (error) {
        return {};
      }
    }
    if (typeof existing === 'object' && existing !== null) {
      return existing;
    }
  }

  const chunks = [];
  return new Promise((resolve, reject) => {
    req
      .on('data', (chunk) => {
        chunks.push(chunk);
      })
      .on('end', () => {
        if (!chunks.length) {
          return resolve({});
        }
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve(raw ? JSON.parse(raw) : {});
        } catch (error) {
          resolve({});
        }
      })
      .on('error', (error) => {
        reject(error);
      });
  });
}
