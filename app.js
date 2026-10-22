'use strict'

const INTERVALO_MS = 10000
const RECIENTE_MS = 30 * 60 * 1000
const NUEVA_MS = 60 * 1000
const RANGOS = {
  '30m': 30 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  todas: Infinity,
}
const CENTRO_INICIAL = [25.6714, -100.3098]
const TITULO = 'Vitalia Emergencias'
const COLOR_RECIENTE = '#f25050'
const COLOR_VIEJA = '#71839d'

const $ = (id) => document.getElementById(id)

function leer(almacen, clave) {
  try { return almacen.getItem(clave) } catch { return null }
}

function guardar(almacen, clave, valor) {
  try {
    if (valor == null) almacen.removeItem(clave)
    else almacen.setItem(clave, valor)
  } catch {}
}

// la clave vive solo en esta pestaña y se borra al cerrarla
const estado = {
  api: leer(localStorage, 'vitalia.api') || 'http://127.0.0.1:8000',
  clave: leer(sessionStorage, 'vitalia.clave') || '',
  emergencias: [],
  conocidas: null,
  nuevas: new Set(),
  seleccion: null,
  rango: 'todas',
  busqueda: '',
  sonido: leer(localStorage, 'vitalia.sonido') !== 'no',
  sinVer: 0,
  timer: null,
}

class ErrorClave extends Error {}

async function pedirEmergencias(api, clave) {
  let res
  try {
    res = await fetch(api.replace(/\/+$/, '') + '/emergencias', {
      headers: { Authorization: 'Bearer ' + clave },
      cache: 'no-store',
    })
  } catch {
    throw new Error('No se pudo conectar con la API')
  }
  const cuerpo = await res.json().catch(() => null)
  if (res.status === 401) throw new ErrorClave(cuerpo?.error || 'La clave no es válida')
  if (!res.ok) throw new Error(cuerpo?.error || 'La API respondió ' + res.status)
  return cuerpo
}

// la api guarda la hora en utc sin zona
function fechaUTC(texto) {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(texto) ? texto : texto + 'Z')
}

const relativo = new Intl.RelativeTimeFormat('es', { numeric: 'auto' })
const fechaCorta = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
})
const horaCompleta = new Intl.DateTimeFormat('es-MX', {
  hour: '2-digit', minute: '2-digit', second: '2-digit',
})

function haceCuanto(fecha) {
  const s = Math.round((fecha - Date.now()) / 1000)
  if (Math.abs(s) < 60) return 'justo ahora'
  if (Math.abs(s) < 3600) return relativo.format(Math.round(s / 60), 'minute')
  if (Math.abs(s) < 86400) return relativo.format(Math.round(s / 3600), 'hour')
  return relativo.format(Math.round(s / 86400), 'day')
}

function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

function digitos(valor) {
  return String(valor ?? '').replace(/\D/g, '')
}

function telefono(valor) {
  const d = digitos(valor)
  return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : d
}

