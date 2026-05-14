-- COPETIN - Esquema PostgreSQL (base empresarial)
-- Fecha: 2026-04-17

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_closed_order_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.estado = 'cerrada' THEN
    RAISE EXCEPTION 'Las ordenes cerradas no se pueden modificar';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_stock_movement_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Los movimientos de stock son inmutables';
END;
$$ LANGUAGE plpgsql;

CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL UNIQUE,
  descripcion TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  rol_id UUID NOT NULL REFERENCES roles(id),
  telefono TEXT,
  estado TEXT NOT NULL DEFAULT 'activo',
  ultimo_acceso TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_cliente TEXT NOT NULL CHECK (tipo_cliente IN ('persona', 'empresa')),
  nombre_completo TEXT NOT NULL,
  razon_social TEXT,
  nit_ci TEXT,
  telefono TEXT NOT NULL,
  whatsapp TEXT,
  email TEXT,
  direccion TEXT,
  ciudad TEXT,
  observaciones TEXT,
  estado TEXT NOT NULL DEFAULT 'activo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE TRIGGER trg_clients_updated_at BEFORE UPDATE ON clients
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE client_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id),
  etiqueta TEXT,
  direccion TEXT NOT NULL,
  ciudad TEXT NOT NULL,
  referencia TEXT,
  predeterminada BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE TRIGGER trg_client_addresses_updated_at BEFORE UPDATE ON client_addresses
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL UNIQUE,
  descripcion TEXT,
  color TEXT,
  icono TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE TRIGGER trg_categories_updated_at BEFORE UPDATE ON categories
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  categoria_id UUID REFERENCES categories(id),
  descripcion TEXT,
  unidad TEXT NOT NULL DEFAULT 'unidad',
  stock_total INTEGER NOT NULL DEFAULT 0 CHECK (stock_total >= 0),
  stock_disponible INTEGER NOT NULL DEFAULT 0 CHECK (stock_disponible >= 0),
  stock_reservado INTEGER NOT NULL DEFAULT 0 CHECK (stock_reservado >= 0),
  stock_mantenimiento INTEGER NOT NULL DEFAULT 0 CHECK (stock_mantenimiento >= 0),
  stock_danado INTEGER NOT NULL DEFAULT 0 CHECK (stock_danado >= 0),
  stock_perdido INTEGER NOT NULL DEFAULT 0 CHECK (stock_perdido >= 0),
  precio_alquiler NUMERIC(12,2) NOT NULL DEFAULT 0,
  precio_reposicion NUMERIC(12,2) NOT NULL DEFAULT 0,
  imagen TEXT,
  estado TEXT NOT NULL DEFAULT 'activo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE TRIGGER trg_items_updated_at BEFORE UPDATE ON items
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE service_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT NOT NULL UNIQUE,
  client_id UUID NOT NULL REFERENCES clients(id),
  fecha_evento DATE NOT NULL,
  hora_evento TIME,
  fecha_entrega DATE,
  fecha_recojo DATE,
  direccion_evento TEXT,
  tipo_evento TEXT,
  estado TEXT NOT NULL DEFAULT 'borrador',
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  descuento NUMERIC(12,2) NOT NULL DEFAULT 0,
  garantia NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  saldo_pendiente NUMERIC(12,2) NOT NULL DEFAULT 0,
  observaciones TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE TRIGGER trg_service_orders_updated_at BEFORE UPDATE ON service_orders
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_service_orders_prevent_closed BEFORE UPDATE ON service_orders
FOR EACH ROW EXECUTE FUNCTION prevent_closed_order_changes();

CREATE TABLE service_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_order_id UUID NOT NULL REFERENCES service_orders(id),
  item_id UUID NOT NULL REFERENCES items(id),
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unitario NUMERIC(12,2) NOT NULL DEFAULT 0,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  observaciones TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE TRIGGER trg_service_order_items_updated_at BEFORE UPDATE ON service_order_items
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES items(id),
  tipo TEXT NOT NULL CHECK (
    tipo IN (
      'ingreso', 'salida', 'reserva', 'devolucion', 'dano', 'perdida',
      'mantenimiento', 'ajuste_manual'
    )
  ),
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  referencia_tipo TEXT,
  referencia_id UUID,
  observaciones TEXT,
  usuario_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_stock_movements_prevent_update
