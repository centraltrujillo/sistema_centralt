import { client as supabase } from './config.js';

let reporteActualId = null;
let estadoCajaActual = 'C'; // 'A' = Abierto, 'C' = Cerrado
let efectivoSistemaGlobal = 0;
let montoAperturaGlobal = 0; 

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

    filtroFecha.addEventListener('change', (e) => cargarReportePorFecha(e.target.value));
    document.getElementById('btnCerrarTurno').addEventListener('click', manejarFlujoCaja);
    document.getElementById('btnGuardarArqueo').addEventListener('click', guardarConteoFisicoParcial);
    
    // 🌟 EVENT LISTENER: Cálculo de diferencia en vivo cuando el usuario escribe
    document.getElementById('inputEfectivoFisico').addEventListener('input', (e) => {
        const valorFisico = parseFloat(e.target.value);
        
        if (isNaN(valorFisico)) {
            // Si limpian el input, reseteamos la diferencia al valor de la BD o 0
            document.getElementById('tbl-diferencia-efectivo').innerText = "S/ 0.00";
            document.getElementById('tbl-diferencia-efectivo').style.color = "#64748b";
            return;
        }

        // Efectivo esperado = Base de apertura + lo ingresado en Efectivo
        const efectivoEsperado = montoAperturaGlobal + efectivoSistemaGlobal;
        const diferenciaCalculada = valorFisico - efectivoEsperado;
        
        actualizarEstiloDiferenciaHTML(diferenciaCalculada);
    });
});

// ==========================================
// 1. CARGAR DATOS DESDE SUPABASE
// ==========================================
async function cargarReportePorFecha(fechaDestino) {
    try {
        let { data: reporte, error } = await supabase
            .from('reporte_diario')
            .select('*')
            .eq('fecha_reporte', fechaDestino)
            .maybeSingle();

        if (error) throw error;

        if (!reporte) {
            reporteActualId = null;
            montoAperturaGlobal = 0;
            renderizarCajaCerradaVacia();
        } else {
            reporteActualId = reporte.id;
            estadoCajaActual = reporte.estado; 
            renderizarDatosReporte(reporte);

            asegurarRecepcionistaEnTurnoActual();
        }
    } catch (err) {
        console.error("Error crítico al leer reporte_diario:", err);
        Swal.fire('Error de Conexión', 'No se pudieron recuperar las finanzas operativas del día.', 'error');
    }
}