function normalizar(texto) {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const esReciente = (e) => Date.now() - e.fecha < RECIENTE_MS
const sinCuenta = (e) => !e.usuario_id

function filtradas() {
  const desde = Date.now() - RANGOS[estado.rango]
  const q = normalizar(estado.busqueda.trim())
  const qDigitos = digitos(q)
  return estado.emergencias.filter((e) => {
    if (e.fecha.getTime() < desde) return false
    if (!q) return true
    const d = e.datos_enviados || {}
    const texto = normalizar(sinCuenta(e) ? 'sin cuenta' : d.nombre)
    if (texto.includes(q)) return true
    return qDigitos.length > 0 && (digitos(d.contacto).includes(qDigitos) || e.telefono_llamado.includes(qDigitos))
  })
}

/* mapa */

let mapa = null
const capaMarcadores = L.layerGroup()
const marcadores = new Map()
const oscuro = matchMedia('(prefers-color-scheme: dark)')

// en modo oscuro el css voltea los colores del mapa
function iniciarMapa() {
  if (mapa) return
  mapa = L.map('mapa').setView(CENTRO_INICIAL, 11)
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(mapa)
  capaMarcadores.addTo(mapa)
}

function estiloMarcador(e) {
  const reciente = esReciente(e)
  const elegida = estado.seleccion === e.id
  return {
    radius: elegida ? 12 : reciente ? 9 : 7,
    color: oscuro.matches ? '#2b2b29' : '#ffffff',
    weight: elegida ? 3 : 2,
    fillColor: reciente ? COLOR_RECIENTE : COLOR_VIEJA,
    fillOpacity: reciente || elegida ? 0.95 : 0.75,
  }
}

function popupHTML(e) {
  const d = e.datos_enviados || {}
  const nombre = sinCuenta(e) ? 'Sin cuenta' : esc(d.nombre || 'Sin nombre')
  const sangre = sinCuenta(e) ? '' : `<br>Sangre ${esc(d.tipo_sangre || 'no sabe')}`
  return `<strong>${nombre}</strong><span class="popup-hora">${haceCuanto(e.fecha)} · ${fechaCorta.format(e.fecha)}</span>${sangre}`
}

function pintarMapa(visibles) {
  const ids = new Set(visibles.map((e) => e.id))
  for (const [id, marcador] of marcadores) {
    if (!ids.has(id)) {
      capaMarcadores.removeLayer(marcador)
      marcadores.delete(id)
    }
  }
  // las viejas primero para que las recientes queden encima
  for (const e of [...visibles].reverse()) {
    let marcador = marcadores.get(e.id)
    if (!marcador) {
      marcador = L.circleMarker([e.latitud, e.longitud]).bindPopup('', { autoPan: true })
      marcador.on('click', () => seleccionar(e.id, false))
      marcador.addTo(capaMarcadores)
      marcadores.set(e.id, marcador)
    }
    marcador.setStyle(estiloMarcador(e))
    marcador.setPopupContent(popupHTML(e))
    if (esReciente(e) || estado.seleccion === e.id) marcador.bringToFront()
  }
}

function encuadrar() {
  const puntos = filtradas().map((e) => [e.latitud, e.longitud])
  if (puntos.length === 1) mapa.setView(puntos[0], 15)
  else if (puntos.length > 1) mapa.fitBounds(puntos, { padding: [40, 40], maxZoom: 15 })
}

/* lista */

function itemHTML(e) {
  const d = e.datos_enviados || {}
  const clases = [
    'emergencia',
    esReciente(e) && 'reciente',
    estado.nuevas.has(e.id) && 'nueva',
    estado.seleccion === e.id && 'activa',
  ].filter(Boolean).join(' ')
  const lat = Number(e.latitud).toFixed(6)
  const lng = Number(e.longitud).toFixed(6)

  const nombre = sinCuenta(e)
    ? '<span class="em-nombre anonimo">Sin cuenta</span>'
    : `<span class="em-nombre">${esc(d.nombre || 'Sin nombre')}</span>`

  const insignia = esReciente(e)
    ? '<span class="insignia critica"><span class="pulso" aria-hidden="true"></span>Reciente</span>'
    : ''

  const contacto = d.contacto
    ? `<a href="tel:${digitos(d.contacto)}">${esc(telefono(d.contacto))}</a>`
    : 'Sin contacto'

  const ficha = sinCuenta(e)
    ? '<p class="em-nota">Mandada desde el reloj sin cuenta ligada, no hay ficha médica.</p>'
    : `<dl class="em-datos">
        <div><dt>Sangre</dt><dd class="sangre">${esc(d.tipo_sangre || 'No sabe')}</dd></div>
        <div><dt>Contacto</dt><dd>${contacto}</dd></div>
        <div class="ancho"><dt>Alergias</dt><dd>${esc(d.alergias || 'Ninguna registrada')}</dd></div>
      </dl>`

  return `<li class="${clases}" data-id="${esc(e.id)}" tabindex="0">
    <div class="em-cabeza">${nombre}${insignia}</div>
    <div class="em-hora"><time datetime="${e.fecha.toISOString()}">${haceCuanto(e.fecha)}</time> · ${fechaCorta.format(e.fecha)}</div>
    ${ficha}
    <div class="em-pie">
      <span>Llamó al <strong>${esc(e.telefono_llamado)}</strong></span>
      <a href="https://www.google.com/maps/search/?api=1&query=${lat},${lng}" target="_blank" rel="noopener">${lat}, ${lng}</a>
    </div>
  </li>`
}

function pintarLista(visibles) {
  const total = estado.emergencias.length
  $('conteo').textContent = visibles.length === total
    ? `${total} emergencias`
    : `${visibles.length} de ${total} emergencias`
  $('lista').innerHTML = visibles.length
    ? visibles.map(itemHTML).join('')
    : '<li class="vacio">No hay emergencias con estos filtros.</li>'
}

function pintarResumen() {
  const ahora = Date.now()
  const contar = (ms) => estado.emergencias.filter((e) => ahora - e.fecha < ms).length
  const recientes = contar(RECIENTE_MS)
  $('dato-recientes').textContent = recientes.toLocaleString('es-MX')
  $('dato-dia').textContent = contar(RANGOS['24h']).toLocaleString('es-MX')
  $('dato-total').textContent = estado.emergencias.length.toLocaleString('es-MX')
  $('dato-anonimas').textContent = estado.emergencias.filter(sinCuenta).length.toLocaleString('es-MX')
  $('dato-recientes').parentElement.classList.toggle('alerta', recientes > 0)
}

function pintar() {
  const visibles = filtradas()
  pintarResumen()
  pintarLista(visibles)
  pintarMapa(visibles)
  for (const boton of document.querySelectorAll('[data-rango]')) {
    boton.setAttribute('aria-pressed', String(boton.dataset.rango === estado.rango))
  }
}

function seleccionar(id, mover = true) {
  estado.seleccion = id
  pintar()
  const marcador = marcadores.get(id)
  if (marcador) {
    if (mover) mapa.flyTo(marcador.getLatLng(), Math.max(mapa.getZoom(), 15), { duration: 0.6 })
    marcador.openPopup()
  }
  document.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

/* avisos */

let audio = null

function sonar() {
  if (!estado.sonido) return
  try {
    audio ??= new AudioContext()
    const t = audio.currentTime
    ;[880, 660, 880].forEach((frecuencia, i) => {
      const inicio = t + i * 0.18
      const osc = audio.createOscillator()
      const vol = audio.createGain()
      osc.frequency.value = frecuencia
      vol.gain.setValueAtTime(0.0001, inicio)
      vol.gain.exponentialRampToValueAtTime(0.2, inicio + 0.02)
      vol.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.16)
      osc.connect(vol).connect(audio.destination)
      osc.start(inicio)
      osc.stop(inicio + 0.17)
    })
  } catch {}
}

function avisarNuevas(llegaron) {
  for (const e of llegaron) {
    estado.nuevas.add(e.id)
    setTimeout(() => estado.nuevas.delete(e.id), NUEVA_MS)
  }
  sonar()
  if (document.hidden) {
    estado.sinVer += llegaron.length
    document.title = `(${estado.sinVer}) ${TITULO}`
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    estado.sinVer = 0
    document.title = TITULO
  }
})

