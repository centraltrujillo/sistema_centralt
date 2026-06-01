import { client as supabase } from './config.js';

// --- VARIABLES GLOBALES DEL SISTEMA ---
let canalRackRealtime = null; 

// --- REFERENCIAS AL DOM ---
const habGrid = document.getElementById('habGrid');
const elLibres = document.getElementById('stat-libres');
const elOcupadas = document.getElementById('stat-ocupadas');
const elLimpieza = document.getElementById('stat-limpieza');

const modal = document.getElementById('modalReserva');
const form = document.getElementById('formNuevaReserva');
const closeModal = document.querySelector(".close-modal");


/* ==========================================================================
   FUNCIÓN DE APOYO: AUDITORÍA DE RECEPCIONISTA (VÍA SUPABASE AUTH)
   ========================================================================== */
async function obtenerNombreRecepcionista() {
    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return "Desconocido";

        const { data: usuario, error: dbError } = await supabase
            .from('usuarios')
            .select('usuario') 
            .eq('id', user.id)
            .maybeSingle();

        if (dbError) throw dbError;
        return usuario ? usuario.usuario : user.email;
    } catch (e) {
        console.error("Error en auditoría:", e);
        return "Sistema";
    }
}

// --- FUNCIONES AUXILIARES DE FECHA (CON CONTROL DE MADRUGADA OPERATIVA) ---
function obtenerFechaYTurnoOperativo() {
    const ahora = new Date();
    // Obtener la hora exacta en la zona horaria de Perú
    const horaPeru = parseInt(ahora.toLocaleTimeString('en-US', { timeZone: 'America/Lima', hour12: false, hour: '2-digit' }));
    const formateadorFecha = new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' });
    
    let fechaCalculada = formateadorFecha.format(ahora); 
    let turnoCalculado = 'Mañana';

    if (horaPeru >= 7 && horaPeru < 14) {
        turnoCalculado = 'Mañana';
    } else if (horaPeru >= 14 && horaPeru < 21) {
        turnoCalculado = 'Tarde';
    } else {
        turnoCalculado = 'Noche';
        // 🌟 EL TRUCO DE LA MADRUGADA: Si es entre las 00:00 y las 06:59 AM, pertenece al día operativo anterior
        if (horaPeru >= 0 && horaPeru < 7) {
            const fechaAyer = new Date(ahora);
            fechaAyer.setDate(fechaAyer.getDate() - 1);
            fechaCalculada = formateadorFecha.format(fechaAyer);
        }
    }
    
    return {
        fechaOperativa: fechaCalculada,
        turnoOperativo: turnoCalculado,
        horaReal: ahora.toLocaleTimeString('it-IT', { timeZone: 'America/Lima' })
    };
}

function getHoyISO() {
    const { fechaOperativa } = obtenerFechaYTurnoOperativo();
    return fechaOperativa;
}

const Toast = Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 3000,
    timerProgressBar: true,
    didOpen: (toast) => {
        toast.addEventListener('mouseenter', Swal.stopTimer)
        toast.addEventListener('mouseleave', Swal.resumeTimer)
    }
});

// ==========================================================================
// --- 2. CARGAR TABLERO EN TIEMPO REAL (SUPABASE) ---
// ==========================================================================
function configurarRackTiempoReal() {
    if (canalRackRealtime) {
        console.log("El canal Realtime ya está activo.");
        return; 
    }

    console.log("Iniciando conexión en tiempo real con el Rack vía Supabase...");

    actualizarTableroRack();

    canalRackRealtime = supabase
        .channel('cambios-rack-central')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'habitaciones' }, () => {
            console.log('🔄 Cambio en habitación detectado...');
            actualizarTableroRack();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'reservas' }, () => {
            console.log('🔄 Cambio en reservas detectado...');
            actualizarTableroRack();
        })
        .subscribe();
}
async function actualizarTableroRack() {
    try {
        // 🏨 CONTROL HORARIO UNIFICADO (TRUCO DE LA MADRUGADA HOTELERA)
        const ahora = new Date();
        const horaPeru = parseInt(ahora.toLocaleTimeString('en-US', { timeZone: 'America/Lima', hour12: false, hour: '2-digit' }));
        const formateadorFecha = new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' });

        const fechaRealHoy = formateadorFecha.format(ahora); // "2026-05-30" real
        let hoy = fechaRealHoy; 
        let esMadrugada = false;

        // Si estamos en el rango crítico de madrugada, el día operativo retrocede al anterior
        if (horaPeru >= 0 && horaPeru < 7) {
            esMadrugada = true;
            const milisegundosEnUnDia = 24 * 60 * 60 * 1000;
            const ayer = new Date(ahora.getTime() - milisegundosEnUnDia);
            hoy = formateadorFecha.format(ayer); // "2026-05-29"
            console.log(`🌙 Auditoría Rack: Modo madrugada activo. Hoy operativo: ${hoy}. Fecha real: ${fechaRealHoy}`);
        }

        // Calcular "mañana" partiendo estrictamente del "hoy contable"
        const año = parseInt(hoy.split('-')[0]);
        const mes = parseInt(hoy.split('-')[1]) - 1;
        const dia = parseInt(hoy.split('-')[2]);
        
        const baseHoyObj = new Date(año, mes, dia);
        const mañanaData = new Date(baseHoyObj);
        mañanaData.setDate(mañanaData.getDate() + 1);
        const mañanaISO = formateadorFecha.format(mañanaData); // En madrugada, volverá a ser "2026-05-30"

        // OBTENER TODAS LAS HABITACIONES ORDENADAS POR NÚMERO
        const { data: habitaciones, error: errHabs } = await supabase
            .from('habitaciones')
            .select('*')
            .order('numero', { ascending: true });

        if (errHabs) throw errHabs;

        // ==========================================================================
        // 2. BUSCAR RESERVAS ACTIVAS (CONFIRMADAS O EN CURSO)
        // ==========================================================================
        const { data: reservasHoy, error: errRes } = await supabase
            .from('reservas')
            .select('id, id_habitacion, check_in_fecha, check_out_fecha, cargo_early_checkin, cargo_late_checkout, estado_reserva, numero_personas, tiene_early_checkin, tiene_late_checkout')
            .in('estado_reserva', ['Confirmada', 'En Curso']); 

        if (errRes) throw errRes;

        const fechaHoyObj = new Date(hoy + 'T00:00:00');
        const reservasMapa = {};

        if (reservasHoy) {
            reservasHoy.forEach(res => {
                if (res.id_habitacion && res.check_in_fecha) {
                    
                    const fechaCheckInObj = new Date(res.check_in_fecha + 'T00:00:00');

                    // Filtro de seguridad: Ignorar reservas antiguas que no se iniciaron
                    if (fechaCheckInObj < fechaHoyObj && res.estado_reserva !== 'En Curso') {
                        return; 
                    }

                    // 🚨 REGLAS DE MAPEADO HORARIO DE RACK ACORDES AL HOTEL

                    // Caso 1: La reserva ya está ocupando el cuarto ('En Curso')
                    if (res.estado_reserva === 'En Curso') {
                        reservasMapa[res.id_habitacion] = {
                            id: res.id,
                            tieneEarly: false, 
                            tieneLate: res.tiene_late_checkout, // 👈 Evaluamos Late Checkout solo si ya está adentro
                            estado: res.estado_reserva,
                            checkIn: res.check_in_fecha,
                            numeroPersonas: parseInt(res.numero_personas) || 1,
                            forzarEntrada: true
                        };
                    } 
                    // Caso 2: Reservas del día contable actual
                    else if (res.check_in_fecha === hoy) {
                        reservasMapa[res.id_habitacion] = {
                            id: res.id,
                            tieneEarly: res.tiene_early_checkin, // Respeta fielmente la Base de Datos
                            tieneLate: false,
                            estado: res.estado_reserva,
                            checkIn: res.check_in_fecha,
                            numeroPersonas: parseInt(res.numero_personas) || 1,
                            forzarEntrada: true 
                        };
                    } 
                    // Caso 3: Es de madrugada y la reserva pertenece al día real que figura en el calendario
                    else if (esMadrugada && res.check_in_fecha === fechaRealHoy) {
                        reservasMapa[res.id_habitacion] = {
                            id: res.id,
                            tieneEarly: res.tiene_early_checkin, // 👈 Muestra Early solo si se guardó como tal en la BD
                            tieneLate: false,
                            estado: res.estado_reserva,
                            checkIn: res.check_in_fecha,
                            numeroPersonas: parseInt(res.numero_personas) || 1,
                            forzarEntrada: true
                        };
                    }
                }
            });
        }

        // ==========================================================================
        // 3. PROCESAR E INYECTAR LA DATA AL DOM
        // ==========================================================================
        if (!habGrid) return;
        habGrid.innerHTML = '';
        let stats = { libres: 0, ocupadas: 0, limpieza: 0 }; 

        habitaciones.forEach(hab => {
            const est = hab.estado || "Libre";
            
            if (est === "Libre" || est === "Disponible") stats.libres++;
            else if (est === "Ocupada" || est === "En Curso") stats.ocupadas++;
            else if (est === "Limpieza") stats.limpieza++; 

            let htmlAvisos = '';
            const infoReserva = reservasMapa[hab.id]; 
            const nPers = infoReserva ? infoReserva.numeroPersonas : 0;

            // 🎛️ CONTROL DE ETIQUETAS VISUALES EN LA CARD
            if (est === "Ocupada" || est === "En Curso") {
                // Solo si está ocupada y se le configuró Late Check-Out se renderiza
                if (infoReserva && infoReserva.tieneLate) {
                    htmlAvisos = `
                        <div class="tag-rack late" style="background: #fff3e0; color: #e65100; font-size: 10px; font-weight: 800; padding: 2px 4px; border-radius: 4px; margin-top: 4px; border: 1px solid #ffcc80; display: inline-block;">
                            <i class="fa-regular fa-clock"></i> LATE CHECK-OUT
                        </div>`;
                }
            } else {
                // Si la habitación está Libre/Limpieza y tiene reserva confirmada asignada
                if (infoReserva && infoReserva.estado === 'Confirmada' && infoReserva.forzarEntrada) {
                    if (infoReserva.tieneEarly) {
                        htmlAvisos = `
                            <div class="tag-rack early" style="background: #e8f5e9; color: #2e7d32; font-size: 10px; font-weight: 800; padding: 2px 4px; border-radius: 4px; margin-top: 4px; border: 1px solid #a5d6a7; display: inline-block;">
                                <i class="fa-solid fa-bolt"></i> EARLY CHECK-IN
                            </div>`;
                    } else {
                        htmlAvisos = `
                            <div class="tag-rack reserva" style="color: #800020; font-size: 10px; font-weight: 800; margin-top: 5px; display: inline-block;">
                                ⚠️ RESERVA HOY
                            </div>`;
                    }
                }
            }

            const iconoDinamico = est === "Limpieza" ? "fa-broom" : obtenerIconoSegunOcupacion(est, nPers);
            
            const card = document.createElement('div');
            const claseEstadoCss = est.toLowerCase().replace(/\s+/g, '-');
            card.className = `hab-card ${claseEstadoCss}`;
            
            // Inyectamos el ID de reserva en el dataset del elemento HTML si existe una activa
            if (infoReserva) {
                card.dataset.idReserva = infoReserva.id;
            }
            
            card.innerHTML = `
                <div class="hab-header">
                    <div class="hab-number">${hab.numero}</div>
                    <div class="hab-type">${hab.tipo}</div>
                </div>
                <div class="hab-body">
                    <div class="hab-icon">
                        <i class="fa-solid ${iconoDinamico}"></i> 
                    </div>
                    <div class="hab-footer-info">
                        <span class="hab-badge">${est.toUpperCase()}</span>
                        ${htmlAvisos}
                    </div>
                </div>`;

            card.onclick = () => {
                if (est === "Ocupada" || est === "En Curso") {
                    if (typeof abrirModalGestionOcupada === "function") abrirModalGestionOcupada(hab);
                } else if (est === "Limpieza") {
                    if (typeof abrirModalGestionLimpieza === "function") abrirModalGestionLimpieza(hab);
                } else {
                    // El ID de la reserva capturado se transfiere de inmediato a tu modal de Check-In
                    if (typeof abrirModalCheckIn === "function") {
                        abrirModalCheckIn(hab, card.dataset.idReserva || null);
                    }
                }
            };
            
            habGrid.appendChild(card);
        });

        // Actualización de contadores superiores
        if (elLibres) elLibres.innerText = stats.libres;
        if (elOcupadas) elOcupadas.innerText = stats.ocupadas;
        if (elLimpieza) elLimpieza.innerText = stats.limpieza;

    } catch (error) {
        console.error("Error actualizando el Rack con Supabase:", error.message);
    }
}

