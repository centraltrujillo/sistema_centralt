import { client as supabase } from './config.js';

// =========================================================================
// --- ESTADOS Y VARIABLES GLOBALES DE CONTROL ---
// =========================================================================
let editId = null;
let listaReservasGlobal = [];

// =========================================================================
// --- REFERENCIAS AL DOM UNIFICADAS Y MAPEADAS CORRECTAMENTE ---
// =========================================================================
const tablaBody = document.getElementById("tablaReservasBody");
const modal = document.getElementById("modalReserva");
const btnAbrirModal = document.getElementById("btnAbrirModal");
const closeModal = document.querySelector(".close-modal");

// Formulario unificado (Fallback seguro entre formReserva y formNuevaReserva)
const form = document.getElementById("formReserva") || document.getElementById("formNuevaReserva");

// 1. Datos de la Habitación y Fechas
const txtHabitacion = document.getElementById("resHabitacion");
const txtCheckIn = document.getElementById("resCheckIn");
const txtCheckOut = document.getElementById("resCheckOut");

// 2. Valores Financieros de la Reserva (Moneda Original)
const txtTarifa = document.getElementById("resTarifa");
const txtTotal = document.getElementById("resTotal");
const txtAdelantoMonto = document.getElementById("resAdelantoMonto");
const txtDiferencia = document.getElementById("resDiferencia");
const selectMonedaReserva = document.getElementById("resMoneda");
const txtTipoCambio = document.getElementById("resTipoCambio");

// 3. Elementos de Control Early / Late Check
const chkEarly = document.getElementById("resAplicaEarly");
const chkLate = document.getElementById("resAplicaLate");
const valEarlyPreview = document.getElementById("valEarlyPreview");
const valLatePreview = document.getElementById("valLatePreview");

// 4. Pasarela de Pagos en Recepción (Flujo de Caja Directo)
const selectMonedaPago = document.getElementById("pagMonedaRecibida") || document.getElementById("resMonedaPago");
const txtMontoRecibido = document.getElementById("pagMontoRecibido") || document.getElementById("resMontoRecibido");
const txtMontoSoles = document.getElementById("pagMontoSoles") || document.getElementById("resMontoEquivalenteSoles");
const selectMetodoPago = document.getElementById("resMetodoPago");
const inputAdelantoDetalle = document.getElementById("resAdelantoDetalle");

// 5. Componentes de Interfaz: Sección Espejo en Soles (Fines de Auditoría)
const guiTotalSoles = document.getElementById("guiTotalSoles");
const guiAdelantoSoles = document.getElementById("guiAdelantoSoles");
const guiDiferenciaSoles = document.getElementById("guiDiferenciaSoles");

// 6. Nuevos Campos Operacionales: Control de Niños
const checkAplicaNinos = document.getElementById("resAplicaNinos");
const inputInformacionNinos = document.getElementById("resInformacionNinos");

// Autocompletado de Huéspedes
const inputDoc = document.getElementById("resDoc");
const inputHuespedNombre = document.getElementById("resHuesped");
const datalistHuespedes = document.getElementById("listaHuespedesSugeridos");

        // 1. Capturamos los elementos interactivos
        const sidebar = document.getElementById('sidebar');
        const btnToggle = document.getElementById('btn-toggle');
        const tituloSidebar = document.getElementById('sidebar-titulo');

        // 2. Evento para escuchar los clics en el botón de hamburguesa
        btnToggle.addEventListener('click', () => {
            
            /* El método .classList.toggle() verifica:
               Si la clase 'colapsado' NO está puesta, la añade.
               Si la clase 'colapsado' YA está puesta, la quita. */
            sidebar.classList.toggle('colapsado');

            // Cambiamos el texto del título dinámicamente para que no quede cortado de forma brusca
            if (sidebar.classList.contains('colapsado')) {
                tituloSidebar.innerText = "HC"; // Muestra solo una inicial si está encogido
            } else {
                tituloSidebar.innerText = "🏨 Hotel Central Trujillo"; // Restablece el título completo
            }
        });

// =========================================================================
// --- COMPONENTES AUXILIARES Y COMPORTAMIENTO GLOBAL ---
// =========================================================================
const Toast = typeof Swal !== 'undefined' ? Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 2000,
    timerProgressBar: true
}) : null;

// Función de Cierre expuesta correctamente antes de los Listeners
window.cerrarModal = () => { 
    if (modal) modal.style.display = "none"; 
    if (form) form.reset(); 
    editId = null; 
    
    const statusDiv = document.getElementById("statusDisponibilidad");
    const btnGuardar = document.querySelector(".btn-save") || (form ? form.querySelector('button[type="submit"]') : null);
    
    if (statusDiv) statusDiv.textContent = "";
    if (btnGuardar) {
        btnGuardar.disabled = false;
        btnGuardar.style.opacity = "1";
        btnGuardar.style.cursor = "pointer";
    }
};

// =========================================================================
// --- MATEMÁTICA FINANCIERA Y OPERACIONAL ---
// =========================================================================
function obtenerNumeroNoches() {
    if (!txtCheckIn || !txtCheckOut) return 0;
    const checkIn = txtCheckIn.value;
    const checkOut = txtCheckOut.value;
    if (!checkIn || !checkOut) return 0;
    
    const fechaIn = new Date(checkIn + "T00:00:00");
    const fechaOut = new Date(checkOut + "T00:00:00");
    
    const diferenciaTiempo = fechaOut - fechaIn;
    const noches = Math.ceil(diferenciaTiempo / (1000 * 60 * 60 * 24));
    
    return checkIn === checkOut ? 1 : (noches > 0 ? noches : 0);
}