// ==========================================
// 2. RENDERIZAR DATOS EN LA INTERFAZ (HTML)
// ==========================================
function renderizarDatosReporte(reporte) {
    // 1. Mapear Variables Financieras Básicas y la Apertura
    const apertura = parseFloat(reporte.monto_apertura || 0); 
    const efec = parseFloat(reporte.total_efectivo || 0);
    const yape = parseFloat(reporte.total_yape || 0); 
    const trans = parseFloat(reporte.total_transferencia || 0);
    const tarj = parseFloat(reporte.total_tarjeta || 0);
    const usdSoles = parseFloat(reporte.total_usd_en_soles || 0);
    
    efectivoSistemaGlobal = efec;
    montoAperturaGlobal = apertura; 

    // El KPI superior reflejará las ventas brutas acumuladas
    const totalVentasDelDia = efec + yape + trans + tarj + usdSoles;

    // 2. Pintar KPIs Principales
    document.getElementById('kpi-ingresos-totales').innerText = `S/ ${totalVentasDelDia.toFixed(2)}`;
    document.getElementById('kpi-total-consumos').innerText = `S/ ${parseFloat(reporte.total_consumos || 0).toFixed(2)}`;
    document.getElementById('kpi-movimientos').innerText = `${reporte.num_checkins || 0} / ${reporte.num_checkouts || 0}`;
    document.getElementById('kpi-nuevas-reservas').innerText = reporte.num_reservas_nuevas || 0;

    // 3. Renderizar Desglose Lateral por Métodos de Pago
    document.getElementById('monto-efectivo').innerText = `S/ ${efec.toFixed(2)}`;
    document.getElementById('monto-yape').innerText = `S/ ${yape.toFixed(2)}`;
    document.getElementById('monto-transferencia').innerText = `S/ ${trans.toFixed(2)}`;
    document.getElementById('monto-tarjeta').innerText = `S/ ${tarj.toFixed(2)}`;
    document.getElementById('monto-usd').innerText = `S/ ${usdSoles.toFixed(2)}`;

    // 4. Actualizar Sección de Auditoría (Arqueo)
    const labelAperturaBase = document.getElementById('lbl-monto-apertura');
    if (labelAperturaBase) {
        labelAperturaBase.innerText = `S/ ${apertura.toFixed(2)}`;
    }

    const efectivoEsperadoEnCaja = apertura + efec;
    document.getElementById('tbl-sistema-efectivo').innerText = `S/ ${efectivoEsperadoEnCaja.toFixed(2)}`;
    
    const inputFisico = document.getElementById('inputEfectivoFisico');
    inputFisico.value = reporte.efectivo_fisico_real !== null ? reporte.efectivo_fisico_real : '';
    
    const diferenciaCalculada = parseFloat(reporte.diferencia || 0);
    actualizarEstiloDiferenciaHTML(diferenciaCalculada);

    document.getElementById('txtObservaciones').value = reporte.observaciones || '';

    // =========================================================================
    // 5. DISTRIBUCIÓN DE TURNOS Y RECEPCIONISTAS (CON BOTÓN DE RELEVO ACTIVO)
    // =========================================================================
    const recepcionistaManana = reporte.recep_manana || reporte.nombre_apertura || 'Sin asignar';
    const horaActualParaRelevo = new Date().getHours();

    // Evaluamos qué turno está activo en este momento en Trujillo
    let turnoActualString = 'Noche';
    if (horaActualParaRelevo >= 7 && horaActualParaRelevo < 14) turnoActualString = 'Mañana';
    if (horaActualParaRelevo >= 14 && horaActualParaRelevo < 21) turnoActualString = 'Tarde';

    // Inyección limpia en las cajitas HTML añadiendo un botón para registrar relevo al turno activo
    document.getElementById('turno-user-manana').innerHTML = `
        Recepcionista: <b>${recepcionistaManana}</b>
        ${turnoActualString === 'Mañana' && reporte.estado === 'A' ? `<button onclick="abrirModalRelevoTurno('Mañana')" style="margin-left:8px; border:none; background:none; color:var(--vino-tinto); cursor:pointer;" title="Registrar entrega de caja"><i class="fa-solid fa-pen-to-square"></i></button>` : ''}
    `;
    document.getElementById('turno-monto-manana').innerText = `S/ ${parseFloat(reporte.total_turno_manana || 0).toFixed(2)}`;

    document.getElementById('turno-user-tarde').innerHTML = `
        Recepcionista: <b>${reporte.recep_tarde || 'Sin asignar'}</b>
        ${turnoActualString === 'Tarde' && reporte.estado === 'A' ? `<button onclick="abrirModalRelevoTurno('Tarde')" style="margin-left:8px; border:none; background:none; color:var(--vino-tinto); cursor:pointer;" title="Registrar entrega de caja"><i class="fa-solid fa-pen-to-square"></i></button>` : ''}
    `;
    document.getElementById('turno-monto-tarde').innerText = `S/ ${parseFloat(reporte.total_turno_tarde || 0).toFixed(2)}`;

    document.getElementById('turno-user-noche').innerHTML = `
        Recepcionista: <b>${reporte.recep_noche || 'Sin asignar'}</b>
        ${turnoActualString === 'Noche' && reporte.estado === 'A' ? `<button onclick="abrirModalRelevoTurno('Noche')" style="margin-left:8px; border:none; background:none; color:var(--vino-tinto); cursor:pointer;" title="Registrar entrega de caja"><i class="fa-solid fa-pen-to-square"></i></button>` : ''}
    `;
    document.getElementById('turno-monto-noche').innerText = `S/ ${parseFloat(reporte.total_turno_noche || 0).toFixed(2)}`;

    // 6. CONTROL DINÁMICO DEL BOTÓN DE ACCIÓN
    const btnAccion = document.getElementById('btnCerrarTurno');
    const lblEstado = document.getElementById('lbl-estado-caja');

    estadoCajaActual = reporte.estado; 

    if (reporte.estado === 'A') {
        lblEstado.innerText = "ABIERTO";
        lblEstado.style.color = "#27ae60";
        btnAccion.innerHTML = `<i class="fa-solid fa-lock"></i> Cerrar Caja`;
        btnAccion.className = "btn-reporte-danger";
        inputFisico.disabled = false;
        document.getElementById('txtObservaciones').disabled = false;
        document.getElementById('btnGuardarArqueo').disabled = false;
    } else {
        lblEstado.innerText = "CERRADO";
        lblEstado.style.color = "#ef4444";
        btnAccion.innerHTML = `<i class="fa-solid fa-lock-open"></i> Abrir Caja`;
        btnAccion.className = "btn-reporte-success";
        inputFisico.disabled = true;
        document.getElementById('txtObservaciones').disabled = true;
        document.getElementById('btnGuardarArqueo').disabled = true;
    }
}

