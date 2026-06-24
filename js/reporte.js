import { client as supabase } from './config.js';

// ==========================================
// VARIABLES DE ESTADO GLOBAL DEL REPORTE
// ==========================================
let fechaSeleccionada = '';
let turnoActual = 'Mañana';
let usuarioActivo = {
    id: null,
    nombres: 'Recepcionista'
};

// ==========================================
// INICIALIZACIÓN DE LA PÁGINA
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    calcularFechaYTurnoPeru();

    // Mostrar fecha legible en el header
    const txtCurrentDate = document.getElementById('current-date');
    if (txtCurrentDate) {
        const opciones = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        txtCurrentDate.innerText = new Date().toLocaleDateString('es-PE', opciones);
    }

    // Inicializar filtro de fecha
    const filtroFecha = document.getElementById('filtroFechaReporte');
    if (filtroFecha) {
        filtroFecha.value = fechaSeleccionada;
        filtroFecha.addEventListener('change', (e) => {
            fechaSeleccionada = e.target.value;
            cargarReporteCompleto();
        });
    }

    obtenerUsuarioSesion();
    configurarEventosTarjetasCaja(); // Nueva inicialización de listeners en la vista
    await cargarReporteCompleto();

    // --- ASIGNACIÓN DE EVENTOS GENERALES ---
    const btnMaestro = document.getElementById('btnAccionReporteMaestro');
    if (btnMaestro) btnMaestro.addEventListener('click', gestionarReporteMaestro);

    const btnAbrirTurno = document.getElementById('btnAccionReporteDiario');
    if (btnAbrirTurno) btnAbrirTurno.addEventListener('click', modalControlTurnoCaja);

    const btnEgreso = document.getElementById('btnRegistrarEgreso');
    if (btnEgreso) btnEgreso.addEventListener('click', registrarEgreso);

    const btnOcurrencia = document.getElementById('btnAgregarOcurrencia');
    if (btnOcurrencia) btnOcurrencia.addEventListener('click', registrarOcurrenciaBitacora);
});

async function cargarReporteCompleto() {
    await renderizarKPISyPagos();
    await renderizarCajaTurnos();
    await renderizarEgresos();
    await renderizarOcurrencias(); 
}

// ==========================================
// CONTROL DE TIEMPO (ZONA HORARIA PERÚ)
// ==========================================
function calcularFechaYTurnoPeru() {
    const ahora = new Date();
    const horaPeru = parseInt(ahora.toLocaleTimeString('en-US', { timeZone: 'America/Lima', hour12: false, hour: '2-digit' }));
    const formateadorFecha = new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' });

    fechaSeleccionada = formateadorFecha.format(ahora);

    if (horaPeru >= 7 && horaPeru < 14) {
        turnoActual = 'Mañana';
    } else if (horaPeru >= 14 && horaPeru < 22) {
        turnoActual = 'Tarde';
    } else {
        turnoActual = 'Noche';
        if (horaPeru >= 0 && horaPeru < 7) {
            const milisegundosEnUnDia = 24 * 60 * 60 * 1000;
            const ayer = new Date(ahora.getTime() - milisegundosEnUnDia);
            fechaSeleccionada = formateadorFecha.format(ayer);
        }
    }
}

function obtenerUsuarioSesion() {
    usuarioActivo.id = localStorage.getItem("id_usuario_logueado") || "TU_UUID_REAL_DE_USUARIO_DE_SUPABASE"; 
    usuarioActivo.nombres = localStorage.getItem("nombre_recepcionista") || "Recepcionista";
    const rolUsuario = localStorage.getItem("rol_usuario") || "Recepcionista";

    console.log("%c=== CONTROL DE SESIÓN ACTIVA ===", "color: #800020; font-weight: bold; font-size: 12px;");
    console.log(`👤 Usuario ID: ${usuarioActivo.id}`);
    console.log(`📛 Nombre:     ${usuarioActivo.nombres}`);
    console.log(`💼 Rol:        ${rolUsuario}`);
    console.log(`⏰ Turno Temp: ${turnoActual}`);
    console.log("=================================");

    const elName = document.getElementById('userName');
    const elRole = document.getElementById('userRole');
    
    if (elName) elName.innerText = usuarioActivo.nombres;
    if (elRole) elRole.innerText = rolUsuario;
}

// ==========================================
// 🛠️ ESCUCHAS EN VIVO PARA LAS TARJETAS (NUEVO)
// ==========================================
function configurarEventosTarjetasCaja() {
    // Monitorear entradas del teclado en los inputs físicos de cada tarjeta
    document.querySelectorAll('.input-fisico-real').forEach(input => {
        input.addEventListener('input', (e) => {
            const card = e.target.closest('.shift-card');
            calcularDiferenciaEnVivo(card);
        });
    });

    // Delegación para botones de cierre interno por tarjeta
    document.querySelectorAll('.btnCerrarTurno').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const turno = e.target.closest('.btnCerrarTurno').dataset.turno;
            cerrarTurnoDesdeTarjeta(turno);
        });
    });
}

