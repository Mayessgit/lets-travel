const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const soap = require('soap');
const config = require('./src/config');
const services = require('./src/services');
const { startExpiryJob } = require('./src/expiry');

const app = express();

// Le frontend React (autre origine) envoie du XML : on autorise Content-Type et SOAPAction.
// Aucun body-parser ici : node-soap lit lui-même le corps XML brut.
app.use(cors({ origin: config.corsOrigins, methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'SOAPAction'] }));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Tolérance : certains clients (ex. Thunder Client) envoient le XML sous forme de chaîne JSON ("<soapenv:...>").
// On lit le corps ici et, s'il est entouré de guillemets JSON, on le « déballe » avant de le passer à node-soap.
app.use('/soap', express.text({ type: () => true, limit: '2mb' }), (req, _res, next) => {
  if (typeof req.body === 'string' && req.body.trimStart().startsWith('"')) {
    try {
      const unwrapped = JSON.parse(req.body);
      if (typeof unwrapped === 'string') req.body = unwrapped;
    } catch { /* pas du JSON : on laisse le corps tel quel */ }
  }
  next();
});

// Le WSDL contient http://localhost:4000 ; on le remplace par PUBLIC_URL (utile au déploiement).
const wsdl = fs.readFileSync(path.join(__dirname, 'src/wsdl/booking.wsdl'), 'utf8')
  .replace(/http:\/\/localhost:4000/g, config.publicUrl);

// Un point d'accès par service ; node-soap choisit le bon service d'après le chemin (soap:address du WSDL).
for (const [route, implementation] of Object.entries(services)) {
  soap.listen(app, `/soap/${route}`, implementation, wsdl);
}

if (require.main === module) {
  const server = app.listen(config.port, () => {
    console.log(`Service SOAP démarré sur ${config.publicUrl}`);
    for (const route of Object.keys(services)) console.log(`  WSDL : ${config.publicUrl}/soap/${route}?wsdl`);
    startExpiryJob();
    console.log(`  Expiration des réservations impayées : ${config.reservationTtlMinutes} min`);
  });
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Le port ${config.port} est déjà utilisé. Arrêtez le serveur existant ou choisissez un autre port avec la variable PORT.`);
      process.exitCode = 1;
      return;
    }
    console.error('Erreur au démarrage du serveur :', error);
    process.exitCode = 1;
  });
}

module.exports = app;