function obtenerIconoSegunOcupacion(estado, p) {
    if (estado !== "Ocupada" && estado !== "En Curso") return 'fa-hotel'; 
    if (p === 1) return 'fa-user';
    if (p === 2) return 'fa-user-group';
    if (p >= 3 && p <= 4) return 'fa-users';
    return 'fa-people-group'; 
}

// --- GANCHOS DE INICIALIZACIÓN ---
window.inicializarPagina = () => {
    configurarRackTiempoReal();
};

async function renderizarResumenMensual() {
    try {
        const ahora = new Date();
        const formateador = new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit' });
        
        // 1. Obtenemos el Año y Mes actual en formato "YYYY-MM" (ej: "2026-05")
        const añoMes = formateador.format(ahora); 
        
        // 2. Definimos de forma exacta los límites operativos del mes
        const primerDiaMes = `${añoMes}-01`;
        
        // Calculamos el último día del mes actual de forma dinámica
        const año = ahora.getFullYear();
        const mes = ahora.getMonth(); // Mes indexado en 0
        const ultimoDiaDeEsteMes = new Date(año, mes + 1, 0).getDate();
        const ultimoDiaMes = `${añoMes}-${String(ultimoDiaDeEsteMes).padStart(2, '0')}`;

        console.log(`📊 Consultando resumen desde ${primerDiaMes} hasta ${ultimoDiaMes}`);

        // 3. Consulta segura a Supabase acotando el mes completo
        const { data: reservas, error } = await supabase
            .from('reservas')
            .select('check_in_fecha, check_out_fecha, huespedes(nombres_apellidos), habitaciones(numero)')
            .gte('check_in_fecha', primerDiaMes)
            .lte('check_in_fecha', ultimoDiaMes)
            .order('check_in_fecha', { ascending: true });

        if (error) throw error;

        // Aquí continúa tu lógica para pintar el resumen mensual...
        // console.log("Reservas del mes cargadas con éxito:", reservas);

    } catch (error) {
        console.error("Error al renderizar el resumen mensual:", error.message || error);
    }
}

configurarRackTiempoReal();
renderizarResumenMensual();
/* ==========================================================================
   3. MODAL CHECK-IN (ELECCIÓN DE ORIGEN)
   ========================================================================== */
async function abrirModalCheckIn(hab, idReservaPrevia = null) {
    const hoyContable = getHoyISO(); // "YYYY-MM-DD" operativo (ej. 29)
    
    // Obtener la fecha real del calendario (ej. 30)
    const ahora = new Date();
    const formateador = new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' });
    const fechaRealHoy = formateador.format(ahora);

    try {
        // Traemos las reservas confirmadas cuyo check-in sea menor o igual al día de HOY REAL
        // Esto garantiza que si es la madrugada del 30, cargue las del 29 y las del 30 sin distinción
        const { data: reservasHoy, error } = await supabase
            .from('reservas')
            .select(`
                id,
                check_in_fecha,
                check_out_fecha,
                estado_reserva,
                numero_personas,
                huespedes ( nombres_apellidos )
            `)
            .eq('id_habitacion', hab.id)
            .eq('estado_reserva', 'Confirmada')
            .lte('check_in_fecha', fechaRealHoy); // 👈 Cambiado a fechaRealHoy para que no se queden fuera

        if (error) throw error;

        let opciones = {};
        let datosReservas = {};
        let preseleccion = "directo";

        if (reservasHoy && reservasHoy.length > 0) {
            reservasHoy.forEach(res => {
                const nombreHuesped = res.huespedes?.nombres_apellidos || "Huésped";
                opciones[res.id] = `📅 [${res.check_in_fecha}] / [${res.check_out_fecha}] - ${nombreHuesped}`;
                datosReservas[res.id] = res;
                
                // Si esta reserva coincide con la que el Rack detectó visualmente, la dejamos preseleccionada
                if (idReservaPrevia && res.id === idReservaPrevia) {
                    preseleccion = res.id;
                }
            });
            
            // Si no pasamos ID previo pero solo hay una reserva disponible, la preseleccionamos por comodidad
            if (!idReservaPrevia && reservasHoy.length === 1) {
                preseleccion = reservasHoy[0].id;
            }
        }
        
        opciones["directo"] = "➕ Venta Directa (Nuevo)";

        // 🌟 RENDERIZADO CON ANCHO AMPLIADO Y ESTILOS PERSONALIZADOS
        const { value: choice } = await Swal.fire({
            title: `Ingreso - Hab. ${hab.numero}`,
            input: 'select',
            inputOptions: opciones,
            inputValue: preseleccion,
            width: '500px', // 👈 Ampliamos el ancho base del modal (por defecto es 32rem / ~512px)
            confirmButtonColor: '#800020',
            showCancelButton: true,
            cancelButtonText: 'Cancelar',
            customClass: {
                input: 'swal2-select-custom' // 👈 Clase CSS para darle los retoques finales
            },
            // Inyectamos un estilo rápido para asegurar que el texto no se mutile y use tipografía limpia
            didOpen: () => {
                const selectElement = Swal.getInput();
                if (selectElement) {
                    selectElement.style.width = '90%';
                    selectElement.style.maxWidth = '100%';
                    selectElement.style.fontSize = '16px'; // Tamaño profesional y legible
                    selectElement.style.whiteSpace = 'nowrap';
                }
            }
        });

        if (choice) {
            if (choice === "directo") {
                modalCheckInDirecto(hab); 
            } else {
                ejecutarCheckInReservaExistente(choice, hab, datosReservas[choice]);
            }
        }
    } catch (e) {
        console.error("Error al buscar reservas:", e);
        Swal.fire('Error', 'No se pudieron cargar las reservas pendientes.', 'error');
    }
}

async function ejecutarCheckInReservaExistente(resId, hab, dataReserva) {
    try {
        // 1. Cambiar estado de la Reserva a "En Curso" y registrar la hora de ingreso en Perú
        const horaIngreso = new Date().toLocaleTimeString('it-IT', { timeZone: 'America/Lima' }); // Formato 24h seguro HH:MM:SS
        
        const { error: errReserva } = await supabase
            .from('reservas')
            .update({ 
                estado_reserva: "En Curso",
                check_in_hora: horaIngreso
            })
            .eq('id', resId);

        if (errReserva) throw errReserva;

        // 2. Cambiar estado de la Habitación a "Ocupada"
        const { data: habActualizada, error: errHab } = await supabase
            .from('habitaciones')
            .update({ 
                estado: "Ocupada"
            })
            .eq('id', hab.id)
            .select();

        if (errHab) throw errHab;

        console.log("🔥 Habitación actualizada en Supabase con éxito:", habActualizada);

        Swal.fire({ 
            icon: 'success', 
            title: 'Huésped en Habitación', 
            text: `Habitación ${hab.numero} ahora está Ocupada.`,
            showConfirmButton: false, 
            timer: 1500 
        });

        // 3. Renderizar y actualizar de inmediato el Rack sin perder la conexión en tiempo real
        await actualizarTableroRack();

    } catch (e) {
        console.error("❌ Error crítico en el flujo de Check-in:", e);
        Swal.fire('Error', 'No se pudo procesar el ingreso: ' + e.message, 'error');
    }
}


/* ==========================================================================
   4. MODAL PARA INGRESO DIRECTO (COMPLETO, CORREGIDO Y SEGURO)
   ========================================================================== */
async function modalCheckInDirecto(hab) {
    const statusDiv = document.getElementById('statusDisponibilidad');
    const hoy = getHoyISO();

    const getVal = (id) => document.getElementById(id)?.value || "";
    const getNum = (id) => parseFloat(document.getElementById(id)?.value) || 0;
    const isChecked = (id) => {
        const el = document.getElementById(id);
        return el ? el.checked : false;
    };

    if (modal) {
        modal.style.display = 'flex';
        modal.classList.add('active');
    }
    const modalTitle = document.getElementById('modalTitle');
    if (modalTitle) modalTitle.innerText = `Ingreso Directo - Hab. ${hab.numero}`;
    
    if (form) form.reset();
    if (statusDiv) statusDiv.innerHTML = "";

    const cerrar = () => {
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('active');
        }
    };

    const closeBtn = modal?.querySelector('.close-modal');
    if (closeBtn) closeBtn.onclick = cerrar;

    const cancelBtn = modal?.querySelector('.btn-cancel');
    if (cancelBtn) cancelBtn.onclick = cerrar;

    window.onclick = (e) => { if (e.target === modal) cerrar(); };

    // --- CARGA DE DATOS INICIALES ---
    const resTarifa = document.getElementById('resTarifa');
    if (resTarifa) resTarifa.value = hab.precio_base || 0;
    
    const resCheckIn = document.getElementById('resCheckIn');
    if (resCheckIn) resCheckIn.value = hoy;
    
    const resMedio = document.getElementById('resMedio');
    if (resMedio) resMedio.value = "Presencial";

    const selectHab = document.getElementById('resHabitacion');
    if (selectHab) selectHab.innerHTML = `<option value="${hab.id}" selected>${hab.numero} - ${hab.tipo}</option>`;

    // --- CRM: AUTOCOMPLETADO POR DOCUMENTO ---
    const docInput = document.getElementById('resDoc');
    if (docInput) {
        docInput.onblur = async () => {
            const numDoc = docInput.value.trim();
            if (numDoc.length < 3) return;
            try {
                const { data: huesped, error } = await supabase
                    .from('huespedes')
                    .select('*')
                    .eq('documento_num', numDoc)
                    .maybeSingle();

                if (error) throw error;

                if (huesped) {
                    form.dataset.idHuespedExistente = huesped.id;
                    const elHuesped = document.getElementById('resHuesped');
                    if (elHuesped) elHuesped.value = (huesped.nombres_apellidos || '').toUpperCase();
                    
                    const elTipoDoc = document.getElementById('resTipoDoc');
                    if (elTipoDoc) elTipoDoc.value = huesped.documento_tipo || 'DNI';

                    const elTel = document.getElementById('resTelefono');
                    if (elTel) elTel.value = huesped.telefono || '';
                    
                    const elCorreo = document.getElementById('resCorreo');
                    if (elCorreo) elCorreo.value = huesped.correo || '';
                    
                    const elNac = document.getElementById('resNacionalidad');
                    if (elNac) elNac.value = huesped.nacionalidad || 'Peruana';

                    const elCiudad = document.getElementById('resCiudad');
                    if (elCiudad) elCiudad.value = huesped.ciudad || '';
                    
                    const elFecha = document.getElementById('resNacimiento');
                    if (elFecha) elFecha.value = huesped.fecha_nacimiento || '';

                    const elPref = document.getElementById('resPreferencias');
                    if (elPref) elPref.value = huesped.preferencias || '';
                    
                    if (huesped.preferencias) {
                        Toast.fire({ icon: 'info', title: `Huésped Frecuente: Alerta de Preferencias Activa ⚠️` });
                    } else {
                        Toast.fire({ icon: 'success', title: 'Huésped frecuente cargado' });
                    }
                } else {
                    delete form.dataset.idHuespedExistente;
                }
            } catch (e) { 
                console.error("Error en CRM Autocompletado:", e); 
            }
        };
    }

