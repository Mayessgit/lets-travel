// Les erreurs métier sont renvoyées au client sous forme de SOAP Fault.
// detail.code est un code stable exploitable par le frontend (ex: NOT_ENOUGH_SLOTS).

// statusCode 500 : un SOAP Fault est renvoyé avec le statut HTTP 500 (SOAP 1.1), donc res.ok === false côté fetch.
const fault = (code, message, faultcode = 'Client') => ({
  Fault: { faultcode, faultstring: message, detail: { code }, statusCode: 500 },
});

function toFault(err) {
  if (err && err.Fault) return err;
  if (err && err.code === 'ER_DUP_ENTRY') return fault('DUPLICATE', 'Cette valeur existe déjà.');
  if (err && (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED')) {
    return fault('IN_USE', 'Opération impossible : des réservations sont liées à cet élément.');
  }
  console.error('[erreur interne]', err);
  return fault('INTERNAL_ERROR', 'Erreur interne du serveur.', 'Server');
}

/** Enveloppe un handler : arguments nettoyés, erreurs converties en SOAP Fault. */
const handler = (fn) => async (args, _callback, headers) => {
  try {
    return await fn(args || {}, headers || {});
  } catch (err) {
    throw toFault(err);
  }
};

module.exports = { fault, toFault, handler };
