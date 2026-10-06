export const planSections = {
  activities: { label: 'Actividades', fields: [['category', 'Categoría'], ['activity', 'Actividad'], ['responsible', 'Responsable'], ['specifications', 'Especificaciones'], ['notes', 'Observaciones'], ['status', 'Estado', ['Pendiente', 'En proceso', 'Realizado']]] },
  review: { label: 'Revisión de proveedores', fields: [['category', 'Categoría'], ['item', 'Servicio / requisito'], ['activity', 'Actividad'], ['notes', 'Observaciones']] },
  confirmations: { label: 'Especificaciones', fields: [['category', 'Categoría'], ['item', 'Ítem'], ['detail', 'Detalle / enlace de canción']] },
  protocol: { label: 'Protocolo', fields: [['time', 'Hora'], ['activity', 'Momento / actividad'], ['participants', 'Participantes'], ['music', 'Música / enlace'], ['responsible', 'Responsable'], ['notes', 'Observaciones']] },
  guests: { label: 'Invitados', fields: [['name', 'Nombre completo'], ['group', 'Grupo familiar'], ['side', 'Lista / grupo'], ['relation', 'Relación'], ['phone', 'Teléfono'], ['status', 'Confirmación', ['Por confirmar', 'Sí', 'No']], ['companion', 'Acompañante', ['No', 'Sí']], ['people', 'Personas', 'number'], ['children', 'Niños', 'number'], ['invitation', 'Invitación', ['Digital', 'Física']], ['table', 'Mesa asignada'], ['notes', 'Notas']] },
  suppliers: { label: 'Proveedores', fields: [['service', 'Servicio'], ['name', 'Proveedor'], ['time', 'Horario'], ['members', 'Integrantes', 'number'], ['phone', 'Contacto'], ['status', 'Confirmación', ['Por confirmar', 'Confirmado']], ['notes', 'Observaciones']] },
};
export const shapeTypes = {
  round: { label: 'Mesa redonda', width: 90, height: 90, seats: 8 },
  rectangle: { label: 'Mesa rectangular', width: 140, height: 70, seats: 8 },
  square: { label: 'Mesa cuadrada', width: 85, height: 85, seats: 4 },
  cocktail: { label: 'Mesa alta', width: 50, height: 50, seats: 2 },
  chair: { label: 'Silla', width: 24, height: 26, seats: 1 },
  main: { label: 'Mesa principal', width: 180, height: 60, seats: 6 },
  stage: { label: 'Escenario', width: 200, height: 100, seats: 0 },
  dance: { label: 'Pista de baile', width: 220, height: 180, seats: 0 },
  bar: { label: 'Barra', width: 150, height: 50, seats: 0 },
  sweets: { label: 'Mesa dulce', width: 120, height: 60, seats: 0 },
  entrance: { label: 'Entrada', width: 90, height: 30, seats: 0 },
};
export const emptyPlan = () => ({ ...Object.fromEntries(Object.keys(planSections).map((key) => [key, []])), notes: '', layout: { width: 1000, height: 700, objects: [] } });
export const starterPlan = () => ({ ...emptyPlan(), activities: [
  ['Planificación general', 'Definir la lista de invitados'], ['Decoración', 'Elegir paleta de colores y montaje'],
  ['Catering', 'Confirmar menú y bebidas'], ['Música', 'Definir canciones y repertorio'], ['Protocolo', 'Confirmar horarios y responsables'],
].map(([category, activity], index) => ({ id: `initial-${index}`, category, activity, responsible: '', specifications: '', notes: '', status: 'Pendiente' })),
  confirmations: [
    ['Catering', 'Menú: carnes, guarniciones y ensalada'], ['Bebidas', 'Bebidas seleccionadas'],
    ['Decoración', 'Paleta de colores y mantelería'], ['Música', 'Canción de ingreso'],
    ['Música', 'Canción del primer baile'], ['Música', 'Lista de música bailable'],
    ['Protocolo', 'Participantes del brindis'],
  ].map(([category, item], index) => ({ id: `confirmation-${index}`, category, item, detail: '' })),
  suppliers: ['Fotografía y video', 'Música', 'Decoración', 'Mesa dulce'].map((service, index) => ({ id: `supplier-${index}`, service, name: '', time: '', members: 0, phone: '', status: 'Por confirmar', notes: '' })),
});