function renderizarCajaCerradaVacia() {
    estadoCajaActual = 'C'; 

    document.getElementById('kpi-ingresos-totales').innerText = "S/ 0.00";
    document.getElementById('kpi-total-consumos').innerText = "S/ 0.00";
    document.getElementById('kpi-movimientos').innerText = "0 / 0";
    document.getElementById('kpi-nuevas-reservas').innerText = "0";
    
    document.getElementById('monto-efectivo').innerText = "S/ 0.00";
    document.getElementById('monto-yape').innerText = "S/ 0.00";
    document.getElementById('monto-transferencia').innerText = "S/ 0.00";
    document.getElementById('monto-tarjeta').innerText = "S/ 0.00";
    document.getElementById('monto-usd').innerText = "S/ 0.00";

    document.getElementById('tbl-sistema-efectivo').innerText = "S/ 0.00";
    document.getElementById('inputEfectivoFisico').value = '';
    document.getElementById('inputEfectivoFisico').disabled = true;
    document.getElementById('tbl-diferencia-efectivo').innerText = "S/ 0.00";
    document.getElementById('tbl-diferencia-efectivo').style.color = "#64748b";
    
    document.getElementById('txtObservaciones').value = '';
    document.getElementById('txtObservaciones').disabled = true;
    document.getElementById('btnGuardarArqueo').disabled = true;

    const lblEstado = document.getElementById('lbl-estado-caja');
    lblEstado.innerText = "CERRADO (SIN APERTURA)";
    lblEstado.style.color = "#64748b";

    const btnAccion = document.getElementById('btnCerrarTurno');
    btnAccion.innerHTML = `<i class="fa-solid fa-lock-open"></i> Abrir Caja`;
    btnAccion.className = "btn-reporte-success";
}

function actualizarEstiloDiferenciaHTML(montoDiferencia) {
    const contenedorDif = document.getElementById('tbl-diferencia-efectivo');
    
    // Validar el signo explícitamente para evitar el "-0.00" visual
    if (Math.abs(montoDiferencia) < 0.01) {
        contenedorDif.innerText = "S/ 0.00";
        contenedorDif.style.color = "#64748b"; // Gris neutro si está exacto
    } else if (montoDiferencia < 0) {
        contenedorDif.innerText = `S/ ${montoDiferencia.toFixed(2)}`;
        contenedorDif.style.color = "#ef4444"; // Rojo si falta dinero
    } else {
        contenedorDif.innerText = `S/ +${montoDiferencia.toFixed(2)}`;
        contenedorDif.style.color = "#27ae60"; // Verde si sobra dinero
    }
}