function calcularTodo(desdeTotalManual = false) {
    if (!txtTipoCambio || !txtMontoRecibido || !selectMonedaPago || !selectMonedaReserva || !txtTotal || !txtTarifa) return;

    const tipoCambio = parseFloat(txtTipoCambio.value) || 1.000;
    const montoRecibido = parseFloat(txtMontoRecibido.value) || 0;
    const monedaPago = selectMonedaPago.value;
    const monedaReserva = selectMonedaReserva.value;
    
    const noches = obtenerNumeroNoches();
    let totalReservaFinal = parseFloat(txtTotal.value) || 0;
    let tarifaBase = parseFloat(txtTarifa.value) || 0;

    if (desdeTotalManual) {
        let factoresRecargo = 0;
        if (chkEarly && chkEarly.checked) factoresRecargo += 0.5;
        if (chkLate && chkLate.checked) factoresRecargo += 0.5;

        const divisor = noches + factoresRecargo;
        if (divisor > 0) {
            tarifaBase = totalReservaFinal / divisor;
            txtTarifa.value = tarifaBase.toFixed(2);
        }
    }

    const costoRecargoUnidad = tarifaBase * 0.5;
    let recargoEarly = (chkEarly && chkEarly.checked) ? costoRecargoUnidad : 0;
    let recargoLate = (chkLate && chkLate.checked) ? costoRecargoUnidad : 0;

    if (valEarlyPreview) valEarlyPreview.value = recargoEarly.toFixed(2);
    if (valLatePreview) valLatePreview.value = recargoLate.toFixed(2);

    if (!desdeTotalManual) {
        const totalHospedajePuro = tarifaBase * noches;
        totalReservaFinal = totalHospedajePuro + recargoEarly + recargoLate;
        txtTotal.value = totalReservaFinal.toFixed(2);
    }

    let brutoSolesCaja = monedaPago === "USD" ? (montoRecibido * tipoCambio) : montoRecibido;
    let montoSolesCajaRounded = Math.round(brutoSolesCaja); 
    if (txtMontoSoles) txtMontoSoles.value = montoSolesCajaRounded; 

    let abonoEnMonedaReserva = 0;
    if (monedaReserva === "USD") {
        abonoEnMonedaReserva = monedaPago === "USD" ? montoRecibido : (montoRecibido / tipoCambio);
        if (txtAdelantoMonto) txtAdelantoMonto.value = abonoEnMonedaReserva.toFixed(2);
    } else {
        abonoEnMonedaReserva = montoSolesCajaRounded;
        if (txtAdelantoMonto) txtAdelantoMonto.value = abonoEnMonedaReserva;
    }

    const diferenciaReserva = totalReservaFinal - abonoEnMonedaReserva;
    const txtDiferenciaEl = document.getElementById("resDiferencia");
    if (txtDiferenciaEl) {
        txtDiferenciaEl.value = monedaReserva === "USD" ? diferenciaReserva.toFixed(2) : Math.round(diferenciaReserva);
    }

    let totalEspejoSoles = monedaReserva === "USD" ? Math.round(totalReservaFinal * tipoCambio) : Math.round(totalReservaFinal);
    let adelantoEspejoSoles = montoSolesCajaRounded;
    let diferenciaEspejoSoles = totalEspejoSoles - adelantoEspejoSoles;

    if (guiTotalSoles) guiTotalSoles.value = totalEspejoSoles;
    if (guiAdelantoSoles) guiAdelantoSoles.value = adelantoEspejoSoles;
    if (guiDiferenciaSoles) guiDiferenciaSoles.value = diferenciaEspejoSoles;
}

function recalcularBaseYTodo() {
    if (!txtTarifa || !txtTotal) return;
    const noches = obtenerNumeroNoches();
    const tarifa = parseFloat(txtTarifa.value) || 0;
    txtTotal.value = (tarifa * noches).toFixed(2);
    calcularTodo(false);
}

window.calcularMontos = recalcularBaseYTodo;

// =========================================================================
// --- ASIGNACIÓN DE LISTENERS SEGUROS (Apertura y Cierre) ---
// =========================================================================
if (btnAbrirModal) {
    btnAbrirModal.addEventListener("click", () => {
        editId = null; 
        if (form) form.reset();
        
        const modalTitle = document.getElementById("modalTitle");
        if (modalTitle) modalTitle.textContent = "Nueva Reserva"; 
        
        if (txtTotal) txtTotal.value = "0.00";
        if (txtDiferencia) txtDiferencia.value = "0.00";
        if (txtTipoCambio) txtTipoCambio.value = ""; 
        if (txtMontoRecibido) txtMontoRecibido.value = "";
        if (txtMontoSoles) txtMontoSoles.value = "0";
        
        if (guiTotalSoles) guiTotalSoles.value = "0";
        if (guiAdelantoSoles) guiAdelantoSoles.value = "0";
        if (guiDiferenciaSoles) guiDiferenciaSoles.value = "0";
        
        if (valEarlyPreview) valEarlyPreview.value = "0.00";
        if (valLatePreview) valLatePreview.value = "0.00";
        
        if (chkEarly) chkEarly.checked = false;
        if (chkLate) chkLate.checked = false;
        if (checkAplicaNinos) checkAplicaNinos.checked = false;
        if (inputInformacionNinos) inputInformacionNinos.value = ""; // CORRECCIÓN: Limpieza de info de niños
        
        if (form) {
            delete form.dataset.idHuesped;
        }
        
        if (modal) modal.style.display = "block"; 
    });
}

if (closeModal) {
    closeModal.addEventListener("click", () => window.cerrarModal());
}

// =========================================================================
// --- PERSISTENCIA Y ASIGNACIÓN DE ESCUCHADORES FINANCIEROS ---
// =========================================================================
if (selectMonedaReserva) {
    selectMonedaReserva.addEventListener("change", (e) => {
        const simbolo = e.target.value === "USD" ? "$" : "S/";
        document.querySelectorAll(".simbolo-moneda").forEach(el => el.textContent = simbolo);
        recalcularBaseYTodo();
    });
}

if (txtCheckIn) txtCheckIn.addEventListener("change", recalcularBaseYTodo);
if (txtCheckOut) txtCheckOut.addEventListener("change", recalcularBaseYTodo);

