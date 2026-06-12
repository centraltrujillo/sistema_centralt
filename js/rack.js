import { client as supabase } from './config.js';

let calendar;
let listaHabitacionesGlobal = [];
let editId = null; 

// --- REFERENCIAS AL DOM ---
const form = document.getElementById("formNuevaReserva");
const modal = document.getElementById("modalReserva");
const btnAbrirModal = document.getElementById("btnAbrirModal"); 
const closeModal = document.querySelector(".close-modal");

// Inputs de cálculo y datos del formulario
const selectHabitacion = document.getElementById("resHabitacion");
const inputTarifa = document.getElementById("resTarifa");
const inputCheckIn = document.getElementById("resCheckIn");
const inputCheckOut = document.getElementById("resCheckOut");
const inputTotal = document.getElementById("resTotal");
const inputAdelantoMonto = document.getElementById("resAdelantoMonto");
const inputDiferencia = document.getElementById("resDiferencia");
const selectMoneda = document.getElementById("resMoneda");
const inputTipoCambio = document.getElementById("resTipoCambio");

// Checkboxes financieros y Pasarela de pagos
const checkEarly = document.getElementById("resAplicaEarly");
const checkLate = document.getElementById("resAplicaLate");
const selectMetodoPago = document.getElementById("resMetodoPago");
const inputAdelantoDetalle = document.getElementById("resAdelantoDetalle");

// NUEVAS REFERENCIAS: Sección Niños
const checkAplicaNinos = document.getElementById("resAplicaNinos");
const inputInformacionNinos = document.getElementById("resInformacionNinos");


// --- ASIGNACIÓN DE LISTENERS SEGUROS ---
if (btnAbrirModal) {
    btnAbrirModal.addEventListener("click", () => {
        editId = null; 
        if (form) form.reset();
        
        const modalTitle = document.getElementById("modalTitle");
        if (modalTitle) modalTitle.textContent = "Nueva Reserva Directa"; 
        
        if (inputTotal) inputTotal.value = "0.00";
        if (inputDiferencia) inputDiferencia.value = "0.00";
        if (inputTipoCambio) inputTipoCambio.value = "1.00"; 
        
        if (checkEarly) checkEarly.checked = false;
        if (checkLate) checkLate.checked = false;
        
        if (form) {
            delete form.dataset.idHuesped;
            delete form.dataset.cargoEarly;
            delete form.dataset.cargoLate;
        }
        
        if (modal) {
            modal.classList.add("active");
            modal.style.display = 'flex';
        }
    });
}

if (closeModal) {
    closeModal.addEventListener("click", () => {
        window.cerrarModal();
    });
}

if (modal) {
    modal.addEventListener("click", (e) => {
        if (e.target === modal) {
            window.cerrarModal();
        }
    });
}

window.cerrarModal = () => { 
    if (modal) {
        modal.classList.remove("active"); 
        modal.style.display = 'none'; 
    }
    if (form) {
        form.reset(); 
        delete form.dataset.idHuesped;
        delete form.dataset.cargoEarly;
        delete form.dataset.cargoLate;
    }
    
    const inputHiddenId = document.getElementById('resHuespedId');
    if (inputHiddenId) inputHiddenId.value = "";
    
    editId = null; 
    
    const statusDiv = document.getElementById("statusDisponibilidad");
    const btnGuardar = form ? form.querySelector('button[type="submit"]') : null;
    
    if (statusDiv) statusDiv.textContent = "";
    if (btnGuardar) {
        btnGuardar.disabled = false;
        btnGuardar.style.opacity = "1";
        btnGuardar.style.cursor = "pointer";
    }
};

// --- CICLO DE CARGA INICIAL DE LA PÁGINA ---
document.addEventListener("DOMContentLoaded", async () => {
    const txtDate = document.getElementById('current-date');
    if (txtDate) {
        const opciones = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        txtDate.innerText = new Date().toLocaleDateString('es-PE', opciones);
    }
    
    inicializarCalendarioRack();
    await cargarHabitacionesEnSelect();   
    escucharReservas();
    configurarEventosFormulario();
});

// --- 1. CARGAR LAS 13 HABITACIONES DESDE SUPABASE Y GENERAR RECURSOS ---
async function cargarHabitacionesEnSelect() {
    try {
        const { data: habs, error } = await supabase
            .from('habitaciones')
            .select('id, numero, tipo, piso, precio_base'); 

        if (error) throw error;

        // ORDENAMIENTO ESTRICTO POR PISO Y NÚMERO
        habs.sort((a, b) => {
            if (a.piso !== b.piso) return a.piso - b.piso;
            return parseInt(a.numero) - parseInt(b.numero);
        });

        listaHabitacionesGlobal = habs;
        
        const selectHab = document.getElementById('resHabitacion');
        if (selectHab) {
            selectHab.innerHTML = '<option value="" disabled selected>Seleccionar...</option>' + 
                habs.map(h => `<option value="${h.id}" data-precio="${h.precio_base || 0}">Hab. ${h.numero} (${h.tipo})</option>`).join('');
        }

        // B. Mapear las habitaciones agregando ordenamiento explícito para el motor de FullCalendar
        let listaHabitacionesRecursos = habs.map(h => {
            return {
                id: h.id,              
                title: `Hab. ${h.numero}`, 
                tipo: h.tipo,
                numero: parseInt(h.numero),
                piso: parseInt(h.piso),
                index: 1 // Habitaciones van primero
            };
        });

        const extras = [
            { id: 'extra1', title: 'CHECK OL 1', index: 2 },
            { id: 'extra2', title: 'CHECK OL 2', index: 3 },
            { id: 'extra3', title: 'CHECK OL 3', index: 4 },
            { id: 'extra4', title: 'CHECK OL 4', index: 5 },
            { id: 'extra5', title: 'CHECK OL 5', index: 6 }
        ];

        const filaTotal = [{ id: 'total-row', title: 'TOTAL OCUP', index: 7 }];
        const recursosFinales = [...listaHabitacionesRecursos, ...extras, ...filaTotal];
        
        if (typeof calendar !== 'undefined' && calendar) {
            calendar.setOption('resources', recursosFinales);
        }

    } catch (err) {
        console.error("Error al traer habitaciones y montar recursos:", err.message);
    }
}

// ==========================================================================
// --- CONFIGURACIÓN DE COMPONENTES DE TERCEROS ---
// ==========================================================================
const Toast = typeof Swal !== 'undefined' ? Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 2000,
    timerProgressBar: true
}) : null;


// ==========================================================================
// --- 2. AUTOCOMPLETADO POR NOMBRE O DOCUMENTO ---
// ==========================================================================
const inputDoc = document.getElementById("resDoc");
const inputHuespedNombre = document.getElementById("resHuesped"); // Tu input de Nombres y Apellidos

const datalistHuespedes = document.getElementById("listaHuespedesSugeridos");

const rellenarCamposHuesped = (h) => {
    if (form) form.dataset.idHuesped = h.id;

    if (document.getElementById("resHuesped")) document.getElementById("resHuesped").value = h.nombres_apellidos || "";
    if (document.getElementById("resDoc")) document.getElementById("resDoc").value = h.documento_num || "";
    if (document.getElementById("resTipoDoc") && h.documento_tipo) document.getElementById("resTipoDoc").value = h.documento_tipo;
    if (document.getElementById("resTelefono")) document.getElementById("resTelefono").value = h.telefono || "";
    if (document.getElementById("resCorreo")) document.getElementById("resCorreo").value = h.correo || "";
    if (document.getElementById("resNacionalidad")) document.getElementById("resNacionalidad").value = h.nacionalidad || "Peruana";
    if (document.getElementById("resNacimiento")) document.getElementById("resNacimiento").value = h.fecha_nacimiento || ""; 
    if (document.getElementById("resCiudad")) document.getElementById("resCiudad").value = h.ciudad || ""; 
    if (document.getElementById("resPreferencia")) document.getElementById("resPreferencia").value = h.preferencias || ""; 

    if (typeof Toast !== 'undefined' && Toast) {
        Toast.fire({
            icon: 'success',
            title: 'Huésped encontrado en el sistema',
            background: '#f0fdf4' 
        });
    }
};

// A. Búsqueda por Documento 
if (inputDoc) {
    inputDoc.addEventListener("blur", async (e) => {
        const docNum = e.target.value.trim();
        if (docNum.length < 4) return;

        try {
            const { data: huespedes, error } = await supabase
                .from("huespedes")
                .select("*")
                .eq("documento_num", docNum);

            if (error) throw error;

            if (huespedes && huespedes.length > 0) {
                rellenarCamposHuesped(huespedes[0]);
            } else {
                if (form) delete form.dataset.idHuesped;
            }
        } catch (error) {
            console.error("Error al buscar huésped por documento:", error.message || error);
        }
    });
}

