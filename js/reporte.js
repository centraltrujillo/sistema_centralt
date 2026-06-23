import { supabase } from './config.js';

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
    // 1. Calcular Fecha Hotelera y Turno según la Hora de Perú (Regla de Negocio)
    calcularFechaYTurnoPeru();

    // 2. Inicializar el Input de Filtro de Fecha con la Fecha Calculada
    const filtroFecha = document.getElementById('filtroFechaReporte');
    if (filtroFecha) {
        filtroFecha.value = fechaSeleccionada;
        // Escuchar cambios manuales en el filtro de fecha
        filtroFecha.addEventListener('change', (e) => {
            fechaSeleccionada = e.target.value;
            cargarReporteCompleto();
        });
    }

    // 3. Recuperar e inicializar datos del Usuario en Sesión
    obtenerUsuarioSesion();

    // 4. Cargar toda la data de las tablas de Supabase
    await cargarReporteCompleto();

    // 5. Asignar Eventos a los Botones de Acción
    const btnEgreso = document.getElementById('btnRegistrarEgreso');
    if (btnEgreso) btnEgreso.addEventListener('click', registrarEgreso);

    const btnOcurrencia = document.getElementById('btnAgregarOcurrencia');
    if (btnOcurrencia) btnOcurrencia.addEventListener('click', guardarOcurrencia);
});

// ==========================================
// FUNCIÓN CENTRAL DE CARGA
// ==========================================
async function cargarReporteCompleto() {
    console.log(`Cargando reporte para la fecha: ${fechaSeleccionada} - Turno actual: ${turnoActual}`);
    await renderizarKPISyPagos();
    await renderizarCajaTurnos();
    await renderizarEgresos();
    await renderizarOcurrencias();
}

// ==========================================
// LÓGICA DE CONTROL DE TIEMPO (ZONA HORARIA PERÚ)
// ==========================================
function calcularFechaYTurnoPeru() {
    const ahora = new Date();
    // Obtener la hora exacta de Perú en formato 24H (00 a 23)
    const horaPeru = parseInt(ahora.toLocaleTimeString('en-US', { timeZone: 'America/Lima', hour12: false, hour: '2-digit' }));
    // Formateador de fecha compatible con los inputs type="date" (YYYY-MM-DD)
    const formateadorFecha = new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' });

    fechaSeleccionada = formateadorFecha.format(ahora);

    if (horaPeru >= 7 && horaPeru < 14) {
        turnoActual = 'Mañana';
    } else if (horaPeru >= 14 && horaPeru < 21) {
        turnoActual = 'Tarde';
    } else {
        turnoActual = 'Noche';
        // Si es madrugada (entre 00:00 y 06:59), pertenece al día hotelero anterior
        if (horaPeru >= 0 && horaPeru < 7) {
            const milisegundosEnUnDia = 24 * 60 * 60 * 1000;
            const ayer = new Date(ahora.getTime() - milisegundosEnUnDia);
            fechaSeleccionada = formateadorFecha.format(ayer);
        }
    }
}

// ==========================================
// RECUPERACIÓN DE SESIÓN DEL USUARIO
// ==========================================
function obtenerUsuarioSesion() {
    const formElement = document.querySelector('form'); // Por si se guarda en dataset del form central
    
    usuarioActivo.id = (formElement && formElement.dataset.idUsuarioLogueado) || 
                       localStorage.getItem("id_usuario_logueado") || 
                       "TU_UUID_REAL_DE_USUARIO_DE_SUPABASE"; 
                       
    usuarioActivo.nombres = localStorage.getItem("nombre_recepcionista") || 
                            document.getElementById("resRecepcion")?.value.trim() || 
                            "Recepcionista";

    // Si guardas el turno activo fijado en el login, lo respetamos; si no, usamos el calculado por hora
    if (localStorage.getItem("turno_activo")) {
        turnoActual = localStorage.getItem("turno_activo");
    }

    // Pintar datos básicos en el header del dashboard si existen los elementos
    const elName = document.getElementById('userName');
    const elRole = document.getElementById('userRole');
    if (elName) elName.innerText = usuarioActivo.nombres;
    if (elRole) elRole.innerText = localStorage.getItem("rol_usuario") || "Recepcionista";
}

