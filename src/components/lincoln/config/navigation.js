export const lincolnSidebarItems = [
  { id: 'panel', label: 'Panel', icon: 'home' },
  { id: 'agenda', label: 'Agenda', icon: 'calendar' },
  { id: 'comercial', label: 'Reservas y Contratos', icon: 'bookmark' },
  { id: 'reuniones', label: 'Reuniones', icon: 'calendar' },
  { id: 'clientes', label: 'Clientes', icon: 'users' },
  { id: 'salones', label: 'Salones', icon: 'home' },
  { id: 'paquetes', label: 'Paquetes', icon: 'star' },
  { id: 'caja', label: 'Caja Lincoln', icon: 'wallet' },
  { id: 'rendiciones', label: 'Rendiciones', icon: 'chart' },
  { id: 'reportes', label: 'Reportes', icon: 'chart' },
  { id: 'asistencia', label: 'Asistencia compartida', icon: 'users' },
];

export const lincolnEnabledViews = new Set(lincolnSidebarItems.filter((item) => !item.disabled).map((item) => item.id));
export const lincolnMobilePrimaryIds = new Set(['panel', 'agenda', 'comercial', 'caja', 'asistencia']);
