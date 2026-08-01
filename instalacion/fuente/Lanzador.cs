// ---------------------------------------------------------------------------
//  El lanzador de doble clic.
//
//  Un ejecutable minúsculo cuyo único trabajo es correr el .ps1 que está a su
//  lado. Existe por tres cosas que un .bat no puede dar:
//
//    1. EL ESCUDO DE UAC. Con el manifiesto que lleva embebido, Windows sabe
//       antes de abrirlo que necesita permisos: dibuja el escudo en el ícono y
//       pide la elevación él mismo. El .bat tenía que arrancar sin permisos,
//       darse cuenta, y relanzarse — lo que abre y cierra una consola primero,
//       que se ve exactamente como algo que falló.
//    2. EL ÍCONO. Un .bat siempre se ve como un engranaje genérico. Esto lleva
//       el isotipo de la marca.
//    3. UN SOLO ARCHIVO QUE SE VE EJECUTABLE. En la carpeta, «INSTALAR» con el
//       ícono de Ferrehouse no se confunde con nada.
//
//  QUÉ SCRIPT CORRE LO DECIDE SU PROPIO NOMBRE: INSTALAR.exe busca
//  instalar.ps1, ACTUALIZAR.exe busca actualizar.ps1. Un solo archivo fuente
//  para los tres, y renombrar el ejecutable no lo deja apuntando a otra cosa
//  sin querer — apunta a lo que dice su nombre.
// ---------------------------------------------------------------------------
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;

static class Lanzador
{
    static int Main(string[] args)
    {
        string exe = Assembly.GetExecutingAssembly().Location;
        string carpeta = Path.GetDirectoryName(exe);
        string nombre = Path.GetFileNameWithoutExtension(exe).ToLowerInvariant();
        string script = Path.Combine(carpeta, nombre + ".ps1");

        Console.Title = "Ferrehouse Manager - " + nombre;

        // UTF-8 en la consola ANTES de arrancar nada: el .ps1 escribe acentos y
        // la consola de Windows arranca en una pagina de codigos que no los
        // tiene. Sin esto, "instalacion" sale como "instalaci├│n".
        try { Console.OutputEncoding = Encoding.UTF8; } catch { }

        if (!File.Exists(script))
        {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine();
            Console.WriteLine("  No encuentro " + nombre + ".ps1 al lado de este programa.");
            Console.WriteLine();
            Console.ResetColor();
            Console.WriteLine("  Los dos archivos tienen que estar en la misma carpeta.");
            Console.WriteLine("  Si descomprimiste el ZIP, descomprimelo entero, no solo este archivo.");
            Esperar();
            return 1;
        }

        var psi = new ProcessStartInfo("powershell.exe");
        psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\"" + Argumentos(args);
        psi.WorkingDirectory = carpeta;
        // Sin shell: el proceso hijo hereda ESTA consola, asi que todo lo que
        // el script imprime sale aca, en la ventana que el usuario ya esta
        // mirando, y no en una segunda que aparece y desaparece.
        psi.UseShellExecute = false;

        int codigo;
        using (var p = Process.Start(psi))
        {
            p.WaitForExit();
            codigo = p.ExitCode;
        }

        if (codigo != 0)
        {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine();
            Console.WriteLine("  Termino con errores (codigo " + codigo + ").");
            Console.ResetColor();
        }

        Esperar();
        return codigo;
    }

    // Lo que se le haya pasado al ejecutable se le pasa igual al script, para
    // que  INSTALAR.exe -Puerto 3001  siga funcionando.
    static string Argumentos(string[] args)
    {
        var sb = new StringBuilder();
        foreach (string a in args)
        {
            sb.Append(' ');
            if (a.IndexOf(' ') >= 0 && !a.StartsWith("\"")) sb.Append('"').Append(a).Append('"');
            else sb.Append(a);
        }
        return sb.ToString();
    }

    // La ventana NO se cierra sola. Lo que el script deja en pantalla al final
    // —los PIN, o el motivo de una falla— es justamente lo que hay que leer, y
    // una ventana que se cierra al terminar se lleva eso con ella.
    static void Esperar()
    {
        Console.WriteLine();
        Console.Write("  Aprieta una tecla para cerrar . . . ");
        try { Console.ReadKey(true); } catch { Console.ReadLine(); }
        Console.WriteLine();
    }
}