// 🔄Búsqueda dinámica con Lista de Sugerencias 
if (inputHuespedNombre && datalistHuespedes) {
    // Vinculamos el input de texto con el contenedor de opciones
    inputHuespedNombre.setAttribute("list", "listaHuespedesSugeridos");

    // Evento 'input': Se ejecuta cada vez que el usuario escribe una letra
    inputHuespedNombre.addEventListener("input", async (e) => {
        const nombreBusqueda = e.target.value.trim();
        
        // Limpiamos las opciones previas para que no se acumulen
        datalistHuespedes.innerHTML = "";

        // Si ya se buscó por DNI o el texto es muy corto, no consultamos a Supabase
        if (nombreBusqueda.length < 4 || (form && form.dataset.idHuesped)) return;

        try {
            // Buscamos coincidencias parciales sin el .limit(1) para poder ver los homónimos
            const { data: huespedes, error } = await supabase
                .from("huespedes")
                .select("id, nombres_apellidos, documento_num, documento_tipo")
                .ilike("nombres_apellidos", `%${nombreBusqueda}%`)
                .limit(5); // Traemos hasta un máximo de 5 sugerencias

            if (error) throw error;

            if (huespedes && huespedes.length > 0) {
                huespedes.forEach(h => {
                    const option = document.createElement("option");
                    // El valor que se inyectará en el input al hacer clic
                    option.value = h.nombres_apellidos; 
                    // Texto secundario que ayuda a la recepcionista a diferenciar (ej: DNI: 75095174)
                    option.textContent = `${h.documento_tipo}: ${h.documento_num}`; 
                    
                    datalistHuespedes.appendChild(option);
                });
            }
        } catch (error) {
            console.error("Error en sugerencias de nombres:", error.message || error);
        }
    });

    // Evento 'change': Se ejecuta cuando la recepcionista hace clic en una opción de la lista
    inputHuespedNombre.addEventListener("change", async (e) => {
        const nombreSeleccionado = e.target.value.trim();
        if (!nombreSeleccionado) return;
        
        try {
            // Traemos todos los datos del huésped seleccionado de la base de datos
            const { data: huespedes, error } = await supabase
                .from("huespedes")
                .select("*")
                .eq("nombres_apellidos", nombreSeleccionado);

            if (error) throw error;

            if (huespedes && huespedes.length > 0) {
                // Si hay homónimos idénticos en nombre, por defecto tomará el primero.
                rellenarCamposHuesped(huespedes[0]);
            }
        } catch (error) {
            console.error("Error al cargar datos del huésped seleccionado:", error.message || error);
        }
    });
}

// ==========================================================================
// --- 3. LÓGICA DE NEGOCIO  ---
// ==========================================================================
window.calcularMontos = () => {
    
    const nInputCheckIn     = inputCheckIn;       // Tu nuevo input de entrada
    const nInputCheckOut    = inputCheckOut;      // Tu nuevo input de salida
    const nInputTarifa      = inputTarifa;        // Tu nuevo input de tarifa base
    const nInputTotal       = inputTotal;         // Tu nuevo input de total final
    const nInputDiferencia  = inputDiferencia;    // Tu nuevo input de saldo/diferencia
    const nInputAdelanto    = inputAdelantoMonto; // Tu nuevo input de adelanto
    const nCheckEarly       = checkEarly;         // Tu nuevo checkbox Early
    const nCheckLate        = checkLate;          // Tu nuevo checkbox Late
    const nSelectMoneda     = selectMoneda;       // Tu nuevo select de moneda
    const nInputTipoCambio  = inputTipoCambio;    // Tu nuevo input de tipo de cambio
    const nForm             = form;               // Tu nuevo contenedor/formulario (opcional)

    // Validación de existencia de elementos esenciales
    if (!nInputCheckIn || !nInputCheckOut || !nInputTarifa || !nInputTotal || !nInputDiferencia || !nInputAdelanto) return;

    // Captura de valores de fecha y tarifa
    const fIn = new Date(nInputCheckIn.value + 'T00:00:00');
    const fOut = new Date(nInputCheckOut.value + 'T00:00:00');
    const tarifaBase = parseFloat(nInputTarifa.value) || 0;

    const tieneEarly = nCheckEarly ? nCheckEarly.checked : false;
    const tieneLate = nCheckLate ? nCheckLate.checked : false;

    const moneda = nSelectMoneda?.value || "PEN";
    let tc = 3.75; 
    if (nInputTipoCambio && nInputTipoCambio.value.trim() !== "") {
        const tcParseado = parseFloat(nInputTipoCambio.value);
        if (!isNaN(tcParseado) && tcParseado > 0) {
            tc = tcParseado; 
        }
    }

    // Si las fechas están vacías, resetea la pantalla
    if (!nInputCheckIn.value || !nInputCheckOut.value) {
        nInputTotal.value = "0.00";
        nInputDiferencia.value = "0.00";
        return;
    }

    // Cálculo de noches
    const noches = Math.round((fOut - fIn) / (1000 * 60 * 60 * 24));

    // Si es 0 noches, continuará para permitir el "Day Use"
    if (noches < 0) {
        nInputTotal.value = "0.00";
        nInputDiferencia.value = "0.00";
        return;
    }
    
    // 🔥 A. Conversión inmediata de la tarifa base a Soles si está en USD
    let tarifaEnSoles = tarifaBase;
    if (moneda === "USD") {
        tarifaEnSoles = tarifaBase * tc; 
    }

    // B. Cálculos base unificados en Soles (Soporta Day Use si noches es 0 cobrando 1 noche)
    let subtotalHospedajeSoles = noches === 0 ? tarifaEnSoles : noches * tarifaEnSoles; 
    let cargoEarlySoles = tieneEarly ? (tarifaEnSoles * 0.5) : 0.00;
    let cargoLateSoles = tieneLate ? (tarifaEnSoles * 0.5) : 0.00;

    let totalBrutoSoles = subtotalHospedajeSoles + cargoEarlySoles + cargoLateSoles;

    // 🌟 C. Redondeo estricto hacia arriba (Ej: 90.15 -> 91.00)
    let totalFinalSoles = Math.ceil(totalBrutoSoles);

    // Guardar los cargos calculados en el dataset del formulario
    if (nForm) {
        nForm.dataset.cargoEarly = cargoEarlySoles.toFixed(2);
        nForm.dataset.cargoLate = cargoLateSoles.toFixed(2);
    }

    // Pintamos el total final en Soles ajustado en la pantalla
    nInputTotal.value = totalFinalSoles.toFixed(2);

    let adelanto = parseFloat(nInputAdelanto.value) || 0;

    // El guardarraíl del adelanto se evalúa contra el total final redondeado en soles
    if (adelanto > totalFinalSoles && totalFinalSoles > 0) {
        adelanto = totalFinalSoles;
        nInputAdelanto.value = totalFinalSoles.toFixed(2);
        
        if (typeof Toast !== 'undefined') {
            Toast.fire({ icon: 'warning', title: 'El adelanto no puede superar al total en soles' });
        }
    }

    // Cálculo final de la diferencia/saldo restante
    nInputDiferencia.value = (totalFinalSoles - adelanto).toFixed(2);
};

function configurarEventosFormulario() {
    [
        inputTarifa, inputCheckIn, inputCheckOut, 
        inputAdelantoMonto, inputTipoCambio, selectMoneda,
        checkEarly, checkLate
    ].forEach(el => {
        if (el) {
            el.addEventListener("input", window.calcularMontos);
            el.addEventListener("change", window.calcularMontos);
        }
    });

    if (selectHabitacion) {
        selectHabitacion.addEventListener("change", () => {
            const habId = selectHabitacion.value;
            if (!habId) return;
            const habSeleccionada = listaHabitacionesGlobal.find(h => h.id === habId);
            if (habSeleccionada && habSeleccionada.precio_base && inputTarifa) {
                inputTarifa.value = parseFloat(habSeleccionada.precio_base).toFixed(2);
                window.calcularMontos(); 
            }
        });
    }

    const formReserva = document.getElementById('formNuevaReserva');
if (formReserva) {
    formReserva.addEventListener('submit', async (e) => {
        e.preventDefault(); 

        const idUsuarioActivo = formReserva.dataset.idUsuarioLogueado || 
                               localStorage.getItem("id_usuario_logueado") || 
                               localStorage.getItem("id_usuario") ||
                               "CAMBIA_ESTO_POR_TU_UUID_REAL"; 
                               
        const nombreRecepcionista = localStorage.getItem("nombre_recepcionista") || "Recepcionista en Turno";

        const monedaSeleccionada = selectMoneda?.value || "PEN"; 
        const tipoChangeUsado = parseFloat(inputTipoCambio?.value) || 1.000;
        const adelantoMonto = parseFloat(inputAdelantoMonto?.value) || 0; 

        // 🏨 LÓGICA DE CONTROL HORARIO DE TRUJILLO PARA FECHA Y TURNO OPERATIVO
const ahora = new Date();
const horaPeru = parseInt(ahora.toLocaleTimeString('en-US', { timeZone: 'America/Lima', hour12: false, hour: '2-digit' }));
const formateadorFecha = new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' });

let fechaCalculada = formateadorFecha.format(ahora); // Por defecto "YYYY-MM-DD" hoy
let turnoCalculado = '';

// Asignar Turno y corregir Fecha si es madrugada
if (horaPeru >= 7 && horaPeru < 14) {
    turnoCalculado = 'Mañana';
} else if (horaPeru >= 14 && horaPeru < 21) {
    turnoCalculado = 'Tarde';
} else {
    turnoCalculado = 'Noche';
    // 💡 EL TRUCO DE MADRUGADA:
    if (horaPeru >= 0 && horaPeru < 7) {
        // Restamos las horas necesarias directamente para retroceder de forma segura en la línea de tiempo de Lima
        const milisegundosEnUnDia = 24 * 60 * 60 * 1000;
        const ayer = new Date(ahora.getTime() - milisegundosEnUnDia);
        fechaCalculada = formateadorFecha.format(ayer);
    }
}

        // 🔍 CAPTURA EL ID EXISTENTE DESDE EL INPUT OCULTO O DATASET
        let idHuespedExistente = formReserva.dataset.idHuesped || document.getElementById("resHuespedId")?.value || null;
        let datosHuespedNuevo = null;

        if (idHuespedExistente === "" || idHuespedExistente === "null") {
            idHuespedExistente = null;
        }

        // 🆕 PROCESAMOS COMO HUÉSPED NUEVO SI NO EXISTE ID
        if (!idHuespedExistente) {
            const inputNombre = document.getElementById("resHuesped");
            const selectTipoDoc = document.getElementById("resTipoDoc"); 
            const inputDocNum = document.getElementById("resDoc");

            const txtTelefono = document.getElementById("resTelefono");
            const txtCorreo = document.getElementById("resCorreo");
            const txtNacionalidad = document.getElementById("resNacionalidad");
            const txtNacimiento = document.getElementById("resNacimiento");
            const txtCiudad = document.getElementById("resCiudad");
            const txtPreferencia = document.getElementById("resPreferencia");

            if (inputNombre && inputNombre.value.trim() !== "" && inputDocNum && inputDocNum.value.trim() !== "") {
                datosHuespedNuevo = {
                    nombres_apellidos: inputNombre.value.trim().toUpperCase(), 
                    documento_tipo: selectTipoDoc?.value || "DNI", 
                    documento_num: inputDocNum.value.trim(),
                    telefono: txtTelefono?.value.trim() || null,
                    correo: txtCorreo?.value.trim() || null,
                    nacionalidad: txtNacionalidad?.value.trim() || "Peruana",
                    fecha_nacimiento: txtNacimiento?.value || null, 
                    ciudad: txtCiudad?.value.trim().toUpperCase() || null,
                    preferencias: txtPreferencia?.value.trim() || null,
                };
            } else {
                if (typeof Swal !== 'undefined') {
                    Swal.fire({ 
                        icon: 'warning', 
                        title: 'Falta el Huésped', 
                        text: 'Por favor, introduce el número de documento de un huésped existente o completa los datos mínimos (Nombre y Documento) del nuevo cliente.' 
                    });
                }
                return; 
            }
        }

        const objetoReserva = {
            id_huesped: idHuespedExistente, 
            id_usuario: idUsuarioActivo, 
            id_habitacion: selectHabitacion?.value || null,
            medio_reserva: document.getElementById("resMedio")?.value || "Presencial",
            check_in_fecha: inputCheckIn?.value || null,
            check_out_fecha: inputCheckOut?.value || null,
            estado_reserva: document.getElementById("resEstado")?.value || "Confirmada",
            numero_personas: parseInt(document.getElementById("resNumPersonas")?.value) || 1,
            check_in_hora: document.getElementById("resEarlyHora")?.value || null,
            check_out_hora: document.getElementById("resLateHora")?.value || null,
            desayuno: document.getElementById("resInfo")?.value === "true",
            cochera: document.getElementById("resCochera")?.value || "No",
            traslado: document.getElementById("resTraslado")?.value || "",
            notas: document.getElementById("resObservaciones")?.value || "",
            tiene_early_checkin: checkEarly?.checked || false,
            tiene_late_checkout: checkLate?.checked || false,
            tarifa_pactada: parseFloat(inputTarifa?.value) || 0, 
            moneda: monedaSeleccionada, 
            tipo_cambio: tipoChangeUsado,
            nuevo_huesped_datos: datosHuespedNuevo,
            tiene_ninos: aplicaNinos,              
            informacion_ninos: informacionNinos     

        };

        const selectMetodoDOM = document.getElementById("resMetodoPago");
        const inputDetalleDOM = document.getElementById("resAdelantoDetalle");

        const objetoPago = {
            id_usuario: idUsuarioActivo, 
            turno: turnoCalculado, 
            nombre_recepcionista: nombreRecepcionista,
            moneda: "PEN",                                      
            tipo_cambio_usado: 1.000,                                   
            monto_soles: adelantoMonto,                                
            adelanto_monto: adelantoMonto,                             
            metodo_pago: selectMetodoDOM?.value || "Efectivo",
            concepto: "Adelanto",
            nro_operacion: inputDetalleDOM?.value || "",
            fecha_pago: fechaCalculada,                                
            hora_pago: ahora.toLocaleTimeString('it-IT', { timeZone: 'America/Lima' })
        };

        const pagoAProcesar = objetoPago.monto_soles > 0 ? objetoPago : null;

        // Enviamos todo al backend/función transaccional
        await guardarReservaTransaccional(objetoReserva, pagoAProcesar);
    });
}

    [selectHabitacion, inputCheckIn, inputCheckOut].forEach(elemento => {
        elemento?.addEventListener("change", verificarDisponibilidadRealTime);
    });
}

