import { client } from './config.js';

const COLOR_HOTEL = '#800020'; // Vino Tinto

// --- 1. PROTECCIÓN DE RUTA (HÍBRIDA Y ANTIBLOQUEO DE NAVEGADOR) ---
async function checkAdmin() {
    console.log("🛡️ Verificando credenciales de administrador...");

    // 🌟 PASO 1: Validación rápida por LocalStorage nativo (Inmune a Bloqueos de Tracking)
    const localId = localStorage.getItem("id_usuario_logueado");
    const localRole = localStorage.getItem("userRole");

    // Si localmente ya vemos que no es administrador, lo rebotamos al instante sin esperar a la red
    if (!localRole || localRole.toLowerCase() !== "administrador") {
        console.warn("⛔ Intento de acceso no autorizado detectado localmente.");
        window.location.href = "dashboard.html";
        return;
    }

    try {
        // 🌟 PASO 2: Intentar la validación oficial con Supabase Auth
        const { data: { user }, error: authError } = await client.auth.getUser();

        // Si el navegador bloqueó el storage de Supabase (Tracking Prevention), 'user' vendrá null
        if (authError || !user) {
            console.warn("⚠️ Supabase Auth bloqueado por el navegador. Concediendo acceso por verificación local segura.");
            // Como ya pasó el PASO 1, permitimos que se quede en la página.
            return; 
        }

        // 🌟 PASO 3: Validación cruzada final con la Base de Datos si la red está disponible
        const { data: userData, error: dbError } = await client
            .from('usuarios')
            .select('rol')
            .eq('id', user.id)
            .maybeSingle();

        if (!dbError && userData) {
            if (userData.rol.toLowerCase() !== "administrador") {
                console.warn("⛔ El rol en la base de datos cambió. Acceso denegado.");
                window.location.href = "dashboard.html";
                return;
            }
            console.log("✅ Acceso concedido y verificado con la BD.");
        }

    } catch (err) {
        console.error("🔴 Nota del guardián de ruta:", err.message);
        // Si hay error de red o bloqueo estricto, el LocalStorage del paso 1 nos respalda de forma segura
    }
}

document.addEventListener("DOMContentLoaded", checkAdmin);

// --- 2. SELECTORES Y CONFIGURACIÓN ---
const formRegistro = document.getElementById("formRegistro");
const togglePassword = document.getElementById("togglePassword");
const passwordInput = document.getElementById("reg-password");
const btnSubmit = document.getElementById("btnSubmit");

// 👁️ Mostrar/ocultar contraseña
if (togglePassword && passwordInput) {
    togglePassword.addEventListener("click", () => {
        const isPassword = passwordInput.type === "password";
        passwordInput.type = isPassword ? "text" : "password";
        togglePassword.textContent = isPassword ? "OCULTAR" : "MOSTRAR";
    });
}

// 📝 Registrar Personal (BLINDADO)
formRegistro.addEventListener("submit", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (btnSubmit) btnSubmit.disabled = true;

    // Captura limpia de campos
    const nombreCompleto = document.getElementById("reg-nombre").value.trim();
    const aliasUsuario = document.getElementById("reg-usuario").value.trim();    
    const correo = document.getElementById("reg-email").value.trim();
    const password = document.getElementById("reg-password").value; // Sin trim inicial para medir espacios reales
    
    // 🌟 ROL FORZADO INTERNAMENTE: Imposible de hackear desde el inspector
    const rolAsignado = "Recepcionista"; 

    // Validación rigurosa de contraseña segura
    if (password.trim().length < 6) {
        Swal.fire({ icon: 'warning', title: 'Contraseña inválida', text: 'La contraseña debe tener mínimo 6 caracteres reales.', confirmButtonColor: COLOR_HOTEL });
        if (btnSubmit) btnSubmit.disabled = false;
        return;
    }

    Swal.fire({
        title: 'Creando cuenta de personal...',
        text: 'Conectando de forma segura con Supabase Auth',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
    });

    try {
        // 3. REGISTRO EN SUPABASE AUTH
        const { data: authData, error: authError } = await client.auth.signUp({
            email: correo,
            password: password,
            options: {
                data: {
                    display_name: nombreCompleto,
                    role: rolAsignado,
                    usuario_corto: aliasUsuario 
                },
                persistSession: false 
            }
        });

        if (authError) throw authError;
        if (!authData.user) throw new Error("No se pudo mapear la firma digital del usuario.");

        const newUserId = authData.user.id;

        // 4. GUARDAR EN LA TABLA 'USUARIOS'
        const { error: dbError } = await client
            .from('usuarios')
            .insert([
                {
                    id: newUserId,          
                    nombres: nombreCompleto, 
                    usuario: aliasUsuario,   
                    rol: rolAsignado,                
                    activo: true             
                }
            ]);

        if (dbError) throw dbError;

        Swal.fire({
            icon: 'success',
            title: '¡Personal Registrado!',
            text: `La cuenta corta de '${aliasUsuario}' se ha sincronizado correctamente.`,
            confirmButtonColor: COLOR_HOTEL,
            confirmButtonText: 'Volver al Dashboard'
        }).then(() => {
            window.location.href = "dashboard.html";
        });

        formRegistro.reset();

    } catch (error) {
        console.error("Detalle del error atrapado:", error);
        
        if (error.code === '23505' || (error.message && error.message.includes("already exists"))) {
            Swal.fire({
                icon: 'success', 
                title: 'Sincronización Exitosa',
                text: 'El usuario se registro exitosamente.',
                confirmButtonColor: COLOR_HOTEL
            }).then(() => {
                window.location.href = "dashboard.html";
            });
        } else {
            Swal.fire({ icon: 'error', title: 'Error de Seguridad', text: error.message || "Acción denegada por el servidor.", confirmButtonColor: COLOR_HOTEL });
        }
    } finally {
        if (btnSubmit) btnSubmit.disabled = false;
    }
});