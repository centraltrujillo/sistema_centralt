import { client as supabase } from './config.js';
let editId = null;
let listaReservasGlobal = [];

// --- REFERENCIAS AL DOM (CORREGIDAS Y MAPEADAS CORRECTAMENTE) ---
const tablaBody = document.getElementById("tablaReservasBody");
const form = document.getElementById("formNuevaReserva");
const modal = document.getElementById("modalReserva");
const btnAbrirModal = document.getElementById("btnAbrirModal");
const closeModal = document.querySelector(".close-modal");

// Inputs de cálculo y datos del formulario (IDs unificados con tu HTML)
const selectHabitacion = document.getElementById("resHabitacion");
const inputTarifa = document.getElementById("resTarifa");
const inputCheckIn = document.getElementById("resCheckIn");
const inputCheckOut = document.getElementById("resCheckOut");
const inputTotal = document.getElementById("resTotal");
const inputAdelantoMonto = document.getElementById("resAdelantoMonto");
const inputDiferencia = document.getElementById("resDiferencia");
const selectMoneda = document.getElementById("resMoneda");
const inputTipoChange = document.getElementById("resTipoCambio"); // Sincronizado exactamente con tu HTML

// Checkboxes financieros y Pasarela de pagos
const checkEarly = document.getElementById("resAplicaEarly");
const checkLate = document.getElementById("resAplicaLate");
const selectMetodoPago = document.getElementById("resMetodoPago");
const inputAdelantoDetalle = document.getElementById("resAdelantoDetalle");

// NUEVAS REFERENCIAS: Sección Niños
const checkAplicaNinos = document.getElementById("resAplicaNinos");
const inputInformacionNinos = document.getElementById("resInformacionNinos");


// --- ASIGNACIÓN DE LISTENERS SEGUROS (Vía AddEventListener) ---
if (btnAbrirModal) {
    btnAbrirModal.addEventListener("click", () => {
        editId = null; 
        if (form) form.reset();
        
        const modalTitle = document.getElementById("modalTitle");
        if (modalTitle) modalTitle.textContent = "Nueva Reserva"; 
        
        // Inicializaciones financieras base
        if (inputTotal) inputTotal.value = "0.00";
        if (inputDiferencia) inputDiferencia.value = "0.00";
        if (inputTipoChange) inputTipoChange.value = "1.00"; // Inicializa con el estándar del hotel
        
        // Aseguramos que los checkboxes inicien limpios
        if (checkEarly) checkEarly.checked = false;
        if (checkLate) checkLate.checked = false;
        if (checkAplicaNinos) checkAplicaNinos.checked = false;
        
        // Limpieza de metadatos guardados en el formulario
        if (form) {
            delete form.dataset.idHuesped;
            delete form.dataset.cargoEarly;
            delete form.dataset.cargoLate;
        }
        
        if (modal) modal.classList.add("active"); 
    });
}

// Cierre desde la 'X' o clics externos
if (closeModal) {
    closeModal.addEventListener("click", () => window.cerrarModal());
}