// --- LÓGICA DE CÁLCULOS UNIFICADA (Idéntica a Reservas y Calendario) ---
    const calcularMontosRack = () => {
        const checkInVal = getVal('resCheckIn');
        const checkOutVal = getVal('resCheckOut');
        const elTotal = document.getElementById('resTotal');
        const elDif = document.getElementById('resDiferencia');
        const elAdelantoInput = document.getElementById('resAdelantoMonto');

        if (!checkInVal || !checkOutVal) {
            if (elTotal) elTotal.value = "0.00";
            if (elDif) elDif.value = "0.00";
            return;
        }

        const fIn = new Date(checkInVal + 'T00:00:00');
        const fOut = new Date(checkOutVal + 'T00:00:00');
        const tarifaBase = getNum('resTarifa');
        const tieneEarly = isChecked("resEarly");
        const tieneLate = isChecked("resLate");

        // Capturamos moneda y tipo de cambio usando los IDs del modal
        const moneda = getVal('resMoneda') || "PEN";
        const tipoCambio = getNum('resTipoChange') || getNum('resTipoCambio') || 1.000; // Compatible con ambos IDs comunes

        const noches = Math.round((fOut - fIn) / (1000 * 60 * 60 * 24));

        if (noches < 0 || (noches === 0 && !tieneEarly && !tieneLate)) {
            if (elTotal) elTotal.value = "0.00";
            if (elDif) elDif.value = "0.00";
            return;
        }
        
        // 1. Cálculos base en la moneda pactada
        let subtotalHospedaje = noches === 0 ? tarifaBase : noches * tarifaBase;
        let cargoEarly = tieneEarly ? (tarifaBase * 0.5) : 0.00;
        let cargoLate = tieneLate ? (tarifaBase * 0.5) : 0.00;

        let totalReservaMismaMoneda = subtotalHospedaje + cargoEarly + cargoLate;

        // 2. 🎯 CONVERSIÓN CRÍTICA: Si es USD, convertimos el total final a soles peruanos
        let totalFinalMostrado = totalReservaMismaMoneda;
        if (moneda === "USD") {
            totalFinalMostrado = totalReservaMismaMoneda * tipoCambio;
        }

        // Guardamos los valores de los cargos en el dataset del formulario de forma segura
        if (form) {
            form.dataset.cargoEarly = cargoEarly;
            form.dataset.cargoLate = cargoLate;
        }

        // El total mostrado en la interfaz ahora sí reflejará soles si se seleccionó USD
        if (elTotal) elTotal.value = totalFinalMostrado.toFixed(2);

        let adelanto = getNum('resAdelantoMonto');

        // El adelanto se evalúa contra el total final convertido
        if (adelanto > totalFinalMostrado && totalFinalMostrado > 0) {
            adelanto = totalFinalMostrado;
            if (elAdelantoInput) elAdelantoInput.value = totalFinalMostrado.toFixed(2);
            
            if (typeof Toast !== 'undefined' && Toast) {
                Toast.fire({ icon: 'warning', title: 'El adelanto no puede superar al total' });
            }
        }

        if (elDif) elDif.value = (totalFinalMostrado - adelanto).toFixed(2);
    };
    // --- GUARDADO ATÓMICO CON DOBLE ACTUALIZACIÓN ---
    if (form) {
        form.onsubmit = async (e) => {
            e.preventDefault();
            try {
                const idUsuarioActivo = form.dataset.idUsuarioLogueado || 
                                       localStorage.getItem("id_usuario_logueado") || 
                                       (await supabase.auth.getUser()).data.user?.id;
                                       
                const turnoActivo = localStorage.getItem("turno_activo") || "Mañana"; 
                const nombreRecepcionista = localStorage.getItem("nombre_recepcionista") || "Recepcionista en Turno";
                const nPersonasFormulario = parseInt(getVal('resPersonas')) || 1;

                // 1. Registro / Actualización de Huésped
                const { data: chunkHuesped, error: errHuesped } = await supabase
                    .from('huespedes')
                    .upsert({
                        id: form.dataset.idHuespedExistente || undefined, 
                        nombres_apellidos: getVal('resHuesped').toUpperCase(),
                        documento_tipo: getVal('resTipoDoc') || 'DNI', 
                        documento_num: getVal('resDoc').trim(),
                        fecha_nacimiento: getVal('resNacimiento') || null,
                        nacionalidad: getVal('resNacionalidad') || 'Peruana',
                        ciudad: getVal('resCiudad') || null,
                        telefono: getVal('resTelefono') || null,
                        correo: getVal('resCorreo') || null,
                        preferencias: getVal('resPreferencias') || null
                    }, { onConflict: 'documento_num' })
                    .select().single();

                if (errHuesped) throw errHuesped;

                // 2. Inserción de Reserva ('En Curso')
                const tarifa = getNum('resTarifa');
                const tcUsado = getNum('resTipoCambio') || 1.000;
                
                let cocheraSeleccionada = getVal('resCochera') || 'No';
                if (cocheraSeleccionada === 'Si') cocheraSeleccionada = 'Red Parking'; 

                const earlyInsert = isChecked("resEarly");
                const lateInsert = isChecked("resLate");

                const { data: chunkReserva, error: errNuevaRes } = await supabase
                    .from('reservas')
                    .insert([{
                        id_huesped: chunkHuesped.id,
                        id_habitacion: hab.id,
                        id_usuario: idUsuarioActivo,
                        check_in_fecha: getVal('resCheckIn'),
                        check_in_hora: new Date().toTimeString().split(' ')[0], 
                        check_out_fecha: getVal('resCheckOut'),
                        tarifa_pactada: tarifa,
                        moneda: getVal('resMoneda') || 'PEN', 
                        tipo_cambio: tcUsado, 
                        cargo_early_checkin: earlyInsert ? (tarifa * 0.5) : 0.00,
                        cargo_late_checkout: lateInsert ? (tarifa * 0.5) : 0.00,
                        tiene_early_checkin: earlyInsert,
                        tiene_late_checkout: lateInsert,
                        desayuno: isChecked('resDesayunoCheck'),
                        cochera: cocheraSeleccionada, 
                        traslado: getVal('resTraslado') || null,
                        medio_reserva: 'Presencial', 
                        estado_reserva: 'En Curso',  
                        numero_personas: nPersonasFormulario, 
                        notas: getVal('resObservaciones') || ''
                    }])
                    .select().single();

                if (errNuevaRes) throw errNuevaRes;

// 3. Registro de Adelanto Financiero
const adelanto = getNum('resAdelantoMonto');
if (adelanto > 0) {
    let metodoPagoSeguro = getVal('resMetodoPago') || "Efectivo";
    
    if (metodoPagoSeguro === "Plin") metodoPagoSeguro = "Yape"; 
    if (metodoPagoSeguro.includes("Tarjeta")) metodoPagoSeguro = "Tarjeta"; 
    if (metodoPagoSeguro.includes("Transferencia")) metodoPagoSeguro = "Transferencia";

    // 🏨 CONTROL HORARIO UNIFICADO PARA TRUJILLO
    const ahora = new Date();
    const horaPeru = parseInt(ahora.toLocaleTimeString('en-US', { timeZone: 'America/Lima', hour12: false, hour: '2-digit' }));
    const formateadorFecha = new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' });
    
    let fechaCalculada = formateadorFecha.format(ahora); 
    let turnoCalculado = '';

    if (horaPeru >= 7 && horaPeru < 14) {
        turnoCalculado = 'Mañana';
    } else if (horaPeru >= 14 && horaPeru < 21) {
        turnoCalculado = 'Tarde';
    } else {
        turnoCalculado = 'Noche';
        if (horaPeru >= 0 && horaPeru < 7) {
            const fechaAyer = new Date(ahora);
            fechaAyer.setDate(fechaAyer.getDate() - 1);
            fechaCalculada = formateadorFecha.format(fechaAyer);
            
            // 🎯 CORRECCIÓN CRÍTICA DE FECHA DE RESERVA:
            // Si es madrugada, forzamos que la fecha de check-in de la reserva sea la fecha operativa corregida.
            if (chunkReserva) {
                await supabase
                    .from('reservas')
                    .update({ check_in_fecha: fechaCalculada })
                    .eq('id', chunkReserva.id);
            }
        }
    }

    // 🕒 CORRECCIÓN DE HORA: Forzar envío en formato string limpio sin microsegundos extras de zona horaria
    const horaLimpia = ahora.toLocaleTimeString('en-US', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
    });

    const { error: errPago } = await supabase
        .from('pagos')
        .insert([{
            id_reserva: chunkReserva.id,
            id_usuario: idUsuarioActivo,
            turno: turnoCalculado || turnoActivo, 
            nombre_recepcionista: nombreRecepcionista,
            adelanto_monto: adelanto,           
            moneda: "PEN",                      
            tipo_cambio_usado: 1.000,           
            monto_soles: adelanto,              
            metodo_pago: metodoPagoSeguro, 
            concepto: 'Adelanto',
            nro_operacion: getVal('resNroOperacion') || null,
            fecha_pago: fechaCalculada, 
            hora_pago: horaLimpia // Se envía la variable formateada y limpia de desfases
        }]);

    if (errPago) throw errPago;
}

                // 4. Actualización de Habitación
                const { error: errHab } = await supabase
                    .from('habitaciones')
                    .update({ estado: "Ocupada" }) 
                    .eq('id', hab.id);

                if (errHab) throw errHab;

                Swal.fire({ icon: 'success', title: '¡Ingreso Exitoso!', timer: 2000, showConfirmButton: false });
                cerrar();
                
                actualizarTableroRack();
                renderizarResumenMensual();

            } catch (error) {
                console.error("Error crítico en el flujo de ingreso:", error);
                Swal.fire('Error', 'No se pudo completar el registro: ' + error.message, 'error');
            }
        };
    }

    // =========================================================================
    // 🚀 DISPARADORES AUTOMÁTICOS (CÁLCULOS + DISPONIBILIDAD EN TIEMPO REAL)
    // =========================================================================
    
    // 1. Ejecución inicial al abrir el modal
    calcularMontosRack();
    verificarDisponibilidadRealTime();

    // 2. Mapeo de campos para automatizar cálculos y disponibilidad al escribir o cambiar valores
    const inputsCalculo = ['resTarifa', 'resAdelantoMonto', 'resMoneda', 'resTipoCambio', 'resEarly', 'resLate'];
    const inputsDisponibilidad = ['resHabitacion', 'resCheckIn', 'resCheckOut'];

    // Escuchas para cálculos de precios
    inputsCalculo.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', calcularMontosRack);
            el.addEventListener('change', calcularMontosRack);
        }
    });

    // Escuchas cruzadas (Calculan montos Y verifican disponibilidad simultáneamente)
    inputsDisponibilidad.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', () => {
                calcularMontosRack();
                verificarDisponibilidadRealTime();
            });
            el.addEventListener('change', () => {
                calcularMontosRack();
                verificarDisponibilidadRealTime();
            });
        }
    });
}