// ==========================================
// 1. RENDERIZAR KPIs Y DESGLOSE (`reporte_diario`)
// ==========================================
async function renderizarKPISyPagos() {
    const { data: reporte, error } = await supabase
        .from('reporte_diario')
        .select('*')
        .eq('fecha_reporte', fechaSeleccionada)
        .maybeSingle();

    if (error) return console.error('Error al cargar reporte_diario:', error);

    const totalIngresosEl = document.getElementById('total_ingresos_sistema');
    const lblEstado = document.getElementById('lbl-estado-caja');
    const btnMaestro = document.getElementById('btnAccionReporteMaestro');

    if (!reporte) {
        // Inicialización visual a cero si el día no ha sido abierto en base de datos
        if (totalIngresosEl) totalIngresosEl.innerText = 'S/ 0.00';
        if (lblEstado) {
            lblEstado.innerText = 'REPORTE DE HOY: NO ABIERTO';
            lblEstado.className = 'status-indicator closed';
        }
        if (btnMaestro) btnMaestro.innerHTML = `<i class="fa-solid fa-folder"></i> Reporte Diario: CERRADO`;
        resetearValoresCero();
        return;
    }

    // Inyectar contadores numéricos (KPIs)
    asignarTextoPorId('num_checkins', reporte.num_checkins);
    asignarTextoPorId('num_checkouts', reporte.num_checkouts);
    asignarTextoPorId('num_reservas_nuevas', reporte.num_reservas_nuevas);

    // Inyectar montos financieros formateados
    if (totalIngresosEl) totalIngresosEl.innerText = `S/ ${reporte.total_ingresos_sistema.toFixed(2)}`;
    asignarTextoPorId('total_efectivo', `S/ ${reporte.total_efectivo.toFixed(2)}`);
    asignarTextoPorId('total_yape', `S/ ${reporte.total_yape.toFixed(2)}`);
    asignarTextoPorId('total_transferencia', `S/ ${reporte.total_transferencia.toFixed(2)}`);
    asignarTextoPorId('total_tarjeta', `S/ ${reporte.total_tarjeta.toFixed(2)}`);
    asignarTextoPorId('total_usd_en_soles', `S/ ${reporte.total_usd_en_soles.toFixed(2)}`);

    // Gestionar el indicador visual del estado global de la caja del hotel
    if (lblEstado) {
        if (reporte.estado === 'A') {
            lblEstado.innerText = 'REPORTE DE HOY: ABIERTO';
            lblEstado.className = 'status-indicator open';
            if (btnMaestro) btnMaestro.innerHTML = `<i class="fa-solid fa-folder-open"></i> Reporte Diario: ABIERTO`;
        } else {
            lblEstado.innerText = 'REPORTE DE HOY: CERRADO';
            lblEstado.className = 'status-indicator closed';
            if (btnMaestro) btnMaestro.innerHTML = `<i class="fa-solid fa-folder"></i> Reporte Diario: CERRADO`;
        }
    }
}

function resetearValoresCero() {
    ['num_checkins', 'num_checkouts', 'num_reservas_nuevas'].forEach(id => asignarTextoPorId(id, '0'));
    ['total_efectivo', 'total_yape', 'total_transferencia', 'total_tarjeta', 'total_usd_en_soles'].forEach(id => {
        asignarTextoPorId(id, 'S/ 0.00');
    });
}

// ==========================================
// 2. CONTROL DE TURNOS Y ARQUEOS (`caja_turnos`)
// ==========================================
async function renderizarCajaTurnos() {
    const { data: turnos, error } = await supabase
        .from('caja_turnos')
        .select('*')
        .eq('fecha', fechaSeleccionada);

    if (error) return console.error('Error al obtener turnos de caja:', error);

    const mapaTurnos = { 'Mañana': null, 'Tarde': null, 'Noche': null };
    turnos?.forEach(t => { mapaTurnos[t.turno] = t; });

    // Actualizar cada bloque de turno en tu interfaz (Mañana, Tarde, Noche)
    actualizarBloqueTurno('manana', mapaTurnos['Mañana']);
    actualizarBloqueTurno('tarde', mapaTurnos['Tarde']);
    actualizarBloqueTurno('noche', mapaTurnos['Noche']);
}

