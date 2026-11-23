// Convertit les lignes SQL (snake_case) en objets SOAP (camelCase).
// L'ordre des clés suit celui du WSDL ; les valeurs nulles sont omises.

const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));

const toUser = (r) => compact({
  id: r.id, name: r.name, email: r.email, phone: r.phone, avatar: r.avatar, role: r.role, createdAt: r.created_at,
});

const toService = (r) => {
  // review_count = 0 : aucun avis, on omet les deux champs (facultatifs dans le WSDL).
  const count = Number(r.review_count) || undefined;
  return compact({
    id: r.id, name: r.name, type: r.type, description: r.description, location: r.location, imageUrl: r.image_url,
    price: Number(r.price), createdAt: r.created_at,
    averageRating: count ? Math.round(Number(r.avg_rating) * 100) / 100 : undefined,
    reviewCount: count,
  });
};

const toAvailability = (r) => compact({
  id: r.id, serviceId: r.service_id, date: r.date, totalSlots: r.total_slots, availableSlots: r.available_slots,
});

const toReservation = (r) => compact({
  id: r.id, userId: r.user_id, serviceId: r.service_id, availabilityId: r.availability_id,
  quantity: r.quantity, totalPrice: Number(r.total_price), status: r.status, createdAt: r.created_at,
  serviceName: r.service_name, serviceType: r.service_type, date: r.date,
  promoCode: r.promo_code, discountAmount: r.discount_amount === null || r.discount_amount === undefined ? undefined : Number(r.discount_amount),
});

const toPayment = (r) => compact({
  id: r.id, reservationId: r.reservation_id, amount: Number(r.amount), method: r.method,
  transactionRef: r.transaction_ref, status: r.status, createdAt: r.created_at,
  serviceName: r.service_name, date: r.date,
});

const toReview = (r) => compact({
  id: r.id, userId: r.user_id, serviceId: r.service_id, rating: Number(r.rating), comment: r.comment,
  createdAt: r.created_at, updatedAt: r.updated_at, userName: r.user_name, serviceName: r.service_name,
});

const toNotification = (r) => compact({
  id: r.id, type: r.type, title: r.title, message: r.message, isRead: Boolean(r.is_read), createdAt: r.created_at,
});

const toPromo = (r) => compact({
  id: r.id, code: r.code, percent: Number(r.percent), validFrom: r.valid_from, validTo: r.valid_to,
  maxUses: r.max_uses === null || r.max_uses === undefined ? undefined : Number(r.max_uses),
  usedCount: Number(r.used_count), active: Boolean(r.active),
});

const toAuditEntry = (r) => compact({
  id: r.id, adminId: r.admin_id, adminName: r.admin_name, action: r.action, entity: r.entity,
  entityId: r.entity_id, details: r.details, createdAt: r.created_at,
});

module.exports = {
  toUser, toService, toAvailability, toReservation, toPayment,
  toReview, toNotification, toPromo, toAuditEntry,
};
