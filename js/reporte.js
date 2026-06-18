import { client as supabase } from './config.js';

let reporteActualId = null;
let cajaTurnoActualId = null; // ID de la fila actual en public.caja_turnos
let estadoCajaActual = 'C'; // 'A' = Abierto, 'C' = Cerrado (Se mapea según el turno actual)
let efectivoSistemaGlobal = 0; // Efectivo recaudado en el turno actual
let montoAperturaGlobal = 0; // Base con la que abre el turno actual
let egresosEfectivoGlobal = 0; // Egresos registrados exclusivamente en el turno actual

document.addEventListener('DOMContentLoaded', () => {
    // 1. Obtener la hora y fecha real de Trujillo
    const ahora = new Date();
    const horaActual = ahora.getHours();
    
    // Calculamos la fecha en formato YYYY-MM-DD considerando la zona horaria
    let fechaOperativa = ahora.toLocaleDateString('sv-SE', { timeZone: 'America/Lima' });

    // 🌙 TRUCO DE MADRUGADA: Si estamos entre medianoche y 6 AM, jalamos el reporte del día anterior
    if (horaActual >= 0 && horaActual < 6) {
        const fechaTemporal = new Date();
        fechaTemporal.setDate(fechaTemporal.getDate() - 1);
        fechaOperativa = fechaTemporal.toLocaleDateString('sv-SE', { timeZone: 'America/Lima' });
        console.log(`🌙 Auditoría: Detectada madrugada operativa. Cargando reporte del día anterior: ${fechaOperativa}`);
    }

    const filtroFecha = document.getElementById('filtroFechaReporte');
    filtroFecha.value = fechaOperativa;

    cargarReportePorFecha(fechaOperativa);
    cargarDatosSesionUsuario();

    // --- ASIGNACIÓN DE EVENT LISTENERS ---
    filtroFecha.addEventListener('change', (e) => cargarReportePorFecha(e.target.value));
    document.getElementById('btnAccionReporteDiario').addEventListener('click', manejarFlujoCaja);
    document.getElementById('btnGuardarArqueo').addEventListener('click', guardarConteoFisicoParcial);
    document.getElementById('btnRegistrarEgreso').addEventListener('click', abrirModalRegistrarEgreso);
    
    if (document.getElementById('btnControlTurno')) {
        document.getElementById('btnControlTurno').addEventListener('click', mostrarControlDeTurno);
    }
    
    // Vinculación del nuevo botón de bitácora diaria
    const btnOcurrencia = document.getElementById('btnAgregarOcurrencia');
    if (btnOcurrencia) {
        btnOcurrencia.addEventListener('click', abrirModalAgregarOcurrencia);
    }
    
    // 🌟 EVENT LISTENER: Cálculo de diferencia en vivo cuando el usuario escribe
    document.getElementById('efectivo_fisico_real').addEventListener('input', (e) => {
        const valorFisico = parseFloat(e.target.value);
        
        if (isNaN(valorFisico)) {
            document.getElementById('diferencia').innerText = "S/ 0.00";
            document.getElementById('diferencia').style.color = "#64748b";
            return;
        }

        // Efectivo esperado del turno = Apertura Turno + Efectivo ingresado Turno - Egresos Turno
        const efectivoEsperado = montoAperturaGlobal + efectivoSistemaGlobal - egresosEfectivoGlobal;
        const diferenciaCalculada = valorFisico - efectivoEsperado;
        
        actualizarEstiloDiferenciaHTML(diferenciaCalculada);
    });
});