// ==========================================
// 3. CONTROLADOR INTERACTIVO DE APERTURA / CIERRE
// ==========================================
async function manejarFlujoCaja() {
    const fechaFiltro = document.getElementById('filtroFechaReporte').value;
    
    // Calcular de nuevo la fecha operativa actual en vivo para la validación
    const ahora = new Date();
    const horaActual = ahora.getHours();
    let fechaOperativaActual = ahora.toLocaleDateString('sv-SE', { timeZone: 'America/Lima' });

    if (horaActual >= 0 && horaActual < 6) {
        const fechaTemporal = new Date();
        fechaTemporal.setDate(fechaTemporal.getDate() - 1);
        fechaOperativaActual = fechaTemporal.toLocaleDateString('sv-SE', { timeZone: 'America/Lima' });
    }

    // 🛠️ Ahora validamos contra la fecha operativa del hotel
    if (fechaFiltro !== fechaOperativaActual) {
        Swal.fire({
            title: 'Gestión Histórica Bloqueada',
            text: 'No puedes abrir ni cerrar cajas de fechas pasadas o futuras. Solo se permite gestionar el día operativo actual.',
            icon: 'warning',
            confirmButtonColor: '#800020'
        });
        return;
    }
    
    const idUsuarioActivo = localStorage.getItem("id_usuario_logueado") || localStorage.getItem("id_usuario_actual");
                            
    const nombreUsuarioActivo = localStorage.getItem("nombre_recepcionista") || 
                                (document.getElementById('userName') && document.getElementById('userName').innerText) || 
                                "Recepcionista Central";

    if (!idUsuarioActivo) {
        Swal.fire('Sesión Inválida', 'No se detectó el ID del usuario activo. Por favor inicie sesión nuevamente.', 'error');
        return;
    }

    if (estadoCajaActual === 'C') {
        const { value: montoAperturaIntroducido } = await Swal.fire({
            title: 'Apertura de Caja Diario',
            text: 'Ingrese el monto base de dinero en efectivo (Sencillo) para iniciar el turno:',
            input: 'number',
            inputAttributes: { min: '0', step: '0.10' },
            inputValue: '0.00',
            showCancelButton: true,
            confirmButtonText: 'Confirmar Apertura',
            confirmButtonColor: '#800020',
            cancelButtonText: 'Cancelar',
            inputValidator: (val) => { if (!val || isNaN(val) || val < 0) return '¡Debe ingresar un número válido mayor o igual a 0!'; }
        });

        if (montoAperturaIntroducido !== undefined) {
            try {
                const nuevaApertura = {
                    fecha_reporte: fechaFiltro,
                    monto_apertura: parseFloat(montoAperturaIntroducido),
                    id_usuario_apertura: idUsuarioActivo, 
                    nombre_apertura: nombreUsuarioActivo,
                    estado: 'A' 
                };

                const { error } = await supabase
                    .from('reporte_diario')
                    .upsert(nuevaApertura, { onConflict: 'fecha_reporte' });

                if (error) throw error;

                Swal.fire('Caja Abierta', `Se inicializó el reporte del día con S/ ${parseFloat(montoAperturaIntroducido).toFixed(2)}`, 'success');
                cargarReportePorFecha(fechaFiltro);

            } catch (err) {
                console.error("Error al insertar apertura:", err);
                Swal.fire('Error', 'No se pudo registrar la apertura: ' + err.message, 'error');
            }
        }

    } else if (estadoCajaActual === 'A') {
        const valorFisicoIngresado = parseFloat(document.getElementById('inputEfectivoFisico').value);
        const observacionesFinales = document.getElementById('txtObservaciones').value;

        if (isNaN(valorFisicoIngresado)) {
            Swal.fire('Conteo Requerido', 'Por favor, digite el monto de efectivo físico real antes de cerrar la caja.', 'warning');
            return;
        }

        const confirmacion = await Swal.fire({
            title: '¿Confirmar Cierre de Caja?',
            text: "Una vez cerrada la caja, las métricas quedarán consolidadas.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#800020',
            cancelButtonColor: '#64748b',
            confirmButtonText: 'Sí, Cerrar Caja',
            cancelButtonText: 'Cancelar'
        });

        if (confirmacion.isConfirmed) {
            try {
                const datosCierre = {
                    estado: 'C', 
                    hora_cierre: new Date().toISOString(),
                    id_usuario_cierre: idUsuarioActivo,
                    nombre_cierre: nombreUsuarioActivo,
                    efectivo_fisico_real: valorFisicoIngresado,
                    observaciones: observacionesFinales
                };

                const { error } = await supabase
                    .from('reporte_diario')
                    .update(datosCierre)
                    .eq('id', reporteActualId);

                if (error) throw error;

                Swal.fire('Caja Cerrada', 'El reporte diario se ha consolidado y cerrado con éxito.', 'success');
                cargarReportePorFecha(fechaFiltro);

            } catch (err) {
                console.error("Error al procesar el cierre de caja:", err);
                Swal.fire('Error', 'No se pudo guardar el estado de cierre.', 'error');
            }
        }
    }
}

// ==========================================
// 4. GUARDADO DE CONTEO PARCIAL (SIN CERRAR)
// ==========================================
async function guardarConteoFisicoParcial() {
    if (!reporteActualId) return;

    const valorFisico = parseFloat(document.getElementById('inputEfectivoFisico').value);
    const obs = document.getElementById('txtObservaciones').value;

    try {
        const { error } = await supabase
            .from('reporte_diario')
            .update({
                efectivo_fisico_real: isNaN(valorFisico) ? null : valorFisico,
                observaciones: obs
            })
            .eq('id', reporteActualId);

        if (error) throw error;

        Swal.fire('Progreso Guardado', 'El efectivo real parcial y las anotaciones se actualizaron con éxito.', 'success');
        cargarReportePorFecha(document.getElementById('filtroFechaReporte').value);

    } catch (err) {
        console.error("Error al actualizar arqueo parcial:", err);
        Swal.fire('Error', 'No se pudo guardar la actualización parcial.', 'error');
    }
}