// ==========================================================================
// --- 4. INICIALIZAR RACK CON FULLCALENDAR SCHEDULER ---
// ==========================================================================

// 🎨 MAPA DE COLORES SEGÚN MEDIO DE RESERVA (Sincronizado exactamente con la base de datos)
const coloresMedios = {
    'Presencial': '#a855f7', 
    'Teléfono': '#3b82f6',   
    'WhatsApp': '#10b981',    
    'Booking': '#1d4ed8',   
    'Airbnb': '#f43f5e',     
    'Expedia': '#eab308',   
    'Day use': '#ec4899',    
    'Gmail': '#ef4444',      
    'Otro': '#64748b'       
};

function inicializarCalendarioRack() {
    if (typeof FullCalendar === 'undefined') {
        console.warn("FullCalendar aún no está listo. Reintentando...");
        setTimeout(inicializarCalendarioRack, 200);
        return;
    }

    const calendarEl = document.getElementById('gantt_here');
    if (!calendarEl) return;

    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'resourceTimelineMonth',
        locale: 'es',
        timeZone: 'local',
        height: 'parent',
        contentHeight: 'auto',
        expandRows: true,       
        stickyHeaderDates: true,
        handleWindowResize: true,
        resourceAreaWidth: '150px',
        eventOverlap: false,         
        slotEventOverlap: false,     
        
        // ==========================================================================
        // ⏰ CONFIGURACIÓN PERSONALIZADA DE FORMATOS SEGÚN LA VISTA
        // ==========================================================================
        views: {
            resourceTimelineMonth: {
                // Formato de cabecera exclusivo para la vista Mensual (Mes arriba, Días abajo)
                slotLabelFormat: [
                    { month: 'long', year: 'numeric' }, 
                    { weekday: 'short', day: 'numeric' } 
                ]
            },
            resourceTimelineDay: {
                slotDuration: '01:00:00',     // Genera una columna por cada hora del día
                snapDuration: '00:30:00',     // Permite modular rangos de media hora
                // Formato de cabecera exclusivo para la vista Diaria (Día arriba, 24 Horas abajo)
                slotLabelFormat: [
                    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }, // Cabecera superior: "sábado, 30 de mayo..."
                    { hour: 'numeric', minute: '2-digit', hour12: false }               // Cabecera inferior: 00:00, 01:00, etc.
                ]
            }
        },
        
        navLinks: true,
        navLinkDayClick: 'resourceTimelineDay',

        eventMinHeight: 0,       
        eventOrder: 'start',
        
        resourceOrder: 'index,piso,numero', 

        buttonText: {
            today: 'Hoy',
            month: 'Mes',
            day: 'Día',
            resourceTimelineMonth: 'Mes',
            resourceTimelineDay: 'Día'
        },
        
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'resourceTimelineMonth,resourceTimelineDay' 
        },

        resourceAreaHeaderContent: 'HABITACIONES',

        slotLabelContent: function(arg) {
            if (arg.level === 1) { 
                return { 
                    html: `<div style="font-size: 11px; font-weight: 700; color: var(--marron-zocalo); line-height: 1; padding: 0;">${arg.text}</div>` 
                };
            }
        },

        resourceLaneContent: function(arg) {
            if (arg.resource.id === 'total-row') {
                return; 
            }
        },

        // =======================================================================
        // 🚀 RENDERIZADOR VISUAL: Colores por Medio y Estado + Iconos
        // =======================================================================
        eventContent: function(arg) {
            if (arg.event.extendedProps && arg.event.extendedProps.esTotal) {
                return { 
                    html: `
                    <div style="
                        position: absolute;
                        inset: 0;
                        display: flex; 
                        align-items: center; 
                        justify-content: center; 
                        font-weight: 900; 
                        color: #800020; 
                        font-size: 15px; 
                        background-color: #fffbeb; 
                        border: 1px solid #d4a017;
                        border-radius: 4px;
                        margin: 2px;
                        pointer-events: none;
                    ">
                        ${arg.event.title}
                    </div>` 
                };
            }

            let medio = arg.event.extendedProps.medio || 'Otro';
            if (medio === 'Llamada') medio = 'Teléfono';

            const estado = arg.event.extendedProps.estadoHabitacion;

            let backgroundColor = coloresMedios[medio] || '#64748b';
            let textColor = '#ffffff';
            let borderColor = 'transparent';
            let iconHtml = '';
            let opacity = '1';

            if (estado === 'En Curso' || estado === 'Finalizada') {
                backgroundColor = '#f8fafc'; 
                textColor = '#0f172a';       
                borderColor = '#cbd5e1';     
                iconHtml = `<span style="margin-right: 5px; color: #10b981; font-weight: bold;">✓</span>`;
            } 
            else if (estado === 'Cancelada' || estado === 'No Show') {
                backgroundColor = '#fee2e2'; 
                textColor = '#991b1b';       
                borderColor = '#fca5a5';
                iconHtml = `<span style="margin-right: 5px; color: #ef4444; font-weight: bold;">✕</span>`;
                opacity = '0.7';             
            }

            return {
                html: `
                <div style="
                    display: flex; 
                    align-items: center; 
                    width: 100%; 
                    height: 100%; 
                    min-height: 24px;
                    padding: 0 8px; 
                    background-color: ${backgroundColor}; 
                    color: ${textColor}; 
                    border: 1px solid ${borderColor === 'transparent' ? backgroundColor : borderColor};
                    border-radius: 4px;
                    font-size: 11px; 
                    font-weight: 600; 
                    white-space: nowrap; 
                    overflow: hidden; 
                    text-overflow: ellipsis;
                    box-sizing: border-box;
                    opacity: ${opacity};
                    pointer-events: none;
                ">
                    ${iconHtml}
                    <span style="overflow: hidden; text-overflow: ellipsis; pointer-events: none;">${arg.event.title}</span>
                </div>`
            };
        },

        resourceLabelContent: function(arg) {
            let tipo = arg.resource.extendedProps.tipo || '';
            const isTotalRow = arg.resource.id === 'total-row';
            return {
                html: `<div style="display:flex; justify-content:space-between; align-items:center; width:100%; padding: 0 5px; ${isTotalRow ? 'color:#6e0d25;' : ''}">
                        <b style="font-size:13px;">${arg.resource.title}</b>
                        <span style="font-size:10px; color:#666; text-transform:uppercase;">${tipo}</span>
                       </div>`
            };
        },

        eventAllow: function(dropInfo, draggedEvent) {
            return dropInfo.resource.id !== 'total-row';
        },

        selectable: true, 
        editable: false, 
        unselectAuto: true,

        // 👁️ 1. DISPARADOR EXCLUSIVO PARA LA BARRA DE COLOR
        eventClick: function(info) {
            info.jsEvent.preventDefault();
            info.jsEvent.stopPropagation(); 

            if (rackInicializando) {
                console.warn("📌 PMS: Evitado disparo automático de ficha durante la carga inicial.");
                return;
            }

            if (info.event.extendedProps && info.event.extendedProps.esTotal) return;

            console.log("Abriendo Ficha de solo lectura desde la BARRA. ID:", info.event.id);
            
            if (typeof window.mostrarFichaReserva === 'function') {
                window.mostrarFichaReserva(info.event.id, true);
            }
        },

        // 📝 2. DISPARADOR PARA CELDAS BLANCAS VACÍAS
        select: function(selectionInfo) {
            const modalVista = document.getElementById("modalVistaReserva");
            if (modalVista) {
                modalVista.classList.remove("active");
                modalVista.style.display = "none";
            }
            if (window.event && (window.event.target.closest('.fc-timeline-event') || window.event.target.closest('.fc-event'))) {
                if (calendar) calendar.unselect();
                return;
            }
            console.log("Nueva reserva - Desde:", selectionInfo.startStr, "Hasta:", selectionInfo.endStr);
            const idHabitacion = selectionInfo.resource ? selectionInfo.resource.id : "";

            editId = null;

            if (document.getElementById("resCheckIn")) document.getElementById("resCheckIn").value = selectionInfo.startStr.split('T')[0];
            if (document.getElementById("resCheckOut")) document.getElementById("resCheckOut").value = selectionInfo.endStr.split('T')[0];
            if (document.getElementById("resHabitacion")) document.getElementById("resHabitacion").value = idHabitacion;
            
            const modalTitle = document.getElementById("modalTitle");
            if (modalTitle) modalTitle.textContent = "Nueva Reserva";
            
            const formNuevaRes = document.getElementById("formNuevaReserva") || window.form;
            if (formNuevaRes) {
                formNuevaRes.reset();
                if (document.getElementById("resCheckIn")) document.getElementById("resCheckIn").value = selectionInfo.startStr.split('T')[0];
                if (document.getElementById("resCheckOut")) document.getElementById("resCheckOut").value = selectionInfo.endStr.split('T')[0];
                if (document.getElementById("resHabitacion")) document.getElementById("resHabitacion").value = idHabitacion;
            }

            if (typeof window.calcularMontos === 'function') window.calcularMontos();
            
            const modalForm = document.getElementById("modalReserva");
            if (modalForm) {
                modalForm.classList.add("active");
                modalForm.style.display = 'flex';
            }
            
            if (calendar) calendar.unselect();
        },
        
        resources: [], 
        events: []
    });

    calendar.render();
}