// ==========================================
// 1. CARGAR DATOS DESDE SUPABASE (SINCRO DE 4 TABLAS)
// ==========================================
async function cargarReportePorFecha(fechaDestino) {
    try {
        const turnoActivo = localStorage.getItem("turno_activo") || "Mañana";

        // Consultas simultáneas para optimizar la velocidad en Trujillo
        const [respuestaCaja, respuestaTurno, respuestaPagos, respuestaEgresos] = await Promise.all([
            supabase.from('reporte_diario').select('*').eq('fecha_reporte', fechaDestino).maybeSingle(),
            supabase.from('caja_turnos').select('*').eq('fecha', fechaDestino).eq('turno', turnoActivo).maybeSingle(),
            supabase.from('pagos').select('*').eq('fecha_pago', fechaDestino), 
            supabase.from('egresos').select('*').eq('fecha_egreso', fechaDestino).eq('turno', turnoActivo)
        ]);

        if (respuestaCaja.error) throw respuestaCaja.error;
        if (respuestaTurno.error) throw respuestaTurno.error;
        if (respuestaPagos.error) throw respuestaPagos.error;
        if (respuestaEgresos.error) throw respuestaEgresos.error;

        const reporte = respuestaCaja.data;
        const cajaTurno = respuestaTurno.data;
        const pagos = respuestaPagos.data || [];
        const egresos = respuestaEgresos.data || [];

        // Si no existe reporte diario maestro, reseteamos la UI completa
        if (!reporte) {
            reporteActualId = null;
            cajaTurnoActualId = null;
            montoAperturaGlobal = 0;
            efectivoSistemaGlobal = 0;
            egresosEfectivoGlobal = 0;
            renderizarCajaCerradaVacia();
            resetearKPIsYNotasVacias();
            return;
        }

        reporteActualId = reporte.id;
        
        // El estado operativo de la interfaz se rige por el turno actual en caja_turnos
        if (!cajaTurno) {
            cajaTurnoActualId = null;
            estadoCajaActual = 'C'; // Turno cerrado o no abierto aún
            montoAperturaGlobal = 0;
        } else {
            cajaTurnoActualId = cajaTurno.id;
            estadoCajaActual = cajaTurno.estado; // 'A' o 'C' según la tabla caja_turnos
            montoAperturaGlobal = parseFloat(cajaTurno.monto_apertura || 0);
        }

        // --- PROCESAMIENTO DINÁMICO DE INGRESOS (Solo del turno activo para la caja chica) ---
        let efecTurno = 0, yapeTotal = 0, transTotal = 0, tarjTotal = 0, usdSolesTotal = 0, consumosTotal = 0;
        let ventasTotalesDelDia = 0;

        pagos.forEach(pago => {
            const monto = parseFloat(pago.monto_soles || 0);
            const metodo = String(pago.metodo_pago).toUpperCase().trim();
            
            // KPI Global de ventas brutas del día (Suma de todos los métodos)
            ventasTotalesDelDia += monto;

            // Para el control de caja chica en efectivo, filtramos los ingresos que correspondan al turno activo
            if (pago.turno === turnoActivo) {
                if (metodo === 'EFECTIVO') efecTurno += monto;
            }

            // Totales informativos generales para la vista
            if (metodo === 'YAPE') yapeTotal += monto;
            else if (metodo === 'TRANSFERENCIA') transTotal += monto;
            else if (metodo === 'TARJETA') tarjTotal += monto;
            else if (pago.moneda === 'USD') usdSolesTotal += monto;

            if ((pago.es_consumo === true || pago.categoria === 'Consumo') && pago.estado_pago === 'Pagado') {
                consumosTotal += monto;
            }
        });

        efectivoSistemaGlobal = efecTurno;

        // --- PROCESAMIENTO DINÁMICO DE EGRESOS DE ESTE TURNO ---
        let totalEgresosTurno = 0;
        egresos.forEach(egr => { totalEgresosTurno += parseFloat(egr.monto || 0); });
        egresosEfectivoGlobal = totalEgresosTurno;

        // --- INYECCIÓN EN LOS ELEMENTOS HTML ---
        document.getElementById('total_ingresos_sistema').innerText = `S/ ${ventasTotalesDelDia.toFixed(2)}`;
        document.getElementById('monto-apertura').innerText = `S/ ${montoAperturaGlobal.toFixed(2)}`;
        
        document.getElementById('total_efectivo').innerText = `S/ ${efecTurno.toFixed(2)}`;
        document.getElementById('total_yape').innerText = `S/ ${yapeTotal.toFixed(2)}`;
        document.getElementById('total_transferencia').innerText = `S/ ${transTotal.toFixed(2)}`;
        document.getElementById('total_tarjeta').innerText = `S/ ${tarjTotal.toFixed(2)}`;
        document.getElementById('total_usd_en_soles').innerText = `S/ ${usdSolesTotal.toFixed(2)}`;
        document.getElementById('total_consumos').innerText = `S/ ${consumosTotal.toFixed(2)}`;
        document.getElementById('total_egresos_efectivo').innerText = `S/ ${totalEgresosTurno.toFixed(2)}`;

        // Arqueo de Caja del Turno
        const efectivoEsperadoTotal = montoAperturaGlobal + efecTurno - totalEgresosTurno;
        document.getElementById('efectivo_esperado_cierre').innerText = `S/ ${efectivoEsperadoTotal.toFixed(2)}`;
        document.getElementById('tbl-sistema-efectivo').innerText = `S/ ${efectivoEsperadoTotal.toFixed(2)}`;

        // Setear valores de arqueo previos si existen en la base de datos
        const inputFisico = document.getElementById('efectivo_fisico_real');
        if (cajaTurno && cajaTurno.efectivo_real_entregado !== null) {
            inputFisico.value = cajaTurno.efectivo_real_entregado;
            const difInicial = parseFloat(cajaTurno.diferencia || 0);
            actualizarEstiloDiferenciaHTML(difInicial);
        } else {
            inputFisico.value = '';
            actualizarEstiloDiferenciaHTML(0);
        }

        document.getElementById('observaciones').value = reporte.observaciones || '';
        
        // Renderizar componentes y bitácoras
        renderizarListaEgresos(egresos);
        actualizarCamposTurnosYEstado(reporte, estadoCajaActual);
        await asegurarRecepcionistaEnTurnoActual();

        // Carga paralela de KPIs de ocupación y bitácoras de texto
        await calcularMovimientosDelDia(fechaDestino, reporte);
        await cargarOcurrenciasDelDia(fechaDestino);

    } catch (err) {
        console.error("Error crítico al consolidar el flujo operativo:", err);
        Swal.fire('Error de Conexión', 'No se pudieron recuperar las finanzas en tiempo real.', 'error');
    }
}