if (txtTarifa) {
    txtTarifa.addEventListener("input", () => {
        const noches = obtenerNumeroNoches();
        if (noches > 0 && txtTotal) {
            txtTotal.value = ((parseFloat(txtTarifa.value) || 0) * noches).toFixed(2);
        }
        calcularTodo(false);
    });
}

if (txtTotal) {
    txtTotal.addEventListener("input", () => calcularTodo(true));
}

if (chkEarly) chkEarly.addEventListener("change", () => calcularTodo(false));
if (chkLate) chkLate.addEventListener("change", () => calcularTodo(false));
if (txtMontoRecibido) txtMontoRecibido.addEventListener("input", () => calcularTodo(false));
if (selectMonedaPago) selectMonedaPago.addEventListener("change", () => calcularTodo(false));
if (txtTipoCambio) txtTipoCambio.addEventListener("input", () => calcularTodo(false));

// =========================================================================
// --- 1. CARGAR HABITACIONES DESDE SUPABASE ---
// =========================================================================
const cargarHabitacionesSelect = async () => {
    try {
        if (!txtHabitacion) return;

        const { data: habitaciones, error } = await supabase
            .from("habitaciones")
            .select("id, numero, tipo, precio_base") 
            .order("numero", { ascending: true });

        if (error) throw error;

        txtHabitacion.innerHTML = '<option value="">Seleccionar...</option>';
        if (!habitaciones || habitaciones.length === 0) return;

        habitaciones.forEach(hab => {
            const option = document.createElement("option");
            option.value = hab.id; 
            option.dataset.precio = hab.precio_base;
            option.textContent = `Hab. ${hab.numero} - ${hab.tipo}`;
            txtHabitacion.appendChild(option);
        });

    } catch (error) {
        console.error("Error al cargar selector de habitaciones:", error.message || error);
    }
};

if (txtHabitacion) {
    txtHabitacion.addEventListener("change", (e) => {
        const optionSeleccionada = e.target.options[e.target.selectedIndex];
        if (!optionSeleccionada) return;
        
        const precioBase = optionSeleccionada.dataset.precio;
        if (precioBase && txtTarifa) {
            txtTarifa.value = parseFloat(precioBase).toFixed(2);
            recalcularBaseYTodo();
        }
    });
}

cargarHabitacionesSelect();

// =========================================================================
// --- PARTE 3: AUTOCOMPLETADO POR DOCUMENTO O NOMBRE ---
// =========================================================================

// Función reutilizable para rellenar los campos del formulario
const rellenarCamposHuesped = (h) => {
    if (!h) return;
    if (form) form.dataset.idHuesped = h.id;

    // REVISIÓN Y COINCIDENCIA DE IDS CON EL DOM GLOBAL
    const txtHuesped = document.getElementById("resHuesped") || inputHuespedNombre;
    const txtDoc = document.getElementById("resDoc") || inputDoc;
    const txtTipoDoc = document.getElementById("resTipoDoc") || document.getElementById("resTipoDocumento");
    const txtTelefono = document.getElementById("resTelefono");
    const txtCorreo = document.getElementById("resCorreo");
    const txtNacionalidad = document.getElementById("resNacionalidad");
    const txtNacimiento = document.getElementById("resNacimiento") || document.getElementById("resFechaNacimiento"); 
    const txtCiudad = document.getElementById("resCiudad"); 
    const txtPreferencia = document.getElementById("resPreferencia") || document.getElementById("resPreferencias"); 
    const txtRuc = document.getElementById("resRuc") || document.getElementById("resRucRazonSocial");

    if (txtHuesped) txtHuesped.value = h.nombres_apellidos || "";
    if (txtDoc) txtDoc.value = h.documento_num || "";
    if (txtTipoDoc && h.documento_tipo) txtTipoDoc.value = h.documento_tipo;
    if (txtTelefono) txtTelefono.value = h.telefono || "";
    if (txtCorreo) txtCorreo.value = h.correo || "";
    if (txtNacionalidad) txtNacionalidad.value = h.nacionalidad || "Peruana";
    if (txtNacimiento) txtNacimiento.value = h.fecha_nacimiento || ""; 
    if (txtCiudad) txtCiudad.value = h.ciudad || ""; 
    if (txtPreferencia) txtPreferencia.value = h.preferencias || ""; 
    if (txtRuc) txtRuc.value = h.ruc || "";

    if (typeof Toast !== 'undefined' && Toast) {
        Toast.fire({
            icon: 'success',
            title: 'Huésped encontrado en el sistema',
            background: '#f0fdf4' 
        });
    }
};

// A. Búsqueda automática al perder el foco en el Documento (DNI/CE/Pasaporte)
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
            }
        } catch (error) {
            console.error("Error al buscar huésped por documento:", error.message || error);
        }
    });
}

