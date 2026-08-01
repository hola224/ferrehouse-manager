/**
 * Seed inicial (tarea 0.4). Las filas exactas están en `.agents/SEED.md`.
 *
 * Dos reglas que mandan sobre todo lo demás:
 *   1. Es IDEMPOTENTE: correrlo N veces no duplica nada.
 *   2. NUNCA pisa lo que el dueño ya configuró — ni un PIN cambiado, ni un
 *      setting editado. Por eso los settings se crean pero no se actualizan.
 */
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { SETTING_KEYS, defaultSettingRaw, SKU_COUNTER } from "@ferrehouse/shared";

const db = new PrismaClient();

type UnidadSeed = { name: string; symbol: string; factorMilli: number; isBase?: boolean };

const GRUPOS: Array<{ name: string; allowsFraction: boolean; units: UnidadSeed[] }> = [
  {
    name: "PESO",
    allowsFraction: true,
    units: [
      { name: "Kilogramo", symbol: "kg", factorMilli: 1_000, isBase: true },
      { name: "Saco 25 kg", symbol: "sc25", factorMilli: 25_000 },
      { name: "Caja 20 kg", symbol: "cj20", factorMilli: 20_000 },
      { name: "Caja 5 kg", symbol: "cj5", factorMilli: 5_000 },
    ],
  },
  {
    name: "LONGITUD",
    allowsFraction: true,
    units: [
      { name: "Metro", symbol: "m", factorMilli: 1_000, isBase: true },
      { name: "Rollo 100 m", symbol: "rl100", factorMilli: 100_000 },
      { name: "Rollo 50 m", symbol: "rl50", factorMilli: 50_000 },
      { name: "Rollo 25 m", symbol: "rl25", factorMilli: 25_000 },
      { name: "Tira 6 m", symbol: "tr6", factorMilli: 6_000 },
      { name: "Tira 3 m", symbol: "tr3", factorMilli: 3_000 },
    ],
  },
  {
    // Medio tornillo no existe.
    name: "CONTEO",
    allowsFraction: false,
    units: [
      { name: "Unidad", symbol: "un", factorMilli: 1_000, isBase: true },
      { name: "Par", symbol: "par", factorMilli: 2_000 },
      { name: "Docena", symbol: "doc", factorMilli: 12_000 },
      { name: "Caja 100 un", symbol: "cj100", factorMilli: 100_000 },
      { name: "Caja 50 un", symbol: "cj50", factorMilli: 50_000 },
      { name: "Caja 25 un", symbol: "cj25", factorMilli: 25_000 },
      { name: "Bolsa 10 un", symbol: "bl10", factorMilli: 10_000 },
      { name: "Millar", symbol: "mil", factorMilli: 1_000_000 },
      // Alias: el envase nunca se abre, existe para que el ticket diga
      // "3 planchas" en vez de "3 un". Por eso factorMilli = 1000.
      { name: "Plancha", symbol: "pl", factorMilli: 1_000 },
      { name: "Tarro", symbol: "tarro", factorMilli: 1_000 },
      { name: "Balde", symbol: "balde", factorMilli: 1_000 },
      { name: "Tira", symbol: "tira", factorMilli: 1_000 },
    ],
  },
  {
    // Sin este grupo, el día que entre diluyente a granel alguien lo mete en
    // PESO asumiendo "1 litro = 1 kilo". El diluyente pesa 0,87 kg/L y el
    // kardex mentiría un 13% sin que nadie se entere.
    name: "VOLUMEN",
    allowsFraction: true,
    units: [
      { name: "Litro", symbol: "L", factorMilli: 1_000, isBase: true },
      { name: "Bidón 20 L", symbol: "bd20", factorMilli: 20_000 },
      { name: "Bidón 5 L", symbol: "bd5", factorMilli: 5_000 },
    ],
  },
];

/**
 * PIN DE ENTRADA CONOCIDOS, no generados al azar.
 *
 * Antes el seed sorteaba un PIN de 6 dígitos y lo imprimía UNA sola vez. Es lo
 * correcto para una instalación desatendida y es exactamente lo que estorba en
 * un repositorio público: quien clona el proyecto para probarlo se queda
 * afuera de su propia copia si no vio pasar esa línea en la consola.
 *
 * El cambio TIENE UN COSTO Y HAY QUE DECIRLO: estos dos números están en el
 * README, o sea que son de dominio público. La ferretería que ponga esto en
 * producción tiene que cambiarlos en Usuarios → Editar antes de abrir. Se
 * pueden pisar sin tocar código con `SEED_ADMIN_PIN` y `SEED_SELLER_PIN`, que
 * es lo que debería hacer un instalador de verdad.
 *
 * Lo que NO cambia: el seed sigue sin pisar a un usuario que ya existe. Estos
 * valores solo se usan al CREAR la fila, nunca para actualizarla.
 */
const PIN_ADMIN = "111111";
const PIN_VENDEDOR = "222222";