// ==========================================
// 2. CONTROLADOR DINÁMICO DE FLUX DE HUÉSPEDES (KPIs)
// ==========================================
async function calcularMovimientosDelDia(fechaDestino, reporteExistente) {
    try {
        if (reporteExistente && reporteExistente.estado === 'C') {
            document.getElementById('num_checkins').innerText = reporteExistente.num_checkins || 0;
            document.getElementById('num_checkouts').innerText = reporteExistente.num_checkouts || 0;
            document.getElementById('num_reservas_nuevas').innerText = reporteExistente.num_reservas_nuevas || 0;
            return;
        }

        const [resCheckins, resCheckouts, resNuevas] = await Promise.all([
            supabase.from('reservas').select('id', { count: 'exact', head: true }).eq('fecha_checkin', fechaDestino),
            supabase.from('reservas').select('id', { count: 'exact', head: true }).eq('fecha_checkout', fechaDestino),
            supabase.from('reservas').select('id', { count: 'exact', head: true }).eq('fecha_creacion', fechaDestino)
        ]);

        const totalIns = resCheckins.count || 0;
        const totalOuts = resCheckouts.count || 0;
        const totalNuevas = resNuevas.count || 0;

        document.getElementById('num_checkins').innerText = totalIns;
        document.getElementById('num_checkouts').innerText = totalOuts;
        document.getElementById('num_reservas_nuevas').innerText = totalNuevas;

        if (reporteActualId && reporteExistente.estado === 'A') {
            await supabase.from('reporte_diario').update({
                num_checkins: totalIns,
                num_checkouts: totalOuts,
                num_reservas_nuevas: totalNuevas
            }).eq('id', reporteActualId);
        }
    } catch (err) {
        console.error("Error calculando flujos de habitaciones del día:", err);
    }
}