// ==========================================================================
// --- CONTROL DE LA INTERFAZ DEL MODAL (AL HACER CLICK/ARRASTRE EN EL RACK) ---
// ==========================================================================
window.prepararNuevaReserva = abrirModalNuevaReserva;

function abrirModalNuevaReserva(startStr, endStr, resourceId) {
    if (form) {
        form.reset();
        delete form.dataset.idHuesped;
        editId = null; 
    }
    
    const modalTitle = document.getElementById('modalTitle');
    if (modalTitle) modalTitle.textContent = "Nueva Reserva Directa";
    
    const inputCheckIn = document.getElementById('resCheckIn');
    const inputCheckOut = document.getElementById('resCheckOut');
    
    if (inputCheckIn) inputCheckIn.value = startStr;
    
    if (inputCheckOut) {
        if (startStr !== endStr) {
            inputCheckOut.value = endStr;
        } else {
            // Si hace un solo clic en un casillero, le damos automáticamente 1 noche por defecto
            const d = new Date(startStr + "T00:00:00");
            d.setDate(d.getDate() + 1);
            inputCheckOut.value = d.toISOString().split('T')[0];
        }
    }
    
    const inputHabitacion = document.getElementById('resHabitacion');
    if (resourceId && inputHabitacion) {
        inputHabitacion.value = resourceId;
    }

    // Abre el formulario clásico de registro
    const modalFormulario = document.getElementById("modalReserva");
    if (modalFormulario) {
        modalFormulario.classList.add("active");
        modalFormulario.style.display = 'flex';
    }
    
    if (typeof window.calcularMontos === 'function') {
        window.calcularMontos();
    }
}

// ==========================================================================
// 👁️ FUNCIÓN MAESTRA: CARGAR Y MOSTRAR LA FICHA DE LECTURA (modalVistaReserva)
// ==========================================================================

let rackInicializando = true;
setTimeout(() => { rackInicializando = false; }, 1500);

window.mostrarFichaReserva = async function(idReserva, esClickReal = false) {
    if (!esClickReal) {
        console.warn("🛡️ PMS Hotel Central: Bloqueada apertura fantasma o carga en segundo plano.");
        return;
    }
    if (!idReserva) return;
    try {
        const { data: reserva, error } = await supabase
            .from('reservas')
            .select(`
                *,
                huespedes (*),
                habitaciones (numero, tipo)
            `)
            .eq('id', idReserva)
            .single();

        if (error) throw error;
        if (!reserva) return;

        // 1. Inyectar Información del Huésped en el nuevo HTML
        const h = reserva.huespedes || {};
        document.getElementById("viewHuespedNombre").textContent = h.nombres_apellidos || "---";
        document.getElementById("viewHuespedDoc").textContent = `${h.documento_tipo || 'DOC'}: ${h.documento_num || '---'}`;
        document.getElementById("viewHuespedTel").textContent = h.telefono || "---";
        document.getElementById("viewHuespedCorreo").textContent = h.correo || "---";
        document.getElementById("viewHuespedNacio").textContent = h.nacionalidad || "Peruana";
        document.getElementById("viewHuespedCiudad").textContent = h.ciudad || "---";
        document.getElementById("viewHuespedNacimiento").textContent = h.fecha_nacimiento || "---";
        document.getElementById("viewHuespedPref").textContent = h.preferencias || "Ninguna";

        // 2. Inyectar Detalles de la Estancia
        const hab = reserva.habitaciones || {};
        document.getElementById("viewResHabitacion").textContent = `Hab. ${hab.numero || '---'} (${hab.tipo || '---'})`;
        document.getElementById("viewResMedio").textContent = reserva.medio_reserva || "Otro";
        document.getElementById("viewResCheckIn").textContent = reserva.check_in_fecha || "---";
        document.getElementById("viewResCheckOut").textContent = reserva.check_out_fecha || "---";
        document.getElementById("viewResHoraEarly").textContent = reserva.check_in_hora || "No aplica";
        document.getElementById("viewResHoraLate").textContent = reserva.check_out_hora || "No aplica";
        
        // Cálculo rápido de noches para la ficha
        const f1 = new Date(reserva.check_in_fecha + 'T00:00:00');
        const f2 = new Date(reserva.check_out_fecha + 'T00:00:00');
        const noches = Math.round((f2 - f1) / (1000 * 60 * 60 * 24)) || 0;
        document.getElementById("viewResNoches").textContent = noches;
        document.getElementById("viewResPersonas").textContent = reserva.numero_personas || "1";
        document.getElementById("viewAplicaNinos").textContent = reserva.tiene_ninos ? "Sí" : "No";
        document.getElementById("viewInformacionNinos").textContent = reserva.informacion_ninos || "N/A";

        // 3. Servicios Adicionales
        document.getElementById("viewResDesayuno").textContent = reserva.desayuno ? "Sí" : "No";
        document.getElementById("viewResCochera").textContent = reserva.cochera || "No";
        document.getElementById("viewResTraslado").textContent = reserva.traslado || "No";
        document.getElementById("viewResNotas").textContent = reserva.notes || "Ninguna";

        // 4. Bloque Financiero profesional
        const simbolo = reserva.moneda === "USD" ? "$" : "S/";
        document.getElementById("viewResTarifa").textContent = `${simbolo} ${parseFloat(reserva.tarifa_pactada).toFixed(2)}`;
        
        const extras = (parseFloat(reserva.cargo_early_checkin) || 0) + (parseFloat(reserva.cargo_late_checkout) || 0);
        document.getElementById("viewResCargosExtras").textContent = `${simbolo} ${extras.toFixed(2)}`;
        document.getElementById("viewResTipoCambio").textContent = parseFloat(reserva.tipo_cambio).toFixed(3);

        const { data: pago } = await supabase
            .from('pagos')
            .select('monto_soles, metodo_pago, nro_operacion, nombre_recepcionista')
            .eq('id_reserva', idReserva)
            .eq('concepto', 'Adelanto')
            .maybeSingle();

        if (pago) {
            document.getElementById("viewResMetodoText").textContent = pago.metodo_pago || "Efectivo";
            document.getElementById("viewResAdelanto").textContent = `S/ ${parseFloat(pago.monto_soles).toFixed(2)}`;
            if (pago.nro_operacion) {
                document.getElementById("viewBlockOperacion").classList.remove("hidden");
                document.getElementById("viewBlockOperacion").textContent = pago.nro_operacion;
            } else {
                document.getElementById("viewBlockOperacion").classList.add("hidden");
            }
            document.getElementById("viewAuditRecepcionista").textContent = pago.nombre_recepcionista || "Recepcionista";
        } else {
            document.getElementById("viewResMetodoText").textContent = "---";
            document.getElementById("viewResAdelanto").textContent = `S/ 0.00`;
            document.getElementById("viewBlockOperacion").classList.add("hidden");
            document.getElementById("viewAuditRecepcionista").textContent = "---";
        }

        const totalNeto = (parseFloat(reserva.total_reserva) || (noches * (parseFloat(reserva.tarifa_pactada) || 0))) + extras;
        document.getElementById("viewResTotal").textContent = `${simbolo} ${totalNeto.toFixed(2)}`;

        // 5. Configurar el botón "Editar Reserva" para que abra el formulario clásico si se requiere cambiar algo
        const btnEditar = document.getElementById("btnIrAEditar");
        if (btnEditar) {
            btnEditar.onclick = () => {
                window.cerrarModalVista();
                editId = idReserva; 
                
                if (document.getElementById("resCheckIn")) document.getElementById("resCheckIn").value = reserva.check_in_fecha;
                if (document.getElementById("resCheckOut")) document.getElementById("resCheckOut").value = reserva.check_out_fecha;
                if (document.getElementById("resHabitacion")) document.getElementById("resHabitacion").value = reserva.id_habitacion;
                if (document.getElementById("resTarifa")) document.getElementById("resTarifa").value = reserva.tarifa_pactada;
                if (document.getElementById("resEstado")) document.getElementById("resEstado").value = reserva.estado_reserva;
                if (document.getElementById("resMedio")) document.getElementById("resMedio").value = reserva.medio_reserva;
                
                const modalForm = document.getElementById("modalReserva");
                if (modalForm) {
                    modalForm.classList.add("active");
                    modalForm.style.display = 'flex';
                }
            };
        }

        const modalVista = document.getElementById("modalVistaReserva");
        if (modalVista) {
            modalVista.classList.add("active");
            modalVista.style.display = "flex";
        }

    } catch (err) {
        console.error("Error al cargar los detalles de la ficha:", err.message);
    }
};

