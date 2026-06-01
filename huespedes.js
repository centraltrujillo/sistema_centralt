import { client as supabase } from './config.js';
// --- REFERENCIAS AL DOM ---
const modal = document.getElementById('modalHuesped');
const formHuesped = document.getElementById('formHuesped');
const container = document.getElementById('huespedesContainer');
const modalTitle = document.getElementById('modalTitle');
const inputBusqueda = document.getElementById('buscarHuesped');
const totalH = document.getElementById('totalHuespedesHoy');

// --- VARIABLES DE ESTADO ---
let listaHuespedesGlobal = [];
let listaFiltrada = [];
let paginaActual = 1;
const huespedesPorPagina = 9;

async function cargarHuespedes() {
    try {
        const { data, error } = await supabase
            .from('huespedes')
            .select('*')
            .order('updated_at', { ascending: false });

        if (error) throw error;

        listaHuespedesGlobal = data || [];
        listaFiltrada = [...listaHuespedesGlobal];
        
        renderizarHuespedes();
        
        if (totalH) totalH.innerText = listaHuespedesGlobal.length;
    } catch (error) {
        console.error("Error cargando huéspedes:", error.message);
    }
}

// --- RENDERIZAR HUÉSPEDES ---
function renderizarHuespedes() {
    container.innerHTML = '';
    const inicio = (paginaActual - 1) * huespedesPorPagina;
    const fin = inicio + huespedesPorPagina;
    const itemsParaMostrar = listaFiltrada.slice(inicio, fin);

    if (itemsParaMostrar.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-users-slash"></i>
                <p>No se encontraron huéspedes registrados.</p>
            </div>`;
        actualizarControlesPagina(0);
        return;
    }

    itemsParaMostrar.forEach((h) => {
        // Mapeo adaptado a las columnas de la base de datos de Supabase
        const nombre = (h.nombres_apellidos || "SIN NOMBRE").toUpperCase();
        const documento = h.documento_num || "---";
        const celular = h.telefono || "---";
        const tipoDoc = h.documento_tipo || "DNI";

        let esCumpleaños = false;
        if (h.fecha_nacimiento) {
            const hoy = new Date();
            const cumple = new Date(h.fecha_nacimiento);
            if (hoy.getDate() === cumple.getUTCDate() && hoy.getMonth() === cumple.getUTCMonth()) {
                esCumpleaños = true;
            }
        }

        const card = document.createElement('div');
        card.className = `huesped-card ${esCumpleaños ? 'birthday-highlight' : ''}`;
        card.innerHTML = `
            ${esCumpleaños ? '<div class="birthday-ribbon"><i class="fa-solid fa-cake-candles"></i></div>' : ''}
            <div class="h-avatar">${nombre.charAt(0).toUpperCase()}</div>
            <div class="h-info">
                <span class="badge regular">${tipoDoc}</span>
                <h4>${nombre} ${esCumpleaños ? '🎂' : ''}</h4>
                <p><i class="fa-solid fa-id-card"></i> ${documento}</p>
                <p><i class="fa-solid fa-phone"></i> ${celular}</p>
            </div>
            <div class="h-actions">
                <button onclick="verDetalles('${h.id}')" title="Ver"><i class="fa-solid fa-eye"></i></button>
                <button onclick="editarHuesped('${h.id}')" title="Editar"><i class="fa-solid fa-pen"></i></button>
            </div>
        `;
        container.appendChild(card);
    });
    actualizarControlesPagina(listaFiltrada.length);
}

// --- PAGINACIÓN ---
function actualizarControlesPagina(totalItems) {
    let paginacionContainer = document.getElementById('paginacionControls');
    const totalPaginas = Math.ceil(totalItems / huespedesPorPagina);
    if (!paginacionContainer) return;
    
    if (totalPaginas <= 1) {
        paginacionContainer.style.display = 'none';
        return;
    }

    paginacionContainer.style.display = 'flex';
    paginacionContainer.innerHTML = `
        <button ${paginaActual === 1 ? 'disabled' : ''} onclick="cambiarPagina(-1)"><i class="fa-solid fa-chevron-left"></i></button>
        <span>Página ${paginaActual} de ${totalPaginas}</span>
        <button ${paginaActual === totalPaginas ? 'disabled' : ''} onclick="cambiarPagina(1)"><i class="fa-solid fa-chevron-right"></i></button>
    `;
}

window.cambiarPagina = (dir) => {
    paginaActual += dir;
    renderizarHuespedes();
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

// --- BÚSQUEDA ---
if (inputBusqueda) {
    inputBusqueda.addEventListener('input', (e) => {
        const termino = e.target.value.toLowerCase().trim();
        listaFiltrada = listaHuespedesGlobal.filter(h => {
            const nombre = (h.nombres_apellidos || "").toLowerCase();
            const docNum = (h.documento_num || "").toLowerCase();
            return nombre.includes(termino) || docNum.includes(termino);
        });
        paginaActual = 1;
        renderizarHuespedes();
    });
}

// --- GUARDAR / EDITAR EN SUPABASE ---
formHuesped.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('huespedId').value;
    
    const datos = {
        nombres_apellidos: document.getElementById('resHuesped').value.toUpperCase(),
        documento_tipo: document.getElementById('tipoDocH').value,
        documento_num: document.getElementById('resDoc').value.trim(),
        telefono: document.getElementById('resTelefono').value.trim() || null,
        nacionalidad: document.getElementById('resNacionalidad').value.trim() || 'Peruana',
        ciudad: document.getElementById('resCiudad') ? document.getElementById('resCiudad').value.trim() || null : null,
        fecha_nacimiento: document.getElementById('resNacimiento').value || null,
        correo: document.getElementById('resCorreo').value.trim() || null,
        preferencias: document.getElementById('motivoH').value.trim() || null,
        updated_at: new Date().toISOString()
    };

    try {
        let error;

        if (id) { 
            // Modo Edición: actualiza usando la restricción de id tipo UUID
            const respuesta = await supabase
                .from('huespedes')
                .update(datos)
                .eq('id', id);
            error = respuesta.error;
        } else { 
            // Modo Nuevo: Inserta y deja que Postgres maneje id (UUIDv4) y created_at (now())
            const respuesta = await supabase
                .from('huespedes')
                .insert([datos]);
            error = respuesta.error;
        }

        if (error) throw error;

        cerrarModal();
        Swal.fire("¡Éxito!", "Datos guardados correctamente", "success");
        cargarHuespedes(); // Refrescamos la lista local
    } catch (error) { 
        console.error(error); 
        Swal.fire("Error", "No se pudo guardar: " + error.message, "error");
    }
});

// --- FUNCIONES DEL MODAL ---
window.verDetalles = async (id) => {
    try {
        const { data, error } = await supabase
            .from('huespedes')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;

        if (data) { 
            llenarModal(data, true); 
            modalTitle.innerText = "Ficha del Huésped"; 
            modal.style.display = 'flex'; 
        }
    } catch (error) {
        console.error(error);
        Swal.fire("Error", "No se pudieron recuperar los detalles", "error");
    }
};

window.editarHuesped = async (id) => {
    try {
        const { data, error } = await supabase
            .from('huespedes')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;

        if (data) { 
            document.getElementById('huespedId').value = id;
            llenarModal(data, false); 
            modalTitle.innerText = "Editar Huésped"; 
            modal.style.display = 'flex'; 
        }
    } catch (error) {
        console.error(error);
        Swal.fire("Error", "No se pudo recuperar los datos del huésped", "error");
    }
};

function llenarModal(h, esLectura) {
    document.getElementById('resHuesped').value = h.nombres_apellidos || '';
    document.getElementById('resDoc').value = h.documento_num || '';
    document.getElementById('resTelefono').value = h.telefono || '';
    document.getElementById('resNacionalidad').value = h.nacionalidad || '';
    if(document.getElementById('resCiudad')) {
        document.getElementById('resCiudad').value = h.ciudad || '';
    }
    document.getElementById('resNacimiento').value = h.fecha_nacimiento || '';
    document.getElementById('resCorreo').value = h.correo || '';
    document.getElementById('tipoDocH').value = h.documento_tipo || 'DNI';
    document.getElementById('motivoH').value = h.preferencias || '';

    const inputs = formHuesped.querySelectorAll('input, select, textarea');
    inputs.forEach(i => i.disabled = esLectura);
    const actions = document.querySelector('.form-actions');
    if (actions) actions.style.display = esLectura ? 'none' : 'flex';
}

window.abrirModalNuevo = () => {
    formHuesped.reset();
    document.getElementById('huespedId').value = "";
    modalTitle.innerText = "Nuevo Huésped";
    const inputs = formHuesped.querySelectorAll('input, select, textarea');
    inputs.forEach(i => i.disabled = false);
    const actions = document.querySelector('.form-actions');
    if (actions) actions.style.display = 'flex';
    modal.style.display = 'flex';
};

window.cerrarModal = () => { 
    modal.style.display = 'none'; 
    formHuesped.reset(); 
};

// --- EXPORTAR A EXCEL ---
window.exportarHuespedesExcel = async () => {
    if (listaHuespedesGlobal.length === 0) {
        Swal.fire("Aviso", "No hay datos para exportar", "info");
        return;
    }

    Swal.fire({ 
        title: 'Generando reporte...', 
        allowOutsideClick: false, 
        didOpen: () => { Swal.showLoading(); }
    });

    let excel = `
        <table border="1">
            <tr style="background-color: #800020; color: white; font-weight: bold;">
                <th>NOMBRE COMPLETO</th>
                <th>TIPO DOC</th>
                <th>N° DOCUMENTO</th>
                <th>TELÉFONO / CELULAR</th>
                <th>CORREO ELECTRÓNICO</th>
                <th>NACIONALIDAD</th>
                <th>CIUDAD</th>
                <th>FECHA NACIMIENTO</th>
                <th>PREFERENCIAS / NOTAS</th>
                <th>REGISTRADO EL</th>
            </tr>`;

    listaHuespedesGlobal.forEach((h) => {
        const fRegistro = h.created_at ? new Date(h.created_at).toLocaleDateString() : "---";
        const fNacimiento = h.fecha_nacimiento ? h.fecha_nacimiento : "---";
        
        excel += `
            <tr>
                <td>${(h.nombres_apellidos || "---").toUpperCase()}</td>
                <td>${h.documento_tipo || "---"}</td>
                <td>${h.documento_num || "---"}</td>
                <td>${h.telefono || "---"}</td>
                <td>${h.correo || "---"}</td>
                <td>${h.nacionalidad || "---"}</td>
                <td>${h.ciudad || "---"}</td>
                <td>${fNacimiento}</td>
                <td>${h.preferencias || "---"}</td>
                <td>${fRegistro}</td>
            </tr>`;
    });

    excel += `</table>`;

    const fileName = `Reporte_Huespedes_${new Date().toLocaleDateString()}.xls`;
    const url = 'data:application/vnd.ms-excel;charset=utf-8,' + encodeURIComponent(excel);
    
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    Swal.close();
};

// --- INICIALIZACIÓN ---
document.addEventListener('DOMContentLoaded', cargarHuespedes);