// --- HACER LAS FUNCIONES VISIBLES PARA EL HTML ---
window.cerrarModal = () => { 
    if (modal) modal.classList.remove("active"); 
    if (form) form.reset(); 
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

// --- 1. CARGAR HABITACIONES ---
const cargarHabitacionesSelect = async () => {
    try {
        if (!selectHabitacion) return;

        const { data: habitaciones, error } = await supabase
            .from("habitaciones")
            .select("id, numero, tipo, precio_base") 
            .order("numero", { ascending: true });

        if (error) throw error;

        selectHabitacion.innerHTML = '<option value="">Seleccionar...</option>';
        
        if (!habitaciones || habitaciones.length === 0) return;

        habitaciones.forEach(hab => {
            const option = document.createElement("option");
            option.value = hab.id; 
            option.dataset.precio = hab.precio_base;
            option.textContent = `Hab. ${hab.numero} - ${hab.tipo}`;
            selectHabitacion.appendChild(option);
        });

    } catch (error) {
        console.error("Error al cargar selector de habitaciones:", error.message || error);
    }
};

if (selectHabitacion) {
    selectHabitacion.addEventListener("change", (e) => {
        const optionSeleccionada = e.target.options[e.target.selectedIndex];
        if (!optionSeleccionada) return;
        
        const precioBase = optionSeleccionada.dataset.precio;
        if (precioBase && inputTarifa) {
            inputTarifa.value = parseFloat(precioBase).toFixed(2);
            window.calcularMontos();
        }
    });
}
cargarHabitacionesSelect();

// --- DISPARADORES AUTOMÁTICOS (REVISADOS) ---
if (inputTarifa) inputTarifa.addEventListener("input", () => window.calcularMontos());
if (inputCheckIn) inputCheckIn.addEventListener("change", () => window.calcularMontos());
if (inputCheckOut) inputCheckOut.addEventListener("change", () => window.calcularMontos());
if (inputAdelantoMonto) inputAdelantoMonto.addEventListener("input", () => window.calcularMontos());
if (selectMoneda) selectMoneda.addEventListener("change", () => window.calcularMontos());
if (inputTipoChange) {
    inputTipoChange.addEventListener("input", () => window.calcularMontos());
    inputTipoChange.addEventListener("change", () => window.calcularMontos());
}
if (checkEarly) checkEarly.addEventListener("change", () => window.calcularMontos());
if (checkLate) checkLate.addEventListener("change", () => window.calcularMontos());

// --- 2. LÓGICA DE CÁLCULOS (Conversión Booking USD a Soles, Saldos y Redondeo - ACTUALIZADO) ---
window.calcularMontos = () => {
    if (!inputCheckIn || !inputCheckOut || !inputTarifa || !inputTotal || !inputDiferencia || !inputAdelantoMonto) return;

    const fIn = new Date(inputCheckIn.value + 'T00:00:00');
    const fOut = new Date(inputCheckOut.value + 'T00:00:00');
    const tarifaOrigen = parseFloat(inputTarifa.value) || 0;

    const tieneEarly = checkEarly ? checkEarly.checked : false;
    const tieneLate = checkLate ? checkLate.checked : false;

    // Capturamos la moneda seleccionada
    const moneda = selectMoneda?.value || "PEN";
    
    // Control inteligente del tipo de cambio manual
    let tc = 3.75; 
    if (inputTipoChange && inputTipoChange.value.trim() !== "") {
        const tcParseado = parseFloat(inputTipoChange.value);
        if (!isNaN(tcParseado) && tcParseado > 0) {
            tc = tcParseado; // Toma exactamente lo que digite la recepcionista en tiempo real
        }
    }

    if (!inputCheckIn.value || !inputCheckOut.value) {
        inputTotal.value = "0.00";
        inputDiferencia.value = "0.00";
        return;
    }

    // Permite el mismo día libremente
const noches = Math.round((fOut - fIn) / (1000 * 60 * 60 * 24));

// Ahora solo frena si las noches son negativas (error de fechas)
if (noches < 0) {
    inputTotal.value = "0.00";
    inputDiferencia.value = "0.00";
    return;
}
    
    // 🔥 A. Conversión inmediata a Soles para unificar la moneda antes de los recargos
    let tarifaEnSoles = tarifaOrigen;
    if (moneda === "USD") {
        tarifaEnSoles = tarifaOrigen * tc; 
    }

    // B. Cálculos base unificados en Soles (Soporta Day Use si noches es 0)
    let subtotalHospedajeSoles = noches === 0 ? tarifaEnSoles : noches * tarifaEnSoles; 
    let cargoEarlySoles = tieneEarly ? (tarifaEnSoles * 0.5) : 0.00;
    let cargoLateSoles = tieneLate ? (tarifaEnSoles * 0.5) : 0.00;

    let totalBrutoSoles = subtotalHospedajeSoles + cargoEarlySoles + cargoLateSoles;

    // 🌟 C. Redondeo estricto hacia arriba (Ej: 90.15 -> 91.00)
    let totalFinalSoles = Math.ceil(totalBrutoSoles);

    if (form) {
        form.dataset.cargoEarly = cargoEarlySoles.toFixed(2);
        form.dataset.cargoLate = cargoLateSoles.toFixed(2);
    }

    // Pintamos el total final en Soles ajustado en la pantalla
    inputTotal.value = totalFinalSoles.toFixed(2);

    let adelanto = parseFloat(inputAdelantoMonto.value) || 0;

    // El guardarraíl del adelanto se evalúa contra el total final redondeado
    if (adelanto > totalFinalSoles && totalFinalSoles > 0) {
        adelanto = totalFinalSoles;
        inputAdelantoMonto.value = totalFinalSoles.toFixed(2);
        
        if (Toast) {
            Toast.fire({ icon: 'warning', title: 'El adelanto no puede superar al total en soles' });
        }
    }

    inputDiferencia.value = (totalFinalSoles - adelanto).toFixed(2);
};

const Toast = typeof Swal !== 'undefined' ? Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 2000,
    timerProgressBar: true
}) : null;


// --- 3. AUTOCOMPLETADO POR DOCUMENTO O NOMBRE ---
const inputDoc = document.getElementById("resDoc");
const inputHuespedNombre = document.getElementById("resHuesped"); // Tu input de Nombres y Apellidos

// 🌟 NUEVO: Declaramos la referencia al datalist que crearemos en el HTML
const datalistHuespedes = document.getElementById("listaHuespedesSugeridos");

// Función reutilizable para rellenar los campos del formulario (SE QUEDA IGUAL)
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

// A. Búsqueda por Documento (SE QUEDA IGUAL)
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

// 🔄 B. MODIFICADO: Búsqueda dinámica con Lista de Sugerencias (Datalist)
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

