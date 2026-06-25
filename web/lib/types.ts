export type DbNotification = {
  id: number
  shipment_id: number | null
  event_type: 'ready_for_inspection' | 'reinspection_due' | 'report_received' | 'eta_overdue'
  sent_at: string
  channels: string | null  // JSON array: ["email","whatsapp","push"]
  message: string | null
}

export type Staff = {
  id: number
  name: string
  role: 'inspector' | 'editor' | 'coordinator'
  zone: string | null
  whatsapp: string | null
  email: string | null
  active: number
  clients_assigned: string | null  // JSON array string: '["Alpine","Fresh Way"]'
  created_at: string
}

export type Shipment = {
  id: number
  cliente: string
  tipo_carga: string
  location: string | null
  unit_id: string | null
  unit_id_norm: string | null
  po: string | null
  commodity: string | null
  shipper: string | null
  country_of_origin: string | null
  eta_fecha: string | null
  vessel: string | null
  bl: string | null
  fda_status: string | null
  customs_status: string | null
  agriculture_usda_status: string | null
  fumigation_status: string | null
  warehouse_arrival_confirmed: number
  warehouse_arrival_at: string | null
  pallets: number | null
  ready_for_inspection: number
  dia_disponible_para_inspeccion: string | null
  reinspection_due_date: string | null
  inspection_status: string
  report_sent: number
  report_date: string | null
  report_url: string | null
  overall_grade: string | null
  condition_text: string | null
  quality_text: string | null
  estado_general: string
  psi_file: string | null
  comments_raw: string | null
  lots_raw: string | null
  ultima_actualizacion: string
  inspector_id: number | null
  inspector?: Staff  // populated via join when needed
}