// ==========================================
// 3. CONTROLADOR DE OCURRENCIAS POR TURNO (VINCULADO A TU TABLA EXACTA)
// ==========================================
async function cargarOcurrenciasDelDia(fechaDestino) {
    const colManana = document.getElementById('columna-notas-manana');
    const colTarde = document.getElementById('columna-notas-tarde');
    const colNoche = document.getElementById('columna-notas-noche');

    try {
        const { data: listaOcurrencias, error } = await supabase
            .from('ocurrencias')
            .select('*')
            .eq('fecha', fechaDestino)
            .order('creado_at', { ascending: true });

        if (error) throw error;

        colManana.innerHTML = '';
        colTarde.innerHTML = '';
        colNoche.innerHTML = '';

        let cantManana = 0, cantTarde = 0, cantNoche = 0;

        listaOcurrencias.forEach(ocu => {
            const creadorNota = ocu.usuario_nombre || "Recepcionista";

            const htmlNota = `
                <div style="background: white; padding: 8px 10px; border-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; font-size: 12px; margin-bottom: 6px;">
                    <p style="margin: 0 0 6px 0; color: #334155; line-height: 1.4;">${ocu.descripcion}</p>
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: #94a3b8;">
                        <span>✍️ <b>${creadorNota}</b></span>
                        <span>${new Date(ocu.creado_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                </div>
            `;

            if (ocu.turno === 'Mañana') { colManana.innerHTML += htmlNota; cantManana++; }
            else if (ocu.turno === 'Tarde') { colTarde.innerHTML += htmlNota; cantTarde++; }
            else if (ocu.turno === 'Noche') { colNoche.innerHTML += htmlNota; cantNoche++; }
        });

        if (cantManana === 0) colManana.innerHTML = `<p style="text-align: center; color: #94a3b8; font-size: 12px; margin-top: 10px;">Sin notas.</p>`;
        if (cantTarde === 0) colTarde.innerHTML = `<p style="text-align: center; color: #94a3b8; font-size: 12px; margin-top: 10px;">Sin notas.</p>`;
        if (cantNoche === 0) colNoche.innerHTML = `<p style="text-align: center; color: #94a3b8; font-size: 12px; margin-top: 10px;">Sin notas.</p>`;

    } catch (err) {
        console.error("Error al renderizar la bitácora de turnos:", err);
    }
}

async function abrirModalAgregarOcurrencia() {
    if (estadoCajaActual !== 'A') {
        Swal.fire('Operación Bloqueada', 'No se pueden registrar notas operativas si tu turno de caja está cerrado.', 'warning');
        return;
    }

    const fechaFiltro = document.getElementById('filtroFechaReporte').value;
    const idUsuarioActivo = localStorage.getItem("id_usuario_logueado") || null; 
    const turnoActivo = localStorage.getItem("turno_activo") || "Mañana"; 
    const nombreUsuarioActivo = localStorage.getItem("nombre_recepcionista") || "Fernanda Salinas";

    const { value: textoNota } = await Swal.fire({
        title: '📋 Nueva Ocurrencia / Entrega de Turno',
        input: 'textarea',
        inputLabel: `Registrar pendiente en el Turno: ${turnoActivo}`,
        inputPlaceholder: 'Escribe aquí mantenimientos pendientes, entrega de llaves, cobros pendientes...',
        showCancelButton: true,
        confirmButtonColor: '#800020',
        confirmButtonText: 'Guardar en Bitácora',
        cancelButtonText: 'Cancelar',
        inputValidator: (value) => { if (!value.trim()) return '¡La nota no puede estar vacía!'; }
    });

    if (textoNota) {
        try {
            const { error } = await supabase.from('ocurrencias').insert([{
                fecha: fechaFiltro,
                turno: turnoActivo,
                descripcion: textoNota.trim(),
                usuario_id: idUsuarioActivo,
                usuario_nombre: nombreUsuarioActivo
            }]);

            if (error) throw error;

            Swal.fire('Registrado', 'La nota ha sido agregada a la bitácora del turno.', 'success');
            await cargarOcurrenciasDelDia(fechaFiltro);

        } catch (err) {
            console.error("Error al insertar ocurrencia:", err);
            Swal.fire('Error', 'No se pudo registrar la nota operativa.', 'error');
        }
    }
}