// --- 4. GUARDAR O EDITAR RESERVA (MIGRADO A SUPABASE) ---
if (form) {
    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const checkInFecha = document.getElementById("resCheckIn").value;
        const checkOutFecha = document.getElementById("resCheckOut").value;

        if (!checkInFecha || !checkOutFecha) {
            alert("¡Atención! Por favor, ingresa las fechas de entrada y salida.");
            return;
        }

        if (new Date(checkOutFecha) < new Date(checkInFecha)) {
            alert("¡Atención! La fecha de salida (Check-Out) no puede ser anterior a la fecha de entrada (Check-In).");
            return; 
        }

        const idUsuarioActivo = form.dataset.idUsuarioLogueado || 
                               localStorage.getItem("id_usuario_logueado") || 
                               "TU_UUID_REAL_DE_USUARIO_DE_SUPABASE"; 
                               
        const turnoActivo = localStorage.getItem("turno_activo") || "Mañana"; 
        
        const nombreRecepcionista = localStorage.getItem("nombre_recepcionista") || 
                                    document.getElementById("resRecepcion")?.value.trim() || 
                                    "Recepcionista";

        try {
            let idHuesped = form.dataset.idHuesped;

            // 1. CAPTURAR DATOS DEL HUÉSPED
            const documentoTipo = document.getElementById("resTipoDoc").value; 
            const documentoNum = document.getElementById("resDoc").value.trim();
            const nombresApellidos = document.getElementById("resHuesped").value.trim();
            const telefono = document.getElementById("resTelefono").value.trim();
            const nacionalidad = document.getElementById("resNacionalidad").value.trim() || "Peruana";
            const fechaNacimiento = document.getElementById("resNacimiento").value || null;
            const correo = document.getElementById("resCorreo").value.trim() || null;
            const ciudad = document.getElementById("resCiudad").value.trim() || null;
            const preferencias = document.getElementById("resPreferencia").value.trim() || null;

            // 🔄 MODIFICADO: Ahora solo el nombre es estrictamente obligatorio
if (!nombresApellidos) {
    throw new Error("Por favor, ingresa los nombres y apellidos del huésped.");
}

            const datosHuesped = {
                nombres_apellidos: nombresApellidos,
                documento_tipo: documentoTipo,
                documento_num: documentoNum,
                fecha_nacimiento: fechaNacimiento,
                nacionalidad: nacionalidad,
                ciudad: ciudad,
                telefono: telefono,
                correo: correo,
                preferencias: preferencias
            };

            // LÓGICA DE PROCESAMIENTO DEL HUÉSPED
            if (!idHuesped) {
                const { data: nuevoHuesped, error: errorHuesped } = await supabase
                    .from("huespedes")
                    .insert([datosHuesped])
                    .select()
                    .single();

                if (errorHuesped) throw new Error(`Error al registrar huésped: ${errorHuesped.message}`);
                
                idHuesped = nuevoHuesped.id;
                form.dataset.idHuesped = idHuesped; 
                console.log("Nuevo huésped registrado exitosamente con ID:", idHuesped);
            } else {
                const { error: errorUpdate } = await supabase
                    .from("huespedes")
                    .update(datosHuesped)
                    .eq("id", idHuesped);

                if (errorUpdate) throw new Error(`Error al actualizar datos del huésped: ${errorUpdate.message}`);
                console.log("Datos del huésped existente actualizados con éxito.");
            }

            // 2. Preparar los datos de la Estancia
            const idHabitacion = document.getElementById("resHabitacion").value;
            const checkInHora = document.getElementById("resEarlyHora").value || null;
            const checkOutHora = document.getElementById("resLateHora").value || null;
            
            const numeroPersonas = parseInt(document.getElementById("resNumPersonas")?.value) || 1; 
            const tarifaPactada = parseFloat(document.getElementById("resTarifa").value) || 0;
            const moneda = document.getElementById("resMoneda").value;
            
            let tipoCambio = 1.000;
            if (moneda === "USD") {
                tipoCambio = parseFloat(inputTipoChange?.value) || 3.750;
            }

            const cargoEarly = parseFloat(form.dataset.cargoEarly) || 0.00;
            const cargoLate = parseFloat(form.dataset.cargoLate) || 0.00;

            const tieneEarly = document.getElementById("resAplicaEarly")?.checked || false;
            const tieneLate = document.getElementById("resAplicaLate")?.checked || false;
            const desayuno = document.getElementById("resInfo").value === "true"; 
            
            // CAPTURA DE NUEVOS CAMPOS: Control de Niños
            const aplicaNinos = document.getElementById("resAplicaNinos")?.checked || false;
            const informacionNinos = document.getElementById("resInformacionNinos")?.value.trim() || null;
            
            let cochera = document.getElementById("resCochera").value.trim();
            if (!['Red Parking', 'Santa Mónica', 'No'].includes(cochera)) {
                cochera = 'No'; 
            }

            const traslado = document.getElementById("resTraslado").value.trim() || null;
            const notas = document.getElementById("resObservaciones").value.trim() || null;
            const estadoReserva = document.getElementById("resEstado").value;

            const medioReservaInput = document.getElementById("resMedio").value.trim();
            const metodosPermitidosBD = ['Presencial','WhatsApp', 'Teléfono', 'Gmail', 'Expedia', 'Day use', 'Booking', 'Airbnb', 'Otro'];
            const medioReserva = metodosPermitidosBD.includes(medioReservaInput) ? medioReservaInput : 'Otro';

            const objetoReserva = {
                id_huesped: idHuesped,
                id_habitacion: idHabitacion,
                id_usuario: idUsuarioActivo,
                check_in_fecha: checkInFecha,
                check_in_hora: checkInHora,
                check_out_fecha: checkOutFecha,
                check_out_hora: checkOutHora,
                numero_personas: numeroPersonas,
                tarifa_pactada: tarifaPactada,
                moneda: moneda,
                tipo_cambio: tipoCambio,
                cargo_early_checkin: cargoEarly,
                cargo_late_checkout: cargoLate,
                desayuno: desayuno,
                cochera: cochera,
                traslado: traslado,
                medio_reserva: medioReserva,
                estado_reserva: estadoReserva, 
                notas: notas,
                tiene_early_checkin: tieneEarly,   
                tiene_late_checkout: tieneLate,
                tiene_ninos: aplicaNinos,              
                informacion_ninos: informacionNinos     
            };

            let idReservaProcesada = editId;

            if (editId) {
                const { error: errorUpdate } = await supabase
                    .from("reservas")
                    .update(objetoReserva)
                    .eq("id", editId);

                if (errorUpdate) throw errorUpdate;
            } else {
                const { data: nuevaReserva, error: errorInsert } = await supabase
                    .from("reservas")
                    .insert([objetoReserva])
                    .select()
                    .single();

                if (errorInsert) throw errorInsert;
                idReservaProcesada = nuevaReserva.id;
            }

            // =========================================================================
            // 🌟 4. GESTIÓN AUTOMÁTICA DEL PAGO
            // =========================================================================
            const adelantoMonto = parseFloat(document.getElementById("resAdelantoMonto")?.value) || 0;
            
            if (adelantoMonto > 0) {
                const montoFormatSoles = adelantoMonto; 
                const metodoPagoSeleccionado = document.getElementById("resMetodoPago")?.value || "Efectivo";
                const adelantoDetalle = document.getElementById("resAdelantoDetalle")?.value.trim() || null;

                // LÓGICA DE CONTROL HORARIO DE TRUJILLO
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
                        const milisegundosEnUnDia = 24 * 60 * 60 * 1000;
                        const ayer = new Date(ahora.getTime() - milisegundosEnUnDia);
                        fechaCalculada = formateadorFecha.format(ayer);
                    }
                }

                const objetoPago = {
                    id_reserva: idReservaProcesada,
                    id_usuario: idUsuarioActivo,
                    turno: turnoCalculado || turnoActivo, 
                    nombre_recepcionista: nombreRecepcionista,
                    moneda: "PEN",                    
                    tipo_cambio_usado: 1.000,                
                    monto_soles: montoFormatSoles,    
                    monto_recibido: adelantoMonto,     
                    metodo_pago: metodoPagoSeleccionado, 
                    concepto: 'Adelanto',
                    nro_operacion: adelantoDetalle,
                    fecha_pago: fechaCalculada, 
                    hora_pago: ahora.toLocaleTimeString('it-IT', { timeZone: 'America/Lima' })
                };

                if (editId) {
                    const { data: pagoExistente } = await supabase
                        .from("pagos")
                        .select("id")
                        .eq("id_reserva", editId)
                        .eq("concepto", "Adelanto")
                        .maybeSingle();

                    if (pagoExistente) {
                        const { error: errorUpdatePago } = await supabase
                            .from("pagos")
                            .update(objetoPago)
                            .eq("id", pagoExistente.id);
                        if (errorUpdatePago) throw errorUpdatePago;
                    } else {
                        const { error: errorInsertPago } = await supabase
                            .from("pagos")
                            .insert([objetoPago]);
                        if (errorInsertPago) throw errorInsertPago;
                    }
                } else {
                    const { error: errorPago } = await supabase
                        .from("pagos")
                        .insert([objetoPago]);

                    if (errorPago) {
                        console.error("Error al registrar el pago en la tabla:", errorPago.message);
                        throw new Error(`Reserva guardada, pero falló el cobro: ${errorPago.message}`);
                    }
                }
            } else if (editId && adelantoMonto === 0) {
                await supabase
                    .from("pagos")
                    .delete()
                    .eq("id_reserva", editId)
                    .eq("concepto", "Adelanto");
            }

            if (typeof Toast !== 'undefined' && Toast) {
                Toast.fire({ icon: 'success', title: 'Reserva y pago procesados correctamente' });
            }

            if (typeof window.cerrarModal === 'function') {
                window.cerrarModal(); 
            } else if (typeof modal !== 'undefined') {
                modal.classList.remove("active");
            }
            
            if (typeof escucharReservas === 'function') escucharReservas();

        } catch (error) {
            console.error("Error completo desglosado:", error);
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    icon: 'error',
                    title: 'Error al procesar la reserva',
                    text: error.message || "Verifica la sintaxis en la base de datos."
                });
            }
        }
    });
}

