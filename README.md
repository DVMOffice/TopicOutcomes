# Learning Outcomes Collection System

Sistema para que los instructores colaboren en construir la lista final de
resultados de aprendizaje (*learning outcomes*) por tema académico, sin que
el administrador tenga que consolidarlos manualmente. Todo corre en el
navegador — sin backend, sin Node, sin scripts aparte.

## Estructura del proyecto (11 archivos de código, sin subcarpetas)

| Archivo | Qué contiene | Cuándo tocarlo |
|---|---|---|
| `firebaseConfig.js` | Conexión a tu proyecto de Firebase | Solo una vez, al conectar tu proyecto |
| `app.js` | Todo lo de identidad: login por correo, login invitado, sesión, búsqueda de instructores | Si algo del login falla |
| `dataEngine.js` | Todo lo de datos: temas, resultados de aprendizaje, progreso, actividad y exportación | Si algo de los outcomes o la exportación falla |
| `importEngine.js` | Lee tus 2 Excel directo en el navegador y los sube a Firestore | Si necesitas ajustar qué filas se excluyen al importar |
| `index.html` | Login (correo + invitado), lógica incluida adentro | Diseño/flujo de login |
| `dashboard.html` | Panel del instructor | Panel del instructor |
| `topic.html` | Colaboración por tema en tiempo real | Cómo se agregan/editan outcomes |
| `admin.html` | Estadísticas, importar datos, filtros y exportar | Panel del administrador |
| `style.css` | Todo el diseño | Cambios visuales |
| `firestore.rules` | Reglas de seguridad (se pegan en la consola de Firebase) | Quién puede leer/escribir qué |
| `FIREBASE_SETUP.md` | Guía paso a paso | — |

**Por qué así:** cada HTML trae su lógica de pantalla adentro (no se
reutiliza entre páginas). Lo que sí se comparte vive en exactamente 3
archivos: `app.js` (identidad), `dataEngine.js` (datos) e `importEngine.js`
(importación). Nada de Node, nada de terminal, nada de claves de servicio.

**Tus Excel no van en el repositorio** — son datos privados. Los subes
directo en `admin.html` cuando quieras importar/actualizar datos.

## Modelo de datos (Firestore)

### `instructors/{instructorId}`
```json
{ "instructorId": "I001", "name": "Maria Smith", "email": "maria@email.com", "accessType": "email", "active": true }
```

### `topics/{topicId}`
```json
{
  "topicId": "year-1-206-cell-structure",
  "academicYear": "Year 1", "course": "206", "topicName": "Cell Structure",
  "assignedInstructorIDs": ["I001", "I002"],
  "instructorRoles": { "I001": ["primary"], "I002": ["secondary"] },
  "outcomes": [
    { "outcomeNumber": 1, "text": "Students will identify cell organelles.",
      "createdBy": "I001", "createdByName": "Maria Smith", "createdAt": "...",
      "updatedBy": "I001", "updatedByName": "Maria Smith", "updatedAt": "..." }
  ],
  "completionStatus": "in_progress",
  "activityHistory": [ { "instructorId": "I002", "instructorName": "John Lee", "action": "agregó el resultado #3", "timestamp": "..." } ]
}
```

### `accessCodes/{academicYear}`
```json
{ "code": "UCVM-Y1-2026" }
```

Un solo documento `topics/{topicId}` es compartido por todos los
instructores asignados: cuando uno agrega/edita un resultado, todos lo ven
en tiempo real, sin listas duplicadas por instructor.

## Limpieza automática al importar

`importEngine.js` excluye filas cuyo `Type` sea `LAB` o `Quiz/Midterm`, o
cuyo `Topic` contenga "lunch", "holiday", "midterm", "final exam",
"practical exam", "review session", o filas sin curso asignado. El
resultado de la importación (cuántas se excluyeron) se muestra en pantalla.

## Nota de seguridad

Las reglas actuales confían en que solo tú conoces la URL de `admin.html`.
Cualquier instructor con correo real puede en teoría escribir en
`instructors`/`topics` (necesario para que la importación funcione sin
backend). Si quieres restringir la importación a un solo correo, `firestore.rules`
ya trae comentada la función `isAdminEmail()` lista para activar.