function actualizarBloqueTurno(prefijo, datosTurno) {
    const totalTurnoEl = document.getElementById(`total_turno_${prefijo}`);
    const recepEl = document.getElementById(`recep_${prefijo}`);

    if (!datosTurno) {
        if (totalTurnoEl) totalTurnoEl.innerText = 'S/ 0.00';
        if (recepEl) recepEl.innerText = 'Sin aperturar';
        return;
    }

    // Mostrar el efectivo esperado en el turno
    if (totalTurnoEl) totalTurnoEl.innerText = `S/ ${datosTurno.efectivo_esperado.toFixed(2)}`;

    // Si el turno evaluado coincide con el turno dinámico/activo del usuario actual, añadimos lógica en vivo
    if (datosTurno.turno === turnoActual) {
        const inputReal = document.getElementById('efectivo_fisico_real');
        const diffEl = document.getElementById('diferencia');

        if (inputReal && diffEl) {
            // Escuchar el cuadre de caja en vivo mientras escribe el recepcionista
            inputReal.addEventListener('input', (e) => {
                const real = parseFloat(e.target.value) || 0;
                const diff = real - datosTurno.efectivo_esperado;
                diffEl.innerText = `S/ ${diff.toFixed(2)}`;

                // Modificar el estilo visual del indicador de discrepancia
                if (diff === 0) {
                    diffEl.parentElement.className = "diff-indicator status-exact";
                } else {
                    diffEl.parentElement.className = "diff-indicator status-warning";
                }
            });
        }
    }
}

// ==========================================
// 3. GESTIÓN DE EGRESOS (`egresos`)
// ==========================================
async function registrarEgreso() {
    // Uso de SweetAlert2 para capturar de forma limpia el concepto y monto
    const { value: formValues } = await Swal.fire({
        title: 'Registrar Egreso de Caja Chica',
        html:
            '<input id="swal-concepto" class="swal2-input" placeholder="Concepto (ej. Pago de agua, Delivery)">' +
            '<input id="swal-monto" type="number" step="0.01" class="swal2-input" placeholder="Monto S/">',
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Guardar Egreso',
        confirmButtonColor: '#800020', // Tono corporativo Vino Tinto
        preConfirm: () => {
            const concepto = document.getElementById('swal-concepto').value.trim();
            const monto = parseFloat(document.getElementById('swal-monto').value);
            if (!concepto || isNaN(monto) || monto <= 0) {
                Swal.showValidationMessage('Por favor introduce un concepto válido y un monto mayor a 0');
                return false;
            }
            return { concepto, monto };
        }
    });

    if (formValues) {
        const { error } = await supabase
            .from('egresos')
            .insert([{
                id_usuario: usuarioActivo.id,
                turno: turnoActual,
                monto: formValues.monto,
                concepto: formValues.concepto,
                fecha_egreso: fechaSeleccionada
            }]);

        if (error) {
            console.error(error);
            Swal.fire('Error', 'No se pudo procesar el egreso en la base de datos.', 'error');
        } else {
            Swal.fire('Éxito', 'Egreso añadido correctamente.', 'success');
            await cargarReporteCompleto(); // Refrescar los componentes e indicadores de dinero
        }
    }
}

async function renderizarEgresos() {
    const wrapper = document.getElementById('listaEgresosDinamica');
    if (!wrapper) return;
    
    wrapper.innerHTML = '';

    const { data: egresos, error } = await supabase
        .from('egresos')
        .select('*')
        .eq('fecha_egreso', fechaSeleccionada);

    if (error) return console.error('Error al traer egresos:', error);

    if (!egresos || egresos.length === 0) {
        wrapper.innerHTML = '<p class="empty-notes">Sin egresos registrados hoy</p>';
        return;
    }

    egresos.forEach(eg => {
        const row = document.createElement('div');
        row.className = 'expense-row-item';
        row.innerHTML = `
            <span class="expense-concept">${eg.concepto} <small class="text-muted">(${eg.turno})</small></span>
            <span class="expense-val">- S/ ${eg.monto.toFixed(2)}</span>
        `;
        wrapper.appendChild(row);
    });
}

