/* Gifty Worker. Firestore over REST.
 *
 * No SDK and no service account key. The Worker signs in as an ordinary email
 * and password user whose only power, granted by the security rules, is to
 * create an order and read one back. If this identity ever leaked it could not
 * read the catalogue's secrets, because there are none, and it could not touch
 * a delivered order's money.
 */

export function encode(v, path = '$') {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) {
    return {
      arrayValue: {
        values: v.map((item, i) => {
          if (Array.isArray(item)) {
            throw new Error(`${path}[${i}] is an array inside an array`);
          }
          return encode(item, `${path}[${i}]`);
        })
      }
    };
  }
  return { mapValue: { fields: fieldsOf(v, path) } };
}

export function fieldsOf(obj, path = '$') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = encode(v, `${path}.${k}`);
  return out;
}

export function decode(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(decode);
  if ('mapValue' in v) return decodeFields((v.mapValue && v.mapValue.fields) || {});
  return null;
}

export function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = decode(v);
  return out;
}

export function decodeDoc(doc) {
  if (!doc || !doc.name) return null;
  const out = decodeFields(doc.fields);
  out.id = doc.name.slice(doc.name.lastIndexOf('/') + 1);
  return out;
}

/* Firestore cannot nest an array, so a quad is stored as four {x,y} maps. The
   Worker only prices, it never draws, but it reads the same documents the
   renderer does and normalising here keeps the two views of a product equal. */
export function normalize(recipe) {
  for (const z of recipe.printZones || []) {
    const q = z.warp && z.warp.quad;
    if (Array.isArray(q) && q.length && !Array.isArray(q[0])) {
      z.warp.quad = q.map((p) => [p.x, p.y]);
    }
  }
  return recipe;
}

export class Firestore {
  constructor(env) {
    this.projectId = env.FIREBASE_PROJECT_ID;
    this.apiKey = env.FIREBASE_API_KEY;
    this.email = env.SERVER_EMAIL;
    this.password = env.SERVER_PASSWORD;
    this.base = env.FIRESTORE_BASE ||
      `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents`;
    this.authBase = env.IDENTITY_BASE || 'https://identitytoolkit.googleapis.com/v1';
    this.token = null;
  }

  /* Public reads need no identity, which keeps the catalogue fetch off the
     sign in path entirely. */
  async read(path) {
    const url = `${this.base}/${path}${this.apiKey ? `?key=${this.apiKey}` : ''}`;
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`read ${path} -> ${res.status}`);
    return decodeDoc(await res.json());
  }

  async signIn() {
    if (this.token) return this.token;
    if (this.staticToken) return (this.token = this.staticToken);
    const res = await fetch(`${this.authBase}/accounts:signInWithPassword?key=${this.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: this.email, password: this.password, returnSecureToken: true })
    });
    const body = await res.json();
    if (!res.ok) throw new Error('server sign in failed: ' + (body.error && body.error.message));
    this.token = body.idToken;
    return this.token;
  }

  async authedRead(path) {
    const token = await this.signIn();
    const res = await fetch(`${this.base}/${path}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`read ${path} -> ${res.status}`);
    return decodeDoc(await res.json());
  }

  /* A true create, not an upsert.
   *
   *   currentDocument.exists = false   makes a duplicate order number a 409
   *                                    instead of silently overwriting an order
   *   updateTransforms REQUEST_TIME    is the only way createdAt can equal
   *                                    request.time, which the rule insists on,
   *                                    because the Worker cannot know the
   *                                    server's clock before it writes
   */
  async createOrder(orderNumber, data) {
    const token = await this.signIn();
    const body = {
      writes: [{
        update: {
          name: `projects/${this.projectId}/databases/(default)/documents/orders/${orderNumber}`,
          fields: fieldsOf(data)
        },
        updateMask: { fieldPaths: Object.keys(data) },
        updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
        currentDocument: { exists: false }
      }]
    };
    const url = this.base.replace(/\/documents$/, '/documents:commit');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error((out.error && out.error.message) || `commit -> ${res.status}`);
      err.status = res.status;
      err.firestore = (out.error && out.error.status) || '';
      throw err;
    }
    return out;
  }
}
