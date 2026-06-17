import { client as supabase } from './config.js';

let reporteActualId = null;
let estadoCajaActual = 'C'; // 'A' = Abierto, 'C' = Cerrado
let efectivoSistemaGlobal = 0;
let montoAperturaGlobal = 0; 
let egresosEfectivoGlobal = 0;

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
    document.getElementById('btnAccionReporteDiario').addEventListener('click', manejarFlujoCaja);
    document.getElementById('btnGuardarArqueo').addEventListener('click', guardarConteoFisicoParcial);
    document.getElementById('btnRegistrarEgreso').addEventListener('click', abrirModalRegistrarEgreso);
    
    // 🌟 EVENT LISTENER: Cálculo de diferencia en vivo cuando el usuario escribe
    document.getElementById('efectivo_fisico_real').addEventListener('input', (e) => {
        const valorFisico = parseFloat(e.target.value);
        
        if (isNaN(valorFisico)) {
            document.getElementById('diferencia').innerText = "S/ 0.00";
            document.getElementById('diferencia').style.color = "#64748b";
            return;
        }

        // Efectivo esperado = Base apertura + Efectivo ingresado - Egresos de caja
        const efectivoEsperado = montoAperturaGlobal + efectivoSistemaGlobal - egresosEfectivoGlobal;
        const diferenciaCalculada = valorFisico - efectivoEsperado;
        
        actualizarEstiloDiferenciaHTML(diferenciaCalculada);
    });
});

// ==========================================
// 1. CARGAR DATOS DESDE SUPABASE (INGRESOS / CONSUMOS / EGRESOS)
// ==========================================
async function cargarReportePorFecha(fechaDestino) {
    try {
        // Consultas simultáneas para optimizar la velocidad en Trujillo
        const [respuestaCaja, respuestaPagos, respuestaEgresos] = await Promise.all([
            supabase.from('reporte_diario').select('*').eq('fecha_reporte', fechaDestino).maybeSingle(),
            supabase.from('pagos').select('*').eq('fecha_pago', fechaDestino), // Ajustar a tu campo de fecha si cambia
            supabase.from('egresos').select('*').eq('fecha_egreso', fechaDestino)
        ]);

        if (respuestaCaja.error) throw respuestaCaja.error;
        if (respuestaPagos.error) throw respuestaPagos.error;
        if (respuestaEgresos.error) throw respuestaEgresos.error;

        const reporte = respuestaCaja.data;
        const pagos = respuestaPagos.data || [];
        const egresos = respuestaEgresos.data || [];

        if (!reporte) {
            reporteActualId = null;
            montoAperturaGlobal = 0;
            efectivoSistemaGlobal = 0;
            egresosEfectivoGlobal = 0;
            renderizarCajaCerradaVacia();
            return;
        }

        reporteActualId = reporte.id;
        estadoCajaActual = reporte.estado; 
        montoAperturaGlobal = parseFloat(reporte.monto_apertura || 0);

        // --- PROCESAMIENTO DINÁMICO DE INGRESOS Y MÉTODOS DE PAGO ---
        let efec = 0, yape = 0, trans = 0, tarj = 0, usdSoles = 0, consumos = 0;

        pagos.forEach(pago => {
            const monto = parseFloat(pago.monto_soles || 0);
            const metodo = String(pago.metodo_pago).toUpperCase().trim();

            // 1. Clasificación por medio de pago general
            if (metodo === 'EFECTIVO') efec += monto;
            else if (metodo === 'YAPE' || metodo === 'PLIN') yape += monto;
            else if (metodo === 'TRANSFERENCIA') trans += monto;
            else if (metodo === 'TARJETA') tarj += monto;
            else if (metodo === 'DOLARES' || metodo === 'USD') usdSoles += monto;

            // 2. Suma independiente de consumos con estado "Pagado"
            if ((pago.es_consumo === true || pago.categoria === 'CONSUMO') && pago.estado_pago === 'Pagado') {
                consumos += monto;
            }
        });

        efectivoSistemaGlobal = efec;

        // --- PROCESAMIENTO DINÁMICO DE EGRESOS ---
        let totalEgresos = 0;
        egresos.forEach(egr => { totalEgresos += parseFloat(egr.monto || 0); });
        egresosEfectivoGlobal = totalEgresos;

        // Venta Total Bruta del Día (KPI de Cabecera)
        const ventasTotalesDelDia = efec + yape + trans + tarj + usdSoles;

        // --- INYECCIÓN EN LOS ELEMENTOS HTML CORREGIDOS ---
        document.getElementById('total_ingresos_sistema').innerText = `S/ ${ventasTotalesDelDia.toFixed(2)}`;
        document.getElementById('monto-apertura').innerText = `S/ ${montoAperturaGlobal.toFixed(2)}`;
        
        document.getElementById('total_efectivo').innerText = `S/ ${efec.toFixed(2)}`;
        document.getElementById('total_yape').innerText = `S/ ${yape.toFixed(2)}`;
        document.getElementById('total_transferencia').innerText = `S/ ${trans.toFixed(2)}`;
        document.getElementById('total_tarjeta').innerText = `S/ ${tarj.toFixed(2)}`;
        document.getElementById('total_usd_en_soles').innerText = `S/ ${usdSoles.toFixed(2)}`;
        document.getElementById('total_consumos').innerText = `S/ ${consumos.toFixed(2)}`;
        document.getElementById('total_egresos_efectivo').innerText = `S/ ${totalEgresos.toFixed(2)}`;

        // Cálculos de Arqueo de Caja General
        const efectivoEsperadoTotal = montoAperturaGlobal + efec - totalEgresos;
        document.getElementById('efectivo_esperado_cierre').innerText = `S/ ${efectivoEsperadoTotal.toFixed(2)}`;
        document.getElementById('tbl-sistema-efectivo').innerText = `S/ ${efectivoEsperadoTotal.toFixed(2)}`;

        // Setear valores de arqueo previos si existen
        const inputFisico = document.getElementById('efectivo_fisico_real');
        inputFisico.value = reporte.efectivo_fisico_real !== null ? reporte.efectivo_fisico_real : '';
        
        const difInicial = reporte.efectivo_fisico_real !== null ? (parseFloat(reporte.efectivo_fisico_real) - efectivoEsperadoTotal) : 0;
        actualizarEstiloDiferenciaHTML(difInicial);

        document.getElementById('observaciones').value = reporte.observaciones || '';
        
        // Cargar listas adicionales e interfaces
        renderizarListaEgresos(egresos);
        actualizarCamposTurnosYEstado(reporte);
        asegurarRecepcionistaEnTurnoActual();

    } catch (err) {
        console.error("Error crítico al consolidar reporte_diario:", err);
        Swal.fire('Error de Conexión', 'No se pudieron recuperar las finanzas reales.', 'error');
    }
}