// ==========================================
// 4. REGISTRAR EGRESOS EN EL TURNO
// ==========================================
async function abrirModalRegistrarEgreso() {
    if (estadoCajaActual !== 'A') {
        Swal.fire('Caja Cerrada', 'No puedes registrar egresos con tu turno cerrado.', 'warning');
        return;
    }

    const idUsuarioActivo = localStorage.getItem("id_usuario_logueado") || "TU_UUID_REAL_DE_USUARIO_DE_SUPABASE";
    const turnoActivo = localStorage.getItem("turno_activo") || "Mañana";
    const fechaFiltro = document.getElementById('filtroFechaReporte').value;

    const { value: formValues } = await Swal.fire({
        title: '📉 Registrar Egreso de Efectivo',
        html: `
            <input id="swal-egreso-monto" class="swal2-input" type="number" placeholder="Monto S/" step="0.10">
            <input id="swal-egreso-desc" class="swal2-input" type="text" placeholder="Descripción / Motivo del gasto">
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonColor: '#e11d48',
        confirmButtonText: 'Registrar Gasto',
        preConfirm: () => {
            const monto = parseFloat(document.getElementById('swal-egreso-monto').value);
            const desc = document.getElementById('swal-egreso-desc').value.trim();
            if (isNaN(monto) || monto <= 0) {
                Swal.showValidationMessage('Ingresa un monto válido mayor a 0');
                return false;
            }
            if (!desc) {
                Swal.showValidationMessage('Debes ingresar una descripción');
                return false;
            }
            return { monto, descripcion: desc };
        }
    });

    if (formValues) {
        try {
            const { error } = await supabase.from('egresos').insert([{
                fecha_egreso: fechaFiltro,
                monto: formValues.monto,
                concepto: formValues.descripcion,
                id_usuario: idUsuarioActivo,
                turno: turnoActivo
            }]);

            if (error) throw error;

            Swal.fire('Egreso Guardado', `Se registró el egreso de S/ ${formValues.monto.toFixed(2)}`, 'success');
            cargarReportePorFecha(fechaFiltro);
        } catch (err) {
            console.error(err);
            Swal.fire('Error', 'No se pudo registrar el egreso.', 'error');
        }
    }
}

// ==========================================
// 5. CONTROLADOR OPERATIVO DE APERTURA / CIERRE POR TURNO
// ==========================================
async function manejarFlujoCaja() {
    const fechaFiltro = document.getElementById('filtroFechaReporte').value;
    const idUsuarioActivo = localStorage.getItem("id_usuario_logueado") || "TU_UUID_REAL_DE_USUARIO_DE_SUPABASE"; 
    const nombreUsuarioActivo = localStorage.getItem("nombre_recepcionista") || "Recepcionista";
    const turnoActivo = localStorage.getItem("turno_activo") || "Mañana"; 

    // Primero, nos aseguramos de que el reporte diario maestro exista
    if (!reporteActualId) {
        try {
            const { data: nuevoReporte, error: errMaestro } = await supabase
                .from('reporte_diario')
                .insert([{ fecha_reporte: fechaFiltro, estado: 'A', monto_apertura: 0 }])
                .select().single();
            if (errMaestro) throw errMaestro;
            reporteActualId = nuevoReporte.id;
        } catch (err) {
            console.error("No se pudo iniciar el reporte maestro diario:", err);
            return;
        }
    }

    if (estadoCajaActual === 'C') {
        const { value: montoAperturaIntroducido } = await Swal.fire({
            title: 'Apertura de Turno (Caja Chica)',
            text: `Iniciando caja como ${nombreUsuarioActivo} en el Turno ${turnoActivo}. Ingrese el dinero en efectivo recibido:`,
            input: 'number',
            inputAttributes: { min: '0', step: '0.10' },
            inputValue: '0.00',
            showCancelButton: true,
            confirmButtonText: 'Confirmar Apertura',
            confirmButtonColor: '#800020',
            cancelButtonText: 'Cancelar',
            inputValidator: (val) => { if (!val || isNaN(val) || val < 0) return '¡Debe ingresar un número válido!'; }
        });

        if (montoAperturaIntroducido !== undefined) {
            try {
                const datosAperturaTurno = {
                    fecha: fechaFiltro,
                    turno: turnoActivo,
                    id_usuario: idUsuarioActivo,
                    monto_apertura: parseFloat(montoAperturaIntroducido),
                    ingresos_efectivo: 0,
                    egresos_efectivo: 0,
                    efectivo_real_entregado: 0,
                    estado: 'A'
                };

                const { error } = await supabase.from('caja_turnos').insert([datosAperturaTurno]);
                if (error) throw error;
                
                Swal.fire('Turno Abierto', `Se abrió la caja chica del turno ${turnoActivo}.`, 'success');
                cargarReportePorFecha(fechaFiltro);
            } catch (err) {
                console.error("❌ Error al abrir turno:", err);
                Swal.fire('Error', `No se pudo abrir la caja de este turno.`, 'error');
            }
        }
    } else {
        // CIERRE DE CAJA DEL TURNO
        const valorFisicoIngresado = parseFloat(document.getElementById('efectivo_fisico_real').value);
        if (isNaN(valorFisicoIngresado)) {
            Swal.fire('Conteo Requerido', 'Por favor, digite el monto de efectivo físico real antes de cerrar tu turno.', 'warning');
            return;
        }

        const confirmacion = await Swal.fire({
            title: '¿Confirmar Cierre de Turno?',
            text: `Se congelarán las finanzas de la caja chica para el turno ${turnoActivo} bajo la firma de ${nombreUsuarioActivo}.`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#800020',
            confirmButtonText: 'Sí, Cerrar Turno'
        });

        if (confirmacion.isConfirmed) {
            try {
                // Actualizamos la fila de caja_turnos correspondiente
                const { error } = await supabase.from('caja_turnos').update({
                    ingresos_efectivo: efectivoSistemaGlobal,
                    egresos_efectivo: egresosEfectivoGlobal,
                    efectivo_real_entregado: valorFisicoIngresado,
                    estado: 'C'
                }).eq('id', cajaTurnoActualId);

                if (error) throw error;

                // Sincronizamos los totales calculados en el reporte diario consolidado como auditoría
                const columnaMontoTurno = turnoActivo === 'Mañana' ? 'total_turno_manana' : (turnoActivo === 'Tarde' ? 'total_turno_tarde' : 'total_turno_noche');
                const columnaRecepTurno = turnoActivo === 'Mañana' ? 'recep_manana' : (turnoActivo === 'Tarde' ? 'recep_tarde' : 'recep_noche');

                await supabase.from('reporte_diario').update({
                    [columnaMontoTurno]: efectivoSistemaGlobal,
                    [columnaRecepTurno]: nombreUsuarioActivo
                }).eq('id', reporteActualId);

                Swal.fire('Turno Cerrado', 'Los movimientos del turno se han guardado y auditado con éxito.', 'success');
                cargarReportePorFecha(fechaFiltro);
            } catch (err) {
                console.error("❌ Error al cerrar turno:", err);
                Swal.fire('Error', 'No se pudo guardar el cierre del turno.', 'error');
            }
        }
    }
}

async function guardarConteoFisicoParcial() {
    if (!cajaTurnoActualId) return;
    const valorFisico = parseFloat(document.getElementById('efectivo_fisico_real').value);
    try {
        const { error } = await supabase.from('caja_turnos').update({
            efectivo_real_entregado: isNaN(valorFisico) ? 0 : valorFisico
        }).eq('id', cajaTurnoActualId);

        if (error) throw error;
        Swal.fire('Guardado', 'Arqueo parcial del turno actualizado.', 'success');
    } catch (err) {
        Swal.fire('Error', 'No se pudo guardar el arqueo parcial.', 'error');
    }
}

// ==========================================
// 6. AUXILIARES DE RENDERIZACIÓN Y AUDITORÍA DE NOMBRES
// ==========================================
async function asegurarRecepcionistaEnTurnoActual() {
    if (!reporteActualId) return;
    const horaPeru = new Date().getHours();
    let columnaTurno = horaPeru >= 7 && horaPeru < 14 ? 'recep_manana' : (horaPeru >= 14 && horaPeru < 21 ? 'recep_tarde' : 'recep_noche');
    const nombreUsuarioActivo = localStorage.getItem("nombre_recepcionista") || "Fernanda Salinas";

    try {
        await supabase.from('reporte_diario').update({ [columnaTurno]: nombreUsuarioActivo }).eq('id', reporteActualId).is(columnaTurno, null);
    } catch (err) { console.error(err); }
}

function actualizarEstiloDiferenciaHTML(montoDiferencia) {
    const contenedorDif = document.getElementById('diferencia');
    if (Math.abs(montoDiferencia) < 0.01) {
        contenedorDif.innerText = "S/ 0.00";
        contenedorDif.style.color = "#64748b";
    } else if (montoDiferencia < 0) {
        contenedorDif.innerText = `S/ ${montoDiferencia.toFixed(2)}`;
        contenedorDif.style.color = "#ef4444";
    } else {
        contenedorDif.innerText = `S/ +${montoDiferencia.toFixed(2)}`;
        contenedorDif.style.color = "#27ae60";
    }
}

function renderizarListaEgresos(listaEgresos) {
    const contenedor = document.getElementById('listaEgresosDinamica');
    if (listaEgresos.length === 0) {
        contenedor.innerHTML = `<p style="text-align: center; margin-top: 10px;">No se registraron egresos en este turno.</p>`;
        return;
    }
    
    let html = '<ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px;">';
    listaEgresos.forEach(egr => {
        html += `
            <li style="display: flex; justify-content: space-between; background: #fff1f2; padding: 6px 10px; border-radius: 4px; border-left: 3px solid #e11d48; font-size: 13px;">
                <span><b>${egr.concepto || 'Gasto'}</b></span>
                <span style="color: #e11d48; font-weight: bold;">- S/ ${parseFloat(egr.monto).toFixed(2)}</span>
            </li>`;
    });
    html += '</ul>';
    contenedor.innerHTML = html;
}

function actualizarCamposTurnosYEstado(reporte, estadoDelTurno) {
    const btnAccion = document.getElementById('btnAccionReporteDiario');
    const lblEstado = document.getElementById('lbl-estado-caja');
    const inputFisico = document.getElementById('efectivo_fisico_real');
    const obs = document.getElementById('observaciones');
    const btnGuardar = document.getElementById('btnGuardarArqueo');

    document.getElementById('recep_manana').innerHTML = `Recepcionista: <b>${reporte.recep_manana || '-'}</b>`;
    document.getElementById('total_turno_manana').innerText = `S/ ${parseFloat(reporte.total_turno_manana || 0).toFixed(2)}`;
    document.getElementById('recep_tarde').innerHTML = `Recepcionista: <b>${reporte.recep_tarde || '-'}</b>`;
    document.getElementById('total_turno_tarde').innerText = `S/ ${parseFloat(reporte.total_turno_tarde || 0).toFixed(2)}`;
    document.getElementById('recep_noche').innerHTML = `Recepcionista: <b>${reporte.recep_noche || '-'}</b>`;
    document.getElementById('total_turno_noche').innerText = `S/ ${parseFloat(reporte.total_turno_noche || 0).toFixed(2)}`;

    if (estadoDelTurno === 'A') {
        lblEstado.innerText = "TURNO: ABIERTO";
        lblEstado.style.color = "#27ae60";
        btnAccion.innerHTML = `<i class="fa-solid fa-lock"></i> Cerrar Turno`;
        btnAccion.className = "btn-reporte-danger";
        inputFisico.disabled = false;
        obs.disabled = false;
        btnGuardar.disabled = false;
    } else {
        lblEstado.innerText = "TURNO: CERRADO";
        lblEstado.style.color = "#ef4444";
        btnAccion.innerHTML = `<i class="fa-solid fa-folder-open"></i> Abrir Turno`;
        btnAccion.className = "btn-reporte-success";
        inputFisico.disabled = true;
        obs.disabled = true;
        btnGuardar.disabled = true;
    }
}

function renderizarCajaCerradaVacia() {
    estadoCajaActual = 'C'; 
    document.getElementById('total_ingresos_sistema').innerText = "S/ 0.00";
    document.getElementById('efectivo_esperado_cierre').innerText = "S/ 0.00";
    document.getElementById('tbl-sistema-efectivo').innerText = "S/ 0.00";
    document.getElementById('monto-apertura').innerText = "S/ 0.00";
    
    const idsCeros = ['total_efectivo','total_yape','total_transferencia','total_tarjeta','total_usd_en_soles','total_consumos','total_egresos_efectivo','total_turno_manana','total_turno_tarde','total_turno_noche'];
    idsCeros.forEach(id => document.getElementById(id).innerText = "S/ 0.00");

    document.getElementById('efectivo_fisico_real').value = '';
    document.getElementById('efectivo_fisico_real').disabled = true;
    document.getElementById('diferencia').innerText = "S/ 0.00";
    document.getElementById('diferencia').style.color = "#64748b";
    
    document.getElementById('observaciones').value = '';
    document.getElementById('observaciones').disabled = true;
    document.getElementById('btnGuardarArqueo').disabled = true;

    const lblEstado = document.getElementById('lbl-estado-caja');
    lblEstado.innerText = "TURNO NO OPERATIVO";
    lblEstado.style.color = "#64748b";

    const btnAccion = document.getElementById('btnAccionReporteDiario');
    btnAccion.innerHTML = `<i class="fa-solid fa-folder-open"></i> Abrir Turno`;
    btnAccion.className = "btn-reporte-success";
}

function resetearKPIsYNotasVacias() {
    document.getElementById('num_checkins').innerText = "0";
    document.getElementById('num_checkouts').innerText = "0";
    document.getElementById('num_reservas_nuevas').innerText = "0";
    document.getElementById('columna-notas-manana').innerHTML = `<p style="text-align: center; color: #94a3b8; font-size: 12px; margin-top: 10px;">Sin notas.</p>`;
    document.getElementById('columna-notas-tarde').innerHTML = `<p style="text-align: center; color: #94a3b8; font-size: 12px; margin-top: 10px;">Sin notas.</p>`;
    document.getElementById('columna-notas-noche').innerHTML = `<p style="text-align: center; color: #94a3b8; font-size: 12px; margin-top: 10px;">Sin notas.</p>`;
}

function mostrarControlDeTurno() {
    const turno = localStorage.getItem("turno_activo") || "Mañana";
    const recepcionista = localStorage.getItem("nombre_recepcionista") || "Fernanda Salinas";

    Swal.fire({
        title: '⏰ Control de Turno Activo',
        html: `
            <div style="text-align: left; font-size: 14px; line-height: 1.8;">
                <p>👤 <b>Recepcionista:</b> ${recepcionista}</p>
                <p>📅 <b>Turno asignado:</b> ${turno}</p>
                <p>📍 <b>Sede:</b> Hotel Central Trujillo</p>
                <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 10px 0;">
                <small style="color: #64748b;">Recuerda registrar todas las ocurrencias y realizar el arqueo antes de que finalice tu horario operativo.</small>
            </div>
        `,
        icon: 'info',
        confirmButtonColor: '#d4a017'
    });
}

function cargarDatosSesionUsuario() {
    const nombre = localStorage.getItem('nombre_recepcionista') || "Fernanda Salinas";
    const rol = localStorage.getItem('userRole') || "Administrador";
    if (document.getElementById('userName')) document.getElementById('userName').innerText = nombre;
    if (document.getElementById('userRole')) document.getElementById('userRole').innerText = rol;

    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
            localStorage.clear();
            window.location.href = "index.html";
        });
    }
}