// Associe chaque opération du WSDL à son implémentation.
// Structure attendue par node-soap : { NomService: { NomPort: { operation: fonction } } }
const { handler } = require('../errors');

const wrapAll = (impl) => Object.fromEntries(Object.entries(impl).map(([name, fn]) => [name, handler(fn)]));

module.exports = {
  user:         { UserService:         { UserPort:         wrapAll(require('./userService')) } },
  availability: { AvailabilityService: { AvailabilityPort: wrapAll(require('./availabilityService')) } },
  booking:      { BookingService:      { BookingPort:      wrapAll(require('./bookingService')) } },
  payment:      { PaymentService:      { PaymentPort:      wrapAll(require('./paymentService')) } },
  engagement:   { EngagementService:   { EngagementPort:   wrapAll(require('./engagementService')) } },
  admin:        { AdminService:        { AdminPort:        wrapAll(require('./adminService')) } },
};