// ==========================================================================
// ---   VERIFICACIÓN DE DISPONIBILIDAD EN TIEMPO REAL ---
// ==========================================================================
const verificarDisponibilidadRealTime = async () => {
    const idHabitacion = document.getElementById("resHabitacion")?.value; 
    const fIn = document.getElementById("resCheckIn")?.value;
    const fOut = document.getElementById("resCheckOut")?.value;
    const statusDiv = document.getElementById("statusDisponibilidad");
    if (!form || !statusDiv) return;
    
    const btnGuardar = form.querySelector('button[type="submit"]');

    if (!idHabitacion || !fIn || !fOut) {
        statusDiv.innerHTML = ""; 
        if (btnGuardar) btnGuardar.disabled = false;
        return;
    }

    statusDiv.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verificando disponibilidad...';
    statusDiv.style.color = "#d4a017"; 
    statusDiv.style.backgroundColor = "#fffbeb"; 
    statusDiv.style.border = "1px solid #fef3c7";

    try {
        const { data: reservasExistentes, error } = await supabase
            .from("reservas")
            .select("id, check_in_fecha, check_out_fecha")
            .eq("id_habitacion", idHabitacion)
            .neq("estado_reserva", "Cancelada"); 

        if (error) throw error;

        let ocupado = false;

        if (reservasExistentes) {
            for (let res of reservasExistentes) {
                if (typeof editId !== 'undefined' && editId && res.id === editId) continue;
                if (fIn < res.check_out_fecha && fOut > res.check_in_fecha) {
                    ocupado = true;
                    break;
                }
            }
        }

        if (ocupado) {
            statusDiv.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> Habitación ocupada en estas fechas';
            statusDiv.style.color = "#f43f5e"; 
            statusDiv.style.backgroundColor = "#fff1f2";
            statusDiv.style.border = "1px solid #ffe4e6";
            
            if (btnGuardar) {
                btnGuardar.disabled = true;
                btnGuardar.style.opacity = "0.5";
                btnGuardar.style.cursor = "not-allowed";
            }
        } else {
            statusDiv.innerHTML = '<i class="fa-solid fa-circle-check"></i> Habitación disponible';
            statusDiv.style.color = "#10b981"; 
            statusDiv.style.backgroundColor = "#f0fdf4";
            statusDiv.style.border = "1px solid #dcfce7";
            
            if (btnGuardar) {
                btnGuardar.disabled = false;
                btnGuardar.style.opacity = "1";
                btnGuardar.style.cursor = "pointer";
            }
        }
    } catch (error) {
        console.error("Error al verificar disponibilidad:", error.message || error);
        statusDiv.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Error de conexión';
    }
};

/* ==========================================================================
   5. MODAL GESTIÓN HABITACIÓN OCUPADA (VISTA 360° DETALLADA - INTEGRADO)
   ========================================================================== */
async function abrirModalGestionOcupada(hab) {
    try {
        const { data: reserva, error: errRes } = await supabase
            .from('reservas')
            .select(`
                *,
                huespedes ( id, nombres_apellidos, documento_num, telefono, correo, nacionalidad ),
                usuarios ( usuario )
            `)
            .eq('id_habitacion', hab.id)
            .eq('estado_reserva', 'En Curso')
            .maybeSingle();

        if (errRes) throw errRes;
        if (!reserva) {
            console.warn("No se encontró reserva activa 'En Curso' para esta habitación.");
            return;
        }

        const hInfo = reserva.huespedes || {};

        // 2. Traer los consumos reales vinculados desde la tabla 'consumos'
        const { data: consumos, error: errCons } = await supabase
            .from('consumos')
            .select('*')
            .eq('id_reserva', reserva.id);

        if (errCons) throw errCons;

        let totalCons = 0;          // Todo lo consumido (Pagado + Pendiente)
        let consumosPendientes = 0; // Solo lo que falta pagar ("A Cuenta" o "Pendiente")
        let tablaCons = '';

        if (consumos && consumos.length > 0) {
            consumos.forEach(item => {
                const montoFila = parseFloat(item.total_consumo) || (parseInt(item.cantidad) * parseFloat(item.precio_unitario)) || 0; 
                totalCons += montoFila;
                
                if (item.estado_pago !== 'Pagado') {
                    consumosPendientes += montoFila;
                }
                
                const f = new Date(item.fecha_registro); 
                const fechaAmigable = f.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit' }) + 
                                      ` ${f.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false })}`;

                const badgePago = item.estado_pago === 'Pagado' 
                    ? `<span style="color:#27ae60; font-size:10px; font-weight:bold;">[PAGADO]</span>` 
                    : `<span style="color:#800020; font-size:10px; font-weight:bold;">[A CUENTA]</span>`;

                tablaCons += `
                    <div class="consumo-item-lista">
                        <div class="c-info">
                            <span class="c-qty">${item.cantidad || 1}x</span>
                            <span class="c-name">${item.descripcion} ${badgePago}</span>
                            <span class="c-date">${fechaAmigable}</span>
                        </div>
                        <div class="c-price">S/ ${montoFila.toFixed(2)}</div>
                    </div>`;
            });
        }

        // ==========================================================================
        // 3. TRAER HISTORIAL DE PAGOS Y FILTRAR POR AUDITORÍA DE CONCEPTOS
        // ==========================================================================
        const { data: pagosRegistrados, error: errSumPagos } = await supabase
            .from('pagos')
            .select('adelanto_monto, monto_soles, concepto')
            .eq('id_reserva', reserva.id);

        if (errSumPagos) throw errSumPagos;

        const totalAbonadoHospedaje = pagosRegistrados 
            ? pagosRegistrados
                .filter(p => p.concepto !== 'Consumo') 
                .reduce((acc, p) => acc + (parseFloat(p.monto_soles || p.adelanto_monto) || 0), 0) 
            : 0;

        // ==========================================================================
        // 4. CÁLCULOS FINALES MULTI-MONEDA (Matemática Corregida - Auditoría Hotel Central)
        // ==========================================================================
        const tarifaBase = parseFloat(reserva.tarifa_pactada) || 0;

        const fechaIngreso = new Date(reserva.check_in_fecha);
        const fechaSalida = new Date(reserva.check_out_fecha);
        const diferenciaTiempo = Math.abs(fechaSalida - fechaIngreso);
        const nochesCalculadas = Math.ceil(diferenciaTiempo / (1000 * 60 * 60 * 24)) || 1;

        let totalEstanciaOriginal = tarifaBase * nochesCalculadas;
        const tipoCambio = parseFloat(reserva.tipo_cambio) || 1.000;

        // Conversión limpia a Soles si la tarifa pactada está en Dólares
        let totalAlojamientoSoles = reserva.moneda === 'USD' 
            ? totalEstanciaOriginal * tipoCambio 
            : totalEstanciaOriginal;

        // 🛠️ VALIDACIÓN DE BOOLEANOS DESDE LA BASE DE DATOS
        const tieneEarly = reserva.tiene_early_checkin === true || reserva.tiene_early_checkin === 'true';
        const tieneLate = reserva.tiene_late_checkout === true || reserva.tiene_late_checkout === 'true';

        // 🛠️ ASIGNACIÓN DINÁMICA DE CARGOS EN BASE A LA TARIFA PACTADA POR NOCHE
        const cargoEarly = tieneEarly ? (parseFloat(reserva.cargo_early_checkin) || (totalAlojamientoSoles / nochesCalculadas / 2) || 50) : 0;
        const cargoLate = tieneLate ? (parseFloat(reserva.cargo_late_checkout) || (totalAlojamientoSoles / nochesCalculadas / 2) || 50) : 0;

        // 🔥 FÓRMULA INTEGRAL: (Hospedaje Puro + Early + Late)
        const subtotalCargosHabitacion = totalAlojamientoSoles + cargoEarly + cargoLate;
        
        // Saldo final restando lo que ya se abonó a cuenta de hospedaje
        const saldoTotalPendiente = parseFloat(((subtotalCargosHabitacion + consumosPendientes) - totalAbonadoHospedaje).toFixed(2));

        console.log("--- NUEVA AUDITORÍA DE SALDOS ---");
        console.log("Alojamiento Puro en Soles:", totalAlojamientoSoles);
        console.log("¿Tiene Early Check-In?:", tieneEarly);
        console.log("Cargo Early Check-In Calculado:", cargoEarly);
        console.log("¿Tiene Late Check-Out?:", tieneLate);
        console.log("Cargo Late Check-Out Calculado:", cargoLate);
        console.log("Subtotal Habitación (Todo Sumado):", subtotalCargosHabitacion);
        console.log("Consumos Pendientes:", consumosPendientes);
        console.log("Total Abonado Filtrado:", totalAbonadoHospedaje);
        console.log("Saldo Neto Pendiente Calculado:", saldoTotalPendiente);
        console.log("---------------------------------");

        Swal.fire({
            title: `<div class="modal-header-gestion">
                        <div class="header-left">
                            <span class="room-tag">HABITACIÓN ${hab.numero}</span>
                            <small>${hab.tipo || 'Boutique'}</small>
                        </div>
                        <div class="badge-status-room">OCUPADA</div>
                    </div>`,
            width: '1000px',
            customClass: { popup: 'hotel-modal-custom' },
            html: `
                <div class="gestion-container">
                    <div class="ficha-huesped">
                        <div class="ficha-row">
                            <div class="ficha-col span-2">
                                <label><i class="fas fa-user-circle"></i> Huésped Titular</label>
                                <p class="val-main">${hInfo.nombres_apellidos || 'No asignado'}</p>
                                <p class="val-sub">${hInfo.documento_num || ''} • <b>Nacionalidad:</b> ${hInfo.nacionalidad || 'Peruana'}</p>
                            </div>
                            <div class="ficha-col">
                                <label><i class="fas fa-id-card"></i> Contacto</label>
                                <p>${hInfo.telefono || 'No registrado'}</p>
                                <p class="val-sub">${hInfo.correo || 'Sin correo'}</p>
                            </div>
                            <div class="ficha-col">
                                <label><i class="fas fa-concierge-bell"></i> Medio de Reserva</label>
                                <p><span class="badge-medio">${(reserva.medio_reserva || 'Presencial').toUpperCase()}</span></p>
                            </div>
                        </div>

                        <div class="ficha-row separator">
                            <div class="ficha-col">
                                <label><i class="fas fa-sign-in-alt"></i> Fecha Ingreso</label>
                                <p><b>${reserva.check_in_fecha}</b></p>
                                <p class="val-sub">
                                    <i class="fa-solid fa-bolt" style="color: ${cargoEarly > 0 ? '#d4a017' : '#999'}"></i> 
                                    ${cargoEarly > 0 ? `Early Check-In (S/ ${cargoEarly.toFixed(2)})` : 'Horario estándar'}
                                </p>
                            </div>
                        
                            <div class="ficha-col">
                                <label><i class="fas fa-sign-out-alt"></i> Fecha Salida</label>
                                <p><b style="color: #800020;">${reserva.check_out_fecha}</b></p>
                                <p class="val-sub">
                                    <i class="fa-regular fa-clock" style="color: ${cargoLate > 0 ? '#d4a017' : '#999'}"></i> 
                                    ${cargoLate > 0 ? `Late Check-Out (S/ ${cargoLate.toFixed(2)})` : 'Horario estándar'}
                                </p>
                            </div>
                        
                            <div class="ficha-col">
                                <label><i class="fas fa-users"></i> Pax & Servicios</label>
                                <p>${reserva.numero_personas || 1} Adultos</p>
                                <p class="val-sub">Cochera: <b>${reserva.cochera || 'No'}</b></p>
                            </div>
                            <div class="ficha-col">
                                <label><i class="fas fa-coffee"></i> Alimentación</label>
                                <p>${reserva.desayuno ? '🍳 Desayuno Incluido' : 'Solo Habitación'}</p>
                                <p class="val-sub">Traslado: ${reserva.traslado || 'No'}</p>
                            </div>
                        </div>

                        <div class="ficha-row highlight-pago">
                            <div class="ficha-col">
                                <label><i class="fas fa-tag"></i> Tarifa Pactada</label>
                                <p>${reserva.moneda || 'PEN'} ${tarifaBase.toFixed(2)}</p>
                                <small class="val-sub">${reserva.moneda === 'USD' ? `T.C. S/ ${tipoCambio.toFixed(3)}` : 'Tarifa en Soles'}</small>
                            </div>

                            <div class="ficha-col">
                                <label><i class="fas fa-calculator"></i> Total Hospedaje</label>
                                <p><b>S/ ${subtotalCargosHabitacion.toFixed(2)}</b></p>
                                <small class="val-sub" style="font-size:10px; color:#666;">
                                    Base: S/ ${totalAlojamientoSoles.toFixed(2)} ${cargoEarly + cargoLate > 0 ? `+ Adicionales` : ''}
                                </small>
                            </div>
                            
                            <div class="ficha-col" id="contenedor-pagos-info">
                                <label><i class="fas fa-hand-holding-dollar"></i> Abonos Realizados</label>
                                <p style="color: #27ae60; font-weight: bold;">
                                    - S/ ${totalAbonadoHospedaje.toFixed(2)}
                                </p>
                                <button id="btnGestionarPagos" class="btn-pagos-sm">
                                    <i class="fas fa-history"></i> HISTORIAL / ABONAR
                                </button>
                            </div>

                            <div class="ficha-col">
                                <label>${saldoTotalPendiente < 0 ? 'Saldo a Devolver' : 'Saldo Neto Pendiente'}</label>
                                <p><b style="color: ${saldoTotalPendiente < 0 ? '#27ae60' : '#800020'}; font-size: 1.2rem;">S/ ${Math.abs(saldoTotalPendiente).toFixed(2)}</b></p>
                            </div>
                        </div>

                        <div class="ficha-row audit-row">
                            <div class="ficha-col span-2">
                                <label><i class="fas fa-comment-dots"></i> Observaciones:</label>
                                <p class="text-obs">${reserva.notas ? `"${reserva.notas}"` : 'Sin notas adicionales.'}</p>
                            </div>
                            <div class="ficha-col">
                                <label><i class="fas fa-user-edit"></i></label>
                                <p class="val-audit"></p>
                            </div>
                            <div class="ficha-col">
                                <label><i class="fas fa-id-badge"></i> Registrado por:</label>
                                <p class="val-audit" style="font-size:11px;">${reserva.usuarios?.usuario || 'No asignado'}</p>
                            </div>
                        </div>
                    </div>

                    <div class="consumos-section">
                        <div class="section-title">
                            <span><i class="fas fa-utensils"></i> CONSUMOS ADICIONALES (TIENDA / CAFETERÍA)</span>
                            <button id="btnAddConsumo" class="btn-agregar-sm">+ CARGAR ITEM</button>
                        </div>
                        
                        <div class="lista-consumos">
                            ${tablaCons || '<div class="no-data">No se han registrado consumos en esta habitación.</div>'}
                        </div>

                        <div class="total-bar">
                            <div class="total-label">
                                <small>RESUMEN DE CONSUMOS</small>
                                <span>Por liquidar en check-out: <b>S/ ${consumosPendientes.toFixed(2)}</b></span>
                            </div>
                            <div class="total-monto">Total: S/ ${totalCons.toFixed(2)}</div>
                        </div>
                    </div>

                    <div class="gestion-container-footer" style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 15px;">
                        <button id="btnCerrarModal" class="btn-secundario">CERRAR PANEL</button>
                        <button id="btnFinalizarOut" class="btn-checkout-final">🏁 PROCESAR CHECK-OUT</button>
                    </div>
                </div>
            `,
            showConfirmButton: false,
            didOpen: () => {
                document.getElementById('btnAddConsumo').onclick = () => agregarConsumo(reserva.id, hab);
                document.getElementById('btnCerrarModal').onclick = () => Swal.close();
                
                document.getElementById('btnFinalizarOut').onclick = () => {
                    Swal.close(); 
                    realizarCheckOut(
                        reserva.id,              // 1. resId
                        hab,                     // 2. hab
                        reserva,                 // 3. rData
                        saldoTotalPendiente,     // 4. saldoNetoPendiente
                        totalCons                // 5. totalConsumos
                    );
                };
                
                document.getElementById('btnGestionarPagos').onclick = () => abrirModalHistorialPagos(reserva, hab);
            }
        });
    } catch (error) {
        console.error("Error abriendo panel 360°:", error);
        Swal.fire('Error', 'No se pudo cargar la información de la habitación ocupada.', 'error');
    }
}