// ==========================================
// 💼 LÓGICA REPORTE MAESTRO (DÍA GENERAL)
// ==========================================
async function gestionarReporteMaestro() {
    const { data: reporte } = await supabase
        .from('reporte_diario')
        .select('*')
        .eq('fecha_reporte', fechaSeleccionada)
        .maybeSingle();

    if (!reporte) {
        let saldoInicialMaestroSugerido = 0;
        const { data: ultimoReporteMaestro } = await supabase
            .from('reporte_diario')
            .select('efectivo_fisico_real')
            .eq('estado', 'C')
            .order('fecha_reporte', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (ultimoReporteMaestro && ultimoReporteMaestro.efectivo_fisico_real) {
            saldoInicialMaestroSugerido = ultimoReporteMaestro.efectivo_fisico_real;
        }

        const { value: formValues } = await Swal.fire({
            title: 'Abrir Reporte Diario Maestro',
            html: `
                <div style="text-align: left; font-size: 14px; line-height: 2;">
                    <p><b>Responsable:</b> ${usuarioActivo.nombres}</p>
                    <p><b>Fecha Hotelera General:</b> <span style="background: #e9ecef; padding: 2px 8px; border-radius: 4px;">${fechaSeleccionada}</span></p>
                    <p style="color: #6c757d; font-size: 12px; margin-top: 4px;">
                        <i class="fa-solid fa-info-circle"></i> Saldo base en efectivo heredado del día anterior: <b>S/ ${saldoInicialMaestroSugerido.toFixed(2)}</b>
                    </p>
                    <hr>
                    <label for="swal-monto-maestro"><b>Monto Inicial Base del Día (S/):</b></label>
                    <input id="swal-monto-maestro" type="number" class="swal2-input" placeholder="0.00" value="${saldoInicialMaestroSugerido.toFixed(2)}" step="0.10">
                </div>
            `,
            showCancelButton: true,
            confirmButtonColor: '#800020',
            confirmButtonText: 'Iniciar Día Hotelero',
            cancelButtonText: 'Cancelar',
            preConfirm: () => {
                const monto = parseFloat(document.getElementById('swal-monto-maestro').value);
                if (isNaN(monto) || monto < 0) {
                    Swal.showValidationMessage('Por favor, ingresa un monto inicial base válido.');
                    return false;
                }
                return monto;
            }
        });

        if (formValues !== undefined) {
            const { error } = await supabase.from('reporte_diario').insert([{
                fecha_reporte: fechaSeleccionada,
                monto_apertura: formValues,
                estado: 'A',
                id_usuario_apertura: usuarioActivo.id,
                nombre_apertura: usuarioActivo.nombres
            }]);
            
            if (error) return Swal.fire('Error', 'No se pudo abrir el reporte diario maestro.', 'error');
            Swal.fire('Éxito', '¡Día hotelero inicializado correctamente!', 'success');
            await cargarReporteCompleto();
        }
    } 
    else {
        if (reporte.estado === 'C') {
            return Swal.fire('Aviso', 'El reporte maestro de este día ya se encuentra cerrado de manera definitiva.', 'info');
        }

        const { value: arqueoMaestro } = await Swal.fire({
            title: 'Cerrar Reporte Diario Maestro',
            html: `
                <div style="text-align: left; font-size: 14px; line-height: 2;">
                    <p><b>Monto de Apertura:</b> S/ ${reporte.monto_apertura.toFixed(2)}</p>
                    <p><b>Ingresos Totales en Efectivo:</b> S/ ${reporte.total_efectivo.toFixed(2)}</p>
                    <p><b>Gastos / Egresos Realizados:</b> <span style="color: #b22222;">- S/ ${reporte.total_egresos_efectivo.toFixed(2)}</span></p>
                    <hr>
                    <label for="swal-fisico-maestro"><b>Efectivo Físico Real Total en Bóveda/Caja Central (S/):</b></label>
                    <input id="swal-fisico-maestro" type="number" class="swal2-input" placeholder="0.00" step="0.10">
                    <br><br>
                    <label for="swal-obs-maestro"><b>Observaciones / Notas de Cierre:</b></label>
                    <textarea id="swal-obs-maestro" class="swal2-textarea" style="margin-top:5px;" placeholder="Detalles de descuadres, incidencias..."></textarea>
                </div>
            `,
            showCancelButton: true,
            confirmButtonColor: '#d4a017',
            confirmButtonText: 'Efectuar Arqueo General y Cerrar',
            cancelButtonText: 'Regresar',
            preConfirm: () => {
                const montoFisico = parseFloat(document.getElementById('swal-fisico-maestro').value);
                const obs = document.getElementById('swal-obs-maestro').value.trim();
                if (isNaN(montoFisico) || montoFisico < 0) {
                    Swal.showValidationMessage('Por favor, ingresa el efectivo total contado.');
                    return false;
                }
                return { montoFisico, obs };
            }
        });

        if (arqueoMaestro !== undefined) {
            const { error } = await supabase
                .from('reporte_diario')
                .update({ 
                    estado: 'C',
                    efectivo_fisico_real: arqueoMaestro.montoFisico,
                    observaciones: arqueoMaestro.obs,
                    hora_cierre: new Date().toISOString(),
                    id_usuario_cierre: usuarioActivo.id,
                    nombre_cierre: usuarioActivo.nombres
                })
                .eq('fecha_reporte', fechaSeleccionada);
            
            if (error) return Swal.fire('Error', 'No se pudo cerrar el reporte maestro.', 'error');
            Swal.fire('Día Cerrado', 'La contabilidad general ha sido archivada y bloqueada.', 'success');
            await cargarReporteCompleto();
        }
    }
}

// ==========================================
// 🕒 MODAL CONTROL SUPERIOR: APERTURA DINÁMICA
// ==========================================
async function modalControlTurnoCaja() {
    const { data: reporteMaestro } = await supabase
        .from('reporte_diario')
        .select('*')
        .eq('fecha_reporte', fechaSeleccionada)
        .maybeSingle();

    if (!reporteMaestro || reporteMaestro.estado === 'C') {
        return Swal.fire('Bloqueado', 'Debe abrir primero el Reporte Diario Maestro antes de gestionar turnos de caja.', 'warning');
    }

    const { data: turnosHoy } = await supabase
        .from('caja_turnos')
        .select('*')
        .eq('fecha', fechaSeleccionada);

    // Si el turno actual ya existe y está abierto, redirigir directo al modal de cierre
    const turnoExistente = turnosHoy?.find(t => t.turno === turnoActual);
    if (turnoExistente) {
        if (turnoExistente.estado === 'A') {
            return ejecutarArqueoCierreSuperior(turnoExistente);
        } else {
            return Swal.fire('Turno Completado', `El turno de la ${turnoActual} ya está cerrado de manera definitiva.`, 'info');
        }
    }

    // Verificar que no existan otros turnos en estado Abierto en este momento
    if (turnosHoy && turnosHoy.some(t => t.estado === 'A')) {
        return Swal.fire('Error', 'Ya existe un turno activo en el sistema. Debe cerrarse antes de proceder.', 'warning');
    }

    // Calcular Arrastre Dinámico basado en la tarjeta HTML del turno previo
    let montoArraigadoSugerido = 0.00;
    const turnosOrdenados = ['Mañana', 'Tarde', 'Noche'];
    const idx = turnosOrdenados.indexOf(turnoActual);

    if (turnoActual === 'Mañana') {
        montoArraigadoSugerido = 100.00; // Base profesional por defecto
    } else if (idx > 0) {
        const turnoAnterior = turnosOrdenados[idx - 1];
        const cardAnterior = document.getElementById(`card-${turnoAnterior}`);
        if (cardAnterior) {
            montoArraigadoSugerido = Number(cardAnterior.querySelector('.input-fisico-real').value || 0);
        }
    }

    const { value: montoApertura } = await Swal.fire({
        title: `Apertura de Caja Chica`,
        html: `
            <div style="text-align: left; font-size: 14px; line-height: 2;">
                <p><b>Recepcionista:</b> ${usuarioActivo.nombres}</p>
                <p><b>Turno a asignar:</b> <span style="background: #e9ecef; padding: 2px 8px; border-radius: 4px;">${turnoActual}</span></p>
                <p style="color: #6c757d; font-size: 12px; margin-top: 4px;">
                    <i class="fa-solid fa-info-circle"></i> Saldo heredado/estimado: <b>S/ ${montoArraigadoSugerido.toFixed(2)}</b>
                </p>
                <hr>
                <label for="swal-monto-apertura"><b>Monto Inicial en Caja Chica (S/):</b></label>
                <input id="swal-monto-apertura" type="number" class="swal2-input" value="${montoArraigadoSugerido.toFixed(2)}" step="0.10">
            </div>
        `,
        showCancelButton: true,
        confirmButtonColor: '#800020',
        confirmButtonText: 'Abrir Turno',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            const monto = parseFloat(document.getElementById('swal-monto-apertura').value);
            if (isNaN(monto) || monto < 0) {
                Swal.showValidationMessage('Introduce un monto inicial válido.');
                return false;
            }
            return monto;
        }
    });

    if (montoApertura !== undefined) {
        const { error } = await supabase.from('caja_turnos').insert([{
            fecha: fechaSeleccionada,
            turno: turnoActual,
            id_usuario: usuarioActivo.id,
            monto_apertura: montoApertura,
            ingresos_efectivo: 0.00,
            egresos_efectivo: 0.00,
            efectivo_real_entregado: 0.00,
            estado: 'A'
        }]);

        if (error) return Swal.fire('Error', 'No se pudo abrir el turno.', 'error');
        Swal.fire('¡Turno Abierto!', `Caja inicializada con S/ ${montoApertura.toFixed(2)}.`, 'success');
        await cargarReporteCompleto();
    }
}

