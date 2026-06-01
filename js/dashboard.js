import { client as supabase } from './config.js';

let chartSemanal, chartMensual;

// --- FUNCIONES DE APOYO ---
function formatearFechaJS(fechaInput) {
    if (!fechaInput) return null;
    
    if (typeof fechaInput === 'string') {
        // Reemplazar espacios por 'T' si viene de Postgres para garantizar compatibilidad universal
        const stringLimpio = fechaInput.trim().replace(" ", "T");
        const d = new Date(stringLimpio);
        return isNaN(d.getTime()) ? null : d;
    }
    
    const d = new Date(fechaInput);
    return isNaN(d.getTime()) ? null : d; 
}

function actualizarTendencia(actual, anterior, elementoId) {
    const elemento = document.getElementById(elementoId);
    if (!elemento) return;
    if (anterior === 0) {
        elemento.innerText = "Primeros datos";
        elemento.className = "trend-value trend-neutral";
        return;
    }
    const diferencia = actual - anterior;
    const porcentaje = ((diferencia / anterior) * 100).toFixed(1);
    elemento.innerText = `${porcentaje >= 0 ? '+' : ''}${porcentaje}% vs mes anterior`;
    elemento.className = porcentaje >= 0 ? "trend-value trend-positive" : "trend-value trend-negative";
}

// --- 1. CONTROL DE ACCESO Y AUTENTICACIÓN ---
async function verificarSesion() {
    const { data: { session }, error: errAuth } = await supabase.auth.getSession();

    const idUsuarioActivo = localStorage.getItem("id_usuario_logueado") || session?.user?.id;
    const nombreRecepcionista = localStorage.getItem("nombre_recepcionista") || "Recepcionista";
    const turnoActivo = localStorage.getItem("turno_activo") || "Mañana";

    if (errAuth || (!session && !idUsuarioActivo)) {
        console.log("No se detectó sesión activa, redirigiendo al index...");
        window.location.href = "index.html";
        return;
    }

    const uiNombre = document.getElementById('userName');
    const uiRol = document.getElementById('userRole');
    const btnConfig = document.getElementById('nav-config');

    if (uiNombre) uiNombre.innerText = nombreRecepcionista.toUpperCase();
    if (uiRol) uiRol.innerText = `Turno: ${turnoActivo}`;

    try {
        if (session?.user?.id) {
            const { data: userData } = await supabase
                .from('usuarios')
                .select('rol')
                .eq('id', session.user.id)
                .single();

            if (userData && (userData.rol === "Administrador" || userData.rol === "Admin")) {
                if (btnConfig) btnConfig.style.display = "block";
            }
        }
    } catch (error) {
        console.error("Error silencioso al verificar rol administrativo:", error.message);
    }

    inicializarDashboard();
}

// Ejecutar de inmediato al cargar el script modular
verificarSesion();


// --- 2. INICIALIZACIÓN DE GRÁFICOS (APEXCHARTS) ---
function inicializarGraficos() {
    const elSemanal = document.querySelector("#chart-line");
    const elMensual = document.querySelector("#chart-bar"); 

    if (elSemanal) {
        chartSemanal = new ApexCharts(elSemanal, {
            chart: { type: 'area', height: 250, toolbar: { show: false }, zoom: { enabled: false } },
            series: [{ name: 'Ingresos S/', data: [0, 0, 0, 0, 0, 0, 0] }],
            xaxis: { categories: ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'] },
            yaxis: {
                labels: { formatter: (value) => `S/ ${value.toFixed(0)}` },
                min: 0,
                forceNiceScale: true
            },
            colors: ['#800020'], 
            stroke: { curve: 'smooth', width: 3 },
            fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.45, opacityTo: 0.05, stops: [20, 100] } },
            dataLabels: { enabled: false }
        });
        chartSemanal.render();
    }

    if (elMensual) {
        chartMensual = new ApexCharts(elMensual, {
            chart: { type: 'bar', height: 250, toolbar: { show: false } },
            plotOptions: { bar: { borderRadius: 4, columnWidth: '60%', dataLabels: { position: 'top' } } },
            yaxis: {
                labels: { formatter: (value) => `S/ ${value >= 1000 ? (value/1000).toFixed(1) + 'k' : value.toFixed(0)}` }
            },
            series: [{ name: 'Ingresos S/', data: Array(12).fill(0) }],
            xaxis: { 
                categories: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'],
                labels: { style: { fontSize: '10px' } }
            },
            colors: ['#d4a017'], 
            dataLabels: {
                enabled: true,
                formatter: (val) => `S/ ${val.toFixed(0)}`,
                style: { colors: ['#333'], fontSize: '10px' },
                offsetY: -20
            }
        });
        chartMensual.render();
    }
}


