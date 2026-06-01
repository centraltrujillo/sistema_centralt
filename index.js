import { client } from './config.js'; 

// Esperamos a que todo el DOM esté completamente cargado
document.addEventListener('DOMContentLoaded', () => {
    
    // Captura de elementos del DOM
    const initialActions = document.getElementById('initial-actions');
    const loginSection = document.getElementById('login-section');
    const loginForm = document.getElementById('login-form');
    const errorMsg = document.getElementById('error-msg');
    
    // Seleccionamos el botón de iniciar sesión dentro de contenedor inicial
    const btnLoginTrigger = initialActions.querySelector('.btn-login');
    const btnVolver = loginSection.querySelector('a');

    /** * EFECTO VISUAL: Mostrar Formulario de Login
     */
    if (btnLoginTrigger) {
        btnLoginTrigger.addEventListener('click', () => {
            errorMsg.textContent = "";
            initialActions.classList.add('fade-out');

            setTimeout(() => {
                initialActions.style.display = 'none';
                initialActions.classList.remove('fade-out'); 

                loginSection.style.display = 'block';
                loginSection.classList.add('fade-in');
            }, 400);
        });
    }

    /**
     * EFECTO VISUAL: Volver atrás (Ocultar Login)
     */
    if (btnVolver) {
        btnVolver.addEventListener('click', (e) => {
            e.preventDefault(); 

            loginSection.classList.remove('fade-in');
            loginSection.classList.add('fade-out');

            setTimeout(() => {
                loginSection.style.display = 'none';
                loginSection.classList.remove('fade-out'); 

                initialActions.style.display = 'flex';
                initialActions.classList.add('fade-in');
            }, 400);
        });
    }

    /**
     * LÓGICA DE NEGOCIO: Procesar el Formulario con Supabase Auth y Captura de Turno
     */
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault(); 
            
            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;
            const selectTurno = document.getElementById('loginTurno');
            const turnoSeleccionado = selectTurno ? selectTurno.value : "";

            if (!turnoSeleccionado) {
                errorMsg.textContent = "⚠️ Por favor, seleccione un turno de trabajo.";
                return;
            }

            const submitBtn = loginForm.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            submitBtn.textContent = "VERIFICANDO...";
            errorMsg.textContent = "";

            try {
                // 1. Petición nativa de autenticación a Supabase Auth
                const { data, error } = await client.auth.signInWithPassword({
                    email: email,
                    password: password
                });

                if (error) throw error;

                console.log("Autenticación exitosa en Auth:", data.user);
                
                if (data?.user) {
                    // 🌟 SOLUCCIÓN CONTROLADA: Limpiamos variables de turnos viejos sin tocar las llaves de Supabase
                    localStorage.removeItem("nombre_recepcionista");
                    localStorage.removeItem("userRole");
                    localStorage.removeItem("turno_activo");

                    // Guardamos los identificadores base iniciales de este nuevo turno
                    localStorage.setItem("id_usuario_logueado", data.user.id);
                    localStorage.setItem("turno_activo", turnoSeleccionado);
                    
                    try {
                        // Intentamos obtener el nombre corto directamente de la tabla pública
                        const { data: usuarioPerfil, error: perfilError } = await client
                            .from('usuarios')
                            .select('usuario, rol') 
                            .eq('id', data.user.id)
                            .maybeSingle(); 

                        if (perfilError) throw perfilError;

                        if (usuarioPerfil) {
                            // Sincronización exitosa desde la Base de Datos
                            localStorage.setItem("nombre_recepcionista", usuarioPerfil.usuario || "Recepcionista");
                            localStorage.setItem("userRole", usuarioPerfil.rol || "Recepcionista");
                            console.log(`🚀 Sincronizado desde BD: ${usuarioPerfil.usuario} (${usuarioPerfil.rol})`);
                        } else {
                            throw new Error("ID no mapeado en la tabla pública.");
                        }

                    } catch (perfilError) {
                        console.warn("⚠️ Usando respaldo seguro desde los metadatos de Supabase Auth:", perfilError.message);
                        
                        // 🌟 EXTRACCIÓN INTELIGENTE: Extrae el usuario_corto asignado desde el módulo de registro
                        const metaUsuario = data.user.user_metadata?.usuario_corto;
                        const metaRol = data.user.user_metadata?.role;

                        if (metaUsuario) {
                            localStorage.setItem("nombre_recepcionista", metaUsuario);
                            localStorage.setItem("userRole", metaRol || "Recepcionista");
                        } else {
                            // Mapeo estático de emergencia absoluto para cuentas creadas a mano en el Dashboard de Supabase
                            if (email === 'admin@hotelcentral.com') {
                                localStorage.setItem("nombre_recepcionista", "ADMINISTRADOR");
                                localStorage.setItem("userRole", "Administrador");
                            } else if (email === 'recepcionista1@hotelcentral.com') {
                                localStorage.setItem("nombre_recepcionista", "Fernanda");
                                localStorage.setItem("userRole", "Recepcionista");
                            } else {
                                localStorage.setItem("nombre_recepcionista", email);
                                localStorage.setItem("userRole", "Recepcionista");
                            }
                        }
                    }

                    console.log(`🚀 Turno Iniciado: ${localStorage.getItem("nombre_recepcionista")} con el rol de ${localStorage.getItem("userRole")}`);
                }

                // Redirección directa al flujo de la aplicación
                window.location.href = 'reservas.html'; 

            } catch (err) {
                console.error("Error en login:", err.message);
                if (err.message.includes("Invalid login credentials") || err.message.includes("Email not confirmed")) {
                    errorMsg.textContent = "⚠️ Correo o contraseña incorrectos.";
                } else {
                    errorMsg.textContent = `⚠️ Error: ${err.message}`;
                }
                
                submitBtn.disabled = false;
                submitBtn.textContent = "ENTRAR AL SISTEMA";
            }
        });
    }
});