/* ==========================================================================
   5.1. HISTORIAL Y REGISTRO DE ABONOS (CORREGIDO Y BLINDADO CONTRA DESFASES)
   ========================================================================== */
async function abrirModalHistorialPagos(reserva, hab) {
    try {
        const { data: listaPagos, error: errPagos } = await supabase
            .from('pagos')
            .select('*')
            .eq('id_reserva', reserva.id)
            .order('created_at', { ascending: true });

        if (errPagos) throw errPagos;

        const listaPagosHTML = (listaPagos && listaPagos.length > 0) 
            ? listaPagos.map((p, i) => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; border-bottom: 1px solid #eee; font-size: 13px;">
                    <span><b style="color: #800020;">#${i+1}</b> ${new Date(p.created_at).toLocaleDateString('es-PE')}</span>
                    <span style="color: #666; font-size: 11px;">${p.metodo_pago} ${p.nombre_recepcionista ? `(${p.nombre_recepcionista})` : ''} - <small>${p.concepto || 'Abono'}</small></span>
                    <span style="font-weight: bold; color: #27ae60;">S/ ${parseFloat(p.monto_soles || p.adelanto_monto).toFixed(2)}</span>
                </div>
            `).join('')
            : '<p style="text-align:center; color:#999; padding:10px;">No hay abonos registrados.</p>';

        const { value: nuevoAbono } = await Swal.fire({
            title: `<span style="font-family:'Playfair Display'; color:#800020; font-size: 20px;">Historial de Pagos</span>`,
            width: '450px',
            customClass: {
                popup: 'hotel-modal-custom', 
                confirmButton: 'btn-dorado-full', 
                cancelButton: 'btn-secundario'
            },
            html: `
                <div style="text-align: left; font-family: 'Lato', sans-serif;">
                    <div style="max-height: 180px; overflow-y: auto; margin-bottom: 20px; border: 1px solid #e0e0e0; border-radius: 8px; background: #fff;">
                        ${listaPagosHTML}
                    </div>
                    
                    <div style="background: #fdfaf5; padding: 15px; border-radius: 8px; border: 1px dashed #d4af37;">
                        <label style="font-size: 10px; font-weight: bold; color: #800020; display: block; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px;">
                            Registrar Nuevo Abono
                        </label>
                        <div style="display: flex; gap: 8px;">
                            <input id="sw-monto-pago" type="number" class="swal2-input" placeholder="Monto S/" style="margin:0; flex: 1; height: 38px; font-size: 14px;">
                            <select id="sw-metodo-pago" class="swal2-select" style="margin:0; flex: 1; height: 38px; font-size: 13px;">
                                <option value="Efectivo">💵 Efectivo</option>
                                <option value="Tarjeta">💳 Tarjeta</option>
                                <option value="Transferencia">📱 Transferencia Bancaria</option>
                                <option value="Yape">📱 Yape</option>
                            </select>
                        </div>
                    </div>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: 'REGISTRAR PAGO',
            cancelButtonText: 'VOLVER',
            buttonsStyling: false,
            preConfirm: () => {
                const monto = parseFloat(document.getElementById('sw-monto-pago').value);
                const metodo = document.getElementById('sw-metodo-pago').value;
                if (!monto || monto <= 0) {
                    Swal.showValidationMessage('Ingrese un monto válido');
                    return false;
                }
                return { monto, metodo };
            }
        });

        if (nuevoAbono) {
            const formReserva = document.getElementById('formNuevaReserva');
            
            const idUsuarioActivo = (formReserva && formReserva.dataset.idUsuarioLogueado) || 
                                   localStorage.getItem("id_usuario_logueado") || 
                                   localStorage.getItem("id_usuario") ||
                                   localStorage.getItem("id_usuario_actual"); 
                                   
            const turnoActivo = localStorage.getItem("turno_activo") || "Noche"; 
            const nombreRecepcionista = localStorage.getItem("nombre_recepcionista") || "Recepcionista en Turno";

            // 🏨 CONTROL HORARIO SEGURO PARA TRUJILLO (ZONA HORARIA LIMA)
            const ahora = new Date();
            const horaPeru = parseInt(ahora.toLocaleTimeString('en-US', { timeZone: 'America/Lima', hour12: false, hour: '2-digit' }));
            const formateadorFecha = new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' });

            let fechaOperativaPago = formateadorFecha.format(ahora); // Por defecto "YYYY-MM-DD" hoy
            let turnoCalculado = turnoActivo;

            // El truco de la madrugada estricto (00:00 AM a 06:59 AM)
            if (horaPeru >= 0 && horaPeru < 7) {
                turnoCalculado = 'Noche';
                const milisegundosEnUnDia = 24 * 60 * 60 * 1000;
                const ayer = new Date(ahora.getTime() - milisegundosEnUnDia);
                fechaOperativaPago = formateadorFecha.format(ayer);
                console.log(`🌙 Auditoría Abonos: Pago en madrugada. Asignado a Fecha Operativa: ${fechaOperativaPago} - Turno: Noche`);
            } else if (horaPeru >= 7 && horaPeru < 14) {
                turnoCalculado = 'Mañana';
            } else if (horaPeru >= 14 && horaPeru < 21) {
                turnoCalculado = 'Tarde';
            } else {
                turnoCalculado = 'Noche';
            }

            // Generamos un string de hora limpio para evitar alteraciones horarias de Supabase
            const horaLimpia = ahora.toLocaleTimeString('en-US', { 
                hour12: false, 
                hour: '2-digit', 
                minute: '2-digit', 
                second: '2-digit' 
            });

            // Inserción Blindada en la Base de Datos
            const { error: errInsertPago } = await supabase
                .from('pagos')
                .insert([{
                    id_reserva: reserva.id,
                    id_usuario: idUsuarioActivo,
                    turno: turnoCalculado,
                    nombre_recepcionista: nombreRecepcionista,
                    adelanto_monto: nuevoAbono.monto,
                    moneda: 'PEN', 
                    tipo_cambio_usado: 1.000, 
                    monto_soles: nuevoAbono.monto,
                    metodo_pago: nuevoAbono.metodo,
                    concepto: 'Abono',
                    fecha_pago: fechaOperativaPago,
                    hora_pago: horaLimpia // 🎯 ¡Crucial! Evita desfases automáticos del servidor
                }]);

            if (errInsertPago) throw errInsertPago;

            Swal.fire({ icon: 'success', title: `Abono registrado con éxito por ${nombreRecepcionista}`, toast: true, position: 'top-end', timer: 2500, showConfirmButton: false });
            
            // Recargar interfaz de gestión correspondiente
            if (typeof abrirModalGestionOcupada === 'function') {
                abrirModalGestionOcupada(hab);
            }
        }
    } catch (e) {
        console.error("Error gestionando abonos en Supabase:", e);
        Swal.fire('Error', 'No se pudo procesar el historial de pagos: ' + (e.message || e), 'error');
    }
}

