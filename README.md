# Vitalia Dashboard

Panel web para que la Cruz Roja vea todas las emergencias que manda la app de Vitalia y de donde vienen en el mapa.

Jala los datos de la API de Vitalia con `GET /emergencias` y se actualiza solo cada 10 segundos. Cuando llega una nueva suena un aviso y se marca en rojo.

## Como correrlo

1. En el `.env` de apivitalia agrega la clave del panel

```bash
CRUZ_ROJA_CLAVE=una-clave-larga
```

2. Prende la API

```bash
uvicorn views:app --reload
```

3. En esta carpeta levanta la pagina en el puerto 5500

```bash
python3 -m http.server 5500
```

4. Abre http://localhost:5500 y entra con la direccion de la API y la clave

Si la pagina vive en otro lado hay que poner esa direccion en `CORS_ORIGENES` del `.env` de la API, separadas por coma.

## Que muestra

- Cuantas emergencias hubo en los ultimos 30 minutos, en 24 horas, en total y cuantas llegaron sin cuenta
- La lista con nombre, tipo de sangre, alergias, contacto y el numero al que llamo
- El mapa con cada emergencia, las recientes en rojo
- Filtros por tiempo y busqueda por nombre o telefono