// --- 5. RENDERIZADO Y CONSULTA ---
const escucharReservas = async () => {
    try {
        const { data: reservas, error } = await supabase
            .from("reservas")
            .select(`
                *,
                huespedes ( nombres_apellidos, documento_num, documento_tipo, telefono, correo, nacionalidad, fecha_nacimiento, ciudad, preferencias ),
                habitaciones ( numero, tipo ),
                pagos ( id, monto_soles, monto_recibido, metodo_pago, nro_operacion )
            `)
            .order("created_at", { ascending: false });

        if (error) throw error;

        const tablaBodyReal = document.getElementById("tablaReservasBody") || (typeof tablaBody !== 'undefined' ? tablaBody : null);
        if (!tablaBodyReal) return;
        
        tablaBodyReal.innerHTML = "";
        listaReservasGlobal = reservas || [];
        
        const conteo = { 
            "presencial": 0,
            "gmail": 0,
            "expedia": 0,
            "dayuse": 0,
            "booking": 0,
            "airbnb": 0,
            "whatsapp": 0,
            "telefono": 0, 
            "otro": 0      
        };

        listaReservasGlobal.forEach(res => {
            let medioOriginal = res.medio_reserva || "Presencial";
            
            const medioLimpio = medioOriginal.trim()
                                             .toLowerCase()
                                             .normalize("NFD")
                                             .replace(/[\u0300-\u036f]/g, "")
                                             .replace(/\s/g, "");

            if (conteo.hasOwnProperty(medioLimpio)) {
                conteo[medioLimpio]++;
            } else {
                conteo["otro"]++; 
            }

            let noches = 0;
            if (res.check_in_fecha && res.check_out_fecha) {
                const fechaIn = new Date(res.check_in_fecha + 'T12:00:00');
                const fechaOut = new Date(res.check_out_fecha + 'T12:00:00');
                const diferenciaTiempo = fechaOut - fechaIn;
                noches = Math.max(0, Math.ceil(diferenciaTiempo / (1000 * 60 * 60 * 24)));
            }
            
            if (noches === 0) noches = 1;

            const tarifaPorNoche = parseFloat(res.tarifa_pactada) || 0;
            const simboloMoneda = res.moneda === 'USD' ? '$' : 'S/';

            const costoEarly = (res.tiene_early_checkin && parseFloat(res.cargo_early_checkin) === 0) 
                                ? (tarifaPorNoche / 2) 
                                : parseFloat(res.cargo_early_checkin) || 0;

            const costoLate = (res.tiene_late_checkout && parseFloat(res.cargo_late_checkout) === 0) 
                              ? (tarifaPorNoche / 2) 
                              : parseFloat(res.cargo_late_checkout) || 0;

            const totalEstadiaBase = tarifaPorNoche * noches;
            const totalCargosExtras = costoEarly + costoLate;
            const totalMostrar = totalEstadiaBase + totalCargosExtras;

            // 👶 LÓGICA AGREGADA: Verificar si la reserva incluye detalles de niños
            const detallesNiños = res.informacion_ninos && res.informacion_ninos.trim() !== "" 
                ? res.informacion_ninos.trim() 
                : null;

            const tr = document.createElement("tr");
            tr.className = "border-b border-gray-100 hover:bg-gray-50 transition-colors";
            
            tr.innerHTML = `
        <td class="p-3">
            <div class="font-bold text-gray-800">${res.huespedes?.nombres_apellidos || 'Sin Nombre'}</div>
            <div class="text-xs text-gray-400">${res.huespedes?.documento_num || '---'}</div>
        </td>
        
        <td class="p-3 text-gray-600 text-sm">
            ${res.created_at ? new Date(res.created_at).toLocaleDateString('es-PE') : '---'}
        </td>
        
        <td class="p-3">
            <span class="font-semibold text-gray-700">Hab. ${res.habitaciones?.numero || '??'}</span><br>
            <small class="text-xs text-gray-400">${res.habitaciones?.tipo || ''}</small>
        </td>
        
        <td class="p-3 text-sm text-gray-600 text-center">
            ${res.check_in_fecha ? new Date(res.check_in_fecha + 'T12:00:00').toLocaleDateString('es-PE') : '---'}
        </td>
        
        <td class="p-3 text-sm text-gray-600 text-center">
            ${res.check_out_fecha ? new Date(res.check_out_fecha + 'T12:00:00').toLocaleDateString('es-PE') : '---'}
        </td>
        
        <td class="p-3 text-sm text-gray-600 text-center">
            <div class="flex flex-col items-center justify-center">
                <span>${res.numero_personas || '1'}</span>
                ${detallesNiños ? `
                    <div class="mt-1 flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 w-max font-medium" title="${detallesNiños}">
                        <i class="fa-solid fa-child text-xs"></i> <span>${detallesNiños}</span>
                    </div>
                ` : ''}
            </div>
        </td>
        
        <td class="p-3 font-semibold text-gray-800 text-right">
            ${simboloMoneda} ${totalMostrar.toFixed(2)}<br>
            <small class="text-xs text-gray-400 font-normal">
                (${noches} ${noches === 1 ? 'noche' : 'noches'} x ${simboloMoneda}${tarifaPorNoche.toFixed(2)})
                ${totalCargosExtras > 0 ? `<br><span class="text-emerald-600 font-medium">+ ${simboloMoneda}${totalCargosExtras.toFixed(2)} Extras</span>` : ''}
            </small>
        </td>
        
        <td class="p-3 text-center">
            <span class="badge-medio type-${medioLimpio}">${medioOriginal}</span>
        </td>
        
        <td class="p-3 text-center">
            <div class="flex justify-center gap-2 actions">
                <button type="button" class="btn-edit" onclick="prepararEdicion('${res.id}')" title="Editar">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button type="button" class="btn-delete" onclick="eliminarReserva('${res.id}')" title="Eliminar">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        </td>
    `;
            tablaBodyReal.appendChild(tr);
        });

        Object.keys(conteo).forEach(idLimpio => {
            const el = document.getElementById(`stat-${idLimpio}`) || 
                       document.getElementById(`kpi-${idLimpio}`) || 
                       document.getElementById(idLimpio);
                       
            if (el) {
                el.textContent = conteo[idLimpio];
            } else {
                console.warn(`Ojo: No se encontró HTML con el ID para KPI: stat-${idLimpio}`);
            }
        });

    } catch (error) {
        console.error("Error al renderizar la tabla de reservas:", error.message || error);
    }
};

