// A proxy address may carry a login: socks5://user:password@host:1080. The password is kept in the system's credential
// store; the settings file holds the address without it.

// scheme (optional) + user:password + @ + host[:port]. The login runs up to the LAST "@", the way URLs are read.
const WITH_LOGIN = /^((?:[a-z][a-z0-9+.-]*:\/\/)?)([^/\s]*)@([^@/\s]*)(.*)$/i;

/** `socks5://me:secret@host:1080` → the address without its password (`socks5://me@host:1080`) and the password. */
export function splitProxyPassword(proxy: string): { address: string; password: string | null } {
  const text = proxy.trim();
  const m = WITH_LOGIN.exec(text);
  if (!m) return { address: text, password: null };
  const [, scheme, login, host, rest] = m;
  const colon = login.indexOf(":");
  if (colon < 0 || colon === login.length - 1) return { address: text, password: null };
  return { address: `${scheme}${login.slice(0, colon)}@${host}${rest}`, password: login.slice(colon + 1) };
}

/** The reverse: puts a password back into an address that names a user. An address without a user is left alone. */
export function joinProxyPassword(address: string, password: string): string {
  const text = address.trim();
  const m = WITH_LOGIN.exec(text);
  if (!m || password === "") return text;
  const [, scheme, login, host, rest] = m;
  if (login === "" || login.includes(":")) return text;
  return `${scheme}${login}:${password}@${host}${rest}`;
}

/** The same address with the password hidden, for showing on screen. */
export const maskProxyPassword = (proxy: string): string => {
  const { address, password } = splitProxyPassword(proxy);
  return password === null ? address : address.replace("@", ":***@");
};
