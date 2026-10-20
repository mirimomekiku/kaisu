// A minimal W3C WebDriver client (just fetch), enough to drive the real Tauri window through `tauri-driver`.
const ELEMENT = "element-6066-11e4-a52e-4f735466cecf";

export class Session {
  constructor(base, id) {
    this.base = base;
    this.id = id;
  }

  static async start(base, application) {
    const res = await fetch(`${base}/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capabilities: { alwaysMatch: { "tauri:options": { application } } } }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`Could not start a session: ${JSON.stringify(body)}`);
    return new Session(base, body.value.sessionId);
  }

  async call(method, path, payload) {
    const res = await fetch(`${this.base}/session/${this.id}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${path}: ${body?.value?.message ?? res.status}`);
    return body.value;
  }

  /** Finds the first element matching a CSS selector, or null. */
  async find(css) {
    try {
      const el = await this.call("POST", "/element", { using: "css selector", value: css });
      return el[ELEMENT];
    } catch {
      return null;
    }
  }

  async findAll(css) {
    const els = await this.call("POST", "/elements", { using: "css selector", value: css });
    return els.map((e) => e[ELEMENT]);
  }

  /** Polls until the selector matches (or the timeout passes). */
  async waitFor(css, timeout = 15000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const el = await this.find(css);
      if (el) return el;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`Timed out waiting for ${css}`);
  }

  click(el) {
    return this.call("POST", `/element/${el}/click`, {});
  }
  text(el) {
    return this.call("GET", `/element/${el}/text`);
  }
  attr(el, name) {
    return this.call("GET", `/element/${el}/attribute/${name}`);
  }
  type(el, text) {
    return this.call("POST", `/element/${el}/value`, { text });
  }
  script(js, args = []) {
    return this.call("POST", "/execute/sync", { script: js, args });
  }
  rect() {
    return this.call("GET", "/window/rect");
  }
  async screenshot() {
    return Buffer.from(await this.call("GET", "/screenshot"), "base64");
  }

  /** Presses and releases keys, e.g. press("") for F1 or press("f", { ctrl: true }). */
  async press(key, { ctrl = false, shift = false } = {}) {
    const CONTROL = "";
    const SHIFT = "";
    const actions = [];
    if (ctrl) actions.push({ type: "keyDown", value: CONTROL });
    if (shift) actions.push({ type: "keyDown", value: SHIFT });
    actions.push({ type: "keyDown", value: key }, { type: "keyUp", value: key });
    if (shift) actions.push({ type: "keyUp", value: SHIFT });
    if (ctrl) actions.push({ type: "keyUp", value: CONTROL });
    await this.call("POST", "/actions", { actions: [{ type: "key", id: "keyboard", actions }] });
    await this.call("DELETE", "/actions").catch(() => {});
  }

  async quit() {
    await fetch(`${this.base}/session/${this.id}`, { method: "DELETE" }).catch(() => {});
  }
}

export const Keys = { F1: "", ESCAPE: "", ENTER: "" };
