# Vitalia Dashboard

Panel web para que la Cruz Roja vea todas las emergencias que manda la app de Vitalia y de donde vienen en el mapa.

Jala los datos de la API de Vitalia con `GET /emergencias` y se actualiza solo cada 10 segundos. Cuando llega una nueva suena un aviso y se marca en rojo.

## Como correrlo

Antes de la primera vez:

- Clona [apivitalia](https://github.com/Blackout342/apivitalia) junto a esta carpeta, que queden `apivitalia/` y `vitalia-dashboard/` lado a lado
- Instala [uv](https://docs.astral.sh/uv/) (`brew install uv`)
- Crea el `.env` de apivitalia como dice su README, con `CRUZ_ROJA_CLAVE=una-clave-larga` para el panel

Despues, desde esta carpeta pega todo esto en la terminal. Instala lo que falte, prende la API en el 8000, la pagina en el 5500 y la abre en el navegador. Con Ctrl+C se apagan las dos.

```bash
cd ../apivitalia && uv venv --allow-existing --python 3.12 .venv -q && uv pip install -q -r requirements.txt && (trap 'kill 0' EXIT; .venv/bin/uvicorn views:app --reload & (sleep 3; open http://localhost:5500) & python3 -m http.server 5500 --bind 127.0.0.1 -d ../vitalia-dashboard)
```

En la pagina entra con `http://127.0.0.1:8000` y la clave `CRUZ_ROJA_CLAVE` del `.env`.

Si la pagina vive en otro lado hay que poner esa direccion en `CORS_ORIGENES` del `.env` de la API, separadas por coma.

## Que muestra

- Cuantas emergencias hubo en los ultimos 30 minutos, en 24 horas, en total y cuantas llegaron sin cuenta
- La lista con nombre, tipo de sangre, alergias, contacto y el numero al que llamo
- El mapa con cada emergencia, las recientes en rojo
- Filtros por tiempo y busqueda por nombre o telefono
