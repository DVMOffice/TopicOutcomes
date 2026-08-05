# Guía paso a paso: conectar esta app a Firebase

Todo se hace desde el navegador — no necesitas Node, terminal, ni claves
de servicio. Solo la consola web de Firebase.

---

## Paso 1 — Crear el proyecto de Firebase

1. Ve a https://console.firebase.google.com/
2. Inicia sesión con tu cuenta de Google.
3. Clic en **"Agregar proyecto" / "Add project"**.
4. Ponle un nombre, ej. `learning-outcomes-ucvm`.
5. Puedes desactivar Google Analytics. Clic en **Crear proyecto** y espera.

---

## Paso 2 — Registrar la app web

1. En el panel del proyecto, clic en el ícono **`</>`** (Web).
2. Apodo, ej. `learning-outcomes-web`.
3. **NO marques** "Firebase Hosting" todavía.
4. Clic en **Registrar app**. Verás un bloque como este:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "learning-outcomes-ucvm.firebaseapp.com",
  projectId: "learning-outcomes-ucvm",
  storageBucket: "learning-outcomes-ucvm.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

5. **Copia ese objeto completo** y pégalo en tu archivo **`firebaseConfig.js`** (raíz del proyecto), reemplazando los valores `"REEMPLAZA_..."`.
6. Clic en **"Continuar a la consola"**.

---

## Paso 3 — Activar Authentication

1. Menú lateral: **Build > Authentication** → **Comenzar**.
2. Pestaña **Sign-in method** → activa **"Correo electrónico/contraseña"**, y dentro de esa misma tarjeta activa **"Vínculo de correo electrónico (sin contraseña)"**.
3. Activa también **"Anónimo"** (para el acceso de invitados).
4. Pestaña **Settings > Authorized domains**: confirma `localhost`, y agrega tu dominio real cuando publiques (GitHub Pages o Firebase Hosting).

---

## Paso 4 — Crear Firestore

1. Menú lateral: **Build > Firestore Database** → **Crear base de datos**.
2. Elige la ubicación más cercana a tus usuarios.
3. **"Iniciar en modo de producción"** → **Habilitar**.

### Crear los códigos de invitado

1. **"+ Iniciar colección"** → ID: `accessCodes`.
2. ID del documento: `Year 1` → campo `code` (string) → tu código, ej. `UCVM-Y1-2026`.
3. Repite para `Year 2` y `Year 3`.

(`instructors` y `topics` se crean solos cuando importes tus Excel en el Paso 6.)

---

## Paso 5 — Publicar las reglas de seguridad

1. En Firestore, pestaña **Reglas / Rules**.
2. Borra el contenido y pega el archivo **`firestore.rules`** (raíz del proyecto).
3. Clic en **Publicar**.

Estas reglas no requieren claves de administrador: cualquier instructor
con correo real (no invitado) puede leer/escribir instructores y temas;
los invitados solo pueden agregar/editar resultados dentro de un tema que
ya exista. Si más adelante quieres que **solo tú** puedas importar datos,
abre `firestore.rules`, descomenta `isAdminEmail()` y agrega tu correo ahí
— son 3 líneas, sin backend.

---

## Paso 6 — Probar la app y cargar tus datos

Como la app usa módulos ES6, no abras `index.html` con doble clic — sirve
un servidor local simple. Si tienes Python instalado:

```bash
python3 -m http.server 5500
```

Abre `http://localhost:5500` en tu navegador.

1. **Inicia sesión** con un correo real que exista en tu lista de instructores.
2. Ve a **`admin.html`**.
3. En la sección **"Importar datos desde Excel"**, sube tus dos archivos:
   - `Topicinstructor_master_list.xlsx`
   - `Instructorsemails_list.xlsx`
4. Clic en **"Importar y subir a Firestore"**. Verás el progreso en pantalla
   (cuántos instructores, cuántos temas, cuántas filas se excluyeron por
   ser labs/exámenes/almuerzos/feriados).

Eso es todo — no hay script aparte que correr.

---

## Paso 7 — Publicar (opcional)

### Opción A: Firebase Hosting
```bash
npm install -g firebase-tools
firebase login
firebase init hosting   # elige "." como directorio público
firebase deploy
```

### Opción B: GitHub Pages
1. Activa GitHub Pages en tu repositorio, apuntando a la rama `main` / raíz.
2. En Firebase, agrega `tu-usuario.github.io` a **Authorized domains**.

---

## Resumen — dónde está cada cosa

| Necesitas | Archivo |
|---|---|
| Config de Firebase | `firebaseConfig.js` |
| Reglas de seguridad | `firestore.rules` |
| Login / identidad (lógica compartida) | `app.js` |
| Temas, outcomes y exportación (lógica compartida) | `dataEngine.js` |
| Importar tus Excel (lógica compartida) | `importEngine.js` |
| Pantalla de login | `index.html` |
| Panel instructor | `dashboard.html` |
| Colaboración por tema | `topic.html` |
| Panel admin, import y export | `admin.html` |