// --- 3. LÓGICA DE PROCESAMIENTO DE DATOS EN TIEMPO REAL ---
function inicializarDashboard() {
    inicializarGraficos();

    // A. ESCUCHADOR DE PAGOS E INGRESOS (PROCESADOR DE KPI Y GRÁFICOS)
    async function cargarYProcesarPagos() {
        try {
            const { data: pagos, error } = await supabase
                .from('pagos')
                .select('*');

            if (error) throw error;
            
            console.log("📊 Datos crudos de pagos recibidos de Supabase:", pagos);

            let ingresosSemana = [0, 0, 0, 0, 0, 0, 0];
            let ingresosPorMes = {}; 
            let totalMesActual = 0;
            let totalMesAnterior = 0;

            const ahora = new Date();
            const mesActual = ahora.getMonth();
            const anioActual = ahora.getFullYear();

            // Inicio de la semana operativa (Lunes)
            const inicioSemana = new Date(ahora);
            const diaHoy = inicioSemana.getDay(); 
            const diff = inicioSemana.getDate() - diaHoy + (diaHoy === 0 ? -6 : 1); 
            inicioSemana.setDate(diff);
            inicioSemana.setHours(0, 0, 0, 0);

            const fechaMesPasado = new Date();
            fechaMesPasado.setMonth(ahora.getMonth() - 1);
            const mesPasado = fechaMesPasado.getMonth();
            const anioPasado = fechaMesPasado.getFullYear();

            pagos.forEach(pago => {
                // CORRECCIÓN: Usar exactamente 'monto_soles' o 'adelanto_monto' de tu tabla SQL
                const monto = Number(pago.monto_soles || pago.adelanto_monto || 0);
                const fechaRaw = pago.fecha_pago || pago.created_at;
                const fechaObj = formatearFechaJS(fechaRaw);
                
                if (fechaObj) {
                    const m = fechaObj.getMonth();
                    const y = fechaObj.getFullYear();
                    
                    // Filtro para Gráfico Semanal
                    if (fechaObj >= inicioSemana) {
                        const dia = fechaObj.getDay();
                        const index = (dia === 0) ? 6 : dia - 1; 
                        ingresosSemana[index] += monto;
                    }

                    const keyMes = `${m}-${y}`;
                    ingresosPorMes[keyMes] = (ingresosPorMes[keyMes] || 0) + monto;

                    if (m === mesActual && y === anioActual) totalMesActual += monto;
                    if (m === mesPasado && y === anioPasado) totalMesAnterior += monto;
                }
            });

            // Forzar actualización de la UI del KPI Ingresos Mensuales
            const elKpiIngresos = document.getElementById('kpi-ingresos');
            if (elKpiIngresos) {
                elKpiIngresos.innerText = `S/ ${totalMesActual.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`;
            }
            
            actualizarTendencia(totalMesActual, totalMesAnterior, 'trend-ingresos');

            if (chartSemanal) {
                chartSemanal.updateSeries([{ name: 'Ingresos S/', data: ingresosSemana }]);
            }

            if (chartMensual) {
                const mesesData = [];
                for (let m = 0; m <= 11; m++) {
                    mesesData.push(ingresosPorMes[`${m}-${anioActual}`] || 0);
                }
                chartMensual.updateSeries([{ name: 'Ingresos S/', data: mesesData }]);
            }
        } catch (err) {
            console.error("Error crítico en procesamiento de KPI ingresos:", err.message);
        }
    }

    // B. ESCUCHADOR DE OCUPACIÓN REAL (HABITACIONES)
    async function calcularOcupacionReal() {
        try {
            const { data: habitaciones, error } = await supabase
                .from('habitaciones')
                .select('estado');

            if (error) throw error;

            const elOcupacion = document.getElementById('kpi-ocupacion');
            if (!elOcupacion) return;

            const totalHabitaciones = habitaciones.length || 13;
            let ocupadas = 0;

            habitaciones.forEach(hab => {
                if (hab.estado === "Ocupada" || hab.estado === "Ocupado" || hab.estado === "En Curso") {
                    ocupadas++;
                }
            });

            elOcupacion.innerText = `${ocupadas}/${totalHabitaciones}`;
        } catch (err) {
            console.error("Error al calcular ocupación:", err.message);
        }
    }

    // C. ESCUCHADOR DE TOTAL DE HUÉSPEDES INDIVIDUALES
    async function contarHuespedes() {
        try {
            const { count, error } = await supabase
                .from('huespedes')
                .select('*', { count: 'exact', head: true });

            if (error) throw error;

            const elHuespedes = document.getElementById('kpi-huespedes');
            if (elHuespedes) elHuespedes.innerText = count || 0;
        } catch (err) {
            console.error("Error al contar huéspedes:", err.message);
        }
    }

    // D. ESCUCHADOR DE RESERVAS DEL DÍA
    async function calcularReservasHoy() {
        try {
            const ahora = new Date();
            const formateador = new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' });
            const hoyString = formateador.format(ahora); 

            const { count, error } = await supabase
                .from('reservas')
                .select('*', { count: 'exact', head: true })
                .eq('check_in_fecha', hoyString);

            if (error) throw error;

            const elReservas = document.getElementById('kpi-reservas-hoy');
            if (elReservas) elReservas.innerText = count || 0;
        } catch (err) {
            console.error("Error al calcular reservas de hoy:", err.message);
        }
    }

    // E. RENDERIZAR ACTIVIDAD RECIENTE (CON CRUCE DE BASE DE DATOS EXTRACTO)
    async function renderizarActividadReciente() {
        const list = document.getElementById('list-checkins');
        if (!list) return;

        try {
            const { data: pagosRecientes, error: errPagos } = await supabase
                .from('pagos')
                .select('*')
                .order('created_at', { ascending: false }) 
                .limit(5);

            if (errPagos || !pagosRecientes || pagosRecientes.length === 0) {
                list.innerHTML = '<p style="text-align: center; color: #888; padding: 20px;">No hay pagos registrados hoy.</p>';
                return;
            }

            list.innerHTML = '';

            for (const pago of pagosRecientes) {
                const idReserva = pago.id_reserva;
                let tipoExacto = pago.concepto ? pago.concepto.toUpperCase() : "PAGO DE ESTADÍA";
                
                // Valores base por defecto
                let nombreHuesped = 'Huésped';
                let numHabitacion = 'S/N';
                const montoPago = Number(pago.monto_soles || pago.adelanto_monto || 0);

                if (idReserva) {
                    try {
                        // 1. Obtener la Reserva para sacar los enlaces relacionales
                        const { data: resData } = await supabase
                            .from('reservas')
                            .select('*')
                            .eq('id', idReserva)
                            .maybeSingle();

                        if (resData) {
                            // Cambiar dinámicamente el concepto si la reserva está terminada
                            const estReserva = resData.estado_reserva;
                            if (estReserva === "Finalizada") {
                                tipoExacto = "LIQUIDACIÓN CHECK-OUT";
                            }

                            // 2. Traer el Huésped real usando la columna correcta: nombres_apellidos
                            if (resData.id_huesped) {
                                const { data: huespedData } = await supabase
                                    .from('huespedes')
                                    .select('nombres_apellidos')
                                    .eq('id', resData.id_huesped)
                                    .maybeSingle();
                                
                                if (huespedData) {
                                    nombreHuesped = huespedData.nombres_apellidos;
                                }
                            }

                            // 3. Traer el Número de la Habitación real
                            if (resData.id_habitacion) {
                                const { data: habData } = await supabase
                                    .from('habitaciones')
                                    .select('numero')
                                    .eq('id', resData.id_habitacion)
                                    .maybeSingle();
                                
                                if (habData) {
                                    numHabitacion = habData.numero || 'S/N';
                                }
                            }
                        }

                        // 4. Revisar si es un consumo específico para sustituir el texto
                        const { data: consumos } = await supabase
                            .from('consumos')
                            .select('*') 
                            .eq('id_reserva', idReserva);

                        if (consumos && consumos.length > 0) {
                            consumos.forEach(c => {
                                const totalC = Number(c.total_consumo || 0);
                                if (totalC === montoPago && montoPago > 0) {
                                    tipoExacto = `CONSUMO: ${(c.descripcion || "Consumo").toUpperCase()}`;
                                }
                            });
                        }

                    } catch (e) {
                        console.error("Error cruzando datos relacionales:", e);
                    }
                }

                const item = document.createElement('div');
                item.className = "activity-item";
                item.innerHTML = `
                    <div class="activity-badge" style="background-color: #800020;"></div>
                    <div class="activity-info">
                        <p><strong>${nombreHuesped.toUpperCase()}</strong> - Hab. ${numHabitacion}</p>
                        <small>
                            <span class="badge-tipo" style="background: #fff5f5; color: #800020; padding: 2px 5px; border-radius: 4px; font-weight: bold; font-size: 10px; border: 1px solid #80002030;">
                                ${tipoExacto}
                            </span> | 
                            <strong>S/ ${montoPago.toFixed(2)}</strong>
                        </small>
                    </div>`;
                list.appendChild(item);
            }
        } catch (err) {
            console.error("Error al renderizar lista de pagos recientes:", err.message);
        }
    }

    // --- Carga inicial sincronizada ---
    cargarYProcesarPagos();
    calcularOcupacionReal();
    contarHuespedes();
    calcularReservasHoy();
    renderizarActividadReciente();

    // ==========================================================================
    // ⚡ CANALES REALTIME DE SUPABASE
    // ==========================================================================
    supabase
        .channel('realtime-pagos')
        .on('postgres_changes', { event: '*', pattern: 'public', table: 'pagos' }, () => {
            console.log('🔄 Actualización en tabla Pagos detectada...');
            cargarYProcesarPagos();
            renderizarActividadReciente();
        })
        .subscribe();

    supabase
        .channel('realtime-habitaciones')
        .on('postgres_changes', { event: '*', pattern: 'public', table: 'habitaciones' }, () => {
            console.log('🔄 Actualización en tabla Habitaciones detectada...');
            calcularOcupacionReal();
        })
        .subscribe();

    supabase
        .channel('realtime-huespedes')
        .on('postgres_changes', { event: '*', pattern: 'public', table: 'huespedes' }, () => {
            console.log('🔄 Cambio en Huéspedes detectado...');
            contarHuespedes();
        })
        .subscribe();

    supabase
        .channel('realtime-reservas')
        .on('postgres_changes', { event: '*', pattern: 'public', table: 'reservas' }, () => {
            console.log('🔄 Cambio en Reservas detectado...');
            calcularReservasHoy();
            renderizarActividadReciente();
        })
        .subscribe();
}

// --- 5. ENLACE DE LOGOUT SEGURO CON LIMPIEZA ---
document.getElementById('btnLogout')?.addEventListener('click', () => {
    Swal.fire({
        title: '¿Cerrar sesión?',
        text: "Cerrarás sesión del Sistema Hotel Central",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#800020',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Sí, salir',
        cancelButtonText: 'Cancelar',
        reverseButtons: true
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                await supabase.auth.signOut();
                localStorage.removeItem("id_usuario_logueado");
                localStorage.removeItem("nombre_recepcionista");
                localStorage.removeItem("turno_activo");
                window.location.href = "index.html";
            } catch (error) {
                console.error("Error al cerrar sesión:", error.message);
            }
        }
    });
});