// ==========================================
// 5. ASISTENCIA DE SESIÓN Y TURNOS DINÁMICOS
// ==========================================
function cargarDatosSesionUsuario() {
    let rawNombre = localStorage.getItem('nombre_recepcionista');
    let rawRol = localStorage.getItem('userRole');
    const rawId = localStorage.getItem('id_usuario_logueado') || localStorage.getItem('id_usuario_actual');

    // 🕵️‍♀️ CORRECCIÓN DE EMERGENCIA: Si el rol vino vacío pero el nombre tiene la palabra 'ADMINISTRADOR'
    if (!rawRol && rawNombre === 'ADMINISTRADOR') {
        rawRol = 'Administrador';
        rawNombre = 'Fernanda Salinas'; // Le ponemos tu nombre real o un genérico
    }

    console.group("🔍 AUDITORÍA DE SESIÓN LOCAL");
    console.log("Valores crudos leídos del localStorage:");
    console.table({
        "nombre_recepcionista": rawNombre,
        "userRole": rawRol,
        "ID Usuario": rawId
    });
    console.groupEnd();

    // Asignación con los respaldos correctos
    const nombre = rawNombre || "Fernanda Salinas";
    const rol = rawRol || "Administrador";
    
    if (document.getElementById('userName')) document.getElementById('userName').innerText = nombre;
    if (document.getElementById('userRole')) document.getElementById('userRole').innerText = rol;

    // 🚪 ESCUCHADOR INTEGRADO PARA EL BOTÓN DE CERRAR SESIÓN
    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout) {
        // Removemos cualquier listener viejo clonando el nodo (por si acaso)
        const btnClonado = btnLogout.cloneNode(true);
        btnLogout.parentNode.replaceChild(btnClonado, btnLogout);

        // Agregamos la acción de limpieza total
        btnClonado.addEventListener('click', () => {
            console.log("🧹 Cerrando sesión y limpiando el sistema del Hotel Central...");
            localStorage.clear(); // Limpieza absoluta
            window.location.href = "index.html"; // Retorno al login
        });
    }
}

async function asegurarRecepcionistaEnTurnoActual() {
    if (!reporteActualId || estadoCajaActual !== 'A') return;

    const fechaFiltro = document.getElementById('filtroFechaReporte').value;
    const hoyRealEnPeru = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Lima' });

    // Si la caja sigue abierta pero ya cambió el día calendario, NO autoasignamos recepcionistas 
    // en este reporte viejo para no corromper la auditoría de turnos.
    if (fechaFiltro !== hoyRealEnPeru) {
        console.warn("⚠️ Auditoría: La caja del día anterior sigue abierta. No se asignarán recepcionistas nuevos hasta que se cierre.");
        return;
    }

    const horaPeru = parseInt(new Date().toLocaleTimeString('en-US', { 
        timeZone: 'America/Lima', 
        hour12: false, 
        hour: '2-digit' 
    }));

    let columnaTurno = '';
    
    if (horaPeru >= 7 && horaPeru < 14) {
        columnaTurno = 'recep_manana'; 
    } else if (horaPeru >= 14 && horaPeru < 21) {
        columnaTurno = 'recep_tarde';  
    } else {
        columnaTurno = 'recep_noche';  
    }

    const nombreUsuarioActivo = localStorage.getItem("nombre_recepcionista") || "Fernanda Salinas";

    try {
        const { error } = await supabase
            .from('reporte_diario')
            .update({ [columnaTurno]: nombreUsuarioActivo })
            .eq('id', reporteActualId)
            .is(columnaTurno, null); 

        if (error) throw error;
        
    } catch (err) {
        console.error("Error silencioso al asegurar recepcionista del turno:", err);
    }
}