// el navegador no deja sonar hasta que alguien toca la pagina
document.addEventListener('pointerdown', () => audio?.resume(), { passive: true })

/* datos */

function recibir(datos) {
  const lista = datos
    .map((e) => ({ ...e, fecha: fechaUTC(e.creado_en) }))
    .sort((a, b) => b.fecha - a.fecha)
  const primeraVez = estado.conocidas === null
  const llegaron = primeraVez ? [] : lista.filter((e) => !estado.conocidas.has(e.id))
  estado.conocidas = new Set(lista.map((e) => e.id))
  estado.emergencias = lista
  marcarConexion(true)
  if (llegaron.length) avisarNuevas(llegaron)
  pintar()
  if (primeraVez) encuadrar()
  else if (llegaron.length && !estado.seleccion) {
    const marcador = marcadores.get(llegaron[0].id)
    if (marcador) mapa.flyTo(marcador.getLatLng(), 15, { duration: 0.8 })
  }
}

function marcarConexion(ok, mensaje) {
  $('estado').className = 'estado ' + (ok ? 'vivo' : 'caido')
  $('estado-texto').textContent = ok ? 'En vivo' : 'Sin conexión'
  $('estado').title = ok ? '' : mensaje || ''
  if (ok) $('actualizado').textContent = 'Actualizado ' + horaCompleta.format(new Date())
}