// Cierre gatillado desde el botón superior del Header
async function ejecutarArqueoCierreSuperior(turnoData) {
    const card = document.getElementById(`card-${turnoData.turno}`);
    const esperadoSujeto = card ? Number(card.querySelector('.txt-esperado').innerText.replace(/[^0-9.-]+/g,"")) : turnoData.efectivo_esperado;

    const { value: efectivoReal } = await Swal.fire({
        title: `Cierre de Caja - ${turnoData.turno}`,
        html: `
            <div style="text-align: left; font-size: 14px; line-height: 2;">
                <p><b>Monto Esperado en Sistema:</b> <b>S/ ${esperadoSujeto.toFixed(2)}</b></p>
                <hr>
                <label for="swal-monto-cierre"><b>Efectivo Físico Neto Contado (S/):</b></label>
                <input id="swal-monto-cierre" type="number" class="swal2-input" placeholder="0.00" step="0.10">
            </div>
        `,
        showCancelButton: true,
        confirmButtonColor: '#d4a017',
        confirmButtonText: 'Efectuar Arqueo y Cerrar',
        preConfirm: () => {
            const monto = parseFloat(document.getElementById('swal-monto-cierre').value);
            if (isNaN(monto) || monto < 0) {
                Swal.showValidationMessage('Debe ingresar un monto válido.');
                return false;
            }
            return monto;
        }
    });

    if (efectivoReal !== undefined) {
        await procesarCierreBaseDatos(turnoData.turno, efectivoReal);
    }
}