// Activar Realtime de Supabase
supabase
    .channel('cambios-reservas')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reservas' }, () => {
        escucharReservas();
    })
    .subscribe();

// --- FUNCIÓN DE VERIFICACIÓN EN TIEMPO REAL ---
const verificarDisponibilidadRealTime = async () => {
    const idHabitacion = document.getElementById("resHabitacion")?.value; 
    const fIn = document.getElementById("resCheckIn")?.value;
    const fOut = document.getElementById("resCheckOut")?.value;
    const statusDiv = document.getElementById("statusDisponibilidad");
    if (!(typeof form !== 'undefined' ? form : null) || !statusDiv) return;
    
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

// --- FUNCIONES DE MODAL Y EDICIÓN ---
window.prepararEdicion = async (id) => {
    const res = listaReservasGlobal.find(r => r.id === id);
    if (res && (typeof form !== 'undefined' ? form : null)) {
        editId = id;
        
        const modalTitle = document.getElementById("modalTitle");
        if (modalTitle) modalTitle.textContent = "Editar Reserva";
        
        // Huésped
        if (document.getElementById("resHuesped")) document.getElementById("resHuesped").value = res.huespedes?.nombres_apellidos || "";
        if (document.getElementById("resDoc")) document.getElementById("resDoc").value = res.huespedes?.documento_num || "";
        if (document.getElementById("resTipoDoc")) document.getElementById("resTipoDoc").value = res.huespedes?.documento_tipo || "DNI";
        if (document.getElementById("resTelefono")) document.getElementById("resTelefono").value = res.huespedes?.telefono || "";
        if (document.getElementById("resCorreo")) document.getElementById("resCorreo").value = res.huespedes?.correo || "";
        if (document.getElementById("resNacionalidad")) document.getElementById("resNacionalidad").value = res.huespedes?.nacionalidad || "Peruana";
        if (document.getElementById("resNacimiento")) document.getElementById("resNacimiento").value = res.huespedes?.fecha_nacimiento || "";
        if (document.getElementById("resCiudad")) document.getElementById("resCiudad").value = res.huespedes?.ciudad || "";
        if (document.getElementById("resPreferencia")) document.getElementById("resPreferencia").value = res.huespedes?.preferencias || "";

        // Estancia
        if (document.getElementById("resHabitacion")) document.getElementById("resHabitacion").value = res.id_habitacion || "";
        if (document.getElementById("resMedio")) document.getElementById("resMedio").value = res.medio_reserva || "";
        if (document.getElementById("resCheckIn")) document.getElementById("resCheckIn").value = res.check_in_fecha || "";
        if (document.getElementById("resCheckOut")) document.getElementById("resCheckOut").value = res.check_out_fecha || "";
        if (document.getElementById("resEstado")) document.getElementById("resEstado").value = res.estado_reserva || "Confirmada";
        if (document.getElementById("resNumPersonas")) document.getElementById("resNumPersonas").value = res.numero_personas || "1";
        
        // Horas y Adicionales
        if (document.getElementById("resEarlyHora")) document.getElementById("resEarlyHora").value = res.check_in_hora || "";
        if (document.getElementById("resLateHora")) document.getElementById("resLateHora").value = res.check_out_hora || "";
        if (document.getElementById("resInfo")) document.getElementById("resInfo").value = res.desayuno ? "true" : "false";
        if (document.getElementById("resCochera")) document.getElementById("resCochera").value = res.cochera || "No";
        if (document.getElementById("resTraslado")) document.getElementById("resTraslado").value = res.traslado || "";
        if (document.getElementById("resObservaciones")) document.getElementById("resObservaciones").value = res.notas || "";

        // Checkboxes Check-in / Check-out
        if (document.getElementById("resAplicaEarly")) document.getElementById("resAplicaEarly").checked = res.tiene_early_checkin || false;
        if (document.getElementById("resAplicaLate")) document.getElementById("resAplicaLate").checked = res.tiene_late_checkout || false;

        // Configuración de Niños
        if (document.getElementById("resAplicaNinos")) document.getElementById("resAplicaNinos").checked = res.tiene_ninos || false;
        if (document.getElementById("resInformacionNinos")) document.getElementById("resInformacionNinos").value = res.informacion_ninos || "";

        // Tarifas y Moneda
        if (document.getElementById("resTarifa")) document.getElementById("resTarifa").value = res.tarifa_pactada || "";
        if (document.getElementById("resMoneda")) document.getElementById("resMoneda").value = res.moneda || "PEN";
        
        const elTipoCambio = document.getElementById("resTipoCambio") || (typeof inputTipoCambio !== 'undefined' ? inputTipoCambio : null);
        if (elTipoCambio) elTipoCambio.value = res.tipo_cambio || "1.000";
        
        // 🛠️ CORRECCIÓN: Aseguramos coincidencia exacta con la variable del sistema AdelantoMonto
        const inputAdelanto = document.getElementById("resAdelantoMonto") || document.getElementById("AdelantoMonto");
        const selectMetodo = document.getElementById("resMetodoPago");
        const inputDetalle = document.getElementById("resAdelantoDetalle");

        // Configuración Segura de Adelantos
        const pagoAdelanto = (res.pagos && Array.isArray(res.pagos)) 
            ? res.pagos.find(p => parseFloat(p.monto_soles) > 0 || parseFloat(p.monto_recibido) > 0) 
            : null;
        
        if (inputAdelanto) {
            inputAdelanto.value = pagoAdelanto 
                ? (pagoAdelanto.monto_soles || pagoAdelanto.monto_recibido || "0.00") 
                : "0.00";
        }
        
        if (selectMetodo) selectMetodo.value = pagoAdelanto ? (pagoAdelanto.metodo_pago || "Efectivo") : "Efectivo";
        if (inputDetalle) inputDetalle.value = pagoAdelanto ? (pagoAdelanto.nro_operacion || "") : "";

        form.dataset.idHuesped = res.id_huesped || "";

        if (typeof window.calcularMontos === 'function') window.calcularMontos();
        verificarDisponibilidadRealTime();
        
        if (typeof modal !== 'undefined' && modal) modal.classList.add("active");
    }
};

window.eliminarReserva = async (id) => {
    if (typeof Swal === 'undefined') return;

    const result = await Swal.fire({ 
        title: '¿Eliminar reserva?', 
        text: "Esta acción eliminará la reserva de forma permanente.",
        icon: 'warning', 
        showCancelButton: true, 
        confirmButtonColor: '#800020', 
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

            if (typeof Toast !== 'undefined') Toast.fire({ icon: 'success', title: 'Reserva eliminada' });
            if (typeof escucharReservas === 'function') escucharReservas(); 
        } catch (error) {
            Swal.fire({ icon: 'error', title: 'Error al eliminar', text: error.message });
        }
    }
};

// --- LISTENERS AUTOMÁTICOS DE DISPONIBILIDAD ---
[
    document.getElementById("resHabitacion"),
    document.getElementById("resCheckIn"),
    document.getElementById("resCheckOut")
].forEach(el => {
    if (el) {
        el.addEventListener("change", verificarDisponibilidadRealTime);
    }
});

// --- EXPORTAR EXCEL CON RANGO DE FECHAS ---
window.exportarExcel = async () => {
    if (typeof Swal === 'undefined') return;

    const { value: formValues } = await Swal.fire({
        title: '<span style="color:#800020; font-family:\'Playfair Display\', serif; font-weight:bold;">Exportar Reporte de Reservas</span>',
        html: `
            <div style="text-align: left; font-family: 'Lato', sans-serif; padding: 10px;">
                <label style="font-size: 13px; font-weight: bold; color: #4b5563;">Fecha de Inicio (Check-In):</label>
                <input type="date" id="swal-input-inicio" class="swal2-input" style="margin-top: 5px; width: 100%;">
                <br><br>
                <label style="font-size: 13px; font-weight: bold; color: #4b5563;">Fecha de Fin (Check-In):</label>
                <input type="date" id="swal-input-fin" class="swal2-input" style="margin-top: 5px; width: 100%;">
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: '<i class="fa-solid fa-file-excel"></i> Generar Excel',
        confirmButtonColor: '#166534', 
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            const inicio = document.getElementById('swal-input-inicio').value;
            const fin = document.getElementById('swal-input-fin').value;
            if (!inicio || !fin) {
                Swal.showValidationMessage('Por favor selecciona ambas fechas');
                return false;
            }
            return { inicio, fin };
        }
    });

    if (formValues) {
        const { inicio, fin } = formValues;
        
        const dInicio = new Date(inicio + "T00:00:00");
        const dFin = new Date(fin + "T23:59:59");

        const reservasFiltradas = listaReservasGlobal.filter(r => {
            if (!r.check_in_fecha) return false;
            const fechaReserva = new Date(r.check_in_fecha + "T12:00:00");
            return fechaReserva >= dInicio && fechaReserva <= dFin;
        });

        if (reservasFiltradas.length === 0) {
            Swal.fire("Sin registros", "No se encontraron reservas en el rango de fechas seleccionado.", "info");
            return;
        }

        const excelHTML = `
            <table border="1">
                <thead>
                    <tr style="background:#800020; color:white; font-weight:bold; height:30px;">
                        <th>HUESPED</th>
                        <th>TIPO DOC</th>
                        <th>NRO DOCUMENTO</th>
                        <th>HABITACION</th>
                        <th>CHECK-IN</th>
                        <th>CHECK-OUT</th>
                        <th>MONEDA</th>
                        <th>TARIFA PACTADA</th>
                        <th>CARGO EARLY</th>
                        <th>CARGO LATE</th>
                        <th>ADELANTO COBRADO</th>
                        <th>METODO PAGO</th>
                        <th>NRO OPERACION</th>
                        <th>MEDIO RESERVA</th>
                        <th>ESTADO</th>
                        <th>APLICA NIÑOS</th>
                        <th>DETALLE NIÑOS</th>
                        <th>NOTAS INTERNAS</th>
                    </tr>
                </thead>
                <tbody>
                    ${reservasFiltradas.map(r => {
                        const tarifaPorNoche = parseFloat(r.tarifa_pactada) || 0;

                        const costoEarly = (r.tiene_early_checkin && (parseFloat(r.cargo_early_checkin) === 0 || !r.cargo_early_checkin)) 
                                            ? (tarifaPorNoche / 2) 
                                            : parseFloat(r.cargo_early_checkin) || 0;

                        const costoLate = (r.tiene_late_checkout && (parseFloat(r.cargo_late_checkout) === 0 || !r.cargo_late_checkout)) 
                                          ? (tarifaPorNoche / 2) 
                                          : parseFloat(r.cargo_late_checkout) || 0;

                        const pagoAdelanto = (r.pagos && Array.isArray(r.pagos)) 
                            ? r.pagos.find(p => parseFloat(p.monto_soles) > 0 || parseFloat(p.monto_recibido) > 0) 
                            : null;
                        
                        // 🛠️ OPTIMIZACIÓN: Fallback matemático seguro para evitar errores de renderizado
                        const valorMonto = pagoAdelanto ? (pagoAdelanto.monto_soles || pagoAdelanto.monto_recibido || 0) : 0;
                        const montoAdelanto = parseFloat(valorMonto) || 0;
                            
                        const metodoPago = pagoAdelanto ? (pagoAdelanto.metodo_pago || '---') : '---';
                        const nroOperacion = pagoAdelanto ? (pagoAdelanto.nro_operacion || '---') : '---';

                        return `
                        <tr style="height:25px;">
                            <td>${r.huespedes?.nombres_apellidos || 'Sin Nombre'}</td>
                            <td style="text-align:center;">${r.huespedes?.documento_tipo || 'DNI'}</td>
                            <td style="text-align:center;">'${r.huespedes?.documento_num || '---'}</td> 
                            <td style="text-align:center;">Hab. ${r.habitaciones?.numero || '??'}</td>
                            <td style="text-align:center;">${r.check_in_fecha || '---'}</td>
                            <td style="text-align:center;">${r.check_out_fecha || '---'}</td>
                            <td style="text-align:center;">${r.moneda || 'PEN'}</td>
                            <td style="text-align:right;">${tarifaPorNoche.toFixed(2)}</td>
                            <td style="text-align:right; color:#b45309;">${costoEarly.toFixed(2)}</td>
                            <td style="text-align:right; color:#b45309;">${costoLate.toFixed(2)}</td>
                            <td style="text-align:right; font-weight:bold; color:#16a34a;">${montoAdelanto.toFixed(2)}</td>
                            <td style="text-align:center;">${metodoPago}</td>
                            <td style="text-align:center;">'${nroOperacion}</td>
                            <td style="text-align:center;">${r.medio_reserva || 'Presencial'}</td>
                            <td style="text-align:center;">${r.estado_reserva || 'Confirmada'}</td>
                            <td style="text-align:center;">${r.aplica_ninos ? 'SÍ' : 'NO'}</td>
                            <td>${r.informacion_ninos || ''}</td>
                            <td>${r.notas || ''}</td>
                        </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>`;

        const blob = new Blob(['\ufeff' + excelHTML], { type: 'application/vnd.ms-excel' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Reporte_Reservas_HotelCentral_${inicio}_al_${fin}.xls`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
};

// --- FUNCIÓN DE INICIO Y ORQUESTACIÓN GLOBAL ---
window.inicializarPagina = () => {
    console.log("Iniciando Módulo de Reservas - Hotel Central v2 (Supabase Production)");
    if (typeof escucharReservas === 'function') {
        escucharReservas();
    }
};

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => window.inicializarPagina());
} else {
    window.inicializarPagina();
}