window.cerrarModalVista = () => {
    const modalVista = document.getElementById("modalVistaReserva");
    if (modalVista) {
        modalVista.classList.remove("active");
        modalVista.style.display = "none";
    }
};

// ==========================================================================
// --- 6. RENDERIZADO Y CONSULTA (TABLA, KPIS Y EVENTOS DEL RACK) ---
// ==========================================================================
let listaReservasGlobal = []; // Aseguramos la persistencia global

function formatearFechaLocal(fechaString) {
    if (!fechaString) return '---';
    const partes = fechaString.split('T')[0].split('-');
    if (partes.length !== 3) return fechaString;
    return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

const escucharReservas = async () => {
    try {
        // ✨ Mapeando 'monto_soles' en la consulta relacional de pagos
        const { data, error } = await supabase
            .from('reservas')
            .select(`
                *,
                huespedes(nombres_apellidos, documento_num, documento_tipo, telefono, correo, nacionalidad, fecha_nacimiento, ciudad, preferencias),
                habitaciones(numero, tipo),
                pagos(id, monto_soles, metodo_pago, nro_operacion, concepto) 
            `)
            .order('created_at', { ascending: false });

        if (error) throw error;

        listaReservasGlobal = data || [];

        // --- 📊 A. ACTUALIZAR LOS EVENTOS EN EL FULLCALENDAR RACK ---
        if (typeof calendar !== 'undefined' && calendar) {
            calendar.removeAllEvents(); // Limpia eventos previos de FullCalendar
            
            let contadorExtrasDelDia = {}; 

            // Usamos .flatMap() para permitir que una reserva genere múltiples bloques visuales
            const eventosReservas = listaReservasGlobal.flatMap(res => {
                
                // 🛑 CASO 1: RESERVAS CANCELADAS O NO SHOW (Se quedan en su habitación con una X)
                if (res.estado_reserva === 'Cancelada' || res.estado_reserva === 'No Show') {
                    return [{
                        id: res.id,
                        resourceId: res.id_habitacion,
                        title: `[X] ${res.huespedes?.nombres_apellidos || res.nombre_huesped || 'Reserva'}`,
                        // 🚀 Inyección horaria para evitar solapamientos visuales
                        start: res.check_in_fecha + 'T' + (res.check_in_hora || '13:00:00'),
                        end: res.check_out_fecha + 'T' + (res.check_out_hora || '12:00:00'),
                        extendedProps: {
                            medio: res.medio_reserva || 'Otro',
                            estadoHabitacion: res.estado_reserva,
                            esExtra: false
                        }
                    }];
                }

                const eventosDeEstaReserva = [];
                const nombreHuesped = res.huespedes?.nombres_apellidos || res.nombre_huesped || 'Huésped';
                const nroHab = res.habitaciones?.numero || '??';
                
                // 🏨 Estándar del Hotel Central: Check-In 13:00 (1 PM) y Check-Out 12:00 PM
                const horaIn = res.check_in_hora || '13:00:00';
                const horaOut = res.check_out_hora || '12:00:00';

                // ☀️ CASO 2: DAY USE (Confirmado/En Curso -> Habitación | Finalizada -> Fila Extra)
                if (res.medio_reserva === 'Day use') {
                    let resourceDayUse = res.id_habitacion;

                    if (res.estado_reserva === 'Finalizada') {
                        const fechaClave = res.check_in_fecha;
                        if (!contadorExtrasDelDia[fechaClave]) contadorExtrasDelDia[fechaClave] = 0;
                        contadorExtrasDelDia[fechaClave]++;
                        resourceDayUse = `extra${Math.min(contadorExtrasDelDia[fechaClave], 5)}`;
                    }

                    eventosDeEstaReserva.push({
                        id: `${res.id}-dayuse`,
                        resourceId: resourceDayUse,
                        title: `☀️ DU: ${nombreHuesped} (Hab. ${nroHab})`,
                        start: res.check_in_fecha + 'T' + horaIn,
                        end: res.check_out_fecha + 'T' + horaOut,
                        extendedProps: {
                            medio: 'Day use',
                            estadoHabitacion: res.estado_reserva,
                            esExtra: (res.estado_reserva === 'Finalizada')
                        }
                    });
                } 
                
                // 🛌 CASO 3: RESERVAS NORMALES
                else {
                    // Bloque base de la estadía (Siempre se queda en el ID de su habitación)
                    eventosDeEstaReserva.push({
                        id: res.id,
                        resourceId: res.id_habitacion,
                        title: nombreHuesped,
                        start: res.check_in_fecha + 'T' + horaIn, // 13:00:00
                        end: res.check_out_fecha + 'T' + horaOut,   // 12:00:00
                        extendedProps: {
                            medio: res.medio_reserva || 'Otro',
                            estadoHabitacion: res.estado_reserva,
                            esExtra: false
                        }
                    });

                    // 🌅 SUB-BLOQUE: EARLY CHECK-IN (Se calcula e inserta UN DÍA ANTES)
                    if (res.tiene_early_checkin) {
                        const fechaInObj = new Date(res.check_in_fecha + 'T00:00:00');
                        fechaInObj.setDate(fechaInObj.getDate() - 1);
                        const fechaEarly = fechaInObj.toISOString().split('T')[0];

                        if (!contadorExtrasDelDia[fechaEarly]) contadorExtrasDelDia[fechaEarly] = 0;
                        contadorExtrasDelDia[fechaEarly]++;
                        const resourceExtra = `extra${Math.min(contadorExtrasDelDia[fechaEarly], 5)}`;

                        eventosDeEstaReserva.push({
                            id: `${res.id}-early`,
                            resourceId: resourceExtra,
                            title: `🌅 Early Check-In Hab ${nroHab} (${nombreHuesped})`,
                            start: fechaEarly + 'T' + horaIn, 
                            end: fechaEarly + 'T' + '23:59:00',
                            extendedProps: {
                                medio: 'Early/Late',
                                estadoHabitacion: 'Extra_Early',
                                esExtra: true
                            }
                        });
                    }

                    // 🌆 SUB-BLOQUE: LATE CHECK-OUT (Se calcula e inserta EL MISMO DÍA de salida)
                    if (res.tiene_late_checkout) {
                        const fechaLate = res.check_out_fecha;

                        if (!contadorExtrasDelDia[fechaLate]) contadorExtrasDelDia[fechaLate] = 0;
                        contadorExtrasDelDia[fechaLate]++;
                        const resourceExtra = `extra${Math.min(contadorExtrasDelDia[fechaLate], 5)}`;

                        eventosDeEstaReserva.push({
                            id: `${res.id}-late`,
                            resourceId: resourceExtra,
                            title: `🌆 Late Check-Out Hab ${nroHab} (${nombreHuesped})`,
                            start: fechaLate + 'T' + '12:00:00', 
                            end: fechaLate + 'T' + (horaOut > '12:00:00' ? horaOut : '18:00:00'),
                            extendedProps: {
                                medio: 'Early/Late',
                                estadoHabitacion: 'Extra_Late',
                                esExtra: true
                            }
                        });
                    }
                }

                return eventosDeEstaReserva;
            }).flatMap(evt => evt); // 🌟 Cambiado a flatMap para evitar arreglos anidados vacíos o nulos

            // --- Generación automática de la fila de Totales de Ocupación (Corregido y Blindado) ---
            let conteoOcupacionPorDia = {};

            eventosReservas.forEach(evt => {
                // Filtramos para no contar bloques de cancelaciones o no-shows en los totales
                if (evt.extendedProps?.estadoHabitacion === 'Cancelada' || evt.extendedProps?.estadoHabitacion === 'No Show') return;

                // Extraemos las fechas puras de inicio y fin del bloque visual (quitando la parte de la 'T')
                const fechaInicioStr = evt.start.split('T')[0];
                const fechaFinStr = evt.end.split('T')[0];

                const fInicio = new Date(fechaInicioStr + 'T00:00:00');
                const fFin = new Date(fechaFinStr + 'T00:00:00');

                // Recorremos todos los días que abarca este bloque visual específico
let fechaIterada = new Date(fInicio);
while (fechaIterada <= fFin) {
    const fechaClave = fechaIterada.toISOString().split('T')[0];

    if (fechaClave === fechaFinStr && !evt.extendedProps?.esExtra && evt.extendedProps?.medio !== 'Day use') {
        if (fechaInicioStr !== fechaFinStr) {
            break; 
        }
    }

    if (!conteoOcupacionPorDia[fechaClave]) {
        conteoOcupacionPorDia[fechaClave] = 0;
    }
    
    conteoOcupacionPorDia[fechaClave]++;

    // Avanzamos al siguiente día del bucle
    fechaIterada.setDate(fechaIterada.getDate() + 1);
}
            });

            // Mapeamos los totales calculados para que FullCalendar los pinte en la fila 'total-row'
            const eventosTotales = Object.keys(conteoOcupacionPorDia).map(fecha => {
                return {
                    id: `total-${fecha}`,
                    resourceId: 'total-row',
                    start: fecha,
                    end: fecha, 
                    allDay: true,
                    title: conteoOcupacionPorDia[fecha].toString(),
                    display: 'background',
                    backgroundColor: 'transparent',
                    extendedProps: { esTotal: true }
                };
            });

            const todosLosEventos = [...eventosReservas, ...eventosTotales];
            
            const fuentesViejas = calendar.getEventSources();
            fuentesViejas.forEach(fuente => fuente.remove());
            calendar.addEventSource(todosLosEventos);
        }

        // --- 📋 B. RENDEREAR TABLA INFERIOR DE RESERVAS ---
        const tablaBodyReal = document.getElementById("tablaReservasBody");
        if (tablaBodyReal) {
            tablaBodyReal.innerHTML = "";
            
            listaReservasGlobal.forEach(res => {
                const tarifaBase = parseFloat(res.tarifa_pactada) || 0;
                const simboloMoneda = res.moneda === 'USD' ? '$' : 'S/';
                const medioOriginal = res.medio_reserva || "Presencial";

                const fIn = new Date(res.check_in_fecha + 'T00:00:00');
                const fOut = new Date(res.check_out_fecha + 'T00:00:00');
                const nichesCalculados = Math.round((fOut - fIn) / (1000 * 60 * 60 * 24));
                const noches = nichesCalculados > 0 ? nichesCalculados : 1;

                const adicionales = (parseFloat(res.cargo_early_checkin) || 0) + (parseFloat(res.cargo_late_checkout) || 0);
                const totalCalculadoEstancia = (noches * tarifaBase) + adicionales;

                const listaPagos = Array.isArray(res.pagos) ? res.pagos : [];
                const pagoAdelanto = listaPagos.find(p => p.concepto === 'Adelanto');
                
                const metodoPago = pagoAdelanto?.metodo_pago || 'Pendiente';
                const adelantoSoles = parseFloat(pagoAdelanto?.monto_soles) || 0; 

                const tr = document.createElement("tr");
                tr.className = "border-b border-gray-100 hover:bg-gray-50 transition-colors";
                
                tr.innerHTML = `
                    <td class="p-3">
                        <div class="font-bold text-gray-800">${res.huespedes?.nombres_apellidos || 'Sin Nombre'}</div>
                        <div class="text-xs text-gray-400">${res.huespedes?.documento_num || '---'}</div>
                    </td>
                    <td class="p-3 text-gray-600 text-sm">
                        ${res.created_at ? formatearFechaLocal(res.created_at) : '---'}
                    </td>
                    <td class="p-3">
                        <span class="font-semibold text-gray-700">Hab. ${res.habitaciones?.numero || '??'}</span><br>
                        <small class="text-xs text-gray-400">${res.habitaciones?.tipo || ''}</small>
                    </td>
                    <td class="p-3 text-sm text-gray-600 text-center">
                        ${formatearFechaLocal(res.check_in_fecha)}
                    </td>
                    <td class="p-3 text-sm text-gray-600 text-center">
                        ${formatearFechaLocal(res.check_out_fecha)}
                    </td>
                    <td class="p-3 text-sm text-gray-600 text-center">${res.numero_personas || '1'}</td>
                    
                    <td class="p-3 text-right">
                        <div class="font-semibold text-gray-800">${simboloMoneda} ${totalCalculadoEstancia.toFixed(2)}</div>
                        <div class="text-xs text-emerald-600 font-medium" title="Monto adelantado unificado en soles">
                            Adelanto: S/ ${adelantoSoles.toFixed(2)}
                        </div>
                    </td>
                    
                    <td class="p-3 text-center">
                        <span class="badge-medio type-${medioOriginal.toLowerCase().replace(/\s/g, "")}">${medioOriginal}</span>
                        <div class="text-xxs text-gray-400 mt-1 font-mono">${metodoPago}</div>
                    </td>
                    
                    <td class="p-3 text-center">
                        <div class="flex justify-center gap-2 actions">
                            <button type="button" class="btn-edit" onclick="prepararEdicion('${res.id}')" title="Editar"><i class="fa-solid fa-pen"></i></button>
                            <button type="button" class="btn-delete" onclick="eliminarReserva('${res.id}')" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </td>`;
                tablaBodyReal.appendChild(tr);
            });
        }

        // --- 📈 C. CONTEO DE KPIS DE MARKETING ---
        const conteo = { presencial: 0, llamada: 0, whatsapp: 0, booking: 0, airbnb: 0, expedia: 0, dayuse: 0, gmail: 0, otro: 0 };

        listaReservasGlobal.forEach(res => {
            const medioOriginal = res.medio_reserva || "Presencial";
            let medioClave = medioOriginal.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s/g, "");

            if (medioClave === "telefono" || medioClave === "llamadas") medioClave = "llamada";
            if (medioClave === "personal") medioClave = "otro";

            if (conteo.hasOwnProperty(medioClave)) {
                conteo[medioClave]++;
            } else {
                conteo["otro"]++; 
            }
        });

        Object.keys(conteo).forEach(k => {
            const el = document.getElementById(`stat-${k}`) || document.getElementById(`kpi-${k}`) || document.getElementById(k);
            if (el) el.textContent = conteo[k];
        });

    } catch (error) {
        console.error("Error al renderizar la tabla y el rack:", error.message || error);
    }
};