BEFORE UPDATE ON stock_movements
FOR EACH ROW EXECUTE FUNCTION prevent_stock_movement_mutation();
CREATE TRIGGER trg_stock_movements_prevent_delete
BEFORE DELETE ON stock_movements
FOR EACH ROW EXECUTE FUNCTION prevent_stock_movement_mutation();

CREATE TABLE stock_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES items(id),
  stock_anterior INTEGER NOT NULL,
  stock_nuevo INTEGER NOT NULL,
  diferencia INTEGER NOT NULL,
  motivo TEXT NOT NULL,
  observaciones TEXT,
  usuario_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  placa TEXT NOT NULL UNIQUE,
  marca TEXT,
  modelo TEXT,
  capacidad NUMERIC(12,2),
  estado TEXT NOT NULL DEFAULT 'activo',
  observaciones TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE TRIGGER trg_vehicles_updated_at BEFORE UPDATE ON vehicles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  telefono TEXT,
  licencia TEXT NOT NULL UNIQUE,
  categoria_licencia TEXT,
  estado TEXT NOT NULL DEFAULT 'activo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE TRIGGER trg_drivers_updated_at BEFORE UPDATE ON drivers
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_order_id UUID NOT NULL REFERENCES service_orders(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('entrega', 'recojo')),
  fecha_programada DATE NOT NULL,
  hora_programada TIME,
  direccion TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  vehiculo_id UUID REFERENCES vehicles(id),
  chofer_id UUID REFERENCES drivers(id),
  observaciones TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE TRIGGER trg_deliveries_updated_at BEFORE UPDATE ON deliveries
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_order_id UUID NOT NULL REFERENCES service_orders(id),
  client_id UUID NOT NULL REFERENCES clients(id),
  monto NUMERIC(12,2) NOT NULL,
  metodo TEXT,
  estado TEXT NOT NULL DEFAULT 'confirmado',
  referencia TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE penalties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_order_id UUID NOT NULL REFERENCES service_orders(id),
  client_id UUID NOT NULL REFERENCES clients(id),
  item_id UUID REFERENCES items(id),
  tipo TEXT NOT NULL,
  cantidad INTEGER NOT NULL DEFAULT 1,
  monto NUMERIC(12,2) NOT NULL DEFAULT 0,
  observaciones TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modulo TEXT NOT NULL,
  referencia_id UUID NOT NULL,
  nombre_archivo TEXT NOT NULL,
  mime_type TEXT,
  url TEXT NOT NULL,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  canal TEXT NOT NULL CHECK (canal IN ('whatsapp', 'email', 'sistema')),
  titulo TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  referencia_tipo TEXT,
  referencia_id UUID,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  modulo TEXT NOT NULL,
  accion TEXT NOT NULL,
  referencia_id UUID,
  datos_anteriores JSONB,
  datos_nuevos JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clave TEXT NOT NULL UNIQUE,
  valor JSONB NOT NULL,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE company_info (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  logo_url TEXT,
  direccion TEXT,
  telefono TEXT,
  moneda TEXT NOT NULL DEFAULT 'BOB',
  zona_horaria TEXT NOT NULL DEFAULT 'America/La_Paz',
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE status_catalogs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modulo TEXT NOT NULL,
  codigo TEXT NOT NULL,
  nombre TEXT NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (modulo, codigo)
);

CREATE TABLE event_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE item_conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  aplica_penalidad BOOLEAN NOT NULL DEFAULT FALSE,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);

-- Indices de rendimiento
CREATE INDEX idx_service_orders_client_id ON service_orders(client_id);
CREATE INDEX idx_service_orders_estado ON service_orders(estado);
CREATE INDEX idx_service_orders_fecha_evento ON service_orders(fecha_evento);
CREATE INDEX idx_service_order_items_order ON service_order_items(service_order_id);
CREATE INDEX idx_stock_movements_item ON stock_movements(item_id);
CREATE INDEX idx_deliveries_order ON deliveries(service_order_id);
CREATE INDEX idx_deliveries_schedule ON deliveries(fecha_programada, hora_programada);
CREATE INDEX idx_payments_order ON payments(service_order_id);
CREATE INDEX idx_penalties_order ON penalties(service_order_id);
CREATE INDEX idx_audit_logs_modulo ON audit_logs(modulo, created_at DESC);
