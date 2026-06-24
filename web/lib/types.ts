export type Shipment = {
  id: number
  cliente: string
  tipo_carga: string
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
  inspection_status: string
  report_sent: number
  report_date: string | null
  report_url: string | null
  overall_grade: string | null
  estado_general: string
  psi_file: string | null
  comments_raw: string | null
  ultima_actualizacion: string
}