// Canal único Realtime para sincronizar todos los terminales del hotel en vivo
supabase
    .channel('cambios-reservas')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reservas' }, () => {
        escucharReservas();
    })
    .subscribe();

// ==========================================================================
// --- FUNCIÓN TRANSACCIONAL BLINDADA CONTRA COLUMNAS INEXISTENTES ---
// ==========================================================================
const guardarReservaTransaccional = async (objetoReserva, objetoPago) => {
    try {
        // SEGURIDAD OBLIGATORIA: Rescate de credenciales de usuario activo del sistema
        const idUsuarioActivo = localStorage.getItem("id_usuario") || localStorage.getItem("id_usuario_logueado");
        const nombreRecepcionistaActivo = localStorage.getItem("nombre_recepcionista") || "Recepcionista General";

        // ==========================================================================
        // 1. Si editId existe, es una EDICIÓN (UPDATE)
        // ==========================================================================
        if (typeof editId !== 'undefined' && editId) {
            
            // 🛡️ Borrado preventivo: En edición no se procesan datos de huésped nuevo
            if ('nuevo_huesped_datos' in objetoReserva) {
                delete objetoReserva.nuevo_huesped_datos;
            }

            // Actualizar la Reserva
            const { error: errorUpdateRes } = await supabase
                .from("reservas")
                .update(objetoReserva)
                .eq("id", editId);

            if (errorUpdateRes) throw errorUpdateRes;

            // Actualizar o insertar el pago de Adelanto relacionado
            if (objetoPago) {
                const { data: pagoExistente } = await supabase
                    .from("pagos")
                    .select("id")
                    .eq("id_reserva", editId)
                    .eq("concepto", "Adelanto")
                    .maybeSingle();

                const montoOriginal = objetoPago.adelanto_monto || objetoPago.monto_soles || 0;
                const montoEnSoles = objetoPago.monto_soles || montoOriginal;
                const tcUsado = objetoPago.tipo_cambio_usado || 1.000;

                if (pagoExistente) {
                    const { error: errorUpdatePago } = await supabase
                        .from("pagos")
                        .update({
                            adelanto_monto: montoOriginal,
                            monto_soles: montoEnSoles,
                            tipo_cambio_usado: tcUsado,
                            metodo_pago: objetoPago.metodo_pago,
                            nro_operacion: objetoPago.nro_operacion || null,
                            nombre_recepcionista: nombreRecepcionistaActivo,
                            // 🛡️ [BLINDAJE] Si se edita el monto, se mantiene el turno/fecha del objeto original enviado
                            turno: objetoPago.turno,
                            fecha_pago: objetoPago.fecha_pago,
                            hora_pago: objetoPago.hora_pago // Se añade para actualizar la hora exacta si cambia el pago
                        })
                        .eq("id", pagoExistente.id);
                    
                    if (errorUpdatePago) throw errorUpdatePago;
                } else {
                    const { error: errorInsertPago } = await supabase
                        .from("pagos")
                        .insert({
                            id_reserva: editId,
                            id_usuario: idUsuarioActivo, 
                            turno: objetoPago.turno,
                            fecha_pago: objetoPago.fecha_pago,
                            hora_pago: objetoPago.hora_pago, // Se añade la consistencia de la hora calculada
                            nombre_recepcionista: nombreRecepcionistaActivo,
                            adelanto_monto: montoOriginal,
                            monto_soles: montoEnSoles,
                            tipo_cambio_usado: tcUsado,
                            moneda: 'PEN',
                            metodo_pago: objetoPago.metodo_pago,
                            concepto: 'Adelanto',
                            nro_operacion: objetoPago.nro_operacion || null
                        });

                    if (errorInsertPago) throw errorInsertPago;
                }
            }
            
            if (typeof Toast !== 'undefined' && Toast) {
                Toast.fire({ icon: 'success', title: 'Reserva actualizada correctamente' });
            }

        } else {
            // ==========================================================================
            // 2. Si editId NO existe, es una NUEVA RESERVA (INSERT)
            // ==========================================================================
            
            // 🚀 EVALUAMOS SI REALMENTE CONTIENE UN OBJETO CON DATOS DE HUÉSPED
            if (objetoReserva.nuevo_huesped_datos && typeof objetoReserva.nuevo_huesped_datos === 'object') {
                
                const { data: nuevoHuesped, error: errorHuesped } = await supabase
                    .from("huespedes")
                    .insert(objetoReserva.nuevo_huesped_datos)
                    .select("id")
                    .single();

                if (errorHuesped) {
                    if (errorHuesped.code === "23505") {
                        throw new Error(`El número de documento ya se encuentra registrado.`);
                    }
                    throw errorHuesped;
                }

                if (nuevoHuesped) {
                    objetoReserva.id_huesped = nuevoHuesped.id;
                }
            }

            delete objetoReserva.nuevo_huesped_datos;

            // Inserción de la Reserva estándar
            const { data: nuevaReserva, error: errorInsertRes } = await supabase
                .from("reservas")
                .insert(objetoReserva)
                .select()
                .single();

            if (errorInsertRes) throw errorInsertRes;

            // Si se creó la reserva, insertamos el pago asociado
            if (nuevaReserva && objetoPago) {
                const montoOriginal = objetoPago.adelanto_monto || objetoPago.monto_soles || 0;
                const montoEnSoles = objetoPago.monto_soles || montoOriginal;
                const tcUsado = objetoPago.tipo_cambio_usado || 1.000;

                const { error: errorInsertPago } = await supabase
                    .from("pagos")
                    .insert({
                        id_reserva: nuevaReserva.id,
                        id_usuario: idUsuarioActivo, 
                        turno: objetoPago.turno,
                        fecha_pago: objetoPago.fecha_pago,
                        hora_pago: objetoPago.hora_pago, // 🏨 Registra la hora exacta calculada del formulario
                        nombre_recepcionista: nombreRecepcionistaActivo,
                        adelanto_monto: montoOriginal,
                        monto_soles: montoEnSoles,
                        tipo_cambio_usado: tcUsado,
                        moneda: 'PEN',
                        metodo_pago: objetoPago.metodo_pago,
                        concepto: 'Adelanto',
                        nro_operacion: objetoPago.nro_operacion || null
                    });

                if (errorInsertPago) throw errorInsertPago;
            }

            if (typeof Toast !== 'undefined' && Toast) {
                Toast.fire({ icon: 'success', title: 'Nueva reserva registrada con éxito' });
            }
        }

        // Limpiar estado del formulario y cerrar modal
        if (typeof editId !== 'undefined') editId = null;
        
        const modal = document.getElementById("modalFormularioReserva") || document.getElementById("modalReservas") || document.getElementById("modalReserva");
        if (modal) {
            modal.classList.remove("active");
            modal.style.display = "none";
        }
        
        if (typeof formReserva !== 'undefined' && formReserva) formReserva.reset();
        else if (typeof form !== 'undefined' && form) form.reset();

        const formActivo = (typeof formReserva !== 'undefined' && formReserva) ? formReserva : ((typeof form !== 'undefined' && form) ? form : null);
        if (formActivo) {
            delete formActivo.dataset.idHuesped;
        }

        if (typeof escucharReservas === 'function') escucharReservas();

    } catch (error) {
        console.error("Error en la operación transaccional:", error.message || error);
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                icon: 'error',
                title: 'Error al procesar la solicitud',
                text: error.message || 'Error interno del servidor.'
            });
        }
    }
};