async function ciclo() {
  try {
    recibir(await pedirEmergencias(estado.api, estado.clave))
  } catch (err) {
    if (err instanceof ErrorClave) return salir(err.message)
    marcarConexion(false, err.message)
  }
  estado.timer = setTimeout(ciclo, INTERVALO_MS)
}

/* entrada y salida */

function mostrarEntrada(mensaje) {
  $('panel').hidden = true
  $('entrada').hidden = false
  $('campo-api').value = estado.api
  $('campo-clave').value = ''
  $('error-entrada').hidden = !mensaje
  $('error-entrada').textContent = mensaje || ''
  $('campo-clave').focus()
}

function abrirPanel(datos) {
  $('entrada').hidden = true
  $('panel').hidden = false
  iniciarMapa()
  mapa.invalidateSize()
  recibir(datos)
  clearTimeout(estado.timer)
  estado.timer = setTimeout(ciclo, INTERVALO_MS)
}

function salir(mensaje) {
  clearTimeout(estado.timer)
  estado.clave = ''
  estado.emergencias = []
  estado.conocidas = null
  estado.seleccion = null
  capaMarcadores.clearLayers()
  marcadores.clear()
  guardar(sessionStorage, 'vitalia.clave', null)
  mostrarEntrada(mensaje)
}

$('forma-entrada').addEventListener('submit', async (ev) => {
  ev.preventDefault()
  const api = $('campo-api').value.trim()
  const clave = $('campo-clave').value.trim()
  const boton = $('boton-entrar')
  $('error-entrada').hidden = true
  boton.disabled = true
  boton.textContent = 'Entrando…'
  try {
    const datos = await pedirEmergencias(api, clave)
    estado.api = api
    estado.clave = clave
    guardar(localStorage, 'vitalia.api', api)
    guardar(sessionStorage, 'vitalia.clave', clave)
    abrirPanel(datos)
  } catch (err) {
    $('error-entrada').textContent = err instanceof ErrorClave
      ? err.message
      : err.message + '. Revisa la dirección y que la API tenga esta página en CORS_ORIGENES.'
    $('error-entrada').hidden = false
  } finally {
    boton.disabled = false
    boton.textContent = 'Entrar'
  }
})

/* controles */

$('boton-salir').addEventListener('click', () => salir())

$('boton-sonido').addEventListener('click', () => {
  estado.sonido = !estado.sonido
  guardar(localStorage, 'vitalia.sonido', estado.sonido ? 'si' : 'no')
  pintarBotonSonido()
  if (estado.sonido) sonar()
})

function pintarBotonSonido() {
  $('boton-sonido').setAttribute('aria-pressed', String(estado.sonido))
  $('boton-sonido').textContent = estado.sonido ? 'Sonido activado' : 'Sonido apagado'
}

$('busqueda').addEventListener('input', (ev) => {
  estado.busqueda = ev.target.value
  pintar()
})

for (const boton of document.querySelectorAll('[data-rango]')) {
  boton.addEventListener('click', () => {
    estado.rango = boton.dataset.rango
    pintar()
    encuadrar()
  })
}

$('lista').addEventListener('click', (ev) => {
  if (ev.target.closest('a')) return
  const item = ev.target.closest('[data-id]')
  if (item) seleccionar(item.dataset.id)
})

$('lista').addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter' && ev.key !== ' ') return
  const item = ev.target.closest('[data-id]')
  if (item && ev.target === item) {
    ev.preventDefault()
    seleccionar(item.dataset.id)
  }
})

/* arranque */

pintarBotonSonido()

if (estado.clave) {
  pedirEmergencias(estado.api, estado.clave)
    .then(abrirPanel)
    .catch((err) => {
      if (err instanceof ErrorClave) salir(err.message)
      else mostrarEntrada(err.message)
    })
} else {
  mostrarEntrada()
}