/* ==========================================================================
   6. AGREGAR CONSUMO (CORREGIDO: T.C. DE PAGO INMEDIATO FIJADO EN 1.000)
   ========================================================================== */
async function agregarConsumo(resId, hab) {
    try {
        const { data: catalogo, error: errCat } = await supabase
            .from('catalogo_consumos')
            .select('id, nombre, precio_unitario, categoria')
            .eq('activo', true)
            .order('categoria', { ascending: true })
            .order('nombre', { ascending: true });

        if (errCat) throw errCat;
        if (!catalogo || catalogo.length === 0) {
            Swal.fire('Catálogo Vacío', 'No hay productos registrados o activos en el catálogo.', 'warning');
            return;
        }

        const { data: rData, error: errRes } = await supabase
            .from('reservas')
            .select('*')
            .eq('id', resId)
            .single();

        if (errRes) throw errRes;

        const opcionesSelect = catalogo.map(p => 
            `<option value="${p.id}" data-precio="${p.precio_unitario}">[${p.categoria}] ${p.nombre}</option>`
        ).join('');

        const { value: formValues } = await Swal.fire({
            title: `<span style="font-family: 'Playfair Display', serif; color: #800020; font-size: 22px;">Nuevo Cargo / Consumo</span>`,
            width: '460px',
            customClass: {
                popup: 'hotel-modal-custom',
                confirmButton: 'btn-dorado-full', 
                cancelButton: 'btn-cancelar-soft'
            },
            html: `
                <div style="text-align: left; font-family: 'Lato', sans-serif; padding: 10px;">
                    <label style="font-size: 11px; color: #5d4037; font-weight: bold; text-transform: uppercase;">Seleccionar Producto</label>
                    <select id="sw-id-catalogo" class="swal2-select" style="margin: 5px 0 15px 0; width: 100%; font-size: 14px; height: 42px; border-radius: 5px;">
                        ${opcionesSelect}
                    </select>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        <div>
                            <label style="font-size: 11px; color: #5d4037; font-weight: bold; text-transform: uppercase;">Cantidad</label>
                            <input id="sw-cant" type="number" class="swal2-input" value="1" min="1" style="margin: 5px 0; width: 100%; border-radius: 5px; height: 38px; font-size: 14px;">
                        </div>
                        <div>
                            <label style="font-size: 11px; color: #5d4037; font-weight: bold; text-transform: uppercase;">Precio Unit. (S/)</label>
                            <input id="sw-pre" type="number" step="0.10" class="swal2-input" style="margin: 5px 0; width: 100%; border-radius: 5px; height: 38px; font-size: 14px; background-color: #f5f5f5;" readonly>
                        </div>
                    </div>

                    <div style="margin-top: 15px; padding: 12px; background: #fdfaf5; border-radius: 8px; border: 1px solid #d4af37;">
                        <label style="display: flex; align-items: center; cursor: pointer; font-size: 13px; color: #800020; font-weight: bold; margin: 0;">
                            <input id="sw-pagado" type="checkbox" style="margin-right: 10px; width: 18px; height: 18px; accent-color: #800020;"> 
                            ¿PAGÓ EN EL MOMENTO?
                        </label>
                        
                        <div id="metodo-pago-box" style="display: none; margin-top: 12px;">
                            <label style="font-size: 10px; color: #5d4037; font-weight: bold; text-transform: uppercase;">Método de Pago</label>
                            <select id="sw-metodo" class="swal2-select" style="margin: 5px 0 0 0; width: 100%; font-size: 13px; height: 35px;">
                                <option value="Efectivo">💵 Efectivo</option>
                                <option value="Tarjeta">💳 Tarjeta</option>
                                <option value="Yape">📱 Yape</option>
                                <option value="Transferencia">📱 Transferencia</option>
                            </select>
                        </div>
                    </div>

                    <div id="subtotal-preview" style="margin-top: 20px; padding: 15px; background: #800020; border-radius: 8px; text-align: center; color: white;">
                        <span style="font-size: 11px; color: #5d4037; text-transform: uppercase; opacity: 0.9;">Monto a registrar:</span>
                        <strong id="preview-monto" style="display: block; font-size: 24px; font-weight: 900; margin-top: 2px; color: #d4af37;">S/ 0.00</strong>
                    </div>
                </div>`,
            showCancelButton: true,
            confirmButtonText: '✅ REGISTRAR CARGO',
            cancelButtonText: 'CANCELAR',
            focusConfirm: false,
            didOpen: () => {
                const selectCat = document.getElementById('sw-id-catalogo');
                const inputCant = document.getElementById('sw-cant');
                const inputPre = document.getElementById('sw-pre');
                const checkPagado = document.getElementById('sw-pagado');
                const metodoBox = document.getElementById('metodo-pago-box');
                const displaySubtotal = document.getElementById('preview-monto');
                
                const actualizarFormulario = () => {
                    const opcionSeleccionada = selectCat.options[selectCat.selectedIndex];
                    const precioUnitario = parseFloat(opcionSeleccionada.getAttribute('data-precio')) || 0;
                    
                    inputPre.value = precioUnitario.toFixed(2);
                    const cantidad = parseInt(inputCant.value) || 0;
                    displaySubtotal.innerText = `S/ ${(cantidad * precioUnitario).toFixed(2)}`;
                };
                
                selectCat.onchange = actualizarFormulario;
                inputCant.oninput = actualizarFormulario;
                checkPagado.onchange = () => {
                    metodoBox.style.display = checkPagado.checked ? 'block' : 'none';
                };

                actualizarFormulario();
            },
            preConfirm: () => {
                const idCatalogo = document.getElementById('sw-id-catalogo').value;
                const selectCat = document.getElementById('sw-id-catalogo');
                const desc = selectCat.options[selectCat.selectedIndex].text.split('] ')[1] || 'Consumo';
                const cant = parseInt(document.getElementById('sw-cant').value);
                const pre = parseFloat(document.getElementById('sw-pre').value);
                const pagado = document.getElementById('sw-pagado').checked;
                const metodo = document.getElementById('sw-metodo').value;

                if (!idCatalogo || isNaN(cant) || cant <= 0) {
                    Swal.showValidationMessage('Seleccione un producto y cantidad válida');
                    return false;
                }
                return { idCatalogo, desc, cant, pre, pagado, metodo };
            }
        });

        if (formValues) {
            const formReserva = document.getElementById('formNuevaReserva');
            const idUsuarioActivo = (formReserva && formReserva.dataset.idUsuarioLogueado) || 
                                   localStorage.getItem("id_usuario_logueado") || 
                                   "CAMBIA_ESTO_POR_TU_UUID_REAL_DE_SUPABASE_AUTH"; 
                                     
            const turnoActivo = localStorage.getItem("turno_activo") || "Mañana"; 
            const nombreRecepcionista = localStorage.getItem("nombre_recepcionista") || "Recepcionista en Turno";
            
            const montoCalculado = Number((formValues.cant * formValues.pre).toFixed(2));
            const estadoPagoFinal = formValues.pagado ? "Pagado" : "Pendiente";

            // 🏨 CONTROL HORARIO UNIFICADO (ZONA HORARIA LIMA/TRUJILLO)
            const ahora = new Date();
            const horaPeru = parseInt(ahora.toLocaleTimeString('en-US', { timeZone: 'America/Lima', hour12: false, hour: '2-digit' }));
            const formateadorFecha = new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' });

            let fechaOperativa = formateadorFecha.format(ahora); 
            let turnoCalculado = turnoActivo;

            // El truco de la madrugada estricto (00:00 AM a 06:59 AM)
            if (horaPeru >= 0 && horaPeru < 7) {
                turnoCalculado = 'Noche';
                const milisegundosEnUnDia = 24 * 60 * 60 * 1000;
                const ayer = new Date(ahora.getTime() - milisegundosEnUnDia);
                fechaOperativa = formateadorFecha.format(ayer);
                console.log(`🌙 Auditoría Consumos: Registro en madrugada. Asignado a Fecha Operativa: ${fechaOperativa} - Turno: Noche`);
            } else if (horaPeru >= 7 && horaPeru < 14) {
                turnoCalculado = 'Mañana';
            } else if (horaPeru >= 14 && horaPeru < 21) {
                turnoCalculado = 'Tarde';
            } else {
                turnoCalculado = 'Noche';
            }

            // Generamos un string de hora limpio HH:MM:SS local para evitar desvíos del servidor
            const horaLimpia = ahora.toLocaleTimeString('en-US', { 
                hour12: false, 
                hour: '2-digit', 
                minute: '2-digit', 
                second: '2-digit' 
            });

            // A) INSERTAR EN LA TABLA CONSUMOS
            const { error: errInsertCons } = await supabase
                .from('consumos')
                .insert([{
                    id_reserva: resId,
                    id_usuario: idUsuarioActivo,
                    id_catalogo: formValues.idCatalogo,
                    descripcion: formValues.desc.toUpperCase(),
                    cantidad: formValues.cant,
                    precio_unitario: formValues.pre,
                    estado_pago: estadoPagoFinal,
                    fecha_registro: fechaOperativa // Forzado con la fecha operativa correcta
                }]);

            if (errInsertCons) throw errInsertCons;

            // B) SI SE PAGÓ EN EL ACTO, SE GENERA SU FILA EN LA TABLA PAGOS
            if (formValues.pagado) {
                const { error: errInsertPago } = await supabase
                    .from('pagos')
                    .insert([{
                        id_reserva: resId,
                        id_usuario: idUsuarioActivo,
                        turno: turnoCalculado, // Asigna dinámicamente el turno correcto según la hora real
                        nombre_recepcionista: nombreRecepcionista,
                        adelanto_monto: montoCalculado,
                        moneda: 'PEN',
                        tipo_cambio_usado: 1.000, 
                        monto_soles: montoCalculado,
                        metodo_pago: formValues.metodo,
                        concepto: 'Consumo',
                        fecha_pago: fechaOperativa, // Sincronizado milimétricamente con el consumo
                        hora_pago: horaLimpia // 🎯 ¡Crucial! Evita desfases horarias automáticos de Supabase
                    }]);

                if (errInsertPago) throw errInsertPago;
            }

            Swal.fire({
                icon: 'success',
                title: formValues.pagado ? `Venta cobrada con éxito por ${nombreRecepcionista}` : 'Cargo añadido a la cuenta del huésped',
                toast: true,
                position: 'top-end',
                timer: 2500,
                showConfirmButton: false
            });

            abrirModalGestionOcupada(hab); 
        }
        
    } catch (e) {
        console.error("Error procesando la transacción de consumo:", e);
        Swal.fire('Error', 'No se pudo guardar el consumo en la base de datos.', 'error');
    }
}
/* ==========================================================================
   7. CHECK-OUT SIMPLIFICADO (CORREGIDO CON ZONA HORARIA LIMA/TRUJILLO)
   ========================================================================== */
