import { client as supabase } from './config.js';

const tbody = document.getElementById('tbody-pagos');
const fInicio = document.getElementById('fechaInicio');
const fFin = document.getElementById('fechaFin');
let todosLosPagos = [];

// --- 1. RENDERIZADO DE TABLA ---
function renderTable(datos) {
    tbody.innerHTML = '';
    if(datos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:30px;">No hay movimientos registrados.</td></tr>';
        return;
    }

    datos.forEach((p) => {
        const fechaFormateada = p.fecha_pago ? new Date(p.fecha_pago + "T00:00:00").toLocaleDateString('es-PE') : '---';
        const tr = document.createElement('tr');
        
        // Obtenemos el número de habitación y el nombre del huésped desde la relación anidada
        const numeroHabitacion = p.reservas?.habitaciones?.numero || '--';
        const nombreHuesped = p.reservas?.huespedes?.nombres_apellidos || 'S/N';
        
        tr.innerHTML = `
            <td>
                <strong>${fechaFormateada}</strong><br>
                <small style="color:#64748b;"><i class="fa-regular fa-clock"></i> ${p.hora_pago || ''}</small>
            </td>
            <td>
                <strong>${nombreHuesped}</strong>
            </td>
            <td>
                <div style="display: flex; align-items: center; gap: 5px;">
                    <i class="fa-solid fa-user-check" style="color: #64748b; font-size: 10px;"></i>
                    <span style="font-weight: 600; text-transform: capitalize;">${p.nombre_recepcionista || 'Admin'}</span>
                </div>
                <small style="color:#64748b; font-size:10px;">Turno: ${p.turno || '--'} | Hab: ${numeroHabitacion}</small>
            </td>
            <td>
                <span style="font-size:12px;"><i class="fa-solid fa-layer-group"></i> ${p.metodo_pago}</span><br>
                ${p.nro_operacion ? `<small style="color:#166534; font-size:10px;">Op: ${p.nro_operacion}</small>` : '<small style="color:#64748b; font-size:10px;">Sin Nro. Op.</small>'}
            </td>
            <td>
                <button class="btn-detalle" onclick="verDetalleAlojamiento('${p.id_reserva}')">
                    <span>S/ ${['Adelanto','Abono','Saldo','Early check-in','Late checkout'].includes(p.concepto) ? parseFloat(p.monto_soles).toFixed(2) : '0.00'}</span> 
                    <i class="fa-solid fa-magnifying-glass-dollar"></i>
                </button>
            </td>
            <td>
                <button class="btn-detalle" onclick="verDetalleExtras('${p.id_reserva}')">
                    <span>S/ ${p.concepto === 'Consumo' ? parseFloat(p.monto_soles).toFixed(2) : '0.00'}</span> 
                    <i class="fa-solid fa-receipt"></i>
                </button>
            </td>
            <td>
                <button class="btn-detalle" style="background: #fff7ed; border-color: #ffedd5; color: #9a3412;" 
                        onclick="verTicketGlobal('${p.id_reserva}')">
                    <strong style="font-size:14px;">S/ ${parseFloat(p.monto_soles).toFixed(2)}</strong><br>
                    <small style="font-size:9px; font-weight:700; text-transform:uppercase; display:block;">${p.concepto}</small>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// --- 2. CONSULTA CON RELACIONES (JOIN SELECTIONS) ---
async function consultarYEscucharPagos() {
    // Traemos de forma relacional: pagos -> reservas -> huespedes y habitaciones
    const { data, error } = await supabase
        .from('pagos')
        .select(`
            *,
            reservas (
                id,
                id_huesped,
                id_habitacion,
                huespedes ( nombres_apellidos ),
                habitaciones ( numero )
            )
        `)
        .order('fecha_pago', { ascending: false })
        .order('hora_pago', { ascending: false });

    if (!error) {
        todosLosPagos = data;
        aplicarFiltros();
    } else {
        console.error("Error cargando pagos:", error);
    }

    // Canal en tiempo real adaptado a la nueva estructura de relaciones
    supabase
        .channel('cambios-pagos')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pagos' }, async (payload) => {
            const { data: resData } = await supabase
                .from('reservas')
                .select('id, huespedes(nombres_apellidos), habitaciones(numero)')
                .eq('id', payload.new.id_reserva)
                .single();
                
            const nuevoPagoConReserva = {
                ...payload.new,
                reservas: resData
            };
            todosLosPagos.unshift(nuevoPagoConReserva);
            aplicarFiltros();
        })
        .subscribe();
}

// --- 3. APLICAR FILTROS POR FECHA ---
function aplicarFiltros() {
    const inicio = fInicio.value || null;
    const fin = fFin.value || null;
    
    const pagosFiltrados = todosLosPagos.filter(pago => {
        if (!pago.fecha_pago) return false;
        if (inicio && pago.fecha_pago < inicio) return false;
        if (fin && pago.fecha_pago > fin) return false;
        return true;
    });
    renderTable(pagosFiltrados);
}

// --- 4. DETALLE DE EXTRAS (CONSUMOS) ---
window.verDetalleExtras = async function(idReserva) {
    Swal.fire({ title: 'Cargando consumos...', didOpen: () => Swal.showLoading() });
    
    // Corregido: id_reserva según esquema
    const { data: consumos, error } = await supabase.from('consumos').select('*').eq('id_reserva', idReserva);
    if (error || !consumos || !consumos.length) return Swal.fire("Sin Consumos", "No se registraron extras.", "info");

    let sumaReal = 0;
    let itemsHTML = consumos.map(c => {
        const cant = parseInt(c.cantidad || 1);
        const pTotal = parseFloat(c.total_consumo || 0); // Corregido: total_consumo
        const pUnit = parseFloat(c.precio_unitario || 0); // Corregido: precio_unitario
        sumaReal += pTotal;

        return `
            <div style="margin-bottom:15px; font-size: 16px;">
                <div style="display:flex; justify-content:space-between;">
                    <span>${cant}x ${c.descripcion}</span>
                    <span style="font-weight:bold;">S/ ${pTotal.toFixed(2)}</span>
                </div>
                <div style="font-size:12px; color:#666;">&nbsp;&nbsp;&nbsp;(P. Unit: S/ ${pUnit.toFixed(2)})</div>
            </div>`;
    }).join('');

    const html = `
        <div style="text-align:left; padding:10px; font-family:'Courier New';">
            <div style="text-align:center; font-family:'Playfair Display'; font-size:24px; color:#800020; border-bottom:3px dashed #000; margin-bottom:20px; padding-bottom:15px;">TICKET CONSUMOS</div>
            ${itemsHTML}
            <div style="margin-top:25px; border-top:3px solid #000; padding-top:15px;">
                <div style="display:flex; justify-content:space-between; font-size:26px; font-weight:bold; color:#800020;">
                    <span>TOTAL</span><span>S/ ${sumaReal.toFixed(2)}</span>
                </div>
            </div>
        </div>`;
    Swal.fire({ html, width: '550px', confirmButtonColor: '#800020' });
};

// --- 5. CONFIGURACIÓN DE HISTORIAL GLOBAL EN MODALES ---
window.verTicketGlobal = async function(idReserva) {
    Swal.fire({ title: 'Generando estado de cuenta...', didOpen: () => Swal.showLoading() });

    try {
        // Traemos los datos de la reserva e incluimos los datos de las llaves foráneas necesarias
        const { data: res } = await supabase.from('reservas').select('*, huespedes(nombres_apellidos), habitaciones(numero)').eq('id', idReserva).single();
        const { data: consumos } = await supabase.from('consumos').select('*').eq('id_reserva', idReserva);
        const { data: todosLosPagosReserva } = await supabase.from('pagos').select('*').eq('id_reserva', idReserva).order('fecha_pago', { ascending: true });

        let htmlConsumosDetallado = '';
        let sumaExtraReal = 0;
        
        if (consumos) {
            consumos.forEach(c => {
                const cant = parseInt(c.cantidad || 1);
                const pTotal = parseFloat(c.total_consumo || 0); // Corregido: total_consumo
                sumaExtraReal += pTotal;
                htmlConsumosDetallado += `
                    <div style="display:flex; justify-content:space-between; font-size:12px; color:#555; margin-bottom:3px;">
                        <span>${cant}x ${c.descripcion}</span>
                        <span>S/ ${pTotal.toFixed(2)}</span>
                    </div>`;
            });
        }

        let htmlPagos = '';
        let totalAbonado = 0;
        if (todosLosPagosReserva) {
            todosLosPagosReserva.forEach(p => {
                const fecha = p.fecha_pago ? new Date(p.fecha_pago + "T00:00:00").toLocaleDateString('es-PE') : '';
                const monto = parseFloat(p.monto_soles || 0);
                totalAbonado += monto;
                htmlPagos += `
                    <div style="display:flex; justify-content:space-between; font-size:12px; color:#166534; margin-bottom:3px;">
                        <span>${fecha} - ${p.concepto} (${p.metodo_pago})</span>
                        <span>S/ ${monto.toFixed(2)}</span>
                    </div>`;
            });
        }

        // Corregido: La suma total de alojamiento sumando la tarifa y los cargos extras del esquema de reservas
        const tarifaHospedajeBase = parseFloat(res?.tarifa_pactada || 0);
        const cargosExtrasHospedaje = parseFloat(res?.cargo_early_checkin || 0) + parseFloat(res?.cargo_late_checkout || 0);
        const tarifaHospedajeTotal = tarifaHospedajeBase + cargosExtrasHospedaje;

        const totalCargosReal = tarifaHospedajeTotal + sumaExtraReal;
        const saldoPendiente = totalCargosReal - totalAbonado;

        const html = `
            <div style="text-align:left; padding:10px; font-family:'Courier New', monospace; color:#000;">
                <div style="text-align:center; font-family:'Playfair Display'; font-size:20px; color:#800020; font-weight:bold; border-bottom:2px dashed #000; padding-bottom:10px; margin-bottom:15px;">
                    ESTADO DE CUENTA COMPLETO
                </div>

                <div style="background:#f8fafc; padding:10px; border-radius:5px; margin-bottom:15px; border:1px solid #e2e8f0; font-family:sans-serif; font-size:12px;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:2px;"><b>HABITACIÓN:</b> <span>${res?.habitaciones?.numero || '--'}</span></div>
                    <div style="display:flex; justify-content:space-between; margin-bottom:2px;"><b>HUÉSPED:</b> <span style="text-transform:uppercase;">${res?.huespedes?.nombres_apellidos || '--'}</span></div>
                    <div style="display:flex; justify-content:space-between;"><b>ESTANCIA:</b> <span>${res?.check_in_fecha || ''} al ${res?.check_out_fecha || ''}</span></div>
                </div>

                <div style="margin-bottom:15px;">
                    <div style="font-weight:bold; border-bottom:1px solid #eee; margin-bottom:5px; font-size:13px;">DESGLOSE DE CARGOS</div>
                    <div style="display:flex; justify-content:space-between; font-size:12px;"><span>TOTAL ALOJAMIENTO (Tarifa + Cargos)</span> <span>S/ ${tarifaHospedajeTotal.toFixed(2)}</span></div>
                    ${htmlConsumosDetallado || '<div style="font-size:12px; color:#999;">Sin extras consumidos</div>'}
                    <div style="display:flex; justify-content:space-between; font-weight:bold; margin-top:5px; border-top:1px dashed #ccc; padding-top:5px; font-size:13px;">
                        <span>TOTAL CUENTA</span> <span>S/ ${totalCargosReal.toFixed(2)}</span>
                    </div>
                </div>

                <div style="margin-bottom:15px;">
                    <div style="font-weight:bold; border-bottom:1px solid #eee; margin-bottom:5px; font-size:13px;">HISTORIAL DE ABONOS</div>
                    ${htmlPagos}
                </div>

                <div style="border-top:2px solid #000; padding-top:10px; background: ${saldoPendiente <= 0 ? '#f0fdf4' : '#fff1f2'}; padding: 10px; border-radius:5px;">
                    <div style="display:flex; justify-content:space-between; font-size:18px; font-weight:bold; color: ${saldoPendiente <= 0 ? '#166534' : '#991b1b'};">
                        <span>${saldoPendiente <= 0 ? 'TOTAL PAGADO' : 'SALDO POR COBRAR'}</span>
                        <span>S/ ${saldoPendiente <= 0 ? totalAbonado.toFixed(2) : saldoPendiente.toFixed(2)}</span>
                    </div>
                    <div style="text-align:center; font-size:11px; color:${saldoPendiente <= 0 ? '#166534' : '#991b1b'}; margin-top:5px; font-weight:bold;">
                        ${saldoPendiente <= 0 ? '*** CUENTA TOTALMENTE LIQUIDADA ***' : '*** PENDIENTE DE PAGO ***'}
                    </div>
                </div>
            </div>`;

        Swal.fire({ html, width: '550px', confirmButtonText: 'CERRAR', confirmButtonColor: '#800020' });
    } catch (e) {
        console.error(e);
        Swal.fire("Error", "Error al procesar el historial", "error");
    }
};

// --- 6. INICIALIZADORES ---
consultarYEscucharPagos();
fInicio.addEventListener('change', aplicarFiltros);
fFin.addEventListener('change', aplicarFiltros);
document.getElementById('btnLimpiar').addEventListener('click', () => { fInicio.value = ''; fFin.value = ''; aplicarFiltros(); });
document.getElementById('current-date').innerText = new Date().toLocaleDateString('es-PE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

// --- NUEVA FUNCIÓN AGREGADA: DETALLE DE ALOJAMIENTO ---
window.verDetalleAlojamiento = async function(idReserva) {
    Swal.fire({ title: 'Cargando desglose de hospedaje...', didOpen: () => Swal.showLoading() });
    
    try {
        // Traemos la reserva cruzando los datos de la habitación asignada
        const { data: res, error } = await supabase
            .from('reservas')
            .select('*, habitaciones(numero, tipo)')
            .eq('id', idReserva)
            .single();

        if (error || !res) return Swal.fire("Error", "No se encontró la información del hospedaje.", "error");

        const tarifaBase = parseFloat(res.tarifa_pactada || 0);
        const earlyCheckin = parseFloat(res.cargo_early_checkin || 0);
        const lateCheckout = parseFloat(res.cargo_late_checkout || 0);
        const subtotalHospedaje = tarifaBase + earlyCheckin + lateCheckout;

        const html = `
            <div style="text-align:left; padding:10px; font-family:'Courier New', monospace; color:#000;">
                <div style="text-align:center; font-family:'Playfair Display'; font-size:22px; color:#800020; font-weight:bold; border-bottom:2px dashed #000; padding-bottom:12px; margin-bottom:15px;">
                    DETALLE DE HOSPEDAJE
                </div>
                
                <div style="font-size:14px; margin-bottom:8px;"><b>HABITACIÓN:</b> ${res.habitaciones?.numero || '--'} (${res.habitaciones?.tipo || '--'})</div>
                <div style="font-size:14px; margin-bottom:8px;"><b>FECHAS:</b> ${res.check_in_fecha} al ${res.check_out_fecha}</div>
                <div style="font-size:14px; margin-bottom:15px; border-bottom:1px solid #ddd; padding-bottom:10px;"><b>MEDIO DE RESERVA:</b> ${res.medio_reserva}</div>

                <div style="font-weight:bold; margin-bottom:8px; font-size:14px;">DESGLOSE FINANCIERO:</div>
                <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px;">
                    <span>Tarifa Pactada Base:</span> <span>S/ ${tarifaBase.toFixed(2)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px;">
                    <span>Cargo Early Check-in:</span> <span>S/ ${earlyCheckin.toFixed(2)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px;">
                    <span>Cargo Late Check-out:</span> <span>S/ ${lateCheckout.toFixed(2)}</span>
                </div>
                
                <div style="display:flex; justify-content:space-between; font-weight:bold; font-size:16px; margin-top:15px; border-top:2px solid #000; padding-top:10px; color:#800020;">
                    <span>SUBTOTAL ALOJAMIENTO:</span> <span>S/ ${subtotalHospedaje.toFixed(2)}</span>
                </div>
            </div>
        `;

        Swal.fire({ html, width: '480px', confirmButtonText: 'CERRAR', confirmButtonColor: '#800020' });

    } catch (e) {
        console.error(e);
        Swal.fire("Error", "No se pudo cargar el desglose del alojamiento.", "error");
    }
};