// B. Búsqueda reactiva con lista de sugerencias dinámicas (Datalist)
if (inputHuespedNombre && datalistHuespedes) {
    inputHuespedNombre.setAttribute("list", "listaHuespedesSugeridos");

    inputHuespedNombre.addEventListener("input", async (e) => {
        const nombreBusqueda = e.target.value.trim();
        
        // CONTROL CLAVE: Si se modifica el texto, rompemos el vínculo de ID previo para evitar errores de guardado
        if (form && form.dataset.idHuesped) {
            delete form.dataset.idHuesped;
        }

        if (nombreBusqueda.length < 4) {
            datalistHuespedes.innerHTML = "";
            return;
        }

        try {
            const { data: huespedes, error } = await supabase
                .from("huespedes")
                .select("id, nombres_apellidos, documento_num, documento_tipo")
                .ilike("nombres_apellidos", `%${nombreBusqueda}%`)
                .limit(5);

            if (error) throw error;

            datalistHuespedes.innerHTML = ""; // Limpiamos justo antes de renderizar las nuevas

            if (huespedes && huespedes.length > 0) {
                huespedes.forEach(h => {
                    const option = document.createElement("option");
                    option.value = h.nombres_apellidos; 
                    // Guardamos la metadata del documento en data attributes para optimizar la selección posterior
                    option.dataset.id = h.id;
                    option.textContent = `${h.documento_tipo}: ${h.documento_num}`; 
                    datalistHuespedes.appendChild(option);
                });
            }
        } catch (error) {
            console.error("Error en sugerencias de nombres:", error.message || error);
        }
    });

    // C. Evento seguro de selección desde la lista de sugerencias
    inputHuespedNombre.addEventListener("change", async (e) => {
        const nombreSeleccionado = e.target.value.trim();
        if (!nombreSeleccionado) return;

        // Validamos si el nombre ingresado realmente existe dentro de las opciones del datalist
        const opciones = Array.from(datalistHuespedes.options);
        const opcionCoincidente = opciones.find(opt => opt.value === nombreSeleccionado);

        // Si el usuario simplemente tipeó un nombre que no está en la lista sugerida, cancelamos la petición innecesaria
        if (!opcionCoincidente) return;
        
        try {
            const { data: huespedes, error } = await supabase
                .from("huespedes")
                .select("*")
                .eq("nombres_apellidos", nombreSeleccionado);

            if (error) throw error;

            if (huespedes && huespedes.length > 0) {
                rellenarCamposHuesped(huespedes[0]);
            }
        } catch (error) {
            console.error("Error al cargar datos del huésped seleccionado:", error.message || error);
        }
    });
}

window.limpiarFormularioReserva = () => {
    console.log("🧹 Iniciando limpieza manual por IDs para no alterar el CSS...");

    // 1. Lista exacta de todos los inputs del módulo (Huésped + Reserva + Pagos)
    // Asegúrate de que coincidan con los IDs reales de tu HTML
    const inputsTexto = [
        "resHuesped", 
        "resDoc", 
        "resTelefono", 
        "resNacimiento", 
        "resCorreo", 
        "resCiudad", 
        "resPreferencia", 
        "resRuc",
        "resHuespedId",        // Tu input hidden que guarda la ID del huésped
        "resCheckIn",          // Fecha ingreso
        "resCheckOut",         // Fecha salida
        "resTarifaPactada",    // Monto o precio por noche
        "resObservaciones",    // Notas extras si tienes
        "pagoMontoRecibido",   // Si manejas adelantos
        "pagoNroOperacion"     // Nro de boucher/transferencia
    ];

    inputsTexto.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = ""; 
    });

    // 2. Restaurar los selectores desplegables a sus valores base profesionales
    if (document.getElementById("resTipoDoc")) document.getElementById("resTipoDoc").value = "DNI";
    if (document.getElementById("resNacionalidad")) document.getElementById("resNacionalidad").value = "";
    if (document.getElementById("resMoneda")) document.getElementById("resMoneda").value = "";
    if (document.getElementById("resMedio")) document.getElementById("resMedio").value = "";
    if (document.getElementById("pagoMetodo")) document.getElementById("pagoMetodo").value = "";

    // 3. Apagar los Checkboxes de Early Check-In / Late Check-Out si existen
    if (document.getElementById("chkEarly")) document.getElementById("chkEarly").checked = false;
    if (document.getElementById("chkLate")) document.getElementById("chkLate").checked = false;

    // 4. Resetear variables de control global del script
    if (typeof editId !== 'undefined') editId = null; 
    
    // Quitar el dataset idHuesped de los contenedores principales
    const modal = document.getElementById("modalReserva");
    if (modal) delete modal.dataset.idHuesped;

    // 5. Limpiar el recuadro visual de disponibilidad en tiempo real
    const statusDiv = document.getElementById("statusDisponibilidad");
    if (statusDiv) {
        statusDiv.innerHTML = "";
        statusDiv.style.backgroundColor = "transparent";
        statusDiv.style.border = "none";
    }

    // 6. Asegurar que el botón de guardar se restablezca por completo
    const btnGuardar = document.querySelector('.btn-guardar') || document.querySelector('#modalReserva button[type="submit"]');
    if (btnGuardar) {
        btnGuardar.disabled = false;
        btnGuardar.style.opacity = "1";
        btnGuardar.style.cursor = "pointer";
    }

    console.log("🧹 ¡Limpieza completada con éxito y diseño intacto!");
};
// =========================================================================
// --- PARTE 4: GUARDAR O EDITAR RESERVA (FUNCIÓN GLOBAL) ---
// =========================================================================