// ==========================================
// 2. AUXILIARES DE RENDERIZACIÓN Y ESTILOS
// ==========================================
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
        contenedor.innerHTML = `<p style="text-align: center; margin-top: 10px;">No se registraron egresos.</p>`;
        return;
    }
    
    let html = '<ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px;">';
    listaEgresos.forEach(egr => {
        html += `
            <li style="display: flex; justify-content: space-between; background: #fff1f2; padding: 6px 10px; border-radius: 4px; border-left: 3px solid #e11d48;">
                <span><b>${egr.descripcion || 'Gasto'}</b> (<small>${egr.usuario_registro || 'Recepcionista'}</small>)</span>
                <span style="color: #e11d48; font-weight: bold;">- S/ ${parseFloat(egr.monto).toFixed(2)}</span>
            </li>`;
    });
    html += '</ul>';
    contenedor.innerHTML = html;
}

function actualizarCamposTurnosYEstado(reporte) {
    const btnAccion = document.getElementById('btnAccionReporteDiario');
    const lblEstado = document.getElementById('lbl-estado-caja');
    const inputFisico = document.getElementById('efectivo_fisico_real');
    const obs = document.getElementById('observaciones');
    const btnGuardar = document.getElementById('btnGuardarArqueo');

    // Actualizar bloque de turnos inferior
    document.getElementById('recep_manana').innerHTML = `Recepcionista: <b>${reporte.recep_manana || '-'}</b>`;
    document.getElementById('total_turno_manana').innerText = `S/ ${parseFloat(reporte.total_turno_manana || 0).toFixed(2)}`;
    document.getElementById('recep_tarde').innerHTML = `Recepcionista: <b>${reporte.recep_tarde || '-'}</b>`;
    document.getElementById('total_turno_tarde').innerText = `S/ ${parseFloat(reporte.total_turno_tarde || 0).toFixed(2)}`;
    document.getElementById('recep_noche').innerHTML = `Recepcionista: <b>${reporte.recep_noche || '-'}</b>`;
    document.getElementById('total_turno_noche').innerText = `S/ ${parseFloat(reporte.total_turno_noche || 0).toFixed(2)}`;

    if (reporte.estado === 'A') {
        lblEstado.innerText = "ESTADO: ABIERTO";
        lblEstado.style.color = "#27ae60";
        btnAccion.innerHTML = `<i class="fa-solid fa-lock"></i> Cerrar Caja`;
        btnAccion.className = "btn-reporte-danger";
        inputFisico.disabled = false;
        obs.disabled = false;
        btnGuardar.disabled = false;
    } else {
        lblEstado.innerText = "ESTADO: CERRADO";
        lblEstado.style.color = "#ef4444";
        btnAccion.innerHTML = `<i class="fa-solid fa-folder-open"></i> Abrir Caja`;
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
    lblEstado.innerText = "CERRADO (SIN APERTURA)";
    lblEstado.style.color = "#64748b";

    const btnAccion = document.getElementById('btnAccionReporteDiario');
    btnAccion.innerHTML = `<i class="fa-solid fa-folder-open"></i> Abrir Caja`;
    btnAccion.className = "btn-reporte-success";
}

// ==========================================
// 3. REGISTRAR EGRESOS EN EL TURNO (NUEVO)
// ==========================================
async function abrirModalRegistrarEgreso() {
    if (estadoCajaActual !== 'A') {
        Swal.fire('Caja Cerrada', 'No puedes registrar egresos con la caja del día cerrada.', 'warning');
        return;
    }

    const nombreUsuarioActivo = localStorage.getItem("nombre_recepcionista") || "Fernanda Salinas";
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
                descripcion: formValues.descripcion,
                usuario_registro: nombreUsuarioActivo
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
// 4. CONTROLADOR INTERACTIVO DE APERTURA / CIERRE
// ==========================================
async function manejarFlujoCaja() {
    const fechaFiltro = document.getElementById('filtroFechaReporte').value;
    
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
            inputValidator: (val) => { if (!val || isNaN(val) || val < 0) return '¡Debe ingresar un número válido!'; }
        });

        if (montoAperturaIntroducido !== undefined) {
            try {
                const { error } = await supabase.from('reporte_diario').upsert({
                    fecha_reporte: fechaFiltro,
                    monto_apertura: parseFloat(montoAperturaIntroducido),
                    estado: 'A' 
                }, { onConflict: 'fecha_reporte' });

                if (error) throw error;
                Swal.fire('Caja Abierta', 'Se inicializó el reporte.', 'success');
                cargarReportePorFecha(fechaFiltro);
            } catch (err) {
                Swal.fire('Error', 'No se pudo abrir caja.', 'error');
            }
        }
    } else {
        // Lógica de Cierre
        const valorFisicoIngresado = parseFloat(document.getElementById('efectivo_fisico_real').value);
        if (isNaN(valorFisicoIngresado)) {
            Swal.fire('Conteo Requerido', 'Por favor, digite el monto de efectivo físico real antes de cerrar.', 'warning');
            return;
        }

        const confirmacion = await Swal.fire({
            title: '¿Confirmar Cierre de Caja?',
            text: "Las métricas se consolidarán de manera permanente.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#800020',
            confirmButtonText: 'Sí, Cerrar Caja'
        });

        if (confirmacion.isConfirmed) {
            try {
                const { error } = await supabase.from('reporte_diario').update({
                    estado: 'C',
                    efectivo_fisico_real: valorFisicoIngresado,
                    observaciones: document.getElementById('observaciones').value
                }).eq('id', reporteActualId);

                if (error) throw error;
                Swal.fire('Caja Cerrada', 'Consolidado con éxito.', 'success');
                cargarReportePorFecha(fechaFiltro);
            } catch (err) {
                Swal.fire('Error', 'No se pudo cerrar la caja.', 'error');
            }
        }
    }
}