// Cierre gatillado directamente desde la tarjeta física en el grid
async function cerrarTurnoDesdeTarjeta(turno) {
    const card = document.getElementById(`card-${turno}`);
    const inputReal = card.querySelector('.input-fisico-real');
    
    if (inputReal.value === "") {
        Swal.fire('Atención', 'Por favor, ingresa el conteo físico real en la tarjeta antes de procesar el cierre.', 'info');
        return;
    }

    const efectivoReal = Number(inputReal.value || 0);
    await procesarCierreBaseDatos(turno, efectivoReal);
}

async function procesarCierreBaseDatos(turno, efectivoReal) {
    const card = document.getElementById(`card-${turno}`);
    const ingresos = card ? Number(card.querySelector('.txt-ingresos').innerText.replace(/[^0-9.-]+/g,"")) : 0;
    const egresos = card ? Number(card.querySelector('.txt-egresos').innerText.replace(/[^0-9.-]+/g,"")) : 0;

    const { error } = await supabase
        .from('caja_turnos')
        .update({
            ingresos_efectivo: ingresos,
            egresos_efectivo: egresos,
            efectivo_real_entregado: efectivoReal,
            estado: 'C'
        })
        .eq('fecha', fechaSeleccionada)
        .eq('turno', turno);

    if (error) return Swal.fire('Error', 'No se pudo guardar el arqueo.', 'error');
    Swal.fire('Turno Finalizado', `El turno de la ${turno} ha sido cerrado exitosamente.`, 'success');
    await cargarReporteCompleto();
}