window.guardarReserva = async (e) => {
    if (e) e.preventDefault();

    // 1. VALIDACIONES INICIALES DE FECHAS
    const inputCheckIn = document.getElementById("resCheckIn") || txtCheckIn;
    const inputCheckOut = document.getElementById("resCheckOut") || txtCheckOut;

    if (!inputCheckIn?.value || !inputCheckOut?.value) {
        if (typeof Swal !== 'undefined') {
            Swal.fire({ icon: 'warning', title: 'Atención', text: 'Por favor, ingresa las fechas de Check-In y Check-Out.' });
        } else {
            alert("¡Atención! Por favor, ingresa las fechas de entrada y salida.");
        }
        return;
    }

    if (new Date(inputCheckOut.value) < new Date(inputCheckIn.value)) {
        if (typeof Swal !== 'undefined') {
            Swal.fire({ icon: 'warning', title: 'Atención', text: 'La fecha de salida (Check-Out) no puede ser anterior a la de entrada.' });
        } else {
            alert("¡Atención! La fecha de salida no puede ser anterior a la fecha de entrada.");
        }
        return; 
    }

    // Recuperación de variables de sesión operativa del sistema
    const idUsuarioActivo = (form ? form.dataset.idUsuarioLogueado : null) || 
                           localStorage.getItem("id_usuario_logueado") || 
                           "00000000-0000-0000-0000-000000000000"; 
                           
    const turnoActivo = localStorage.getItem("turno_activo") || "Mañana"; 
    const nombreRecepcionista = localStorage.getItem("nombre_recepcionista") || 
                                document.getElementById("resRecepcion")?.value.trim() || 
                                "Recepcionista";

    try {
        let idHuesped = form ? form.dataset.idHuesped : null;

        // =========================================================================
// 1. CAPTURAR Y VALIDAR DATOS DEL HUÉSPED (Debe ir ARRIBA)
// =========================================================================
let documentoTipo = document.getElementById("resTipoDoc")?.value || "DNI"; 
const documentoNum = document.getElementById("resDoc")?.value.trim() || "";
const nombresApellidos = document.getElementById("resHuesped")?.value.trim() || "";
const telefono = document.getElementById("resTelefono")?.value.trim() || null;
const nacionalidad = document.getElementById("resNacionalidad")?.value.trim() || "Peruana";
const fechaNacimiento = document.getElementById("resNacimiento")?.value || null;
const correo = document.getElementById("resCorreo")?.value.trim() || null;
const ciudad = document.getElementById("resCiudad")?.value.trim() || null;
const preferencias = document.getElementById("resPreferencia")?.value.trim() || null;
const ruc = document.getElementById("resRuc")?.value.trim() || null;

if (!nombresApellidos) {
    throw new Error("Por favor, ingresa los nombres y apellidos del huésped.");
}

const tiposHuespedPermitidos = ['DNI', 'Pasaporte', 'CE', 'RUC'];
if (!tiposHuespedPermitidos.includes(documentoTipo)) {
    documentoTipo = 'DNI'; 
}

// AQUÍ SE DEFINE LA VARIABLE
const datosHuesped = {
    nombres_apellidos: nombresApellidos,
    documento_tipo: documentoTipo,
    documento_num: documentoNum,
    fecha_nacimiento: fechaNacimiento,
    nacionalidad: nacionalidad,
    ciudad: ciudad,
    telefono: telefono,
    correo: correo,
    preferencias: preferencias,
    ruc_razon_social: ruc 
};

// =========================================================================
// 2. INSERCIÓN O ACTUALIZACIÓN INTELIGENTE (MÉTODO BLINDADO)
// =========================================================================
let idHuespedFinal = idHuesped;

// Si no vino un ID del formulario, investigamos en la BD si el documento ya existe
if (!idHuespedFinal && documentoNum) {
    const { data: huespedExistente, error: errorBuscar } = await supabase
        .from("huespedes")
        .select("id")
        .eq("documento_num", documentoNum)
        .maybeSingle(); // Trae un registro o null de forma segura

    if (!errorBuscar && huespedExistente) {
        idHuespedFinal = huespedExistente.id;
    }
}

let resultadoHuesped;

if (idHuespedFinal) {
    // SI YA EXISTE (En el formulario o encontrado por documento_num): ACTUALIZAMOS
    resultadoHuesped = await supabase
        .from("huespedes")
        .update(datosHuesped)
        .eq("id", idHuespedFinal)
        .select()
        .single();
} else {
    // SI DE VERDAD ES NUEVO: INSERTAMOS
    resultadoHuesped = await supabase
        .from("huespedes")
        .insert([datosHuesped])
        .select()
        .single();
}

// Control de errores definitivo
if (resultadoHuesped.error) {
    throw new Error(`Error al procesar huésped: ${resultadoHuesped.error.message}`);
}

// Sincronizamos la variable que usará la reserva abajo
idHuesped = resultadoHuesped.data.id;
if (form) form.dataset.idHuesped = idHuesped;

        // 3. CAPTURAR Y PREPARAR DATOS DE LA RESERVA
        const idHabitacion = document.getElementById("resHabitacion")?.value || null;
        const checkInHora = document.getElementById("resEarlyHora")?.value || null;
        const checkOutHora = document.getElementById("resLateHora")?.value || null;
        
        const numeroPersonas = parseInt(document.getElementById("resNumPersonas")?.value) || 1; 
        const tarifaPactada = parseFloat(document.getElementById("resTarifa")?.value) || 0;
        const moneda = document.getElementById("resMoneda")?.value || "PEN";
        const tipoChange = parseFloat(document.getElementById("resTipoCambio")?.value) || 1.000;

        const cargoEarly = parseFloat(document.getElementById("valEarlyPreview")?.value) || 0.00;
        const cargoLate = parseFloat(document.getElementById("valLatePreview")?.value) || 0.00;

        const tieneEarly = document.getElementById("resAplicaEarly")?.checked || false;
        const tieneLate = document.getElementById("resAplicaLate")?.checked || false;
        const desayuno = document.getElementById("resInfo")?.value === "true"; 
        
        const aplicaNinos = document.getElementById("resAplicaNinos")?.checked || false;
        const informacionNinos = document.getElementById("resInformacionNinos")?.value.trim() || null;
        
        let cochera = document.getElementById("resCochera")?.value.trim() || 'No';
        const cocherasPermitidas = ['Red Parking', 'Santa Mónica', 'No'];
        if (!cocherasPermitidas.includes(cochera)) {
            cochera = 'No'; 
        }

        const traslado = document.getElementById("resTraslado")?.value.trim() || null;
        const notas = document.getElementById("resObservaciones")?.value.trim() || null;
        
        let estadoReserva = document.getElementById("resEstado")?.value || "Confirmada";
        const estadosPermitidos = ['Confirmada', 'En Curso', 'Finalizada', 'Cancelada', 'No Show'];
        if (!estadosPermitidos.includes(estadoReserva)) {
            estadoReserva = 'Confirmada';
        }

        let medioReserva = document.getElementById("resMedio")?.value.trim() || 'Presencial';
        const metodosPermitidosBD = ['Presencial','WhatsApp', 'Teléfono', 'Gmail', 'Expedia', 'Day use', 'Booking', 'Airbnb', 'Otro'];
        if (!metodosPermitidosBD.includes(medioReserva)) {
            medioReserva = 'Otro';
        }

        const objetoReserva = {
            id_huesped: idHuesped,
            id_habitacion: idHabitacion,
            id_usuario: idUsuarioActivo,
            check_in_fecha: inputCheckIn.value,
            check_in_hora: checkInHora,
            check_out_fecha: inputCheckOut.value,
            check_out_hora: checkOutHora,
            numero_personas: numeroPersonas,
            tarifa_pactada: tarifaPactada,
            moneda: moneda,
            tipo_cambio: tipoChange,
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

        let idReservaProcesada = typeof editId !== 'undefined' ? editId : null;

        if (idReservaProcesada) {
            const { error: errorUpdate } = await supabase
                .from("reservas")
                .update(objetoReserva)
                .eq("id", idReservaProcesada);

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
        // 🌟 4. GESTIÓN AUTOMÁTICA DEL COBRO (CORRECCIÓN DE IDS DE UNIDAD GLOBAL)
        // =========================================================================
        const montoRecibidoCaja = parseFloat(document.getElementById("pagMontoRecibido")?.value || document.getElementById("resMontoRecibido")?.value) || 0;
        const montoSolesCajaRounded = parseFloat(document.getElementById("pagMontoSoles")?.value || document.getElementById("resMontoSoles")?.value) || 0;
        const monedaCaja = document.getElementById("pagMonedaRecibida")?.value || document.getElementById("resMonedaPago")?.value || "PEN";

        if (montoRecibidoCaja > 0) {
            let metodoPagoSeleccionado = document.getElementById("resMetodoPago")?.value || "Efectivo";
            const adelantoDetalle = document.getElementById("resAdelantoDetalle")?.value.trim() || null;

            const metodosPagoPermitidos = ['Efectivo', 'Yape', 'Transferencia', 'Tarjeta'];
            if (!metodosPagoPermitidos.includes(metodoPagoSeleccionado)) {
                metodoPagoSeleccionado = 'Efectivo'; 
            }

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
                    fechaCalculada = formateadorFecha.format(new Date(ahora.getTime() - 24 * 60 * 60 * 1000));
                }
            }

            const objetoPago = {
                id_reserva: idReservaProcesada,
                id_usuario: idUsuarioActivo,
                turno: turnoCalculado || turnoActivo, 
                nombre_recepcionista: nombreRecepcionista,
                moneda: monedaCaja,                    
                tipo_cambio_usado: monedaCaja === "USD" ? tipoChange : 1.000,                
                monto_soles: montoSolesCajaRounded,    
                monto_recibido: montoRecibidoCaja,     
                metodo_pago: metodoPagoSeleccionado, 
                concepto: 'Adelanto',
                nro_operacion: adelantoDetalle,
                fecha_pago: fechaCalculada, 
                hora_pago: ahora.toLocaleTimeString('it-IT', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', second: '2-digit' })
            };

            if (typeof editId !== 'undefined' && editId) {
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

                if (errorPago) throw errorPago;
            }
        } else if (typeof editId !== 'undefined' && editId && montoRecibidoCaja === 0) {
            await supabase
                .from("pagos")
                .delete()
                .eq("id_reserva", editId)
                .eq("concepto", "Adelanto");
        }

        if (typeof Toast !== 'undefined' && Toast) {
            Toast.fire({ icon: 'success', title: 'Reserva y pago procesados correctamente' });
        }

        // 🔥 Llamada directa a la limpieza manual por ID
        if (typeof window.limpiarFormularioReserva === 'function') {
            window.limpiarFormularioReserva();
        }

        if (typeof window.cerrarModal === 'function') {
            window.cerrarModal(); 
        }

        if (typeof escucharReservas === 'function') escucharReservas();

    } catch (error) {
        console.error("Error al guardar reserva:", error);
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                icon: 'error',
                title: 'Error al procesar la reserva',
                text: error.message || "Verifica las restricciones de las columnas en Supabase."
            });
        }
    }
};