async function realizarCheckOut(resId, hab, rData, saldoNetoPendiente, totalConsumos = 0) {
    
    if (typeof resId === 'object' && resId !== null) {
        resId = resId.id || resId.id_reserva || resId.uuid;
    }
    if (!resId) {
        console.error("❌ Error Crítico: No se pudo rescatar el ID de la reserva de ninguna fuente.", { resId, rData });
        Swal.fire('Error de Sistema', 'No se encontró el identificador de la reserva.', 'error');
        return;
    }
    const granTotalAPagar = Number(parseFloat(saldoNetoPendiente).toFixed(2)); 
    
    // Obtenemos los consumos reales vinculados
    let listaConsumos = [];
    try {
        const { data: dataCons } = await supabase.from('consumos').select('*').eq('id_reserva', resId);
        if (dataCons) listaConsumos = dataCons;
    } catch (e) {
        console.warn("No se pudo obtener la tabla de consumos:", e);
    }

    // Traer la suma de pagos históricos directamente de la base de datos
    let totalAbonosHistoricos = 0;
    try {
        const { data: dataPagos } = await supabase.from('pagos').select('monto_soles').eq('id_reserva', resId);
        if (dataPagos) {
            totalAbonosHistoricos = dataPagos.reduce((sum, p) => sum + parseFloat(p.monto_soles || 0), 0);
        }
    } catch (e) {
        console.warn("No se pudo calcular los abonos históricos desde la tabla pagos:", e);
        totalAbonosHistoricos = parseFloat(rData.AdelantoMonto || rData.adelanto_monto || 0);
    }

    // Interfaz dinámica simplificada para SweetAlert2 (Con los estilos de Hotel Central)
    const tituloModal = granTotalAPagar <= 0 ? "Finalizar Estadía" : "Liquidación de Cuenta Final";
    
    const bloqueLiquidacion = granTotalAPagar <= 0 
        ? `<div style="text-align: center; padding: 15px; background: #e8f5e9; border-radius: 10px; border: 1px dashed #27ae60; margin-top: 15px;">
               <span style="font-weight: bold; color: #2e7d32; text-transform: uppercase; font-size: 13px;">Cuenta Saldada</span>
               <p style="font-size: 12px; color: #666; margin: 5px 0 0 0;">No se registran montos pendientes para cobro.</p>
           </div>`
        : `<div style="background: #800020; padding: 15px; border-radius: 10px; text-align: center; color: white; margin-top: 15px;">
               <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; opacity: 0.9;">MONTO TOTAL A COBRAR EN CAJA:</span>
               <div style="font-size: 26px; font-weight: 900; margin-top: 5px;">S/ ${granTotalAPagar.toFixed(2)}</div>
           </div>`;

    const resultadoSwal = await Swal.fire({
        title: `<span style="font-family: 'Playfair Display', serif; color: #800020; font-size: 22px; font-weight: bold;">${tituloModal}</span>`,
        width: '420px',
        html: `
            <div style="font-family: 'Lato', sans-serif; text-align: left;">
                <div style="background: #fdfaf5; padding: 12px; border-radius: 10px; border: 1px solid #d4af37; margin-bottom: 15px; font-size: 13px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                        <span>📌 Saldo Pendiente Actual:</span>
                        <span style="font-weight: bold; color: #800020;">S/ ${granTotalAPagar.toFixed(2)}</span>
                    </div>
                </div>

                ${bloqueLiquidacion}
                
                ${granTotalAPagar > 0 ? `
                <div style="margin-top: 15px;">
                    <label style="font-size: 11px; font-weight: bold; color: #5d4037; text-transform: uppercase;">MÉTODO DE PAGO FINAL:</label>
                    <select id="metodoPago" class="swal2-select" style="width: 100%; margin: 8px 0 0 0; border-color: #d4af37; height: 40px; font-size: 13px; border-radius: 5px;">
                        <option value="Efectivo">💵 Efectivo</option>
                        <option value="Tarjeta">💳 Tarjeta</option>
                        <option value="Yape">📱 Yape</option>
                        <option value="Transferencia">📱 Transferencia</option>
                    </select>
                </div>` : ''}
            </div>`,
        showCancelButton: true,
        showDenyButton: granTotalAPagar > 0,
        confirmButtonText: '🖨️ PAGAR Y FINALIZAR',
        denyButtonText: 'SÓLO REGISTRAR',
        cancelButtonText: 'CANCELAR',
        confirmButtonColor: '#800020',
        denyButtonColor: '#7d6c57',
        preConfirm: () => document.getElementById('metodoPago')?.value || 'Efectivo',
        preDeny: () => document.getElementById('metodoPago')?.value || 'Efectivo'
    });

    if (resultadoSwal.isDismissed) return; 

    try {
        const idUsuarioActivo = localStorage.getItem("id_usuario_logueado") || rData.id_usuario; 
        const turnoActivo = localStorage.getItem("turno_activo") || "Noche"; 
        const nombreResponsable = localStorage.getItem("nombre_recepcionista") || "Recepcionista";
        
        let metodoSeleccionadoRaw = "Efectivo";
        if (resultadoSwal.isConfirmed) {
            metodoSeleccionadoRaw = resultadoSwal.value;
        } else if (resultadoSwal.isDenied) {
            metodoSeleccionadoRaw = resultadoSwal.denyValue;
        }

        // 🏨 CONTROL HORARIO PRECISO (EVITA EL DESFASE DE .toISOString)
        const ahora = new Date();
        const horaPeru = parseInt(ahora.toLocaleTimeString('en-US', { timeZone: 'America/Lima', hour12: false, hour: '2-digit' }));
        const formateadorFecha = new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' });

        let fechaOperativa = formateadorFecha.format(ahora); // Obtiene "YYYY-MM-DD" local exacto
        let turnoCalculado = turnoActivo;

        // Aplicación del truco de la madrugada hotelera (00:00 AM a 06:59 AM)
        if (horaPeru >= 0 && horaPeru < 7) {
            turnoCalculado = 'Noche';
            const milisegundosEnUnDia = 24 * 60 * 60 * 1000;
            const ayer = new Date(ahora.getTime() - milisegundosEnUnDia);
            fechaOperativa = formateadorFecha.format(ayer);
            console.log(`🌙 Auditoría Check-out: Ejecución en madrugada. Fecha Operativa fijada en: ${fechaOperativa}`);
        } else if (horaPeru >= 7 && horaPeru < 14) {
            turnoCalculado = 'Mañana';
        } else if (horaPeru >= 14 && horaPeru < 21) {
            turnoCalculado = 'Tarde';
        } else {
            turnoCalculado = 'Noche';
        }

        const horaOperativa = ahora.toLocaleTimeString('en-US', { 
            timeZone: 'America/Lima',
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        // 3. Inserción limpia a la tabla pagos si el saldo cobrado es mayor a 0
        if (granTotalAPagar > 0) {
            const { error: errorPago } = await supabase
                .from('pagos')
                .insert([{
                    id_reserva: resId,
                    id_usuario: idUsuarioActivo,
                    turno: turnoCalculado, // Dinámico y auditado
                    nombre_recepcionista: nombreResponsable,
                    adelanto_monto: granTotalAPagar, 
                    moneda: rData.moneda || 'PEN',
                    tipo_cambio_usado: parseFloat(rData.tipo_cambio) || 1.000,
                    monto_soles: granTotalAPagar,
                    metodo_pago: metodoSeleccionadoRaw, 
                    concepto: "Saldo",
                    fecha_pago: fechaOperativa, 
                    hora_pago: horaOperativa    
                }]);

            if (errorPago) throw errorPago;
        }

        // 🖨️ Ejecutar impresión de ticket si seleccionó Pagar y Finalizar
        if (resultadoSwal.isConfirmed && typeof imprimirTicket === 'function') {
            imprimirTicket(rData, hab, listaConsumos, totalConsumos, granTotalAPagar, totalAbonosHistoricos, metodoSeleccionadoRaw, nombreResponsable);
        }

        // 4. Actualizar consumos vinculados
        if (listaConsumos.length > 0) {
            await supabase.from('consumos').update({ estado_pago: 'Pagado' }).eq('id_reserva', resId);
        }

        // 5. Finalizar Reserva en Supabase
        await supabase.from('reservas').update({ 
            estado_reserva: "Finalizada", 
            check_out_fecha: fechaOperativa, 
            check_out_hora: horaOperativa,
            updated_at: new Date().toISOString()
        }).eq('id', resId);

        // 6. Habitación a Limpieza
        const targetHabId = hab?.id || rData.id_habitacion;
        if (targetHabId) {
            await supabase.from('habitaciones').update({ estado: "Limpieza" }).eq('id', targetHabId);
        }

        Swal.fire({ icon: 'success', title: 'Check-out Completado', timer: 1500, showConfirmButton: false });

        setTimeout(() => {
            if (typeof inicializarDashboard === 'function') inicializarDashboard();
            else window.location.reload();
        }, 500);

    } catch (error) {
        console.error("Error en checkout:", error);
        Swal.fire('Error', 'No se pudieron actualizar los datos.', 'error');
    }
}
/* ==========================================================================
   IMPRESIÓN DE TICKET TÉRMICO (80MM) - DESGLOSADO Y COMPLETO
   ========================================================================== */
async function imprimirTicket(rData, hab, consumos, totalConsumos, pagoActual, abonosPrevios, metodoPago, nombreAtendido) {
    const ahora = new Date();
    const horaActual = ahora.getHours();
    
    // --- TRUCO DE MADRUGADA SINCRO-TICKET ---
    let fechaEmisionVisual = ahora.toLocaleDateString('es-PE');
    if (horaActual >= 0 && horaActual < 6) {
        const fechaTemporal = new Date();
        fechaTemporal.setDate(fechaTemporal.getDate() - 1);
        fechaEmisionVisual = fechaTemporal.toLocaleDateString('es-PE') + " (Aud. Nocturna)";
    }

    const fechaEmision = fechaEmisionVisual + ' ' + ahora.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });

    const ventana = window.open('', '_blank', 'width=320,height=700');
    if (!ventana) {
        alert("Por favor habilita los pop-ups para imprimir el comprobante.");
        return;
    }

    const formatF = (f) => {
        if (!f) return "00/00";
        const p = f.split('-');
        return p.length === 3 ? `${p[2]}/${p[1]}` : f;
    };

    // 1. Cálculo matemático de noches reales de estadía (Usamos la fecha corregida si viene en el rData)
    const fechaIngreso = new Date(rData.check_in_fecha);
    
    // Si se hace de madrugada, forzamos que use la fecha operativa contable para calcular las noches reales
    let fechaSalidaCalculo = rData.check_out_fecha;
    if (horaActual >= 0 && horaActual < 6) {
        const fTemp = new Date();
        // Aseguramos que la diferencia de días contemple la pernoctación completa
        fechaSalidaCalculo = fTemp.toISOString().split('T')[0]; 
    }
    
    const fechaSalida = new Date(fechaSalidaCalculo);
    const diferenciaTiempo = Math.abs(fechaSalida - fechaIngreso);
    const nochesCalculadas = Math.ceil(diferenciaTiempo / (1000 * 60 * 60 * 24)) || 1;

    const tarifaPorNoche = parseFloat(rData.tarifa_pactada || 0);
    const totalNochesHospedaje = tarifaPorNoche * nochesCalculadas;

    // 2. Extracción segura de cargos Early y Late usando la lógica booleana sincronizada
    const tieneEarly = rData.tiene_early_checkin === true || rData.tiene_early_checkin === 'true';
    const tieneLate = rData.tiene_late_checkout === true || rData.tiene_late_checkout === 'true';

    const cargoEarly = tieneEarly ? (parseFloat(rData.cargo_early_checkin) || 0) : 0;
    const cargoLate = tieneLate ? (parseFloat(rData.cargo_late_checkout) || (totalNochesHospedaje / nochesCalculadas / 2) || 0) : 0;
    
    const subtotalHospedajeCompleto = totalNochesHospedaje + cargoEarly + cargoLate;

    // Bloques HTML dinámicos para los adicionales de la habitación
    let htmlEarly = cargoEarly > 0 ? `<tr><td>(+) Early Check-In</td><td class="text-right">S/ ${cargoEarly.toFixed(2)}</td></tr>` : "";
    let htmlLate = cargoLate > 0 ? `<tr><td>(+) Late Check-Out</td><td class="text-right">S/ ${cargoLate.toFixed(2)}</td></tr>` : "";

    const filasHospedajeHTML = `
        <tr>
            <td>Alojamiento (${nochesCalculadas} noc. x S/ ${tarifaPorNoche.toFixed(2)})</td>
            <td class="text-right">S/ ${totalNochesHospedaje.toFixed(2)}</td>
        </tr>
        ${htmlEarly}
        ${htmlLate}
    `;

    // 3. Renderizado detallado de la tabla de consumos en formato Cantidad x Descripción | Unitario | Total
    let filasConsumos = "";
    if (consumos && consumos.length > 0) {
        filasConsumos = consumos.map(c => {
            const qty = parseInt(c.cantidad || 1);
            const totalFila = parseFloat(c.total_consumo) || (qty * parseFloat(c.precio_unitario || 0));
            const unitario = parseFloat(c.precio_unitario) || (totalFila / qty);

            return `
                <tr>
                    <td>${qty}x ${c.descripcion} <br> <small style="color:#555;">(c/u S/ ${unitario.toFixed(2)})</small></td>
                    <td class="text-right" style="vertical-align: bottom;">S/ ${totalFila.toFixed(2)}</td>
                </tr>
            `;
        }).join('');
    } else {
        filasConsumos = `<tr><td colspan="2" style="font-style:italic; color:#666; text-align:center; padding: 5px 0;">Sin consumos registrados</td></tr>`;
    }

    // 4. Gran Total final (Hospedaje Completo con adicionales + Consumos Totales)
    const totalMontoConsumos = parseFloat(totalConsumos || 0);
    const totalGlobalServicios = subtotalHospedajeCompleto + totalMontoConsumos;

    ventana.document.write(`
        <html>
        <head>
            <title>Ticket_Salida_Hab_${hab?.numero || rData.id_habitacion || 'PMS'}</title>
            <style>
                @page { margin: 0; }
                body { font-family: 'Courier New', monospace; width: 260px; padding: 10px; font-size: 11px; color: #000; line-height: 1.3; }
                .text-center { text-align: center; }
                .text-right { text-align: right; white-space: nowrap; }
                .divider { border-top: 1px dashed #000; margin: 6px 0; }
                table { width: 100%; border-collapse: collapse; margin-top: 4px; }
                td { padding: 3px 0; vertical-align: top; }
                th { padding: 4px 0; }
                .bold { font-weight: bold; }
                .section-title { font-size: 9px; font-weight: bold; background: #eee; padding: 2px; margin-top: 5px; text-transform: uppercase; }
                .total-final { font-size: 12px; font-weight: bold; border-top: 1px solid #000; }
            </style>
        </head>
        <body onload="setTimeout(() => { window.print(); window.close(); }, 350);">
            <div class="text-center">
                <span class="bold" style="font-size: 14px;">HOTEL CENTRAL</span><br>
                <span style="font-size: 9px;">RUC: 20601852153</span><br>
                <span style="font-size: 9px;">Jr. Simón Bolívar 355 - Trujillo</span>
            </div>
            
            <div class="divider"></div>
            
            <div>
                <b>HABITACIÓN:</b> ${hab?.numero || rData.id_habitacion || 'N/A'}<br>
                <b>HUÉSPED:</b> ${(rData.huespedes?.nombres_apellidos || rData.huesped || 'REGISTRO CENTRAL').toUpperCase()}<br>
                <b>ESTADÍA:</b> ${formatF(rData.check_in_fecha)} al ${formatF(rData.check_out_fecha)}<br>
                <b>EMISIÓN:</b> ${fechaEmision}
            </div>
            
            <div class="section-title">I. DETALLE DE ALOJAMIENTO</div>
            <table>
                <tbody>
                    ${filasHospedajeHTML}
                    <tr style="border-top: 1px dotted #000; font-weight: bold;">
                        <td>SUBTOTAL HOSPEDAJE:</td>
                        <td class="text-right">S/ ${subtotalHospedajeCompleto.toFixed(2)}</td>
                    </tr>
                </tbody>
            </table>
            
            <div class="section-title">II. CONSUMOS ADICIONALES</div>
            <table>
                <tbody>
                    ${filasConsumos}
                    <tr style="border-top: 1px dotted #000; font-weight: bold;">
                        <td>SUBTOTAL CONSUMOS:</td>
                        <td class="text-right">S/ ${totalMontoConsumos.toFixed(2)}</td>
                    </tr>
                </tbody>
            </table>
            
            <div class="divider"></div>
            
            <table>
                <tr>
                    <td>TOTAL GENERAL ACUMULADO</td>
                    <td class="text-right bold">S/ ${totalGlobalServicios.toFixed(2)}</td>
                </tr>
                <tr>
                    <td>ABONOS ANTERIORES</td>
                    <td class="text-right" style="color: #555;">- S/ ${abonosPrevios.toFixed(2)}</td>
                </tr>
                <tr class="total-final">
                    <td style="padding-top:5px;">LIQUIDADO EN CAJA</td>
                    <td class="text-right" style="padding-top:5px;">S/ ${pagoActual.toFixed(2)}</td>
                </tr>
            </table>
            
            <div style="margin-top: 8px; font-size: 9px; line-height:1.4;">
                MÉTODO PAGO: <b>${metodoPago.toUpperCase()}</b><br>
                ATENDIDO POR: ${nombreAtendido.toUpperCase()}
            </div>
            
            <div class="divider"></div>
            
            <div class="text-center" style="font-size: 9px; margin-top: 4px;">
                *** Gracias por su estadía ***<br>
                Trujillo - Perú
            </div>
        </body>
        </html>
    `);
    ventana.document.close();
}