async function sembrarUnidades() {
  for (const g of GRUPOS) {
    const grupo = await db.unitGroup.upsert({
      where: { name: g.name },
      update: {},
      create: { name: g.name, allowsFraction: g.allowsFraction },
    });
    for (const u of g.units) {
      await db.unit.upsert({
        where: { groupId_name: { groupId: grupo.id, name: u.name } },
        update: {},
        create: {
          groupId: grupo.id,
          name: u.name,
          symbol: u.symbol,
          factorMilli: u.factorMilli,
          isBase: u.isBase ?? false,
        },
      });
    }
  }
  const n = await db.unit.count();
  console.log(`  unidades: ${n} en ${GRUPOS.length} grupos`);
}

async function sembrarUbicacion() {
  const loc = await db.location.upsert({
    where: { name: "Local" },
    update: {},
    create: { name: "Local", isDefault: true, active: true },
  });
  await db.station.upsert({
    where: { name: "CAJA-1" },
    update: {},
    create: { name: "CAJA-1", locationId: loc.id, active: true, printerTarget: null },
  });
  console.log("  ubicación 'Local' y estación 'CAJA-1'");
}

async function sembrarUsuarios() {
  /** `[nombre, pin, vino de SEED_*_PIN]` — el tercero decide qué aviso sale. */
  const nuevos: Array<[string, string, boolean]> = [];

  // SYSTEM: autor de lo que hacen los jobs. Hash imposible de satisfacer, y el
  // login además rechaza role=SYSTEM antes de comparar nada.
  if (!(await db.user.findFirst({ where: { role: "SYSTEM" } }))) {
    await db.user.create({
      data: { name: "Sistema", role: "SYSTEM", active: false, pinHash: "*sin-login*" },
    });
  }

  /*
    Los nombres son GENÉRICOS a propósito. El seed corre en una tienda que
    todavía no conoce a nadie, y poner el nombre del dueño acá obliga a que el
    instalador lo sepa —o deja a la ferretería entrando como una persona que no
    existe—. Se personalizan después, en Usuarios → Editar, que es donde el
    dueño ya está mirando cuando quiere cambiarlos.

    Y OJO CON LA COMPROBACIÓN: es por ROL, no por nombre. Antes buscaba
    `{ name, role }`, y eso funcionaba solo mientras nadie renombrara. Apenas
    el dueño cambia «Administrador» por «Cristian», una segunda corrida del
    seed no encuentra a nadie llamado «Administrador» y crea un SEGUNDO
    administrador, con un PIN nuevo, sin avisar. Por rol dice lo que de verdad
    se quiere decir: si ya hay un administrador, no hace falta otro.
  */
  for (const [name, role, envKey, porDefecto] of [
    ["Administrador", "ADMIN", "SEED_ADMIN_PIN", PIN_ADMIN],
    ["Vendedor", "SELLER", "SEED_SELLER_PIN", PIN_VENDEDOR],
  ] as const) {
    const existe = await db.user.findFirst({ where: { role } });
    if (existe) continue; // ya hay alguien con ese rol: no se toca nada
    const delEntorno = process.env[envKey]?.trim();
    const pin = delEntorno || porDefecto;
    await db.user.create({ data: { name, role, active: true, pinHash: await hash(pin) } });
    nuevos.push([name, pin, Boolean(delEntorno)]);
  }

  console.log(`  usuarios: ${await db.user.count()}`);
  if (nuevos.length) {
    console.log("\n  ┌─ PIN de entrada:");
    for (const [name, pin] of nuevos) console.log(`  │  ${name.padEnd(16)} ${pin}`);
    /**
     * El aviso solo cuando corresponde. Antes se imprimía siempre, y en una
     * instalación de verdad —donde el instalador sortea los PIN y los pasa por
     * `SEED_*_PIN`— decía "son públicos, están en el README" de dos números
     * que no están en ninguna parte. Un aviso que miente es peor que ninguno:
     * enseña a no leerlos.
     */
    if (nuevos.every(([, , delEntorno]) => delEntorno)) {
      console.log("  └─ Anótalos ahora: no se pueden volver a ver.\n");
    } else {
      console.log("  └─ SON PÚBLICOS: están en el README. Cámbialos antes de abrir la tienda.\n");
    }
  }
}

async function sembrarContadores() {
  await db.counter.upsert({ where: { name: SKU_COUNTER }, update: {}, create: { name: SKU_COUNTER, value: 0 } });
  console.log(`  contador '${SKU_COUNTER}'`);
}

async function sembrarSettings() {
  let creados = 0;
  for (const key of SETTING_KEYS) {
    const r = await db.setting.upsert({
      where: { key },
      update: {}, // NO actualiza: el admin manda sobre el default
      create: { key, value: defaultSettingRaw(key) },
    });
    if (r) creados++;
  }
  console.log(`  settings: ${await db.setting.count()} claves (${creados} verificadas)`);
}

async function main() {
  console.log("Sembrando Ferrehouse…");
  await sembrarUnidades();
  await sembrarUbicacion();
  await sembrarUsuarios();
  await sembrarContadores();
  await sembrarSettings();
  console.log("Listo.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