// ==========================================================================
// --- 7. VERIFICACIÓN DE DISPONIBILIDAD EN TIEMPO REAL ---
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

// ==========================================================================
// --- 8. FUNCIONES DE MODAL Y PREPARAR EDICIÓN ---
// ==========================================================================
window.prepararEdicion = async (id) => {
    // Busca directamente en la lista global que ya sincronizó escucharReservas
    const res = listaReservasGlobal.find(r => r.id === id);
    
    if (res && form) {
        editId = id; // Asignamos el ID a la variable global para que guarde como UPDATE
        
        const modalTitle = document.getElementById("modalTitle");
        if (modalTitle) modalTitle.textContent = "Editar Reserva";
        
        // Carga de Datos del Huésped
        if (document.getElementById("resHuesped")) document.getElementById("resHuesped").value = res.huespedes?.nombres_apellidos || "";
        if (document.getElementById("resDoc")) document.getElementById("resDoc").value = res.huespedes?.documento_num || "";
        if (document.getElementById("resTipoDoc")) document.getElementById("resTipoDoc").value = res.huespedes?.documento_tipo || "DNI";
        if (document.getElementById("resTelefono")) document.getElementById("resTelefono").value = res.huespedes?.telefono || "";
        if (document.getElementById("resCorreo")) document.getElementById("resCorreo").value = res.huespedes?.correo || "";
        if (document.getElementById("resNacionalidad")) document.getElementById("resNacionalidad").value = res.huespedes?.nacionalidad || "Peruana";
        if (document.getElementById("resNacimiento")) document.getElementById("resNacimiento").value = res.huespedes?.fecha_nacimiento || "";
        if (document.getElementById("resCiudad")) document.getElementById("resCiudad").value = res.huespedes?.ciudad || "";
        if (document.getElementById("resPreferencia")) document.getElementById("resPreferencia").value = res.huespedes?.preferencias || "";

        // Carga de Datos de la Estancia
        if (document.getElementById("resHabitacion")) document.getElementById("resHabitacion").value = res.id_habitacion || "";
        if (document.getElementById("resMedio")) document.getElementById("resMedio").value = res.medio_reserva || "";
        if (document.getElementById("resCheckIn")) document.getElementById("resCheckIn").value = res.check_in_fecha || "";
        if (document.getElementById("resCheckOut")) document.getElementById("resCheckOut").value = res.check_out_fecha || "";
        if (document.getElementById("resEstado")) document.getElementById("resEstado").value = res.estado_reserva || "Confirmada";
        if (document.getElementById("resNumPersonas")) document.getElementById("resNumPersonas").value = res.numero_personas || "1";
        if (document.getElementById("resAplcaNiños")) document.getElementById("resAplcaNiños").checked = res.aplica_ninos || false;
        if (document.getElementById("resInformacionNinos")) document.getElementById("resInformacionNinos").value = res.informacion_ninos || "";
        
        // Extras y Tiempos
        if (document.getElementById("resEarlyHora")) document.getElementById("resEarlyHora").value = res.check_in_hora || "";
        if (document.getElementById("resLateHora")) document.getElementById("resLateHora").value = res.check_out_hora || "";
        if (document.getElementById("resInfo")) document.getElementById("resInfo").value = res.desayuno ? "true" : "false";
        if (document.getElementById("resCochera")) document.getElementById("resCochera").value = res.cochera || "No";
        if (document.getElementById("resTraslado")) document.getElementById("resTraslado").value = res.traslado || "";
        if (document.getElementById("resObservaciones")) document.getElementById("resObservaciones").value = res.notas || "";

        // Casillas de verificación (Early y Late) ajustadas a los IDs correctos
        if (document.getElementById("resAplicaEarly")) document.getElementById("resAplicaEarly").checked = res.tiene_early_checkin || false;
        if (document.getElementById("resAplicaLate")) document.getElementById("resAplicaLate").checked = res.tiene_late_checkout || false;

        // Financiero
        if (document.getElementById("resTarifa")) document.getElementById("resTarifa").value = res.tarifa_pactada || "";
        if (document.getElementById("resMoneda")) document.getElementById("resMoneda").value = res.moneda || "PEN";
        if (document.getElementById("resTipoCambio")) document.getElementById("resTipoCambio").value = res.tipo_cambio || "1.000";
        
        const inputAdelanto = document.getElementById("resAdelantoMonto");
        const selectMetodo = document.getElementById("resMetodoPago");
        const inputDetalle = document.getElementById("resAdelantoDetalle");

        // Búsqueda del pago usando la columna correcta del esquema: monto_soles
        const pAdelanto = Array.isArray(res.pagos) ? res.pagos.find(p => p.concepto === 'Adelanto') : null;
        
        if (inputAdelanto) inputAdelanto.value = pAdelanto ? (pAdelanto.monto_soles ?? "0.00") : "0.00"; 
        if (selectMetodo) selectMetodo.value = pAdelanto ? (pAdelanto.metodo_pago || "Efectivo") : "Efectivo";
        if (inputDetalle) inputDetalle.value = pAdelanto ? (pAdelanto.nro_operacion || "") : "";

        // Sincronizamos el dataset y el input oculto del huésped
        form.dataset.idHuesped = res.id_huesped || "";
        const inputHiddenId = document.getElementById('resHuespedId');
        if (inputHiddenId) inputHiddenId.value = res.id_huesped || "";

        // Ejecutar cálculos reactivos de montos y verificación del Rack
        if (typeof window.calcularMontos === 'function') window.calcularMontos();
        
        if (typeof verificarDisponibilidadRealTime === 'function') {
            verificarDisponibilidadRealTime();
        }
        
        const modal = document.getElementById("modalFormularioReserva") || document.getElementById("modalReservas") || document.getElementById("modalReserva");
        if (modal) {
            modal.classList.add("active");
            modal.style.display = 'flex';
        }
    }
};