/* ==========================================================================
   EXTRA MODAL GESTIÓN HABITACIÓN EN LIMPIEZA (INTEGRADO)
   ========================================================================== */
async function abrirModalGestionLimpieza(hab) {
    try {
        // Estructura del modal minimalista
        Swal.fire({
            title: `<div class="modal-header-gestion" style="background: #800020; color: white; padding: 15px; border-radius: 8px 8px 0 0; text-align: left;">
                        <div class="header-left">
                            <span class="room-tag" style="font-weight: bold; font-size: 18px;">HABITACIÓN ${hab.numero}</span>
                            <br><small style="color: #d4a017; font-size: 13px;">${hab.tipo || 'Boutique'}</small>
                        </div>
                    </div>`,
            width: '500px',
            customClass: { popup: 'hotel-modal-custom' },
            html: `
                <div class="gestion-container" style="padding: 20px; font-family: sans-serif; text-align: left;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <div style="font-size: 50px; color: #d4a017; margin-bottom: 10px;">
                            <i class="fas fa-broom"></i>
                        </div>
                        <h3 style="margin: 0; color: #333; font-size: 18px;">Estado Actual: En Limpieza</h3>
                        <p style="color: #666; font-size: 14px; margin: 5px 0 0 0;">
                            La habitación requiere confirmación del personal para volver a recibir huéspedes.
                        </p>
                    </div>

                    <div style="background: #f9f9f9; border-left: 4px solid #800020; padding: 12px; margin-bottom: 25px; border-radius: 0 6px 6px 0;">
    <span style="font-size: 12px; color: #666; display: block; font-weight: bold; text-transform: uppercase;">Detalles rápidos:</span>
    <span style="font-size: 13px; color: #333; display: block; margin-top: 4px;">• Última Salida: <b>${new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}</b></span>
    <span style="font-size: 13px; color: #333; display: block; margin-top: 2px;">• Recepcionista Check-Out: <b>${localStorage.getItem("nombre_recepcionista") || 'Recepcionista'}</b></span>
</div>

                    <div class="gestion-container-footer" style="display: flex; justify-content: flex-end; gap: 10px;">
                        <button id="btnCerrarLimpieza" class="btn-secundario" style="padding: 10px 15px; background: #7d6c57; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 13px;">
                            CERRAR
                        </button>
                        <button id="btnColocarDisponible" class="btn-checkout-final" style="padding: 10px 20px; background: #27ae60; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 14px; display: flex; align-items: center; gap: 8px;">
                            <i class="fas fa-check-circle"></i> LEVANTAR LIMPIEZA
                        </button>
                    </div>
                </div>
            `,
            showConfirmButton: false,
            didOpen: () => {
                // Evento para cerrar el modal
                document.getElementById('btnCerrarLimpieza').onclick = () => Swal.close();
                
                // Evento crítico para ejecutar la liberación en la base de datos
                document.getElementById('btnColocarDisponible').onclick = () => {
                    Swal.close();
                    liberarHabitacion(hab.id, hab.numero);
                };
            }
        });
    } catch (error) {
        console.error("Error al abrir el modal de limpieza:", error);
        Swal.fire('Error', 'No se pudo cargar el panel de limpieza.', 'error');
    }
}

/* ==========================================================================
   EXTRA LÓGICA DE LIBERACIÓN EN BASE DE DATOS
   ========================================================================== */
async function liberarHabitacion(habId, numeroHab) {
    try {
        // Hacemos el update directo en Supabase
        const { error } = await supabase
            .from('habitaciones')
            .update({ estado: 'Libre' }) // Asegúrate de que en tu BD el string exacto sea 'Disponible' o 'Libre'
            .eq('id', habId);

        if (error) throw error;

        // Alerta de éxito elegante y rápida
        Swal.fire({
            icon: 'success',
            title: `Habitación ${numeroHab} Liberada`,
            text: 'El estado cambió a Disponible con éxito.',
            timer: 1500,
            showConfirmButton: false
        });

        // Refrescar el Rack en tiempo real
        // Reemplaza 'inicializarDashboard' por el nombre de tu función que recarga el Rack si es diferente
        setTimeout(() => {
            if (typeof inicializarDashboard === 'function') {
                inicializarDashboard();
            } else if (typeof cargarHabitaciones === 'function') {
                cargarHabitaciones();
            } else {
                window.location.reload();
            }
        }, 400);

    } catch (error) {
        console.error("Error al cambiar estado a Disponible:", error);
        Swal.fire('Error de Sistema', 'No se pudo actualizar el estado en la base de datos.', 'error');
    }
}