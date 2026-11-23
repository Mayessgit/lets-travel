// Client SOAP minimal : construit l'enveloppe XML, l'envoie avec fetch, lit la réponse.
const NS = 'http://booking.example.com/soap';
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// { a: 1, b: 'x' } -> <tns:a>1</tns:a><tns:b>x</tns:b> (les valeurs vides sont ignorées)
const argsToXml = (args) =>
  Object.entries(args || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `<tns:${k}>${esc(v)}</tns:${k}>`)
    .join('');

// Élément XML -> objet JS ; une balise répétée devient un tableau.
function toObj(el) {
  const kids = [...el.children];
  if (kids.length === 0) return el.textContent;
  const out = {};
  for (const k of kids) {
    const v = toObj(k);
    out[k.localName] = k.localName in out ? [].concat(out[k.localName], [v]) : v;
  }
  return out;
}

/** Une liste à 0 ou 1 élément n'est pas un tableau en XML : ce helper garantit un tableau. */
export const list = (x) => (Array.isArray(x) ? x : x ? [x] : []);

/** soap('booking', 'createReservation', { availabilityId: 1, quantity: 2 }, token) */
export async function soap(service, operation, args = {}, token) {
  const header = token ? `<soapenv:Header><tns:AuthToken>${esc(token)}</tns:AuthToken></soapenv:Header>` : '';
  const body =
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="${NS}">` +
    `${header}<soapenv:Body><tns:${operation}>${argsToXml(args)}</tns:${operation}></soapenv:Body></soapenv:Envelope>`;

  let res;
  try {
    res = await fetch(`${BASE}/soap/${service}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `${NS}/${operation}` },
      body,
    });
  } catch {
    throw Object.assign(new Error('Serveur injoignable. Le backend est-il démarré ?'), { code: 'NETWORK' });
  }

  const doc = new DOMParser().parseFromString(await res.text(), 'text/xml');
  const fault = doc.getElementsByTagNameNS('*', 'Fault')[0];
  if (fault) {
    const message = fault.getElementsByTagName('faultstring')[0]?.textContent || 'Erreur inconnue';
    const code = fault.getElementsByTagName('code')[0]?.textContent;
    throw Object.assign(new Error(message), { code });
  }
  const response = doc.getElementsByTagNameNS('*', 'Body')[0]?.firstElementChild;
  const result = response ? toObj(response) : {};
  return typeof result === 'string' ? {} : result; // réponse vide
}
