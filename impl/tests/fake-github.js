'use strict';
/* An in-memory stand-in for the part of the GitHub REST API that ghstore.js uses
 * (repository, git trees, git blobs, contents GET/PUT with sha checks and a bearer token).
 * Shared by the unit tests (as a fetch replacement) and by mock-server.js (over HTTP).
 */
const crypto = require('crypto');

function createFakeGitHub(opts) {
  const o = Object.assign({ owner: 'someone', repo: 'data', token: 'test-token', branch: 'main', empty: false }, opts);
  const files = new Map();      // path → { text, sha }
  const log = [];               // commit messages
  const blobSha = (text) => crypto.createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex');
  const put = (path, text, message) => { const sha = blobSha(text); files.set(path, { text, sha }); log.push(message || `update ${path}`); return sha; };
  if (!o.empty) put('README.md', '# data\n', 'Initial commit');
  const b64 = (text) => Buffer.from(text, 'utf8').toString('base64').replace(/(.{60})/g, '$1\n');   // GitHub wraps lines
  const api = { files, log, put, requests: 0, beforePut: null, down: false, token: o.token };

  /** → { status, body } */
  api.handle = (method, urlStr, headers, bodyText) => {
    api.requests++;
    const url = new URL(urlStr, 'http://fake');
    const auth = headers.Authorization || headers.authorization || '';
    if (auth !== `Bearer ${api.token}`) return { status: 401, body: { message: 'Bad credentials' } };
    const base = `/repos/${o.owner}/${o.repo}`;
    if (!url.pathname.startsWith(base)) return { status: 404, body: { message: 'Not Found' } };
    const rest = url.pathname.slice(base.length);
    if (rest === '' && method === 'GET') return { status: 200, body: { name: o.repo, private: true } };
    let m = /^\/git\/trees\/([^/]+)$/.exec(rest);
    if (m && method === 'GET') {
      if (!log.length) return { status: 409, body: { message: 'Git Repository is empty.' } };
      if (decodeURIComponent(m[1]) !== o.branch) return { status: 404, body: { message: 'Not Found' } };
      return { status: 200, body: { tree: [...files].map(([path, f]) => ({ path, type: 'blob', sha: f.sha })), truncated: false } };
    }
    m = /^\/git\/blobs\/([0-9a-f]+)$/.exec(rest);
    if (m && method === 'GET') {
      const f = [...files.values()].find((x) => x.sha === m[1]);
      return f ? { status: 200, body: { sha: f.sha, encoding: 'base64', content: b64(f.text) } } : { status: 404, body: { message: 'Not Found' } };
    }
    m = /^\/contents\/(.+)$/.exec(rest);
    if (m) {
      const path = decodeURIComponent(m[1]);
      const cur = files.get(path);
      if (method === 'GET') {
        return cur ? { status: 200, body: { path, sha: cur.sha, encoding: 'base64', content: b64(cur.text) } } : { status: 404, body: { message: 'Not Found' } };
      }
      if (method === 'PUT') {
        if (api.beforePut) { const hook = api.beforePut; api.beforePut = null; hook(path); }   // e.g. another device writes first
        const now = files.get(path);
        const body = JSON.parse(bodyText || '{}');
        if (now && !body.sha) return { status: 422, body: { message: '"sha" wasn\'t supplied.' } };
        if ((now && body.sha !== now.sha) || (!now && body.sha)) return { status: 409, body: { message: `${path} does not match` } };
        const sha = put(path, Buffer.from(body.content, 'base64').toString('utf8'), body.message);
        return { status: now ? 200 : 201, body: { content: { path, sha } } };
      }
    }
    return { status: 404, body: { message: 'Not Found' } };
  };

  /** fetch replacement for ghstore.js; `api.down = true` simulates no network */
  api.fetch = async (url, init) => {
    if (api.down) throw new TypeError('Failed to fetch');
    const r = api.handle((init && init.method) || 'GET', url, (init && init.headers) || {}, init && init.body);
    return { status: r.status, ok: r.status >= 200 && r.status < 300, headers: { get: () => null }, json: async () => r.body };
  };
  api.conn = { owner: o.owner, repo: o.repo, token: o.token, branch: o.branch, api: 'http://localhost:1' };
  return api;
}

module.exports = { createFakeGitHub };