// ==========================================
// 4. BITÁCORA DE OCURRENCIAS (`ocurrencias`)
// ==========================================
async function guardarOcurrencia() {
    const containers = document.querySelectorAll('.log-column');
    let turnoNota = '';
    let descripcionNota = '';
    let textAreaTarget = null;

    // Localizar cuál de los textareas por turnos contiene el texto digitado
    containers.forEach(col => {
        const h6 = col.querySelector('h6')?.innerText || '';
        const txtArea = col.querySelector('.textarea-log');
        if (txtArea && txtArea.value.trim() !== '') {
            turnoNota = h6.includes('MAÑANA') ? 'Mañana' : h6.includes('TARDE') ? 'Tarde' : 'Noche';
            descripcionNota = txtArea.value.trim();
            textAreaTarget = txtArea;
        }
    });

    if (!descripcionNota) {
        return Swal.fire('Atención', 'Escribe una ocurrencia o nota en el cuadro del turno correspondiente antes de guardar.', 'warning');
    }

    const { error } = await supabase
        .from('ocurrencias')
        .insert([{
            fecha: fechaSeleccionada,
            turno: turnoNota,
            usuario_id: usuarioActivo.id,
            usuario_nombre: usuarioActivo.nombres,
            descripcion: descripcionNota
        }]);

    if (error) {
        console.error(error);
        Swal.fire('Error', 'Problema al registrar la ocurrencia.', 'error');
    } else {
        if (textAreaTarget) textAreaTarget.value = ''; // Vaciar caja de texto
        Swal.fire('Guardado', 'Incidencia añadida a la bitácora del turno.', 'success');
        await renderizarOcurrencias();
    }
}

async function renderizarOcurrencias() {
    const columnas = {
        'Mañana': document.getElementById('columna-notes-manana') || document.getElementById('columna-notas-manana'),
        'Tarde': document.getElementById('columna-notes-tarde') || document.getElementById('columna-notas-tarde'),
        'Noche': document.getElementById('columna-notes-noche') || document.getElementById('columna-notas-noche')
    };

    // Limpieza inicial de contenedores
    Object.values(columnas).forEach(col => { if (col) col.innerHTML = ''; });

    const { data: notas, error } = await supabase
        .from('ocurrencias')
        .select('*')
        .eq('fecha', fechaSeleccionada);

    if (error) return console.error('Error al cargar ocurrencias:', error);

    const conteo = { 'Mañana': 0, 'Tarde': 0, 'Noche': 0 };

    notas?.forEach(nota => {
        const col = columnas[nota.turno];
        if (col) {
            conteo[nota.turno]++;
            // Formatear la hora de creación de forma amigable (ej: 03:45 PM)
            const horaStr = new Date(nota.creado_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: true });
            
            const item = document.createElement('div');
            item.className = 'toast-note';
            item.innerHTML = `
                <span class="toast-meta">${horaStr} — <strong>${nota.usuario_nombre || 'Personal'}</strong></span>
                <p class="toast-desc">${nota.descripcion}</p>
            `;
            col.appendChild(item);
        }
    });

    // Colocar el marcador por defecto si el turno no registra incidencias
    Object.keys(columnas).forEach(turno => {
        if (conteo[turno] === 0 && columnas[turno]) {
            columnas[turno].innerHTML = '<p class="empty-notes">Sin ocurrencias registradas en este turno</p>';
        }
    });
}

// ==========================================
// FUNCIONES AUXILIARES DE SOPORTE DOM
// ==========================================
function asignarTextoPorId(id, texto) {
    const el = document.getElementById(id);
    if (el) el.innerText = texto;
}

// Validación de Fechas para Reservas (Reutilizable en tus otros módulos de reserva)
export function validarFechasReserva(checkInFecha, checkOutFecha) {
    if (new Date(checkOutFecha) < new Date(checkInFecha)) {
        alert("¡Atención! La fecha de salida (Check-Out) no puede ser anterior a la fecha de entrada (Check-In).");
        return false;
    }
    return true;
}