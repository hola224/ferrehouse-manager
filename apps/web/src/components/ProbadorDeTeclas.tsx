/**
 * Probador de teclas de función (2026-07-31).
 *
 * POR QUÉ EXISTE. La aplicación promete cuatro atajos impresos en pantalla,
 * pero **no todas las teclas llegan a la página**: el navegador y el escritorio
 * se quedan con algunas antes de que la página las vea, y cuáles cambia entre
 * sistemas. F6, sin ir más lejos, mueve el foco a la barra de direcciones en
 * Chrome. Esta aplicación se desarrolla en Linux y va a correr en Windows, así
 * que la pregunta no se puede contestar desde un solo equipo — y no se puede
 * contestar de memoria.
 *
 * Tampoco se puede contestar con un test automático: inyectar una tecla por el
 * protocolo de depuración la mete directo en el motor de render, o sea después
 * del punto donde el navegador la habría interceptado. Un test así siempre
 * diría que funciona.
 *
 * Así que se contesta acá, en el equipo donde importa, apretando la tecla.
 *
 * QUÉ DISTINGUE, que son tres estados y no dos:
 *   - «no llegó»: se apretó y la página no vio nada. El navegador se la quedó
 *     entera. Esa tecla no sirve como atajo en este equipo.
 *   - «llega, y es nuestra»: la página la vio y el foco siguió adentro.
 *   - «llega, pero el navegador también actúa»: la página la vio, pero el foco
 *     se fue de la página igual. Sirve a medias, que en una caja es no servir.
 */
import { useEffect, useRef, useState } from "react";
import { Boton, Chip } from "@/components/ui";
import { TECLAS_DEL_NAVEGADOR } from "@ferrehouse/shared";

type Estado = "sin probar" | "nuestra" | "compartida" | "no llegó";

const A_PROBAR = ["F2", "F4", "F6", "F8"] as const;

export function ProbadorDeTeclas() {
  const [estados, setEstados] = useState<Record<string, Estado>>({});
  const [escuchando, setEscuchando] = useState(false);
  const pendiente = useRef<string | null>(null);

  useEffect(() => {
    if (!escuchando) return;

    function alTeclado(e: KeyboardEvent) {
      if (!(A_PROBAR as readonly string[]).includes(e.key)) return;
      e.preventDefault();
      const tecla = e.key;
      pendiente.current = tecla;
      setEstados((p) => ({ ...p, [tecla]: "nuestra" }));

      /*
        El veredicto no se puede dar en el mismo instante: si el navegador va a
        llevarse el foco —F6 a la barra de direcciones— eso ocurre DESPUÉS de
        que la página recibe el evento. Se mira un momento más tarde si la
        página todavía tiene el foco.
      */
      window.setTimeout(() => {
        if (pendiente.current !== tecla) return;
        if (!document.hasFocus()) setEstados((p) => ({ ...p, [tecla]: "compartida" }));
      }, 350);
    }

    window.addEventListener("keydown", alTeclado);
    return () => window.removeEventListener("keydown", alTeclado);
  }, [escuchando]);

  const pinta: Record<Estado, { tono: "ok" | "warn" | "error" | "neutral"; texto: string }> = {
    "sin probar": { tono: "neutral", texto: "sin probar" },
    nuestra: { tono: "ok", texto: "llega, y es nuestra" },
    compartida: { tono: "warn", texto: "llega, pero el navegador también actúa" },
    "no llegó": { tono: "error", texto: "no llegó" },
  };

  return (
    <section className="rounded-[var(--fh-radio)] border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold">Probar las teclas de función</h2>
        <span className="text-xs text-ink-soft">Hazlo en cada terminal, con su navegador.</span>
      </div>

      <p className="mt-2 text-sm text-ink-soft">
        Aprieta <strong>F2</strong>, <strong>F4</strong>, <strong>F6</strong> y <strong>F8</strong>, una por una. Si
        alguna se queda en «sin probar» después de apretarla, el navegador se la quedó antes de que la página la viera:
        esa tecla no sirve como atajo en este equipo, y hay que cambiarla en la tabla de atajos.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Boton
          variante={escuchando ? "secundaria" : "principal"}
          onClick={() => {
            setEscuchando((v) => !v);
            setEstados({});
          }}
        >
          {escuchando ? "Terminar la prueba" : "Empezar la prueba"}
        </Boton>
        {escuchando ? <span className="text-sm text-ink-soft">Escuchando… aprieta las teclas ahora.</span> : null}
      </div>

      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {A_PROBAR.map((t) => {
          const e = estados[t] ?? "sin probar";
          return (
            <li key={t} className="flex items-center gap-3">
              <span className="fh-num w-10 font-semibold">{t}</span>
              <Chip tono={pinta[e].tono}>{pinta[e].texto}</Chip>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-xs text-ink-soft">
        Estas no se prueban porque el navegador no las suelta nunca y por eso la aplicación no las usa:{" "}
        <span className="fh-num">{TECLAS_DEL_NAVEGADOR.join(", ")}</span>.
      </p>
    </section>
  );
}