// ==========================================
// 🎨 CORE UNIFICADO: RENDERS VISUALES DE TARJETAS
// ==========================================
async function renderizarCajaTurnos() {
    const turnosDisponibles = ['Mañana', 'Tarde', 'Noche'];
    
    // 1. Obtener cierres explícitos de la tabla caja_turnos
    const { data: turnosGuardados } = await supabase
        .from('caja_turnos')
        .select('*, usuario')
        .eq('fecha', fechaSeleccionada);

    // 2. Obtener sumatorias financieras reales en tiempo de ejecución de las tablas transaccionales
    const { data: pagosEfectivo } = await supabase
        .from('pagos')
        .select('monto_soles, turno')
        .eq('fecha_pago', fechaSeleccionada)
        .eq('metodo_pago', 'Efectivo');

    const { data: egresosCaja } = await supabase
        .from('egresos')
        .select('monto, turno')
        .eq('fecha_egreso', fechaSeleccionada);

    const mapaTurnos = { 'Mañana': null, 'Tarde': null, 'Noche': null };
    turnosGuardados?.forEach(t => { mapaTurnos[t.turno] = t; });

    // Iterar en orden secuencial hotelero estricto para encadenar las cajas iniciales
    for (let i = 0; i < turnosDisponibles.length; i++) {
        const turnoLista = turnosDisponibles[i];
        const card = document.getElementById(`card-${turnoLista}`);
        if (!card) continue;

        const datosTurno = mapaTurnos[turnoLista];

        const ingresosTurno = (pagosEfectivo || [])
            .filter(p => p.turno === turnoLista)
            .reduce((sum, p) => sum + Number(p.monto_soles || 0), 0);

        const egresosTurno = (egresosCaja || [])
            .filter(e => e.turno === turnoLista)
            .reduce((sum, e) => sum + Number(e.monto || 0), 0);

        let cajaInicial = 0;
        if (turnoLista === 'Mañana') {
            cajaInicial = datosTurno ? Number(datosTurno.monto_apertura) : 100.00;
        } else {
            const turnoAnterior = turnosDisponibles[i - 1];
            const datosAnterior = mapaTurnos[turnoAnterior];
            cajaInicial = datosAnterior ? Number(datosAnterior.efectivo_real_entregado) : 0.00;
        }

        const efectivoEsperado = (cajaInicial + ingresosTurno) - egresosTurno;

        // Inyectar datos financieros en los elementos hijos de la tarjeta
        card.querySelector('.txt-apertura').innerText = `S/ ${cajaInicial.toFixed(2)}`;
        card.querySelector('.txt-ingresos').innerText = `+ S/ ${ingresosTurno.toFixed(2)}`;
        card.querySelector('.txt-egresos').innerText = `- S/ ${egresosTurno.toFixed(2)}`;
        card.querySelector('.txt-esperado').innerText = `S/ ${efectivoEsperado.toFixed(2)}`;

        const badge = card.querySelector('.status-badge');
        const inputFisico = card.querySelector('.input-fisico-real');
        const btnCerrar = card.querySelector('.btnCerrarTurno');

        if (datosTurno) {
            card.querySelector('.recep-name').innerText = datosTurno.usuarios?.nombre_completo || usuarioActivo.nombres;
            
            if (datosTurno.estado === 'A') {
                badge.innerText = "Abierto";
                badge.className = "badge badge-success";
                inputFisico.disabled = false;
                btnCerrar.disabled = false;
            } else {
                badge.innerText = "Cerrado";
                badge.className = "badge badge-muted";
                inputFisico.value = datosTurno.efectivo_real_entregado;
                inputFisico.disabled = true;
                btnCerrar.disabled = true;
                calcularDiferenciaEnVivo(card);
            }
        } else {
            card.querySelector('.recep-name').innerText = "-";
            badge.innerText = "Cerrado";
            badge.className = "badge badge-muted";
            inputFisico.value = "";
            inputFisico.disabled = true;
            btnCerrar.disabled = true;
            resetearEstilosTarjeta(turnoLista);
        }
    }

    // --- MANEJO DEL BOTÓN MAESTRO DEL HEADER SUPERIOR ---
    const btnAbrirTurnoGlobal = document.getElementById('btnAccionReporteDiario');
    if (btnAbrirTurnoGlobal) {
        const turnoActualData = mapaTurnos[turnoActual];
        if (!turnoActualData) {
            btnAbrirTurnoGlobal.innerHTML = `<i class="fa-solid fa-door-open"></i> Abrir Turno: ${turnoActual}`;
            btnAbrirTurnoGlobal.className = "btn-action-primary";
        } else if (turnoActualData.estado === 'A') {
            btnAbrirTurnoGlobal.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i> Cerrar Turno`;
            btnAbrirTurnoGlobal.className = "btn-action-warning";
        } else {
            btnAbrirTurnoGlobal.innerHTML = `<i class="fa-solid fa-lock"></i> Turno ${turnoActual} Cerrado`;
            btnAbrirTurnoGlobal.className = "btn-action-muted";
        }
    }
}

function calcularDiferenciaEnVivo(card) {
    const esperado = Number(card.querySelector('.txt-esperado').innerText.replace(/[^0-9.-]+/g,""));
    const real = Number(card.querySelector('.input-fisico-real').value || 0);
    const diferencia = real - esperado;

    const txtDiff = card.querySelector('.txt-diferencia');
    const boxDiff = card.querySelector('.text-diff-box');

    if (!txtDiff || !boxDiff) return;

    txtDiff.innerText = `S/ ${diferencia.toFixed(2)}`;

    if (diferencia === 0) {
        boxDiff.className = "diff-indicator status-exact text-diff-box";
        boxDiff.style.backgroundColor = "";
        txtDiff.style.color = "";
    } else if (diferencia > 0) {
        boxDiff.className = "diff-indicator text-diff-box";
        boxDiff.style.backgroundColor = "rgba(46, 125, 50, 0.15)";
        txtDiff.style.color = "#2e7d32";
    } else {
        boxDiff.className = "diff-indicator text-diff-box";
        boxDiff.style.backgroundColor = "rgba(198, 40, 40, 0.15)";
        txtDiff.style.color = "#c62828";
    }
}

function resetearEstilosTarjeta(turno) {
    const card = document.getElementById(`card-${turno}`);
    if (card) {
        const boxDiff = card.querySelector('.text-diff-box');
        const txtDiff = card.querySelector('.txt-diferencia');
        if (boxDiff) boxDiff.style.backgroundColor = "";
        if (txtDiff) {
            txtDiff.style.color = "";
            txtDiff.innerText = "S/ 0.00";
        }
    }
}

// ==========================================
// RENDERS VISUALES AUXILIARES (KPIS Y EGRESOS)
// ==========================================
async function renderizarKPISyPagos() {
    const reporte = await supabase.from('reporte_diario').select('*').eq('fecha_reporte', fechaSeleccionada).maybeSingle();
    const totalIngresosEl = document.getElementById('total_ingresos_sistema');
    const lblEstado = document.getElementById('lbl-estado-caja');
    const btnMaestro = document.getElementById('btnAccionReporteMaestro');

    if (!reporte.data) {
        if (totalIngresosEl) totalIngresosEl.innerText = 'S/ 0.00';
        if (lblEstado) {
            lblEstado.innerText = 'REPORTE DE HOY: NO ABIERTO';
            lblEstado.className = 'status-indicator closed';
        }
        if (btnMaestro) btnMaestro.innerHTML = `<i class="fa-solid fa-folder"></i> Reporte Diario: CERRADO`;
        resetearValoresCero();
        return;
    }

    const repData = reporte.data;
    if (lblEstado) {
        if (repData.estado === 'A') {
            lblEstado.innerText = 'REPORTE DE HOY: ABIERTO';
            lblEstado.className = 'status-indicator open';
            if (btnMaestro) {
                btnMaestro.innerHTML = `<i class="fa-solid fa-folder-open"></i> Reporte Diario: ABIERTO`;
                btnMaestro.style.backgroundColor = '#2e7d32';
                btnMaestro.style.color = '#ffffff';
            }
        } else {
            lblEstado.innerText = 'REPORTE DE HOY: CERRADO';
            lblEstado.className = 'status-indicator closed';
            if (btnMaestro) {
                btnMaestro.innerHTML = `<i class="fa-solid fa-folder"></i> Reporte Diario: CERRADO`;
                btnMaestro.style.backgroundColor = '#c62828';
                btnMaestro.style.color = '#ffffff';
            }
        }
    }

    const { data: listaPagos } = await supabase.from('pagos').select('monto_soles').eq('fecha_pago', fechaSeleccionada);
    const sumaVentasHoy = listaPagos?.reduce((acum, p) => acum + Number(p.monto_soles || 0), 0) || 0;
    if (totalIngresosEl) totalIngresosEl.innerText = `S/ ${sumaVentasHoy.toFixed(2)}`;

    const { data: desglosePagos } = await supabase.from('pagos').select('monto_recibido, monto_soles, moneda, metodo_pago').eq('fecha_pago', fechaSeleccionada);
    let totalEfectivo = 0, totalYape = 0, totalTransferencia = 0, totalTarjeta = 0, totalDolares = 0;

    desglosePagos?.forEach(pago => {
        if (pago.moneda === 'USD') totalDolares += Number(pago.monto_recibido || 0);
        else {
            if (pago.metodo_pago === 'Efectivo') totalEfectivo += Number(pago.monto_soles || 0);
            else if (pago.metodo_pago === 'Yape') totalYape += Number(pago.monto_soles || 0);
            else if (pago.metodo_pago === 'Transferencia') totalTransferencia += Number(pago.monto_soles || 0);
            else if (pago.metodo_pago === 'Tarjeta') totalTarjeta += Number(pago.monto_soles || 0);
        }
    });

    asignarTextoPorId('total_efectivo', `S/ ${totalEfectivo.toFixed(2)}`);
    asignarTextoPorId('total_yape', `S/ ${totalYape.toFixed(2)}`);
    asignarTextoPorId('total_transferencia', `S/ ${totalTransferencia.toFixed(2)}`);
    asignarTextoPorId('total_tarjeta', `S/ ${totalTarjeta.toFixed(2)}`);
    asignarTextoPorId('total_usd_en_soles', `$ ${totalDolares.toFixed(2)}`);

    const checkins = await supabase.from('reservas').select('*', { count: 'exact', head: true }).eq('check_in_fecha', fechaSeleccionada).in('estado_reserva', ['En Curso', 'Finalizada']);
    asignarTextoPorId('num_checkins', checkins.count || 0);

    const checkouts = await supabase.from('reservas').select('*', { count: 'exact', head: true }).eq('check_out_fecha', fechaSeleccionada).eq('estado_reserva', 'Finalizada');
    asignarTextoPorId('num_checkouts', checkouts.count || 0);

    const nuevas = await supabase.from('reservas').select('*', { count: 'exact', head: true }).gte('created_at', `${fechaSeleccionada}T00:00:00.000Z`).lte('created_at', `${fechaSeleccionada}T23:59:59.999Z`);
    asignarTextoPorId('num_reservas_nuevas', nuevas.count || 0);
}
// ==========================================
// 🛡️ VALIDADOR DE BLOQUEO GENERAL (NUEVO)
// ==========================================
async function verificarEstadoReporteMaestro() {
    const { data: reporte } = await supabase
        .from('reporte_diario')
        .select('estado')
        .eq('fecha_reporte', fechaSeleccionada)
        .maybeSingle();

    const estaAbierto = (reporte && reporte.estado === 'A');

    // Deshabilitar o habilitar textareas de ocurrencias
    document.querySelectorAll('.textarea-log').forEach(tx => {
        tx.disabled = !estaAbierto;
        if (!estaAbierto) {
            tx.placeholder = "🔒 Reporte cerrado o no inicializado. Bloqueado.";
        } else {
            const turnoCol = tx.closest('.log-column').querySelector('h6').innerText;
            tx.placeholder = `Escribe una ocurrencia para el turno ${turnoCol.toLowerCase()}...`;
        }
    });

    // Deshabilitar botones de acción si no está abierto
    const btnEgreso = document.getElementById('btnRegistrarEgreso');
    const btnOcurrencia = document.getElementById('btnAgregarOcurrencia');
    
    if (btnEgreso) btnEgreso.disabled = !estaAbierto;
    if (btnOcurrencia) btnOcurrencia.disabled = !estaAbierto;

    return estaAbierto;
}

// ==========================================
// 💸 GESTIÓN DE EGRESOS (MÉTODO MEJORADO)
// ==========================================
async function registrarEgreso() {
    const reporteAbierto = await verificarEstadoReporteMaestro();
    if (!reporteAbierto) {
        return Swal.fire('Bloqueado', 'No puedes registrar egresos si el Reporte Maestro está cerrado o no ha sido abierto.', 'warning');
    }

    const { value: formValues } = await Swal.fire({
        title: 'Registrar Egreso de Caja Chica',
        html: `
            <input id="swal-concepto" class="swal2-input" placeholder="Concepto (ej. Lavandería, Compras)">
            <input id="swal-monto" type="number" step="0.01" class="swal2-input" placeholder="Monto S/">
        `,
        showCancelButton: true,
        confirmButtonText: 'Guardar Egreso',
        confirmButtonColor: '#800020',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            const concepto = document.getElementById('swal-concepto').value.trim();
            const monto = parseFloat(document.getElementById('swal-monto').value);
            if (!concepto || isNaN(monto) || monto <= 0) {
                Swal.showValidationMessage('Introduzca un concepto y un monto válido mayor a 0');
                return false;
            }
            return { concepto, monto };
        }
    });

    if (formValues) {
        const { error } = await supabase.from('egresos').insert([{
            id_usuario: usuarioActivo.id,
            turno: turnoActual,
            monto: formValues.monto,
            concepto: formValues.concepto,
            fecha_egreso: fechaSeleccionada
        }]);

        if (error) return Swal.fire('Error', 'No se pudo guardar el egreso.', 'error');
        
        Swal.fire('Éxito', 'Egreso añadido correctamente.', 'success');
        await cargarReporteCompleto();
    }
}

async function renderizarEgresos() {
    const wrapper = document.getElementById('listaEgresosDinamica');
    if (!wrapper) return;
    wrapper.innerHTML = '';

    const { data: egresos } = await supabase
        .from('egresos')
        .select('*')
        .eq('fecha_egreso', fechaSeleccionada)
        .order('created_at', { ascending: true });

    if (!egresos || egresos.length === 0) {
        wrapper.innerHTML = '<p class="empty-notes" style="text-align:center; padding:10px;">Sin egresos registrados hoy</p>';
        return;
    }

    egresos.forEach(eg => {
        const row = document.createElement('div');
        row.className = 'expense-row-item';
        row.innerHTML = `
            <span class="expense-concept">${eg.concepto} <small style="color:#6c757d;">(${eg.turno})</small></span>
            <span class="expense-val">- S/ ${eg.monto.toFixed(2)}</span>
        `;
        wrapper.appendChild(row);
    });
}

// ==========================================
// 📝 GESTIÓN DE OCURRENCIAS Y BITÁCORA (NUEVO)
// ==========================================
async function registrarOcurrenciaBitacora() {
    const reporteAbierto = await verificarEstadoReporteMaestro();
    if (!reporteAbierto) {
        return Swal.fire('Bloqueado', 'El reporte no se encuentra activo.', 'warning');
    }

    // Buscaremos qué textarea de qué columna tiene texto actualmente escrito
    let textoDetectado = '';
    let turnoDestino = '';
    let textareaObjetivo = null;

    const columnas = [
        { selector: '#columna-notas-manana', turno: 'Mañana' },
        { selector: '#columna-notas-tarde', turno: 'Tarde' },
        { selector: '#columna-notas-noche', turno: 'Noche' }
    ];

    for (const col of columnas) {
        const parent = document.querySelector(col.selector)?.closest('.log-column');
        const tx = parent?.querySelector('.textarea-log');
        if (tx && tx.value.trim() !== '') {
            textoDetectado = tx.value.trim();
            turnoDestino = col.turno;
            textareaObjetivo = tx;
            break; 
        }
    }

    if (!textoDetectado) {
        return Swal.fire('Nota vacía', 'Por favor, escribe una ocurrencia en el cuadro de texto del turno correspondiente.', 'info');
    }

    const { error } = await supabase.from('ocurrencias').insert([{
        fecha: fechaSeleccionada,
        turno: turnoDestino,
        usuario_id: usuarioActivo.id !== "TU_UUID_REAL_DE_USUARIO_DE_SUPABASE" ? usuarioActivo.id : null, 
        usuario_nombre: usuarioActivo.nombres,
        descripcion: textoDetectado
    }]);

    if (error) {
        console.error(error);
        return Swal.fire('Error', 'No se pudo guardar la nota en la bitácora.', 'error');
    }

    textareaObjetivo.value = ''; // Limpiar el campo
    Swal.fire('Guardado', `Ocurrencia añadida al turno ${turnoDestino}.`, 'success');
    await renderizarOcurrencias();
}

async function renderizarOcurrencias() {
    const wrappers = {
        'Mañana': document.getElementById('columna-notas-manana'),
        'Tarde': document.getElementById('columna-notas-tarde'),
        'Noche': document.getElementById('columna-notas-noche')
    };

    // Limpiar contenedores
    Object.values(wrappers).forEach(el => { if (el) el.innerHTML = ''; });

    const { data: ocurrencias, error } = await supabase
        .from('ocurrencias')
        .select('*')
        .eq('fecha', fechaSeleccionada)
        .order('creado_at', { ascending: true });

    if (error) return;

    // Clasificar y renderizar en su columna respectiva utilizando tu diseño CSS (.toast-note)
    const contadores = { 'Mañana': 0, 'Tarde': 0, 'Noche': 0 };

    ocurrencias?.forEach(oc => {
        const wrapper = wrappers[oc.turno];
        if (wrapper) {
            contadores[oc.turno]++;
            
            // Formatear hora de creación de manera legible (hh:mm a.m./p.m.)
            const horaFormateada = oc.creado_at 
                ? new Date(oc.creado_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: true })
                : '--:--';

            const notaDiv = document.createElement('div');
            notaDiv.className = 'toast-note';
            notaDiv.innerHTML = `
                <span class="toast-meta">${horaFormateada} — ${oc.usuario_nombre || 'Recepcionista'}</span>
                <p class="toast-desc">${oc.descripcion}</p>
            `;
            wrapper.appendChild(notaDiv);
        }
    });

    // Poner aviso de vacío si no hay notas en la columna
    Object.keys(wrappers).forEach(turno => {
        if (contadores[turno] === 0 && wrappers[turno]) {
            wrappers[turno].innerHTML = '<p class="empty-notes">Sin ocurrencias registradas</p>';
        }
    });
}

function resetearValoresCero() {
    ['num_checkins', 'num_checkouts', 'num_reservas_nuevas'].forEach(id => asignarTextoPorId(id, '0'));
}

function asignarTextoPorId(id, texto) {
    const el = document.getElementById(id);
    if (el) el.innerText = texto;
}