async function guardarConteoFisicoParcial() {
    if (!reporteActualId) return;
    const valorFisico = parseFloat(document.getElementById('efectivo_fisico_real').value);
    try {
        const { error } = await supabase.from('reporte_diario').update({
            efectivo_fisico_real: isNaN(valorFisico) ? null : valorFisico,
            observaciones: document.getElementById('observaciones').value
        }).eq('id', reporteActualId);

        if (error) throw error;
        Swal.fire('Guardado', 'Arqueo parcial actualizado.', 'success');
    } catch (err) {
        Swal.fire('Error', 'No se pudo actualizar.', 'error');
    }
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

async function asegurarRecepcionistaEnTurnoActual() {
    if (!reporteActualId || estadoCajaActual !== 'A') return;
    const horaPeru = new Date().getHours();
    let columnaTurno = horaPeru >= 7 && horaPeru < 14 ? 'recep_manana' : (horaPeru >= 14 && horaPeru < 21 ? 'recep_tarde' : 'recep_noche');
    const nombreUsuarioActivo = localStorage.getItem("nombre_recepcionista") || "Fernanda Salinas";

    try {
        await supabase.from('reporte_diario').update({ [columnaTurno]: nombreUsuarioActivo }).eq('id', reporteActualId).is(columnaTurno, null);
    } catch (err) { console.error(err); }
}