// ==========================================================================
// --- 9. ELIMINAR RESERVA CONTROLES ---
// ==========================================================================
window.eliminarReserva = async (id) => {
    if (typeof Swal === 'undefined') return;

    const result = await Swal.fire({ 
        title: '¿Eliminar reserva?', 
        text: "Esta acción eliminará la reserva de forma permanente del sistema.",
        icon: 'warning', 
        showCancelButton: true, 
        confirmButtonColor: '#800020', // Vino tinto boutique
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Sí, borrar',
        cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
        try {
            const { error } = await supabase
                .from("reservas")
                .delete()
                .eq("id", id);

            if (error) throw error;

            if (typeof Toast !== 'undefined' && Toast) {
                Toast.fire({ icon: 'success', title: 'Reserva eliminada con éxito' });
            }
            escucharReservas(); 
        } catch (error) {
            Swal.fire({ icon: 'error', title: 'Error al eliminar', text: error.message });
        }
    }
};

// Lanzamiento inicial automático de datos
escucharReservas();

// ==========================================================================
// --- FUNCIÓN: MOSTRAR FICHA DE RESERVA COMPLETA (SOLO LECTURA) ---
// ==========================================================================
window.mostrarFichaReserva = async function(idReserva) {
    if (!idReserva) return;

    try {
        const { data: res, error } = await supabase
            .from('reservas')
            .select(`
                *, 
                huespedes (nombres_apellidos, documento_num, documento_tipo, telefono, correo, nacionalidad, ciudad, fecha_nacimiento, preferencias), 
                habitaciones (numero, tipo),
                pagos (id, adelanto_monto, monto_soles, moneda, metodo_pago, nro_operacion, concepto, nombre_recepcionista),
                usuarios (usuario)
            `)
            .eq('id', idReserva)
            .single();

        if (error || !res) {
            console.error("Error al obtener la reserva de Supabase:", error);
            return;
        }

        // --- A. ASIGNACIÓN DE DATOS DEL HUÉSPED ---
        if (document.getElementById("viewHuespedNombre")) document.getElementById("viewHuespedNombre").textContent = res.huespedes?.nombres_apellidos || "Sin registrar";
        if (document.getElementById("viewHuespedDoc")) document.getElementById("viewHuespedDoc").textContent = `${res.huespedes?.documento_tipo || 'DOC'}: ${res.huespedes?.documento_num || '---'}`;
        if (document.getElementById("viewHuespedTel")) document.getElementById("viewHuespedTel").textContent = res.huespedes?.telefono || "---";
        if (document.getElementById("viewHuespedCorreo")) document.getElementById("viewHuespedCorreo").textContent = res.huespedes?.correo || "---";
        if (document.getElementById("viewHuespedNacio")) document.getElementById("viewHuespedNacio").textContent = res.huespedes?.nacionalidad || "Peruana";
        if (document.getElementById("viewHuespedCiudad")) document.getElementById("viewHuespedCiudad").textContent = res.huespedes?.ciudad || "---";
        if (document.getElementById("viewHuespedNacimiento")) document.getElementById("viewHuespedNacimiento").textContent = res.huespedes?.fecha_nacimiento ? formatearFechaLocal(res.huespedes.fecha_nacimiento) : "---";
        if (document.getElementById("viewHuespedPref")) document.getElementById("viewHuespedPref").textContent = res.huespedes?.preferencias || "Ninguna";

        // --- B. ASIGNACIÓN DE DETALLES DE LA ESTANCIA ---
        if (document.getElementById("viewResHabitacion")) document.getElementById("viewResHabitacion").textContent = `Hab. ${res.habitaciones?.numero || '??'} — ${res.habitaciones?.tipo || 'S/D'}`;
        if (document.getElementById("viewResMedio")) document.getElementById("viewResMedio").textContent = res.medio_reserva || "Presencial";
        if (document.getElementById("viewResCheckIn")) document.getElementById("viewResCheckIn").textContent = formatearFechaLocal(res.check_in_fecha);
        if (document.getElementById("viewResCheckOut")) document.getElementById("viewResCheckOut").textContent = formatearFechaLocal(res.check_out_fecha);
        if (document.getElementById("viewResHoraEarly")) document.getElementById("viewResHoraEarly").textContent = res.tiene_early_checkin ? (res.check_in_hora || "Sí (Sin hora)") : "No aplica";
        if (document.getElementById("viewResHoraLate")) document.getElementById("viewResHoraLate").textContent = res.tiene_late_checkout ? (res.check_out_hora || "Sí (Sin hora)") : "No aplica";
        if (document.getElementById("viewResPersonas")) document.getElementById("viewResPersonas").textContent = res.numero_personas || "1";
        if (document.getElementById("viewResAplicaNinos")) document.getElementById("viewResAplicaNinos").textContent = res.aplica_ninos ? "Sí" : "No";
        if (document.getElementById("viewInformacionNinos")) document.getElementById("viewInformacionNinos").textContent = res.informacion_ninos || "N/A";
        
        const badgeEst = document.getElementById("viewResEstado");
if (badgeEst) {
    const estadoTexto = res.estado_reserva || "CONFIRMADA";
    badgeEst.textContent = estadoTexto;
    
    // 🛠️ Removemos espacios extras (ej: "en curso" se convierte en "encurso")
    const claseEstado = estadoTexto.toLowerCase().replace(/\s+/g, '');
    badgeEst.className = `badge-estado estado-${claseEstado}`;
}

        const fechaInicio = new Date(res.check_in_fecha + "T00:00:00");
        const fechaFin = new Date(res.check_out_fecha + "T00:00:00");
        const nochesCalculadas = Math.max(Math.round((fechaFin - fechaInicio) / (1000 * 60 * 60 * 24)), 1);
        
        if (document.getElementById("viewResNoches")) document.getElementById("viewResNoches").textContent = nochesCalculadas;

        // --- C. SERVICIOS ADICIONALES Y OBSERVACIONES ---
        if (document.getElementById("viewResDesayuno")) document.getElementById("viewResDesayuno").textContent = res.desayuno ? "Sí (Incluido)" : "No incluye";
        if (document.getElementById("viewResCochera")) document.getElementById("viewResCochera").textContent = res.cochera || "No";
        if (document.getElementById("viewResTraslado")) document.getElementById("viewResTraslado").textContent = res.traslado || "No ";
        if (document.getElementById("viewResNotas")) document.getElementById("viewResNotas").textContent = res.notas || "Sin observaciones adicionales.";

        // --- D. TRATAMIENTO FINANCIERO Y AUDITORÍA ---
const simboloTarifa = res.moneda === 'USD' ? '$' : 'S/';
const simboloSoles = 'S/';
const tarifaPorNoche = parseFloat(res.tarifa_pactada) || 0;
const tipoCambio = parseFloat(res.tipo_cambio) || 1.000;

// 🌟 NUEVO: Calculamos la tarifa de una noche convertida a Soles para usarla de base en los cargos extras
const tarifaEnSoles = res.moneda === 'USD' ? (tarifaPorNoche * tipoCambio) : tarifaPorNoche;

// Cálculo dinámico de cargos corregido (usando la tarifa base en SOLES si el cobro por defecto es la mitad)
const costoEarly = (res.tiene_early_checkin && parseFloat(res.cargo_early_checkin) === 0) 
                    ? (tarifaEnSoles / 2) 
                    : parseFloat(res.cargo_early_checkin) || 0;

const costoLate = (res.tiene_late_checkout && parseFloat(res.cargo_late_checkout) === 0) 
                  ? (tarifaEnSoles / 2) 
                  : parseFloat(res.cargo_late_checkout) || 0;

// Obtener info del adelanto
const pagoInfo = Array.isArray(res.pagos) ? res.pagos.find(p => p.concepto === 'Adelanto') : null;
const adelantoMontoSoles = parseFloat(pagoInfo?.monto_soles) || 0;

// Liquidación Total (Multiplicamos la tarifa ya en soles por las noches, y sumamos los cargos ya en soles)
const liquidacionTotal = (tarifaEnSoles * nochesCalculadas) + costoEarly + costoLate;

// --- GESTIÓN DE AUDITORÍA Y OPERACIÓN (NUEVO) ---
const blockOperacion = document.getElementById("viewBlockOperacion");
if (blockOperacion) {
    if (pagoInfo?.nro_operacion) {
        if (document.getElementById("viewResNroOperacion")) {
            document.getElementById("viewResNroOperacion").textContent = pagoInfo.nro_operacion;
        }
        blockOperacion.classList.remove("hidden");
    } else {
        blockOperacion.classList.add("hidden");
    }
}

if (document.getElementById("viewAuditRecepcionista")) {
    // 🛠️ Extraemos correctamente desde el objeto de respuesta 'res'
    let nombreCreador = "Sistema / Recepción";
    
    if (res.usuarios) {
        // Si Supabase lo devuelve como objeto directo
        nombreCreador = res.usuarios.usuario || nombreCreador;
        // Si por la relación de la consulta viene como un array de un elemento
        if (Array.isArray(res.usuarios) && res.usuarios.length > 0) {
            nombreCreador = res.usuarios[0].usuario || nombreCreador;
        }
    }
    
    document.getElementById("viewAuditRecepcionista").textContent = nombreCreador;
}

// --- ASIGNACIÓN AL DOM ---
if (document.getElementById("viewResTarifa")) document.getElementById("viewResTarifa").textContent = `${simboloTarifa} ${tarifaPorNoche.toFixed(2)}`;
if (document.getElementById("viewResCargosExtras")) {
    document.getElementById("viewResCargosExtras").textContent = `${simboloSoles} ${(costoEarly + costoLate).toFixed(2)} (Early: ${costoEarly.toFixed(2)} / Late: ${costoLate.toFixed(2)})`;
}
if (document.getElementById("viewResTipoCambio")) document.getElementById("viewResTipoCambio").textContent = tipoCambio.toFixed(3);
if (document.getElementById("viewResMetodoText")) document.getElementById("viewResMetodoText").textContent = pagoInfo?.metodo_pago || "Efectivo";
if (document.getElementById("viewResAdelanto")) document.getElementById("viewResAdelanto").textContent = `${simboloSoles} ${adelantoMontoSoles.toFixed(2)}`;
if (document.getElementById("viewResTotal")) document.getElementById("viewResTotal").textContent = `${simboloSoles} ${liquidacionTotal.toFixed(2)}`;

        // --- E. CONTROL DE NAVEGACIÓN Y APERTURA ---
        const btnEditar = document.getElementById("btnIrAEditar");
        if (btnEditar) {
            btnEditar.onclick = () => {
                window.cerrarModalVista(); 
                window.prepararEdicion(idReserva); 
            };
        }

        const modalVista = document.getElementById("modalVistaReserva");
        if (modalVista) {
            modalVista.classList.add("active");
            modalVista.style.setProperty("display", "flex", "important");
            modalVista.style.setProperty("visibility", "visible", "important");
            modalVista.style.setProperty("opacity", "1", "important");
        }
    } catch (err) {
        console.error("Error inesperado en mostrarFichaReserva:", err);
    }
};

window.cerrarModalVista = () => {
    const modalVista = document.getElementById("modalVistaReserva");
    if (modalVista) {
        modalVista.classList.remove("active");
        modalVista.style.display = "none";
    }
};