// ==========================================
// 6. CONTROLADOR DE RELEVO DE TURNO INDEPENDIENTE
// ==========================================
window.abrirModalRelevoTurno = async function(turnoAEntregar) {
    if (!reporteActualId) return;

    const nombreUsuarioActivo = localStorage.getItem("nombre_recepcionista") || "Fernanda Salinas";
    const fechaFiltro = document.getElementById('filtroFechaReporte').value;

    // Recuperar el registro completo actual en tiempo real antes de abrir
    try {
        let { data: reporteRefrescado } = await supabase
            .from('reporte_diario')
            .select('*')
            .eq('id', reporteActualId)
            .single();

        // Determinar qué monto y qué observaciones tiene ya el turno en la BD
        let montoPrevio = 0;
        if (turnoAEntregar === 'Mañana') montoPrevio = reporteRefrescado.total_turno_manana || 0;
        if (turnoAEntregar === 'Tarde') montoPrevio = reporteRefrescado.total_turno_tarde || 0;
        if (turnoAEntregar === 'Noche') montoPrevio = reporteRefrescado.total_turno_noche || 0;

        Swal.fire({
            title: `📥 Entrega de Caja: Turno ${turnoAEntregar}`,
            html: `
                <div style="text-align: left; font-family: 'Lato', sans-serif; font-size: 14px; color: #334155;">
                    <p style="margin-bottom: 8px;"><b>Registrado por:</b> ${nombreUsuarioActivo}</p>
                    <p style="margin-bottom: 12px; color: #64748b;">Este valor guardará el dinero en efectivo exacto que le dejas físicamente al siguiente turno en gaveta.</p>
                    <hr style="border: 1px dashed #cbd5e1; margin-bottom: 15px;">
                    
                    <label style="display:block; margin-bottom: 6px; font-weight:700;">Efectivo Real Entregado (S/):</label>
                    <input type="number" id="monto-entrega-turno" class="swal2-input" placeholder="0.00" step="0.10" value="${montoPrevio > 0 ? montoPrevio : ''}" style="width: 85%; margin: 0 auto 15px auto; display:block; font-weight: bold; text-align: center;">
                    
                    <label style="display:block; margin-bottom: 6px; font-weight:700;">Novedades o Notas de Entrega:</label>
                    <textarea id="obs-entrega-turno" class="swal2-textarea" placeholder="Ej. Dejo S/ 50 en monedas, pendiente cobrar habitación 204..." style="width: 85%; margin: 0 auto; display:block; height: 80px; resize: none; font-size: 13px;"></textarea>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: '<i class="fa-solid fa-floppy-disk"></i> Guardar Relevo',
            confirmButtonColor: '#800020',
            cancelButtonText: 'Cancelar',
            preConfirm: () => {
                const monto = document.getElementById('monto-entrega-turno').value;
                const obs = document.getElementById('obs-entrega-turno').value;
                if (!monto || parseFloat(monto) < 0) {
                    Swal.showValidationMessage('Por favor, ingresa un monto físico válido mayor o igual a 0.');
                }
                return { monto: parseFloat(monto), observaciones: obs };
            }
        }).then(async (result) => {
            if (result.isConfirmed) {
                Swal.fire({ title: 'Procesando relevo...', didOpen: () => Swal.showLoading() });

                // Mapeo dinámico de la columna según el turno que se está gestionando
                let columnasAActualizar = {};
                if (turnoAEntregar === 'Mañana') {
                    columnasAActualizar.total_turno_manana = result.value.monto;
                    columnasAActualizar.recep_manana = nombreUsuarioActivo;
                } else if (turnoAEntregar === 'Tarde') {
                    columnasAActualizar.total_turno_tarde = result.value.monto;
                    columnasAActualizar.recep_tarde = nombreUsuarioActivo;
                } else if (turnoAEntregar === 'Noche') {
                    columnasAActualizar.total_turno_noche = result.value.monto;
                    columnasAActualizar.recep_noche = nombreUsuarioActivo;
                }

                // Guardar las notas del relevo en el campo de texto histórico de observaciones sin borrar lo anterior
                if (result.value.observaciones.trim() !== "") {
                    const notasAnteriores = reporteRefrescado.observaciones ? reporteRefrescado.observaciones + "\n" : "";
                    columnasAActualizar.observaciones = `${notasAnteriores}[Relevo ${turnoAEntregar} - ${nombreUsuarioActivo}]: ${result.value.observaciones}`;
                }

                // Actualizar Supabase
                const { error: updateError } = await supabase
                    .from('reporte_diario')
                    .update(columnasAActualizar)
                    .eq('id', reporteActualId);

                if (updateError) throw updateError;

                Swal.fire({
                    title: '¡Relevo Guardado!',
                    text: `Se registró que el turno ${turnoAEntregar} deja un total de S/ ${result.value.monto.toFixed(2)}`,
                    icon: 'success',
                    confirmButtonColor: '#800020'
                });

                // Recargar interfaz de inmediato
                cargarReportePorFecha(fechaFiltro);
            }
        });

    } catch (err) {
        console.error("Error en flujo de relevos:", err);
        Swal.fire('Error', 'No se pudo leer ni guardar la entrega de turno.', 'error');
    }
}