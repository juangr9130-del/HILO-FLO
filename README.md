# HILO-FLO

Módulo de la **plataforma Mubea** para la programación de las líneas **ITW**
(*Induction Tempered Wire*) de Florence.

Misma arquitectura que HILO / HORA / MTTO / AUTO: un proceso PM2 propio,
base `Plant_Platform`, catálogos `cat_*`, sesión por cookie con JWT
compartido y el estándar visual de la plataforma. Ver
[`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).

## Idioma

**La interfaz está en inglés**: la usa el programador de Florence, Kentucky.
Eso incluye todo lo que el usuario lee — pantallas, consejos, avisos y los
mensajes de error de la API.

El código, sus comentarios y esta documentación están en español, igual que
el resto de la plataforma: son para el equipo que la mantiene.

Los términos siguen los del propio documento de proceso y de SAP, para que
el operador los reconozca: *line speed* (mm/s), *throughput* (kg/h),
*work center*, *order*, *winder*, *size change*, *bottleneck*.

## Qué hace

El programador sube el production schedule de SAP tal como sale hoy, y la
pantalla le responde tres cosas:

1. **Le distribuye las corridas por línea**, con el tiempo de cada rollo.
2. **Le dice en cuánto cierra el programa** y cuál es la línea que lo frena.
3. **Le da consejos concretos**: qué órdenes conviene mover de una línea a
   otra, con sus folios de SAP, y cuánta capacidad se libera si los aplica.

El reajuste **no produce más tonelada**: el programa hace la misma antes y
después. Lo que hace es que cierre antes, y esa capacidad se vuelve tonelada
sólo si hay órdenes que adelantar. La pantalla lo dice así, para que nadie
lea el número como producción extra de esa semana.

Cada carga recibe un **folio** (`FLO-2026-0007`) que queda guardado con sus
supuestos, para poder volver a verlo y para comparar después lo que se
recomendó contra lo que se hizo.

El punto central es el **balance**: el programa tarda lo que tarda su línea
más cargada. Mover trabajo a las líneas rápidas y dejar paradas a las
lentas baja las horas totales pero no produce un kilo más. Lo que destraba
la producción es que el material que sale de una línea lo levante otra.

## Lo único que se sube es el schedule

| archivo | qué aporta | cada cuándo |
|---|---|---|
| `Schedule_8200_<fecha>.xlsx` | el programa de la semana, ya asignado a work centers | cada carga |

Las **velocidades de receta viven dentro del módulo** como catálogo, generadas
del WI-FLO-CSW-P-526. No hay que cargar ese Excel: en la pantalla de
Velocidades se ve cada línea y cada diámetro, se corrige el valor que haga
falta y **el rendimiento en kg/h se recalcula solo**. Lo que se edita queda
marcado contra el valor del documento y se puede regresar con un clic.

Para una revisión nueva del WI se regenera el catálogo:

```bash
cd server && node scripts/generar-catalogo.mjs <ruta-del-WI.xlsx>
```

Cómo está armado cada archivo y cómo se interpreta:
[`docs/DOMINIO.md`](docs/DOMINIO.md).

## Probarlo sin instalar nada

`web/hiloflo-demo.html` es un solo archivo que se abre con doble clic. Sin
servidor, sin base de datos y sin internet: los dos Excel se leen y se
analizan dentro del navegador, y no salen de la máquina.

Es para que el programador pueda probarlo hoy, antes de que TI monte nada.
Corre **el mismo motor** que el módulo instalado — no es una maqueta aparte:
se genera desde las mismas fuentes con `cd server && npm run demo`, y el
generador se detiene si detecta que algún nombre chocaría al concatenar.

Lo que el demo no hace, y el módulo instalado sí: guardar los folios de
verdad (aquí viven en el navegador), login por número de empleado y PIN, y
compartir lo analizado con los demás módulos de la plataforma.

## Correr el módulo

```bash
cd server
npm install
npm start            # http://localhost:3005
```

Sin `DB_SERVER` arranca en **modo demo**: todo en memoria, se pierde al
reiniciar. Sirve para revisar la pantalla con los Excel reales sin montar
SQL Server. Para producción, copiar `.env.ejemplo` a `.env`, crear el
esquema y levantar con PM2:

```bash
sqlcmd -S <servidor> -i sql/00_catalogos_flo.sql
sqlcmd -S <servidor> -i sql/01_flo.sql
pm2 start ecosystem.config.cjs
```

## Cómo sale el kg/h

El WI da velocidad en mm/s y **nunca kilogramos**. Como el alambre es sólido
y el temple no cambia la sección, el rendimiento sale de la geometría:

```
kg/h = velocidad(mm/s) × 3.6 × (π/4 · d²) × 7 850 kg/m³ × eficiencia
```

170 mm/s de alambre de 14.70 mm ≈ **815 kg/h**.

## Pruebas

```bash
cd server && npm test
```

Las pruebas arman sus propios Excel de juguete con el mismo acomodo que los
de planta, así que corren sin necesidad de los documentos reales.

## Documentación

- [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) — cómo encaja en la plataforma y qué se aparta.
- [`docs/DOMINIO.md`](docs/DOMINIO.md) — cómo está armado cada archivo de planta y cómo se interpreta.
- [`docs/SUPUESTOS.md`](docs/SUPUESTOS.md) — lo que se dio por hecho y lo que falta confirmar con Florence.
- [`docs/FORMATO_DATOS.md`](docs/FORMATO_DATOS.md) — contrato de columnas de cada Excel.
- [`docs/VALIDACION.md`](docs/VALIDACION.md) — qué falta para dar el módulo por bueno.