// Listener seguro que captura tanto el envío clásico por formulario como el submit
if (form) {
    form.addEventListener("submit", window.guardarReserva);
}


// =========================================================================
// --- 5. RENDERIZADO, CONSULTA Y DISPONIBILIDAD REAL-TIME ---
// =========================================================================

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

            // CÁLCULO SEGURO DE NOCHES EVITANDO DESFASE HORARIO PERÚ
            let noches = 1;
            if (res.check_in_fecha && res.check_out_fecha) {
                const fIn = new Date(res.check_in_fecha + 'T00:00:00');
                const fOut = new Date(res.check_out_fecha + 'T00:00:00');
                const diferenciaTiempo = fOut.getTime() - fIn.getTime();
                noches = Math.max(1, Math.round(diferenciaTiempo / (1000 * 60 * 60 * 24)));
            }

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
            }
        });

    } catch (error) {
        console.error("Error al renderizar la tabla de reservas:", error.message || error);
    }
};

// SINTAXIS REALTIME SEGURO DE SUPABASE
supabase
    .channel('cambios-reservas')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reservas' }, () => {
        escucharReservas();
    })
    .subscribe();

// --- VERIFICACIÓN DE DISPONIBILIDAD REAL-TIME ---
const verificarDisponibilidadRealTime = async () => {
    const idHabitacion = document.getElementById("resHabitacion")?.value; 
    const fIn = document.getElementById("resCheckIn")?.value;
    const fOut = document.getElementById("resCheckOut")?.value;
    const statusDiv = document.getElementById("statusDisponibilidad");
    
    const formActual = (typeof form !== 'undefined' ? form : null) || document.getElementById("formReserva");
    if (!formActual || !statusDiv) return;
    
    const btnGuardar = formActual.querySelector('button[type="submit"]');

    if (!idHabitacion || !fIn || !fOut) {
        statusDiv.innerHTML = ""; 
        if (btnGuardar) {
            btnGuardar.disabled = false;
            btnGuardar.style.opacity = "1";
            btnGuardar.style.cursor = "pointer";
        }
        return;
    }

    statusDiv.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verificando disponibilidad...';
    statusDiv.style.color = "#d4a017"; 
    statusDiv.style.backgroundColor = "#fffbeb"; 
    statusDiv.style.border = "1px solid #fef3c7";

    try {
        // CORRECCIÓN CRÍTICA DE SINTAXIS: Uso correcto del filtro .not con la cadena formateada para PostgREST
        const { data: reservasExistentes, error } = await supabase
            .from("reservas")
            .select("id, check_in_fecha, check_out_fecha, estado_reserva")
            .eq("id_habitacion", idHabitacion)
            .not("estado_reserva", "in", '("Cancelada","No Show")'); 

        if (error) throw error;

        let ocupado = false;

        if (reservasExistentes) {
            for (let res of reservasExistentes) {
                if (typeof editId !== 'undefined' && editId && res.id === editId) continue;

                // Lógica estricta de cruce de rangos
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

// =========================================================================
// --- FUNCIONES DE MODAL Y EDICIÓN ---
// =========================================================================
window.prepararEdicion = async (id) => {
    const res = listaReservasGlobal.find(r => r.id === id);
    
    // Obtener el formulario de forma segura si 'form' no está globalizado
    const formActual = (typeof form !== 'undefined' ? form : null) || document.getElementById("formReserva");
    
    if (res && formActual) {
        editId = id;
        
        const modalTitle = document.getElementById("modalTitle");
        if (modalTitle) modalTitle.textContent = "Editar Reserva";
        
        // --- 1. DATOS DEL HUÉSPED ---
        if (document.getElementById("resHuesped")) document.getElementById("resHuesped").value = res.huespedes?.nombres_apellidos || "";
        if (document.getElementById("resDoc")) document.getElementById("resDoc").value = res.huespedes?.documento_num || "";
        if (document.getElementById("resTipoDoc")) document.getElementById("resTipoDoc").value = res.huespedes?.documento_tipo || "DNI";
        if (document.getElementById("resTelefono")) document.getElementById("resTelefono").value = res.huespedes?.telefono || "";
        if (document.getElementById("resCorreo")) document.getElementById("resCorreo").value = res.huespedes?.correo || "";
        if (document.getElementById("resNacionalidad")) document.getElementById("resNacionalidad").value = res.huespedes?.nacionalidad || "Peruana";
        if (document.getElementById("resNacimiento")) document.getElementById("resNacimiento").value = res.huespedes?.fecha_nacimiento || "";
        if (document.getElementById("resCiudad")) document.getElementById("resCiudad").value = res.huespedes?.ciudad || "";
        if (document.getElementById("resPreferencia")) document.getElementById("resPreferencia").value = res.huespedes?.preferencias || "";

        // --- 2. DATOS DE LA ESTANCIA ---
        if (document.getElementById("resHabitacion")) document.getElementById("resHabitacion").value = res.id_habitacion || "";
        if (document.getElementById("resMedio")) document.getElementById("resMedio").value = res.medio_reserva || "Presencial";
        if (document.getElementById("resCheckIn")) document.getElementById("resCheckIn").value = res.check_in_fecha || "";
        if (document.getElementById("resCheckOut")) document.getElementById("resCheckOut").value = res.check_out_fecha || "";
        if (document.getElementById("resEstado")) document.getElementById("resEstado").value = res.estado_reserva || "Confirmada";
        if (document.getElementById("resNumPersonas")) document.getElementById("resNumPersonas").value = res.numero_personas || "1";
        
        // --- 3. HORAS Y ADICIONALES ---
        if (document.getElementById("resEarlyHora")) document.getElementById("resEarlyHora").value = res.check_in_hora || "";
        if (document.getElementById("resLateHora")) document.getElementById("resLateHora").value = res.check_out_hora || "";
        if (document.getElementById("resInfo")) document.getElementById("resInfo").value = res.desayuno ? "true" : "false";
        if (document.getElementById("resCochera")) document.getElementById("resCochera").value = res.cochera || "No";
        if (document.getElementById("resTraslado")) document.getElementById("resTraslado").value = res.traslado || "";
        if (document.getElementById("resObservaciones")) document.getElementById("resObservaciones").value = res.notas || "";

        // --- 4. CHECKBOXES EARLY / LATE ---
        if (document.getElementById("resAplicaEarly")) document.getElementById("resAplicaEarly").checked = res.tiene_early_checkin || false;
        if (document.getElementById("resAplicaLate")) document.getElementById("resAplicaLate").checked = res.tiene_late_checkout || false;

        // --- 5. CONFIGURACIÓN DE NIÑOS ---
        if (document.getElementById("resAplicaNinos")) document.getElementById("resAplicaNinos").checked = res.tiene_ninos || false;
        if (document.getElementById("resInformacionNinos")) document.getElementById("resInformacionNinos").value = res.informacion_ninos || "";

        // --- 6. TARIFAS Y MONEDA ---
        if (document.getElementById("resTarifa")) document.getElementById("resTarifa").value = res.tarifa_pactada || "";
        if (document.getElementById("resMoneda")) document.getElementById("resMoneda").value = res.moneda || "PEN";
        
        const elTipoCambio = document.getElementById("resTipoCambio") || (typeof inputTipoCambio !== 'undefined' ? inputTipoCambio : null);
        if (elTipoCambio) elTipoCambio.value = res.tipo_cambio || "1.000";
        
        // --- 7. CONFIGURACIÓN SEGURA DEL ADELANTO (AdelantoMonto) ---
        const inputAdelanto = document.getElementById("resAdelantoMonto") || document.getElementById("AdelantoMonto");
        const selectMetodo = document.getElementById("resMetodoPago");
        const inputDetalle = document.getElementById("resAdelantoDetalle");
        const selectMonedaPago = document.getElementById("resMonedaPago"); // Input de la moneda específica de la caja

        // Filtrar el pago que corresponda al adelanto inicial
        const pagoAdelanto = (res.pagos && Array.isArray(res.pagos)) 
            ? res.pagos.find(p => parseFloat(p.monto_recibido) > 0) 
            : null;
        
        if (inputAdelanto) {
            // Corrección de Moneda: Si se pagó originalmente en USD, mostramos monto_recibido. Si no, monto_soles.
            if (pagoAdelanto) {
                inputAdelanto.value = pagoAdelanto.moneda === "USD" 
                    ? (pagoAdelanto.monto_recibido || "0.00") 
                    : (pagoAdelanto.monto_soles || "0.00");
            } else {
                inputAdelanto.value = "0.00";
            }
        }
        
        if (selectMetodo) selectMetodo.value = pagoAdelanto ? (pagoAdelanto.metodo_pago || "Efectivo") : "Efectivo";
        if (inputDetalle) inputDetalle.value = pagoAdelanto ? (pagoAdelanto.nro_operacion || "") : "";
        if (selectMonedaPago) selectMonedaPago.value = pagoAdelanto ? (pagoAdelanto.moneda || "PEN") : (res.moneda || "PEN");

        // Guardar la referencia del ID del huésped en el dataset del formulario
        formActual.dataset.idHuesped = res.id_huesped || "";

        // Recalcular montos visuales en el modal y disparar validación de disponibilidad
        if (typeof window.calcularMontos === 'function') window.calcularMontos();
        if (typeof verificarDisponibilidadRealTime === 'function') verificarDisponibilidadRealTime();
        
        // Apertura segura del modal por ID del elemento contenedor
        const modalElemento = document.getElementById("modalReserva");
        if (modalElemento) {
            modalElemento.classList.add("active");
        } else if (typeof modal !== 'undefined' && modal) {
            modal.classList.add("active");
        }
    }
};

window.eliminarReserva = async (id) => {
    if (typeof Swal === 'undefined') {
        if (confirm("¿Estás seguro de que deseas eliminar esta reserva de manera permanente?")) {
            ejecutarEliminacion(id);
        }
        return;
    }

    const result = await Swal.fire({ 
        title: '¿Eliminar reserva?', 
        text: "Esta acción eliminará la reserva de forma permanente en el sistema.",
        icon: 'warning', 
        showCancelButton: true, 
        confirmButtonColor: '#800020', // Vino Tinto corporativo
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Sí, borrar',
        cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
        await ejecutarEliminacion(id);
    }
};

// Función interna auxiliar para no duplicar lógica de eliminación
const ejecutarEliminacion = async (id) => {
    try {
        const { error } = await supabase
            .from("reservas")
            .delete()
            .eq("id", id);

        if (error) throw error;

        if (typeof Toast !== 'undefined' && Toast) {
            Toast.fire({ icon: 'success', title: 'Reserva eliminada con éxito' });
        } else {
            alert("Reserva eliminada con éxito.");
        }
        
        if (typeof escucharReservas === 'function') escucharReservas(); 
    } catch (error) {
        console.error("Error al eliminar la reserva:", error);
        if (typeof Swal !== 'undefined') {
            Swal.fire({ icon: 'error', title: 'Error al eliminar', text: error.message });
        } else {
            alert(`Error al eliminar: ${error.message}`);
        }
    }
};

// =========================================================================
// --- 6. LISTENERS AUTOMÁTICOS DE DISPONIBILIDAD ---
// =========================================================================
[
    document.getElementById("resHabitacion"),
    document.getElementById("resCheckIn"),
    document.getElementById("resCheckOut")
].forEach(el => {
    if (el) {
        el.addEventListener("change", verificarDisponibilidadRealTime);
    }
});

// =========================================================================
// --- 7. EXPORTAR EXCEL CON RANGO DE FECHAS (COHERENTE CON DDL) ---
// =========================================================================
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
        confirmButtonColor: '#166534', // Verde Excel corporativo
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
                            ? r.pagos.find(p => parseFloat(p.monto_recibido) > 0) 
                            : null;
                        
                        // Lógica de conversión/extracción según la moneda real del cobro
                        let montoAdelanto = 0;
                        if (pagoAdelanto) {
                            montoAdelanto = pagoAdelanto.moneda === "USD" 
                                ? (parseFloat(pagoAdelanto.monto_recibido) || 0) 
                                : (parseFloat(pagoAdelanto.monto_soles) || 0);
                        }
                            
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
                            <td style="text-align:center;">${r.tiene_ninos ? 'SÍ' : 'NO'}</td>
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

// =========================================================================
// --- 8. FUNCIÓN DE INICIO Y ORQUESTACIÓN GLOBAL (PARA MODAL CON DIV) ---
// =========================================================================
window.inicializarPagina = () => {
    console.log("Iniciando Módulo de Reservas - Hotel Central v2 (Supabase Production)");
    
    if (typeof escucharReservas === 'function') {
        escucharReservas();
    }

    // Buscamos el botón por su clase única dentro del modal
    const btnGuardar = document.querySelector(".btn-save");
    
    if (btnGuardar) {
        // Escuchamos el CLICK directo ya que no existe un <form>
        btnGuardar.addEventListener("click", async (e) => {
            e.preventDefault(); // Evitamos cualquier acción por defecto
            
            console.log("-> Click detectado en Guardar Reserva. Procesando...");

            if (btnGuardar.disabled) {
                console.warn("Intento de guardado bloqueado: La habitación está ocupada.");
                return;
            }

            // Llamamos de forma segura a tu función de guardado en Supabase
            if (typeof window.guardarReserva === 'function') {
                await window.guardarReserva(e);
            } else if (typeof guardarReserva === 'function') {
                await guardarReserva(e);
            } else {
                console.error("❌ Error Crítico: No se encontró la función 'guardarReserva'.");
                alert("Error interno: La función para guardar los datos no está definida.");
            }
        });
    } else {
        console.error("❌ Error de DOM: No se encontró el botón con la clase '.btn-save'.");
    }
};

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => window.inicializarPagina());
} else {
    window.inicializarPagina();
}